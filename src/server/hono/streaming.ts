/**
 * Hono-specific streaming utilities for A2A.
 *
 * Provides a StreamConsumer implementation that uses Hono's native `streamSSE`
 * for optimal backpressure handling in edge runtime environments.
 */

import { StreamConsumer, SSEEventData } from '../transports/streaming.js';

/**
 * SSE stream interface compatible with Hono's streamSSE helper.
 * This is a minimal interface - Hono's actual SSEStreamingApi has more methods.
 */
export interface HonoSSEStream {
  writeSSE(event: { id?: string; event?: string; data: string }): Promise<void>;
}

/**
 * Creates a StreamConsumer for Hono's streamSSE.
 * This is an async consumer with proper backpressure support.
 *
 * Hono's `streamSSE` provides:
 * - Backpressure handling (waits for client to consume data)
 * - Native abort signal handling
 * - Proper stream lifecycle management
 *
 * @example
 * ```ts
 * import { streamSSE } from 'hono/streaming';
 * import { createHonoStreamConsumer } from './streaming.js';
 * import { processStream } from '../transports/streaming.js';
 *
 * return streamSSE(c, async (sseStream) => {
 *   const consumer = createHonoStreamConsumer(sseStream, c.req.raw.signal);
 *   await processStream(stream, consumer, { logger, logContext: {} });
 * });
 * ```
 */
export function createHonoStreamConsumer(
  sseStream: HonoSSEStream,
  signal?: AbortSignal
): StreamConsumer {
  let aborted = signal?.aborted ?? false;

  // Listen for abort
  if (signal) {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
  }

  return {
    async write(event: SSEEventData): Promise<void> {
      if (!aborted) {
        // Hono's writeSSE is async and handles backpressure
        await sseStream.writeSSE({
          id: event.id,
          event: event.event,
          data: event.data,
        });
      }
    },
    end(): void {
      // Hono handles stream end automatically
    },
    isWritable(): boolean {
      return !aborted;
    },
  };
}
