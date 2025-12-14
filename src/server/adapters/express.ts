/**
 * Express Adapter for A2A Server
 *
 * Provides Express.js integration using the web-standard core handlers.
 * This adapter bridges the Express Request/Response model to the web-standard
 * Request/Response model, allowing Express apps to use the same core logic
 * as edge runtime deployments.
 *
 * For maximum compatibility with existing Express apps, consider using the
 * original Express handlers from '@drew-foxall/a2a-js-sdk/server/express' which
 * provide native Express integration without the web-standard bridge.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createExpressA2ARouter, JsonLogger } from '@drew-foxall/a2a-js-sdk/server/adapters/express';
 *
 * const app = express();
 * const a2aRouter = createExpressA2ARouter(requestHandler, {
 *   logger: JsonLogger.create(),
 *   enableRest: true,
 * });
 *
 * app.use('/a2a', a2aRouter);
 * app.listen(3000);
 * ```
 */

import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  Router,
  RequestHandler,
  ErrorRequestHandler,
  NextFunction,
} from 'express';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { A2AError } from '../error.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import {
  RestTransportHandler,
  HTTP_STATUS,
  mapErrorToStatus,
  toHTTPError,
} from '../transports/rest/rest_transport_handler.js';
import { ServerCallContext } from '../context.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { Extensions } from '../../extensions.js';
import { User, UnauthenticatedUser } from '../authentication/user.js';
import { JSONRPCErrorResponse, JSONRPCSuccessResponse } from '../../types.js';
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../sse_utils.js';
import { Logger, ConsoleLogger, LogContext } from '../core/logger.js';
import { processStream, StreamConsumer, AGENT_CARD_ROUTE } from '../core/index.js';

/**
 * Express-specific options for the A2A adapter.
 */
export interface ExpressA2AOptions {
  /** Logger instance for request/error logging */
  logger?: Logger;
  /** Function to extract user from Express request */
  userBuilder?: UserBuilder;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Type alias for Express UserBuilder.
 */
export type UserBuilder = (req: ExpressRequest) => Promise<User>;

/**
 * UserBuilder factory with common authentication patterns.
 */
export const UserBuilder = {
  /**
   * Returns an unauthenticated user for all requests.
   */
  noAuthentication: (): UserBuilder => () => Promise.resolve(new UnauthenticatedUser()),
};

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
 * Creates an Express router with A2A endpoints.
 *
 * This implementation uses the transport handlers directly (like the original Express
 * implementation) rather than bridging through web-standard Request/Response, ensuring
 * full compatibility with Express's streaming and error handling capabilities.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Express router with A2A endpoints
 */
export function createExpressA2ARouter(
  requestHandler: A2ARequestHandler,
  options?: ExpressA2AOptions
): Router {
  // Dynamic import to avoid requiring express at module load time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const router: Router = express.Router();

  const logger = options?.logger ?? ConsoleLogger.create();
  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';
  const userBuilder = options?.userBuilder ?? UserBuilder.noAuthentication();

  // Transport handlers
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
  const restTransportHandler = new RestTransportHandler(requestHandler);

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Builds a ServerCallContext from the Express request.
   */
  const buildContext = async (req: ExpressRequest): Promise<ServerCallContext> => {
    const user = await userBuilder(req);
    return new ServerCallContext(
      Extensions.parseServiceParameter(req.header(HTTP_EXTENSION_HEADER)),
      user ?? new UnauthenticatedUser()
    );
  };

  /**
   * Sets activated extensions header in the response.
   */
  const setExtensionsHeader = (res: ExpressResponse, context: ServerCallContext): void => {
    if (context.activatedExtensions && context.activatedExtensions.length > 0) {
      res.setHeader(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions));
    }
  };

  /**
   * Sends a JSON response with proper status and headers.
   */
  const sendResponse = (
    res: ExpressResponse,
    statusCode: number,
    context: ServerCallContext,
    body?: unknown
  ): void => {
    setExtensionsHeader(res, context);
    res.status(statusCode);
    if (statusCode === HTTP_STATUS.NO_CONTENT) {
      res.end();
    } else {
      res.json(body);
    }
  };

  /**
   * Sends an SSE stream response with proper error handling.
   * Uses the portable processStream from core with Express-specific consumer.
   */
  const sendStreamResponse = async (
    res: ExpressResponse,
    stream: AsyncGenerator<unknown, void, undefined>,
    context: ServerCallContext,
    logCtx: LogContext
  ): Promise<void> => {
    // Create Express-compatible stream consumer using sse_utils format
    const consumer: StreamConsumer = {
      write(event) {
        // Use sse_utils format (no IDs) for backwards compatibility
        if (event.event === 'error') {
          res.write(formatSSEErrorEvent(JSON.parse(event.data)));
        } else {
          res.write(formatSSEEvent(JSON.parse(event.data)));
        }
      },
      end() {
        if (!res.writableEnded) {
          res.end();
        }
      },
      isWritable() {
        return !res.writableEnded;
      },
    };

    // Process stream using core utility
    const result = await processStream(stream, consumer, {
      logger,
      logContext: logCtx,
      includeIds: false, // Express original doesn't use IDs
      // Set headers when first event succeeds (before streaming continues)
      onStreamStart: () => {
        Object.entries(SSE_HEADERS).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        setExtensionsHeader(res, context);
        res.flushHeaders();
      },
    });

    // Handle early errors
    if (result.earlyError && result.statusCode && result.errorBody) {
      sendResponse(res, result.statusCode, context, result.errorBody);
    }
  };

  /**
   * Handles errors with proper headersSent checks.
   */
  const handleError = (
    res: ExpressResponse,
    error: unknown,
    _requestId: string | number | null = null
  ): void => {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
    const a2aError =
      error instanceof A2AError
        ? error
        : A2AError.internalError(error instanceof Error ? error.message : 'Internal server error');
    const statusCode = mapErrorToStatus(a2aError.code);
    res.status(statusCode).json(toHTTPError(a2aError));
  };

  /**
   * Handles JSON-RPC errors with request ID preservation.
   */
  const handleJsonRpcError = (
    res: ExpressResponse,
    error: unknown,
    requestId: string | number | null = null
  ): void => {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
    const a2aError =
      error instanceof A2AError ? error : A2AError.internalError('General processing error.');
    const errorResponse: JSONRPCErrorResponse = {
      jsonrpc: '2.0',
      id: requestId,
      error: a2aError.toJSONRPCError(),
    };
    res.status(500).json(errorResponse);
  };

  // ==========================================================================
  // Error Handlers
  // ==========================================================================

  const jsonErrorHandler: ErrorRequestHandler = (
    err: unknown,
    _req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
  ) => {
    if (err instanceof SyntaxError && 'body' in err) {
      const a2aError = A2AError.parseError('Invalid JSON payload.');
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: a2aError.toJSONRPCError(),
      };
      return res.status(400).json(errorResponse);
    }
    next(err);
  };

  // ==========================================================================
  // Routes
  // ==========================================================================

  router.use(express.json(), jsonErrorHandler);

  // Agent card endpoint
  router.get(agentCardPath, async (req: ExpressRequest, res: ExpressResponse) => {
    const startTime = Date.now();
    const logCtx: LogContext = { method: 'GET', path: agentCardPath };

    try {
      logger.debug('Agent card request received', logCtx);
      const agentCard = await requestHandler.getAgentCard();
      logger.info('Agent card served', { ...logCtx, durationMs: Date.now() - startTime });
      res.json(agentCard);
    } catch (error) {
      logger.error('Agent card handler error', {
        ...logCtx,
        error: errorToLogContext(error),
        durationMs: Date.now() - startTime,
      });
      res.status(500).json({ error: 'Failed to retrieve agent card' });
    }
  });

  // JSON-RPC endpoint
  router.post('/', async (req: ExpressRequest, res: ExpressResponse) => {
    const startTime = Date.now();
    const requestId = req.body?.id ?? null;
    const logCtx: LogContext = { method: 'POST', path: '/', requestId: requestId?.toString() };

    try {
      const context = await buildContext(req);
      logger.debug('JSON-RPC request received', logCtx);

      const rpcResponseOrStream = await jsonRpcTransportHandler.handle(req.body, context);
      setExtensionsHeader(res, context);

      // Check if it's an AsyncGenerator (stream)
      if (isAsyncGenerator<JSONRPCSuccessResponse>(rpcResponseOrStream)) {
        const stream = rpcResponseOrStream;
        logger.debug('Starting SSE stream', logCtx);

        // Set SSE headers
        Object.entries(SSE_HEADERS).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        res.flushHeaders();

        try {
          for await (const event of stream) {
            res.write(formatSSEEvent(event));
          }
        } catch (streamError) {
          logger.error('SSE streaming error', { ...logCtx, error: errorToLogContext(streamError) });
          const a2aError =
            streamError instanceof A2AError
              ? streamError
              : A2AError.internalError(
                  (streamError instanceof Error && streamError.message) || 'Streaming error.'
                );
          const errorResponse: JSONRPCErrorResponse = {
            jsonrpc: '2.0',
            id: requestId,
            error: a2aError.toJSONRPCError(),
          };
          if (!res.headersSent) {
            res.status(500).json(errorResponse);
          } else {
            res.write(formatSSEErrorEvent(errorResponse));
          }
        } finally {
          if (!res.writableEnded) {
            res.end();
          }
        }
      } else {
        // Single JSON-RPC response - at this point we know it's not an AsyncGenerator
        const rpcResponse = rpcResponseOrStream;
        logger.info('JSON-RPC request completed', {
          ...logCtx,
          durationMs: Date.now() - startTime,
        });
        res.status(200).json(rpcResponse);
      }
    } catch (error) {
      logger.error('JSON-RPC handler error', {
        ...logCtx,
        error: errorToLogContext(error),
        durationMs: Date.now() - startTime,
      });
      handleJsonRpcError(res, error, requestId);
    }
  });

  // ==========================================================================
  // REST API Endpoints (optional)
  // ==========================================================================

  if (options?.enableRest) {
    /**
     * Wraps an async route handler with error handling.
     */
    const asyncHandler = (
      handler: (req: ExpressRequest, res: ExpressResponse) => Promise<void>
    ): RequestHandler => {
      return async (req: ExpressRequest, res: ExpressResponse, _next: NextFunction) => {
        try {
          await handler(req, res);
        } catch (error) {
          handleError(res, error);
        }
      };
    };

    // GET /rest/v1/card
    router.get(
      `${restBasePath}/v1/card`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const result = await restTransportHandler.getAuthenticatedExtendedAgentCard();
        sendResponse(res, HTTP_STATUS.OK, context, result);
      })
    );

    // POST /rest/v1/message:send
    router.post(
      `${restBasePath}/v1/message\\:send`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const result = await restTransportHandler.sendMessage(req.body, context);
        sendResponse(res, HTTP_STATUS.CREATED, context, result);
      })
    );

    // POST /rest/v1/message:stream
    router.post(
      `${restBasePath}/v1/message\\:stream`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const stream = await restTransportHandler.sendMessageStream(req.body, context);
        await sendStreamResponse(res, stream, context, {
          path: `${restBasePath}/v1/message:stream`,
        });
      })
    );

    // GET /rest/v1/tasks/:taskId
    router.get(
      `${restBasePath}/v1/tasks/:taskId`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const result = await restTransportHandler.getTask(
          req.params.taskId,
          context,
          req.query.historyLength as string | undefined
        );
        sendResponse(res, HTTP_STATUS.OK, context, result);
      })
    );

    // POST /rest/v1/tasks/:taskId:cancel
    router.post(
      `${restBasePath}/v1/tasks/:taskId\\:cancel`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const result = await restTransportHandler.cancelTask(req.params.taskId, context);
        sendResponse(res, HTTP_STATUS.ACCEPTED, context, result);
      })
    );

    // POST /rest/v1/tasks/:taskId:subscribe
    router.post(
      `${restBasePath}/v1/tasks/:taskId\\:subscribe`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const stream = await restTransportHandler.resubscribe(req.params.taskId, context);
        await sendStreamResponse(res, stream, context, {
          path: `${restBasePath}/v1/tasks/${req.params.taskId}:subscribe`,
          taskId: req.params.taskId,
        });
      })
    );

    // POST /rest/v1/tasks/:taskId/pushNotificationConfigs
    router.post(
      `${restBasePath}/v1/tasks/:taskId/pushNotificationConfigs`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const config = {
          ...req.body,
          taskId: req.params.taskId,
          task_id: req.params.taskId,
        };
        const result = await restTransportHandler.setTaskPushNotificationConfig(config, context);
        sendResponse(res, HTTP_STATUS.CREATED, context, result);
      })
    );

    // GET /rest/v1/tasks/:taskId/pushNotificationConfigs
    router.get(
      `${restBasePath}/v1/tasks/:taskId/pushNotificationConfigs`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const result = await restTransportHandler.listTaskPushNotificationConfigs(
          req.params.taskId,
          context
        );
        sendResponse(res, HTTP_STATUS.OK, context, result);
      })
    );

    // GET /rest/v1/tasks/:taskId/pushNotificationConfigs/:configId
    router.get(
      `${restBasePath}/v1/tasks/:taskId/pushNotificationConfigs/:configId`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        const result = await restTransportHandler.getTaskPushNotificationConfig(
          req.params.taskId,
          req.params.configId,
          context
        );
        sendResponse(res, HTTP_STATUS.OK, context, result);
      })
    );

    // DELETE /rest/v1/tasks/:taskId/pushNotificationConfigs/:configId
    router.delete(
      `${restBasePath}/v1/tasks/:taskId/pushNotificationConfigs/:configId`,
      asyncHandler(async (req, res) => {
        const context = await buildContext(req);
        await restTransportHandler.deleteTaskPushNotificationConfig(
          req.params.taskId,
          req.params.configId,
          context
        );
        sendResponse(res, HTTP_STATUS.NO_CONTENT, context);
      })
    );
  }

  return router;
}

// For core utilities (Logger, routes, streaming), import directly from '@a2a/server/core'
