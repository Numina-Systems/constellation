// pattern: Imperative Shell

import type {JSONRPCMessage, MessageExtraInfo} from '@modelcontextprotocol/sdk/types.js';
import type {Transport, TransportSendOptions} from '@modelcontextprotocol/sdk/shared/transport.js';

const MAX_PENDING_MESSAGES = 128;

export type MockMcpTransport = Transport & Readonly<{
  readonly sent: ReadonlyArray<JSONRPCMessage>;
  readonly signal: AbortSignal;
  readonly deliver: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  readonly fail: (error: Error) => void;
}>;

/** Creates a bounded in-memory MCP transport for deterministic client tests. */
export function createMockMcpTransport(signal?: AbortSignal): MockMcpTransport {
  const sent: Array<JSONRPCMessage> = [];
  const internalController = new AbortController();
  const transportSignal = signal ?? internalController.signal;
  let closed = signal?.aborted ?? false;
  let onclose: (() => void) | undefined;

  function closeTransport(): void {
    if (closed) return;
    closed = true;
    onclose?.();
  }

  const transport: MockMcpTransport = {
    sent,
    signal: transportSignal,
    get onclose(): (() => void) | undefined { return onclose; },
    set onclose(handler: (() => void) | undefined) {
      onclose = handler;
      if (closed) onclose?.();
    },
    start: async (): Promise<void> => {
      if (closed) throw new Error('mock MCP transport is closed');
    },
    send: async (message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> => {
      if (closed) throw new Error('mock MCP transport is closed');
      if (sent.length >= MAX_PENDING_MESSAGES) throw new Error('mock MCP pending message bound exceeded');
      sent.push(message);
    },
    close: async (): Promise<void> => { closeTransport(); },
    deliver: (message: JSONRPCMessage, extra?: MessageExtraInfo): void => {
      if (closed) throw new Error('mock MCP transport is closed');
      transport.onmessage?.(message, extra);
    },
    fail: (error: Error): void => {
      if (closed) return;
      transport.onerror?.(error);
      closeTransport();
    },
  };

  signal?.addEventListener('abort', closeTransport, {once: true});
  return transport;
}
