// pattern: Imperative Shell

import type {IncomingMessage} from '../data-source.ts';
import type {GameStateManager, SpaceMoltEvent, SpaceMoltDataSource} from './types.ts';
import {classifyEvent, formatEventContent} from './events.ts';

export type SpaceMoltSourceOptions = {
  readonly wsUrl: string;
  readonly username: string;
  readonly password: string;
  readonly gameStateManager: GameStateManager;
  readonly eventQueueCapacity: number;
};

export function createSpaceMoltSource(
  options: Readonly<SpaceMoltSourceOptions>,
): SpaceMoltDataSource {
  const {wsUrl, username, password, gameStateManager, eventQueueCapacity: _} = options;
  // eventQueueCapacity is used by the DataSource registry, not internally

  let ws: WebSocket | null = null;
  let messageHandler: ((msg: IncomingMessage) => void) | null = null;

  // Promises to coordinate authentication flow
  let resolveWelcome: (() => void) | null = null;
  let resolveLoggedIn: (() => void) | null = null;

  // Flag to control reconnection behavior on unexpected close
  let shouldReconnect = true;

  const CONNECT_TIMEOUT_MS = 30_000;
  const RECONNECT_DELAY_MS = 1_000;

  async function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          // WebSocket opened, but we wait for the welcome message before proceeding
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(String(event.data)) as SpaceMoltEvent;

            // Update game state from event
            gameStateManager.updateFromEvent(data);

            // Classify event tier
            const tier = classifyEvent(data.type);

            // Handle welcome message
            if (data.type === 'welcome') {
              if (resolveWelcome) resolveWelcome();
              // Send login message
              const loginMsg = {
                type: 'login',
                payload: {
                  username,
                  password,
                },
              };
              if (ws) {
                ws.send(JSON.stringify(loginMsg));
              }
              return;
            }

            // Handle logged_in message
            if (data.type === 'logged_in') {
              // Initialize game state from login payload
              const dockedAtBase = Boolean(data.payload['docked_at_base']);
              gameStateManager.reset(dockedAtBase ? 'DOCKED' : 'UNDOCKED');

              if (resolveLoggedIn) resolveLoggedIn();
              return;
            }

            // For non-internal events, create IncomingMessage and call handler
            if (tier !== 'internal' && messageHandler) {
              const incomingMessage: IncomingMessage = {
                source: 'spacemolt',
                content: formatEventContent(data),
                metadata: {
                  eventType: data.type,
                  eventPayload: data.payload,
                },
                timestamp: new Date(),
              };
              messageHandler(incomingMessage);
            }
          } catch (error) {
            console.error('[spacemolt] failed to process message:', error);
          }
        };

        ws.onerror = (error: Event) => {
          console.error('[spacemolt] WebSocket error:', error);
          reject(error);
        };

        ws.onclose = async () => {
          ws = null;
          messageHandler = null;

          // If shouldReconnect is true, attempt to reconnect
          if (shouldReconnect) {
            try {
              await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
              await connect();
            } catch (reconnectError) {
              console.error('[spacemolt] reconnection failed:', reconnectError);
            }
          }
        };

        // Wait for welcome and logged_in messages with timeout
        const welcomePromise = new Promise<void>(resolve => {
          resolveWelcome = resolve;
        });

        const loggedInPromise = new Promise<void>(resolve => {
          resolveLoggedIn = resolve;
        });

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<void>((_, rejectTimeout) => {
          timeoutId = setTimeout(() => {
            rejectTimeout(new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS}ms`));
          }, CONNECT_TIMEOUT_MS);
        });

        Promise.race([
          Promise.all([welcomePromise, loggedInPromise]),
          timeoutPromise,
        ])
          .then(() => {
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
            }
            resolve();
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  const adapter: SpaceMoltDataSource = {
    name: 'spacemolt',

    connect,

    async disconnect(): Promise<void> {
      // Set shouldReconnect to false before closing to prevent reconnection
      shouldReconnect = false;
      if (ws) {
        ws.close();
        ws = null;
      }
      messageHandler = null;
      resolveWelcome = null;
      resolveLoggedIn = null;
    },

    onMessage(handler: (message: IncomingMessage) => void): void {
      messageHandler = handler;
    },

    getGameState() {
      return gameStateManager.getGameState();
    },
  };

  return adapter;
}
