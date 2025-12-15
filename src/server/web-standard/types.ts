/**
 * Web-Standard Types for A2A Server
 *
 * These types define the web-standard interfaces used by all framework adapters.
 * They are based on the Web Fetch API which is available in all modern edge runtimes.
 */

import { AgentCard } from '../../types.js';
import { User, UnauthenticatedUser } from '../authentication/user.js';
import { Logger, ConsoleLogger } from '../logging/logger.js';

/**
 * Web-standard Request type.
 * Available in browsers, Cloudflare Workers, Deno, Bun, and Node.js 18+.
 */
export type WebRequest = Request;

/**
 * Web-standard Response type.
 */
export type WebResponse = Response;

// =============================================================================
// User Authentication
// =============================================================================

/**
 * Function to build user information from a request.
 * This allows framework-agnostic authentication.
 * Named `UserBuilder` for consistency with Express/Hono APIs.
 *
 * @example
 * ```ts
 * // JWT authentication
 * const userBuilder: UserBuilder = async (req) => {
 *   const token = req.headers.get('Authorization')?.replace('Bearer ', '');
 *   if (!token) return new UnauthenticatedUser();
 *   const payload = await verifyJWT(token);
 *   return { isAuthenticated: true, userName: payload.sub };
 * };
 * ```
 */
export type UserBuilder = (request: WebRequest) => Promise<User>;

/**
 * Default user builder that returns an unauthenticated user.
 */
export const defaultUserBuilder: UserBuilder = () => Promise.resolve(new UnauthenticatedUser());

/**
 * UserBuilder factory with common authentication patterns.
 * Matches the Express/Hono API for consistency.
 */
export const UserBuilder = {
  /**
   * Returns an unauthenticated user for all requests.
   * Use this when no authentication is required.
   */
  noAuthentication: (): UserBuilder => () => Promise.resolve(new UnauthenticatedUser()),
};

// =============================================================================
// Agent Card Provider
// =============================================================================

/**
 * Provider for agent card data.
 * Can be either:
 * - An object with a `getAgentCard()` method (like A2ARequestHandler)
 * - A function that returns a Promise<AgentCard>
 *
 * This matches the Express/Hono API for consistency.
 *
 * @example
 * ```ts
 * // Using A2ARequestHandler
 * createAgentCardHandler({ agentCardProvider: requestHandler });
 *
 * // Using a function
 * createAgentCardHandler({ agentCardProvider: async () => myAgentCard });
 * ```
 */
export type AgentCardProvider = { getAgentCard(): Promise<AgentCard> } | (() => Promise<AgentCard>);

/**
 * Resolves an AgentCardProvider to a function.
 * Handles both object and function forms.
 */
export function resolveAgentCardProvider(provider: AgentCardProvider): () => Promise<AgentCard> {
  if (typeof provider === 'function') {
    return provider;
  }
  return provider.getAgentCard.bind(provider);
}

// =============================================================================
// Handler Options
// =============================================================================

/**
 * Base configuration options for all A2A server implementations.
 * All framework-specific options should extend this interface.
 *
 * This ensures a consistent API across Express, Hono, Elysia, itty-router, Fresh, etc.
 */
export interface A2AServerOptions {
  /** Logger instance for request/error logging */
  logger?: Logger;
  /** Function to build user from web-standard Request */
  userBuilder?: UserBuilder;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Configuration options for A2A web-standard handlers.
 */
export interface WebHandlerOptions {
  /** Logger instance for request/error logging */
  logger?: Logger;
  /** Function to build user from request */
  userBuilder?: UserBuilder;
  /** Base path for API routes (e.g., '/api/a2a') */
  basePath?: string;
}

/**
 * Resolved configuration with defaults applied.
 */
export interface ResolvedWebHandlerOptions {
  logger: Logger;
  userBuilder: UserBuilder;
  basePath: string;
}

/**
 * Applies defaults to web handler options.
 */
export function resolveOptions(options?: WebHandlerOptions): ResolvedWebHandlerOptions {
  return {
    logger: options?.logger ?? ConsoleLogger.create(),
    userBuilder: options?.userBuilder ?? defaultUserBuilder,
    basePath: options?.basePath ?? '',
  };
}

/**
 * Route handler function type.
 * Takes a web-standard Request and returns a Response.
 */
export type RouteHandler = (request: WebRequest) => Promise<WebResponse>;

/**
 * Route definition for the web-standard router.
 */
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  pattern: string;
  handler: RouteHandler;
}

// =============================================================================
// SSE Types
// =============================================================================

/**
 * SSE (Server-Sent Events) event structure.
 * Used internally by the web-standard handlers.
 */
export interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

/**
 * Formats an SSE event to the wire format.
 * Supports optional id, event type, and retry fields.
 */
export function formatSSE(event: SSEEvent): string {
  let result = '';
  if (event.id) result += `id: ${event.id}\n`;
  if (event.event) result += `event: ${event.event}\n`;
  if (event.retry) result += `retry: ${event.retry}\n`;
  result += `data: ${event.data}\n\n`;
  return result;
}

/**
 * Formats a data event for SSE (convenience wrapper).
 * Compatible with the shared sse_utils.ts format.
 */
export function formatSSEData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Formats an error event for SSE.
 * Uses the "error" event type for client-side error handling.
 * Compatible with the shared sse_utils.ts format.
 */
export function formatSSEError(error: unknown): string {
  return `event: error\ndata: ${JSON.stringify(error)}\n\n`;
}

/**
 * Standard SSE response headers.
 * Re-exported from shared sse_utils for convenience.
 */
export const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * Creates an SSE streaming response from an async generator.
 *
 * This implementation provides:
 * - Proper abort signal handling with event listener cleanup
 * - Graceful stream termination on client disconnect
 * - Error event emission before stream close
 *
 * For frameworks with native backpressure support (like Hono's streamSSE),
 * use the `processStream` function with `createHonoStreamConsumer` instead.
 *
 * @param generator - Async generator yielding events
 * @param options - Response options (headers, signal)
 * @returns Web-standard Response with SSE stream
 */
export function createSSEResponse(
  generator: AsyncGenerator<SSEEvent, void, undefined>,
  options?: { headers?: HeadersInit; signal?: AbortSignal }
): WebResponse {
  const encoder = new TextEncoder();

  // Track if we should stop iteration
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Set up abort signal listener for proper cleanup
      const abortHandler = () => {
        aborted = true;
      };

      if (options?.signal) {
        // Check if already aborted
        if (options.signal.aborted) {
          controller.close();
          return;
        }
        options.signal.addEventListener('abort', abortHandler);
      }

      try {
        for await (const event of generator) {
          // Check abort status before each write
          if (aborted || options?.signal?.aborted) {
            break;
          }

          try {
            controller.enqueue(encoder.encode(formatSSE(event)));
          } catch {
            // Controller may be closed if client disconnected
            // This is expected behavior, not an error
            break;
          }
        }
      } catch (error) {
        // Only send error event if stream is still open
        if (!aborted && !options?.signal?.aborted) {
          try {
            const errorEvent: SSEEvent = {
              id: String(Date.now()),
              event: 'error',
              data: JSON.stringify({
                error: error instanceof Error ? error.message : 'Stream error',
              }),
            };
            controller.enqueue(encoder.encode(formatSSE(errorEvent)));
          } catch {
            // Controller may be closed, ignore
          }
        }
      } finally {
        // Clean up abort listener
        if (options?.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }

        // Close the stream
        try {
          controller.close();
        } catch {
          // Controller may already be closed, ignore
        }
      }
    },
    cancel() {
      // Stream was cancelled by client (e.g., browser closed connection)
      aborted = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...SSE_HEADERS,
      ...options?.headers,
    },
  });
}

// =============================================================================
// Response Utilities
// =============================================================================

/**
 * Creates a JSON response with the given status code.
 */
export function jsonResponse(body: unknown, status: number, headers?: HeadersInit): WebResponse {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Creates an empty response (204 No Content).
 */
export function noContentResponse(headers?: HeadersInit): WebResponse {
  return new Response(null, {
    status: 204,
    headers,
  });
}

/**
 * Parses JSON from a request body.
 * Returns null if parsing fails.
 *
 * Note: This function uses a type assertion because `request.json()` returns `unknown`.
 * The caller is responsible for ensuring the parsed data matches type T, typically
 * through validation in the transport handler layer.
 *
 * @typeParam T - Expected type of the parsed JSON (default: unknown)
 * @param request - Web-standard Request object
 * @returns Parsed JSON as type T, or null if parsing fails
 */
export async function parseJsonBody<T = unknown>(request: WebRequest): Promise<T | null> {
  try {
    // Type assertion is necessary here as request.json() returns Promise<unknown>.
    // Validation should be performed by the caller or transport handler.
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Extracts path parameters from a URL pattern match.
 * Simple implementation for common patterns like /tasks/:taskId
 */
export function extractPathParams(pattern: string, path: string): Record<string, string> | null {
  // Escape special regex chars except : for params
  const regexPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, '(?<$1>[^/]+)');

  const regex = new RegExp(`^${regexPattern}$`);
  const match = path.match(regex);

  if (!match?.groups) return null;
  return match.groups;
}

/**
 * Generates a UUID v4 using the Web Crypto API.
 * Works in all modern edge runtimes without external dependencies.
 */
export function generateId(): string {
  // Use crypto.randomUUID if available (most modern runtimes)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Set version (4) and variant (RFC4122)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last resort fallback (not cryptographically secure)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
