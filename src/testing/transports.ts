// pattern: Imperative Shell

const MAX_HTTP_PENDING = 128;
const MAX_SSE_EVENT_BYTES = 1024 * 1024;

export type MockHttpRequest = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

export type MockHttpTransport = {
  readonly requests: ReadonlyArray<MockHttpRequest>;
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly respond: (response: Response) => void;
  readonly reject: (error: unknown) => void;
  readonly close: () => void;
};

export function createMockHttpTransport(): MockHttpTransport {
  const requests: Array<MockHttpRequest> = [];
  const pending: Array<{readonly resolve: (response: Response) => void; readonly reject: (error: unknown) => void}> = [];
  let closed = false;
  return {
    requests,
    fetch: async (input, init) => {
      if (closed) return Promise.reject(new Error('mock HTTP transport is closed'));
      if (pending.length >= MAX_HTTP_PENDING) return Promise.reject(new Error('mock HTTP pending request bound exceeded'));
      requests.push({url: String(input), init});
      return new Promise<Response>((resolve, reject) => pending.push({resolve, reject}));
    },
    respond: (response) => pending.shift()?.resolve(response),
    reject: (error) => pending.shift()?.reject(error),
    close: () => {
      if (closed) return;
      closed = true;
      const error = new Error('mock HTTP transport closed');
      while (pending.length > 0) pending.shift()?.reject(error);
    },
  };
}

export type MockSseTransport = {
  readonly stream: ReadableStream<Uint8Array>;
  readonly send: (event: string, data: string) => void;
  readonly close: () => void;
  readonly signal: AbortSignal;
};

export function createMockSseTransport(signal?: AbortSignal): MockSseTransport {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = signal?.aborted ?? false;
  const internalController = new AbortController();
  const transportSignal = signal ?? internalController.signal;
  const abort = (): void => {
    if (closed) return;
    closed = true;
    controller?.close();
  };
  signal?.addEventListener('abort', abort, {once: true});
  const stream = new ReadableStream<Uint8Array>({start: (value) => { controller = value; }, cancel: () => { closed = true; }});
  return {
    stream,
    signal: transportSignal,
    send: (event, data) => {
      if (closed || !controller) throw new Error('SSE stream is closed');
      const payload = `event: ${event}\ndata: ${data}\n\n`;
      if (new TextEncoder().encode(payload).byteLength > MAX_SSE_EVENT_BYTES) throw new Error('SSE event exceeds byte bound');
      controller.enqueue(new TextEncoder().encode(payload));
    },
    close: () => {
      if (closed) return;
      closed = true;
      controller?.close();
    },
  };
}
