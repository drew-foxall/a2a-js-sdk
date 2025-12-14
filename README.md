# A2A JavaScript SDK with Edge Support

[![npm version](https://badge.fury.io/js/@drew-foxall%2Fa2a-js-sdk.svg)](https://www.npmjs.com/package/@drew-foxall/a2a-js-sdk)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Upstream](https://img.shields.io/badge/upstream-a2aproject%2Fa2a--js%20v0.3.5-blue)](https://github.com/a2aproject/a2a-js)

<!-- markdownlint-disable no-inline-html -->

<html>
   <h2 align="center">
   <img src="https://raw.githubusercontent.com/google-a2a/A2A/refs/heads/main/docs/assets/a2a-logo-black.svg" width="256" alt="A2A Logo"/>
   </h2>
   <h3 align="center">A JavaScript SDK for building <a href="https://google-a2a.github.io/A2A">Agent2Agent (A2A) Protocol</a> servers with multi-framework and edge runtime support.</h3>
</html>

<!-- markdownlint-enable no-inline-html -->

> **Fork of [a2aproject/a2a-js](https://github.com/a2aproject/a2a-js)** — Tracks upstream v0.3.5 with added Hono, edge runtime, and multi-framework adapter support.

## ✨ Features

- **🎯 Multi-Framework**: Express, Hono, Elysia, itty-router, Fresh, and Web Standard adapters
- **⚡ Edge Runtime Native**: Cloudflare Workers, Deno, Bun — no compatibility layers needed
- **🌐 Universal JavaScript**: Built on web-standard APIs (`EventTarget`, `Request/Response`)
- **🚀 SSE Streaming**: Full Server-Sent Events support across all adapters
- **🔌 Pluggable Logger**: Console, JSON, or custom logging implementations
- **📦 Modular Architecture**: Import only what you need from `server/core` and `server/adapters`
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
# For Express
npm install express

# For Hono
npm install hono

# For Hono on Node.js
npm install hono @hono/node-server
```

---

## Quick Start

### Express Server

```typescript
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AgentCard, Message } from '@drew-foxall/a2a-js-sdk';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@drew-foxall/a2a-js-sdk/server';
import { A2AExpressApp } from '@drew-foxall/a2a-js-sdk/server/express';

const agentCard: AgentCard = {
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

class HelloExecutor implements AgentExecutor {
  async execute(ctx: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish({
      kind: 'message',
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: 'Hello, world!' }],
      contextId: ctx.contextId,
    });
    eventBus.finished();
  }
  cancelTask = async (): Promise<void> => {};
}

const handler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), new HelloExecutor());
const app = new A2AExpressApp(handler).setupRoutes(express());

app.listen(4000, () => console.log('🚀 Server running on http://localhost:4000'));
```

### Hono Server

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { A2AHonoApp } from '@drew-foxall/a2a-js-sdk/server/hono';
// ... same agentCard and HelloExecutor as above ...

const handler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), new HelloExecutor());
const app = new Hono();
new A2AHonoApp(handler).setupRoutes(app);

serve({ fetch: app.fetch, port: 4000 });
console.log('🚀 Hono server running on http://localhost:4000');
```

### Client

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

This SDK uses a layered architecture separating framework-agnostic logic from framework-specific adapters:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Transport Layer                             │
│   ┌──────────────────────┐    ┌──────────────────────┐          │
│   │ JsonRpcTransportHandler│    │  RestTransportHandler │          │
│   └──────────┬───────────┘    └──────────┬───────────┘          │
│              └───────────┬───────────────┘                       │
│                          ▼                                       │
│         ┌────────────────────────────────┐                       │
│         │      A2ARequestHandler         │                       │
│         │   (Framework-Agnostic Logic)   │                       │
│         └────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  server/core  │  │server/adapters│  │server/express │
│(Web Standard) │  │(Hono, Elysia) │  │  (Original)   │
└───────────────┘  └───────────────┘  └───────────────┘
```

### Import Paths

```typescript
// Core utilities
import { 
  ConsoleLogger, JsonLogger, NoopLogger,
  HTTP_STATUS, REST_ROUTES, AGENT_CARD_ROUTE,
  processStream, createSSEEvent,
} from '@drew-foxall/a2a-js-sdk/server/core';

// Framework adapters
import { createHonoA2AApp } from '@drew-foxall/a2a-js-sdk/server/adapters/hono';
import { createElysiaA2APlugin } from '@drew-foxall/a2a-js-sdk/server/adapters/elysia';
import { createIttyA2ARoutes } from '@drew-foxall/a2a-js-sdk/server/adapters/itty-router';
import { createFreshA2AHandler } from '@drew-foxall/a2a-js-sdk/server/adapters/fresh';
import { createA2AFetchHandler } from '@drew-foxall/a2a-js-sdk/server/adapters/web-standard';
import { createExpressA2ARouter } from '@drew-foxall/a2a-js-sdk/server/adapters/express';

// Original implementations (still available)
import { A2AExpressApp } from '@drew-foxall/a2a-js-sdk/server/express';
import { A2AHonoApp } from '@drew-foxall/a2a-js-sdk/server/hono';
```

---

## ⚡ Edge Runtime Support

This SDK uses web-standard APIs, making it compatible with all modern JavaScript runtimes:

| Runtime | Status | Notes |
|---------|--------|-------|
| **Cloudflare Workers** | ✅ Native | No `nodejs_compat` needed |
| **Deno** | ✅ Native | No npm shims required |
| **Bun** | ✅ Native | Full web API support |
| **Node.js 15+** | ✅ Native | EventTarget built-in |
| **Browsers** | ✅ Native | Universal JavaScript |

### Cloudflare Workers Example

```typescript
// worker.ts
import { Hono } from 'hono';
import { A2AHonoApp } from '@drew-foxall/a2a-js-sdk/server/hono';

const app = new Hono();
new A2AHonoApp(requestHandler).setupRoutes(app);

export default app;
```

```toml
# wrangler.toml - No nodejs_compat needed!
name = "a2a-edge-agent"
main = "worker.ts"
compatibility_date = "2024-01-01"
```

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

Both Express and Hono adapters support middleware injection:

```typescript
// Express
appBuilder.setupRoutes(app, '/a2a', [authMiddleware, loggingMiddleware]);

// Hono
appBuilder.setupRoutes(app, '/a2a', [authMiddleware, loggingMiddleware]);
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
import { JsonLogger } from '@drew-foxall/a2a-js-sdk/server/core';

const a2a = createHonoA2AApp(handler, {
  logger: JsonLogger.create(),
});
```

---

## 🔄 Upstream Tracking

This fork tracks the official [a2aproject/a2a-js](https://github.com/a2aproject/a2a-js) repository:

| This Fork | Upstream |
|-----------|----------|
| v0.4.0 | v0.3.5 |

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

- **Edge/Adapter improvements**: Submit PRs to this repository
- **A2A Protocol issues**: Report to the [official repository](https://github.com/a2aproject/a2a-js)
