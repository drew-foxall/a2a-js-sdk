import { Hono } from 'hono';
import { AgentCard } from "../../types.js";

export interface AgentCardHandlerOptions {
    agentCardProvider: AgentCardProvider;
}

export type AgentCardProvider =
    { getAgentCard(): Promise<AgentCard>; }
    | (() => Promise<AgentCard>);

/**
 * Creates Hono route to handle agent card requests.
 * @example
 * // With an existing A2ARequestHandler instance:
 * app.route('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: a2aRequestHandler }));
 * // or with a factory lambda:
 * app.route('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: async () => agentCard }));
 */
export function agentCardHandler(options: AgentCardHandlerOptions): Hono {
    const app = new Hono();

    const provider = typeof options.agentCardProvider === 'function'
        ? options.agentCardProvider
        : options.agentCardProvider.getAgentCard.bind(options.agentCardProvider);

    app.get('/', async (c) => {
        try {
            const agentCard = await provider();
            return c.json(agentCard);
        } catch (error: any) {
            console.error("Error fetching agent card:", error);
            return c.json({ error: "Failed to retrieve agent card" }, 500);
        }
    });

    return app;
}

