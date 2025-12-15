# A2A Server Architecture

## Current State (Completed)

This document captures the architectural decisions and current state of the server implementations.

---

## 1. Unified Export Signature

All server implementations now follow the same export pattern for easy swapping:

```typescript
// Main App class and options
export { A2A[Framework]App } from './a2a_[framework]_app.js';
export type { A2A[Framework]Options } from './a2a_[framework]_app.js';

// Framework-specific types
export { UserBuilder } from '...';

// Individual handlers for direct use
export { jsonRpcHandler, agentCardHandler, restHandler } from '...';
export type { JsonRpcHandlerOptions, AgentCardHandlerOptions, RestHandlerOptions } from '...';
export type { AgentCardProvider } from '...';

// Logger types
export { Logger, ConsoleLogger, JsonLogger, NoopLogger } from '../logging/logger.js';
export type { LogLevel, LogContext } from '../logging/logger.js';
```

---

## 2. File Structure

Each server implementation follows this structure:

```
src/server/[framework]/
├── index.ts                    # Unified exports
├── a2a_[framework]_app.ts      # Main App class
└── [framework-specific].ts     # Optional framework-specific utilities
```

### Servers Implemented:

| Server | Main Class | Status |
|--------|------------|--------|
| `express/` | `A2AExpressApp` | ✅ Original reference implementation |
| `hono/` | `A2AHonoApp` | ✅ Native streaming with backpressure |
| `elysia/` | `A2AElysiaApp` | ✅ Web-standard handlers |
| `itty-router/` | `A2AIttyRouterApp` | ✅ Web-standard handlers |
| `fresh/` | `A2AFreshApp` | ✅ Web-standard handlers |

---

## 3. Handler Architecture

### Express (Reference Implementation)
- Uses Express-native handlers in `json_rpc_handler.ts`, `agent_card_handler.ts`, `rest_handler.ts`
- Direct use of `express.Router()`, `res.write()`, `res.json()`
- This is the **original upstream implementation** - must not be modified

### Hono (Native Streaming)
- Uses Hono's native `streamSSE()` for **backpressure support**
- Has its own streaming consumer: `src/server/hono/streaming.ts`
- Directly uses transport handlers for business logic
- Most robust edge runtime implementation

### Web-Standard Servers (Elysia, itty-router, Fresh)
- Use shared web-standard handlers from `src/server/web-standard/handlers.ts`
- Handlers return `Response` objects using `ReadableStream`
- No native backpressure (acceptable for typical A2A use cases)

---

## 4. Streaming Architecture

### StreamConsumer Interface
Located in `src/server/transports/streaming.ts`:

```typescript
interface StreamConsumer {
  write(event: SSEEventData): void | Promise<void>;  // Async for backpressure
  end(): void;
  isWritable(): boolean;
}
```

### Implementations:

| Consumer | Location | Backpressure |
|----------|----------|--------------|
| `createExpressStreamConsumer` | `transports/streaming.ts` | ❌ Sync |
| `createWebStreamConsumer` | `transports/streaming.ts` | ❌ Sync |
| `createHonoStreamConsumer` | `hono/streaming.ts` | ✅ Async |

### Why Hono Has Its Own Consumer
- Hono's `streamSSE()` provides native backpressure via async `writeSSE()`
- This is framework-specific and belongs in the Hono folder
- Other frameworks could add their own consumers if they have similar capabilities

---

## 5. Shared Core Logic

All servers share core business logic from:

| Module | Purpose |
|--------|---------|
| `transports/jsonrpc/json_rpc_logic.ts` | JSON-RPC processing |
| `transports/rest/rest_transport_handler.ts` | REST API processing |
| `request_handler/agent_card_utils.ts` | Agent card fetching |
| `error.ts` | Error formatting |
| `sse_utils.ts` | SSE event formatting |
| `logging/logger.ts` | Pluggable logging |

---

## 6. Design Principles

1. **Express is the reference** - The original Express implementation must not be modified
2. **Framework-specific code stays in framework folders** - e.g., `createHonoStreamConsumer` in `hono/`
3. **Shared logic is shared** - Business logic in `transports/`, `request_handler/`, etc.
4. **Unified exports** - All servers export the same types for easy swapping
5. **Web-standard as default** - Elysia, itty-router, Fresh use `web-standard/handlers.ts`
6. **Native optimizations where valuable** - Hono uses native streaming for backpressure

---

## 7. What's NOT Duplicated

The following are intentionally **NOT** duplicated across servers:

- JSON-RPC business logic (`processJsonRpc`)
- REST endpoint logic (`RestTransportHandler`)
- Error formatting (`formatJsonRpcError`, `formatRestError`)
- SSE formatting (`createSSEEventData`, `sseEventToString`)
- Agent card fetching (`fetchAgentCard`)

---

## 8. Testing

All 251 tests pass across:
- Unit tests for handlers
- Integration tests for push notifications
- Hono-specific tests

---

## 9. Future Considerations

If adding a new server framework:

1. Create `src/server/[framework]/` folder
2. Create `a2a_[framework]_app.ts` with main class
3. Create `index.ts` following the unified export pattern
4. Use `web-standard/handlers.ts` unless framework has valuable native features
5. Add framework-specific optimizations only if they provide real benefits (like Hono's backpressure)

