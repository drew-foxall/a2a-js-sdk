/**
 * Hono integration for the A2A Server library.
 *
 * Provides A2AHonoApp for edge runtime applications using Hono.
 * Works with Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * This implementation uses Hono's native `streamSSE` for optimal backpressure
 * handling in streaming responses. The SSE stream properly handles:
 * - Backpressure from slow clients
 * - Abort signal handling
 * - Graceful stream termination
 */

import { Hono, Context, MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { createAgentCardHandler } from '../web-standard/handlers.js';
import { UserBuilder, parseJsonBody, jsonResponse } from '../web-standard/types.js';
import { Logger, ConsoleLogger, LogContext } from '../logging/logger.js';
import { AGENT_CARD_ROUTE, JSON_RPC_ROUTE } from '../transports/routes.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import { RestTransportHandler, HTTP_STATUS } from '../transports/rest/rest_transport_handler.js';
import {
  processJsonRpc,
  extractRequestId,
  JsonRpcInput,
} from '../transports/jsonrpc/json_rpc_logic.js';
import { formatJsonRpcError, formatParseError, A2AError } from '../error.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { ServerCallContext } from '../context.js';
import { Extensions } from '../../extensions.js';
import type {
  MessageSendParamsInput,
  TaskPushNotificationConfigInput,
} from '../transports/rest/rest_types.js';
import { processStream } from '../transports/streaming.js';
import { createHonoStreamConsumer } from './streaming.js';
import { UnauthenticatedUser } from '../authentication/user.js';

/**
 * Configuration options for A2AHonoApp.
 * Follows the unified A2AServerOptions pattern for consistency across all server implementations.
 */
export interface A2AHonoOptions {
  /** Logger instance for request/error logging */
  logger?: Logger;
  /** Function to build user from web-standard Request */
  userBuilder?: UserBuilder;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Converts an error to a log context object.
 */
function errorToLogContext(error: unknown): LogContext['error'] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error instanceof A2AError ? error.code : undefined,
    };
  }
  return {
    name: 'UnknownError',
    message: String(error),
  };
}

/**
 * A2AHonoApp provides A2A protocol support for Hono applications.
 *
 * This implementation uses Hono's native `streamSSE` for optimal backpressure
 * handling. Unlike web-standard ReadableStream, Hono's streaming:
 * - Applies backpressure when clients can't keep up
 * - Properly handles abort signals
 * - Manages stream lifecycle automatically
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { A2AHonoApp } from '@drew-foxall/a2a-js-sdk/server/hono';
 * import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
 *
 * const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
 * const a2aApp = new A2AHonoApp(requestHandler, { enableRest: true });
 *
 * const app = new Hono();
 * a2aApp.setupRoutes(app, '/a2a');
 *
 * export default app;
 * ```
 */
export class A2AHonoApp {
  private requestHandler: A2ARequestHandler;
  private jsonRpcTransportHandler: JsonRpcTransportHandler;
  private restTransportHandler: RestTransportHandler;
  private options: Required<Omit<A2AHonoOptions, 'userBuilder'>> & { userBuilder?: UserBuilder };

  constructor(requestHandler: A2ARequestHandler, options?: A2AHonoOptions) {
    this.requestHandler = requestHandler;
    this.jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
    this.restTransportHandler = new RestTransportHandler(requestHandler);
    this.options = {
      logger: options?.logger ?? ConsoleLogger.create(),
      userBuilder: options?.userBuilder,
      agentCardPath: options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern,
      enableRest: options?.enableRest ?? false,
      restBasePath: options?.restBasePath ?? '/rest',
    };
  }

  /**
   * Builds user from request using the configured userBuilder.
   */
  private async buildUser(request: Request) {
    if (this.options.userBuilder) {
      return this.options.userBuilder(request);
    }
    return new UnauthenticatedUser();
  }

  /**
   * Builds ServerCallContext from request.
   */
  private async buildContext(request: Request): Promise<ServerCallContext> {
    const user = await this.buildUser(request);
    const extensionsHeader = request.headers.get(HTTP_EXTENSION_HEADER);
    return new ServerCallContext(
      Extensions.parseServiceParameter(extensionsHeader ?? undefined),
      user
    );
  }

  /**
   * Gets extension headers for response.
   */
  private getExtensionsHeaders(context: ServerCallContext): HeadersInit {
    if (context.activatedExtensions && context.activatedExtensions.length > 0) {
      return { [HTTP_EXTENSION_HEADER]: Array.from(context.activatedExtensions).join(', ') };
    }
    return {};
  }

  /**
   * Adds A2A routes to an existing Hono app.
   *
   * @param app - The Hono app instance
   * @param baseUrl - The base URL for A2A endpoints (e.g., "/a2a")
   * @param middlewares - Optional array of Hono middlewares to apply to the A2A routes
   * @param agentCardPath - Optional custom path for the agent card endpoint (overrides constructor option)
   * @returns The Hono app with A2A routes
   */
  public setupRoutes(
    app: Hono,
    baseUrl: string = '',
    middlewares?: MiddlewareHandler[],
    agentCardPath?: string
  ): Hono {
    const cardPath = agentCardPath ?? this.options.agentCardPath;
    const logger = this.options.logger;

    // Create web-standard agent card handler (no streaming needed)
    const agentCardHandler = createAgentCardHandler(this.requestHandler, {
      logger,
      userBuilder: this.options.userBuilder,
    });

    // Create a sub-app for A2A routes
    const a2aApp = new Hono();

    // Apply custom middlewares if provided
    if (middlewares && middlewares.length > 0) {
      middlewares.forEach((middleware) => a2aApp.use(middleware));
    }

    // JSON-RPC endpoint with native Hono streaming
    a2aApp.post(JSON_RPC_ROUTE.pattern, async (c: Context) => {
      return this.handleJsonRpc(c);
    });

    // Agent card endpoint (GET /.well-known/agent-card.json)
    a2aApp.get(`/${cardPath}`, async (c: Context) => agentCardHandler(c.req.raw));

    // REST API endpoints (optional) with native Hono streaming
    if (this.options.enableRest) {
      this.setupRestRoutes(a2aApp);
    }

    // Mount the sub-app to the main app
    app.route(baseUrl, a2aApp);

    return app;
  }

  /**
   * Handles JSON-RPC requests with native Hono streaming.
   */
  private async handleJsonRpc(c: Context): Promise<Response> {
    const logger = this.options.logger;
    const startTime = Date.now();
    let requestId: string | number | null = null;
    const logCtx: LogContext = {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    };

    try {
      // Parse JSON body
      const body = await parseJsonBody(c.req.raw);
      if (body === null) {
        logger.warn('Invalid JSON payload', logCtx);
        const errorResult = formatParseError();
        return jsonResponse(errorResult.body, errorResult.statusCode);
      }

      // Extract request ID
      requestId = extractRequestId(body);
      logCtx.requestId = requestId?.toString();

      // Build context
      const user = await this.buildUser(c.req.raw);
      const extensionsHeader = c.req.raw.headers.get(HTTP_EXTENSION_HEADER);

      const input: JsonRpcInput = {
        body,
        extensionsHeader,
        user,
      };

      logger.debug('Processing JSON-RPC request', logCtx);

      // Process JSON-RPC
      const result = await processJsonRpc(input, this.jsonRpcTransportHandler);
      const extensionsHeaders: HeadersInit =
        result.extensionsToActivate.length > 0
          ? { [HTTP_EXTENSION_HEADER]: result.extensionsToActivate.join(', ') }
          : {};

      // Handle streaming response with native Hono streamSSE
      if (result.type === 'stream') {
        logger.debug('Starting SSE stream with Hono native backpressure', logCtx);
        const stream = result.stream;

        return streamSSE(
          c,
          async (sseStream) => {
            const consumer = createHonoStreamConsumer(sseStream, c.req.raw.signal);

            // Wrap the stream to convert events to SSE format
            async function* sseGenerator(): AsyncGenerator<unknown, void, undefined> {
              try {
                for await (const event of stream) {
                  yield event;
                }
              } catch (streamError) {
                logger.error('SSE streaming error', {
                  ...logCtx,
                  error: errorToLogContext(streamError),
                });
                throw streamError;
              }
            }

            await processStream(sseGenerator(), consumer, {
              logger,
              logContext: logCtx,
              includeIds: true,
            });
          },
          async (error) => {
            // Error callback for streamSSE
            logger.error('Hono SSE stream error', {
              ...logCtx,
              error: errorToLogContext(error),
            });
          }
        );
      }

      // Single response
      logger.info('JSON-RPC request completed', {
        ...logCtx,
        durationMs: Date.now() - startTime,
      });
      return jsonResponse(result.response, 200, extensionsHeaders);
    } catch (error) {
      logger.error('JSON-RPC handler error', {
        ...logCtx,
        error: errorToLogContext(error),
        durationMs: Date.now() - startTime,
      });

      const errorResult = formatJsonRpcError(error, requestId);
      return jsonResponse(errorResult.body, errorResult.statusCode);
    }
  }

  /**
   * Sets up REST API routes with native Hono streaming.
   */
  private setupRestRoutes(app: Hono): void {
    const logger = this.options.logger;
    const basePath = this.options.restBasePath;

    // Helper to respond with JSON
    const respond = (statusCode: number, context: ServerCallContext, body?: unknown): Response => {
      const headers = this.getExtensionsHeaders(context);
      if (statusCode === HTTP_STATUS.NO_CONTENT) {
        return new Response(null, { status: 204, headers });
      }
      return jsonResponse(body, statusCode, headers);
    };

    // Helper for streaming with native Hono backpressure
    const streamWithHono = async (
      c: Context,
      stream: AsyncGenerator<unknown, void, undefined>,
      _context: ServerCallContext,
      logCtx: LogContext
    ): Promise<Response> => {
      return streamSSE(
        c,
        async (sseStream) => {
          const consumer = createHonoStreamConsumer(sseStream, c.req.raw.signal);
          await processStream(stream, consumer, {
            logger,
            logContext: logCtx,
            includeIds: true,
          });
        },
        async (error) => {
          logger.error('Hono SSE stream error', {
            ...logCtx,
            error: errorToLogContext(error),
          });
        }
      );
    };

    // GET /v1/card
    app.get(`${basePath}/v1/card`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const result = await this.restTransportHandler.getAuthenticatedExtendedAgentCard();
      return respond(HTTP_STATUS.OK, context, result);
    });

    // POST /v1/message:send
    app.post(`${basePath}/v1/message:send`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const body = await parseJsonBody<MessageSendParamsInput>(c.req.raw);
      if (!body) throw A2AError.parseError('Invalid JSON payload');
      const result = await this.restTransportHandler.sendMessage(body, context);
      return respond(HTTP_STATUS.CREATED, context, result);
    });

    // POST /v1/message:stream - uses native Hono streaming
    app.post(`${basePath}/v1/message:stream`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const body = await parseJsonBody<MessageSendParamsInput>(c.req.raw);
      if (!body) throw A2AError.parseError('Invalid JSON payload');
      const stream = await this.restTransportHandler.sendMessageStream(body, context);
      return streamWithHono(c, stream, context, { path: '/v1/message:stream' });
    });

    // GET /v1/tasks/:taskId
    app.get(`${basePath}/v1/tasks/:taskId`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const taskId = c.req.param('taskId');
      const url = new URL(c.req.url);
      const historyLength = url.searchParams.get('historyLength') ?? undefined;
      const result = await this.restTransportHandler.getTask(taskId, context, historyLength);
      return respond(HTTP_STATUS.OK, context, result);
    });

    // POST /v1/tasks/:taskId:cancel
    app.post(`${basePath}/v1/tasks/:taskId:cancel`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const taskId = c.req.param('taskId');
      const result = await this.restTransportHandler.cancelTask(taskId, context);
      return respond(HTTP_STATUS.ACCEPTED, context, result);
    });

    // POST /v1/tasks/:taskId:subscribe - uses native Hono streaming
    app.post(`${basePath}/v1/tasks/:taskId:subscribe`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const taskId = c.req.param('taskId');
      const stream = await this.restTransportHandler.resubscribe(taskId, context);
      return streamWithHono(c, stream, context, {
        path: `/v1/tasks/${taskId}:subscribe`,
        taskId,
      });
    });

    // POST /v1/tasks/:taskId/pushNotificationConfigs
    app.post(`${basePath}/v1/tasks/:taskId/pushNotificationConfigs`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const taskId = c.req.param('taskId');
      const body = await parseJsonBody<TaskPushNotificationConfigInput>(c.req.raw);
      if (!body) throw A2AError.parseError('Invalid JSON payload');
      Object.assign(body, { taskId, task_id: taskId });
      const result = await this.restTransportHandler.setTaskPushNotificationConfig(body, context);
      return respond(HTTP_STATUS.CREATED, context, result);
    });

    // GET /v1/tasks/:taskId/pushNotificationConfigs
    app.get(`${basePath}/v1/tasks/:taskId/pushNotificationConfigs`, async (c: Context) => {
      const context = await this.buildContext(c.req.raw);
      const taskId = c.req.param('taskId');
      const result = await this.restTransportHandler.listTaskPushNotificationConfigs(
        taskId,
        context
      );
      return respond(HTTP_STATUS.OK, context, result);
    });

    // GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
    app.get(
      `${basePath}/v1/tasks/:taskId/pushNotificationConfigs/:configId`,
      async (c: Context) => {
        const context = await this.buildContext(c.req.raw);
        const taskId = c.req.param('taskId');
        const configId = c.req.param('configId');
        const result = await this.restTransportHandler.getTaskPushNotificationConfig(
          taskId,
          configId,
          context
        );
        return respond(HTTP_STATUS.OK, context, result);
      }
    );

    // DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId
    app.delete(
      `${basePath}/v1/tasks/:taskId/pushNotificationConfigs/:configId`,
      async (c: Context) => {
        const context = await this.buildContext(c.req.raw);
        const taskId = c.req.param('taskId');
        const configId = c.req.param('configId');
        await this.restTransportHandler.deleteTaskPushNotificationConfig(taskId, configId, context);
        return respond(HTTP_STATUS.NO_CONTENT, context);
      }
    );
  }
}
