import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { v4 as uuidv4 } from 'uuid';

import { AgentCard, Task, TaskStatusUpdateEvent, Message } from '../../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from '../../../server/index.js';
import { A2AHonoApp } from '../../../server/hono/index.js';

/**
 * SampleAgentExecutor implements the agent's core logic.
 */
class SampleAgentExecutor implements AgentExecutor {
  public cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {};

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[SampleAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage], // Start history with the current user message
        metadata: userMessage.metadata, // Carry over metadata from message if any
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: 'working',
        message: {
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: 'Processing your question' }],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Publish final task status update
    const agentReplyText = this.parseInputMessage(userMessage);
    console.info(`[SampleAgentExecutor] Prompt response: ${agentReplyText}`);

    const agentMessage: Message = {
      kind: 'message',
      role: 'agent',
      messageId: uuidv4(),
      parts: [{ kind: 'text', text: agentReplyText }],
      taskId: taskId,
      contextId: contextId,
    };

    const finalUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: 'completed',
        message: agentMessage,
        timestamp: new Date().toISOString(),
      },
      final: true,
    };
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing delay
    eventBus.publish(finalUpdate);

    console.log(`[SampleAgentExecutor] Task ${taskId} finished with state: completed`);
  }

  parseInputMessage(message: Message): string {
    /** Process the user query and return a response. */
    const textPart = message.parts.find((part) => part.kind === 'text');
    const query = textPart ? textPart.text.trim() : '';

    if (!query) {
      return 'Hello! Please provide a message for me to respond to.';
    }

    // Simple responses based on input
    const queryLower = query.toLowerCase();
    if (queryLower.includes('hello') || queryLower.includes('hi')) {
      return 'Hello World from Hono! Nice to meet you!';
    } else if (queryLower.includes('how are you')) {
      return "I'm doing great with Hono! Thanks for asking. How can I help you today?";
    } else if (queryLower.includes('goodbye') || queryLower.includes('bye')) {
      return 'Goodbye! Have a wonderful day!';
    } else {
      return `Hello World from Hono! You said: '${query}'. Thanks for your message!`;
    }
  }
}

// --- Server Setup ---

const sampleAgentCard: AgentCard = {
  name: 'Hono Sample Agent',
  description:
    'A sample agent using Hono to test the stream functionality and simulate the flow of tasks statuses.',
  url: 'http://localhost:41242/',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples',
  },
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'],
  skills: [
    {
      id: 'hono_sample_agent',
      name: 'Hono Sample Agent',
      description: 'Simulate the general flow of a streaming agent using Hono.',
      tags: ['sample', 'hono'],
      examples: ['hi', 'hello world', 'how are you', 'goodbye'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new SampleAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(sampleAgentCard, taskStore, agentExecutor);

  // 4. Create Hono app
  const honoApp = new Hono();

  // 5. Setup A2A routes using A2AHonoApp
  const appBuilder = new A2AHonoApp(requestHandler);
  appBuilder.setupRoutes(honoApp);

  // 6. Start the server using @hono/node-server
  const PORT = process.env.PORT || 41242;

  console.log(`[HonoSampleAgent] Server starting on http://localhost:${PORT}`);
  console.log(`[HonoSampleAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log('[HonoSampleAgent] Press Ctrl+C to stop the server');

  serve({
    fetch: honoApp.fetch,
    port: Number(PORT),
  });
}

main().catch(console.error);
