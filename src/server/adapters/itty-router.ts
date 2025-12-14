/**
 * Itty Router Adapter for A2A Edge Runtime
 *
 * Provides integration with itty-router, a lightweight router
 * commonly used with Cloudflare Workers.
 *
 * @example
 * ```ts
 * import { Router } from 'itty-router';
 * import { createIttyA2ARoutes } from '@a2a/server/adapters/itty-router';
 * import { JsonLogger } from '@a2a/server/core';
 *
 * const router = Router();
 * const a2aRoutes = createIttyA2ARoutes(requestHandler, {
 *   logger: JsonLogger.create(),
 * });
 *
 * // Mount A2A routes
 * router.all('/a2a/*', a2aRoutes);
 *
 * export default {
 *   fetch: router.handle,
 * };
 * ```
 */

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
  EdgeHandlerOptions,
  AGENT_CARD_ROUTE,
  JSON_RPC_ROUTE,
} from '../core/index.js';

/**
 * Itty Router request type with params.
 */
export interface IttyRequest extends Request {
  params?: Record<string, string>;
  query?: Record<string, string>;
}

/**
 * Itty Router route handler type.
 */
export type IttyRouteHandler = (
  request: IttyRequest,
  ...args: unknown[]
) => Response | Promise<Response> | void | Promise<void>;

/**
 * Options for the Itty Router adapter.
 */
export interface IttyA2AOptions extends EdgeHandlerOptions {
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Route definition for itty-router.
 */
export interface IttyRoute {
  method: 'GET' | 'POST' | 'DELETE' | 'ALL';
  pattern: string;
  handler: IttyRouteHandler;
}

/**
 * Creates itty-router compatible route handlers for A2A endpoints.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Array of route definitions to register with itty-router
 */
export function createIttyA2ARoutes(
  requestHandler: A2ARequestHandler,
  options?: IttyA2AOptions
): IttyRoute[] {
  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';

  // Create base handlers
  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);

  const routes: IttyRoute[] = [
    // Agent card
    {
      method: AGENT_CARD_ROUTE.method,
      pattern: agentCardPath,
      handler: (request) => agentCardHandler(request),
    },
    // JSON-RPC
    {
      method: JSON_RPC_ROUTE.method,
      pattern: JSON_RPC_ROUTE.pattern,
      handler: (request) => jsonRpcHandler(request),
    },
  ];

  // REST API routes (optional)
  if (options?.enableRest) {
    const { routes: restRoutes, handleRequest } = createRestHandlers(requestHandler, options);

    for (const route of restRoutes) {
      // Convert :param to itty-router format (same format)
      const ittyPattern = `${restBasePath}${route.pattern}`;

      routes.push({
        method: route.method,
        pattern: ittyPattern,
        handler: async (request: IttyRequest) => {
          // Extract pathname relative to REST base
          const url = new URL(request.url);
          const pathname = url.pathname.slice(restBasePath.length) || '/';
          const response = await handleRequest(request, pathname);
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

  return routes;
}

/**
 * Creates a single catch-all handler for A2A endpoints.
 * Useful when you want to handle all A2A routes with one registration.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Single route handler for all A2A endpoints
 */
export function createIttyA2AHandler(
  requestHandler: A2ARequestHandler,
  options?: IttyA2AOptions & { basePath: string }
): IttyRouteHandler {
  const basePath = options?.basePath ?? '/a2a';
  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';

  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);
  const { handleRequest } = createRestHandlers(requestHandler, options);

  return async (request: IttyRequest): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Strip base path
    const relativePath = pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || '/'
      : pathname;

    // Agent card
    if (method === AGENT_CARD_ROUTE.method && relativePath === agentCardPath) {
      return agentCardHandler(request);
    }

    // JSON-RPC
    if (method === JSON_RPC_ROUTE.method && relativePath === JSON_RPC_ROUTE.pattern) {
      return jsonRpcHandler(request);
    }

    // REST API
    if (options?.enableRest && relativePath.startsWith(restBasePath)) {
      const restPath = relativePath.slice(restBasePath.length) || '/';
      const response = await handleRequest(request, restPath);
      if (response) return response;
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

// For core utilities (Logger, routes, streaming), import directly from '@a2a/server/core'
