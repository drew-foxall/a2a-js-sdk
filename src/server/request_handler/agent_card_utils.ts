/**
 * Agent Card Utilities
 *
 * This module contains shared agent card handling logic.
 * Server-specific adapters should use these functions to retrieve
 * agent cards consistently across all implementations.
 */

import { AgentCard } from '../../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Provider for agent card data.
 * Can be either:
 * - An object with a `getAgentCard()` method (like A2ARequestHandler)
 * - A function that returns a Promise<AgentCard>
 */
export type AgentCardProvider = { getAgentCard(): Promise<AgentCard> } | (() => Promise<AgentCard>);

/**
 * Result of fetching an agent card.
 */
export interface AgentCardResult {
  success: true;
  agentCard: AgentCard;
}

/**
 * Error result when fetching agent card fails.
 */
export interface AgentCardErrorResult {
  success: false;
  error: string;
}

/**
 * Union type for agent card fetch results.
 */
export type AgentCardFetchResult = AgentCardResult | AgentCardErrorResult;

// =============================================================================
// Core Logic
// =============================================================================

/**
 * Resolves an AgentCardProvider to a function.
 *
 * @param provider - The agent card provider (object or function)
 * @returns A function that returns Promise<AgentCard>
 */
export function resolveAgentCardProvider(provider: AgentCardProvider): () => Promise<AgentCard> {
  if (typeof provider === 'function') {
    return provider;
  }
  return provider.getAgentCard.bind(provider);
}

/**
 * Fetches an agent card from the provider.
 *
 * This is the core business logic that all server adapters should use.
 * It handles error wrapping consistently.
 *
 * @param provider - The agent card provider
 * @returns The agent card or an error result
 */
export async function fetchAgentCard(provider: AgentCardProvider): Promise<AgentCardFetchResult> {
  try {
    const getAgentCard = resolveAgentCardProvider(provider);
    const agentCard = await getAgentCard();
    return { success: true, agentCard };
  } catch (error) {
    console.error('Error fetching agent card:', error);
    return {
      success: false,
      error: 'Failed to retrieve agent card',
    };
  }
}
