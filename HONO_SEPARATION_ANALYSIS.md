# Hono Adapter Separation Analysis

## Executive Summary

**Can the Hono adapter be separated into its own package?** 

✅ **YES - with caveats**

The Hono adapter can be separated into a standalone package (`@drew-foxall/a2a-hono-adapter` or similar) that depends on the original `@a2a-js/sdk` package, **BUT** it would require small changes to the upstream package to export additional utilities.

### 🆕 Update: Node.js Dependency Removed

**As of this fork, the SDK no longer depends on Node.js-specific APIs!** We've replaced `EventEmitter` with web-standard `EventTarget`, making the entire SDK (including Express adapter) compatible with edge runtimes like Cloudflare Workers.

This significantly strengthens the case for separation, as the core SDK is now truly universal.

---

## Current Dependencies Analysis

### What the Hono Adapter Needs

The Hono adapter consists of 3 main files:

1. **`a2a_hono_app.ts`** - Main adapter class
2. **`json_rpc_handler.ts`** - JSON-RPC and SSE streaming handler
3. **`agent_card_handler.ts`** - Agent card endpoint handler

### Dependencies Breakdown

#### ✅ **Already Exported from `@a2a-js/sdk`:**

| Import | Export Path | Status |
|--------|-------------|--------|
| `A2ARequestHandler` | `@a2a-js/sdk/server` | ✅ Available |
| `JsonRpcTransportHandler` | `@a2a-js/sdk/server` | ✅ Available |
| `ServerCallContext` | `@a2a-js/sdk/server` | ✅ Available |
| `A2AError` | `@a2a-js/sdk/server` | ✅ Available |
| `AGENT_CARD_PATH` | `@a2a-js/sdk` | ✅ Available |
| `JSONRPCErrorResponse` | `@a2a-js/sdk` (types) | ✅ Available |
| `JSONRPCSuccessResponse` | `@a2a-js/sdk` (types) | ✅ Available |
| `JSONRPCResponse` | `@a2a-js/sdk` (types) | ✅ Available |
| `AgentCard` | `@a2a-js/sdk` (types) | ✅ Available |

#### ❌ **NOT Exported (Internal Utilities):**

| Import | Current Location | Issue |
|--------|------------------|-------|
| `HTTP_EXTENSION_HEADER` | `src/constants.ts` | 🔴 Not exported from main or `/server` |
| `getRequestedExtensions()` | `src/server/utils.ts` | 🔴 Not exported from `/server` |

---

## The Problem

The **Extension Support** feature (added in your fork) requires:

1. **`HTTP_EXTENSION_HEADER`** constant (`'X-A2A-Extensions'`)
2. **`getRequestedExtensions()`** utility function

These are used internally by the Express adapter but **are not part of the public API** of `@a2a-js/sdk`.

### Current Code in `json_rpc_handler.ts`:

```typescript
import { ServerCallContext } from '../context.js';
import { getRequestedExtensions } from '../utils.js';
import { HTTP_EXTENSION_HEADER } from "../../constants.js";

// ...
const context = new ServerCallContext(
  getRequestedExtensions(c.req.header(HTTP_EXTENSION_HEADER))
);
// ...
if (context.activatedExtensions) {
  c.header(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions).join(', '));
}
```

---

## Solutions

### **Option 1: Propose Upstream Changes (Recommended)**

Submit a PR to the original `a2aproject/a2a-js` repository to export these utilities:

#### Changes Needed in `src/server/index.ts`:

```typescript
// Add these exports:
export { HTTP_EXTENSION_HEADER } from '../constants.js';
export { getRequestedExtensions } from './utils.js';
```

#### Benefits:
- ✅ Clean separation of concerns
- ✅ No code duplication
- ✅ Automatic upstream sync for bug fixes
- ✅ Smaller package footprint (only Hono adapter code)
- ✅ Easier maintenance
- ✅ Better for the community (others can create adapters too)

#### Challenges:
- ⏳ Requires upstream acceptance
- ⏳ May take time for review/merge
- 🤔 Upstream may have architectural reasons for not exposing these

---

### **Option 2: Duplicate Utilities in Hono Package**

Copy the small utilities into the Hono adapter package:

```typescript
// In @drew-foxall/a2a-hono-adapter/src/utils.ts
export const HTTP_EXTENSION_HEADER = 'X-A2A-Extensions';

export function getRequestedExtensions(values: string | undefined): Set<string> {
  if (!values) {
    return new Set();
  }
  return new Set(
    values.split(',')
      .map(ext => ext.trim())
      .filter(ext => ext.length > 0)
  );
}
```

#### Benefits:
- ✅ Immediate solution
- ✅ No dependency on upstream changes
- ✅ Complete control over utilities

#### Challenges:
- ❌ Code duplication
- ❌ Must manually sync if utilities change upstream
- ❌ Slightly larger package size
- ⚠️ Risk of divergence from canonical implementation

---

### **Option 3: Maintain Current Fork (Current Approach)**

Continue maintaining a full fork of `@a2a-js/sdk` with Hono support built-in.

#### Benefits:
- ✅ Already working
- ✅ Complete feature parity in one package
- ✅ Full control over all features

#### Challenges:
- ❌ Must maintain entire codebase
- ❌ Upstream merges can be complex
- ❌ Larger maintenance burden
- ❌ Duplicate effort for bug fixes
- ❌ Larger package size

---

## Recommended Approach

### **Phase 1: Short-term (Current)**
Continue with Option 3 (maintaining the fork) while evaluating long-term options.

### **Phase 2: Medium-term (3-6 months)**
1. Open an issue in `a2aproject/a2a-js` to discuss exporting extension utilities
2. Submit a PR to add these exports to the public API:
   ```typescript
   export { HTTP_EXTENSION_HEADER } from '../constants.js';
   export { getRequestedExtensions } from './utils.js';
   ```
3. If accepted, transition to separate package model

### **Phase 3: Long-term (If upstream accepts)**
Create `@drew-foxall/a2a-hono-adapter` package:

```json
{
  "name": "@drew-foxall/a2a-hono-adapter",
  "version": "1.0.0",
  "peerDependencies": {
    "@a2a-js/sdk": "^0.3.5",
    "hono": "^4.0.0"
  }
}
```

#### Package Structure:
```
a2a-hono-adapter/
├── src/
│   ├── a2a_hono_app.ts
│   ├── json_rpc_handler.ts
│   ├── agent_card_handler.ts
│   └── index.ts
├── test/
│   └── a2a_hono_app.spec.ts
├── package.json
└── README.md
```

#### Usage:
```typescript
import { DefaultRequestHandler } from '@a2a-js/sdk/server';
import { A2AHonoApp } from '@drew-foxall/a2a-hono-adapter';
import { Hono } from 'hono';

const requestHandler = new DefaultRequestHandler(/* ... */);
const appBuilder = new A2AHonoApp(requestHandler);
const app = new Hono();
appBuilder.setupRoutes(app);
```

---

## Impact Analysis

### If Upstream Accepts Extension Exports:

| Aspect | Current Fork | Separate Adapter Package |
|--------|-------------|--------------------------|
| **Maintenance Effort** | High | Low |
| **Upstream Sync** | Complex | Automatic |
| **Package Size** | ~500KB | ~20KB (Hono code only) |
| **Installation** | 1 package | 2 packages |
| **Breaking Changes** | Affects all users | Only affects Hono users |
| **Community Benefit** | Limited | High (enables other adapters) |

### If Upstream Rejects:

**Option 2** (duplicate utilities) becomes viable:
- Only ~10 lines of duplicated code
- Minimal maintenance burden
- Still much lighter than maintaining full fork

---

## Technical Feasibility: 100%

The separation is **technically straightforward**:

1. The Hono adapter has minimal dependencies on core SDK
2. All critical interfaces are already exported
3. Only 2 small utilities need addressing
4. No circular dependencies exist
5. Test suite can be fully independent

---

## Recommendation

### **Immediate Action:**
Continue with current fork while gathering community feedback.

### **Next Steps:**
1. ✅ **Document the separation analysis** (this file)
2. 🔄 **Open an issue** in `a2aproject/a2a-js` to discuss:
   - Extension utility exports
   - Vision for multi-framework support
   - Interest in community adapters
3. 📊 **Gauge interest** from Hono community
4. 🎯 **Decide based on upstream response**:
   - If positive → Prepare separate package migration
   - If negative → Evaluate Option 2 (duplicate utilities)
   - If no response → Maintain fork, revisit in 6 months

---

## Conclusion

**The Hono adapter CAN and SHOULD be separated**, but the optimal path depends on upstream collaboration. The technical barrier is minimal (2 utility exports), making this an excellent candidate for a clean, maintainable separation that benefits the entire A2A ecosystem.

The current fork approach provides immediate value while keeping options open for future architecture improvements.


