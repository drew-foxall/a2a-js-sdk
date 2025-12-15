/**
 * Tests for A2AIttyRouterApp.
 *
 * These tests verify that the itty-router adapter exhibits the same behavior
 * as Express and Hono implementations.
 */

import { describe, it, beforeEach, afterEach, assert, expect } from 'vitest';
import sinon, { SinonStub } from 'sinon';

import { A2AIttyRouterApp, IttyRoute, IttyRequest } from '../../src/server/itty-router/a2a_itty_router_app.js';
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

describe('A2AIttyRouterApp', () => {
  let mockRequestHandler: A2ARequestHandler;
  let app: A2AIttyRouterApp;
  let handleStub: SinonStub;

  // Helper to make requests using the itty-router routes
  async function makeRequest(
    routes: IttyRoute[],
    method: string,
    path: string,
    options: { body?: string; headers?: Record<string, string> } = {}
  ): Promise<Response> {
    // Normalize path for comparison
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    const route = routes.find(
      (r) => r.method === method && matchPath(r.pattern, normalizedPath)
    );

    if (!route) {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }

    const params = extractParams(route.pattern, normalizedPath);
    const request = new Request(`http://localhost${normalizedPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body,
    }) as IttyRequest;

    // Add params to request (itty-router style)
    request.params = params;

    const result = await route.handler(request);
    // Handler can return Response or void
    if (result instanceof Response) {
      return result;
    }
    return new Response(null, { status: 204 });
  }

  // Simple path matching for tests
  function matchPath(pattern: string, path: string): boolean {
    // Normalize both paths
    const normalizedPattern = pattern.replace(/\/+/g, '/');
    const normalizedPath = path.replace(/\/+/g, '/');

    const patternParts = normalizedPattern.split('/').filter(Boolean);
    const pathParts = normalizedPath.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) return false;

    return patternParts.every((part, i) => {
      if (part.startsWith(':')) return true;
      return part === pathParts[i];
    });
  }

  // Extract params from path
  function extractParams(pattern: string, path: string): Record<string, string> {
    const params: Record<string, string> = {};
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');

    patternParts.forEach((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = pathParts[i];
      }
    });

    return params;
  }

  beforeEach(() => {
    mockRequestHandler = createMockRequestHandler();
    app = new A2AIttyRouterApp(mockRequestHandler);
    handleStub = sinon.stub(JsonRpcTransportHandler.prototype, 'handle');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should create an instance with requestHandler', () => {
      const newApp = new A2AIttyRouterApp(mockRequestHandler);
      assert.instanceOf(newApp, A2AIttyRouterApp);
      assert.equal((newApp as any).requestHandler, mockRequestHandler);
    });

    it('should accept options', () => {
      const newApp = new A2AIttyRouterApp(mockRequestHandler, {
        enableRest: true,
        restBasePath: '/api',
      });
      assert.instanceOf(newApp, A2AIttyRouterApp);
    });
  });

  describe('getRoutes', () => {
    it('should return routes array', () => {
      const routes = app.getRoutes();
      assert.isArray(routes);
      assert.isTrue(routes.length > 0);
    });

    it('should include agent card route', () => {
      const routes = app.getRoutes();
      const agentCardRoute = routes.find((r) => r.pattern.includes('agent-card'));
      assert.isDefined(agentCardRoute);
      assert.equal(agentCardRoute!.method, 'GET');
    });

    it('should include JSON-RPC route', () => {
      const routes = app.getRoutes();
      const jsonRpcRoute = routes.find((r) => r.method === 'POST' && r.pattern === '/');
      assert.isDefined(jsonRpcRoute);
    });
  });

  describe('agent card endpoint', () => {
    it('should return agent card on GET', async () => {
      const routes = app.getRoutes();
      const res = await makeRequest(routes, 'GET', `/${AGENT_CARD_PATH}`);

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, testAgentCard);
      assert.isTrue((mockRequestHandler.getAgentCard as SinonStub).calledOnce);
    });

    it('should handle errors when getting agent card', async () => {
      (mockRequestHandler.getAgentCard as SinonStub).rejects(new Error('Failed to get agent card'));

      const routes = app.getRoutes();
      const res = await makeRequest(routes, 'GET', `/${AGENT_CARD_PATH}`);

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.deepEqual(body, { error: 'Failed to retrieve agent card' });
    });

    it('should return agent card on custom path when agentCardPath is provided', () => {
      const customPath = 'custom/agent-card.json';
      const customApp = new A2AIttyRouterApp(mockRequestHandler, { agentCardPath: customPath });
      const routes = customApp.getRoutes();

      const agentCardRoute = routes.find((r) => r.pattern.includes('custom/agent-card'));
      assert.isDefined(agentCardRoute);
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('test-id');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('stream-test', 'message/stream');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('stream-error-test', 'message/stream');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('immediate-stream-error-test', 'message/stream');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('error-test');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('generic-error-test');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest(null);

      const res = await makeRequest(routes, 'POST', '/', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.id, null);
    });

    it('should handle malformed json request', async () => {
      const routes = app.getRoutes();
      const malformedJson = '{"jsonrpc": "2.0", "method": "message/send", "id": "1"';

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'test-extension-uri, another-extension';

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const res = await makeRequest(routes, 'POST', '/', {
        body: JSON.stringify(requestBody),
        headers: {
          'X-A2A-Extensions': uriExtensionsValues,
        },
      });

      assert.equal(res.status, 200);
      expect(res.headers.get('X-A2A-Extensions')).toEqual('activated-extension');
    });
  });

  describe('route configuration', () => {
    it('should mount routes at basePath', () => {
      const baseApp = new A2AIttyRouterApp(mockRequestHandler);
      const routes = baseApp.getRoutes('/api/v1');

      const agentCardRoute = routes.find((r) => r.pattern.includes('agent-card'));
      assert.isDefined(agentCardRoute);
      assert.isTrue(agentCardRoute!.pattern.startsWith('/api/v1'));
    });

    it('should handle empty basePath', () => {
      const routes = app.getRoutes('');

      const agentCardRoute = routes.find((r) => r.pattern.includes('agent-card'));
      assert.isDefined(agentCardRoute);
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('multi-1', 'message/stream');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('empty-stream', 'message/stream');

      const res = await makeRequest(routes, 'POST', '/', {
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.include(res.headers.get('content-type') || '', 'text/event-stream');
    });
  });

  describe('error resilience', () => {
    it('should handle completely invalid JSON', async () => {
      const routes = app.getRoutes();

      const res = await makeRequest(routes, 'POST', '/', {
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

      const routes = app.getRoutes();
      const requestBody = createRpcRequest('test-id');

      const res = await makeRequest(routes, 'POST', '/', {
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

      const authApp = new A2AIttyRouterApp(mockRequestHandler, { userBuilder });
      const routes = authApp.getRoutes();

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const res = await makeRequest(routes, 'POST', '/', {
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
    it('should include REST routes when enableRest is true', () => {
      const restApp = new A2AIttyRouterApp(mockRequestHandler, { enableRest: true });
      const routes = restApp.getRoutes();

      const taskRoutes = routes.filter((r) => r.pattern.includes('/tasks'));
      assert.isTrue(taskRoutes.length > 0, 'Should have task routes');
    });

    it('should not include REST routes when enableRest is false', () => {
      const noRestApp = new A2AIttyRouterApp(mockRequestHandler, { enableRest: false });
      const routes = noRestApp.getRoutes();

      const taskRoutes = routes.filter((r) => r.pattern.includes('/tasks'));
      assert.equal(taskRoutes.length, 0, 'Should not have task routes');
    });
  });
});

