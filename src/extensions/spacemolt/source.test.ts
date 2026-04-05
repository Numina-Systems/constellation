import {describe, test, expect, afterEach} from 'bun:test';
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
    // Simulate async open behavior
    setTimeout(() => {
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
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

  // Helper to simulate server messages
  simulateMessage(event: SpaceMoltEvent): void {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify(event),
        }),
      );
    }
  }
}

describe('createSpaceMoltSource', () => {
  afterEach(() => {
    // Restore original WebSocket
    const originalWebSocket = (global as any).WebSocket;
    if (originalWebSocket && originalWebSocket.prototype) {
      // It's already a real WebSocket, no need to restore
    }
  });

  test('connects and authenticates via login message', async () => {
    let createdSocket: MockWebSocket | null = null;
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    try {
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

      // Simulate server responses
      await new Promise<void>(resolve => {
        const checkSocket = setInterval(() => {
          if (createdSocket !== null) {
            clearInterval(checkSocket);

            // Send welcome message
            createdSocket.simulateMessage({
              type: 'welcome',
              payload: {version: '1.0'},
            });

            // Verify login was sent and respond
            setTimeout(() => {
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

              resolve();
            }, 10);
          }
        }, 5);
      });

      // Wait for connection to complete
      await connectPromise;

      // Verify connection succeeded
      expect(source.name).toBe('spacemolt');
      expect(gameStateManager.getGameState()).toBe('DOCKED');
    } finally {
      (global as any).WebSocket = originalWebSocket;
    }
  });

  test('classifies combat_update as high priority and calls messageHandler', async () => {
    let createdSocket: MockWebSocket | null = null;
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    try {
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

      await new Promise<void>(resolve => {
        const checkSocket = setInterval(() => {
          if (createdSocket !== null) {
            clearInterval(checkSocket);

            createdSocket.simulateMessage({
              type: 'welcome',
              payload: {},
            });

            setTimeout(() => {
              createdSocket!.simulateMessage({
                type: 'logged_in',
                payload: {docked_at_base: true},
              });

              setTimeout(() => {
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

                resolve();
              }, 10);
            }, 10);
          }
        }, 5);
      });

      await connectPromise;

      // Give time for async message handling
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(messages.length).toBe(1);
      expect(messages[0]?.content).toContain('Combat:');
      expect(messages[0]?.content).toContain('Alice');
      expect(messages[0]?.content).toContain('Bob');
    } finally {
      (global as any).WebSocket = originalWebSocket;
    }
  });

  test('classifies chat_message as normal priority and calls messageHandler', async () => {
    let createdSocket: MockWebSocket | null = null;
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    try {
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

      await new Promise<void>(resolve => {
        const checkSocket = setInterval(() => {
          if (createdSocket !== null) {
            clearInterval(checkSocket);

            createdSocket.simulateMessage({
              type: 'welcome',
              payload: {},
            });

            setTimeout(() => {
              createdSocket!.simulateMessage({
                type: 'logged_in',
                payload: {docked_at_base: true},
              });

              setTimeout(() => {
                // Send chat_message event
                createdSocket!.simulateMessage({
                  type: 'chat_message',
                  payload: {
                    channel: 'general',
                    sender: 'Alice',
                    content: 'Hello everyone',
                  },
                });

                resolve();
              }, 10);
            }, 10);
          }
        }, 5);
      });

      await connectPromise;
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(messages.length).toBe(1);
      expect(messages[0]?.content).toContain('Chat');
      expect(messages[0]?.content).toContain('Alice');
    } finally {
      (global as any).WebSocket = originalWebSocket;
    }
  });

  test('does not call messageHandler for internal events like tick', async () => {
    let createdSocket: MockWebSocket | null = null;
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    try {
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

      await new Promise<void>(resolve => {
        const checkSocket = setInterval(() => {
          if (createdSocket !== null) {
            clearInterval(checkSocket);

            createdSocket.simulateMessage({
              type: 'welcome',
              payload: {},
            });

            setTimeout(() => {
              createdSocket!.simulateMessage({
                type: 'logged_in',
                payload: {docked_at_base: true},
              });

              setTimeout(() => {
                // Send tick event (internal)
                createdSocket!.simulateMessage({
                  type: 'tick',
                  payload: {tick_number: 123},
                });

                resolve();
              }, 10);
            }, 10);
          }
        }, 5);
      });

      await connectPromise;
      await new Promise(resolve => setTimeout(resolve, 50));

      // Tick is internal, so messageHandler should not be called
      expect(messages.length).toBe(0);
    } finally {
      (global as any).WebSocket = originalWebSocket;
    }
  });

  test('updates game state manager for all events', async () => {
    let createdSocket: MockWebSocket | null = null;
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    try {
      const gameStateManager = createGameStateManager('UNDOCKED');
      const source = createSpaceMoltSource({
        wsUrl: 'ws://localhost:8080/game',
        username: 'testuser',
        password: 'testpass',
        gameStateManager,
        eventQueueCapacity: 100,
      });

      const connectPromise = source.connect();

      await new Promise<void>(resolve => {
        const checkSocket = setInterval(() => {
          if (createdSocket !== null) {
            clearInterval(checkSocket);

            createdSocket.simulateMessage({
              type: 'welcome',
              payload: {},
            });

            setTimeout(() => {
              createdSocket!.simulateMessage({
                type: 'logged_in',
                payload: {docked_at_base: true},
              });

              setTimeout(() => {
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

                resolve();
              }, 10);
            }, 10);
          }
        }, 5);
      });

      await connectPromise;
      await new Promise(resolve => setTimeout(resolve, 50));

      // Game state should be updated to COMBAT
      expect(gameStateManager.getGameState()).toBe('COMBAT');
    } finally {
      (global as any).WebSocket = originalWebSocket;
    }
  });

  test('initializes game state to DOCKED when docked_at_base is true', async () => {
    let createdSocket: MockWebSocket | null = null;
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    try {
      const gameStateManager = createGameStateManager('UNDOCKED');
      const source = createSpaceMoltSource({
        wsUrl: 'ws://localhost:8080/game',
        username: 'testuser',
        password: 'testpass',
        gameStateManager,
        eventQueueCapacity: 100,
      });

      const connectPromise = source.connect();

      await new Promise<void>(resolve => {
        const checkSocket = setInterval(() => {
          if (createdSocket !== null) {
            clearInterval(checkSocket);

            createdSocket.simulateMessage({
              type: 'welcome',
              payload: {},
            });

            setTimeout(() => {
              createdSocket!.simulateMessage({
                type: 'logged_in',
                payload: {docked_at_base: true},
              });

              resolve();
            }, 10);
          }
        }, 5);
      });

      await connectPromise;

      expect(gameStateManager.getGameState()).toBe('DOCKED');
    } finally {
      (global as any).WebSocket = originalWebSocket;
    }
  });

  test('initializes game state to UNDOCKED when docked_at_base is false', async () => {
    let createdSocket: MockWebSocket | null = null;
    const originalWebSocket = (global as any).WebSocket;

    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        createdSocket = this;
      }
    };

    try {
      const gameStateManager = createGameStateManager('DOCKED');
      const source = createSpaceMoltSource({
        wsUrl: 'ws://localhost:8080/game',
        username: 'testuser',
        password: 'testpass',
        gameStateManager,
        eventQueueCapacity: 100,
      });

      const connectPromise = source.connect();

      await new Promise<void>(resolve => {
        const checkSocket = setInterval(() => {
          if (createdSocket !== null) {
            clearInterval(checkSocket);

            createdSocket.simulateMessage({
              type: 'welcome',
              payload: {},
            });

            setTimeout(() => {
              createdSocket!.simulateMessage({
                type: 'logged_in',
                payload: {docked_at_base: false},
              });

              resolve();
            }, 10);
          }
        }, 5);
      });

      await connectPromise;

      expect(gameStateManager.getGameState()).toBe('UNDOCKED');
    } finally {
      (global as any).WebSocket = originalWebSocket;
    }
  });
});
