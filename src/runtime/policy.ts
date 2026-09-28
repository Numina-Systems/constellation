// pattern: Functional Core

/** Pure byte/frame and execution-lifecycle policy used by the runtime shell. */

export type StreamKind = 'stdout' | 'stderr';

export type RuntimeLimits = {
  readonly max_stdout_bytes: number;
  readonly max_stderr_bytes: number;
  readonly max_ipc_frame_bytes: number;
  readonly max_output_size: number;
};

export type Frame = {
  readonly bytes: Uint8Array;
  readonly text: string;
};

export type FrameParser = {
  readonly push: (chunk: Uint8Array, done?: boolean) => ReadonlyArray<Frame>;
  readonly byteCount: () => number;
};

export type LifecycleReason =
  | 'completed'
  | 'timeout'
  | 'cancelled'
  | 'stdout_overflow'
  | 'stderr_overflow'
  | 'protocol_overflow'
  | 'protocol_error'
  | 'process_failure'
  | 'cleanup';

export type ExecutionLifecycle = {
  readonly state: () => 'OPEN' | 'CLOSING' | 'CLOSED';
  readonly isOpen: () => boolean;
  readonly close: (reason: LifecycleReason) => boolean;
  readonly reason: () => LifecycleReason | null;
  readonly closed: Promise<void>;
};

export function createFrameParser(
  kind: StreamKind,
  limits: Readonly<RuntimeLimits>,
): FrameParser {
  const limit = kind === 'stdout' ? limits.max_stdout_bytes : limits.max_stderr_bytes;
  let bytesSeen = 0;
  let pending = new Uint8Array(0);
  const decoder = new TextDecoder('utf-8', {fatal: true});

  function push(chunk: Uint8Array, done = false): ReadonlyArray<Frame> {
    const nextCount = bytesSeen + chunk.byteLength;
    if (nextCount > limit) {
      throw new Error(`${kind} exceeds max raw byte size of ${limit}`);
    }
    bytesSeen = nextCount;
    const combined = new Uint8Array(pending.byteLength + chunk.byteLength);
    combined.set(pending);
    combined.set(chunk, pending.byteLength);
    const frames: Array<Frame> = [];
    let start = 0;
    for (let index = 0; index < combined.byteLength; index += 1) {
      if (combined[index] !== 10) continue;
      const line = combined.slice(start, index);
      if (line.byteLength > limits.max_ipc_frame_bytes) {
        throw new Error(`IPC frame exceeds max size of ${limits.max_ipc_frame_bytes} bytes`);
      }
      if (line.byteLength > 0) {
        frames.push({bytes: line, text: decoder.decode(line)});
      }
      start = index + 1;
    }
    pending = combined.slice(start);
    if (pending.byteLength > limits.max_ipc_frame_bytes) {
      throw new Error(`unterminated IPC frame exceeds max size of ${limits.max_ipc_frame_bytes} bytes`);
    }
    if (done) {
      if (pending.byteLength > 0) {
        throw new Error('unterminated nonempty IPC frame');
      }
      pending = new Uint8Array(0);
    }
    return frames;
  }

  return {push, byteCount: () => bytesSeen};
}

export function appendUserOutput(
  current: string,
  addition: string,
  maxBytes: number,
): string {
  const next = `${current}${addition}\n`;
  const byteCount = new TextEncoder().encode(next).byteLength;
  if (byteCount > maxBytes) {
    throw new Error(`output exceeds max size of ${maxBytes} bytes`);
  }
  return next;
}

export function createExecutionLifecycle(): ExecutionLifecycle {
  let currentState: 'OPEN' | 'CLOSING' | 'CLOSED' = 'OPEN';
  let closeReason: LifecycleReason | null = null;
  let resolveClosed: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  function close(reason: LifecycleReason): boolean {
    if (currentState !== 'OPEN') return false;
    currentState = 'CLOSING';
    closeReason = reason;
    currentState = 'CLOSED';
    resolveClosed?.();
    return true;
  }

  return {
    state: () => currentState,
    isOpen: () => currentState === 'OPEN',
    close,
    reason: () => closeReason,
    closed,
  };
}
