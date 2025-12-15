/**
 * Fresh integration for the A2A Server library.
 *
 * Provides A2AFreshApp for Deno's Fresh web framework.
 * Fresh uses file-based routing, so this adapter provides handlers
 * that can be used in route files.
 *
 * @example
 * ```ts
 * // routes/a2a/[...path].ts
 * import { A2AFreshApp } from '@drew-foxall/a2a-js-sdk/server/fresh';
 * import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
 *
 * const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
 * const a2aApp = new A2AFreshApp(requestHandler, { enableRest: true });
 *
 * export const handler = a2aApp.createHandlers('/a2a');
 * ```
 */

// Main App class and options
export { A2AFreshApp } from './a2a_fresh_app.js';
export type {
  A2AFreshOptions,
  FreshContext,
  FreshHandler,
  FreshHandlers,
} from './a2a_fresh_app.js';

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
