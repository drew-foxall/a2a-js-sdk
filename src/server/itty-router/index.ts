/**
 * Itty Router integration for the A2A Server library.
 *
 * Provides A2AIttyRouterApp for lightweight Cloudflare Workers applications.
 *
 * @example
 * ```ts
 * import { Router } from 'itty-router';
 * import { A2AIttyRouterApp } from '@drew-foxall/a2a-js-sdk/server/itty-router';
 * import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
 *
 * const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
 * const a2aApp = new A2AIttyRouterApp(requestHandler, { enableRest: true });
 *
 * const router = Router();
 * a2aApp.setupRoutes(router, '/a2a');
 *
 * export default { fetch: router.handle };
 * ```
 */

// Main App class and options
export { A2AIttyRouterApp } from './a2a_itty_router_app.js';
export type {
  A2AIttyRouterOptions,
  IttyRequest,
  IttyRoute,
  IttyRouteHandler,
} from './a2a_itty_router_app.js';

// Framework-specific types
export { UserBuilder } from '../web-standard/types.js';

// Individual handlers for direct use (web-standard handlers)
export {
  createJsonRpcHandler as jsonRpcHandler,
  createAgentCardHandler as agentCardHandler,
  createRestHandlers as restHandler,
} from '../web-standard/handlers.js';
export type {
  JsonRpcHandlerOptions,
  AgentCardHandlerOptions,
  RestHandlerOptions,
} from '../web-standard/handlers.js';
export type { AgentCardProvider } from '../web-standard/types.js';

// Re-export common types for convenience
export { Logger, ConsoleLogger, JsonLogger, NoopLogger } from '../logging/logger.js';
export type { LogLevel, LogContext } from '../logging/logger.js';
