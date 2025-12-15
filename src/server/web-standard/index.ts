/**
 * Web Standard integration for the A2A Server library.
 *
 * Pure web-standard implementation with no framework dependencies.
 * Works with any runtime that supports the Fetch API (Request/Response).
 *
 * This is the most portable implementation and can be used as a base
 * for custom framework integrations.
 *
 * @example
 * ```ts
 * // Cloudflare Workers
 * import { A2AWebStandardApp } from '@drew-foxall/a2a-js-sdk/server/web-standard';
 * import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
 *
 * const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
 * const a2aApp = new A2AWebStandardApp(requestHandler, { enableRest: true });
 *
 * export default {
 *   fetch: a2aApp.createHandler(),
 * };
 * ```
 *
 * @example
 * ```ts
 * // Deno.serve
 * Deno.serve(a2aApp.createHandler());
 * ```
 *
 * @example
 * ```ts
 * // Bun.serve
 * Bun.serve({ fetch: a2aApp.createHandler() });
 * ```
 */

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { createAgentCardHandler, createJsonRpcHandler, createRestHandlers } from './handlers.js';
import { WebRequest, WebResponse, extractPathParams, A2AServerOptions } from './types.js';
import { AGENT_CARD_ROUTE, JSON_RPC_ROUTE } from '../transports/routes.js';

/**
 * Options for the Web Standard A2A app.
 */
export interface A2AWebStandardOptions extends A2AServerOptions {
  /** Path for JSON-RPC endpoint (default: '/') */
  jsonRpcPath?: string;
  /** Custom 404 handler */
  notFoundHandler?: (request: WebRequest) => WebResponse | Promise<WebResponse>;
  /** Custom error handler */
  errorHandler?: (error: unknown, request: WebRequest) => WebResponse | Promise<WebResponse>;
}

const defaultNotFound = (): WebResponse =>
  new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

const defaultError = (error: unknown): WebResponse =>
  new Response(
    JSON.stringify({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );

export class A2AWebStandardApp {
  private requestHandler: A2ARequestHandler;
  private options: A2AWebStandardOptions;

  constructor(requestHandler: A2ARequestHandler, options?: A2AWebStandardOptions) {
    this.requestHandler = requestHandler;
    this.options = {
      ...options,
      agentCardPath: options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern,
      jsonRpcPath: options?.jsonRpcPath ?? JSON_RPC_ROUTE.pattern,
      restBasePath: options?.restBasePath ?? '',
      notFoundHandler: options?.notFoundHandler ?? defaultNotFound,
      errorHandler: options?.errorHandler ?? defaultError,
    };
  }

  public createHandler(basePath: string = ''): (request: WebRequest) => Promise<WebResponse> {
    const agentCardPath = this.options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
    const jsonRpcPath = this.options?.jsonRpcPath ?? JSON_RPC_ROUTE.pattern;
    const restBasePath = this.options?.restBasePath ?? '';
    const notFoundHandler = this.options?.notFoundHandler ?? defaultNotFound;
    const errorHandler = this.options?.errorHandler ?? defaultError;

    const agentCardHandler = createAgentCardHandler(this.requestHandler, this.options);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, this.options);
    const { handleRequest: handleRestRequest } = createRestHandlers(
      this.requestHandler,
      this.options
    );

    return async (request: WebRequest): Promise<WebResponse> => {
      try {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method;

        const relativePath =
          basePath && pathname.startsWith(basePath)
            ? pathname.slice(basePath.length) || '/'
            : pathname;

        if (method === 'GET' && relativePath === agentCardPath) {
          return agentCardHandler(request);
        }

        if (method === 'POST' && relativePath === jsonRpcPath) {
          return jsonRpcHandler(request);
        }

        if (this.options?.enableRest && relativePath.startsWith(restBasePath)) {
          const restPath = relativePath.slice(restBasePath.length) || '/';
          const response = await handleRestRequest(request, restPath);
          if (response) return response;
        }

        return notFoundHandler(request);
      } catch (error) {
        return errorHandler(error, request);
      }
    };
  }

  public createRouter(basePath: string = ''): {
    handle: (request: WebRequest) => Promise<WebResponse | null>;
    routes: Array<{
      method: string;
      pattern: string;
      handler: (request: WebRequest) => Promise<WebResponse>;
    }>;
  } {
    const agentCardPath = this.options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
    const jsonRpcPath = this.options?.jsonRpcPath ?? JSON_RPC_ROUTE.pattern;
    const restBasePath = this.options?.restBasePath ?? '/rest';

    const agentCardHandler = createAgentCardHandler(this.requestHandler, this.options);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, this.options);
    const { routes: restRoutes, handleRequest: handleRestRequest } = createRestHandlers(
      this.requestHandler,
      this.options
    );

    const routes: Array<{
      method: string;
      pattern: string;
      handler: (request: WebRequest) => Promise<WebResponse>;
    }> = [
      {
        method: 'GET',
        pattern: `${basePath}${agentCardPath}`,
        handler: agentCardHandler,
      },
      {
        method: 'POST',
        pattern: `${basePath}${jsonRpcPath}`,
        handler: jsonRpcHandler,
      },
    ];

    if (this.options?.enableRest) {
      for (const route of restRoutes) {
        routes.push({
          method: route.method,
          pattern: `${basePath}${restBasePath}${route.pattern}`,
          handler: async (request) => {
            const url = new URL(request.url);
            const pathname = url.pathname;
            const restPath = pathname.slice((basePath + restBasePath).length) || '/';
            const response = await handleRestRequest(request, restPath);
            return (
              response ??
              new Response(JSON.stringify({ error: 'Not Found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          },
        });
      }
    }

    const handle = async (request: WebRequest): Promise<WebResponse | null> => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method;

      for (const route of routes) {
        if (route.method !== method) continue;

        if (route.pattern === pathname) {
          return route.handler(request);
        }

        const params = extractPathParams(route.pattern, pathname);
        if (params) {
          return route.handler(request);
        }
      }

      return null;
    };

    return { handle, routes };
  }

  public createHandlers(): {
    agentCard: (request: WebRequest) => Promise<WebResponse>;
    jsonRpc: (request: WebRequest) => Promise<WebResponse>;
    rest: (request: WebRequest, pathname: string) => Promise<WebResponse | null>;
  } {
    const agentCardHandler = createAgentCardHandler(this.requestHandler, this.options);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, this.options);
    const { handleRequest } = createRestHandlers(this.requestHandler, this.options);

    return {
      agentCard: agentCardHandler,
      jsonRpc: jsonRpcHandler,
      rest: handleRequest,
    };
  }
}

// Re-export types from types.ts
export {
  WebRequest,
  WebResponse,
  UserBuilder,
  A2AServerOptions,
  SSEEvent,
  formatSSE,
  formatSSEData,
  formatSSEError,
  SSE_HEADERS,
  createSSEResponse,
  jsonResponse,
  noContentResponse,
  parseJsonBody,
  extractPathParams,
  generateId,
} from './types.js';

// Re-export handlers
export {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
  createA2AHandler,
} from './handlers.js';
export type { AgentCardHandlerOptions, A2AHandlerConfig } from './handlers.js';

// Re-export logging
export { Logger, ConsoleLogger, JsonLogger, NoopLogger } from '../logging/logger.js';
export type { LogLevel, LogContext, LogContextError } from '../logging/logger.js';

// Re-export routes
export {
  AGENT_CARD_ROUTE,
  JSON_RPC_ROUTE,
  REST_ROUTES,
  HTTP_STATUS,
} from '../transports/routes.js';
export type { HttpMethod, HttpStatusCode, A2ARouteDefinition } from '../transports/routes.js';
