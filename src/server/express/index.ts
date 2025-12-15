/**
 * Express integration for the A2A Server library.
 *
 * Provides A2AExpressApp for Node.js Express applications.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { A2AExpressApp } from '@drew-foxall/a2a-js-sdk/server/express';
 * import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
 *
 * const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
 * const a2aApp = new A2AExpressApp(requestHandler, { enableRest: true });
 *
 * const app = express();
 * a2aApp.setupRoutes(app, '/a2a');
 * app.listen(3000);
 * ```
 */

// Main App class and options
export { A2AExpressApp } from './a2a_express_app.js';
export type { A2AExpressOptions } from './a2a_express_app.js';

// Framework-specific types
export { UserBuilder } from './common.js';

// Individual handlers for direct use
export { jsonRpcHandler, jsonErrorHandler } from './json_rpc_handler.js';
export type { JsonRpcHandlerOptions } from './json_rpc_handler.js';
export { agentCardHandler } from './agent_card_handler.js';
export type { AgentCardHandlerOptions, AgentCardProvider } from './agent_card_handler.js';
export { restHandler } from './rest_handler.js';
export type { RestHandlerOptions } from './rest_handler.js';

// Re-export common types for convenience
export { Logger, ConsoleLogger, JsonLogger, NoopLogger } from '../logging/logger.js';
export type { LogLevel, LogContext } from '../logging/logger.js';
