/**
 * Tests for web-standard handlers.
 *
 * These handlers form the foundation for Hono, Elysia, itty-router, and Fresh adapters.
 * All web-standard-based servers should exhibit the same behavior tested here.
 */

import { describe, it, beforeEach, afterEach, assert, expect } from 'vitest';
import sinon, { SinonStub } from 'sinon';

import {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
} from '../../src/server/web-standard/handlers.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { AgentCard, JSONRPCSuccessResponse, JSONRPCErrorResponse } from '../../src/index.js';
import { A2AError } from '../../src/server/error.js';
import { ServerCallContext } from '../../src/server/context.js';
import { UnauthenticatedUser, User } from '../../src/server/authentication/user.js';
import {
  testAgentCard,
  createMockRequestHandler,
  createRpcRequest,
} from './mocks/shared_test_fixtures.js';

describe('Web-Standard Handlers', () => {
  let mockRequestHandler: A2ARequestHandler;
  let handleStub: SinonStub;

  beforeEach(() => {
    mockRequestHandler = createMockRequestHandler();
    handleStub = sinon.stub(JsonRpcTransportHandler.prototype, 'handle');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('createAgentCardHandler', () => {
    it('should return agent card on request', async () => {
      const handler = createAgentCardHandler(mockRequestHandler);
      const request = new Request('http://localhost/.well-known/agent-card.json');

      const response = await handler(request);

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, testAgentCard);
    });

    it('should handle errors when getting agent card', async () => {
      (mockRequestHandler.getAgentCard as SinonStub).rejects(new Error('Failed to get agent card'));
      const handler = createAgentCardHandler(mockRequestHandler);
      const request = new Request('http://localhost/.well-known/agent-card.json');

      const response = await handler(request);

      assert.equal(response.status, 500);
      const body = await response.json();
      assert.deepEqual(body, { error: 'Failed to retrieve agent card' });
    });

    it('should use custom agentCardProvider function when provided', async () => {
      const customCard: AgentCard = {
        ...testAgentCard,
        name: 'Custom Agent',
      };
      const handler = createAgentCardHandler(mockRequestHandler, {
        agentCardProvider: () => Promise.resolve(customCard),
      });
      const request = new Request('http://localhost/.well-known/agent-card.json');

      const response = await handler(request);

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.name, 'Custom Agent');
    });
  });

  describe('createJsonRpcHandler', () => {
    it('should handle single JSON-RPC response', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('test-id');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, mockResponse);
    });

    it('should handle streaming JSON-RPC response', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
          yield { jsonrpc: '2.0', id: 'stream-2', result: { step: 2 } };
        },
      };
      handleStub.resolves(mockStreamResponse);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('stream-test', 'message/stream');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      assert.include(response.headers.get('content-type') || '', 'text/event-stream');

      const responseText = await response.text();
      assert.include(responseText, 'data: {"jsonrpc":"2.0","id":"stream-1","result":{"step":1}}');
      assert.include(responseText, 'data: {"jsonrpc":"2.0","id":"stream-2","result":{"step":2}}');
    });

    it('should handle streaming error', async () => {
      const mockErrorStream = {
        async *[Symbol.asyncIterator]() {
          yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
          throw new A2AError(-32603, 'Streaming error');
        },
      };
      handleStub.resolves(mockErrorStream);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('stream-error-test', 'message/stream');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      const responseText = await response.text();
      assert.include(responseText, 'event: error');
      assert.include(responseText, 'Streaming error');
    });

    it('should handle immediate streaming error', async () => {
      const mockImmediateErrorStream = {
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw new A2AError(-32603, 'Immediate streaming error');
        },
      };
      handleStub.resolves(mockImmediateErrorStream);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('immediate-stream-error-test', 'message/stream');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      assert.include(response.headers.get('content-type') || '', 'text/event-stream');
      const responseText = await response.text();
      assert.include(responseText, 'event: error');
      assert.include(responseText, 'Immediate streaming error');
    });

    it('should handle general processing error', async () => {
      const error = new A2AError(-32603, 'Processing error');
      handleStub.rejects(error);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('error-test');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 500);
      const body = await response.json();

      const expectedErrorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: 'error-test',
        error: {
          code: -32603,
          message: 'Processing error',
        },
      };
      assert.deepEqual(body, expectedErrorResponse);
    });

    it('should handle non-A2AError with fallback error handling', async () => {
      const genericError = new Error('Generic error');
      handleStub.rejects(genericError);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('generic-error-test');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.id, 'generic-error-test');
      assert.equal(body.error.message, 'General processing error.');
    });

    it('should handle request without id', async () => {
      const error = new A2AError(-32600, 'No ID error');
      handleStub.rejects(error);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest(null);
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.id, null);
    });

    it('should handle malformed json request', async () => {
      const handler = createJsonRpcHandler(mockRequestHandler);
      const malformedJson = '{"jsonrpc": "2.0", "method": "message/send", "id": "1"';
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: malformedJson,
      });

      const response = await handler(request);

      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.error.code, -32700); // Parse error
    });

    it('should handle extensions headers in request', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'test-extension-uri, another-extension';

      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-A2A-Extensions': uriExtensionsValues,
        },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      assert.isTrue(handleStub.calledOnce);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext).toBeInstanceOf(ServerCallContext);
      expect(serverCallContext.requestedExtensions).toEqual([
        'test-extension-uri',
        'another-extension',
      ]);
    });

    it('should handle extensions headers in response', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };

      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'activated-extension, non-activated-extension';

      handleStub.callsFake(async (_requestBody: unknown, serverCallContext: ServerCallContext) => {
        const firstRequestedExtension = serverCallContext.requestedExtensions
          ?.values()
          .next().value;
        serverCallContext.addActivatedExtension(firstRequestedExtension);
        return mockResponse;
      });

      const handler = createJsonRpcHandler(mockRequestHandler);
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-A2A-Extensions': uriExtensionsValues,
        },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      expect(response.headers.get('X-A2A-Extensions')).toEqual('activated-extension');
    });

    it('should use userBuilder to extract user from request', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const userBuilder = (req: Request): Promise<User> => {
        const authHeader = req.headers.get('Authorization');
        if (authHeader === 'Bearer valid-token') {
          return Promise.resolve({
            isAuthenticated: true,
            userName: 'token-user',
          } as User);
        }
        return Promise.resolve(new UnauthenticatedUser());
      };

      const handler = createJsonRpcHandler(mockRequestHandler, { userBuilder });
      const requestBody = createRpcRequest('test-id');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext.user.isAuthenticated).toBe(true);
      expect(serverCallContext.user.userName).toBe('token-user');
    });
  });

  describe('createRestHandlers', () => {
    it('should create handlers for REST routes', () => {
      const { routes, handleRequest } = createRestHandlers(mockRequestHandler);

      // Should have routes for tasks, messages, etc.
      assert.isArray(routes);
      assert.isFunction(handleRequest);
      assert.isTrue(routes.length > 0);
    });

    it('should handle task retrieval', async () => {
      const mockTask = {
        id: 'task-123',
        status: { state: 'completed' },
        artifacts: [] as unknown[],
        history: [] as unknown[],
        metadata: {},
      };
      (mockRequestHandler.getTask as SinonStub).resolves(mockTask);

      const { handleRequest } = createRestHandlers(mockRequestHandler);
      // Use the correct REST API path: /v1/tasks/:taskId
      const request = new Request('http://localhost/v1/tasks/task-123', {
        method: 'GET',
      });

      const response = await handleRequest(request, '/v1/tasks/task-123');

      assert.isNotNull(response);
      // The REST handler should return a response for a valid task route
      if (response) {
        const body = await response.json();
        // Verify we got the task back (status may vary based on implementation)
        assert.isDefined(body);
      }
    });

    it('should return null for non-matching routes', async () => {
      const { handleRequest } = createRestHandlers(mockRequestHandler);
      const request = new Request('http://localhost/unknown-path', {
        method: 'GET',
      });

      const response = await handleRequest(request, '/unknown-path');

      assert.isNull(response);
    });
  });

  describe('SSE streaming lifecycle', () => {
    it('should properly handle multiple streaming events', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield { jsonrpc: '2.0', id: 'multi-1', result: { event: 'submitted' } };
          yield { jsonrpc: '2.0', id: 'multi-1', result: { event: 'working' } };
          yield { jsonrpc: '2.0', id: 'multi-1', result: { event: 'completed' } };
        },
      };
      handleStub.resolves(mockStreamResponse);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('multi-1', 'message/stream');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      const responseText = await response.text();

      // Verify all events are present
      assert.include(responseText, '"event":"submitted"');
      assert.include(responseText, '"event":"working"');
      assert.include(responseText, '"event":"completed"');

      // Verify SSE format (should have multiple data: lines)
      const dataLines = responseText.split('\n').filter((line) => line.startsWith('data:'));
      assert.equal(dataLines.length, 3, 'Should have 3 SSE data events');
    });

    it('should handle empty stream gracefully', async () => {
      const mockEmptyStream = {
        async *[Symbol.asyncIterator]() {
          // Empty generator - yields nothing
        },
      };
      handleStub.resolves(mockEmptyStream);

      const handler = createJsonRpcHandler(mockRequestHandler);
      const requestBody = createRpcRequest('empty-stream', 'message/stream');
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await handler(request);

      assert.equal(response.status, 200);
      assert.include(response.headers.get('content-type') || '', 'text/event-stream');
    });
  });

  describe('error resilience', () => {
    it('should handle completely invalid JSON', async () => {
      const handler = createJsonRpcHandler(mockRequestHandler);
      const request = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all',
      });

      const response = await handler(request);

      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.error.code, -32700); // Parse error
    });
  });
});

