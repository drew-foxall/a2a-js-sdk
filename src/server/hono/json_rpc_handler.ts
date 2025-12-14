import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { JSONRPCErrorResponse, JSONRPCSuccessResponse } from '../../types.js';
import { A2AError } from '../error.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import { ServerCallContext } from '../context.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { Extensions } from '../../extensions.js';
import { UnauthenticatedUser } from '../authentication/user.js';
import { UserBuilder } from './common.js';

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
 * Type guard to check if an error is a SyntaxError.
 */
function isSyntaxError(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError || (error instanceof Error && error.name === 'SyntaxError');
}

export interface JsonRpcHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder?: UserBuilder;
}

/**
 * Creates Hono route to handle A2A JSON-RPC requests.
 * @example
 * // Handle at root
 * app.route('/', jsonRpcHandler({ requestHandler: a2aRequestHandler }));
 * // or
 * app.route('/a2a/json-rpc', jsonRpcHandler({ requestHandler: a2aRequestHandler }));
 */
export function jsonRpcHandler(options: JsonRpcHandlerOptions): Hono {
  const app = new Hono();
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(options.requestHandler);
  const userBuilder = options.userBuilder ?? UserBuilder.noAuthentication;

  app.post('/', async (c) => {
    let body: unknown;
    let requestId: string | number | null = null;

    try {
      body = await c.req.json();
      requestId = (body as { id?: string | number | null })?.id ?? null;
      const user = await userBuilder(c);
      const context = new ServerCallContext(
        Extensions.parseServiceParameter(c.req.header(HTTP_EXTENSION_HEADER)),
        user ?? new UnauthenticatedUser()
      );
      const rpcResponseOrStream = await jsonRpcTransportHandler.handle(body, context);

      if (context.activatedExtensions) {
        // Hono's c.header joins array values with ', ' automatically, matching Express behavior
        c.header(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions).join(', '));
      }

      // Check if it's an AsyncGenerator (stream)
      if (isAsyncGenerator<JSONRPCSuccessResponse>(rpcResponseOrStream)) {
        const stream = rpcResponseOrStream;

        return streamSSE(c, async (sseStream) => {
          // Create a deferred promise to control stream lifecycle
          let resolveStream: () => void;
          const streamLifetime = new Promise<void>((resolve) => {
            resolveStream = resolve;
          });

          // Handle client abort
          const abortHandler = () => {
            console.log('Client disconnected, aborting stream...');
            resolveStream();
          };

          // Listen for abort signal from the client
          c.req.raw.signal.addEventListener('abort', abortHandler);

          try {
            for await (const event of stream) {
              // Write SSE event
              await sseStream.writeSSE({
                id: String(new Date().getTime()),
                data: JSON.stringify(event),
              });
            }
          } catch (streamError: unknown) {
            console.error(`Error during SSE streaming (request ${requestId}):`, streamError);
            // If the stream itself throws an error, send a final JSONRPCErrorResponse
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
            await sseStream.writeSSE({
              id: String(new Date().getTime()),
              event: 'error',
              data: JSON.stringify(errorResponse),
            });
          } finally {
            // Clean up abort listener
            c.req.raw.signal.removeEventListener('abort', abortHandler);
            resolveStream();
          }

          // Keep the stream alive until completion
          await streamLifetime;
        });
      } else {
        // Single JSON-RPC response - at this point we know it's not an AsyncGenerator
        const rpcResponse = rpcResponseOrStream;
        return c.json(rpcResponse, 200);
      }
    } catch (error: unknown) {
      // Catch errors from jsonRpcTransportHandler.handle itself or JSON parsing
      console.error('Unhandled error in JSON-RPC POST handler:', error);

      // Handle JSON parse errors specifically
      if (isSyntaxError(error)) {
        const a2aError = A2AError.parseError('Invalid JSON payload.');
        const errorResponse: JSONRPCErrorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: a2aError.toJSONRPCError(),
        };
        return c.json(errorResponse, 400);
      }

      const a2aError =
        error instanceof A2AError ? error : A2AError.internalError('General processing error.');
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: requestId,
        error: a2aError.toJSONRPCError(),
      };
      return c.json(errorResponse, 500);
    }
  });

  return app;
}
