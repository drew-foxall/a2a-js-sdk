/**
 * Web-Standard Base Handlers for A2A Server
 *
 * These handlers implement the A2A protocol using only web-standard APIs.
 * They can be used directly or wrapped by framework-specific adapters.
 *
 * This module uses the shared logic from:
 * - transports/jsonrpc/json_rpc_logic.ts - JSON-RPC processing
 * - request_handler/agent_card_utils.ts - Agent card handling
 * - error.ts - Error formatting
 * - sse_utils.ts - SSE event formatting
 *
 * ## Pluggable Streaming
 *
 * The handlers support pluggable streaming via the `StreamingStrategy` interface.
 * This allows frameworks with native backpressure support (like Hono's streamSSE)
 * to use their optimized streaming while maintaining a common handler interface.
 */

import { A2AError } from '../error.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import { RestTransportHandler, HTTP_STATUS } from '../transports/rest/rest_transport_handler.js';
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
  ResolvedWebHandlerOptions,
  resolveOptions,
  WebHandlerOptions,
  AgentCardProvider,
  SSEEvent,
  createSSEResponse,
  jsonResponse,
  noContentResponse,
  parseJsonBody,
  extractPathParams,
} from './types.js';
import { Logger, LogContext } from '../logging/logger.js';

// Import shared core logic from new locations
import {
  processJsonRpc,
  extractRequestId,
  JsonRpcInput,
} from '../transports/jsonrpc/json_rpc_logic.js';
import { fetchAgentCard } from '../request_handler/agent_card_utils.js';
import {
  formatJsonRpcError,
  formatParseError,
  formatStreamingError,
  formatRestError,
} from '../error.js';
import { createSSEEventData, createSSEErrorEventData } from '../../sse_utils.js';

// =============================================================================
// Streaming Strategy Interface
// =============================================================================

/**
 * Strategy for creating SSE streaming responses.
 *
 * This interface allows frameworks to provide their own streaming implementation
 * with native backpressure support while using the common handler logic.
 *
 * @example
 * ```ts
 * // Default web-standard strategy (no backpressure)
 * const defaultStrategy: StreamingStrategy = {
 *   createResponse: (generator, options) => createSSEResponse(generator, options),
 * };
 *
 * // Hono strategy with native backpressure
 * const honoStrategy: StreamingStrategy = {
 *   createResponse: (generator, options) => {
 *     return streamSSE(c, async (sseStream) => {
 *       const consumer = createHonoStreamConsumer(sseStream, signal);
 *       // ... process generator with consumer
 *     });
 *   },
 * };
 * ```
 */
export interface StreamingStrategy {
  /**
   * Creates an SSE streaming response from an async generator.
   *
   * @param generator - Async generator yielding SSE events
   * @param options - Response options (headers, signal)
   * @returns Web-standard Response with SSE stream
   */
  createResponse(
    generator: AsyncGenerator<SSEEvent, void, undefined>,
    options?: { headers?: HeadersInit; signal?: AbortSignal }
  ): WebResponse | Promise<WebResponse>;
}

/**
 * Default streaming strategy using web-standard ReadableStream.
 * Works everywhere but does not support backpressure.
 */
export const defaultStreamingStrategy: StreamingStrategy = {
  createResponse: (generator, options) => createSSEResponse(generator, options),
};

// =============================================================================
// Shared Utilities
// =============================================================================

/**
 * Builds a ServerCallContext from a web request.
 * This is specific to web-standard handlers that receive a WebRequest.
 */
async function buildContext(
  request: WebRequest,
  options: ResolvedWebHandlerOptions
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
 * Uses Array.from() to match Express behavior.
 */
function getExtensionsHeaders(context: ServerCallContext): HeadersInit {
  if (context.activatedExtensions && context.activatedExtensions.length > 0) {
    return { [HTTP_EXTENSION_HEADER]: Array.from(context.activatedExtensions).join(', ') };
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
export interface AgentCardHandlerOptions extends WebHandlerOptions {
  /**
   * Provider for agent card data.
   * Can be an A2ARequestHandler, an object with getAgentCard(), or a function.
   */
  agentCardProvider?: AgentCardProvider;
}

/**
 * Creates a web-standard handler for the agent card endpoint.
 *
 * Uses shared fetchAgentCard() logic from request_handler/agent_card_utils.ts.
 */
export function createAgentCardHandler(
  requestHandler: A2ARequestHandler,
  options?: AgentCardHandlerOptions
): (request: WebRequest) => Promise<WebResponse> {
  const resolved = resolveOptions(options);
  const logger = resolved.logger;

  // Support both requestHandler and agentCardProvider
  const provider = options?.agentCardProvider ?? requestHandler;

  return async (request: WebRequest): Promise<WebResponse> => {
    const startTime = Date.now();
    const logCtx: LogContext = {
      method: request.method,
      path: new URL(request.url).pathname,
    };

    logger.debug('Agent card request received', logCtx);

    // Use shared fetchAgentCard logic
    const result = await fetchAgentCard(provider);

    if (result.success === true) {
      logger.info('Agent card served', { ...logCtx, durationMs: Date.now() - startTime });
      return jsonResponse(result.agentCard, 200);
    }

    // Error case - result.success is false, so result has 'error' property
    logger.error('Failed to get agent card', {
      ...logCtx,
      error: { name: 'AgentCardError', message: result.error },
      durationMs: Date.now() - startTime,
    });
    return jsonResponse({ error: result.error }, 500);
  };
}

// =============================================================================
// JSON-RPC Handler
// =============================================================================

/**
 * Options for the JSON-RPC handler.
 */
export interface JsonRpcHandlerOptions extends WebHandlerOptions {
  /**
   * Strategy for creating streaming responses.
   * Defaults to web-standard ReadableStream (no backpressure).
   * Use a framework-specific strategy for native backpressure support.
   */
  streamingStrategy?: StreamingStrategy;
}

/**
 * Creates a web-standard handler for JSON-RPC requests.
 *
 * Uses shared processJsonRpc() logic from transports/jsonrpc/json_rpc_logic.ts.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Handler options including optional streaming strategy
 */
export function createJsonRpcHandler(
  requestHandler: A2ARequestHandler,
  options?: JsonRpcHandlerOptions
): (request: WebRequest) => Promise<WebResponse> {
  const resolved = resolveOptions(options);
  const logger = resolved.logger;
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
  const streamingStrategy = options?.streamingStrategy ?? defaultStreamingStrategy;

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
        const errorResult = formatParseError();
        return jsonResponse(errorResult.body, errorResult.statusCode);
      }

      // Extract request ID using shared logic
      requestId = extractRequestId(body);
      logCtx.requestId = requestId?.toString();

      // Build context with user and extensions
      const user = await resolved.userBuilder(request);
      const extensionsHeader = request.headers.get(HTTP_EXTENSION_HEADER);

      // Prepare input for shared processJsonRpc
      const input: JsonRpcInput = {
        body,
        extensionsHeader,
        user,
      };

      logger.debug('Processing JSON-RPC request', logCtx);

      // Use shared processJsonRpc logic
      const result = await processJsonRpc(input, jsonRpcTransportHandler);
      const extensionsHeaders: HeadersInit =
        result.extensionsToActivate.length > 0
          ? { [HTTP_EXTENSION_HEADER]: result.extensionsToActivate.join(', ') }
          : {};

      // Handle streaming response
      if (result.type === 'stream') {
        logger.debug('Starting SSE stream', logCtx);
        const stream = result.stream; // TypeScript knows this exists because type === 'stream'

        // Convert to SSE events using shared formatters
        async function* sseGenerator(): AsyncGenerator<SSEEvent, void, undefined> {
          try {
            for await (const event of stream) {
              yield createSSEEventData(event);
            }
          } catch (streamError) {
            logger.error('SSE streaming error', {
              ...logCtx,
              error: errorToLogContext(streamError),
            });
            // Use shared formatStreamingError
            const errorResponse = formatStreamingError(streamError, requestId);
            yield createSSEErrorEventData(errorResponse);
          }
        }

        // Use pluggable streaming strategy
        return streamingStrategy.createResponse(sseGenerator(), {
          headers: extensionsHeaders,
          signal: request.signal,
        });
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

      // Use shared formatJsonRpcError
      const errorResult = formatJsonRpcError(error, requestId);
      return jsonResponse(errorResult.body, errorResult.statusCode);
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
 * Options for the REST handlers.
 */
export interface RestHandlerOptions extends WebHandlerOptions {
  /**
   * Strategy for creating streaming responses.
   * Defaults to web-standard ReadableStream (no backpressure).
   * Use a framework-specific strategy for native backpressure support.
   */
  streamingStrategy?: StreamingStrategy;
}

/**
 * Creates web-standard handlers for REST API endpoints.
 *
 * Uses shared error formatting from error.ts.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Handler options including optional streaming strategy
 */
export function createRestHandlers(
  requestHandler: A2ARequestHandler,
  options?: RestHandlerOptions
): {
  routes: RestRoute[];
  handleRequest: (request: WebRequest, pathname: string) => Promise<WebResponse | null>;
} {
  const resolved = resolveOptions(options);
  const logger = resolved.logger;
  const restTransportHandler = new RestTransportHandler(requestHandler);
  const streamingStrategy = options?.streamingStrategy ?? defaultStreamingStrategy;

  // Helper to create response with extensions header
  const respond = (statusCode: number, context: ServerCallContext, body?: unknown): WebResponse => {
    const headers = getExtensionsHeaders(context);
    if (statusCode === HTTP_STATUS.NO_CONTENT) {
      return noContentResponse(headers);
    }
    return jsonResponse(body, statusCode, headers);
  };

  // Helper to handle errors using shared formatRestError
  const handleError = (error: unknown, context: ServerCallContext): WebResponse => {
    const errorResult = formatRestError(error);
    return jsonResponse(errorResult.body, errorResult.statusCode, getExtensionsHeaders(context));
  };

  // Helper for streaming responses using shared SSE formatters and pluggable strategy
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
      const errorResult = formatRestError(error);
      return respond(errorResult.statusCode, context, errorResult.body);
    }

    // Stream events using shared SSE formatters
    async function* sseGenerator(): AsyncGenerator<SSEEvent, void, undefined> {
      try {
        if (!firstResult.done) {
          yield createSSEEventData(firstResult.value);
        }
        for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
          yield createSSEEventData(event);
        }
      } catch (streamError) {
        logger.error('SSE streaming error', {
          ...logCtx,
          error: errorToLogContext(streamError),
        });
        const errorResult = formatRestError(streamError);
        yield createSSEErrorEventData(errorResult.body);
      }
    }

    // Use pluggable streaming strategy
    return streamingStrategy.createResponse(sseGenerator(), {
      headers: getExtensionsHeaders(context),
    });
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
export interface A2AHandlerConfig extends WebHandlerOptions {
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Path for JSON-RPC endpoint (default: '/') */
  jsonRpcPath?: string;
  /** Path prefix for REST endpoints (default: '') */
  restBasePath?: string;
  /**
   * Strategy for creating streaming responses.
   * Defaults to web-standard ReadableStream (no backpressure).
   * Use a framework-specific strategy for native backpressure support.
   */
  streamingStrategy?: StreamingStrategy;
}

/**
 * Creates a combined handler that routes to agent card, JSON-RPC, or REST handlers.
 * This is the main entry point for framework adapters.
 *
 * @param requestHandler - The A2A request handler
 * @param config - Handler configuration including optional streaming strategy
 */
export function createA2AHandler(
  requestHandler: A2ARequestHandler,
  config?: A2AHandlerConfig
): (request: WebRequest) => Promise<WebResponse> {
  const agentCardPath = config?.agentCardPath ?? '/.well-known/agent-card.json';
  const jsonRpcPath = config?.jsonRpcPath ?? '/';
  const restBasePath = config?.restBasePath ?? '';

  const agentCardHandler = createAgentCardHandler(requestHandler, config);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, {
    ...config,
    streamingStrategy: config?.streamingStrategy,
  });
  const { handleRequest: handleRestRequest } = createRestHandlers(requestHandler, {
    ...config,
    streamingStrategy: config?.streamingStrategy,
  });

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

// Re-export shared utilities for convenience
export { isAsyncGenerator, extractRequestId } from '../transports/jsonrpc/json_rpc_logic.js';
export { resolveAgentCardProvider } from '../request_handler/agent_card_utils.js';
