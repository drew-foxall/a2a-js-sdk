# Examples Migration to Separate Repository

**Date**: November 17, 2025  
**Status**: ✅ Complete

## 🎯 Objective

Move AI SDK + Hono examples to a separate repository to:
- Enable easy upstream merges from a2aproject/a2a-js
- Reduce published package size
- Match the original project's architecture (library + examples separation)
- Allow examples to evolve independently

## 📦 New Repository

**Location**: `https://github.com/drew-foxall/a2a-js-sdk-examples`

**Structure**:
```
a2a-js-sdk-examples/
├── README.md (comprehensive)
├── package.json (workspace configuration)
├── .gitignore
├── .env.example
├── shared/
│   └── utils.ts (getModel utility)
├── movie-agent-ai-sdk/
│   ├── package.json
│   ├── index.ts
│   ├── tmdb.ts
│   ├── prompt.ts
│   ├── .env.example
│   └── README.md
├── coder-agent-ai-sdk/
│   ├── package.json
│   ├── index.ts
│   ├── code-format.ts
│   ├── .env.example
│   └── README.md
└── content-editor-agent-ai-sdk/
    ├── package.json
    ├── index.ts
    ├── prompt.ts
    ├── .env.example
    └── README.md
```

## ✅ Changes Made

### 1. Created New Repository ✅
- Initialized git repository
- Created workspace structure with pnpm
- Set up proper .gitignore and .env.example files

### 2. Migrated Examples ✅
- Copied all AI SDK examples to new repository
- Updated import paths to use published package:
  ```typescript
  // Before:
  import { AgentCard } from "../../../../../index.js";
  
  // After:
  import { AgentCard } from "@drew-foxall/a2a-js-sdk";
  ```

### 3. Created Package Configurations ✅
- Root package.json with workspace configuration
- Individual package.json for each example
- All examples reference `@drew-foxall/a2a-js-sdk` version `^0.3.5`

### 4. Documentation ✅
- Comprehensive main README
- Individual READMEs for each example (preserved from migration)
- .env.example files with clear instructions
- Cross-references between repositories

### 5. Repository Configuration ✅
- Licensed under Apache-2.0 (matching parent project)
- Properly structured for pnpm workspaces
- Scripts for running each example from root

## 📝 Required Actions for Main Repository

### 1. Update README.md
Add reference to examples repository:

```markdown
## 📚 Examples

See the [a2a-js-sdk-examples](https://github.com/drew-foxall/a2a-js-sdk-examples) 
repository for comprehensive agent implementations using AI SDK + Hono:

- **Movie Info Agent** - TMDB API integration with conversation history
- **Coder Agent** - Streaming code generation with multi-file support
- **Content Editor Agent** - Professional content editing and proof-reading
```

### 2. Remove AI SDK Examples
```bash
git rm -r src/samples/agents/ai-sdk-samples
git rm -r src/samples/agents/ai-sdk-sample-agent
```

### 3. Update package.json
Remove AI SDK example scripts:
- `agents:ai-sdk-sample-agent`
- `agents:ai-sdk-movie-agent`
- `agents:ai-sdk-coder-agent`
- `agents:ai-sdk-content-editor-agent`

### 4. Commit Changes
```bash
git commit -m "Move AI SDK examples to separate repository

Examples now live at: https://github.com/drew-foxall/a2a-js-sdk-examples

This allows:
- Easier upstream merges
- Smaller published package
- Independent example evolution
- Better separation of concerns"
```

## 🔄 Benefits

### For Library Repository (a2a-js-sdk)
1. ✅ **Easy Upstream Merges** - No conflicts from examples
2. ✅ **Smaller Package Size** - Only SDK code published to npm
3. ✅ **Cleaner Structure** - Focus on library code
4. ✅ **Better Maintenance** - Less noise in diffs

### For Examples Repository (a2a-js-sdk-examples)
1. ✅ **Independence** - Can evolve without affecting library
2. ✅ **Flexibility** - Can use any version of the SDK
3. ✅ **Clear Purpose** - Obviously examples, not library code
4. ✅ **Experimentation** - Try new patterns without risk

### For Users
1. ✅ **Clear Discovery** - Find what they need easily
2. ✅ **Smaller Installs** - `npm install @drew-foxall/a2a-js-sdk` is tiny
3. ✅ **Learn from Examples** - Clone and run independently
4. ✅ **Familiar Pattern** - Matches original a2a project structure

## 📊 Comparison

| Aspect | Before | After |
|--------|---------|-------|
| **Structure** | Monolithic | Separate repos ✅ |
| **Upstream Merges** | Complex | Simple ✅ |
| **Package Size** | Large | Small ✅ |
| **Examples Discovery** | Mixed with library | Dedicated repo ✅ |
| **Maintenance** | Coupled | Independent ✅ |

## 🔗 Cross-References

### In a2a-js-sdk README:
```markdown
## Examples
For comprehensive examples using AI SDK + Hono, see:
👉 [a2a-js-sdk-examples](https://github.com/drew-foxall/a2a-js-sdk-examples)
```

### In a2a-js-sdk-examples README:
```markdown
## Library
These examples use [@drew-foxall/a2a-js-sdk](https://github.com/drew-foxall/a2a-js-sdk),
a fork of a2a-js with Hono adapter support.
```

## 🚀 Next Steps

1. [ ] Push examples repository to GitHub
2. [ ] Update main repository README
3. [ ] Remove AI SDK examples from main repository
4. [ ] Update main repository package.json
5. [ ] Commit and push main repository changes
6. [ ] Test that upstream merges still work smoothly

## 📚 Resources

- **Main Library**: https://github.com/drew-foxall/a2a-js-sdk
- **Examples**: https://github.com/drew-foxall/a2a-js-sdk-examples
- **Original Project**: https://github.com/a2aproject/a2a-js
- **Original Examples**: https://github.com/a2aproject/a2a-samples

---

This migration follows the best practice of separating library code from example code, matching the pattern established by the original A2A project team.

