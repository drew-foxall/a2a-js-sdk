# Maintainer Notes: Keeping Core in Sync with Express

## Overview

This document provides instructions for maintaining feature parity between `server/core` and the original `server/express` implementation when merging upstream changes from [a2aproject/a2a-js](https://github.com/a2aproject/a2a-js).

**Important**: The `server/core` module is designed to replicate all Express functionality so that every adapter (Hono, Elysia, Fresh, Itty Router, web-standard) has feature parity with the original Express implementation.

---

## Architecture Summary

```
Upstream (a2aproject/a2a-js)
└── server/express/           ← Original Express implementation (source of truth)

This Fork
├── server/express/           ← Kept in sync with upstream
├── server/core/              ← Web-standard implementation of Express features
├── server/adapters/          ← Framework adapters using core
│   ├── express.ts            ← Express adapter using transport handlers
│   ├── hono.ts               ← Uses core handlers
│   ├── elysia.ts             ← Uses core handlers
│   ├── itty-router.ts        ← Uses core handlers
│   ├── fresh.ts              ← Uses core handlers
│   └── web-standard.ts       ← Uses core handlers
└── server/hono/              ← Original Hono implementation (legacy)
```

---

## When to Update Core

After every upstream merge that modifies `server/express/`, you must assess whether `server/core/` needs updates.

### Files to Monitor

| Upstream File | Core Equivalent | Action Required |
|---------------|-----------------|-----------------|
| `server/express/json_rpc_handler.ts` | `server/core/handlers.ts` (createJsonRpcHandler) | Sync logic |
| `server/express/rest_handler.ts` | `server/core/handlers.ts` (createRestHandler) | Sync logic |
| `server/express/agent_card_handler.ts` | `server/core/handlers.ts` (createAgentCardHandler) | Sync logic |
| `server/express/common.ts` | `server/core/types.ts` | Sync types/utilities |
| `server/express/a2a_express_app.ts` | N/A (Express-specific routing) | No action |
| `server/express/index.ts` | `server/core/index.ts` | Sync exports |

---

## Step-by-Step Sync Process

### Step 1: Merge Upstream

```bash
git fetch upstream
git merge upstream/main
# Resolve any conflicts
```

### Step 2: Identify Express Changes

```bash
# Check what changed in server/express/
git diff HEAD~1 -- src/server/express/

# Or for a specific upstream version
git diff v0.3.5..v0.3.6 -- src/server/express/
```

### Step 3: Categorize Changes

For each change, determine the category:

| Category | Example | Action |
|----------|---------|--------|
| **New Feature** | New REST endpoint, new handler option | Port to core |
| **Bug Fix** | Error handling improvement | Port to core |
| **Refactor** | Code cleanup | Assess if core needs similar cleanup |
| **Express-Specific** | Middleware signature change | No core action |
| **Type Change** | New interface property | Update core types |

### Step 4: Port Changes to Core

#### For New Features

1. Read the Express implementation carefully
2. Implement equivalent in `server/core/handlers.ts` using web-standard APIs
3. Ensure the same options/parameters are available
4. Add exports to `server/core/index.ts`

#### For Bug Fixes

1. Understand the bug and fix in Express
2. Check if the same bug exists in core
3. Apply equivalent fix using web-standard APIs

#### For Type Changes

1. Update types in `server/core/types.ts`
2. Ensure backward compatibility where possible

### Step 5: Update Adapters

After updating core, ensure all adapters still work:

1. Check if any adapter needs updates to use new core features
2. Run the full test suite:
   ```bash
   npm run test
   npm run test:edge
   ```

### Step 6: Verify Parity

Run a manual comparison:

```bash
# List all exports from Express
grep -E "^export" src/server/express/index.ts

# List all exports from Core
grep -E "^export" src/server/core/index.ts
```

Ensure core has equivalents for all relevant Express exports.

---

## Feature Parity Checklist

When syncing, verify these features match:

### JSON-RPC Handler
- [ ] JSON body parsing
- [ ] Parse error handling (SyntaxError)
- [ ] Request ID extraction and preservation
- [ ] User authentication via UserBuilder
- [ ] Extensions header parsing (X-A2A-Extensions)
- [ ] Extensions header in response
- [ ] Stream detection (Symbol.asyncIterator)
- [ ] SSE headers and formatting
- [ ] Stream error handling
- [ ] Logging

### REST Handler
- [ ] All 10 REST endpoints implemented
- [ ] Route pattern matching
- [ ] Query parameter extraction
- [ ] Path parameter extraction
- [ ] HTTP status codes match
- [ ] Error to status mapping
- [ ] Error formatting (toHTTPError)
- [ ] 204 No Content handling
- [ ] SSE streaming for message:stream
- [ ] First event error checking

### Agent Card Handler
- [ ] GET endpoint
- [ ] Error handling
- [ ] AgentCardProvider support (function or object)
- [ ] Logging

### Types & Utilities
- [ ] UserBuilder type and factory
- [ ] AgentCardProvider type
- [ ] SSE formatting utilities
- [ ] HTTP status constants

---

## Common Patterns

### Express → Web Standard Mappings

| Express | Web Standard | Notes |
|---------|--------------|-------|
| `req.body` | `await request.json()` | Use `parseJsonBody()` helper |
| `req.query.param` | `url.searchParams.get('param')` | |
| `req.params.id` | `extractParams(pattern, path)` | Use core utility |
| `req.header('X-Header')` | `request.headers.get('X-Header')` | |
| `res.json(data)` | `new Response(JSON.stringify(data))` | Use `jsonResponse()` helper |
| `res.status(code).json()` | `new Response(..., { status: code })` | |
| `res.setHeader()` | `headers.set()` on Response | |
| `res.write()` + `res.end()` | `ReadableStream` | Use `createWebStreamConsumer()` |
| `res.headersSent` | N/A | Web Response is immutable |
| `res.writableEnded` | N/A | ReadableStream handles this |

### Logging Pattern

Express uses `console.error`, core uses pluggable Logger:

```typescript
// Express (original)
console.error('Error:', error);

// Core (improved)
logger.error('Error occurred', { 
  error: errorToLogContext(error),
  requestId,
});
```

---

## Testing After Sync

### Unit Tests

```bash
npm run test        # Node.js tests
npm run test:edge   # Edge runtime tests (includes Hono)
```

### Build Verification

```bash
npm run build
npm run lint
```

### Manual Verification

1. Start a sample agent with Express adapter
2. Start a sample agent with Hono adapter  
3. Send identical requests to both
4. Verify responses are identical

---

## Troubleshooting

### Core Handler Returns Different Response

1. Compare Express handler line-by-line with core equivalent
2. Check status codes, headers, body format
3. Verify error handling paths

### Streaming Behaves Differently

1. Check SSE format (data: prefix, double newline)
2. Verify event IDs if applicable
3. Check error event format

### Types Don't Match

1. Compare interface definitions
2. Check for optional vs required properties
3. Verify generic type parameters

---

## Historical Notes

### Why This Architecture Exists

The original upstream repo only supports Express. This fork adds:

1. **Hono support** for edge runtimes
2. **Core handlers** using web-standard APIs for universal compatibility
3. **Multiple adapters** for various frameworks

### Key Design Decisions

1. **Core uses web-standard APIs** (Request, Response, ReadableStream)
2. **Express adapter uses transport handlers directly** for maximum Express compatibility
3. **Other adapters use core handlers** for consistency
4. **UserBuilder naming** matches Express/Hono API convention
5. **AgentCardProvider** supports both function and object with `getAgentCard()`

---

## Quick Reference Commands

```bash
# Check for upstream changes
git fetch upstream
git log --oneline upstream/main ^HEAD -- src/server/express/

# Diff specific file
git diff upstream/main -- src/server/express/json_rpc_handler.ts

# Run all tests
npm run test && npm run test:edge

# Build and lint
npm run build && npm run lint
```

---

## Contact

If you're an AI agent or maintainer working on this codebase and need clarification:

1. Read the existing handler implementations in both Express and core
2. Check the test files for expected behavior
3. Review the transport handler implementations in `src/server/transports/`
4. The goal is always: **feature parity with Express using web-standard APIs**

