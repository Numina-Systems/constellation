import { describe, it, expect } from "bun:test";
import { createEventQueue } from "./event-queue.ts";
import type { IncomingMessage } from "../data-source.ts";

describe("EventQueue", () => {
  it("should be FIFO: push/shift ordering", () => {
    const queue = createEventQueue(10);

    const event1: IncomingMessage = {
      source: "test1",
      content: "first",
      metadata: {},
      timestamp: new Date(),
    };

    const event2: IncomingMessage = {
      source: "test2",
      content: "second",
      metadata: {},
      timestamp: new Date(),
    };

    queue.push(event1);
    queue.push(event2);

    expect(queue.shift()).toBe(event1);
    expect(queue.shift()).toBe(event2);
  });

  it("should return null on empty queue", () => {
    const queue = createEventQueue(10);
    expect(queue.shift()).toBeNull();
  });

  it("should drop oldest when capacity exceeded (AC6.2)", () => {
    const queue = createEventQueue(3);

    const events: IncomingMessage[] = [];
    for (let i = 0; i < 4; i++) {
      events.push({
        source: `test${i}`,
        content: `event ${i}`,
        metadata: {},
        timestamp: new Date(),
      });
    }

    // Push 4 events into a queue with capacity 3
    events.forEach((event) => queue.push(event));

    // Length should be exactly 3
    expect(queue.length).toBe(3);

    // First event should be gone (dropped as oldest)
    // Second, third, fourth should remain
    const shifted1 = queue.shift();
    expect(shifted1?.content).toBe("event 1");

    const shifted2 = queue.shift();
    expect(shifted2?.content).toBe("event 2");

    const shifted3 = queue.shift();
    expect(shifted3?.content).toBe("event 3");

    // Queue should be empty now
    expect(queue.shift()).toBeNull();
  });

  it("should handle 51 events with capacity 50 (AC6.2)", () => {
    const queue = createEventQueue(50);

    const events: IncomingMessage[] = [];
    for (let i = 0; i < 51; i++) {
      events.push({
        source: `test${i}`,
        content: `event ${i}`,
        metadata: {},
        timestamp: new Date(),
      });
    }

    // Push all 51 events
    events.forEach((event) => queue.push(event));

    // Length should be exactly 50
    expect(queue.length).toBe(50);

    // First event (index 0) should be gone
    const shifted1 = queue.shift();
    expect(shifted1?.content).toBe("event 1");

    // Remaining 49 events should be in order
    for (let i = 2; i <= 50; i++) {
      const shifted = queue.shift();
      expect(shifted?.content).toBe(`event ${i}`);
    }

    // Queue should be empty now
    expect(queue.shift()).toBeNull();
  });

  it("should track length correctly", () => {
    const queue = createEventQueue(5);

    expect(queue.length).toBe(0);

    const event: IncomingMessage = {
      source: "test",
      content: "test",
      metadata: {},
      timestamp: new Date(),
    };

    queue.push(event);
    expect(queue.length).toBe(1);

    queue.push(event);
    expect(queue.length).toBe(2);

    queue.shift();
    expect(queue.length).toBe(1);

    queue.shift();
    expect(queue.length).toBe(0);
  });

  it("should expose capacity", () => {
    const queue1 = createEventQueue(50);
    expect(queue1.capacity).toBe(50);

    const queue2 = createEventQueue(100);
    expect(queue2.capacity).toBe(100);
  });
});
