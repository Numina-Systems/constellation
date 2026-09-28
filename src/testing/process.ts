// pattern: Imperative Shell

import {createDeferred, type Deferred} from './deferred.ts';

const MAX_FAKE_CHUNK_BYTES = 4 * 1024 * 1024;

export type FakeProcess = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdin: WritableStream<Uint8Array>;
  readonly exitCode: Promise<number>;
  readonly writeStdout: (bytes: Uint8Array) => Promise<void>;
  readonly writeStderr: (bytes: Uint8Array) => Promise<void>;
  readonly close: (exitCode?: number) => Promise<void>;
  readonly signal: AbortSignal;
};

export function createFakeProcess(signal?: AbortSignal): FakeProcess {
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let stderrController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let isClosed = signal?.aborted ?? false;
  let stdinClosed = false;
  const processController = new AbortController();
  const processSignal = signal ?? processController.signal;
  const exit: Deferred<number> = createDeferred<number>();
  const abort = (): void => {
    if (isClosed) return;
    isClosed = true;
    stdoutController?.close();
    stderrController?.close();
    exit.resolve(1);
  };
  signal?.addEventListener('abort', abort, {once: true});
  if (isClosed) exit.resolve(1);
  const stdout = new ReadableStream<Uint8Array>({start: (controller) => { stdoutController = controller; }});
  const stderr = new ReadableStream<Uint8Array>({start: (controller) => { stderrController = controller; }});
  const stdin = new WritableStream<Uint8Array>({write: (bytes) => {
    if (isClosed) throw new Error('fake process stdin is closed');
    if (bytes.byteLength > MAX_FAKE_CHUNK_BYTES) throw new Error('fake process stdin chunk exceeds bound');
  }, close: () => { stdinClosed = true; }, abort: () => { stdinClosed = true; }});
  async function write(controller: ReadableStreamDefaultController<Uint8Array> | null, bytes: Uint8Array, label: string): Promise<void> {
    if (isClosed) throw new Error(`fake process ${label} is closed`);
    if (bytes.byteLength > MAX_FAKE_CHUNK_BYTES) throw new Error(`fake process ${label} chunk exceeds bound`);
    if (!controller) throw new Error(`${label} is not ready`);
    controller.enqueue(new Uint8Array(bytes));
  }
  return {
    stdout,
    stderr,
    stdin,
    exitCode: exit.promise,
    signal: processSignal,
    writeStdout: (bytes) => write(stdoutController, bytes, 'stdout'),
    writeStderr: (bytes) => write(stderrController, bytes, 'stderr'),
    close: async (exitCode = 0) => {
      if (isClosed) return;
      isClosed = true;
      stdoutController?.close();
      stderrController?.close();
      if (!stdinClosed) await stdin.close();
      exit.resolve(exitCode);
    },
  };
}
