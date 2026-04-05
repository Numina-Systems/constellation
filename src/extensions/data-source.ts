// pattern: Functional Core (types only)

/**
 * DataSource represents an external data stream that produces and/or consumes messages.
 * Examples: Bluesky firehose, Discord channel, email inbox, webhook receiver.
 *
 * Implementations connect to an external service, emit incoming messages to a handler,
 * and optionally support sending outbound messages.
 */
export type IncomingMessage = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export type OutgoingMessage = {
  readonly destination: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
};

export interface DataSource {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (message: IncomingMessage) => void): void;
  send?(message: OutgoingMessage): Promise<void>;
}

export type DataSourceRegistration = {
  readonly source: DataSource;
  readonly instructions?: string;
  readonly highPriorityFilter?: (message: IncomingMessage) => boolean;
};

export type DataSourceRegistry = {
  readonly sources: ReadonlyArray<DataSource>;
  shutdown(): Promise<void>;
};
