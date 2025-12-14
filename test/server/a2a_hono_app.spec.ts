import { describe, it, beforeEach, afterEach, assert, expect } from 'vitest';
import sinon, { SinonStub } from 'sinon';
import { Hono, Context } from 'hono';

import { A2AHonoApp } from '../../src/server/hono/a2a_hono_app.js';
import { jsonRpcHandler } from '../../src/server/hono/json_rpc_handler.js';
import { A2ARequestHandler } from '../../src/server/request_handler/a2a_request_handler.js';
import { JsonRpcTransportHandler } from '../../src/server/transports/jsonrpc/jsonrpc_transport_handler.js';
import { AgentCard, JSONRPCSuccessResponse, JSONRPCErrorResponse } from '../../src/index.js';
import { AGENT_CARD_PATH } from '../../src/constants.js';
import { A2AError } from '../../src/server/error.js';
import { ServerCallContext } from '../../src/server/context.js';
import { User, UnauthenticatedUser } from '../../src/server/authentication/user.js';

describe('A2AHonoApp', () => {
  let mockRequestHandler: A2ARequestHandler;
  let app: A2AHonoApp;
  let honoApp: Hono;
  let handleStub: SinonStub;

  // Helper function to create JSON-RPC request bodies
  const createRpcRequest = (id: string | null, method = 'message/send', params: object = {}) => ({
    jsonrpc: '2.0',
    method,
    id,
    params,
  });

  const testAgentCard: AgentCard = {
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

  beforeEach(() => {
    mockRequestHandler = {
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

    app = new A2AHonoApp(mockRequestHandler);
    honoApp = new Hono();

    handleStub = sinon.stub(JsonRpcTransportHandler.prototype, 'handle');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should create an instance with requestHandler', () => {
      const newApp = new A2AHonoApp(mockRequestHandler);
      assert.instanceOf(newApp, A2AHonoApp);
      assert.equal((newApp as any).requestHandler, mockRequestHandler);
    });
  });

  describe('setupRoutes', () => {
    it('should setup routes with default parameters', () => {
      const setupApp = app.setupRoutes(honoApp);
      assert.equal(setupApp, honoApp);
    });
  });

  describe('agent card endpoint', () => {
    beforeEach(() => {
      app.setupRoutes(honoApp);
    });

    it('should return agent card on GET /.well-known/agent-card.json', async () => {
      const res = await honoApp.request(`/${AGENT_CARD_PATH}`);

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, testAgentCard);
      assert.isTrue((mockRequestHandler.getAgentCard as SinonStub).calledOnce);
    });

    it('should return agent card on custom path when agentCardPath is provided', async () => {
      const customPath = 'custom/agent-card.json';
      const customHonoApp = new Hono();
      app.setupRoutes(customHonoApp, '', undefined, customPath);

      const res = await customHonoApp.request(`/${customPath}`);

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, testAgentCard);
    });

    it('should handle errors when getting agent card', async () => {
      const errorMessage = 'Failed to get agent card';
      (mockRequestHandler.getAgentCard as SinonStub).rejects(new Error(errorMessage));

      const res = await honoApp.request(`/${AGENT_CARD_PATH}`);

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.deepEqual(body, { error: 'Failed to retrieve agent card' });
    });
  });

  describe('JSON-RPC endpoint', () => {
    beforeEach(() => {
      app.setupRoutes(honoApp);
    });

    it('should handle single JSON-RPC response', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };

      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, mockResponse);
      assert.isTrue(handleStub.calledOnceWith(requestBody));
    });

    it('should handle streaming JSON-RPC response', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield { jsonrpc: '2.0', id: 'stream-1', result: { step: 1 } };
          yield { jsonrpc: '2.0', id: 'stream-2', result: { step: 2 } };
        },
      };

      handleStub.resolves(mockStreamResponse);

      const requestBody = createRpcRequest('stream-test', 'message/stream');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      const requestBody = createRpcRequest('stream-error-test', 'message/stream');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      const requestBody = createRpcRequest('immediate-stream-error-test', 'message/stream');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      const requestBody = createRpcRequest('error-test');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      const requestBody = createRpcRequest('generic-error-test');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      const requestBody = createRpcRequest(null);

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.id, null);
    });

    it('should handle malformed json request', async () => {
      const malformedJson = '{"jsonrpc": "2.0", "method": "message/send", "id": "1"'; // Missing closing brace

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: malformedJson,
      });

      assert.equal(res.status, 400);
      const body = await res.json();

      const expectedErrorResponse: JSONRPCErrorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Invalid JSON payload.',
        },
      };
      assert.deepEqual(body, expectedErrorResponse);
    });

    it('should handle extensions headers in request', async () => {
      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const uriExtensionsValues = 'test-extension-uri, another-extension';

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-A2A-Extensions': uriExtensionsValues,
          'Not-Relevant-Header': 'unused-value',
        },
        body: JSON.stringify(requestBody),
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

      handleStub.callsFake(async (requestBody: any, serverCallContext: ServerCallContext) => {
        const firstRequestedExtension = serverCallContext.requestedExtensions
          ?.values()
          .next().value;
        serverCallContext.addActivatedExtension(firstRequestedExtension);
        return mockResponse;
      });

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-A2A-Extensions': uriExtensionsValues,
          'Not-Relevant-Header': 'unused-value',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      expect(res.headers.get('X-A2A-Extensions')).toEqual('activated-extension');
    });
  });

  describe('middleware integration', () => {
    it('should apply custom middlewares to routes', async () => {
      const middlewareCalled = sinon.spy();
      const testMiddleware: any = async (c: any, next: any) => {
        middlewareCalled();
        await next();
      };

      const middlewareApp = new Hono();
      app.setupRoutes(middlewareApp, '', [testMiddleware]);

      const res = await middlewareApp.request(`/${AGENT_CARD_PATH}`, {
        method: 'GET',
      });

      assert.equal(res.status, 200);
      assert.isTrue(middlewareCalled.calledOnce);
    });

    it('should handle middleware errors', async () => {
      const errorMiddleware: any = async (_c: any, _next: any) => {
        throw new Error('Middleware error');
      };

      const middlewareApp = new Hono();

      // Add error handling middleware
      middlewareApp.onError((err, c) => {
        return c.json({ error: err.message }, 500);
      });

      app.setupRoutes(middlewareApp, '', [errorMiddleware]);

      const res = await middlewareApp.request(`/${AGENT_CARD_PATH}`, {
        method: 'GET',
      });

      assert.equal(res.status, 500);
    });
  });

  describe('route configuration', () => {
    it('should mount routes at baseUrl', async () => {
      const baseUrl = '/api/v1';
      const basedApp = new Hono();
      app.setupRoutes(basedApp, baseUrl);

      const res = await basedApp.request(`${baseUrl}/${AGENT_CARD_PATH}`);
      assert.equal(res.status, 200);
    });

    it('should handle empty baseUrl', async () => {
      const emptyBaseApp = new Hono();
      app.setupRoutes(emptyBaseApp, '');

      const res = await emptyBaseApp.request(`/${AGENT_CARD_PATH}`);
      assert.equal(res.status, 200);
    });

    it('should handle JSON parsing automatically', async () => {
      const jsonApp = new Hono();
      app.setupRoutes(jsonApp);

      const requestBody = createRpcRequest('test-id', 'message/send', { test: 'data' });

      const res = await jsonApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.isTrue(handleStub.calledOnceWith(requestBody));
    });
  });

  describe('SSE streaming lifecycle', () => {
    beforeEach(() => {
      app.setupRoutes(honoApp);
    });

    it('should properly handle multiple streaming events', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield { jsonrpc: '2.0', id: 'multi-1', result: { event: 'submitted' } };
          yield { jsonrpc: '2.0', id: 'multi-1', result: { event: 'working' } };
          yield { jsonrpc: '2.0', id: 'multi-1', result: { event: 'completed' } };
        },
      };

      handleStub.resolves(mockStreamResponse);

      const requestBody = createRpcRequest('multi-1', 'message/stream');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      const responseText = await res.text();

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

      const requestBody = createRpcRequest('empty-stream', 'message/stream');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.include(res.headers.get('content-type') || '', 'text/event-stream');
    });
  });

  describe('error resilience', () => {
    beforeEach(() => {
      app.setupRoutes(honoApp);
    });

    it('should handle invalid content type gracefully', async () => {
      const requestBody = createRpcRequest('test-id');

      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify(requestBody),
      });

      // Hono should still attempt to parse JSON
      // The exact behavior depends on the implementation
      assert.isNumber(res.status);
    });

    it('should handle completely invalid JSON', async () => {
      const res = await honoApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'not json at all',
      });

      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.error.code, -32700); // Parse error
    });
  });

  describe('authentication integration', () => {
    it('should handle no authentication middlewares', async () => {
      const authApp = new Hono();
      const jsonRpc = jsonRpcHandler({ requestHandler: mockRequestHandler });
      authApp.route('/', jsonRpc);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const res = await authApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.isTrue(handleStub.calledOnce);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext).toBeInstanceOf(ServerCallContext);
      expect(serverCallContext.user).toBeInstanceOf(UnauthenticatedUser);
      expect(serverCallContext.user.isAuthenticated).toBe(false);
    });

    it('should handle successful authentication with class', async () => {
      class CustomUser {
        get isAuthenticated(): boolean {
          return true;
        }
        get userName(): string {
          return 'authenticated-user';
        }
      }

      const userExtractor = (_c: Context): Promise<User> => {
        return Promise.resolve(new CustomUser() as User);
      };

      const authApp = new Hono();
      const jsonRpc = jsonRpcHandler({
        requestHandler: mockRequestHandler,
        userBuilder: userExtractor,
      });
      authApp.route('/', jsonRpc);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const res = await authApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.isTrue(handleStub.calledOnce);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext).toBeInstanceOf(ServerCallContext);
      expect(serverCallContext.user.isAuthenticated).toBe(true);
      expect(serverCallContext.user.userName).toBe('authenticated-user');
    });

    it('should handle successful authentication with plain object', async () => {
      const userExtractor = (_c: Context): Promise<User> => {
        class CustomUser implements User {
          constructor(private userData: { id: number; email: string }) {}
          get isAuthenticated(): boolean {
            return true;
          }
          get userName(): string {
            return this.userData.email;
          }
          public getId(): number {
            return this.userData.id;
          }
        }

        return Promise.resolve(new CustomUser({ id: 123, email: 'test_email' }) as User);
      };

      const authApp = new Hono();
      const jsonRpc = jsonRpcHandler({
        requestHandler: mockRequestHandler,
        userBuilder: userExtractor,
      });
      authApp.route('/', jsonRpc);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const res = await authApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.isTrue(handleStub.calledOnce);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext).toBeInstanceOf(ServerCallContext);
      expect(serverCallContext.user.isAuthenticated).toBe(true);
      expect(serverCallContext.user.userName).toBe('test_email');
      expect((serverCallContext.user as any).getId()).toBe(123);
    });

    it('should extract user info from request context', async () => {
      // Simulate extracting user from headers (like JWT token)
      const userExtractor = (c: Context): Promise<User> => {
        const authHeader = c.req.header('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          // Simulate token validation
          if (token === 'valid-token') {
            return Promise.resolve({
              isAuthenticated: true,
              userName: 'token-user',
            } as User);
          }
        }
        return Promise.resolve(new UnauthenticatedUser());
      };

      const authApp = new Hono();
      const jsonRpc = jsonRpcHandler({
        requestHandler: mockRequestHandler,
        userBuilder: userExtractor,
      });
      authApp.route('/', jsonRpc);

      const mockResponse: JSONRPCSuccessResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { message: 'success' },
      };
      handleStub.resolves(mockResponse);

      const requestBody = createRpcRequest('test-id');
      const res = await authApp.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.isTrue(handleStub.calledOnce);
      const serverCallContext = handleStub.getCall(0).args[1];
      expect(serverCallContext.user.isAuthenticated).toBe(true);
      expect(serverCallContext.user.userName).toBe('token-user');
    });
  });
});
