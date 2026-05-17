// pattern: Functional Core

export type SecretStore = {
  get(owner: string, key: string): Promise<string | null>;
  set(owner: string, key: string, value: string): Promise<void>;
  delete(owner: string, key: string): Promise<boolean>;
  listKeys(owner: string): Promise<ReadonlyArray<string>>;
};
