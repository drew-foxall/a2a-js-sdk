/**
 * Shared test fixtures and helpers for server implementation tests.
 *
 * This file provides common setup for testing all A2A server implementations
 * to ensure consistent behavior across Express, Hono, Elysia, itty-router, Fresh, and web-standard.
 */

import sinon, { SinonStub } from 'sinon';
import { A2ARequestHandler } from '../../../src/server/request_handler/a2a_request_handler.js';
import { AgentCard } from '../../../src/index.js';

/**
 * Standard test agent card used across all server tests.
 */
export const testAgentCard: AgentCard = {
  protocolVersion: '0.3.0',
  name: 'Test Agent',
  description: 'An agent for testing purposes',
  url: 'http://localhost:8080',
  preferredTransport: 'JSONRPC',
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: true,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
};

/**
 * Creates a mock A2ARequestHandler with all methods stubbed.
 */
export function createMockRequestHandler(): A2ARequestHandler {
  return {
    getAgentCard: sinon.stub().resolves(testAgentCard),
    getAuthenticatedExtendedAgentCard: sinon.stub(),
    sendMessage: sinon.stub(),
    sendMessageStream: sinon.stub(),
    getTask: sinon.stub(),
    cancelTask: sinon.stub(),
    setTaskPushNotificationConfig: sinon.stub(),
    getTaskPushNotificationConfig: sinon.stub(),
    listTaskPushNotificationConfigs: sinon.stub(),
    deleteTaskPushNotificationConfig: sinon.stub(),
    resubscribe: sinon.stub(),
  };
}

/**
 * Helper function to create JSON-RPC request bodies.
 */
export const createRpcRequest = (
  id: string | null,
  method = 'message/send',
  params: object = {}
) => ({
  jsonrpc: '2.0',
  method,
  id,
  params,
});

/**
 * Creates a mock streaming response.
 */
export function createMockStreamResponse() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
      yield { jsonrpc: '2.0', id: 'stream-2', result: { step: 2 } };
    },
  };
}

/**
 * Creates a mock empty stream response.
 */
export function createEmptyStreamResponse() {
  return {
    async *[Symbol.asyncIterator]() {
      // Empty generator - yields nothing
    },
  };
}

/**
 * Creates a mock stream that throws an error mid-stream.
 */
export function createErrorStreamResponse(errorMessage: string, errorCode = -32603) {
  const { A2AError } = require('../../../src/server/error.js');
  return {
    async *[Symbol.asyncIterator]() {
      yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
      throw new A2AError(errorCode, errorMessage);
    },
  };
}

/**
 * Creates a mock stream that throws immediately.
 */
export function createImmediateErrorStreamResponse(errorMessage: string, errorCode = -32603) {
  const { A2AError } = require('../../../src/server/error.js');
  return {
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator]() {
      throw new A2AError(errorCode, errorMessage);
    },
  };
}

/**
 * Gets the mock getAgentCard stub from a mock request handler.
 */
export function getAgentCardStub(mockHandler: A2ARequestHandler): SinonStub {
  return mockHandler.getAgentCard as SinonStub;
}

/**
 * Standard test cases that should pass for all server implementations.
 *
 * Each server test file should verify these behaviors:
 *
 * 1. Constructor
 *    - should create an instance with requestHandler
 *
 * 2. setupRoutes
 *    - should setup routes with default parameters
 *
 * 3. Agent Card Endpoint
 *    - should return agent card on GET /.well-known/agent-card.json
 *    - should return agent card on custom path when agentCardPath is provided
 *    - should handle errors when getting agent card
 *
 * 4. JSON-RPC Endpoint
 *    - should handle single JSON-RPC response
 *    - should handle streaming JSON-RPC response
 *    - should handle streaming error
 *    - should handle immediate streaming error
 *    - should handle general processing error
 *    - should handle non-A2AError with fallback error handling
 *    - should handle request without id
 *    - should handle malformed json request
 *    - should handle extensions headers in request
 *    - should handle extensions headers in response
 *
 * 5. Route Configuration
 *    - should mount routes at baseUrl
 *    - should handle empty baseUrl
 *    - should handle JSON parsing automatically
 *
 * 6. SSE Streaming Lifecycle
 *    - should properly handle multiple streaming events
 *    - should handle empty stream gracefully
 *
 * 7. Error Resilience
 *    - should handle invalid content type gracefully
 *    - should handle completely invalid JSON
 *
 * 8. Authentication Integration
 *    - should handle no authentication middlewares
 *    - should handle successful authentication with class
 *    - should handle successful authentication with plain object
 *    - should extract user info from request context
 */
export const TEST_CATEGORIES = {
  CONSTRUCTOR: 'constructor',
  SETUP_ROUTES: 'setupRoutes',
  AGENT_CARD: 'agent card endpoint',
  JSON_RPC: 'JSON-RPC endpoint',
  ROUTE_CONFIG: 'route configuration',
  SSE_STREAMING: 'SSE streaming lifecycle',
  ERROR_RESILIENCE: 'error resilience',
  AUTHENTICATION: 'authentication integration',
} as const;

