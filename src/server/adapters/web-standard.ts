/**
 * Web Standard Adapter for A2A Edge Runtime
 *
 * Pure web-standard implementation with no framework dependencies.
 * Works with any runtime that supports the Fetch API (Request/Response).
 *
 * This is the most portable adapter and can be used as a base
 * for custom framework integrations.
 *
 * @example
 * ```ts
 * // Cloudflare Workers
 * import { createA2AFetchHandler } from '@a2a/server/adapters/web-standard';
 * import { JsonLogger } from '@a2a/server/core';
 *
 * const handler = createA2AFetchHandler(requestHandler, {
 *   logger: JsonLogger.create(),
 * });
 *
 * export default {
 *   fetch: handler,
 * };
 * ```
 *
 * @example
 * ```ts
 * // Deno.serve
 * import { createA2AFetchHandler } from '@a2a/server/adapters/web-standard';
 *
 * const handler = createA2AFetchHandler(requestHandler);
 * Deno.serve(handler);
 * ```
 *
 * @example
 * ```ts
 * // Bun.serve
 * import { createA2AFetchHandler } from '@a2a/server/adapters/web-standard';
 *
 * const handler = createA2AFetchHandler(requestHandler);
 * Bun.serve({ fetch: handler });
 * ```
 */

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
  EdgeHandlerOptions,
  WebRequest,
  WebResponse,
  extractPathParams,
  AGENT_CARD_ROUTE,
  JSON_RPC_ROUTE,
} from '../core/index.js';

/**
 * Options for the web-standard adapter.
 */
export interface WebStandardA2AOptions extends EdgeHandlerOptions {
  /** Base path for all A2A routes (default: '') */
  basePath?: string;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Path for JSON-RPC endpoint (default: '/') */
  jsonRpcPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
  /** Custom 404 handler */
  notFoundHandler?: (request: WebRequest) => WebResponse | Promise<WebResponse>;
  /** Custom error handler */
  errorHandler?: (error: unknown, request: WebRequest) => WebResponse | Promise<WebResponse>;
}

/**
 * Default 404 response.
 */
const defaultNotFound = (): WebResponse =>
  new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Default error response.
 */
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

/**
 * Creates a fetch-compatible handler for A2A endpoints.
 * This is the main entry point for the web-standard adapter.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Fetch-compatible handler function
 */
export function createA2AFetchHandler(
  requestHandler: A2ARequestHandler,
  options?: WebStandardA2AOptions
): (request: WebRequest) => Promise<WebResponse> {
  const basePath = options?.basePath ?? '';
  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const jsonRpcPath = options?.jsonRpcPath ?? JSON_RPC_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';
  const notFoundHandler = options?.notFoundHandler ?? defaultNotFound;
  const errorHandler = options?.errorHandler ?? defaultError;

  // Create base handlers
  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);
  const { handleRequest: handleRestRequest } = createRestHandlers(requestHandler, options);

  return async (request: WebRequest): Promise<WebResponse> => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method;

      // Strip base path if present
      const relativePath =
        basePath && pathname.startsWith(basePath)
          ? pathname.slice(basePath.length) || '/'
          : pathname;

      // Agent card
      if (method === 'GET' && relativePath === agentCardPath) {
        return agentCardHandler(request);
      }

      // JSON-RPC
      if (method === 'POST' && relativePath === jsonRpcPath) {
        return jsonRpcHandler(request);
      }

      // REST API
      if (options?.enableRest && relativePath.startsWith(restBasePath)) {
        const restPath = relativePath.slice(restBasePath.length) || '/';
        const response = await handleRestRequest(request, restPath);
        if (response) return response;
      }

      // Not found
      return notFoundHandler(request);
    } catch (error) {
      return errorHandler(error, request);
    }
  };
}

/**
 * Creates a minimal router for A2A endpoints.
 * Useful when you need more control over routing.
 *
 * @example
 * ```ts
 * const router = createA2ARouter(requestHandler, options);
 *
 * // Use with any fetch-based server
 * export default {
 *   fetch: async (request: Request) => {
 *     const response = await router.handle(request);
 *     if (response) return response;
 *     return new Response('Not Found', { status: 404 });
 *   },
 * };
 * ```
 */
export function createA2ARouter(
  requestHandler: A2ARequestHandler,
  options?: WebStandardA2AOptions
): {
  handle: (request: WebRequest) => Promise<WebResponse | null>;
  routes: Array<{
    method: string;
    pattern: string;
    handler: (request: WebRequest) => Promise<WebResponse>;
  }>;
} {
  const basePath = options?.basePath ?? '';
  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const jsonRpcPath = options?.jsonRpcPath ?? JSON_RPC_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';

  // Create base handlers
  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);
  const { routes: restRoutes, handleRequest: handleRestRequest } = createRestHandlers(
    requestHandler,
    options
  );

  // Build route list
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

  // Add REST routes if enabled
  if (options?.enableRest) {
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

  // Request handler
  const handle = async (request: WebRequest): Promise<WebResponse | null> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    for (const route of routes) {
      if (route.method !== method) continue;

      // Check for exact match or pattern match
      if (route.pattern === pathname) {
        return route.handler(request);
      }

      // Check pattern match with params
      const params = extractPathParams(route.pattern, pathname);
      if (params) {
        return route.handler(request);
      }
    }

    return null;
  };

  return { handle, routes };
}

/**
 * Creates individual handlers for each A2A endpoint type.
 * Useful when you want to compose your own routing.
 *
 * @example
 * ```ts
 * const handlers = createA2AHandlers(requestHandler, options);
 *
 * // Custom routing
 * if (path === '/agent-card') return handlers.agentCard(request);
 * if (path === '/rpc') return handlers.jsonRpc(request);
 * ```
 */
export function createA2AHandlers(
  requestHandler: A2ARequestHandler,
  options?: EdgeHandlerOptions
): {
  agentCard: (request: WebRequest) => Promise<WebResponse>;
  jsonRpc: (request: WebRequest) => Promise<WebResponse>;
  rest: (request: WebRequest, pathname: string) => Promise<WebResponse | null>;
} {
  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);
  const { handleRequest } = createRestHandlers(requestHandler, options);

  return {
    agentCard: agentCardHandler,
    jsonRpc: jsonRpcHandler,
    rest: handleRequest,
  };
}

// For core utilities (Logger, routes, streaming), import directly from '@a2a/server/core'
