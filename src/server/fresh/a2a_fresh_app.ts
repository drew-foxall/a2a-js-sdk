/**
 * Fresh integration for the A2A Server library.
 *
 * Provides A2AFreshApp for Deno's Fresh web framework.
 * Fresh uses file-based routing, so this adapter provides handlers
 * that can be used in route files.
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
 * Configuration options for A2AFreshApp.
 * Follows the unified A2AServerOptions pattern for consistency across all server implementations.
 */
export interface A2AFreshOptions {
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
 * A2AFreshApp provides A2A protocol support for Fresh applications.
 *
 * @example
 * ```ts
 * const a2aApp = new A2AFreshApp(requestHandler, {
 *   enableRest: true,
 *   logger: JsonLogger.create(),
 * });
 *
 * // In your route file:
 * export const handler = a2aApp.createHandlers('/a2a');
 * ```
 */
export class A2AFreshApp {
  private requestHandler: A2ARequestHandler;
  private options: Required<Omit<A2AFreshOptions, 'userBuilder'>> & { userBuilder?: UserBuilder };

  constructor(requestHandler: A2ARequestHandler, options?: A2AFreshOptions) {
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
   * Creates a Fresh-compatible handler for A2A endpoints.
   *
   * @param basePath - Base path for A2A routes (default: '/a2a')
   * @returns Fresh handler function
   */
  public createHandler(basePath: string = '/a2a'): FreshHandler {
    const coreOptions = {
      logger: this.options.logger,
      userBuilder: this.options.userBuilder,
    };

    // Create base handlers
    const agentCardHandler = createAgentCardHandler(this.requestHandler, coreOptions);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, coreOptions);
    const { handleRequest } = createRestHandlers(this.requestHandler, coreOptions);

    return async (request: Request, _ctx: FreshContext): Promise<Response> => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method;

      // Calculate relative path from base
      const relativePath = pathname.startsWith(basePath)
        ? pathname.slice(basePath.length) || '/'
        : pathname;

      // Agent card - agentCardPath may or may not have leading slash
      const normalizedAgentCardPath = this.options.agentCardPath.startsWith('/')
        ? this.options.agentCardPath
        : `/${this.options.agentCardPath}`;
      if (method === AGENT_CARD_ROUTE.method && relativePath === normalizedAgentCardPath) {
        return agentCardHandler(request);
      }

      // JSON-RPC (POST to root)
      if (method === JSON_RPC_ROUTE.method && relativePath === JSON_RPC_ROUTE.pattern) {
        return jsonRpcHandler(request);
      }

      // REST API
      if (this.options.enableRest && relativePath.startsWith(this.options.restBasePath)) {
        const restPath = relativePath.slice(this.options.restBasePath.length) || '/';
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
   * export const handler = a2aApp.createHandlers('/a2a');
   * ```
   *
   * @param basePath - Base path for A2A routes (default: '/a2a')
   * @returns Fresh Handlers object
   */
  public createHandlers(basePath: string = '/a2a'): FreshHandlers {
    const handler = this.createHandler(basePath);

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
   * const { agentCard, jsonRpc, rest } = a2aApp.createRouteHandlers();
   *
   * // routes/.well-known/agent-card.json.ts
   * export const handler: Handlers = { GET: agentCard };
   *
   * // routes/a2a/index.ts
   * export const handler: Handlers = { POST: jsonRpc };
   * ```
   */
  public createRouteHandlers(): {
    agentCard: FreshHandler;
    jsonRpc: FreshHandler;
    rest: FreshHandler;
  } {
    const coreOptions = {
      logger: this.options.logger,
      userBuilder: this.options.userBuilder,
    };

    const agentCardHandler = createAgentCardHandler(this.requestHandler, coreOptions);
    const jsonRpcHandler = createJsonRpcHandler(this.requestHandler, coreOptions);
    const { handleRequest } = createRestHandlers(this.requestHandler, coreOptions);

    return {
      agentCard: async (request) => agentCardHandler(request),
      jsonRpc: async (request) => jsonRpcHandler(request),
      rest: async (request, _ctx) => {
        const url = new URL(request.url);
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
}
