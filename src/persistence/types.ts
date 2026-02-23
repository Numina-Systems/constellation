export type QueryFunction = <T extends Record<string, unknown>>(
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<Array<T>>;

export type PersistenceProvider = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runMigrations(): Promise<void>;
  query: QueryFunction;
  withTransaction<T>(
    fn: (query: QueryFunction) => Promise<T>,
  ): Promise<T>;
};
