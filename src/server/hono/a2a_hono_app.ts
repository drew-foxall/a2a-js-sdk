import { Hono, MiddlewareHandler } from 'hono';

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { AGENT_CARD_PATH } from '../../constants.js';
import { jsonRpcHandler } from './json_rpc_handler.js';
import { agentCardHandler } from './agent_card_handler.js';

export class A2AHonoApp {
  private requestHandler: A2ARequestHandler;

  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
  }

  /**
   * Adds A2A routes to an existing Hono app.
   * @param app Optional existing Hono app.
   * @param baseUrl The base URL for A2A endpoints (e.g., "/a2a/api").
   * @param middlewares Optional array of Hono middlewares to apply to the A2A routes.
   * @param agentCardPath Optional custom path for the agent card endpoint (defaults to .well-known/agent-card.json).
   * @returns The Hono app with A2A routes.
   */
  public setupRoutes(
    app: Hono,
    baseUrl: string = '',
    middlewares?: MiddlewareHandler[],
    agentCardPath: string = AGENT_CARD_PATH
  ): Hono {
    // Create a sub-app for A2A routes
    const a2aApp = new Hono();

    // Apply custom middlewares if provided
    if (middlewares && middlewares.length > 0) {
      middlewares.forEach((middleware) => a2aApp.use(middleware));
    }

    // Create JSON-RPC handler route
    const jsonRpcRoute = jsonRpcHandler({ requestHandler: this.requestHandler });

    // Create agent card handler route
    const agentCardRoute = agentCardHandler({ agentCardProvider: this.requestHandler });

    // Mount the handlers to the sub-app
    a2aApp.route('/', jsonRpcRoute);
    a2aApp.route(`/${agentCardPath}`, agentCardRoute);

    // Mount the sub-app to the main app
    app.route(baseUrl, a2aApp);

    return app;
  }
}
