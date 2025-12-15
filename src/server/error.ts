import * as schema from '../types.js';
import {
  HTTP_STATUS,
  mapErrorToStatus,
  toHTTPError,
  RestHttpStatusCode,
} from './transports/rest/rest_transport_handler.js';

/**
 * Custom error class for A2A server operations, incorporating JSON-RPC error codes.
 */
export class A2AError extends Error {
  public code: number;
  public data?: Record<string, unknown>;
  public taskId?: string; // Optional task ID context

  constructor(code: number, message: string, data?: Record<string, unknown>, taskId?: string) {
    super(message);
    this.name = 'A2AError';
    this.code = code;
    this.data = data;
    this.taskId = taskId; // Store associated task ID if provided
  }

  /**
   * Formats the error into a standard JSON-RPC error object structure.
   */
  toJSONRPCError(): schema.JSONRPCError {
    const errorObject: schema.JSONRPCError = {
      code: this.code,
      message: this.message,
    };

    if (this.data !== undefined) {
      errorObject.data = this.data;
    }

    return errorObject;
  }

  // Static factory methods for common errors

  static parseError(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32700, message, data);
  }

  static invalidRequest(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32600, message, data);
  }

  static methodNotFound(method: string): A2AError {
    return new A2AError(-32601, `Method not found: ${method}`);
  }

  static invalidParams(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32602, message, data);
  }

  static internalError(message: string, data?: Record<string, unknown>): A2AError {
    return new A2AError(-32603, message, data);
  }

  static taskNotFound(taskId: string): A2AError {
    return new A2AError(-32001, `Task not found: ${taskId}`, undefined, taskId);
  }

  static taskNotCancelable(taskId: string): A2AError {
    return new A2AError(-32002, `Task not cancelable: ${taskId}`, undefined, taskId);
  }

  static pushNotificationNotSupported(): A2AError {
    return new A2AError(-32003, 'Push Notification is not supported');
  }

  static unsupportedOperation(operation: string): A2AError {
    return new A2AError(-32004, `Unsupported operation: ${operation}`);
  }

  static authenticatedExtendedCardNotConfigured(): A2AError {
    return new A2AError(-32007, `Extended card not configured.`);
  }
}

// =============================================================================
// Error Formatting Utilities
// =============================================================================

/**
 * Result of formatting a JSON-RPC error.
 */
export interface JsonRpcErrorResult {
  statusCode: number;
  body: schema.JSONRPCErrorResponse;
}

/**
 * Result of formatting a REST error.
 */
export interface RestErrorResult {
  statusCode: RestHttpStatusCode;
  body: unknown;
}

/**
 * Formats a general JSON-RPC error response.
 *
 * @param error - The error that occurred
 * @param requestId - The original request ID (or null)
 * @returns Formatted error result with status code and body
 */
export function formatJsonRpcError(
  error: unknown,
  requestId: string | number | null
): JsonRpcErrorResult {
  const a2aError =
    error instanceof A2AError ? error : A2AError.internalError('General processing error.');

  return {
    statusCode: 500,
    body: {
      jsonrpc: '2.0',
      id: requestId,
      error: a2aError.toJSONRPCError(),
    },
  };
}

/**
 * Formats a JSON parse error response.
 *
 * @returns Formatted error result for invalid JSON
 */
export function formatParseError(): JsonRpcErrorResult {
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

/**
 * Formats a streaming error as a JSON-RPC error response.
 *
 * @param error - The error that occurred during streaming
 * @param requestId - The original request ID (or null)
 * @returns Formatted JSON-RPC error response
 */
export function formatStreamingError(
  error: unknown,
  requestId: string | number | null
): schema.JSONRPCErrorResponse {
  const a2aError =
    error instanceof A2AError
      ? error
      : A2AError.internalError(
          error instanceof Error && error.message ? error.message : 'Streaming error.'
        );

  return {
    jsonrpc: '2.0',
    id: requestId,
    error: a2aError.toJSONRPCError(),
  };
}

/**
 * Formats a REST API error response.
 *
 * @param error - The error that occurred
 * @returns Formatted error result with status code and body
 */
export function formatRestError(error: unknown): RestErrorResult {
  const a2aError =
    error instanceof A2AError
      ? error
      : A2AError.internalError(error instanceof Error ? error.message : 'Internal server error');

  const statusCode = mapErrorToStatus(a2aError.code);

  return {
    statusCode,
    body: toHTTPError(a2aError),
  };
}

// Re-export HTTP_STATUS for convenience
export { HTTP_STATUS };
