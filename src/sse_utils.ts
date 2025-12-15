/**
 * Shared Server-Sent Events (SSE) utilities for both JSON-RPC and REST transports.
 * This module provides common SSE formatting functions and headers.
 */

// ============================================================================
// SSE Headers
// ============================================================================

/**
 * Standard HTTP headers for Server-Sent Events (SSE) streaming responses.
 * These headers ensure proper SSE behavior across different proxies and clients.
 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no', // Disable buffering in nginx
} as const;

// ============================================================================
// SSE Event Formatting
// ============================================================================

/**
 * Formats a data event for Server-Sent Events (SSE) protocol.
 * Creates a standard SSE event with an ID and JSON-stringified data.
 *
 * @param event - The event data to send (will be JSON stringified)
 * @returns Formatted SSE event string following the SSE specification
 *
 * @example
 * ```ts
 * formatSSEEvent({ kind: 'message', text: 'Hello' })
 * // Returns: "data: {\"kind\":\"message\",\"text\":\"Hello\"}\n\n"
 *
 * formatSSEEvent({ result: 'success' }, 'custom-id')
 * // Returns: "data: {\"result\":\"success\"}\n\n"
 * ```
 */
export function formatSSEEvent(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Formats an error event for Server-Sent Events (SSE) protocol.
 * Error events use the "error" event type to distinguish them from data events,
 * allowing clients to handle errors differently.
 *
 * @param error - The error object (will be JSON stringified)
 * @returns Formatted SSE error event string with custom event type
 *
 * @example
 * ```ts
 * formatSSEErrorEvent({ code: -32603, message: 'Internal error' })
 * // Returns: "event: error\ndata: {\"code\":-32603,\"message\":\"Internal error\"}\n\n"
 * ```
 */
export function formatSSEErrorEvent(error: unknown): string {
  return `event: error\ndata: ${JSON.stringify(error)}\n\n`;
}

// =============================================================================
// Structured SSE Event Types
// =============================================================================

/**
 * Structured SSE event for frameworks that need it (like Hono's streamSSE).
 * This matches Hono's SSEMessage interface.
 */
export interface SSEEventData {
  /** Event ID (optional, typically a timestamp) */
  id?: string;
  /** Event type (optional, 'error' for errors) */
  event?: string;
  /** JSON-stringified data */
  data: string;
  /** Retry interval in milliseconds (optional) */
  retry?: number;
}

/**
 * Creates a structured SSE event object.
 * Use this for frameworks like Hono that need structured event data.
 *
 * @param data - The data to include in the event
 * @param includeId - Whether to include a timestamp ID (default: true)
 * @returns Structured SSE event object
 */
export function createSSEEventData(data: unknown, includeId: boolean = true): SSEEventData {
  const event: SSEEventData = {
    data: JSON.stringify(data),
  };

  if (includeId) {
    event.id = String(Date.now());
  }

  return event;
}

/**
 * Creates a structured SSE error event object.
 * Use this for frameworks like Hono that need structured event data.
 *
 * @param error - The error data to include
 * @param includeId - Whether to include a timestamp ID (default: true)
 * @returns Structured SSE error event object
 */
export function createSSEErrorEventData(error: unknown, includeId: boolean = true): SSEEventData {
  const event: SSEEventData = {
    event: 'error',
    data: JSON.stringify(error),
  };

  if (includeId) {
    event.id = String(Date.now());
  }

  return event;
}

/**
 * Converts a structured SSE event to a string for raw writing.
 * Use this when you need to write SSE events as raw strings.
 *
 * @param event - The structured SSE event
 * @returns Formatted SSE string
 */
export function sseEventToString(event: SSEEventData): string {
  let result = '';

  if (event.id) {
    result += `id: ${event.id}\n`;
  }

  if (event.event) {
    result += `event: ${event.event}\n`;
  }

  if (event.retry) {
    result += `retry: ${event.retry}\n`;
  }

  result += `data: ${event.data}\n\n`;

  return result;
}
