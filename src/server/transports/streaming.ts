/**
 * Streaming Utilities for A2A
 *
 * Provides portable streaming abstractions that work across different runtimes.
 * The core abstraction is the StreamConsumer which can be implemented for
 * different output targets (Express res.write, Web ReadableStream, Hono streamSSE, etc.)
 *
 * The interface supports both sync and async writes to enable backpressure handling
 * in frameworks that support it (like Hono's streamSSE).
 */

import { A2AError } from '../error.js';
import {
  mapErrorToStatus,
  toHTTPError,
  RestHttpStatusCode,
} from './rest/rest_transport_handler.js';
import { Logger, LogContext } from '../logging/logger.js';
import { SSEEventData, sseEventToString } from '../../sse_utils.js';

// Re-export SSEEventData for framework-specific streaming implementations
export type { SSEEventData } from '../../sse_utils.js';

/**
 * HTTP error response body format.
 */
export interface HTTPError {
  readonly code: number;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

// =============================================================================
// Stream Consumer Interface
// =============================================================================

/**
 * Interface for consuming SSE events.
 * Implemented by different adapters for their specific output mechanism.
 *
 * The write method can return a Promise to support backpressure handling.
 * When write returns a Promise, the stream processor will await it before
 * continuing, allowing frameworks like Hono to apply backpressure.
 *
 * @example
 * ```ts
 * // Sync consumer (Express, basic ReadableStream)
 * const consumer: StreamConsumer = {
 *   write: (event) => res.write(formatEvent(event)),
 *   end: () => res.end(),
 *   isWritable: () => !res.writableEnded,
 * };
 *
 * // Async consumer with backpressure (Hono streamSSE)
 * const consumer: StreamConsumer = {
 *   write: async (event) => await sseStream.writeSSE(event),
 *   end: () => {},  // Hono handles stream end
 *   isWritable: () => !aborted,
 * };
 * ```
 */
export interface StreamConsumer {
  /**
   * Write an SSE event to the output.
   * Can return a Promise to support backpressure - the processor will await it.
   */
  write(event: SSEEventData): void | Promise<void>;
  /** Signal the end of the stream */
  end(): void;
  /** Check if the stream is still writable */
  isWritable(): boolean;
}

/**
 * Result when stream processing succeeds (no early error).
 */
export interface StreamSuccessResult {
  /** No early error occurred */
  readonly earlyError: false;
}

/**
 * Result when an early error occurs before streaming starts.
 */
export interface StreamEarlyErrorResult {
  /** An early error occurred */
  readonly earlyError: true;
  /** The A2A error */
  readonly error: A2AError;
  /** HTTP status code for the error response */
  readonly statusCode: RestHttpStatusCode;
  /** Error body for the HTTP response */
  readonly errorBody: HTTPError;
}

/**
 * Result of stream processing.
 * Discriminated union based on earlyError.
 */
export type StreamResult = StreamSuccessResult | StreamEarlyErrorResult;

// =============================================================================
// Stream Processing
// =============================================================================

/**
 * Options for processing a stream.
 */
export interface ProcessStreamOptions {
  /** Logger for error reporting */
  logger: Logger;
  /** Log context for error messages */
  logContext: LogContext;
  /** Whether to include event IDs (default: true) */
  includeIds?: boolean;
  /** Callback called after first event succeeds, before streaming continues */
  onStreamStart?: () => void;
}

/**
 * Processes an async generator stream, handling errors appropriately.
 * Returns early error info if the first event fails, otherwise streams events.
 *
 * This is the core streaming logic that can be used by any adapter.
 * It supports both sync and async consumers - if write() returns a Promise,
 * it will be awaited to enable backpressure handling.
 *
 * @param stream - The async generator to process
 * @param consumer - The output consumer (Express res, ReadableStream controller, Hono streamSSE, etc.)
 * @param options - Processing options
 * @returns StreamResult indicating success or early error
 */
export async function processStream(
  stream: AsyncGenerator<unknown, void, undefined>,
  consumer: StreamConsumer,
  options: ProcessStreamOptions
): Promise<StreamResult> {
  const { logger, logContext, includeIds = true, onStreamStart } = options;

  // Get first event to catch early errors
  const iterator = stream[Symbol.asyncIterator]();
  let firstResult: IteratorResult<unknown>;

  try {
    firstResult = await iterator.next();
  } catch (error) {
    // Early error - return error info for proper HTTP response
    logger.error('Stream initialization error', {
      ...logContext,
      error: errorToLogContext(error),
    });
    const a2aError =
      error instanceof A2AError
        ? error
        : A2AError.internalError(error instanceof Error ? error.message : 'Streaming error');
    return {
      earlyError: true,
      error: a2aError,
      statusCode: mapErrorToStatus(a2aError.code),
      errorBody: toHTTPError(a2aError),
    };
  }

  // First event succeeded - call onStreamStart (e.g., to set headers)
  if (onStreamStart) {
    onStreamStart();
  }

  // Stream all events
  try {
    // Write first event (await to support backpressure)
    if (!firstResult.done && consumer.isWritable()) {
      await consumer.write(createSSEEvent(firstResult.value, includeIds));
    }

    // Continue with remaining events
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      if (!consumer.isWritable()) break;
      // Await write to support backpressure in async consumers (e.g., Hono streamSSE)
      await consumer.write(createSSEEvent(event, includeIds));
    }
  } catch (streamError) {
    logger.error('SSE streaming error', {
      ...logContext,
      error: errorToLogContext(streamError),
    });
    const a2aError =
      streamError instanceof A2AError
        ? streamError
        : A2AError.internalError(
            streamError instanceof Error ? streamError.message : 'Streaming error'
          );
    // Write error event if still writable
    if (consumer.isWritable()) {
      await consumer.write(createSSEErrorEvent(toHTTPError(a2aError), includeIds));
    }
  } finally {
    consumer.end();
  }

  return { earlyError: false };
}

/**
 * Creates an SSE data event.
 */
export function createSSEEvent(data: unknown, includeId: boolean = true): SSEEventData {
  return {
    id: includeId ? String(Date.now()) : undefined,
    data: JSON.stringify(data),
  };
}

/**
 * Creates an SSE error event.
 */
export function createSSEErrorEvent(error: unknown, includeId: boolean = true): SSEEventData {
  return {
    id: includeId ? String(Date.now()) : undefined,
    event: 'error',
    data: JSON.stringify(error),
  };
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
// Express Stream Consumer
// =============================================================================

/**
 * Creates a StreamConsumer for Express Response.
 * This allows the core streaming logic to work with Express.
 */
export function createExpressStreamConsumer(
  res: { write(chunk: string): boolean; end(): void; writableEnded: boolean },
  formatEvent: (event: SSEEventData) => string = sseEventToString
): StreamConsumer {
  return {
    write(event: SSEEventData): void {
      res.write(formatEvent(event));
    },
    end(): void {
      if (!res.writableEnded) {
        res.end();
      }
    },
    isWritable(): boolean {
      return !res.writableEnded;
    },
  };
}

// =============================================================================
// Web Standard Stream Consumer
// =============================================================================

/**
 * Creates a StreamConsumer for ReadableStream controller.
 * This is a sync consumer - no backpressure support.
 */
export function createWebStreamConsumer(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder = new TextEncoder()
): StreamConsumer {
  let closed = false;
  return {
    write(event: SSEEventData): void {
      if (!closed) {
        controller.enqueue(encoder.encode(sseEventToString(event)));
      }
    },
    end(): void {
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
    isWritable(): boolean {
      return !closed;
    },
  };
}
