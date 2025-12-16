/**
 * Itty Router integration for the A2A Server library.
 *
 * Provides A2AIttyRouterApp for lightweight Cloudflare Workers applications.
 */

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import {
  createAgentCardHandler,
  createJsonRpcHandler,
  createRestHandlers,
} from '../web-standard/handlers.js';
import { UserBuilder } from '../web-standard/types.js';
import { Logger, ConsoleLogger } from '../logging/logger.js';
import { AGENT_CARD_ROUTE, JSON_RPC_ROUTE } from '../transports/routes.js';

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
 * Configuration options for A2AIttyRouterApp.
 * Follows the unified A2AServerOptions pattern for consistency across all server implementations.
 */
export interface A2AIttyRouterOptions {
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
 * Route definition for itty-router.
 */
export interface IttyRoute {
  method: 'GET' | 'POST' | 'DELETE' | 'ALL';
  pattern: string;
  handler: IttyRouteHandler;
}

/**
 * A2AIttyRouterApp provides A2A protocol support for itty-router applications.
 *
 * @example
 * ```ts
 * const a2aApp = new A2AIttyRouterApp(requestHandler, {
 *   enableRest: true,
 *   logger: JsonLogger.create(),
 * });
 *
 * const router = Router();
 * a2aApp.setupRoutes(router, '/a2a');
 * ```
 */
export class A2AIttyRouterApp {
  private requestHandler: A2ARequestHandler;
  private options: Required<Omit<A2AIttyRouterOptions, 'userBuilder'>> & {
    userBuilder?: UserBuilder;
  };

  constructor(requestHandler: A2ARequestHandler, options?: A2AIttyRouterOptions) {
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
  public getRoutes(basePath: string = ''): IttyRoute[] {
    const coreOptions = {
      logger: this.options.logger,
      userBuilder: this.options.userBuilder,
    };

    // Create base handlers
    const agentCardHandler = createAgentCardHandler(this.requestHandler, coreOptions);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, coreOptions);

    const routes: IttyRoute[] = [
      // Agent card (GET /.well-known/agent-card.json)
      // agentCardPath already includes leading slash from AGENT_CARD_ROUTE.pattern
      {
        method: AGENT_CARD_ROUTE.method,
        pattern: `${basePath}${this.options.agentCardPath}`,
        handler: (request) => agentCardHandler(request),
      },
      // JSON-RPC (POST /)
      {
        method: JSON_RPC_ROUTE.method,
        pattern: `${basePath}${JSON_RPC_ROUTE.pattern}`,
        handler: (request) => jsonRpcHandler(request),
      },
    ];

    // REST API routes (optional)
    if (this.options.enableRest) {
      const { routes: restRoutes, handleRequest } = createRestHandlers(
        this.requestHandler,
        coreOptions
      );

      for (const route of restRoutes) {
        const ittyPattern = `${basePath}${this.options.restBasePath}${route.pattern}`;

        routes.push({
          method: route.method,
          pattern: ittyPattern,
          handler: async (request: IttyRequest) => {
            const url = new URL(request.url);
            const pathname =
              url.pathname.slice((basePath + this.options.restBasePath).length) || '/';
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
   * Adds A2A routes to an existing itty-router Router.
   *
   * @param router - The itty-router Router instance
   * @param baseUrl - Base URL for A2A endpoints (default: '')
   * @returns The router with A2A routes
   */
  public setupRoutes<
    T extends {
      get: (pattern: string, handler: IttyRouteHandler) => T;
      post: (pattern: string, handler: IttyRouteHandler) => T;
      delete: (pattern: string, handler: IttyRouteHandler) => T;
    },
  >(router: T, baseUrl: string = ''): T {
    const routes = this.getRoutes(baseUrl);

    for (const route of routes) {
      switch (route.method) {
        case 'GET':
          router.get(route.pattern, route.handler);
          break;
        case 'POST':
          router.post(route.pattern, route.handler);
          break;
        case 'DELETE':
          router.delete(route.pattern, route.handler);
          break;
      }
    }

    return router;
  }

  /**
   * Creates a single catch-all handler for A2A endpoints.
   * Useful when you want to handle all A2A routes with one registration.
   *
   * @param basePath - Base path for A2A endpoints
   * @returns Single route handler for all A2A endpoints
   */
  public createHandler(basePath: string = '/a2a'): IttyRouteHandler {
    const coreOptions = {
      logger: this.options.logger,
      userBuilder: this.options.userBuilder,
    };

    const agentCardHandler = createAgentCardHandler(this.requestHandler, coreOptions);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, coreOptions);
    const { handleRequest } = createRestHandlers(this.requestHandler, coreOptions);

    return async (request: IttyRequest): Promise<Response> => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method;

      // Strip base path
      const relativePath = pathname.startsWith(basePath)
        ? pathname.slice(basePath.length) || '/'
        : pathname;

      // Agent card - agentCardPath already includes leading slash
      if (method === AGENT_CARD_ROUTE.method && relativePath === this.options.agentCardPath) {
        return agentCardHandler(request);
      }

      // JSON-RPC
      if (method === JSON_RPC_ROUTE.method && relativePath === JSON_RPC_ROUTE.pattern) {
        return jsonRpcHandler(request);
      }

      // REST API
      if (this.options.enableRest && relativePath.startsWith(this.options.restBasePath)) {
        const restPath = relativePath.slice(this.options.restBasePath.length) || '/';
        const response = await handleRequest(request, restPath);
        if (response) return response;
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }
}
