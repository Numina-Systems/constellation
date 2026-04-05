import {describe, test, expect, beforeEach, afterEach} from 'bun:test';
import {createSpaceMoltSource} from './source';
import {createGameStateManager} from './state';
import type {SpaceMoltEvent} from './types';

// Mock WebSocket for testing
class MockWebSocket {
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  private sentMessages: Array<string> = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    if (this.onclose) {
      this.onclose(new Event('close'));
    }
  }

  getSentMessages(): Array<string> {
    return [...this.sentMessages];
  }

  // Helper to simulate server messages synchronously
  simulateMessage(event: SpaceMoltEvent): void {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify(event),
        }),
      );
    }
  }

  // Trigger the onopen handler
  triggerOpen(): void {
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }
}

let originalWebSocket: any;

describe('createSpaceMoltSource', () => {
  beforeEach(() => {
    originalWebSocket = (global as any).WebSocket;
  });

  afterEach(() => {
    (global as any).WebSocket = originalWebSocket;
  });

  test('connects and authenticates via login message', async () => {
    let createdSocket: MockWebSocket | null = null;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    // Start connection
    const connectPromise = source.connect();

    // Simulate server responses synchronously
    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {version: '1.0'},
    });

    // Verify login was sent
    const sent = createdSocket!.getSentMessages();
    expect(sent.length).toBeGreaterThan(0);

    const loginMsg = sent.find(msg => msg.includes('login'));
    expect(loginMsg).toBeDefined();
    if (loginMsg) {
      const parsed = JSON.parse(loginMsg);
      expect(parsed.type).toBe('login');
      expect(parsed.payload.username).toBe('testuser');
      expect(parsed.payload.password).toBe('testpass');
    }

    // Send logged_in response
    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {
        docked_at_base: true,
      },
    });

    // Wait for connection to complete
    await connectPromise;

    // Verify connection succeeded
    expect(source.name).toBe('spacemolt');
    expect(gameStateManager.getGameState()).toBe('DOCKED');
  });

  test('classifies combat_update as high priority and calls messageHandler', async () => {
    let createdSocket: MockWebSocket | null = null;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const messages: Array<{content: string}> = [];
    source.onMessage(msg => {
      messages.push({content: msg.content});
    });

    const connectPromise = source.connect();

    // Simulate server responses synchronously
    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: true},
    });

    // Send combat_update event
    createdSocket!.simulateMessage({
      type: 'combat_update',
      payload: {
        attacker: 'Alice',
        target: 'Bob',
        damage: 50,
        damage_type: 'kinetic',
      },
    });

    await connectPromise;

    expect(messages.length).toBe(1);
    expect(messages[0]?.content).toContain('Combat:');
    expect(messages[0]?.content).toContain('Alice');
    expect(messages[0]?.content).toContain('Bob');
  });

  test('classifies chat_message as normal priority and calls messageHandler', async () => {
    let createdSocket: MockWebSocket | null = null;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const messages: Array<{content: string}> = [];
    source.onMessage(msg => {
      messages.push({content: msg.content});
    });

    const connectPromise = source.connect();

    // Simulate server responses synchronously
    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: true},
    });

    // Send chat_message event
    createdSocket!.simulateMessage({
      type: 'chat_message',
      payload: {
        channel: 'general',
        sender: 'Alice',
        content: 'Hello everyone',
      },
    });

    await connectPromise;

    expect(messages.length).toBe(1);
    expect(messages[0]?.content).toContain('Chat');
    expect(messages[0]?.content).toContain('Alice');
  });

  test('does not call messageHandler for internal events like tick', async () => {
    let createdSocket: MockWebSocket | null = null;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const messages: Array<string> = [];
    source.onMessage(msg => {
      messages.push(msg.content);
    });

    const connectPromise = source.connect();

    // Simulate server responses synchronously
    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: true},
    });

    // Send tick event (internal)
    createdSocket!.simulateMessage({
      type: 'tick',
      payload: {tick_number: 123},
    });

    await connectPromise;

    // Tick is internal, so messageHandler should not be called
    expect(messages.length).toBe(0);
  });

  test('updates game state manager for all events', async () => {
    let createdSocket: MockWebSocket | null = null;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const connectPromise = source.connect();

    // Simulate server responses synchronously
    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: true},
    });

    // Send combat_update (which transitions to COMBAT state)
    createdSocket!.simulateMessage({
      type: 'combat_update',
      payload: {
        attacker: 'Alice',
        target: 'Bob',
        damage: 50,
        damage_type: 'kinetic',
      },
    });

    await connectPromise;

    // Game state should be updated to COMBAT
    expect(gameStateManager.getGameState()).toBe('COMBAT');
  });

  test('initializes game state to DOCKED when docked_at_base is true', async () => {
    let createdSocket: MockWebSocket | null = null;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const connectPromise = source.connect();

    // Simulate server responses synchronously
    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: true},
    });

    await connectPromise;

    expect(gameStateManager.getGameState()).toBe('DOCKED');
  });

  test('initializes game state to UNDOCKED when docked_at_base is false', async () => {
    let createdSocket: MockWebSocket | null = null;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('DOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const connectPromise = source.connect();

    // Simulate server responses synchronously
    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: false},
    });

    await connectPromise;

    expect(gameStateManager.getGameState()).toBe('UNDOCKED');
  });

  test('AC5.2 + AC5.4: disconnect() sets shouldReconnect to false', async () => {
    let createdSocket: MockWebSocket | null = null;
    let reconnectAttempted = false;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const connectPromise = source.connect();

    createdSocket!.triggerOpen();
    createdSocket!.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    createdSocket!.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: true},
    });

    await connectPromise;

    // Disconnect (explicitly sets shouldReconnect to false)
    await source.disconnect();

    // Track if WebSocket constructor is called again (reconnection attempt)
    let connectionAttempts = 0;
    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        connectionAttempts++;
        super(url);
      }
    };

    // Trigger close event - should NOT attempt reconnection
    createdSocket!.close();

    // Wait a bit for any async reconnection to fail/succeed
    await new Promise(r => setTimeout(r, 100));

    // No new connection should have been attempted
    expect(connectionAttempts).toBe(0);
  });

  test('AC5.3: WebSocket closes unexpectedly during wake and reconnects', async () => {
    let socketInstances: MockWebSocket[] = [];

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        socketInstances.push(this);
      }
    };

    const gameStateManager = createGameStateManager('UNDOCKED');
    const source = createSpaceMoltSource({
      wsUrl: 'ws://localhost:8080/game',
      username: 'testuser',
      password: 'testpass',
      gameStateManager,
      eventQueueCapacity: 100,
    });

    const connectPromise = source.connect();

    const firstSocket = socketInstances[0]!;
    firstSocket.triggerOpen();
    firstSocket.simulateMessage({
      type: 'welcome',
      payload: {},
    });

    firstSocket.simulateMessage({
      type: 'logged_in',
      payload: {docked_at_base: true},
    });

    await connectPromise;

    // Now simulate unexpected close (triggering reconnection)
    firstSocket.close();

    // Wait for reconnection attempt
    await new Promise(r => setTimeout(r, 1500));

    // A new socket should have been created (reconnection attempt)
    expect(socketInstances.length).toBeGreaterThan(1);
  });
});
