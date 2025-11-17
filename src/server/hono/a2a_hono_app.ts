import { Hono } from 'hono';

import { A2ARequestHandler } from "../request_handler/a2a_request_handler.js";
import { AGENT_CARD_PATH } from "../../constants.js";
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
     * @param agentCardPath Optional custom path for the agent card endpoint (defaults to .well-known/agent-card.json).
     * @returns The Hono app with A2A routes.
     */
    public setupRoutes(
        app: Hono,
        baseUrl: string = "",
        agentCardPath: string = AGENT_CARD_PATH
    ): Hono {
        // Create JSON-RPC handler route
        const jsonRpcRoute = jsonRpcHandler({ requestHandler: this.requestHandler });
        
        // Create agent card handler route
        const agentCardRoute = agentCardHandler({ agentCardProvider: this.requestHandler });

        // Mount the handlers
        app.route(baseUrl, jsonRpcRoute);
        app.route(`${baseUrl}/${agentCardPath}`, agentCardRoute);

        return app;
    }
}

