/**
 * A2A Route Definitions
 *
 * This module exports the canonical route definitions for the A2A protocol.
 * These can be used by any adapter to set up routing consistently.
 */

// =============================================================================
// Route Definitions
// =============================================================================

/**
 * HTTP methods supported by A2A routes.
 */
export type HttpMethod = 'GET' | 'POST' | 'DELETE';

/**
 * HTTP status codes used by A2A.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
} as const;

/**
 * Type for HTTP status code values.
 */
export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/**
 * Route pattern string type.
 * Patterns use :param for path parameters (e.g., '/v1/tasks/:taskId').
 */
export type RoutePattern = string;

/**
 * A2A route definition.
 * Framework-agnostic description of an A2A endpoint.
 */
export interface A2ARouteDefinition<TStreaming extends boolean = boolean> {
  /** HTTP method */
  readonly method: HttpMethod;
  /** Route pattern with :param placeholders (e.g., '/v1/tasks/:taskId') */
  readonly pattern: RoutePattern;
  /** Human-readable description */
  readonly description: string;
  /** Expected HTTP status code on success */
  readonly successStatus: HttpStatusCode;
  /** Whether this route returns an SSE stream */
  readonly isStreaming: TStreaming;
}

/**
 * Streaming route definition (isStreaming: true).
 */
export type StreamingRoute = A2ARouteDefinition<true>;

/**
 * Non-streaming route definition (isStreaming: false).
 */
export type NonStreamingRoute = A2ARouteDefinition<false>;

/**
 * REST API route definitions.
 * These define the canonical A2A REST endpoints.
 */
export const REST_ROUTES = [
  {
    method: 'GET',
    pattern: '/v1/card',
    description: 'Get authenticated extended agent card',
    successStatus: HTTP_STATUS.OK,
    isStreaming: false,
  },
  {
    method: 'POST',
    pattern: '/v1/message:send',
    description: 'Send a message synchronously',
    successStatus: HTTP_STATUS.CREATED,
    isStreaming: false,
  },
  {
    method: 'POST',
    pattern: '/v1/message:stream',
    description: 'Send a message with streaming response',
    successStatus: HTTP_STATUS.OK,
    isStreaming: true,
  },
  {
    method: 'GET',
    pattern: '/v1/tasks/:taskId',
    description: 'Get task status and details',
    successStatus: HTTP_STATUS.OK,
    isStreaming: false,
  },
  {
    method: 'POST',
    pattern: '/v1/tasks/:taskId:cancel',
    description: 'Cancel a task',
    successStatus: HTTP_STATUS.ACCEPTED,
    isStreaming: false,
  },
  {
    method: 'POST',
    pattern: '/v1/tasks/:taskId:subscribe',
    description: 'Subscribe to task updates via SSE',
    successStatus: HTTP_STATUS.OK,
    isStreaming: true,
  },
  {
    method: 'POST',
    pattern: '/v1/tasks/:taskId/pushNotificationConfigs',
    description: 'Create push notification config',
    successStatus: HTTP_STATUS.CREATED,
    isStreaming: false,
  },
  {
    method: 'GET',
    pattern: '/v1/tasks/:taskId/pushNotificationConfigs',
    description: 'List push notification configs',
    successStatus: HTTP_STATUS.OK,
    isStreaming: false,
  },
  {
    method: 'GET',
    pattern: '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
    description: 'Get push notification config',
    successStatus: HTTP_STATUS.OK,
    isStreaming: false,
  },
  {
    method: 'DELETE',
    pattern: '/v1/tasks/:taskId/pushNotificationConfigs/:configId',
    description: 'Delete push notification config',
    successStatus: HTTP_STATUS.NO_CONTENT,
    isStreaming: false,
  },
] as const;

/**
 * Agent card route definition.
 */
export const AGENT_CARD_ROUTE: A2ARouteDefinition = {
  method: 'GET',
  pattern: '/.well-known/agent-card.json',
  description: 'Get agent card',
  successStatus: HTTP_STATUS.OK,
  isStreaming: false,
};

/**
 * JSON-RPC route definition.
 */
export const JSON_RPC_ROUTE: A2ARouteDefinition = {
  method: 'POST',
  pattern: '/',
  description: 'JSON-RPC endpoint',
  successStatus: HTTP_STATUS.OK,
  isStreaming: false, // Can be streaming depending on method
};

// =============================================================================
// Route Pattern Utilities
// =============================================================================

/**
 * Converts an A2A route pattern to Express format.
 * Express uses backslash to escape colons in route patterns.
 *
 * @example
 * toExpressPattern('/v1/message:send') // '/v1/message\\:send'
 * toExpressPattern('/v1/tasks/:taskId') // '/v1/tasks/:taskId'
 */
export function toExpressPattern(pattern: string): string {
  // Escape colons that are NOT part of :param patterns
  return pattern.replace(/([^/]):(?!\w)/g, '$1\\:').replace(/:(\w+):/g, ':$1\\:');
}

/**
 * Converts an A2A route pattern to a regex for matching.
 * Captures named parameters.
 *
 * @example
 * toRegex('/v1/tasks/:taskId').exec('/v1/tasks/abc123')
 * // { groups: { taskId: 'abc123' } }
 */
export function toRegex(pattern: string): RegExp {
  // Escape special regex chars except : for params
  const regexPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, '(?<$1>[^/]+)');

  return new RegExp(`^${regexPattern}$`);
}

/**
 * Extracts path parameters from a URL using a route pattern.
 *
 * @example
 * extractParams('/v1/tasks/:taskId', '/v1/tasks/abc123')
 * // { taskId: 'abc123' }
 */
export function extractParams(pattern: string, path: string): Record<string, string> | null {
  const regex = toRegex(pattern);
  const match = path.match(regex);
  if (!match?.groups) return null;
  return match.groups;
}

/**
 * Checks if a path matches a route pattern.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  return toRegex(pattern).test(path);
}

/**
 * Prepends a base path to a route pattern.
 *
 * @example
 * withBasePath('/api', '/v1/tasks/:taskId') // '/api/v1/tasks/:taskId'
 */
export function withBasePath(basePath: string, pattern: string): string {
  if (!basePath || basePath === '/') return pattern;
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${normalizedBase}${pattern}`;
}
