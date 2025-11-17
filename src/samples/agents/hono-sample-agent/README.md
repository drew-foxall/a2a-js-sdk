# Hono Sample Agent

A sample A2A agent implementation using the Hono framework to demonstrate streaming and non-streaming capabilities.

## Overview

This agent demonstrates:
- Integration with the Hono web framework
- Streaming support via Server-Sent Events (SSE)
- Non-streaming (blocking) message handling
- Agent card discovery endpoint
- Task state management

## Running the Agent

```bash
# From the root of the a2a-js repository
npm run agents:hono-sample-agent
# or with pnpm
pnpm run agents:hono-sample-agent
```

The agent will start on port 41242 (or the port specified in the `PORT` environment variable).

## Endpoints

- **Agent Card**: `http://localhost:41242/.well-known/agent-card.json`
- **JSON-RPC**: `http://localhost:41242/` (POST)

## Testing

You can test the agent using the A2A CLI:

```bash
npm run a2a:cli
```

Or using curl:

```bash
# Get the agent card
curl http://localhost:41242/.well-known/agent-card.json

# Send a message (non-streaming)
curl -X POST http://localhost:41242/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "message": {
        "kind": "message",
        "role": "user",
        "messageId": "msg-1",
        "parts": [{"kind": "text", "text": "Hello!"}]
      }
    }
  }'

# Send a message (streaming)
curl -X POST http://localhost:41242/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/stream",
    "params": {
      "message": {
        "kind": "message",
        "role": "user",
        "messageId": "msg-1",
        "parts": [{"kind": "text", "text": "Hello!"}]
      }
    }
  }'
```

## Differences from Express Adapter

The Hono adapter provides similar functionality to the Express adapter but with:
- Lightweight, fast Hono framework
- Built-in SSE streaming support via `streamSSE`
- Edge runtime compatibility (can be deployed to Cloudflare Workers, etc.)
- Simpler middleware model

## Architecture

The agent uses the same core A2A abstractions:
- `AgentExecutor`: Implements the agent's business logic
- `ExecutionEventBus`: Handles event streaming
- `TaskStore`: Manages task persistence
- `DefaultRequestHandler`: Coordinates between executor and transport layer

