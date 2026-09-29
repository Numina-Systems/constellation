// pattern: Functional Core (barrel export)

export type { BlueskyPostMetadata, BlueskyDataSource, BlueskyEventRecord, BlueskyStoredEvent, BlueskyEventStore } from "./types.ts";
export type { EventQueue } from "./event-queue.ts";
export { createBlueskySource, handleCommitEvent } from "./source.ts";
export type { HandleCommitEventDeps } from "./source.ts";
export { createPostgresBlueskyEventStore } from "./postgres-event-store.ts";
export { createBlueskyContextProvider } from "./context-provider.ts";
export { seedBlueskyTemplates } from "./seed.ts";
export { createEventQueue } from "./event-queue.ts";
