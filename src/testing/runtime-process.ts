// pattern: Imperative Shell

import {createDeferred, type Deferred} from './deferred.ts';
import type {RuntimeProcess} from '@/runtime/executor.ts';

export type ControlledProcessObservations = {
  stdinAbortCount: number;
  stdinEndCount: number;
  killed: boolean;
  stdoutCancelled: boolean;
  stderrCancelled: boolean;
};

export type ControlledRuntimeProcess = RuntimeProcess & {
  readonly observations: ControlledProcessObservations;
  readonly stdinWrites: ReadonlyArray<Uint8Array>;
  readonly pushStdout: (bytes: Uint8Array) => void;
  readonly pushStderr: (bytes: Uint8Array) => void;
  readonly finish: (exitCode?: number) => void;
};

export function createControlledRuntimeProcess(): ControlledRuntimeProcess {
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let stderrController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let streamsClosed = false;
  let exitResolved = false;
  const exit: Deferred<number> = createDeferred<number>();
  const writes: Array<Uint8Array> = [];
  const observations: ControlledProcessObservations = {
    stdinAbortCount: 0,
    stdinEndCount: 0,
    killed: false,
    stdoutCancelled: false,
    stderrCancelled: false,
  };

  function closeStreams(): void {
    if (streamsClosed) return;
    streamsClosed = true;
    try { stdoutController?.close(); } catch { /* already closed */ }
    try { stderrController?.close(); } catch { /* already closed */ }
  }

  function resolveExit(exitCode: number): void {
    if (exitResolved) return;
    exitResolved = true;
    exit.resolve(exitCode);
  }

  const stdout = new ReadableStream<Uint8Array>({
    start: (controller) => { stdoutController = controller; },
    cancel: () => { observations.stdoutCancelled = true; },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start: (controller) => { stderrController = controller; },
    cancel: () => { observations.stderrCancelled = true; },
  });
  const stdin = {
    write: (bytes: Uint8Array): void => {
      if (streamsClosed || observations.killed) throw new Error('controlled process stdin is closed');
      writes.push(new Uint8Array(bytes));
    },
    end: (): void => { observations.stdinEndCount += 1; },
    abort: (): void => { observations.stdinAbortCount += 1; },
  };

  function push(controller: ReadableStreamDefaultController<Uint8Array> | null, bytes: Uint8Array): void {
    if (streamsClosed || observations.killed) throw new Error('controlled process stream is closed');
    if (controller === null) throw new Error('controlled process stream is not ready');
    controller.enqueue(new Uint8Array(bytes));
  }

  return {
    stdin,
    stdout,
    stderr,
    exited: exit.promise,
    kill: (): void => {
      observations.killed = true;
      // Leave readable streams cancellable so the executor owns reader cleanup.
      resolveExit(137);
    },
    observations,
    stdinWrites: writes,
    pushStdout: (bytes) => push(stdoutController, bytes),
    pushStderr: (bytes) => push(stderrController, bytes),
    finish: (exitCode = 0): void => {
      closeStreams();
      resolveExit(exitCode);
    },
  };
}
