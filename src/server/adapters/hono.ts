/**
 * Hono Adapter for A2A Edge Runtime
 *
 * Provides Hono-specific integration using the web-standard core handlers.
 * Works with Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { createHonoA2AApp } from '@a2a/server/adapters/hono';
 * import { JsonLogger } from '@a2a/server/core';
 *
 * const app = new Hono();
 * const a2a = createHonoA2AApp(requestHandler, {
 *   logger: JsonLogger.create(),
 * });
 *
 * app.route('/a2a', a2a);
 * export default app;
 * ```
 */

import { Hono, Context, MiddlewareHandler } from 'hono';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
  EdgeHandlerOptions,
  AGENT_CARD_ROUTE,
} from '../core/index.js';
import { User } from '../authentication/user.js';

/**
 * Hono-specific options extending the base edge handler options.
 */
export interface HonoA2AOptions extends Omit<EdgeHandlerOptions, 'userBuilder'> {
  /** Function to extract user from Hono context */
  userBuilder?: (c: Context) => Promise<User>;
  /** Middlewares to apply to all A2A routes */
  middlewares?: MiddlewareHandler[];
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Creates a Hono app with A2A endpoints.
 *
 * @param requestHandler - The A2A request handler
 * @param options - Configuration options
 * @returns Hono app instance
 */
export function createHonoA2AApp(
  requestHandler: A2ARequestHandler,
  options?: HonoA2AOptions
): Hono {
  const app = new Hono();

  // Apply middlewares
  if (options?.middlewares) {
    for (const middleware of options.middlewares) {
      app.use(middleware);
    }
  }

  // Convert Hono context-based user builder to request-based
  const honoUserBuilder = options?.userBuilder;
  const baseOptions: EdgeHandlerOptions = {
    logger: options?.logger,
    basePath: options?.basePath,
    // We'll handle user building in the route handlers
  };

  const agentCardPath = options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern;
  const restBasePath = options?.restBasePath ?? '/rest';

  // Create base handlers
  const agentCardHandler = createAgentCardHandler(requestHandler, baseOptions);
  const jsonRpcHandler = createJsonRpcHandler(requestHandler, baseOptions);

  // Agent card endpoint
  app.get(agentCardPath, async (c) => {
    const response = await agentCardHandler(c.req.raw);
    return response;
  });

  // JSON-RPC endpoint
  app.post('/', async (c) => {
    // If we have a Hono user builder, create a custom request with user context
    if (honoUserBuilder) {
      const user = await honoUserBuilder(c);
      // Store user in request for the handler to access
      const requestWithUser = new Request(c.req.raw, {
        headers: c.req.raw.headers,
      });
      // Use a WeakMap or similar to pass user - for now, rebuild options per-request
      const handlerWithUser = createJsonRpcHandler(requestHandler, {
        ...baseOptions,
        userBuilder: () => Promise.resolve(user),
      });
      return handlerWithUser(requestWithUser);
    }
    return jsonRpcHandler(c.req.raw);
  });

  // REST API endpoints (optional)
  if (options?.enableRest) {
    const { routes } = createRestHandlers(requestHandler, baseOptions);

    for (const route of routes) {
      const honoPattern = route.pattern.replace(/:(\w+)/g, ':$1');
      const honoPath = `${restBasePath}${honoPattern}`;

      const handler = async (c: Context) => {
        // Build user builder for this request
        let userBuilder = baseOptions.userBuilder;
        if (honoUserBuilder) {
          const user = await honoUserBuilder(c);
          userBuilder = () => Promise.resolve(user);
        }

        const { handleRequest } = createRestHandlers(requestHandler, {
          ...baseOptions,
          userBuilder,
        });

        const pathname = route.pattern.replace(/:(\w+)/g, (_, name) => c.req.param(name));
        const response = await handleRequest(c.req.raw, pathname);
        return response ?? c.json({ error: 'Not Found' }, 404);
      };

      switch (route.method) {
        case 'GET':
          app.get(honoPath, handler);
          break;
        case 'POST':
          app.post(honoPath, handler);
          break;
        case 'DELETE':
          app.delete(honoPath, handler);
          break;
      }
    }
  }

  return app;
}

// For core utilities (Logger, routes, streaming), import directly from '@a2a/server/core'
