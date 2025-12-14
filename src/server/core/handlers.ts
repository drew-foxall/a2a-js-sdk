/**
 * Web-Standard Base Handlers for A2A Edge Runtime
 *
 * These handlers implement the A2A protocol using only web-standard APIs.
 * They can be used directly or wrapped by framework-specific adapters.
 */

import { JSONRPCErrorResponse, JSONRPCSuccessResponse } from '../../types.js';
import { A2AError } from '../error.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import {
  RestTransportHandler,
  HTTP_STATUS,
  mapErrorToStatus,
  toHTTPError,
} from '../transports/rest/rest_transport_handler.js';
import type {
  MessageSendParamsInput,
  TaskPushNotificationConfigInput,
} from '../transports/rest/rest_types.js';
import { ServerCallContext } from '../context.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { Extensions } from '../../extensions.js';
import {
  WebRequest,
  WebResponse,
  ResolvedEdgeHandlerOptions,
  resolveOptions,
  EdgeHandlerOptions,
  AgentCardProvider,
  resolveAgentCardProvider,
  SSEEvent,
  createSSEResponse,
  jsonResponse,
  noContentResponse,
  parseJsonBody,
  extractPathParams,
} from './types.js';
import { Logger, LogContext } from './logger.js';

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is an AsyncGenerator.
 */
function isAsyncGenerator<T>(value: unknown): value is AsyncGenerator<T, void, undefined> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AsyncGenerator)[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Creates a ServerCallContext from a web request.
 */
async function buildContext(
  request: WebRequest,
  options: ResolvedEdgeHandlerOptions
): Promise<ServerCallContext> {
  const user = await options.userBuilder(request);
  const extensionsHeader = request.headers.get(HTTP_EXTENSION_HEADER);
  return new ServerCallContext(
    Extensions.parseServiceParameter(extensionsHeader ?? undefined),
    user
  );
}

/**
 * Adds activated extensions header to response headers.
 */
function getExtensionsHeaders(context: ServerCallContext): HeadersInit {
  if (context.activatedExtensions && context.activatedExtensions.length > 0) {
    return { [HTTP_EXTENSION_HEADER]: context.activatedExtensions.join(', ') };
  }
  return {};
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

// =============================================================================
// Agent Card Handler
// =============================================================================

/**
 * Options for the agent card handler.
 */
export interface AgentCardHandlerOptions extends EdgeHandlerOptions {
  /**
   * Provider for agent card data.
   * Can be an A2ARequestHandler, an object with getAgentCard(), or a function.
   */
  agentCardProvider?: AgentCardProvider;
}

/**
 * Creates a web-standard handler for the agent card endpoint.
 *
 * Supports multiple ways to provide the agent card:
 * - Pass an A2ARequestHandler as the first argument (original API)
 * - Pass an AgentCardProvider in options (matches Express/Hono API)
 *
 * @example
 * ```ts
 * // Using A2ARequestHandler (original API)
 * createAgentCardHandler(requestHandler);
 *
 * // Using agentCardProvider option (Express/Hono compatible)
 * createAgentCardHandler(requestHandler, { agentCardProvider: async () => myCard });
 * ```
 */
export function createAgentCardHandler(
  requestHandler: A2ARequestHandler,
  options?: AgentCardHandlerOptions
): (request: WebRequest) => Promise<WebResponse> {
  const resolved = resolveOptions(options);
  const logger = resolved.logger;

  // Support both requestHandler and agentCardProvider
  const getAgentCard = options?.agentCardProvider
    ? resolveAgentCardProvider(options.agentCardProvider)
    : requestHandler.getAgentCard.bind(requestHandler);

  return async (request: WebRequest): Promise<WebResponse> => {
    const startTime = Date.now();
    const logCtx: LogContext = {
      method: request.method,
      path: new URL(request.url).pathname,
    };

    try {
      logger.debug('Agent card request received', logCtx);
      const agentCard = await getAgentCard();
      logger.info('Agent card served', { ...logCtx, durationMs: Date.now() - startTime });
      return jsonResponse(agentCard, 200);
    } catch (error) {
      logger.error('Failed to get agent card', {
        ...logCtx,
        error: errorToLogContext(error),
        durationMs: Date.now() - startTime,
      });
      return jsonResponse({ error: 'Failed to retrieve agent card' }, 500);
    }
  };
}

// =============================================================================
// JSON-RPC Handler
// =============================================================================

/**
 * Creates a web-standard handler for JSON-RPC requests.
 */
export function createJsonRpcHandler(
  requestHandler: A2ARequestHandler,
  options?: EdgeHandlerOptions
): (request: WebRequest) => Promise<WebResponse> {
  const resolved = resolveOptions(options);
  const logger = resolved.logger;
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);

  return async (request: WebRequest): Promise<WebResponse> => {
    const startTime = Date.now();
    let requestId: string | number | null = null;
    const logCtx: LogContext = {
      method: request.method,
      path: new URL(request.url).pathname,
    };

    try {
      // Parse JSON body
      const body = await parseJsonBody(request);
      if (body === null) {
        logger.warn('Invalid JSON payload', logCtx);
        const a2aError = A2AError.parseError('Invalid JSON payload.');
        const errorResponse: JSONRPCErrorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: a2aError.toJSONRPCError(),
        };
        return jsonResponse(errorResponse, 400);
      }

      requestId = (body as { id?: string | number | null })?.id ?? null;
      logCtx.requestId = requestId?.toString();

      // Build context with user and extensions
      const context = await buildContext(request, resolved);

      logger.debug('Processing JSON-RPC request', logCtx);

      // Handle the request
      const rpcResponseOrStream = await jsonRpcTransportHandler.handle(body, context);
      const extensionsHeaders = getExtensionsHeaders(context);

      // Check if streaming response
      if (isAsyncGenerator<JSONRPCSuccessResponse>(rpcResponseOrStream)) {
        logger.debug('Starting SSE stream', logCtx);
        const stream = rpcResponseOrStream;

        // Convert to SSE events
        async function* sseGenerator(): AsyncGenerator<SSEEvent, void, undefined> {
          try {
            for await (const event of stream) {
              yield {
                id: String(Date.now()),
                data: JSON.stringify(event),
              };
            }
          } catch (streamError) {
            logger.error('SSE streaming error', {
              ...logCtx,
              error: errorToLogContext(streamError),
            });
            const a2aError =
              streamError instanceof A2AError
                ? streamError
                : A2AError.internalError(
                    streamError instanceof Error ? streamError.message : 'Streaming error.'
                  );
            const errorResponse: JSONRPCErrorResponse = {
              jsonrpc: '2.0',
              id: requestId,
              error: a2aError.toJSONRPCError(),
            };
            yield {
              id: String(Date.now()),
              event: 'error',
              data: JSON.stringify(errorResponse),
            };
          }
        }

        return createSSEResponse(sseGenerator(), {
          headers: extensionsHeaders,
          signal: request.signal,
        });
      }

      // Single response - at this point we know it's not an AsyncGenerator
      const rpcResponse = rpcResponseOrStream;
      logger.info('JSON-RPC request completed', {
        ...logCtx,
        durationMs: Date.now() - startTime,
      });
      return jsonResponse(rpcResponse, 200, extensionsHeaders);
    } catch (error) {
      logger.error('JSON-RPC handler error', {
        ...logCtx,
        error: errorToLogContext(error),
        durationMs: Date.now() - startTime,
      });

      const a2aError =
        error instanceof A2AError ? error : A2AError.internalError('General processing error.');
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: requestId,
        error: a2aError.toJSONRPCError(),
      };
      return jsonResponse(errorResponse, 500);
    }
  };
}

// =============================================================================
// REST Handler
// =============================================================================

/**
 * REST route definition.
 */
interface RestRoute {
  method: 'GET' | 'POST' | 'DELETE';
  pattern: string;
  handler: (
    request: WebRequest,
    params: Record<string, string>,
    context: ServerCallContext,
    logger: Logger
  ) => Promise<WebResponse>;
}

/**
 * Creates web-standard handlers for REST API endpoints.
 * Returns an object with handlers for each endpoint.
 */
export function createRestHandlers(
  requestHandler: A2ARequestHandler,
  options?: EdgeHandlerOptions
): {
  routes: RestRoute[];
  handleRequest: (request: WebRequest, pathname: string) => Promise<WebResponse | null>;
} {
  const resolved = resolveOptions(options);
  const logger = resolved.logger;
  const restTransportHandler = new RestTransportHandler(requestHandler);

  // Helper to create response with extensions header
  const respond = (statusCode: number, context: ServerCallContext, body?: unknown): WebResponse => {
    const headers = getExtensionsHeaders(context);
    if (statusCode === HTTP_STATUS.NO_CONTENT) {
      return noContentResponse(headers);
    }
    return jsonResponse(body, statusCode, headers);
  };

  // Helper to handle errors
  const handleError = (error: unknown, context: ServerCallContext): WebResponse => {
    const a2aError =
      error instanceof A2AError
        ? error
        : A2AError.internalError(error instanceof Error ? error.message : 'Internal server error');
    const statusCode = mapErrorToStatus(a2aError.code);
    return jsonResponse(toHTTPError(a2aError), statusCode, getExtensionsHeaders(context));
  };

  // Helper for streaming responses
  const streamResponse = async (
    stream: AsyncGenerator<unknown, void, undefined>,
    context: ServerCallContext,
    logCtx: LogContext
  ): Promise<WebResponse> => {
    // Get first event to catch early errors
    const iterator = stream[Symbol.asyncIterator]();
    let firstResult: IteratorResult<unknown>;
    try {
      firstResult = await iterator.next();
    } catch (error) {
      logger.error('Stream initialization error', {
        ...logCtx,
        error: errorToLogContext(error),
      });
      const a2aError =
        error instanceof A2AError
          ? error
          : A2AError.internalError(error instanceof Error ? error.message : 'Streaming error');
      const statusCode = mapErrorToStatus(a2aError.code);
      return respond(statusCode, context, toHTTPError(a2aError));
    }

    // Stream events
    async function* sseGenerator(): AsyncGenerator<SSEEvent, void, undefined> {
      try {
        if (!firstResult.done) {
          yield { id: String(Date.now()), data: JSON.stringify(firstResult.value) };
        }
        for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
          yield { id: String(Date.now()), data: JSON.stringify(event) };
        }
      } catch (streamError) {
        logger.error('SSE streaming error', {
          ...logCtx,
          error: errorToLogContext(streamError),
        });
        const a2aError =
          streamError instanceof A2AError
            ? streamError
            : A2AError.internalError(
                streamError instanceof Error ? streamError.message : 'Streaming error'
              );
        yield {
          id: String(Date.now()),
          event: 'error',
          data: JSON.stringify(toHTTPError(a2aError)),
        };
      }
    }

    return createSSEResponse(sseGenerator(), { headers: getExtensionsHeaders(context) });
  };

  // Define routes
  const routes: RestRoute[] = [
    // GET /v1/card
    {
      method: 'GET',
      pattern: '/v1/card',
      handler: async (_req, _params, context) => {
        const result = await restTransportHandler.getAuthenticatedExtendedAgentCard();
        return respond(HTTP_STATUS.OK, context, result);
      },
    },
    // POST /v1/message:send
    {
      method: 'POST',
      pattern: '/v1/message:send',
      handler: async (req, _params, context) => {
        const body = await parseJsonBody<MessageSendParamsInput>(req);
        if (!body) throw A2AError.parseError('Invalid JSON payload');
        const result = await restTransportHandler.sendMessage(body, context);
        return respond(HTTP_STATUS.CREATED, context, result);
      },
    },
    // POST /v1/message:stream
    {
      method: 'POST',
      pattern: '/v1/message:stream',
      handler: async (req, _params, context, _log) => {
        const body = await parseJsonBody<MessageSendParamsInput>(req);
        if (!body) throw A2AError.parseError('Invalid JSON payload');
        const stream = await restTransportHandler.sendMessageStream(body, context);
        return streamResponse(stream, context, { path: '/v1/message:stream' });
      },
    },
    // GET /v1/tasks/:taskId
    {
      method: 'GET',
      pattern: '/v1/tasks/:taskId',
      handler: async (req, params, context) => {
        const url = new URL(req.url);
        const historyLength = url.searchParams.get('historyLength') ?? undefined;
        const result = await restTransportHandler.getTask(params.taskId, context, historyLength);
        return respond(HTTP_STATUS.OK, context, result);
      },
    },
    // POST /v1/tasks/:taskId:cancel
    {
      method: 'POST',
      pattern: '/v1/tasks/:taskId:cancel',
      handler: async (_req, params, context) => {
        const result = await restTransportHandler.cancelTask(params.taskId, context);
        return respond(HTTP_STATUS.ACCEPTED, context, result);
      },
    },
    // POST /v1/tasks/:taskId:subscribe
    {
      method: 'POST',
      pattern: '/v1/tasks/:taskId:subscribe',
      handler: async (_req, params, context, _log) => {
        const stream = await restTransportHandler.resubscribe(params.taskId, context);
        return streamResponse(stream, context, {
          path: `/v1/tasks/${params.taskId}:subscribe`,
          taskId: params.taskId,
        });
      },
    },
    // POST /v1/tasks/:taskId/pushNotificationConfigs
    {
      method: 'POST',
      pattern: '/v1/tasks/:taskId/pushNotificationConfigs',
      handler: async (req, params, context) => {
        const body = await parseJsonBody<TaskPushNotificationConfigInput>(req);
        if (!body) throw A2AError.parseError('Invalid JSON payload');
        // Ensure taskId from URL params is set on the config.
        // The transport handler's normalizer accepts both camelCase and snake_case,
        // so we set both to ensure compatibility regardless of which format the client used.
        // We use Object.assign to add properties without changing the type.
        Object.assign(body, {
          taskId: params.taskId,
          task_id: params.taskId,
        });
        const result = await restTransportHandler.setTaskPushNotificationConfig(body, context);
        return respond(HTTP_STATUS.CREATED, context, result);
      },
    },
    // GET /v1/tasks/:taskId/pushNotificationConfigs
    {
      method: 'GET',
      pattern: '/v1/tasks/:taskId/pushNotificationConfigs',
      handler: async (_req, params, context) => {
        const result = await restTransportHandler.listTaskPushNotificationConfigs(
          params.taskId,
          context
        );
        return respond(HTTP_STATUS.OK, context, result);
      },
    },
    // GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
    {
      method: 'GET',
      pattern: '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
      handler: async (_req, params, context) => {
        const result = await restTransportHandler.getTaskPushNotificationConfig(
          params.taskId,
          params.configId,
          context
        );
        return respond(HTTP_STATUS.OK, context, result);
      },
    },
    // DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId
    {
      method: 'DELETE',
      pattern: '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
      handler: async (_req, params, context) => {
        await restTransportHandler.deleteTaskPushNotificationConfig(
          params.taskId,
          params.configId,
          context
        );
        return respond(HTTP_STATUS.NO_CONTENT, context);
      },
    },
  ];

  // Request handler that matches routes
  const handleRequest = async (
    request: WebRequest,
    pathname: string
  ): Promise<WebResponse | null> => {
    const method = request.method as 'GET' | 'POST' | 'DELETE';
    const startTime = Date.now();

    for (const route of routes) {
      if (route.method !== method) continue;

      const params = extractPathParams(route.pattern, pathname);
      if (!params) continue;

      const logCtx: LogContext = {
        method,
        path: pathname,
        taskId: params.taskId,
      };

      try {
        logger.debug('REST request received', logCtx);
        const context = await buildContext(request, resolved);
        const response = await route.handler(request, params, context, logger);
        logger.info('REST request completed', {
          ...logCtx,
          statusCode: response.status,
          durationMs: Date.now() - startTime,
        });
        return response;
      } catch (error) {
        logger.error('REST handler error', {
          ...logCtx,
          error: errorToLogContext(error),
          durationMs: Date.now() - startTime,
        });
        const context = new ServerCallContext();
        return handleError(error, context);
      }
    }

    return null; // No matching route
  };

  return { routes, handleRequest };
}

// =============================================================================
// Combined Handler
// =============================================================================

/**
 * Configuration for the combined A2A handler.
 */
export interface A2AHandlerConfig extends EdgeHandlerOptions {
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Path for JSON-RPC endpoint (default: '/') */
  jsonRpcPath?: string;
  /** Path prefix for REST endpoints (default: '') */
  restBasePath?: string;
}

/**
 * Creates a combined handler that routes to agent card, JSON-RPC, or REST handlers.
 * This is the main entry point for framework adapters.
 */
export function createA2AHandler(
  requestHandler: A2ARequestHandler,
  config?: A2AHandlerConfig
): (request: WebRequest) => Promise<WebResponse> {
  const agentCardPath = config?.agentCardPath ?? '/.well-known/agent-card.json';
  const jsonRpcPath = config?.jsonRpcPath ?? '/';
  const restBasePath = config?.restBasePath ?? '';

  const agentCardHandler = createAgentCardHandler(requestHandler, config);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, config);
  const { handleRequest: handleRestRequest } = createRestHandlers(requestHandler, config);

  return async (request: WebRequest): Promise<WebResponse> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Agent card
    if (method === 'GET' && pathname === agentCardPath) {
      return agentCardHandler(request);
    }

    // JSON-RPC
    if (method === 'POST' && pathname === jsonRpcPath) {
      return jsonRpcHandler(request);
    }

    // REST API
    if (restBasePath && pathname.startsWith(restBasePath)) {
      const restPath = pathname.slice(restBasePath.length) || '/';
      const response = await handleRestRequest(request, restPath);
      if (response) return response;
    }

    // Not found
    return jsonResponse({ error: 'Not Found' }, 404);
  };
}
