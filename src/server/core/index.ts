/**
 * A2A Server Core
 *
 * This module re-exports shared functionality from their canonical locations.
 * It provides backward compatibility for existing imports from 'server/core'.
 *
 * New code should import directly from the canonical locations:
 * - Logging: '../logging/logger.js'
 * - JSON-RPC Logic: '../transports/jsonrpc/json_rpc_logic.js'
 * - REST Logic: '../transports/rest/rest_logic.js'
 * - Agent Card Utils: '../request_handler/agent_card_utils.js'
 * - Error Formatting: '../error.js'
 * - SSE Utils: '../../sse_utils.js'
 * - Routes: '../transports/routes.js'
 * - Streaming: '../transports/streaming.js'
 * - Web-Standard Handlers: '../web-standard/handlers.js'
 * - Web-Standard Types: '../web-standard/types.js'
 */

// =============================================================================
// Logger (canonical: ../logging/logger.js)
// =============================================================================
export {
  Logger,
  LogLevel,
  LogContext,
  LogContextError,
  NoopLogger,
  ConsoleLogger,
  JsonLogger,
} from '../logging/logger.js';

// =============================================================================
// JSON-RPC Logic (canonical: ../transports/jsonrpc/json_rpc_logic.js)
// =============================================================================
export {
  // Types
  JsonRpcInput,
  JsonRpcSingleResult,
  JsonRpcStreamResult,
  JsonRpcResult,
  // Core functions
  processJsonRpc,
  extractRequestId,
  isAsyncGenerator,
} from '../transports/jsonrpc/json_rpc_logic.js';

// =============================================================================
// REST API Logic (canonical: ../transports/rest/rest_logic.js)
// =============================================================================
export {
  // Types
  RestInput,
  RestSingleResult,
  RestStreamResult,
  RestResult,
  // Core functions
  buildRestContext,
  getActivatedExtensions,
  getAuthenticatedCard,
  sendMessage,
  sendMessageStream,
  getTask,
  cancelTask,
  resubscribe,
  setTaskPushNotificationConfig,
  listTaskPushNotificationConfigs,
  getTaskPushNotificationConfig,
  deleteTaskPushNotificationConfig,
} from '../transports/rest/rest_logic.js';

// =============================================================================
// Agent Card Logic (canonical: ../request_handler/agent_card_utils.js)
// =============================================================================
export {
  // Types
  AgentCardProvider as CoreAgentCardProvider,
  AgentCardResult,
  AgentCardErrorResult,
  AgentCardFetchResult,
  // Core functions
  resolveAgentCardProvider as resolveCoreAgentCardProvider,
  fetchAgentCard,
} from '../request_handler/agent_card_utils.js';

// =============================================================================
// Error Handling (canonical: ../error.js)
// =============================================================================
export {
  // Types
  JsonRpcErrorResult,
  RestErrorResult,
  // Core functions
  formatJsonRpcError,
  formatParseError,
  formatStreamingError,
  formatRestError,
} from '../error.js';

// =============================================================================
// SSE Formatting (canonical: ../../sse_utils.js)
// =============================================================================
export {
  // Types
  SSEEventData,
  // Core functions
  createSSEEventData,
  createSSEErrorEventData,
  sseEventToString,
  // Base functions
  SSE_HEADERS,
  formatSSEEvent,
  formatSSEErrorEvent,
} from '../../sse_utils.js';

// =============================================================================
// Types and utilities (canonical: ../web-standard/types.js)
// =============================================================================
export {
  WebRequest,
  WebResponse,
  // User authentication
  UserBuilder,
  defaultUserBuilder,
  // Agent card provider
  AgentCardProvider,
  resolveAgentCardProvider,
  // Base server options (all frameworks should extend this)
  A2AServerOptions,
  // Handler options
  WebHandlerOptions,
  ResolvedWebHandlerOptions,
  resolveOptions,
  // Route types
  RouteHandler,
  Route,
  // SSE utilities
  SSEEvent,
  formatSSE,
  formatSSEData,
  formatSSEError,
  createSSEResponse,
  // Response utilities
  jsonResponse,
  noContentResponse,
  parseJsonBody,
  extractPathParams,
  generateId,
} from '../web-standard/types.js';

// Backward compatibility aliases
export { WebHandlerOptions as EdgeHandlerOptions } from '../web-standard/types.js';
export { ResolvedWebHandlerOptions as ResolvedEdgeHandlerOptions } from '../web-standard/types.js';

// =============================================================================
// Route definitions and utilities (canonical: ../transports/routes.js)
// =============================================================================
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
} from '../transports/routes.js';

// =============================================================================
// Streaming utilities (canonical: ../transports/streaming.js)
// =============================================================================
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
} from '../transports/streaming.js';

// Re-export RestHttpStatusCode from transport handler
export { RestHttpStatusCode } from '../transports/rest/rest_transport_handler.js';

// =============================================================================
// Web-standard Handlers (canonical: ../web-standard/handlers.js)
// =============================================================================
export {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
  createA2AHandler,
} from '../web-standard/handlers.js';
export type { AgentCardHandlerOptions, A2AHandlerConfig } from '../web-standard/handlers.js';
