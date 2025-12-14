/**
 * Elysia Adapter for A2A Edge Runtime
 *
 * Provides integration with Elysia, a Bun-native web framework
 * with excellent TypeScript support and performance.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia';
 * import { a2aPlugin } from '@a2a/server/adapters/elysia';
 * import { JsonLogger } from '@a2a/server/core';
 *
 * const app = new Elysia()
 *   .use(a2aPlugin(requestHandler, {
 *     prefix: '/a2a',
 *     logger: JsonLogger.create(),
 *   }))
 *   .listen(3000);
 * ```
 */

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
  EdgeHandlerOptions,
  AGENT_CARD_ROUTE,
} from '../core/index.js';

/**
 * Elysia context type (simplified for adapter).
 */
export interface ElysiaContext {
  request: Request;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  set: {
    status?: number;
    headers: Record<string, string>;
  };
}

/**
 * Elysia plugin function type.
 */
export type ElysiaPlugin<T = unknown> = (app: T) => T;

/**
 * Options for the Elysia adapter.
 */
export interface ElysiaA2AOptions extends EdgeHandlerOptions {
  /** Route prefix (default: '/a2a') */
  prefix?: string;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Route definition for Elysia plugin.
 */
export interface ElysiaRoute {
  method: 'get' | 'post' | 'delete';
  path: string;
  handler: (context: ElysiaContext) => Promise<Response>;
}

/**
 * Creates Elysia route definitions for A2A endpoints.
 * These can be used to manually register routes if not using the plugin.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Array of route definitions
 */
export function createElysiaA2ARoutes(
  requestHandler: A2ARequestHandler,
  options?: ElysiaA2AOptions
): ElysiaRoute[] {
  const prefix = options?.prefix ?? '/a2a';
  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';

  // Create base handlers
  const agentCardHandler = createAgentCardHandler(requestHandler, options);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, options);

  const routes: ElysiaRoute[] = [
    // Agent card
    {
      method: 'get',
      path: `${prefix}${agentCardPath}`,
      handler: async (ctx) => agentCardHandler(ctx.request),
    },
    // JSON-RPC
    {
      method: 'post',
      path: prefix || '/',
      handler: async (ctx) => jsonRpcHandler(ctx.request),
    },
  ];

  // REST API routes (optional)
  if (options?.enableRest) {
    const { routes: restRoutes, handleRequest } = createRestHandlers(requestHandler, options);

    for (const route of restRoutes) {
      // Convert :param to Elysia format (same format)
      const elysiaPath = `${prefix}${restBasePath}${route.pattern}`;

      routes.push({
        method: route.method.toLowerCase() as 'get' | 'post' | 'delete',
        path: elysiaPath,
        handler: async (ctx) => {
          // Build pathname from params
          let pathname = route.pattern;
          for (const [key, value] of Object.entries(ctx.params)) {
            pathname = pathname.replace(`:${key}`, value);
          }
          const response = await handleRequest(ctx.request, pathname);
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
 * Creates an Elysia plugin for A2A endpoints.
 *
 * Note: This returns route definitions that need to be registered
 * with Elysia. Since Elysia's plugin system requires the actual
 * Elysia instance, this function provides the route definitions
 * that can be used with Elysia's fluent API.
 *
 * @example
 * ```ts
 * const routes = createElysiaA2ARoutes(requestHandler, options);
 * let app = new Elysia();
 * for (const route of routes) {
 *   app = app[route.method](route.path, route.handler);
 * }
 * ```
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Route definitions for Elysia
 */
export function a2aPlugin(
  requestHandler: A2ARequestHandler,
  options?: ElysiaA2AOptions
): ElysiaRoute[] {
  return createElysiaA2ARoutes(requestHandler, options);
}

/**
 * Helper to apply A2A routes to an Elysia app.
 * This is a type-safe way to register routes without importing Elysia.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia';
 * import { applyA2ARoutes } from '@a2a/server/edge/elysia';
 *
 * const app = applyA2ARoutes(new Elysia(), requestHandler, options);
 * ```
 */
export function applyA2ARoutes<
  T extends {
    get: (path: string, handler: (ctx: ElysiaContext) => Promise<Response>) => T;
    post: (path: string, handler: (ctx: ElysiaContext) => Promise<Response>) => T;
    delete: (path: string, handler: (ctx: ElysiaContext) => Promise<Response>) => T;
  },
>(app: T, requestHandler: A2ARequestHandler, options?: ElysiaA2AOptions): T {
  const routes = createElysiaA2ARoutes(requestHandler, options);

  for (const route of routes) {
    switch (route.method) {
      case 'get':
        app.get(route.path, route.handler);
        break;
      case 'post':
        app.post(route.path, route.handler);
        break;
      case 'delete':
        app.delete(route.path, route.handler);
        break;
    }
  }

  return app;
}

// For core utilities (Logger, routes, streaming), import directly from '@a2a/server/core'
