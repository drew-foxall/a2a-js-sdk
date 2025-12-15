/**
 * Core REST API Business Logic
 *
 * This module contains all the shared business logic for REST API handling.
 * Server-specific adapters (Express, Hono, etc.) should use these functions
 * and only implement I/O operations (parsing requests, writing responses).
 */

import { User } from '../../authentication/user.js';
import { ServerCallContext } from '../../context.js';
import { Extensions } from '../../../extensions.js';
import { RestTransportHandler, HTTP_STATUS } from './rest_transport_handler.js';
import type { MessageSendParamsInput } from './rest_types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Input for REST API operations.
 * Server adapters extract these from their framework-specific request objects.
 */
export interface RestInput {
  /** Value of the extensions header (or null if not present) */
  extensionsHeader: string | null;
  /** Authenticated user */
  user: User;
}

/**
 * Result of a non-streaming REST operation.
 */
export interface RestSingleResult {
  type: 'single';
  statusCode: number;
  body: unknown;
  extensionsToActivate: string[];
}

/**
 * Result of a streaming REST operation.
 */
export interface RestStreamResult {
  type: 'stream';
  stream: AsyncGenerator<unknown, void, undefined>;
  extensionsToActivate: string[];
}

/**
 * Union type for REST operation results.
 */
export type RestResult = RestSingleResult | RestStreamResult;

// =============================================================================
// Core Logic - Context Building
// =============================================================================

/**
 * Builds a ServerCallContext from REST input.
 *
 * @param input - The REST input containing extensions header and user
 * @returns ServerCallContext with parsed extensions and user
 */
export function buildRestContext(input: RestInput): ServerCallContext {
  return new ServerCallContext(
    Extensions.parseServiceParameter(input.extensionsHeader ?? undefined),
    input.user
  );
}

/**
 * Extracts activated extensions from a context as an array.
 *
 * @param context - The ServerCallContext
 * @returns Array of activated extension names
 */
export function getActivatedExtensions(context: ServerCallContext): string[] {
  return context.activatedExtensions ? Array.from(context.activatedExtensions) : [];
}

// =============================================================================
// Core Logic - REST Operations
// =============================================================================

/**
 * Gets the authenticated extended agent card.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @returns REST result with agent card
 */
export async function getAuthenticatedCard(
  transportHandler: RestTransportHandler,
  input: RestInput
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  const result = await transportHandler.getAuthenticatedExtendedAgentCard();

  return {
    type: 'single',
    statusCode: HTTP_STATUS.OK,
    body: result,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Sends a message synchronously.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param body - The message send params (will be normalized by transport handler)
 * @returns REST result with message or task
 */
export async function sendMessage(
  transportHandler: RestTransportHandler,
  input: RestInput,
  body: MessageSendParamsInput
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  const result = await transportHandler.sendMessage(body, context);

  return {
    type: 'single',
    statusCode: HTTP_STATUS.CREATED,
    body: result,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Sends a message with streaming response.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param body - The message send params (will be normalized by transport handler)
 * @returns REST stream result
 */
export async function sendMessageStream(
  transportHandler: RestTransportHandler,
  input: RestInput,
  body: MessageSendParamsInput
): Promise<RestStreamResult> {
  const context = buildRestContext(input);
  const stream = await transportHandler.sendMessageStream(body, context);

  return {
    type: 'stream',
    stream,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Gets a task by ID.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param taskId - The task ID
 * @param historyLength - Optional history length parameter
 * @returns REST result with task
 */
export async function getTask(
  transportHandler: RestTransportHandler,
  input: RestInput,
  taskId: string,
  historyLength?: string
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  const result = await transportHandler.getTask(taskId, context, historyLength);

  return {
    type: 'single',
    statusCode: HTTP_STATUS.OK,
    body: result,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Cancels a task.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param taskId - The task ID
 * @returns REST result with task
 */
export async function cancelTask(
  transportHandler: RestTransportHandler,
  input: RestInput,
  taskId: string
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  const result = await transportHandler.cancelTask(taskId, context);

  return {
    type: 'single',
    statusCode: HTTP_STATUS.ACCEPTED,
    body: result,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Resubscribes to a task's updates.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param taskId - The task ID
 * @returns REST stream result
 */
export async function resubscribe(
  transportHandler: RestTransportHandler,
  input: RestInput,
  taskId: string
): Promise<RestStreamResult> {
  const context = buildRestContext(input);
  const stream = await transportHandler.resubscribe(taskId, context);

  return {
    type: 'stream',
    stream,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Sets a push notification config for a task.
 *
 * The body should contain push_notification_config (or pushNotificationConfig).
 * The taskId will be added automatically.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param taskId - The task ID
 * @param body - The push notification config body (raw request body)
 * @returns REST result with config
 */
export async function setTaskPushNotificationConfig(
  transportHandler: RestTransportHandler,
  input: RestInput,
  taskId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  // Add taskId in both formats for normalization
  // The transport handler will normalize the full config
  const config = {
    ...body,
    taskId: taskId,
    task_id: taskId,
  };
  const result = await transportHandler.setTaskPushNotificationConfig(config, context);

  return {
    type: 'single',
    statusCode: HTTP_STATUS.CREATED,
    body: result,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Lists push notification configs for a task.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param taskId - The task ID
 * @returns REST result with configs array
 */
export async function listTaskPushNotificationConfigs(
  transportHandler: RestTransportHandler,
  input: RestInput,
  taskId: string
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  const result = await transportHandler.listTaskPushNotificationConfigs(taskId, context);

  return {
    type: 'single',
    statusCode: HTTP_STATUS.OK,
    body: result,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Gets a specific push notification config.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param taskId - The task ID
 * @param configId - The config ID
 * @returns REST result with config
 */
export async function getTaskPushNotificationConfig(
  transportHandler: RestTransportHandler,
  input: RestInput,
  taskId: string,
  configId: string
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  const result = await transportHandler.getTaskPushNotificationConfig(taskId, configId, context);

  return {
    type: 'single',
    statusCode: HTTP_STATUS.OK,
    body: result,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

/**
 * Deletes a push notification config.
 *
 * @param transportHandler - The REST transport handler
 * @param input - The REST input
 * @param taskId - The task ID
 * @param configId - The config ID
 * @returns REST result with no content
 */
export async function deleteTaskPushNotificationConfig(
  transportHandler: RestTransportHandler,
  input: RestInput,
  taskId: string,
  configId: string
): Promise<RestSingleResult> {
  const context = buildRestContext(input);
  await transportHandler.deleteTaskPushNotificationConfig(taskId, configId, context);

  return {
    type: 'single',
    statusCode: HTTP_STATUS.NO_CONTENT,
    body: undefined,
    extensionsToActivate: getActivatedExtensions(context),
  };
}

// Re-export HTTP_STATUS for convenience
export { HTTP_STATUS };
