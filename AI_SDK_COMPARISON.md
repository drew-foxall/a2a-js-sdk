# AI SDK vs Genkit Implementation Comparison

Based on analysis of [a2aproject/a2a-samples](https://github.com/a2aproject/a2a-samples/tree/main/samples/js/src/agents), here are the key differences and what needs to be updated:

## 🎬 Movie Agent

### Original (Genkit) Implementation
- **Framework**: Genkit + Express
- **Model**: `gemini-2.0-flash` (Genkit plugin)
- **Tools**: Custom `searchMovies` and `searchPeople` using `ai.defineTool()`
- **Prompt**: Uses external `.prompt` file with Handlebars templates
- **History Management**: Maintains conversation history in a `Map<string, Message[]>`
- **Task States**: Returns `COMPLETED` or `AWAITING_USER_INPUT` based on LLM output
- **TMDB Functions**: 
  - `searchMovies` - searches movies by title
  - `searchPeople` - searches people by name
  - Both modify image paths to full URLs

### Our AI SDK Implementation Status
✅ **Matches**:
- Tool calling with TMDB API
- Both searchMovies and searchPeople
- Task-based responses
- Error handling

❌ **Missing/Different**:
- ❌ No conversation history management (Map-based)
- ❌ Doesn't parse "COMPLETED"/"AWAITING_USER_INPUT" states
- ❌ Not using external prompt files
- ❌ Doesn't handle `goal` metadata
- ❌ Doesn't maintain context between messages
- ✅ Uses AI SDK's built-in tool system (simpler than Genkit)

---

## 💻 Coder Agent

### Original (Genkit) Implementation
- **Framework**: Genkit + Express
- **Model**: `gemini-2.0-flash`
- **Output Format**: Custom `code` format with `CodeMessageSchema`
- **Streaming**: Uses `ai.generateStream()` with structured output
- **Code Extraction**: Parses markdown code blocks with ` ```language filename` format
- **Multiple Files**: Can generate multiple files in one response
- **Artifacts**: Creates separate artifact for each file
- **Code Format Schema**:
  ```typescript
  {
    files: [{
      preamble: string,
      filename: string,
      language: string,
      content: string,
      done: boolean
    }],
    postamble: string
  }
  ```

### Our AI SDK Implementation Status
✅ **Matches**:
- Creates artifacts
- Task-based workflow
- Code generation
- Language detection
- Filename generation

❌ **Missing/Different**:
- ❌ No streaming support
- ❌ Only generates single files
- ❌ Doesn't parse markdown code blocks
- ❌ Doesn't use structured output schema
- ❌ No preamble/postamble support
- ❌ No multiple file generation
- ✅ Simpler implementation (but less capable)

---

## ✍️ Content Editor Agent

### Original (Genkit) Implementation
- **Framework**: Genkit + Express
- **Model**: Gemini (via Google AI)
- **Prompt**: Uses external `.prompt` file
- **Functionality**: Simple text editing/proof-reading
- **History**: Maintains conversation context
- **Port**: 10003 (configurable)

### Our AI SDK Implementation Status
❌ **NOT IMPLEMENTED YET**

---

## 📊 Feature Comparison Matrix

| Feature | Original (Genkit) | Our AI SDK Version | Status |
|---------|-------------------|-------------------|--------|
| **Movie Agent** |  |  |  |
| Tool Calling | ✅ Genkit tools | ✅ AI SDK tools | ✅ **Equivalent** |
| Conversation History | ✅ Map-based | ❌ None | ❌ **Missing** |
| TMDB Integration | ✅ 2 tools | ✅ 3 functions | ✅ **Enhanced** |
| State Management | ✅ COMPLETED/AWAITING | ❌ Simple completed | ❌ **Missing** |
| External Prompts | ✅ .prompt files | ❌ Inline | ⚠️ **Different Approach** |
| **Coder Agent** |  |  |  |
| Streaming | ✅ generateStream | ❌ None | ❌ **Missing** |
| Multiple Files | ✅ Yes | ❌ Single only | ❌ **Missing** |
| Code Extraction | ✅ Markdown parsing | ❌ None | ❌ **Missing** |
| Artifacts | ✅ Per-file | ✅ Single | ⚠️ **Partial** |
| Structured Output | ✅ CodeMessageSchema | ❌ None | ❌ **Missing** |
| **Content Editor** |  |  |  |
| Implementation | ✅ Complete | ❌ Not started | ❌ **Missing** |

---

## 🎯 What Needs to Be Updated

### Priority 1: Core Functionality
1. **Movie Agent**:
   - [ ] Add conversation history management (Map or in-memory store)
   - [ ] Parse LLM output for COMPLETED/AWAITING_USER_INPUT
   - [ ] Support `goal` metadata
   - [ ] Add multi-turn conversation support

2. **Coder Agent**:
   - [ ] Add streaming support using `streamText()` from AI SDK
   - [ ] Parse markdown code blocks (` ```language filename`)
   - [ ] Generate multiple files
   - [ ] Create separate artifacts for each file
   - [ ] Add preamble/postamble support

3. **Content Editor Agent**:
   - [ ] Implement complete agent
   - [ ] Simple editing/proof-reading functionality
   - [ ] Conversation context support

### Priority 2: Enhanced Features
1. **All Agents**:
   - [ ] External prompt file support (optional, AI SDK prefers inline)
   - [ ] Better error handling matching original
   - [ ] Cancellation support (original has this)
   - [ ] Metadata preservation

### Priority 3: Developer Experience
1. **Documentation**:
   - [ ] Side-by-side comparison examples
   - [ ] Migration guide from Genkit to AI SDK
   - [ ] Feature parity chart

2. **Testing**:
   - [ ] Port original test scenarios
   - [ ] Verify same outputs for same inputs
   - [ ] Performance comparison

---

## 🔧 Implementation Approach

### Option A: Direct Port (High Fidelity)
**Goal**: Match original behavior exactly

**Pros**:
- Drop-in replacement
- Same API behavior
- Easy to verify

**Cons**:
- Doesn't leverage AI SDK's simpler API
- May require workarounds

### Option B: AI SDK Native (Recommended)
**Goal**: Achieve same functionality using AI SDK patterns

**Pros**:
- Cleaner, more modern code
- Leverages AI SDK features
- Better TypeScript support
- Easier to maintain

**Cons**:
- May have small behavioral differences
- Need clear documentation of differences

---

## 📝 Recommended Fixes

### Movie Agent - Add History Management
```typescript
// Add conversation history store
const contexts: Map<string, Message[]> = new Map();

// In executor:
const historyForGenkit = contexts.get(contextId) || [];
if (!historyForGenkit.find(m => m.messageId === userMessage.messageId)) {
  historyForGenkit.push(userMessage);
}
contexts.set(contextId, historyForGenkit);

// Convert to AI SDK format
const messages = historyForGenkit.map(m => ({
  role: m.role === 'agent' ? 'assistant' : 'user',
  content: extractText(m)
}));
```

### Coder Agent - Add Streaming
```typescript
import { streamText } from 'ai';

const { textStream } = streamText({
  model: getModel(),
  prompt: userText,
  system: CODER_SYSTEM_PROMPT,
});

// Parse markdown code blocks
for await (const chunk of textStream) {
  // Extract ```language filename ... ``` blocks
  // Create artifacts
}
```

### Content Editor - Implement
```typescript
// Simple editing agent
const { text } = await generateText({
  model: getModel(),
  system: "You are an expert content editor...",
  prompt: userText,
});
```

---

## 🚀 Next Steps

1. **Clone original repo** ✅ DONE
2. **Analyze implementations** ✅ DONE
3. **Document differences** ✅ DONE (this file)
4. **Update Movie Agent** - Add history + state parsing
5. **Update Coder Agent** - Add streaming + multi-file
6. **Create Content Editor** - New implementation
7. **Test against originals** - Verify same behavior
8. **Document migration** - Help users switch

---

## 📚 Resources

- Original Samples: https://github.com/a2aproject/a2a-samples/tree/main/samples/js/src/agents
- AI SDK Docs: https://ai-sdk.dev
- AI SDK Streaming: https://sdk.vercel.ai/docs/ai-sdk-core/generating-text#streaming
- AI SDK Tools: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling

