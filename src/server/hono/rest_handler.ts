import { Hono, Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { streamSSE } from 'hono/streaming';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { A2AError } from '../error.js';
import {
  RestTransportHandler,
  HTTP_STATUS,
  mapErrorToStatus,
  toHTTPError,
} from '../transports/rest/rest_transport_handler.js';
import { ServerCallContext } from '../context.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { UserBuilder } from './common.js';
import { Extensions } from '../../extensions.js';

/**
 * Converts a number to Hono's ContentfulStatusCode type.
 * This is safe because mapErrorToStatus only returns valid HTTP status codes
 * that have response bodies (not 1xx or 204).
 */
function toContentfulStatusCode(code: number): ContentfulStatusCode {
  // Hono's ContentfulStatusCode excludes 1xx informational and 204 No Content
  // Our HTTP_STATUS values (200, 201, 202, 400, 401, 404, 409, 500, 501) are all valid
  return code as ContentfulStatusCode;
}

/**
 * Options for configuring the HTTP+JSON/REST handler.
 */
export interface RestHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder?: UserBuilder;
}

/**
 * Creates Hono routes to handle A2A HTTP+JSON/REST requests.
 *
 * This handler implements the A2A REST API specification with snake_case
 * field names, providing endpoints for:
 * - Agent card retrieval (GET /v1/card)
 * - Message sending with optional streaming (POST /v1/message:send|stream)
 * - Task management (GET/POST /v1/tasks/:taskId:cancel|subscribe)
 * - Push notification configuration
 *
 * The handler acts as an adapter layer, converting between REST format
 * (snake_case) at the API boundary and internal TypeScript format (camelCase)
 * for business logic.
 *
 * @param options - Configuration options including the request handler
 * @returns Hono app configured with all A2A REST endpoints
 *
 * @example
 * ```ts
 * const app = new Hono();
 * const requestHandler = new DefaultRequestHandler(...);
 * app.route('/api/rest', restHandler({ requestHandler }));
 * ```
 */
export function restHandler(options: RestHandlerOptions): Hono {
  const app = new Hono();
  const restTransportHandler = new RestTransportHandler(options.requestHandler);
  const userBuilder = options.userBuilder ?? UserBuilder.noAuthentication;

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Builds a ServerCallContext from the Hono context.
   * Extracts protocol extensions from headers and builds user from request.
   */
  const buildContext = async (c: Context): Promise<ServerCallContext> => {
    const user = await userBuilder(c);
    return new ServerCallContext(
      Extensions.parseServiceParameter(c.req.header(HTTP_EXTENSION_HEADER)),
      user
    );
  };

  /**
   * Sets activated extensions header in the response if any extensions were activated.
   */
  const setExtensionsHeader = (c: Context, context: ServerCallContext): void => {
    if (context.activatedExtensions) {
      c.header(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions).join(', '));
    }
  };

  /**
   * Sends a JSON response with the specified status code.
   */
  const sendResponse = (
    c: Context,
    statusCode: number,
    context: ServerCallContext,
    body?: unknown
  ): Response => {
    setExtensionsHeader(c, context);
    if (statusCode === HTTP_STATUS.NO_CONTENT) {
      return c.body(null, 204);
    }
    return c.json(body, toContentfulStatusCode(statusCode));
  };

  /**
   * Sends a Server-Sent Events (SSE) stream response.
   */
  const sendStreamResponse = async (
    c: Context,
    stream: AsyncGenerator<unknown, void, undefined>,
    context: ServerCallContext
  ): Promise<Response> => {
    // Get first event before flushing headers to catch early errors
    const iterator = stream[Symbol.asyncIterator]();
    let firstResult: IteratorResult<unknown>;
    try {
      firstResult = await iterator.next();
    } catch (error) {
      // Early error - return proper HTTP error
      const a2aError =
        error instanceof A2AError
          ? error
          : A2AError.internalError(error instanceof Error ? error.message : 'Streaming error');
      const statusCode = mapErrorToStatus(a2aError.code);
      return sendResponse(c, statusCode, context, toHTTPError(a2aError));
    }

    // First event succeeded - now stream
    setExtensionsHeader(c, context);

    return streamSSE(c, async (sseStream) => {
      try {
        // Write first event
        if (!firstResult.done) {
          await sseStream.writeSSE({
            id: String(Date.now()),
            data: JSON.stringify(firstResult.value),
          });
        }
        // Continue with remaining events
        for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
          await sseStream.writeSSE({
            id: String(Date.now()),
            data: JSON.stringify(event),
          });
        }
      } catch (streamError: unknown) {
        console.error('SSE streaming error:', streamError);
        const a2aError =
          streamError instanceof A2AError
            ? streamError
            : A2AError.internalError(
                streamError instanceof Error ? streamError.message : 'Streaming error'
              );
        await sseStream.writeSSE({
          id: String(Date.now()),
          event: 'error',
          data: JSON.stringify(toHTTPError(a2aError)),
        });
      }
    });
  };

  /**
   * Handles errors by converting them to A2A error format.
   */
  const handleError = (c: Context, error: unknown): Response => {
    const a2aError =
      error instanceof A2AError
        ? error
        : A2AError.internalError(error instanceof Error ? error.message : 'Internal server error');
    const statusCode = mapErrorToStatus(a2aError.code);
    return c.json(toHTTPError(a2aError), toContentfulStatusCode(statusCode));
  };

  // ============================================================================
  // Route Handlers
  // ============================================================================

  /**
   * GET /v1/card
   * Retrieves the authenticated extended agent card.
   */
  app.get('/v1/card', async (c) => {
    try {
      const context = await buildContext(c);
      const result = await restTransportHandler.getAuthenticatedExtendedAgentCard();
      return sendResponse(c, HTTP_STATUS.OK, context, result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * POST /v1/message:send
   * Sends a message to the agent synchronously.
   */
  app.post('/v1/message\\:send', async (c) => {
    try {
      const context = await buildContext(c);
      const body = await c.req.json();
      const result = await restTransportHandler.sendMessage(body, context);
      return sendResponse(c, HTTP_STATUS.CREATED, context, result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * POST /v1/message:stream
   * Sends a message to the agent with streaming response.
   */
  app.post('/v1/message\\:stream', async (c) => {
    try {
      const context = await buildContext(c);
      const body = await c.req.json();
      const stream = await restTransportHandler.sendMessageStream(body, context);
      return await sendStreamResponse(c, stream, context);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * GET /v1/tasks/:taskId
   * Retrieves the current status and details of a task.
   */
  app.get('/v1/tasks/:taskId', async (c) => {
    try {
      const context = await buildContext(c);
      const taskId = c.req.param('taskId');
      const historyLength = c.req.query('historyLength');
      const result = await restTransportHandler.getTask(taskId, context, historyLength);
      return sendResponse(c, HTTP_STATUS.OK, context, result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * POST /v1/tasks/:taskId:cancel
   * Attempts to cancel an ongoing task.
   */
  app.post('/v1/tasks/:taskId\\:cancel', async (c) => {
    try {
      const context = await buildContext(c);
      const taskId = c.req.param('taskId');
      const result = await restTransportHandler.cancelTask(taskId, context);
      return sendResponse(c, HTTP_STATUS.ACCEPTED, context, result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * POST /v1/tasks/:taskId:subscribe
   * Resubscribes to an existing task's updates via SSE.
   */
  app.post('/v1/tasks/:taskId\\:subscribe', async (c) => {
    try {
      const context = await buildContext(c);
      const taskId = c.req.param('taskId');
      const stream = await restTransportHandler.resubscribe(taskId, context);
      return await sendStreamResponse(c, stream, context);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * POST /v1/tasks/:taskId/pushNotificationConfigs
   * Creates a push notification configuration for a task.
   */
  app.post('/v1/tasks/:taskId/pushNotificationConfigs', async (c) => {
    try {
      const context = await buildContext(c);
      const taskId = c.req.param('taskId');
      const body = await c.req.json();
      const config = {
        ...body,
        taskId: taskId,
        task_id: taskId,
      };
      const result = await restTransportHandler.setTaskPushNotificationConfig(config, context);
      return sendResponse(c, HTTP_STATUS.CREATED, context, result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs
   * Lists all push notification configurations for a task.
   */
  app.get('/v1/tasks/:taskId/pushNotificationConfigs', async (c) => {
    try {
      const context = await buildContext(c);
      const taskId = c.req.param('taskId');
      const result = await restTransportHandler.listTaskPushNotificationConfigs(taskId, context);
      return sendResponse(c, HTTP_STATUS.OK, context, result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * GET /v1/tasks/:taskId/pushNotificationConfigs/:configId
   * Retrieves a specific push notification configuration.
   */
  app.get('/v1/tasks/:taskId/pushNotificationConfigs/:configId', async (c) => {
    try {
      const context = await buildContext(c);
      const taskId = c.req.param('taskId');
      const configId = c.req.param('configId');
      const result = await restTransportHandler.getTaskPushNotificationConfig(
        taskId,
        configId,
        context
      );
      return sendResponse(c, HTTP_STATUS.OK, context, result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId
   * Deletes a push notification configuration.
   */
  app.delete('/v1/tasks/:taskId/pushNotificationConfigs/:configId', async (c) => {
    try {
      const context = await buildContext(c);
      const taskId = c.req.param('taskId');
      const configId = c.req.param('configId');
      await restTransportHandler.deleteTaskPushNotificationConfig(taskId, configId, context);
      return sendResponse(c, HTTP_STATUS.NO_CONTENT, context);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
