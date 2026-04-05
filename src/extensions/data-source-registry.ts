// pattern: Imperative Shell

import type { IncomingMessage, DataSource, DataSourceRegistration, DataSourceRegistry } from './data-source.ts';
import type { ActivityManager } from '../activity/types.ts';
import { createActivityInterceptor } from '../activity/activity-interceptor.ts';

type EventSink = {
  push(event: IncomingMessage): void;
};

type ProcessFn = () => Promise<void>;

type RegistryOptions = {
  readonly registrations: ReadonlyArray<DataSourceRegistration>;
  readonly eventSink: EventSink;
  readonly processEvents: ProcessFn;
  readonly activityManager?: ActivityManager;
};

export function createDataSourceRegistry(
  options: Readonly<RegistryOptions>,
): DataSourceRegistry {
  const { registrations, eventSink, processEvents, activityManager } = options;
  const sources: Array<DataSource> = [];

  for (const registration of registrations) {
    const { source, highPriorityFilter } = registration;
    sources.push(source);

    const baseHandler = (message: IncomingMessage): void => {
      eventSink.push(message);
      processEvents().catch((error) => {
        console.error(`[registry] ${source.name} event processing error:`, error);
      });
    };

    if (activityManager) {
      source.onMessage(createActivityInterceptor({
        activityManager,
        originalHandler: baseHandler,
        sourcePrefix: source.name,
        highPriorityFilter,
      }));
    } else {
      source.onMessage(baseHandler);
    }
  }

  async function shutdown(): Promise<void> {
    const disconnects = sources.map(async (source) => {
      try {
        await source.disconnect();
        console.log(`[registry] disconnected ${source.name}`);
      } catch (error) {
        console.error(`[registry] error disconnecting ${source.name}:`, error);
      }
    });
    await Promise.allSettled(disconnects);
  }

  return {
    sources,
    shutdown,
  };
}
