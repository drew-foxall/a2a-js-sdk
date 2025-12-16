# A2A JavaScript SDK with Edge Support

[![npm version](https://badge.fury.io/js/@drew-foxall%2Fa2a-js-sdk.svg)](https://www.npmjs.com/package/@drew-foxall/a2a-js-sdk)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Upstream](https://img.shields.io/badge/upstream-a2aproject%2Fa2a--js%20v0.3.6-blue)](https://github.com/a2aproject/a2a-js)

<!-- markdownlint-disable no-inline-html -->

<html>
   <h2 align="center">
   <img src="https://raw.githubusercontent.com/google-a2a/A2A/refs/heads/main/docs/assets/a2a-logo-black.svg" width="256" alt="A2A Logo"/>
   </h2>
   <h3 align="center">A JavaScript SDK for building <a href="https://google-a2a.github.io/A2A">Agent2Agent (A2A) Protocol</a> servers with multi-framework and edge runtime support.</h3>
</html>

<!-- markdownlint-enable no-inline-html -->

> **Fork of [a2aproject/a2a-js](https://github.com/a2aproject/a2a-js)** — Tracks upstream v0.3.6 with added multi-framework and edge runtime support.

## ✨ Features

- **🎯 Multi-Framework**: Express, Hono, Elysia, itty-router, Fresh, and Web Standard
- **⚡ Edge Runtime Native**: Cloudflare Workers, Deno, Bun — no compatibility layers needed
- **🌐 Universal JavaScript**: Built on web-standard APIs (`EventTarget`, `Request/Response`)
- **🚀 SSE Streaming**: Full Server-Sent Events support across all frameworks
- **🔌 Pluggable Logger**: Console, JSON, or custom logging implementations
- **📦 Modular Architecture**: Import only what you need from `server/core`
- **🔄 Full A2A Protocol**: Complete implementation of the Agent2Agent specification

## Installation

```bash
npm install @drew-foxall/a2a-js-sdk
# or
pnpm add @drew-foxall/a2a-js-sdk
# or
yarn add @drew-foxall/a2a-js-sdk
```

### Peer Dependencies

Install the framework you want to use:

```bash
# For Express (Node.js)
npm install express

# For Hono (Edge/Serverless)
npm install hono

# For Hono on Node.js (development)
npm install hono @hono/node-server
```

---

## Quick Start

The examples below show the same "Hello Agent" implemented for different environments.

### Shared Agent Logic

First, define your agent card and executor (shared across all implementations):

```typescript
// shared/agent.ts
import { v4 as uuidv4 } from 'uuid';
import type { AgentCard, Message } from '@drew-foxall/a2a-js-sdk';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from '@drew-foxall/a2a-js-sdk/server';

export const helloAgentCard: AgentCard = {
  name: 'Hello Agent',
  description: 'A simple agent that says hello.',
  protocolVersion: '0.3.0',
  version: '0.1.0',
  url: 'http://localhost:4000/',
  skills: [{ id: 'chat', name: 'Chat', description: 'Say hello', tags: ['chat'] }],
  capabilities: { pushNotifications: false },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
};

export class HelloExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const response: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hello, world!' }],
      contextId: ctx.contextId,
    };
    eventBus.publish(response);
    eventBus.finished();
  }
  
  cancelTask = async (): Promise<void> => {};
}
```

---

### Express Server (Node.js - Original)

The original Express implementation from upstream. Best for traditional Node.js servers.

```typescript
// server-express.ts
import express from 'express';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@drew-foxall/a2a-js-sdk/server';
import { A2AExpressApp } from '@drew-foxall/a2a-js-sdk/server/express';
import { helloAgentCard, HelloExecutor } from './shared/agent';

const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  new HelloExecutor()
);

const app = express();
const a2aApp = new A2AExpressApp(requestHandler);

// Setup routes with optional base path and middleware
a2aApp.setupRoutes(app, '/a2a', [/* middlewares */]);

app.listen(4000, () => {
  console.log('🚀 Express A2A server running on http://localhost:4000');
});
```

**Options:**

```typescript
// With custom user extractor for authentication
const a2aApp = new A2AExpressApp(requestHandler, async (req) => {
  // Extract user from request (e.g., from JWT token)
  return req.user ?? new UnauthenticatedUser();
});

// Setup with REST API enabled (in addition to JSON-RPC)
a2aApp.setupRoutes(app, '/a2a', [], '.well-known/agent-card.json');
```

---

### Hono Server (Edge/Serverless)

Best for Cloudflare Workers, Vercel Edge Functions, Deno Deploy, and other edge environments.

```typescript
// worker.ts - Cloudflare Workers / Edge Runtime
import { Hono } from 'hono';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@drew-foxall/a2a-js-sdk/server';
import { A2AHonoApp } from '@drew-foxall/a2a-js-sdk/server/hono';
import { helloAgentCard, HelloExecutor } from './shared/agent';

const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  new HelloExecutor()
);

const app = new Hono();
const a2aApp = new A2AHonoApp(requestHandler, {
  enableRest: true,           // Enable REST API endpoints
  logger: ConsoleLogger.create(),
});
a2aApp.setupRoutes(app);

export default app;
```

**With Authentication:**

```typescript
import { A2AHonoApp, UserBuilder } from '@drew-foxall/a2a-js-sdk/server/hono';

const userBuilder: UserBuilder = async (request) => {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    const user = await validateToken(token);
    return user;
  }
  return new UnauthenticatedUser();
};

const a2aApp = new A2AHonoApp(requestHandler, { userBuilder });
```

**Deploy to Cloudflare Workers:**

```toml
# wrangler.toml - No nodejs_compat needed!
name = "a2a-hello-agent"
main = "worker.ts"
compatibility_date = "2024-01-01"
```

```bash
wrangler deploy
```

---

### Elysia Server (Bun)

Best for Bun-native applications with excellent TypeScript support.

```typescript
// server-elysia.ts
import { Elysia } from 'elysia';
import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
import { A2AElysiaApp } from '@drew-foxall/a2a-js-sdk/server/elysia';
import { helloAgentCard, HelloExecutor } from './shared/agent';

const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  new HelloExecutor()
);

const a2aApp = new A2AElysiaApp(requestHandler, { enableRest: true });
const routes = a2aApp.getRoutes('/a2a');

const app = new Elysia();
routes.forEach(route => {
  app[route.method](route.path, route.handler);
});

app.listen(4000);
```

---

### itty-router (Cloudflare Workers - Lightweight)

Best for minimal Cloudflare Workers with the smallest bundle size.

```typescript
// worker.ts
import { Router } from 'itty-router';
import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
import { A2AIttyRouterApp } from '@drew-foxall/a2a-js-sdk/server/itty-router';
import { helloAgentCard, HelloExecutor } from './shared/agent';

const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  new HelloExecutor()
);

const a2aApp = new A2AIttyRouterApp(requestHandler, { enableRest: true });
const routes = a2aApp.getRoutes('/a2a');

const router = Router();
routes.forEach(route => {
  router[route.method.toLowerCase()](route.pattern, route.handler);
});

export default { fetch: router.handle };
```

---

### Fresh (Deno)

Best for Deno's web framework with file-based routing.

```typescript
// routes/a2a/[...path].ts
import { DefaultRequestHandler, InMemoryTaskStore } from '@drew-foxall/a2a-js-sdk/server';
import { A2AFreshApp } from '@drew-foxall/a2a-js-sdk/server/fresh';
import { helloAgentCard, HelloExecutor } from '../../shared/agent.ts';

const requestHandler = new DefaultRequestHandler(
  helloAgentCard,
  new InMemoryTaskStore(),
  new HelloExecutor()
);

const a2aApp = new A2AFreshApp(requestHandler, { enableRest: true });

export const handler = a2aApp.createHandlers('/a2a');
```

---

### Client

The client works with any A2A server implementation:

```typescript
import { A2AClient } from '@drew-foxall/a2a-js-sdk/client';
import { v4 as uuidv4 } from 'uuid';

const client = await A2AClient.fromCardUrl('http://localhost:4000/.well-known/agent-card.json');

const response = await client.sendMessage({
  message: {
    messageId: uuidv4(),
    role: 'user',
    parts: [{ kind: 'text', text: 'Hi there!' }],
    kind: 'message',
  },
});

console.log('Response:', response);
```

---

## 🏗️ Architecture

This SDK uses a layered architecture separating framework-agnostic logic from framework-specific implementations:

```
┌─────────────────────────────────────────────────────────────────┐
│                       Transport Layer                           │
│   ┌────────────────────────┐    ┌──────────────────────┐        │
│   │ JsonRpcTransportHandler│    │ RestTransportHandler │        │
│   └──────────┬─────────────┘    └──────────┬───────────┘        │
│              └───────────────┬─────────────┘                    │
│                              ▼                                  │
│             ┌────────────────────────────────┐                  │
│             │      A2ARequestHandler         │                  │
│             │   (Framework-Agnostic Logic)   │                  │
│             └────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
    ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
    │  server/core  │  │ server/hono   │  │server/express │
    │(Web Standard) │  │ server/elysia │  │  (Original)   │
    │               │  │    etc...     │  │               │
    └───────────────┘  └───────────────┘  └───────────────┘
```

### Import Paths

```typescript
// Core utilities (logging, routes, streaming)
import { 
  ConsoleLogger, JsonLogger, NoopLogger,
  HTTP_STATUS, REST_ROUTES, AGENT_CARD_ROUTE,
  processStream, createSSEEvent,
} from '@drew-foxall/a2a-js-sdk/server/core';

// Framework implementations
import { A2AExpressApp } from '@drew-foxall/a2a-js-sdk/server/express';           // Original Express
import { A2AExpressApp } from '@drew-foxall/a2a-js-sdk/server/express-adapter';   // Core-based Express
import { A2AHonoApp } from '@drew-foxall/a2a-js-sdk/server/hono';
import { A2AElysiaApp } from '@drew-foxall/a2a-js-sdk/server/elysia';
import { A2AIttyRouterApp } from '@drew-foxall/a2a-js-sdk/server/itty-router';
import { A2AFreshApp } from '@drew-foxall/a2a-js-sdk/server/fresh';
import { A2AWebStandardApp } from '@drew-foxall/a2a-js-sdk/server/web-standard';
```

### Available Frameworks

| Framework | Import Path | Best For |
|-----------|-------------|----------|
| **Express** (Original) | `server/express` | Node.js servers (reference implementation) |
| **Express** (Core-based) | `server/express-adapter` | Parity testing with edge implementations |
| **Hono** | `server/hono` | Cloudflare Workers, Deno, Bun |
| **Elysia** | `server/elysia` | Bun-native with excellent TypeScript |
| **itty-router** | `server/itty-router` | Lightweight Cloudflare Workers |
| **Fresh** | `server/fresh` | Deno's web framework |
| **Web Standard** | `server/web-standard` | Any runtime with Request/Response |

---

## ⚡ Edge Runtime Support

This SDK uses web-standard APIs, making it compatible with all modern JavaScript runtimes:

| Runtime | Status | Notes |
|---------|--------|-------|
| **Cloudflare Workers** | ✅ Native | No `nodejs_compat` needed |
| **Vercel Edge Functions** | ✅ Native | Full support |
| **Deno Deploy** | ✅ Native | No npm shims required |
| **Bun** | ✅ Native | Full web API support |
| **Node.js 15+** | ✅ Native | EventTarget built-in |
| **Browsers** | ✅ Native | Universal JavaScript |

### Why Edge?

| Traditional (Express) | Edge (Hono) |
|-----------------------|-------------|
| Runs on dedicated servers | Runs at the edge, close to users |
| Cold starts in seconds | Cold starts in milliseconds |
| Requires `nodejs_compat` on CF Workers | Native edge runtime support |
| Full Node.js API access | Web-standard APIs only |
| Best for complex backends | Best for low-latency agents |

---

## 📚 Core Features

### Streaming (SSE)

```typescript
// Server: Publish events
eventBus.publish({ kind: 'status-update', taskId, status: { state: 'working' }, final: false });
eventBus.publish({ kind: 'artifact-update', taskId, artifact: { ... } });
eventBus.publish({ kind: 'status-update', taskId, status: { state: 'completed' }, final: true });
eventBus.finished();

// Client: Consume stream
const stream = client.sendMessageStream(params);
for await (const event of stream) {
  console.log(event.kind, event);
}
```

### Middleware Support

All framework implementations support middleware:

```typescript
// Express
a2aApp.setupRoutes(app, '/a2a', [authMiddleware, loggingMiddleware]);

// Hono
a2aApp.setupRoutes(app, '/a2a', [authMiddleware, loggingMiddleware]);
```

### Push Notifications

For long-running tasks, configure push notifications:

```typescript
const sendParams = {
  message: { ... },
  configuration: {
    pushNotificationConfig: {
      url: 'https://my-app.com/webhook',
      token: 'auth-token',
    },
  },
};
```

### Custom Logging

```typescript
import { ConsoleLogger, JsonLogger, NoopLogger } from '@drew-foxall/a2a-js-sdk/server/core';

// Human-readable for development
const devLogger = ConsoleLogger.create('debug');

// Structured JSON for production
const prodLogger = JsonLogger.create();

// Silent for testing
const testLogger = NoopLogger.create();
```

---

## 🔄 Upstream Tracking

This fork tracks the official [a2aproject/a2a-js](https://github.com/a2aproject/a2a-js) repository:

| This Fork | Upstream |
|-----------|----------|
| v0.4.0 | v0.3.6 |

### Staying in Sync

```bash
git remote add upstream https://github.com/a2aproject/a2a-js.git
git fetch upstream
git merge upstream/main
```

---

## 🔗 Related

- [A2A Protocol Specification](https://google-a2a.github.io/A2A)
- [Official A2A JS SDK](https://github.com/a2aproject/a2a-js)
- [A2A Samples](https://github.com/google-a2a/a2a-samples)

## License

[Apache 2.0](LICENSE)

## Contributing

Contributions are welcome! Please open an issue or pull request.

- **Edge/Framework improvements**: Submit PRs to this repository
- **A2A Protocol issues**: Report to the [official repository](https://github.com/a2aproject/a2a-js)
