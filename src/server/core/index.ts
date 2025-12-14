/**
 * A2A Server Core
 *
 * Web-standard handlers and utilities for building A2A servers
 * that run on any runtime (Node.js, Cloudflare Workers, Deno, Bun, etc.)
 */

// Logger
export {
  Logger,
  LogLevel,
  LogContext,
  LogContextError,
  NoopLogger,
  ConsoleLogger,
  JsonLogger,
} from './logger.js';

// Types and utilities
export {
  WebRequest,
  WebResponse,
  // User authentication
  UserBuilder,
  defaultUserBuilder,
  // Agent card provider
  AgentCardProvider,
  resolveAgentCardProvider,
  // Handler options
  EdgeHandlerOptions,
  ResolvedEdgeHandlerOptions,
  resolveOptions,
  // Route types
  RouteHandler,
  Route,
  // SSE utilities
  SSEEvent,
  formatSSE,
  formatSSEData,
  formatSSEError,
  SSE_HEADERS,
  createSSEResponse,
  // Response utilities
  jsonResponse,
  noContentResponse,
  parseJsonBody,
  extractPathParams,
  generateId,
} from './types.js';

// Route definitions and utilities
export {
  // Types
  HttpMethod,
  HttpStatusCode,
  RoutePattern,
  A2ARouteDefinition,
  StreamingRoute,
  NonStreamingRoute,
  // Route definitions
  REST_ROUTES,
  AGENT_CARD_ROUTE,
  JSON_RPC_ROUTE,
  HTTP_STATUS,
  // Pattern utilities
  toExpressPattern,
  toRegex,
  extractParams,
  matchesPattern,
  withBasePath,
} from './routes.js';

// Streaming utilities
export {
  // Types
  HTTPError,
  StreamConsumer,
  StreamResult,
  StreamSuccessResult,
  StreamEarlyErrorResult,
  ProcessStreamOptions,
  // Core streaming function
  processStream,
  // Event creators
  createSSEEvent,
  createSSEErrorEvent,
  // Stream consumer factories
  createExpressStreamConsumer,
  createWebStreamConsumer,
} from './streaming.js';

// Re-export RestHttpStatusCode from transport handler
export { RestHttpStatusCode } from '../transports/rest/rest_transport_handler.js';

// Handlers
export {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
  createA2AHandler,
} from './handlers.js';
export type { AgentCardHandlerOptions, A2AHandlerConfig } from './handlers.js';
