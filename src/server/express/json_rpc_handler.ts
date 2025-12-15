import express, {
  Request,
  Response,
  ErrorRequestHandler,
  NextFunction,
  RequestHandler,
} from 'express';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../transports/jsonrpc/jsonrpc_transport_handler.js';
import { HTTP_EXTENSION_HEADER } from '../../constants.js';
import { UnauthenticatedUser } from '../authentication/user.js';
import { UserBuilder } from './common.js';

// Import shared JSON-RPC logic
import { processJsonRpc, extractRequestId } from '../transports/jsonrpc/json_rpc_logic.js';

// Import shared error formatting
import { formatJsonRpcError, formatParseError, formatStreamingError } from '../error.js';

// Import shared SSE formatting
import { SSE_HEADERS, formatSSEEvent, formatSSEErrorEvent } from '../../sse_utils.js';

export interface JsonRpcHandlerOptions {
  requestHandler: A2ARequestHandler;
  userBuilder: UserBuilder;
}

/**
 * Creates Express.js middleware to handle A2A JSON-RPC requests.
 *
 * This handler uses the core JSON-RPC logic for business processing
 * and only implements Express-specific I/O operations.
 *
 * @example
 * ```ts
 * app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
 * ```
 */
export function jsonRpcHandler(options: JsonRpcHandlerOptions): RequestHandler {
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(options.requestHandler);
  const router = express.Router();

  router.use(express.json(), jsonErrorHandler);

  router.post('/', async (req: Request, res: Response) => {
    const requestId = extractRequestId(req.body);

    try {
      // Get user from Express request
      const user = await options.userBuilder(req);

      // Use core logic for processing
      const result = await processJsonRpc(
        {
          body: req.body,
          extensionsHeader: req.header(HTTP_EXTENSION_HEADER) ?? null,
          user: user ?? new UnauthenticatedUser(),
        },
        jsonRpcTransportHandler
      );

      // Set extensions header (Express-specific)
      if (result.extensionsToActivate.length > 0) {
        res.setHeader(HTTP_EXTENSION_HEADER, result.extensionsToActivate);
      }

      if (result.type === 'stream') {
        // Express-specific streaming
        await writeExpressSSEStream(res, result.stream, requestId);
      } else {
        // Express-specific JSON response
        res.status(200).json(result.response);
      }
    } catch (error) {
      // Use core error formatting
      const errorResult = formatJsonRpcError(error, requestId);
      if (!res.headersSent) {
        res.status(errorResult.statusCode).json(errorResult.body);
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}

/**
 * Express-specific SSE stream writing.
 * This is the only Express-specific streaming code.
 */
async function writeExpressSSEStream(
  res: Response,
  stream: AsyncGenerator<unknown, void, undefined>,
  requestId: string | number | null
): Promise<void> {
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
    console.error(`Error during SSE streaming (request ${requestId}):`, streamError);
    // Use core error formatting
    const errorResponse = formatStreamingError(streamError, requestId);
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
}

/**
 * Express error handler for JSON parse errors.
 */
export const jsonErrorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof SyntaxError && 'body' in err) {
    // Use core error formatting
    const errorResult = formatParseError();
    return res.status(errorResult.statusCode).json(errorResult.body);
  }
  next(err);
};
