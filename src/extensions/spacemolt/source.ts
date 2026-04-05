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
  const {wsUrl, username, password, gameStateManager} = options;

  let ws: WebSocket | null = null;
  let messageHandler: ((msg: IncomingMessage) => void) | null = null;

  // Promises to coordinate authentication flow
  let resolveWelcome: (() => void) | null = null;
  let resolveLoggedIn: (() => void) | null = null;

  const adapter: SpaceMoltDataSource = {
    name: 'spacemolt',

    async connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          ws = new WebSocket(wsUrl);

          ws.onopen = () => {
            // Welcome message received
            if (resolveWelcome) resolveWelcome();
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

          ws.onclose = () => {
            ws = null;
            messageHandler = null;
          };

          // Wait for welcome and logged_in messages
          const welcomePromise = new Promise<void>(resolve => {
            resolveWelcome = resolve;
          });

          const loggedInPromise = new Promise<void>(resolve => {
            resolveLoggedIn = resolve;
          });

          Promise.all([welcomePromise, loggedInPromise])
            .then(() => {
              resolve();
            })
            .catch(reject);
        } catch (error) {
          reject(error);
        }
      });
    },

    async disconnect(): Promise<void> {
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
