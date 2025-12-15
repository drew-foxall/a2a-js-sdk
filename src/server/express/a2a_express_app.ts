import express, { Express, RequestHandler, ErrorRequestHandler } from 'express';

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { AGENT_CARD_PATH } from '../../constants.js';
import { jsonErrorHandler, jsonRpcHandler } from './json_rpc_handler.js';
import { agentCardHandler } from './agent_card_handler.js';
import { restHandler } from './rest_handler.js';
import { UserBuilder } from './common.js';
import { Logger, ConsoleLogger } from '../core/index.js';

/**
 * Configuration options for A2AExpressApp.
 * Extends the base A2AServerOptions pattern for consistency across all server implementations.
 */
export interface A2AExpressOptions {
  /** Logger instance for request/error logging */
  logger?: Logger;
  /** Function to build user from Express Request */
  userBuilder?: UserBuilder;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

/**
 * A2AExpressApp provides A2A protocol support for Express applications.
 *
 * @example
 * ```ts
 * // New API with options object
 * import express from 'express';
 * import { A2AExpressApp } from '@drew-foxall/a2a-js-sdk/server/express';
 * import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
 *
 * const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
 * const a2aApp = new A2AExpressApp(requestHandler, {
 *   enableRest: true,
 * });
 *
 * const app = express();
 * a2aApp.setupRoutes(app, '/a2a');
 * app.listen(3000);
 * ```
 *
 * @example
 * ```ts
 * // Legacy API with userBuilder function (still supported)
 * const a2aApp = new A2AExpressApp(requestHandler, myUserBuilder);
 * ```
 */
export class A2AExpressApp {
  private requestHandler: A2ARequestHandler;
  private options: Required<Omit<A2AExpressOptions, 'logger'>> & { logger: Logger };

  /**
   * Creates a new A2AExpressApp instance.
   *
   * @param requestHandler - The A2A request handler
   * @param optionsOrUserBuilder - Either an options object or a UserBuilder function (legacy API)
   */
  constructor(
    requestHandler: A2ARequestHandler,
    optionsOrUserBuilder?: A2AExpressOptions | UserBuilder
  ) {
    this.requestHandler = requestHandler;

    // Support both new options object and legacy userBuilder function
    const isUserBuilder = typeof optionsOrUserBuilder === 'function';
    const options = isUserBuilder ? { userBuilder: optionsOrUserBuilder } : optionsOrUserBuilder;

    this.options = {
      logger: options?.logger ?? ConsoleLogger.create(),
      userBuilder: options?.userBuilder ?? UserBuilder.noAuthentication,
      agentCardPath: options?.agentCardPath ?? AGENT_CARD_PATH,
      enableRest: options?.enableRest ?? false,
      restBasePath: options?.restBasePath ?? '/rest',
    };
  }

  /**
   * Adds A2A routes to an existing Express app.
   *
   * @param app - The Express app instance
   * @param baseUrl - The base URL for A2A endpoints (e.g., "/a2a")
   * @param middlewares - Optional array of Express middlewares to apply to the A2A routes
   * @param agentCardPath - Optional custom path for the agent card endpoint (overrides constructor option)
   * @returns The Express app with A2A routes
   */
  public setupRoutes(
    app: Express,
    baseUrl: string = '',
    middlewares?: Array<RequestHandler | ErrorRequestHandler>,
    agentCardPath?: string
  ): Express {
    const router = express.Router();
    const cardPath = agentCardPath ?? this.options.agentCardPath;

    // JSON body parsing with error handling
    router.use(express.json(), jsonErrorHandler);

    // Apply custom middlewares if provided
    if (middlewares && middlewares.length > 0) {
      router.use(middlewares);
    }

    // JSON-RPC endpoint (POST /)
    router.use(
      jsonRpcHandler({
        requestHandler: this.requestHandler,
        userBuilder: this.options.userBuilder,
      })
    );

    // Agent card endpoint (GET /.well-known/agent-card.json)
    router.use(`/${cardPath}`, agentCardHandler({ agentCardProvider: this.requestHandler }));

    // REST API endpoints (optional)
    if (this.options.enableRest) {
      router.use(
        this.options.restBasePath,
        restHandler({
          requestHandler: this.requestHandler,
          userBuilder: this.options.userBuilder,
        })
      );
    }

    app.use(baseUrl, router);
    return app;
  }
}
