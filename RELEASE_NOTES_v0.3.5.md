# Release v0.3.5: Complete Express/Hono Feature Parity

## 🎯 Overview

This release achieves **complete feature parity** between Express and Hono adapters, ensuring developers can choose either framework based on their runtime requirements without sacrificing functionality.

## ✨ Major Features

### Middleware Support
- **Express Adapter**: Full middleware injection with `RequestHandler` and `ErrorRequestHandler` support
- **Hono Adapter**: Full middleware injection with `MiddlewareHandler` support
- Both adapters now accept custom middleware arrays via the `setupRoutes()` method

### A2A Extensions Protocol Support
- **`X-A2A-Extensions` Request Headers**: Parse and validate extension URIs from client requests
- **`X-A2A-Extensions` Response Headers**: Return activated extensions to clients
- **ServerCallContext Integration**: Full context management for extension lifecycle
- **Sample Implementation**: Hono extension sample agent with timestamp extension example

### Enhanced API Consistency
- Identical API signatures across both adapters (framework-appropriate types)
- Same parameter order and optional arguments
- Consistent error handling patterns

## 🧪 Test Coverage

| Adapter | Total Tests | Status |
|---------|-------------|--------|
| Express | 20 tests    | ✅ All Passing |
| Hono    | 25 tests    | ✅ All Passing |

**Hono adapter now exceeds Express test coverage** with additional:
- Middleware integration tests (2)
- Extension header tests (2)
- Enhanced SSE streaming lifecycle tests (2)
- Additional error resilience tests (2)

## 📦 Complete Feature Matrix

| Feature | Express | Hono | Notes |
|---------|---------|------|-------|
| Core A2A Protocol | ✅ | ✅ | Identical |
| SSE Streaming | ✅ | ✅ | Identical |
| **Middleware Injection** | ✅ | ✅ | **NEW** |
| **Extension Support** | ✅ | ✅ | **NEW** |
| JSON-RPC Error Handling | ✅ | ✅ | Identical |
| Custom Agent Card Paths | ✅ | ✅ | Identical |
| Base URL Configuration | ✅ | ✅ | Identical |
| Edge Runtime Support | ❌ | ✅ | Hono only |

## 🔧 API Changes

### New `setupRoutes()` Signature (Both Adapters)

```typescript
// Express
setupRoutes(
  app: Express,
  baseUrl?: string,
  middlewares?: Array<RequestHandler | ErrorRequestHandler>,  // NEW
  agentCardPath?: string
): Express

// Hono
setupRoutes(
  app: Hono,
  baseUrl?: string,
  middlewares?: MiddlewareHandler[],  // NEW
  agentCardPath?: string
): Hono
```

**Breaking Changes:** None - all parameters are optional and backward compatible.

## 📝 New Examples

### Middleware Usage (Express)

```typescript
import express from "express";
import { A2AExpressApp } from "@drew-foxall/a2a-js-sdk/server/express";

const loggingMiddleware = (req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
};

const appBuilder = new A2AExpressApp(requestHandler);
appBuilder.setupRoutes(
  express(),
  "/a2a",
  [loggingMiddleware]  // Apply custom middleware
);
```

### Middleware Usage (Hono)

```typescript
import { Hono } from "hono";
import { A2AHonoApp } from "@drew-foxall/a2a-js-sdk/server/hono";

const loggingMiddleware = async (c, next) => {
  console.log(`${c.req.method} ${c.req.path}`);
  await next();
};

const appBuilder = new A2AHonoApp(requestHandler);
appBuilder.setupRoutes(
  new Hono(),
  "/a2a",
  [loggingMiddleware]  // Apply custom middleware
);
```

### Extension Support

```typescript
// Client sends extension request
const response = await fetch('http://localhost:4000/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-A2A-Extensions': 'https://example.com/extension/v1'
  },
  body: JSON.stringify(rpcRequest)
});

// Server activates and returns extensions
const extensions = response.headers.get('X-A2A-Extensions');
// Returns: 'https://example.com/extension/v1'
```

## 📚 Documentation Updates

- ✅ Updated README with feature comparison table
- ✅ Added comprehensive middleware examples
- ✅ Documented extension protocol support
- ✅ Added Hono extension sample agent
- ✅ Clarified runtime vs feature decision-making

## 🐛 Bug Fixes

- Fixed Hono JSON-RPC handler to properly parse `X-A2A-Extensions` headers
- Fixed Hono agent card handler error responses
- Improved error handling for malformed JSON in both adapters

## 🚀 Installation

```bash
npm install @drew-foxall/a2a-js-sdk@0.3.5
# or
pnpm add @drew-foxall/a2a-js-sdk@0.3.5
```

### Peer Dependencies

**For Express:**
```bash
npm install express
```

**For Hono:**
```bash
npm install hono @hono/node-server
```

## 📖 Full Changelog

**Added:**
- Middleware parameter to `A2AExpressApp.setupRoutes()`
- Middleware parameter to `A2AHonoApp.setupRoutes()`
- Extension header support (`X-A2A-Extensions`) in both adapters
- `ServerCallContext` integration for extension management
- Hono extension sample agent (`src/samples/extensions/hono-index.ts`)
- 2 middleware tests for Hono adapter
- 2 extension header tests for Hono adapter
- Comprehensive middleware documentation in README

**Changed:**
- README feature comparison table (now shows detailed parity)
- README "What's New" section (updated with latest features)
- Test count increased from 23 to 25 for Hono adapter

**Fixed:**
- Extension header parsing in Hono JSON-RPC handler
- Extension header setting in responses

## 🔗 Links

- **NPM Package**: https://www.npmjs.com/package/@drew-foxall/a2a-js-sdk
- **GitHub Repository**: https://github.com/drew-foxall/a2a-js-sdk
- **Upstream (Original)**: https://github.com/a2aproject/a2a-js
- **A2A Protocol Spec**: https://google-a2a.github.io/A2A

## 👥 Contributors

- Drew Foxall (@drew-foxall)

## 🙏 Acknowledgments

This fork builds upon the excellent work of the [a2aproject/a2a-js](https://github.com/a2aproject/a2a-js) team. All core A2A protocol functionality remains faithful to the upstream implementation.

---

**Need Help?** Open an issue on [GitHub](https://github.com/drew-foxall/a2a-js-sdk/issues)

