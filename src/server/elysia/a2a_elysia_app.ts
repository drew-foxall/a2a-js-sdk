/**
 * Elysia integration for the A2A Server library.
 *
 * Provides A2AElysiaApp for Bun-native web applications with excellent
 * TypeScript support and performance.
 */

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
} from '../web-standard/handlers.js';
import { UserBuilder } from '../web-standard/types.js';
import { Logger, ConsoleLogger } from '../logging/logger.js';
import { AGENT_CARD_ROUTE } from '../transports/routes.js';

/**
 * Converts HTTP method to lowercase for Elysia routing.
 * Type-safe conversion from 'GET'|'POST'|'DELETE' to 'get'|'post'|'delete'.
 */
function toLowerMethod(method: 'GET' | 'POST' | 'DELETE'): 'get' | 'post' | 'delete' {
  const map = { GET: 'get', POST: 'post', DELETE: 'delete' } as const;
  return map[method];
}

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
 * Configuration options for A2AElysiaApp.
 * Follows the unified A2AServerOptions pattern for consistency across all server implementations.
 */
export interface A2AElysiaOptions {
  /** Logger instance for request/error logging */
  logger?: Logger;
  /** Function to build user from web-standard Request */
  userBuilder?: UserBuilder;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * Route definition for Elysia.
 */
export interface ElysiaRoute {
  method: 'get' | 'post' | 'delete';
  path: string;
  handler: (context: ElysiaContext) => Promise<Response>;
}

/**
 * A2AElysiaApp provides A2A protocol support for Elysia applications.
 *
 * @example
 * ```ts
 * const a2aApp = new A2AElysiaApp(requestHandler, {
 *   enableRest: true,
 *   logger: JsonLogger.create(),
 * });
 *
 * const app = new Elysia();
 * a2aApp.setupRoutes(app, '/a2a');
 * ```
 */
export class A2AElysiaApp {
  private requestHandler: A2ARequestHandler;
  private options: Required<Omit<A2AElysiaOptions, 'userBuilder'>> & { userBuilder?: UserBuilder };

  constructor(requestHandler: A2ARequestHandler, options?: A2AElysiaOptions) {
    this.requestHandler = requestHandler;
    this.options = {
      logger: options?.logger ?? ConsoleLogger.create(),
      userBuilder: options?.userBuilder,
      agentCardPath: options?.agentCardPath ?? AGENT_CARD_ROUTE.pattern,
      enableRest: options?.enableRest ?? false,
      restBasePath: options?.restBasePath ?? '/rest',
    };
  }

  /**
   * Gets the route definitions for A2A endpoints.
   *
   * @param basePath - Base path for routes (default: '')
   * @returns Array of route definitions
   */
  public getRoutes(basePath: string = ''): ElysiaRoute[] {
    const coreOptions = {
      logger: this.options.logger,
      userBuilder: this.options.userBuilder,
    };

    // Create base handlers
    const agentCardHandler = createAgentCardHandler(this.requestHandler, coreOptions);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, coreOptions);

    const routes: ElysiaRoute[] = [
      // Agent card (GET /.well-known/agent-card.json)
      // agentCardPath already includes leading slash from AGENT_CARD_ROUTE.pattern
      {
        method: 'get',
        path: `${basePath}${this.options.agentCardPath}`,
        handler: async (ctx) => agentCardHandler(ctx.request),
      },
      // JSON-RPC (POST /)
      {
        method: 'post',
        path: basePath || '/',
        handler: async (ctx) => jsonRpcHandler(ctx.request),
      },
    ];

    // REST API routes (optional)
    if (this.options.enableRest) {
      const { routes: restRoutes, handleRequest } = createRestHandlers(
        this.requestHandler,
        coreOptions
      );

      for (const route of restRoutes) {
        const elysiaPath = `${basePath}${this.options.restBasePath}${route.pattern}`;

        routes.push({
          method: toLowerMethod(route.method),
          path: elysiaPath,
          handler: async (ctx) => {
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
   * Adds A2A routes to an existing Elysia app.
   *
   * @param app - The Elysia app instance
   * @param baseUrl - Base URL for A2A endpoints (default: '')
   * @returns The Elysia app with A2A routes
   */
  public setupRoutes<
    T extends {
      get: (path: string, handler: (ctx: ElysiaContext) => Promise<Response>) => T;
      post: (path: string, handler: (ctx: ElysiaContext) => Promise<Response>) => T;
      delete: (path: string, handler: (ctx: ElysiaContext) => Promise<Response>) => T;
    },
  >(app: T, baseUrl: string = ''): T {
    const routes = this.getRoutes(baseUrl);

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
}
