import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { JSONRPCErrorResponse, JSONRPCSuccessResponse, JSONRPCResponse } from "../../types.js";
import { A2AError } from "../error.js";
import { A2ARequestHandler } from "../request_handler/a2a_request_handler.js";
import { JsonRpcTransportHandler } from "../transports/jsonrpc_transport_handler.js";

export interface JsonRpcHandlerOptions {
    requestHandler: A2ARequestHandler;
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

    app.post("/", async (c) => {
        let body: any;
        let requestId: string | number | null = null;
        
        try {
            body = await c.req.json();
            requestId = body?.id ?? null;
            const rpcResponseOrStream = await jsonRpcTransportHandler.handle(body);

            // Check if it's an AsyncGenerator (stream)
            if (typeof (rpcResponseOrStream as any)?.[Symbol.asyncIterator] === 'function') {
                const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCSuccessResponse, void, undefined>;

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
                    } catch (streamError: any) {
                        console.error(`Error during SSE streaming (request ${body?.id}):`, streamError);
                        // If the stream itself throws an error, send a final JSONRPCErrorResponse
                        const a2aError = streamError instanceof A2AError 
                            ? streamError 
                            : A2AError.internalError(streamError.message || 'Streaming error.');
                        const errorResponse: JSONRPCErrorResponse = {
                            jsonrpc: '2.0',
                            id: body?.id || null,
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
                // Single JSON-RPC response
                const rpcResponse = rpcResponseOrStream as JSONRPCResponse;
                return c.json(rpcResponse, 200);
            }
        } catch (error: any) {
            // Catch errors from jsonRpcTransportHandler.handle itself or JSON parsing
            console.error("Unhandled error in JSON-RPC POST handler:", error);
            
            // Handle JSON parse errors specifically
            if (error instanceof SyntaxError || error.name === 'SyntaxError') {
                const a2aError = A2AError.parseError('Invalid JSON payload.');
                const errorResponse: JSONRPCErrorResponse = {
                    jsonrpc: '2.0',
                    id: null,
                    error: a2aError.toJSONRPCError(),
                };
                return c.json(errorResponse, 400);
            }
            
            const a2aError = error instanceof A2AError 
                ? error 
                : A2AError.internalError('General processing error.');
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

