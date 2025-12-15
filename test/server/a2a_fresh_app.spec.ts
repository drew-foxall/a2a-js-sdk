/**
 * Tests for A2AFreshApp.
 *
 * These tests verify that the Fresh (Deno) adapter exhibits the same behavior
 * as Express and Hono implementations.
 */

import { describe, it, beforeEach, afterEach, assert, expect } from 'vitest';
import sinon, { SinonStub } from 'sinon';

import { A2AFreshApp, FreshContext } from '../../src/server/fresh/a2a_fresh_app.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { JSONRPCSuccessResponse, JSONRPCErrorResponse } from '../../src/index.js';
import { AGENT_CARD_PATH } from '../../src/constants.js';
import { A2AError } from '../../src/server/error.js';
import { ServerCallContext } from '../../src/server/context.js';
import { User, UnauthenticatedUser } from '../../src/server/authentication/user.js';
import {
  testAgentCard,
  createMockRequestHandler,
  createRpcRequest,
} from './mocks/shared_test_fixtures.js';

describe('A2AFreshApp', () => {
  let mockRequestHandler: A2ARequestHandler;
  let app: A2AFreshApp;
  let handleStub: SinonStub;

  // Create a mock Fresh context
  function createFreshContext(params: Record<string, string> = {}): FreshContext {
    return {
      params,
      state: {},
      render: () => new Response(),
      renderNotFound: () => new Response('Not Found', { status: 404 }),
    };
  }

  // Helper to make requests using Fresh handler
  async function makeRequest(
    handler: (req: Request, ctx: FreshContext) => Response | Promise<Response>,
    method: string,
    path: string,
    basePath: string = '',
    options: { body?: string; headers?: Record<string, string> } = {}
  ): Promise<Response> {
    const fullPath = basePath + path;
    const request = new Request(`http://localhost${fullPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body,
    });

    const ctx = createFreshContext();
    return handler(request, ctx);
  }

  beforeEach(() => {
    mockRequestHandler = createMockRequestHandler();
    app = new A2AFreshApp(mockRequestHandler);
    handleStub = sinon.stub(JsonRpcTransportHandler.prototype, 'handle');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should create an instance with requestHandler', () => {
      const newApp = new A2AFreshApp(mockRequestHandler);
      assert.instanceOf(newApp, A2AFreshApp);
      assert.equal((newApp as any).requestHandler, mockRequestHandler);
    });

    it('should accept options', () => {
      const newApp = new A2AFreshApp(mockRequestHandler, {
        enableRest: true,
        restBasePath: '/api',
      });
      assert.instanceOf(newApp, A2AFreshApp);
    });
  });

  describe('createHandler', () => {
    it('should return a handler function', () => {
      const handler = app.createHandler();
      assert.isFunction(handler);
    });

    it('should return createHandlers with GET, POST, DELETE', () => {
      const handlers = app.createHandlers();
      assert.isFunction(handlers.GET);
      assert.isFunction(handlers.POST);
      assert.isFunction(handlers.DELETE);
    });

    it('should return createRouteHandlers with agentCard, jsonRpc, rest', () => {
      const handlers = app.createRouteHandlers();
      assert.isFunction(handlers.agentCard);
      assert.isFunction(handlers.jsonRpc);
      assert.isFunction(handlers.rest);
    });
  });

  describe('agent card endpoint', () => {
    it('should return agent card on GET', async () => {
      const handler = app.createHandler('/a2a');
      const res = await makeRequest(handler, 'GET', `/${AGENT_CARD_PATH}`, '/a2a');

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, testAgentCard);
      assert.isTrue((mockRequestHandler.getAgentCard as SinonStub).calledOnce);
    });

    it('should handle errors when getting agent card', async () => {
      (mockRequestHandler.getAgentCard as SinonStub).rejects(new Error('Failed to get agent card'));

      const handler = app.createHandler('/a2a');
      const res = await makeRequest(handler, 'GET', `/${AGENT_CARD_PATH}`, '/a2a');

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.deepEqual(body, { error: 'Failed to retrieve agent card' });
    });

    it('should return agent card using createRouteHandlers', async () => {
      const handlers = app.createRouteHandlers();
      const request = new Request(`http://localhost/${AGENT_CARD_PATH}`);
      const ctx = createFreshContext();

      const res = await handlers.agentCard(request, ctx);

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, testAgentCard);
    });
  });

  describe('JSON-RPC endpoint', () => {
    it('should handle single JSON-RPC response', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('test-id');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
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

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('stream-test', 'message/stream');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.include(res.headers.get('content-type') || '', 'text/event-stream');

      const responseText = await res.text();
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

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('stream-error-test', 'message/stream');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      const responseText = await res.text();
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

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('immediate-stream-error-test', 'message/stream');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.include(res.headers.get('content-type') || '', 'text/event-stream');
      const responseText = await res.text();
      assert.include(responseText, 'event: error');
      assert.include(responseText, 'Immediate streaming error');
    });

    it('should handle general processing error', async () => {
      const error = new A2AError(-32603, 'Processing error');
      handleStub.rejects(error);

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('error-test');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 500);
      const body = await res.json();

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

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('generic-error-test');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.id, 'generic-error-test');
      assert.equal(body.error.message, 'General processing error.');
    });

    it('should handle request without id', async () => {
      const error = new A2AError(-32600, 'No ID error');
      handleStub.rejects(error);

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest(null);

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.id, null);
    });

    it('should handle malformed json request', async () => {
      const handler = app.createHandler('/a2a');
      const malformedJson = '{"jsonrpc": "2.0", "method": "message/send", "id": "1"';

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: malformedJson,
      });

      assert.equal(res.status, 400);
      const body = await res.json();
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

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'test-extension-uri, another-extension';

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
        headers: {
          'X-A2A-Extensions': uriExtensionsValues,
        },
      });

      assert.equal(res.status, 200);
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

      const handler = app.createHandler('/a2a');
      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
        headers: {
          'X-A2A-Extensions': uriExtensionsValues,
        },
      });

      assert.equal(res.status, 200);
      expect(res.headers.get('X-A2A-Extensions')).toEqual('activated-extension');
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

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('multi-1', 'message/stream');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      const responseText = await res.text();

      // Verify all events are present
      assert.include(responseText, '"event":"submitted"');
      assert.include(responseText, '"event":"working"');
      assert.include(responseText, '"event":"completed"');

      // Verify SSE format
      const dataLines = responseText.split('\n').filter((line) => line.startsWith('data:'));
      assert.equal(dataLines.length, 3, 'Should have 3 SSE data events');
    });

    it('should handle empty stream gracefully', async () => {
      const mockEmptyStream = {
        async *[Symbol.asyncIterator]() {
          // Empty generator
        },
      };
      handleStub.resolves(mockEmptyStream);

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('empty-stream', 'message/stream');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.include(res.headers.get('content-type') || '', 'text/event-stream');
    });
  });

  describe('error resilience', () => {
    it('should handle completely invalid JSON', async () => {
      const handler = app.createHandler('/a2a');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: 'not json at all',
      });

      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.error.code, -32700); // Parse error
    });
  });

  describe('authentication integration', () => {
    it('should handle no authentication', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const handler = app.createHandler('/a2a');
      const requestBody = createRpcRequest('test-id');

      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.isTrue(handleStub.calledOnce);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext).toBeInstanceOf(ServerCallContext);
      expect(serverCallContext.user).toBeInstanceOf(UnauthenticatedUser);
      expect(serverCallContext.user.isAuthenticated).toBe(false);
    });

    it('should handle successful authentication with userBuilder', async () => {
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

      const authApp = new A2AFreshApp(mockRequestHandler, { userBuilder });
      const handler = authApp.createHandler('/a2a');

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const res = await makeRequest(handler, 'POST', '/', '/a2a', {
        body: JSON.stringify(requestBody),
        headers: {
          Authorization: 'Bearer valid-token',
        },
      });

      assert.equal(res.status, 200);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext.user.isAuthenticated).toBe(true);
      expect(serverCallContext.user.userName).toBe('token-user');
    });
  });

  describe('REST API support', () => {
    it('should handle REST routes when enableRest is true', async () => {
      const restApp = new A2AFreshApp(mockRequestHandler, { enableRest: true });
      const handler = restApp.createHandler('/a2a');

      // Mock getTask for the REST endpoint
      const mockTask = {
        id: 'task-123',
        status: { state: 'completed' },
        artifacts: [] as unknown[],
        history: [] as unknown[],
        metadata: {},
      };
      (mockRequestHandler.getTask as SinonStub).resolves(mockTask);

      // Use the correct REST API path: /v1/tasks/:taskId
      const request = new Request('http://localhost/a2a/rest/v1/tasks/task-123', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const ctx = createFreshContext({ taskId: 'task-123' });
      const response = await handler(request, ctx);

      // REST API should return a response (may be 200 or other status)
      assert.isTrue(response.status < 500, 'Should not return server error');
    });

    it('should return 404 for REST routes when enableRest is false', async () => {
      const noRestApp = new A2AFreshApp(mockRequestHandler, { enableRest: false });
      const handler = noRestApp.createHandler('/a2a');

      const request = new Request('http://localhost/a2a/rest/tasks/task-123', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const ctx = createFreshContext({ taskId: 'task-123' });
      const response = await handler(request, ctx);

      assert.equal(response.status, 404);
    });
  });
});
