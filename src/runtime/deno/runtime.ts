/// <reference lib="deno.ns" />
/// <reference lib="deno.window" />
// pattern: Imperative Shell

/**
 * Deno-side IPC bridge runtime for code execution.
 * This script runs inside the Deno sandbox and handles:
 * 1. Reading JSON-line IPC messages from stdin (host responses)
 * 2. Providing __callTool__ function to user code for tool invocations
 * 3. Capturing console.log and output() calls as IPC messages
 * 4. Evaluating and executing user code with access to the tool bridge
 *
 * The host concatenates: runtime.ts + tool stubs + user code into a single file.
 */

import { TextLineStream } from "jsr:@std/streams";

// Reusable text encoder instance for IPC messages
const encoder = new TextEncoder();

// IPC Message Types (mirrors types.ts from host)
type IpcToolCall = {
  type: "__tool_call__";
  name: string;
  params: Record<string, unknown>;
  call_id: string;
};

type IpcToolResult = {
  type: "__tool_result__";
  call_id: string;
  result: {
    success: boolean;
    output: string;
    error?: string;
  };
};

type IpcToolError = {
  type: "__tool_error__";
  call_id: string;
  error: string;
};

type IpcOutput = {
  type: "__output__";
  data: string;
};

type IpcDebug = {
  type: "__debug__";
  message: string;
};

type IpcMessage =
  | IpcToolCall
  | IpcToolResult
  | IpcToolError
  | IpcOutput
  | IpcDebug;

// Global state for IPC communication
let callIdCounter = 0;
const pendingCalls = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

// Helper to generate unique call IDs
function generateCallId(): string {
  return `call_${++callIdCounter}`;
}

// Helper to write IPC messages to stdout
function writeMessage(message: IpcMessage): void {
  const json = JSON.stringify(message);
  Deno.stdout.writeSync(encoder.encode(json + "\n"));
}

// Global output and debug functions (available to user code)
// Note: Deno's globalThis type is narrowly typed. We cast through unknown to Record<string, unknown>
// to allow dynamic property assignment for user code globals, which is necessary for concatenated user code.
(globalThis as unknown as Record<string, unknown>)["output"] = function (
  data: string
): void {
  writeMessage({
    type: "__output__",
    data,
  });
};

(globalThis as unknown as Record<string, unknown>)["debug"] = function (
  message: string
): void {
  writeMessage({
    type: "__debug__",
    message,
  });
};

// Bridge function: allows user code to call host-side tools
// This is available as __callTool__ in the global scope
// See note above about globalThis casting.
(globalThis as unknown as Record<string, unknown>)["__callTool__"] = async function (
  name: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const callId = generateCallId();

  // Create a promise for this tool call
  const resultPromise = new Promise<unknown>((resolve, reject) => {
    pendingCalls.set(callId, { resolve, reject });
  });

  // Send the tool call request to the host
  writeMessage({
    type: "__tool_call__",
    name,
    params,
    call_id: callId,
  });

  // Wait for the host to respond with the result
  try {
    const result = await resultPromise;
    return result;
  } finally {
    pendingCalls.delete(callId);
  }
};

// Capture console.log to send as __output__ messages
// Note: Do NOT call the original console.log - stdout is reserved for IPC communication.
// User code should use output() instead. For debugging, stderr is available.
console.log = function (...args: unknown[]): void {
  const message = args.map((arg) => String(arg)).join(" ");
  writeMessage({
    type: "__output__",
    data: message,
  });
};

// Set up stdin reader to receive IPC messages from host
async function startIpcListener(): Promise<void> {
  const reader = Deno.stdin.readable
    .pipeThrough(
      new TransformStream({
        transform(chunk: Uint8Array, controller) {
          const text = new TextDecoder().decode(chunk);
          controller.enqueue(text);
        },
      })
    )
    .pipeThrough(new TextLineStream());

  for await (const line of reader) {
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line) as IpcMessage;

      if (message.type === "__tool_result__") {
        const pending = pendingCalls.get(message.call_id);
        if (pending) {
          pending.resolve(message.result);
        }
      } else if (message.type === "__tool_error__") {
        const pending = pendingCalls.get(message.call_id);
        if (pending) {
          pending.reject(new Error(message.error));
        }
      }
    } catch (error) {
      writeMessage({
        type: "__debug__",
        message: `Failed to parse IPC message: ${String(error)}`,
      });
    }
  }
}

// Start the IPC listener in background
startIpcListener().catch((error) => {
  writeMessage({
    type: "__debug__",
    message: `IPC listener error: ${String(error)}`,
  });
});

// User code is appended after this runtime bridge by the host executor.
// The user code has access to:
// - __callTool__(name, params) - async function to invoke host tools
// - output(data) - function to send output to host
// - debug(message) - function to send debug messages to host
// - console.log - redirected to output()
// All other Deno APIs are available subject to permission flags from the host.
