/**
 * Core JSON-RPC Business Logic
 *
 * This module contains all the shared business logic for JSON-RPC handling.
 * Server-specific adapters (Express, Hono, etc.) should use these functions
 * and only implement I/O operations (parsing requests, writing responses).
 */

import { JSONRPCResponse, JSONRPCSuccessResponse } from '../../../types.js';
import { User } from '../../authentication/user.js';
import { ServerCallContext } from '../../context.js';
import { Extensions } from '../../../extensions.js';
import { JsonRpcTransportHandler } from './jsonrpc_transport_handler.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Input for JSON-RPC processing.
 * Server adapters extract these from their framework-specific request objects.
 */
export interface JsonRpcInput {
  /** Parsed JSON body */
  body: unknown;
  /** Value of the extensions header (or null if not present) */
  extensionsHeader: string | null;
  /** Authenticated user */
  user: User;
}

/**
 * Result when JSON-RPC returns a single response.
 */
export interface JsonRpcSingleResult {
  type: 'single';
  response: JSONRPCResponse;
  extensionsToActivate: string[];
}

/**
 * Result when JSON-RPC returns a streaming response.
 */
export interface JsonRpcStreamResult {
  type: 'stream';
  stream: AsyncGenerator<JSONRPCSuccessResponse, void, undefined>;
  extensionsToActivate: string[];
}

/**
 * Union type for JSON-RPC processing results.
 */
export type JsonRpcResult = JsonRpcSingleResult | JsonRpcStreamResult;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is an AsyncGenerator.
 */
export function isAsyncGenerator<T>(value: unknown): value is AsyncGenerator<T, void, undefined> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AsyncGenerator)[Symbol.asyncIterator] === 'function'
  );
}

// =============================================================================
// Core Logic
// =============================================================================

/**
 * Processes a JSON-RPC request and returns either a single response or a stream.
 *
 * This is the core business logic that all server adapters should use.
 * It handles:
 * - Building the ServerCallContext with extensions
 * - Calling the transport handler
 * - Detecting streaming vs single response
 * - Collecting activated extensions
 *
 * @param input - The parsed request input
 * @param transportHandler - The JSON-RPC transport handler
 * @returns Either a single response or a stream result
 */
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

  // Check if result is an AsyncGenerator (streaming response)
  // The transport handler returns either JSONRPCResponse or AsyncGenerator<JSONRPCResponse>
  if (isAsyncGenerator<JSONRPCSuccessResponse>(result)) {
    return {
      type: 'stream',
      stream: result,
      extensionsToActivate,
    };
  }

  // Type assertion rationale:
  // transportHandler.handle() returns `JSONRPCResponse | AsyncGenerator<JSONRPCResponse>`.
  // The isAsyncGenerator type guard above checks for AsyncGenerator.
  // If we reach here, result must be JSONRPCResponse.
  // TypeScript doesn't narrow union types in else branches after type guards,
  // so we need this assertion. This is safe because the union only has two members.
  return {
    type: 'single',
    response: result as JSONRPCResponse,
    extensionsToActivate,
  };
}

/**
 * Extracts the request ID from a JSON-RPC body.
 * Returns null if the body doesn't have an id field.
 */
export function extractRequestId(body: unknown): string | number | null {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
  }
  return null;
}
