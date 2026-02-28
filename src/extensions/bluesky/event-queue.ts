// pattern: Imperative Shell

import type { IncomingMessage } from "../data-source.ts";

export type EventQueue = {
  push(event: IncomingMessage): void;
  shift(): IncomingMessage | null;
  readonly length: number;
  readonly capacity: number;
};

export function createEventQueue(capacity: number): EventQueue {
  const buffer: Array<IncomingMessage> = [];

  return {
    push(event: IncomingMessage): void {
      if (buffer.length >= capacity) {
        buffer.shift(); // drop oldest
      }
      buffer.push(event);
    },
    shift(): IncomingMessage | null {
      return buffer.shift() ?? null;
    },
    get length(): number {
      return buffer.length;
    },
    get capacity(): number {
      return capacity;
    },
  };
}
