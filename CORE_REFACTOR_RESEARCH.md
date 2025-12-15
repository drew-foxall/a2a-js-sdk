# Core Refactor Research: Maximizing Shared Logic

## Problem Statement

The current architecture has **duplicated logic** across server implementations:
- Express has its own `json_rpc_handler.ts`, `agent_card_handler.ts`, `rest_handler.ts`
- Hono has its own `json_rpc_handler.ts`, `agent_card_handler.ts`, `rest_handler.ts`
- Core has `handlers.ts` with similar logic

This violates DRY and means:
1. Bug fixes must be applied in multiple places
2. Behavioral differences can creep in
3. Testing burden is multiplied
4. The "core" isn't actually the core - it's a third implementation

## Goal

**Core should contain ALL business logic.** Server-specific files should ONLY contain:
1. Framework-specific request/response adapters
2. Framework-specific streaming mechanisms
3. Framework-specific middleware integration

## Current Architecture Analysis

### What Express `json_rpc_handler.ts` does:
```
1. Parse JSON body (Express-specific: express.json())
2. Handle JSON parse errors (Express-specific: ErrorRequestHandler)
3. Build ServerCallContext (SHARED)
4. Call JsonRpcTransportHandler.handle() (SHARED)
5. Set extension headers (SHARED logic, Express-specific API)
6. Detect streaming vs single response (SHARED)
7. For streaming: write SSE events (Express-specific: res.write)
8. For single: send JSON response (Express-specific: res.json)
9. Handle errors (SHARED logic, Express-specific response)
```

### What Hono `json_rpc_handler.ts` does:
```
1. Parse JSON body (Hono-specific: c.req.json())
2. Handle JSON parse errors (Hono-specific: try/catch)
3. Build ServerCallContext (SHARED - DUPLICATED)
4. Call JsonRpcTransportHandler.handle() (SHARED - DUPLICATED)
5. Set extension headers (SHARED logic - DUPLICATED, Hono-specific API)
6. Detect streaming vs single response (SHARED - DUPLICATED)
7. For streaming: write SSE events (Hono-specific: streamSSE)
8. For single: send JSON response (Hono-specific: c.json)
9. Handle errors (SHARED logic - DUPLICATED, Hono-specific response)
```

### What Core `handlers.ts` does:
```
Same as above but with web-standard Request/Response
```

## The Duplication Problem

| Logic | Express | Hono | Core | Should Be In |
|-------|---------|------|------|--------------|
| Build ServerCallContext | ✅ | ✅ | ✅ | **Core only** |
| Call transport handler | ✅ | ✅ | ✅ | **Core only** |
| Detect stream vs single | ✅ | ✅ | ✅ | **Core only** |
| Format SSE event data | ✅ | ✅ | ✅ | **Core only** |
| Format error responses | ✅ | ✅ | ✅ | **Core only** |
| Extension header logic | ✅ | ✅ | ✅ | **Core only** |
| Parse JSON body | Express | Hono | Core | **Server-specific** |
| Write SSE to response | Express | Hono | Core | **Server-specific** |
| Send JSON response | Express | Hono | Core | **Server-specific** |

## Proposed Architecture

### Layer 1: Core Business Logic (100% shared)

```typescript
// core/json_rpc_logic.ts
export interface JsonRpcInput {
  body: unknown;
  extensionsHeader: string | null;
  user: User;
}

export interface JsonRpcSingleResult {
  type: 'single';
  response: JSONRPCResponse;
  extensionsToActivate: string[];
}

export interface JsonRpcStreamResult {
  type: 'stream';
  stream: AsyncGenerator<JSONRPCSuccessResponse>;
  extensionsToActivate: string[];
}

export type JsonRpcResult = JsonRpcSingleResult | JsonRpcStreamResult;

export async function processJsonRpc(
  input: JsonRpcInput,
  transportHandler: JsonRpcTransportHandler
): Promise<JsonRpcResult> {
  const context = new ServerCallContext(
    Extensions.parseServiceParameter(input.extensionsHeader ?? undefined),
    input.user
  );
  
  const result = await transportHandler.handle(input.body, context);
  const extensionsToActivate = context.activatedExtensions 
    ? Array.from(context.activatedExtensions) 
    : [];
  
  if (isAsyncGenerator(result)) {
    return { type: 'stream', stream: result, extensionsToActivate };
  }
  return { type: 'single', response: result, extensionsToActivate };
}
```

### Layer 2: SSE Formatting (100% shared)

```typescript
// core/sse.ts
export interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
}

export function formatSSEEvent(data: unknown): SSEEvent {
  return {
    id: String(Date.now()),
    data: JSON.stringify(data),
  };
}

export function formatSSEErrorEvent(error: A2AError, requestId: string | number | null): SSEEvent {
  const errorResponse: JSONRPCErrorResponse = {
    jsonrpc: '2.0',
    id: requestId,
    error: error.toJSONRPCError(),
  };
  return {
    id: String(Date.now()),
    event: 'error',
    data: JSON.stringify(errorResponse),
  };
}
```

### Layer 3: Error Handling (100% shared)

```typescript
// core/errors.ts
export interface ErrorResult {
  statusCode: number;
  body: JSONRPCErrorResponse;
}

export function handleJsonRpcError(error: unknown, requestId: string | number | null): ErrorResult {
  const a2aError = error instanceof A2AError 
    ? error 
    : A2AError.internalError('General processing error.');
  
  return {
    statusCode: 500,
    body: {
      jsonrpc: '2.0',
      id: requestId,
      error: a2aError.toJSONRPCError(),
    },
  };
}

export function handleParseError(): ErrorResult {
  const a2aError = A2AError.parseError('Invalid JSON payload.');
  return {
    statusCode: 400,
    body: {
      jsonrpc: '2.0',
      id: null,
      error: a2aError.toJSONRPCError(),
    },
  };
}
```

### Layer 4: Server-Specific Adapters (minimal)

```typescript
// express/json_rpc_handler.ts - MINIMAL
export function jsonRpcHandler(options: JsonRpcHandlerOptions): RequestHandler {
  const transportHandler = new JsonRpcTransportHandler(options.requestHandler);
  const router = express.Router();
  
  router.use(express.json(), jsonParseErrorHandler);
  
  router.post('/', async (req, res) => {
    const user = await options.userBuilder(req);
    
    try {
      const result = await processJsonRpc({
        body: req.body,
        extensionsHeader: req.header(HTTP_EXTENSION_HEADER) ?? null,
        user,
      }, transportHandler);
      
      // Set extensions header
      if (result.extensionsToActivate.length > 0) {
        res.setHeader(HTTP_EXTENSION_HEADER, result.extensionsToActivate);
      }
      
      if (result.type === 'stream') {
        // Express-specific streaming
        await writeExpressSSEStream(res, result.stream, req.body?.id);
      } else {
        // Express-specific JSON response
        res.status(200).json(result.response);
      }
    } catch (error) {
      const errorResult = handleJsonRpcError(error, req.body?.id);
      res.status(errorResult.statusCode).json(errorResult.body);
    }
  });
  
  return router;
}

// Express-specific SSE writing
async function writeExpressSSEStream(
  res: Response,
  stream: AsyncGenerator<JSONRPCSuccessResponse>,
  requestId: string | number | null
): Promise<void> {
  Object.entries(SSE_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.flushHeaders();
  
  try {
    for await (const event of stream) {
      const sse = formatSSEEvent(event);
      res.write(`id: ${sse.id}\ndata: ${sse.data}\n\n`);
    }
  } catch (error) {
    const sse = formatSSEErrorEvent(
      error instanceof A2AError ? error : A2AError.internalError('Streaming error'),
      requestId
    );
    res.write(`id: ${sse.id}\nevent: ${sse.event}\ndata: ${sse.data}\n\n`);
  } finally {
    res.end();
  }
}
```

```typescript
// hono/json_rpc_handler.ts - MINIMAL
export function jsonRpcHandler(options: JsonRpcHandlerOptions): Hono {
  const transportHandler = new JsonRpcTransportHandler(options.requestHandler);
  const app = new Hono();
  
  app.post('/', async (c) => {
    let body: unknown;
    let requestId: string | number | null = null;
    
    try {
      body = await c.req.json();
      requestId = (body as any)?.id ?? null;
    } catch {
      const errorResult = handleParseError();
      return c.json(errorResult.body, errorResult.statusCode);
    }
    
    const user = await options.userBuilder(c);
    
    try {
      const result = await processJsonRpc({
        body,
        extensionsHeader: c.req.header(HTTP_EXTENSION_HEADER) ?? null,
        user,
      }, transportHandler);
      
      // Set extensions header
      if (result.extensionsToActivate.length > 0) {
        c.header(HTTP_EXTENSION_HEADER, result.extensionsToActivate.join(', '));
      }
      
      if (result.type === 'stream') {
        // Hono-specific streaming
        return writeHonoSSEStream(c, result.stream, requestId);
      } else {
        // Hono-specific JSON response
        return c.json(result.response, 200);
      }
    } catch (error) {
      const errorResult = handleJsonRpcError(error, requestId);
      return c.json(errorResult.body, errorResult.statusCode);
    }
  });
  
  return app;
}

// Hono-specific SSE writing
function writeHonoSSEStream(
  c: Context,
  stream: AsyncGenerator<JSONRPCSuccessResponse>,
  requestId: string | number | null
): Response {
  return streamSSE(c, async (sseStream) => {
    try {
      for await (const event of stream) {
        const sse = formatSSEEvent(event);
        await sseStream.writeSSE({ id: sse.id, data: sse.data });
      }
    } catch (error) {
      const sse = formatSSEErrorEvent(
        error instanceof A2AError ? error : A2AError.internalError('Streaming error'),
        requestId
      );
      await sseStream.writeSSE({ id: sse.id, event: sse.event, data: sse.data });
    }
  });
}
```

## Comparison: Before vs After

### Before (Current State)
```
Express json_rpc_handler.ts: ~150 lines
Hono json_rpc_handler.ts: ~157 lines
Core handlers.ts: ~500+ lines
---
Total: ~800+ lines with 80% duplication
```

### After (Proposed)
```
Core json_rpc_logic.ts: ~50 lines (shared)
Core sse.ts: ~30 lines (shared)
Core errors.ts: ~40 lines (shared)
Express json_rpc_handler.ts: ~50 lines (adapter only)
Hono json_rpc_handler.ts: ~50 lines (adapter only)
---
Total: ~220 lines with 0% duplication
```

## Implementation Plan

### Phase 1: Extract Core Logic
1. Create `core/json_rpc_logic.ts` with `processJsonRpc()`
2. Create `core/rest_logic.ts` with REST endpoint logic
3. Create `core/agent_card_logic.ts` with agent card logic
4. Create `core/sse.ts` with SSE formatting
5. Create `core/errors.ts` with error handling

### Phase 2: Refactor Express
1. Update `express/json_rpc_handler.ts` to use core logic
2. Update `express/rest_handler.ts` to use core logic
3. Update `express/agent_card_handler.ts` to use core logic
4. Verify all Express tests pass

### Phase 3: Refactor Hono
1. Update `hono/json_rpc_handler.ts` to use core logic
2. Update `hono/rest_handler.ts` to use core logic
3. Update `hono/agent_card_handler.ts` to use core logic
4. Verify all Hono tests pass

### Phase 4: Refactor Other Servers
1. Update Elysia to use core logic
2. Update itty-router to use core logic
3. Update Fresh to use core logic
4. Update web-standard to use core logic (this becomes the reference implementation)

### Phase 5: Remove Duplication
1. Delete `core/handlers.ts` (replaced by specific logic files)
2. Ensure all servers use the same core functions
3. Create shared E2E test suite

## Key Principles

1. **Core owns all business logic** - transport handlers, context building, error formatting
2. **Servers own only I/O** - parsing requests, writing responses, streaming mechanisms
3. **No logic duplication** - if it's in core, it's not in server
4. **Framework idioms respected** - each server uses its native APIs for I/O
5. **Testable in isolation** - core logic can be unit tested without framework

## Files to Create/Modify

### New Core Files
- `src/server/core/json_rpc_logic.ts`
- `src/server/core/rest_logic.ts`
- `src/server/core/agent_card_logic.ts`
- `src/server/core/sse.ts` (enhance existing)
- `src/server/core/errors.ts`

### Files to Refactor
- `src/server/express/json_rpc_handler.ts`
- `src/server/express/rest_handler.ts`
- `src/server/express/agent_card_handler.ts`
- `src/server/hono/json_rpc_handler.ts`
- `src/server/hono/rest_handler.ts`
- `src/server/hono/agent_card_handler.ts`

### Files to Eventually Remove
- `src/server/core/handlers.ts` (after refactor complete)
- `src/server/elysia/` (use core + minimal adapter)
- `src/server/itty-router/` (use core + minimal adapter)
- `src/server/fresh/` (use core + minimal adapter)
- `src/server/web-standard/` (becomes the reference adapter)
- `src/server/express-adapter/` (remove - Express native is better)

## Success Criteria

1. ✅ All tests pass
2. ⏳ No duplicated business logic between servers
3. ⏳ Each server file is < 100 lines
4. ✅ Core files contain all shared logic
5. ⏳ Behavioral parity verified via shared E2E tests
6. ✅ Extensions header format identical across all servers
7. ✅ Error responses identical across all servers
8. ✅ SSE event format identical across all servers
9. ⏳ **Unified export signature across all servers**

---

## Unified Export Signature

All server implementations should export the same interface pattern:

```typescript
// Every server/[framework]/index.ts should export:

// 1. Main App Class
export { A2A[Framework]App } from './a2a_[framework]_app.js';

// 2. Options Type (consistent naming)
export type { A2A[Framework]Options } from './a2a_[framework]_app.js';

// 3. Re-export common types from core
export { Logger, ConsoleLogger, JsonLogger, NoopLogger } from '../core/index.js';
export type { LogLevel, LogContext } from '../core/index.js';
```

### Unified Options Interface

All options should extend a common base:

```typescript
// core/types.ts
export interface A2AServerOptions {
  /** Logger instance for request logging */
  logger?: Logger;
  /** Custom user builder for authentication */
  userBuilder?: UserBuilder;
  /** Path for agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string;
  /** Enable REST API endpoints (default: false) */
  enableRest?: boolean;
  /** Base path for REST endpoints (default: '/rest') */
  restBasePath?: string;
}

// Each server extends this:
export interface A2AExpressOptions extends A2AServerOptions {
  // Express-specific options if any
}

export interface A2AHonoOptions extends A2AServerOptions {
  // Hono-specific options if any
}
```

### Unified setupRoutes Signature

All App classes should have a consistent `setupRoutes` method:

```typescript
class A2A[Framework]App {
  constructor(requestHandler: A2ARequestHandler, options?: A2A[Framework]Options);
  
  setupRoutes(
    app: FrameworkApp,
    baseUrl?: string,
    middlewares?: FrameworkMiddleware[],
    agentCardPath?: string
  ): FrameworkApp;
}
```

---

## Progress Log

### Phase 1: Core Logic Extraction ✅ COMPLETE

Created the following core modules:

1. **`core/json_rpc_logic.ts`** - JSON-RPC processing
   - `processJsonRpc()` - Main business logic
   - `extractRequestId()` - Request ID extraction
   - `isAsyncGenerator()` - Type guard for streaming

2. **`core/rest_logic.ts`** - REST API processing
   - `buildRestContext()` - Context building
   - `getActivatedExtensions()` - Extension extraction
   - All REST endpoint functions (sendMessage, getTask, etc.)

3. **`core/agent_card_logic.ts`** - Agent card handling
   - `fetchAgentCard()` - Card retrieval with error handling
   - `resolveAgentCardProvider()` - Provider resolution

4. **`core/errors.ts`** - Error formatting
   - `formatJsonRpcError()` - JSON-RPC error formatting
   - `formatParseError()` - Parse error formatting
   - `formatStreamingError()` - Streaming error formatting
   - `formatRestError()` - REST error formatting

5. **`core/sse.ts`** - SSE event formatting
   - `createSSEEventData()` - Structured event creation
   - `createSSEErrorEventData()` - Error event creation
   - `sseEventToString()` - String conversion

### Phase 2: Server Refactoring ✅ COMPLETE

Refactored handlers:
- [x] `express/json_rpc_handler.ts` - Now uses `processJsonRpc()` from core
- [x] `express/agent_card_handler.ts` - Now uses `fetchAgentCard()` from core
- [x] `hono/json_rpc_handler.ts` - Now uses `processJsonRpc()` from core
- [x] `hono/agent_card_handler.ts` - Now uses `fetchAgentCard()` from core

### Phase 3: Unified Export Signature ✅ COMPLETE

All server implementations now export a consistent interface:

| Server | Options Type | Exports |
|--------|--------------|---------|
| Express | `A2AExpressOptions` | `A2AExpressApp`, `UserBuilder`, `Logger`, individual handlers |
| Hono | `A2AHonoOptions` | `A2AHonoApp`, `UserBuilder`, `Logger` |
| Elysia | `A2AElysiaOptions` | `A2AElysiaApp`, `Logger` |
| itty-router | `A2AIttyRouterOptions` | `A2AIttyRouterApp`, `Logger` |
| Fresh | `A2AFreshOptions` | `A2AFreshApp`, `Logger` |
| web-standard | `A2AWebStandardOptions` | `A2AWebStandardApp`, `Logger` |

**Unified Options Pattern:**
```typescript
interface A2A[Framework]Options {
  logger?: Logger;
  userBuilder?: UserBuilder;
  agentCardPath?: string;
  enableRest?: boolean;
  restBasePath?: string;
}
```

**Backward Compatibility:**
- `A2AExpressApp` still supports legacy constructor signature: `new A2AExpressApp(handler, userBuilder)`
- All servers support the new options object pattern

### Phase 4: Refactor core/handlers.ts ✅ COMPLETE

Updated `core/handlers.ts` to use the shared core logic modules:

**Before**: `handlers.ts` had its own duplicate implementations:
- `isAsyncGenerator()` - duplicated type guard
- `buildContext()` - duplicated context building
- Error formatting logic - duplicated
- SSE event formatting - duplicated

**After**: `handlers.ts` now imports and uses:
- `processJsonRpc()` from `json_rpc_logic.ts`
- `fetchAgentCard()` from `agent_card_logic.ts`
- `formatJsonRpcError()`, `formatParseError()`, `formatStreamingError()`, `formatRestError()` from `errors.ts`
- `createSSEEventData()`, `createSSEErrorEventData()` from `sse.ts`

This ensures all web-standard adapters (Elysia, itty-router, Fresh, web-standard) that use `core/handlers.ts` now share the same business logic as Express and Hono.

### Current Architecture

We now have **two patterns** for server implementations:

#### Pattern 1: Framework-Specific Handlers (Express, Hono)

For frameworks with their own streaming/response patterns:
- Use framework-native handlers (`json_rpc_handler.ts`, `agent_card_handler.ts`, `rest_handler.ts`)
- These handlers call core logic functions (`processJsonRpc`, `fetchAgentCard`, etc.)
- Framework-specific code is minimal (just I/O operations)

Example:
```
express/json_rpc_handler.ts
  └── calls processJsonRpc() from core/json_rpc_logic.ts
  └── uses Express-specific res.write() for SSE
```

#### Pattern 2: Web-Standard Handlers (Elysia, itty-router, Fresh, web-standard)

For frameworks that work with standard Request/Response:
- Use web-standard handlers from `core/handlers.ts`
- These handlers return standard `Response` objects
- Minimal adapter code in each server folder

Example:
```
elysia/index.ts
  └── wraps createJsonRpcHandler() from core/handlers.ts
  └── adapts Request/Response to Elysia context
```

### Files Summary

**Core Business Logic** (shared by all):
- `core/json_rpc_logic.ts` - JSON-RPC processing
- `core/rest_logic.ts` - REST API processing
- `core/agent_card_logic.ts` - Agent card handling
- `core/errors.ts` - Error formatting
- `core/sse.ts` - SSE event formatting

**Core Web-Standard Handlers** (for Pattern 2):
- `core/handlers.ts` - Web-standard Request/Response handlers
- `core/types.ts` - Web-standard types
- `core/routes.ts` - Route definitions
- `core/streaming.ts` - Streaming utilities

**Framework-Specific Implementations**:
- `express/` - Full Express implementation using core logic
- `hono/` - Full Hono implementation using core logic
- `elysia/` - Adapter using web-standard handlers
- `itty-router/` - Adapter using web-standard handlers
- `fresh/` - Adapter using web-standard handlers
- `web-standard/` - Pure web-standard implementation

