# Architecture Analysis: Core vs Server Modules

## ✅ COMPLETED: Restructure - Move Core to Existing Patterns

The restructure has been completed. All files have been moved to their canonical locations.

### File Migration Summary

| Original Location | New Location | Status |
|-------------------|--------------|--------|
| `core/logger.ts` | `logging/logger.ts` | ✅ Done |
| `core/json_rpc_logic.ts` | `transports/jsonrpc/json_rpc_logic.ts` | ✅ Done |
| `core/rest_logic.ts` | `transports/rest/rest_logic.ts` | ✅ Done |
| `core/agent_card_logic.ts` | `request_handler/agent_card_utils.ts` | ✅ Done |
| `core/errors.ts` | Merged into `error.ts` | ✅ Done |
| `core/sse.ts` | Merged into `sse_utils.ts` | ✅ Done |
| `core/routes.ts` | `transports/routes.ts` | ✅ Done |
| `core/streaming.ts` | `transports/streaming.ts` | ✅ Done |
| `core/types.ts` | `web-standard/types.ts` | ✅ Done |
| `core/handlers.ts` | `web-standard/handlers.ts` | ✅ Done |

**Note:** `core/index.ts` remains as a re-export facade for backward compatibility.

### New Structure (Implemented)

```
src/server/
├── authentication/
│   └── user.ts                    # (unchanged)
├── agent_execution/
│   ├── agent_executor.ts          # (unchanged)
│   └── request_context.ts         # (unchanged)
├── context.ts                     # (unchanged)
├── error.ts                       # EXTEND: add formatJsonRpcError, formatRestError
├── events/
│   ├── execution_event_bus.ts     # (unchanged)
│   └── ...
├── logging/                       # ✨ NEW FOLDER
│   ├── index.ts
│   └── logger.ts                  # From core/logger.ts
├── push_notification/
│   └── ...                        # (unchanged)
├── request_handler/
│   ├── a2a_request_handler.ts     # (unchanged)
│   ├── default_request_handler.ts # (unchanged)
│   └── agent_card_utils.ts        # ✨ NEW: from core/agent_card_logic.ts
├── store.ts                       # (unchanged)
├── transports/
│   ├── jsonrpc/
│   │   ├── jsonrpc_transport_handler.ts  # (unchanged)
│   │   └── jsonrpc_logic.ts              # ✨ NEW: from core/json_rpc_logic.ts
│   ├── rest/
│   │   ├── rest_transport_handler.ts     # (unchanged)
│   │   ├── rest_types.ts                 # (unchanged)
│   │   └── rest_logic.ts                 # ✨ NEW: from core/rest_logic.ts
│   ├── routes.ts                         # ✨ NEW: from core/routes.ts
│   └── streaming.ts                      # ✨ NEW: from core/streaming.ts
├── utils.ts                       # (unchanged)
│
│ # Framework-specific implementations
├── express/                       # (unchanged structure)
├── hono/                          # (unchanged structure)
├── elysia/                        # (unchanged structure)
├── fresh/                         # (unchanged structure)
├── itty-router/                   # (unchanged structure)
├── web-standard/
│   ├── index.ts                   # MOVE: core/handlers.ts + core/types.ts (web parts)
│   └── types.ts                   # Web-specific types (WebRequest, WebResponse, etc.)
│
└── index.ts                       # Main server exports
```

### Benefits of This Approach

1. **Follows Existing Patterns**: Logic lives next to related code
2. **Clear Ownership**: `transports/jsonrpc/` owns all JSON-RPC logic
3. **Reduces Confusion**: No separate "core" folder that sounds like it should contain everything
4. **Better Discoverability**: Related code is co-located
5. **Minimal Breaking Changes**: Can re-export from old paths

### Migration Path

1. Move files to new locations
2. Update imports in moved files
3. Re-export from `core/index.ts` for backward compatibility
4. Eventually deprecate `core/` exports

---

## Current State

### `src/server/core/` (Our New Shared Logic)

| File | Purpose | Server-Agnostic? |
|------|---------|------------------|
| `json_rpc_logic.ts` | JSON-RPC processing logic | ✅ Yes |
| `agent_card_logic.ts` | Agent card fetching | ✅ Yes |
| `errors.ts` | Error formatting | ✅ Yes |
| `sse.ts` | SSE event formatting | ✅ Yes |
| `handlers.ts` | Web-standard Request/Response handlers | ⚠️ Web-standard only |
| `types.ts` | Web-standard types, options | ⚠️ Web-standard only |
| `routes.ts` | Route definitions | ✅ Yes |
| `streaming.ts` | Streaming utilities | ⚠️ Web-standard only |
| `logger.ts` | Pluggable logger | ✅ Yes |
| `rest_logic.ts` | REST endpoint logic | ⚠️ Partial (uses ServerCallContext) |

### `src/server/` Root Modules (Original A2A Logic)

| Module | Purpose | Server-Agnostic? | Should Move to Core? |
|--------|---------|------------------|---------------------|
| `request_handler/` | A2ARequestHandler interface + DefaultRequestHandler | ✅ Yes | ⚠️ Maybe |
| `agent_execution/` | AgentExecutor interface + RequestContext | ✅ Yes | ⚠️ Maybe |
| `transports/jsonrpc/` | JsonRpcTransportHandler | ✅ Yes | ⚠️ Maybe |
| `transports/rest/` | RestTransportHandler | ✅ Yes | ⚠️ Maybe |
| `events/` | ExecutionEventBus, EventQueue | ✅ Yes | ⚠️ Maybe |
| `push_notification/` | Push notification handling | ✅ Yes | ⚠️ Maybe |
| `authentication/` | User interface | ✅ Yes | ⚠️ Maybe |
| `context.ts` | ServerCallContext | ✅ Yes | ⚠️ Maybe |
| `error.ts` | A2AError | ✅ Yes | ⚠️ Maybe |
| `store.ts` | TaskStore interface + InMemoryTaskStore | ✅ Yes | No (user provides) |
| `result_manager.ts` | ResultManager | ✅ Yes | ⚠️ Maybe |

## Analysis

### What's Actually Server-Specific?

Looking at the codebase, **almost nothing is truly server-specific** except:

1. **HTTP I/O** - Parsing requests, writing responses, streaming
2. **Framework Integration** - Express Router, Hono app, etc.
3. **Middleware** - Framework-specific middleware patterns

### What's Currently in `core/` That Should Be

| Module | Status | Notes |
|--------|--------|-------|
| Error formatting | ✅ Done | `errors.ts` |
| SSE formatting | ✅ Done | `sse.ts` |
| JSON-RPC logic | ✅ Done | `json_rpc_logic.ts` |
| Agent card logic | ✅ Done | `agent_card_logic.ts` |
| Route definitions | ✅ Done | `routes.ts` |
| Logger | ✅ Done | `logger.ts` |

### What's in `src/server/` That's Already Server-Agnostic

These modules are **already server-agnostic** and work with any server:

1. **`A2ARequestHandler`** - Interface defining A2A operations
2. **`DefaultRequestHandler`** - Implementation using TaskStore + AgentExecutor
3. **`JsonRpcTransportHandler`** - Maps JSON-RPC to A2ARequestHandler
4. **`RestTransportHandler`** - Maps REST to A2ARequestHandler
5. **`ServerCallContext`** - Request context with user + extensions
6. **`A2AError`** - Error types
7. **`ExecutionEventBus`** - Event handling
8. **`AgentExecutor`** - Agent execution interface

## The Real Question

Should we move these to `core/`?

### Arguments FOR Moving to Core

1. **Clarity**: All shared logic in one place
2. **Consistency**: Single import path for shared code
3. **Documentation**: Easier to explain architecture

### Arguments AGAINST Moving to Core

1. **Breaking Changes**: Would change import paths for users
2. **Semantic Meaning**: `core/` currently means "web-standard handlers"
3. **Already Working**: These modules are already server-agnostic

## Recommendation

### Option 1: Keep Current Structure (Recommended)

Keep the existing modules where they are. They're already server-agnostic and work correctly. The `core/` folder specifically contains:
- Web-standard handlers (for edge runtimes)
- Shared formatting logic (errors, SSE)
- Shared business logic (JSON-RPC, agent card)

**Rationale**: The current structure works. Users import from `@a2a/server` for core functionality and `@a2a/server/express` (etc.) for framework-specific code.

### Option 2: Rename `core/` to `web-standard/`

If `core/` is confusing because it sounds like it should contain ALL core logic, rename it to something more specific like `web-standard/` or `edge/`.

### Option 3: Consolidate Everything into `core/`

Move all server-agnostic code into `core/`:
- `core/request_handler/`
- `core/transports/`
- `core/events/`
- `core/authentication/`
- etc.

This would be a **breaking change** but would make the architecture cleaner.

## Current Duplication Analysis

### Express vs Hono Handler Files

| File | Express | Hono | Shared Logic Used |
|------|---------|------|-------------------|
| `json_rpc_handler.ts` | 146 lines | 146 lines | `processJsonRpc()`, `formatParseError()`, `formatStreamingError()` |
| `agent_card_handler.ts` | 47 lines | 46 lines | `fetchAgentCard()` |
| `rest_handler.ts` | ~300 lines | ~345 lines | ❌ Not yet refactored |
| `common.ts` | 9 lines | 9 lines | `UserBuilder` pattern |
| `a2a_*_app.ts` | 138 lines | 120 lines | Options pattern |

### Remaining Duplication to Address

1. **`rest_handler.ts`** - Both Express and Hono have their own implementations
   - Should use `core/rest_logic.ts` functions
   
2. **`common.ts`** - Identical `UserBuilder` in both
   - Could export from `core/types.ts`

3. **`a2a_*_app.ts`** - Similar structure but framework-specific
   - This duplication is acceptable (framework integration)

## Action Items

### Immediate (No Breaking Changes)

1. ✅ Refactor `handlers.ts` to use core logic modules
2. ⏳ Refactor Express `rest_handler.ts` to use `core/rest_logic.ts`
3. ⏳ Refactor Hono `rest_handler.ts` to use `core/rest_logic.ts`
4. ⏳ Consider exporting `UserBuilder` from `core/types.ts`

### Future Consideration

1. Evaluate if `core/` naming causes confusion
2. Consider if transport handlers should move to `core/`
3. Document the architecture clearly in README

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Server Implementation                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Express  │ │  Hono    │ │ Elysia   │ │ Fresh    │ ...       │
│  │  App     │ │  App     │ │  App     │ │  App     │           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       │            │            │            │                   │
│       └────────────┴────────────┴────────────┘                   │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    core/ (Shared Logic)                      ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            ││
│  │  │json_rpc_    │ │agent_card_  │ │  errors.ts  │            ││
│  │  │logic.ts     │ │logic.ts     │ │             │            ││
│  │  └─────────────┘ └─────────────┘ └─────────────┘            ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            ││
│  │  │   sse.ts    │ │ handlers.ts │ │  routes.ts  │            ││
│  │  │             │ │(web-std)    │ │             │            ││
│  │  └─────────────┘ └─────────────┘ └─────────────┘            ││
│  └─────────────────────────────────────────────────────────────┘│
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Transport Handlers (Server-Agnostic)            ││
│  │  ┌─────────────────────┐ ┌─────────────────────┐            ││
│  │  │JsonRpcTransport     │ │RestTransport        │            ││
│  │  │Handler              │ │Handler              │            ││
│  │  └─────────────────────┘ └─────────────────────┘            ││
│  └─────────────────────────────────────────────────────────────┘│
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              A2ARequestHandler (Interface)                   ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │ DefaultRequestHandler                                    │││
│  │  │  - AgentExecutor (user provides)                        │││
│  │  │  - TaskStore (user provides)                            │││
│  │  │  - EventBus                                             │││
│  │  │  - PushNotifications                                    │││
│  │  └─────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Duplication in rest_handler.ts

### Express `rest_handler.ts` (~475 lines)
```typescript
// Duplicated helper functions:
buildContext(req) → ServerCallContext          // ~10 lines
setExtensionsHeader(res, context)              // ~5 lines
sendResponse(res, statusCode, context, body)   // ~10 lines
handleError(res, error, context)               // ~10 lines
streamResponse(res, stream, context)           // ~30 lines

// Duplicated route handlers:
GET  /v1/card                                  // ~15 lines
POST /v1/message:send                          // ~20 lines
POST /v1/message:stream                        // ~25 lines
GET  /v1/tasks/:taskId                         // ~20 lines
POST /v1/tasks/:taskId:cancel                  // ~15 lines
POST /v1/tasks/:taskId:subscribe               // ~25 lines
POST /v1/tasks/:taskId/pushNotificationConfigs // ~20 lines
GET  /v1/tasks/:taskId/pushNotificationConfigs // ~15 lines
GET  /v1/tasks/:taskId/pushNotificationConfigs/:configId  // ~15 lines
DELETE /v1/tasks/:taskId/pushNotificationConfigs/:configId // ~15 lines
```

### Hono `rest_handler.ts` (~345 lines)
Same structure, slightly different syntax.

### What Can Be Shared

1. **Route business logic** - The actual calls to `RestTransportHandler` are identical
2. **Error handling logic** - `formatRestError()` already exists in `core/errors.ts`
3. **Context building** - Similar to `json_rpc_logic.ts` pattern
4. **Response formatting** - Extensions header logic is identical

### Proposed Core REST Logic

```typescript
// core/rest_logic.ts (enhanced)

export interface RestInput {
  body?: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  extensionsHeader: string | null;
  user: User;
}

export interface RestResult {
  statusCode: number;
  body?: unknown;
  extensionsToActivate: string[];
  isStream?: boolean;
  stream?: AsyncGenerator<unknown>;
}

// Each REST endpoint as a pure function
export async function processGetCard(
  transportHandler: RestTransportHandler,
  input: RestInput
): Promise<RestResult>;

export async function processSendMessage(
  transportHandler: RestTransportHandler,
  input: RestInput
): Promise<RestResult>;

// ... etc for all endpoints
```

Then Express/Hono handlers become minimal:

```typescript
// express/rest_handler.ts (minimal)
router.get('/v1/card', async (req, res) => {
  const input = buildExpressInput(req);
  const result = await processGetCard(transportHandler, input);
  sendExpressResponse(res, result);
});
```

## Conclusion

The current architecture is **mostly correct**. The main remaining work is:

1. **HIGH PRIORITY**: Refactor `rest_handler.ts` in Express and Hono to use shared core logic
2. Ensure all web-standard adapters use the same core functions
3. Document the architecture clearly

The modules in `src/server/` (request_handler, transports, events, etc.) are already server-agnostic and don't need to move. They're used by ALL server implementations through the transport handlers.

## Next Steps

1. ⏳ Enhance `core/rest_logic.ts` with pure functions for each REST endpoint
2. ⏳ Refactor `express/rest_handler.ts` to use core logic
3. ⏳ Refactor `hono/rest_handler.ts` to use core logic
4. ⏳ Verify all tests still pass
5. ⏳ Update documentation

