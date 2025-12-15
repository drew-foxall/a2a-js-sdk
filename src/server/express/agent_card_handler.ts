import express, { Request, Response, RequestHandler } from 'express';

// Import core logic
import { AgentCardProvider, fetchAgentCard } from '../request_handler/agent_card_utils.js';

export { AgentCardProvider };

export interface AgentCardHandlerOptions {
  agentCardProvider: AgentCardProvider;
}

/**
 * Creates Express.js middleware to handle agent card requests.
 *
 * This handler uses the core agent card logic for business processing
 * and only implements Express-specific I/O operations.
 *
 * @example
 * ```ts
 * // With an existing A2ARequestHandler instance:
 * app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: a2aRequestHandler }));
 *
 * // Or with a factory lambda:
 * app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: async () => agentCard }));
 * ```
 */
export function agentCardHandler(options: AgentCardHandlerOptions): RequestHandler {
  const router = express.Router();

  router.get('/', async (_req: Request, res: Response) => {
    // Use core logic for fetching agent card
    const result = await fetchAgentCard(options.agentCardProvider);

    if (result.success === true) {
      res.json(result.agentCard);
    } else {
      res.status(500).json({ error: result.error });
    }
  });

  return router;
}
