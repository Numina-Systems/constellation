// pattern: Functional Core

/**
 * Code execution runtime types and IPC message definitions.
 * Defines the port interface for executing code in a Deno sandbox and the message protocol
 * for IPC communication between the host (Bun) and the Deno subprocess.
 */

import type { ToolResult } from '../tool/types.ts';

/**
 * Result of executing code in the Deno runtime.
 */
export type ExecutionResult = {
  success: boolean;
  output: string;
  error?: string;
  tool_calls_made: number;
  duration_ms: number;
};

/**
 * Port interface for code execution runtime.
 * Implementations spawn a Deno subprocess with controlled permissions and execute user code.
 */
export interface CodeRuntime {
  execute(code: string, toolStubs: string): Promise<ExecutionResult>;
}

/**
 * IPC message: Host requests tool call from Deno subprocess.
 */
export type IpcToolCall = {
  type: '__tool_call__';
  name: string;
  params: Record<string, unknown>;
  call_id: string;
};

/**
 * IPC message: Host sends tool result back to Deno subprocess.
 */
export type IpcToolResult = {
  type: '__tool_result__';
  call_id: string;
  result: ToolResult;
};

/**
 * IPC message: Host sends tool error back to Deno subprocess.
 */
export type IpcToolError = {
  type: '__tool_error__';
  call_id: string;
  error: string;
};

/**
 * IPC message: Deno subprocess sends output to host.
 */
export type IpcOutput = {
  type: '__output__';
  data: string;
};

/**
 * IPC message: Deno subprocess sends debug message to host.
 */
export type IpcDebug = {
  type: '__debug__';
  message: string;
};

/**
 * Discriminated union of all IPC message types.
 * Used for type-safe message handling in both host and Deno sides.
 */
export type IpcMessage =
  | IpcToolCall
  | IpcToolResult
  | IpcToolError
  | IpcOutput
  | IpcDebug;
