/**
 * Elysia integration for the A2A Server library.
 *
 * Provides A2AElysiaApp for Bun-native web applications with excellent
 * TypeScript support and performance.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia';
 * import { A2AElysiaApp } from '@drew-foxall/a2a-js-sdk/server/elysia';
 * import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
 *
 * const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
 * const a2aApp = new A2AElysiaApp(requestHandler, { enableRest: true });
 *
 * const app = new Elysia();
 * a2aApp.setupRoutes(app, '/a2a');
 * app.listen(3000);
 * ```
 */

// Main App class and options
export { A2AElysiaApp } from './a2a_elysia_app.js';
export type { A2AElysiaOptions, ElysiaContext, ElysiaRoute } from './a2a_elysia_app.js';

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
