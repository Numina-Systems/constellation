/// <reference lib="deno.ns" />
/// <reference lib="deno.window" />
// pattern: Imperative Shell

/** Deno-side IPC bridge. Frames are counted as bytes before UTF-8 decoding. */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const MAX_IPC_FRAME_BYTES = 1_048_576;
const MAX_DIAGNOSTIC_BYTES = 2_000;

type IpcToolCall = {
  type: '__tool_call__';
  name: string;
  params: Record<string, unknown>;
  call_id: string;
};
type IpcToolResult = {type: '__tool_result__'; call_id: string; result: {success: boolean; output: string; error?: string}};
type IpcToolError = {type: '__tool_error__'; call_id: string; error: string};
type IpcOutput = {type: '__output__'; data: string};
type IpcDebug = {type: '__debug__'; message: string};
type IpcMessage = IpcToolCall | IpcToolResult | IpcToolError | IpcOutput | IpcDebug;

type PendingCall = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

let callIdCounter = 0;
const pendingCalls = new Map<string, PendingCall>();

function generateCallId(): string {
  callIdCounter += 1;
  return `call_${callIdCounter}`;
}

function writeMessage(message: IpcMessage): void {
  const bytes = encoder.encode(`${JSON.stringify(message)}\n`);
  if (bytes.byteLength > MAX_IPC_FRAME_BYTES) {
    throw new Error(`IPC frame exceeds max size of ${MAX_IPC_FRAME_BYTES} bytes`);
  }
  Deno.stdout.writeSync(bytes);
}

function writeDiagnostic(message: string): void {
  try {
    writeMessage({type: '__debug__', message: message.slice(0, MAX_DIAGNOSTIC_BYTES)});
  } catch {
    // The host may already have closed stdout; there is no safe recovery in the bridge.
  }
}

(globalThis as unknown as Record<string, unknown>)['output'] = function (data: string): void {
  writeMessage({type: '__output__', data});
};
(globalThis as unknown as Record<string, unknown>)['debug'] = function (message: string): void {
  writeDiagnostic(message);
};
(globalThis as unknown as Record<string, unknown>)['__callTool__'] = async function (
  name: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const callId = generateCallId();
  const resultPromise = new Promise<unknown>((resolve, reject) => {
    pendingCalls.set(callId, {resolve, reject});
  });
  writeMessage({type: '__tool_call__', name, params, call_id: callId});
  try {
    return await resultPromise;
  } finally {
    pendingCalls.delete(callId);
  }
};

console.log = function (...args: unknown[]): void {
  writeMessage({type: '__output__', data: args.map((arg) => String(arg)).join(' ')});
};

function isResponse(value: unknown): value is IpcToolResult | IpcToolError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['type'] === '__tool_error__') {
    return typeof candidate['call_id'] === 'string' && typeof candidate['error'] === 'string';
  }
  return candidate['type'] === '__tool_result__' && typeof candidate['call_id'] === 'string' &&
    typeof candidate['result'] === 'object' && candidate['result'] !== null;
}

async function startIpcListener(): Promise<void> {
  const reader = Deno.stdin.readable.getReader();
  let pending = new Uint8Array(0);
  try {
    while (true) {
      const chunk = await reader.read();
      const bytes = chunk.value ?? new Uint8Array(0);
      const combined = new Uint8Array(pending.byteLength + bytes.byteLength);
      combined.set(pending);
      combined.set(bytes, pending.byteLength);
      let start = 0;
      for (let index = 0; index < combined.byteLength; index += 1) {
        if (combined[index] !== 10) continue;
        const line = combined.slice(start, index);
        if (line.byteLength > MAX_IPC_FRAME_BYTES) throw new Error('IPC frame exceeds byte bound');
        if (line.byteLength > 0) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(decoder.decode(line));
          } catch (error) {
            throw new Error(`malformed nonempty IPC frame: ${String(error)}`);
          }
          if (!isResponse(parsed)) throw new Error('malformed nonempty IPC frame');
          if (parsed.type === '__tool_result__') pendingCalls.get(parsed.call_id)?.resolve(parsed.result);
          else pendingCalls.get(parsed.call_id)?.reject(new Error(parsed.error));
        }
        start = index + 1;
      }
      pending = combined.slice(start);
      if (pending.byteLength > MAX_IPC_FRAME_BYTES) throw new Error('unterminated IPC frame exceeds byte bound');
      if (chunk.done) {
        if (pending.byteLength > 0) throw new Error('unterminated nonempty IPC frame');
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

void startIpcListener().catch((error: unknown) => writeDiagnostic(`IPC listener error: ${String(error)}`));
