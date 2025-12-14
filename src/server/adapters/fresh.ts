/**
 * Fresh Adapter for A2A Edge Runtime
 *
 * Provides integration with Fresh, the Deno web framework.
 * Fresh uses file-based routing, so this adapter provides
 * handlers that can be used in route files.
 *
 * @example
 * ```ts
 * // routes/a2a/[...path].ts
 * import { createFreshA2AHandler } from '@a2a/server/adapters/fresh';
 * import { JsonLogger } from '@a2a/server/core';
 *
 * const handler = createFreshA2AHandler(requestHandler, {
 *   logger: JsonLogger.create(),
 * });
 *
 * export const handler: Handlers = {
 *   GET: handler,
 *   POST: handler,
 *   DELETE: handler,
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
 * Fresh handler context type.
 */
export interface FreshContext {
  params: Record<string, string>;
  state: Record<string, unknown>;
  render: (data?: unknown) => Response | Promise<Response>;
  renderNotFound: () => Response | Promise<Response>;
}

/**
 * Fresh handler function type.
 */
export type FreshHandler = (request: Request, ctx: FreshContext) => Response | Promise<Response>;

/**
 * Fresh Handlers object type.
 */
export interface FreshHandlers {
  GET?: FreshHandler;
  POST?: FreshHandler;
  PUT?: FreshHandler;
  DELETE?: FreshHandler;
  PATCH?: FreshHandler;
}

/**
 * Options for the Fresh adapter.
 */
export interface FreshA2AOptions extends EdgeHandlerOptions {
  /** Base path for A2A routes (default: '/a2a') */
  basePath?: string;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Creates a Fresh-compatible handler for A2A endpoints.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Fresh handler function
 */
export function createFreshA2AHandler(
  requestHandler: A2ARequestHandler,
  options?: FreshA2AOptions
): FreshHandler {
  const basePath = options?.basePath ?? '/a2a';
  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';

  // Create base handlers
  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);
  const { handleRequest } = createRestHandlers(requestHandler, options);

  return async (request: Request, _ctx: FreshContext): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Calculate relative path from base
    const relativePath = pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || '/'
      : pathname;

    // Agent card
    if (method === AGENT_CARD_ROUTE.method && relativePath === agentCardPath) {
      return agentCardHandler(request);
    }

    // JSON-RPC (POST to root)
    if (method === JSON_RPC_ROUTE.method && relativePath === JSON_RPC_ROUTE.pattern) {
      return jsonRpcHandler(request);
    }

    // REST API
    if (options?.enableRest && relativePath.startsWith(restBasePath)) {
      const restPath = relativePath.slice(restBasePath.length) || '/';
      const response = await handleRequest(request, restPath);
      if (response) return response;
    }

    // Not found
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * Creates Fresh Handlers object for A2A endpoints.
 * This is the recommended way to use A2A with Fresh.
 *
 * @example
 * ```ts
 * // routes/a2a/[...path].ts
 * import { createFreshA2AHandlers } from '@a2a/server/edge/fresh';
 *
 * export const handler = createFreshA2AHandlers(requestHandler);
 * ```
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Fresh Handlers object
 */
export function createFreshA2AHandlers(
  requestHandler: A2ARequestHandler,
  options?: FreshA2AOptions
): FreshHandlers {
  const handler = createFreshA2AHandler(requestHandler, options);

  return {
    GET: handler,
    POST: handler,
    DELETE: handler,
  };
}

/**
 * Creates individual route handlers for Fresh's file-based routing.
 * Use this when you want separate route files for each endpoint.
 *
 * @example
 * ```ts
 * // routes/.well-known/agent-card.json.ts
 * import { agentCardHandler } from './a2a-handlers.ts';
 * export const handler: Handlers = { GET: agentCardHandler };
 *
 * // routes/a2a/index.ts
 * import { jsonRpcHandler } from './a2a-handlers.ts';
 * export const handler: Handlers = { POST: jsonRpcHandler };
 * ```
 */
export function createFreshRouteHandlers(
  requestHandler: A2ARequestHandler,
  options?: EdgeHandlerOptions
): {
  agentCard: FreshHandler;
  jsonRpc: FreshHandler;
  rest: FreshHandler;
} {
  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);
  const { handleRequest } = createRestHandlers(requestHandler, options);

  return {
    agentCard: async (request) => agentCardHandler(request),
    jsonRpc: async (request) => jsonRpcHandler(request),
    rest: async (request, _ctx) => {
      const url = new URL(request.url);
      // Fresh provides path params in ctx.params
      // For REST routes, we need to reconstruct the path
      const pathname = url.pathname;
      const response = await handleRequest(request, pathname);
      return (
        response ??
        new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    },
  };
}

// For core utilities (Logger, routes, streaming), import directly from '@a2a/server/core'
