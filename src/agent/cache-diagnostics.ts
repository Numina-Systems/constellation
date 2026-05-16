// pattern: Functional Core

export type CacheDimension =
  | 'system_prompt'
  | 'tool_definitions'
  | 'message_prefix'
  | 'beta_headers';

export type CacheBustEvent = {
  readonly dimension: CacheDimension;
  readonly previousSize: number;
  readonly currentSize: number;
  readonly delta: number;
  readonly turn: number;
};

export type SuppressionFlags = {
  readonly compactionOccurred?: boolean;
  readonly toolsChanged?: boolean;
  readonly isFirstTurn?: boolean;
};

type DimensionSnapshot = {
  readonly hash: bigint;
  readonly size: number;
};

type MessagePrefixState = {
  readonly messageHashes: ReadonlyArray<bigint>;
  readonly prefixLength: number;
  readonly totalSize: number;
};

export type CacheDiagnostics = {
  checkForCacheBust(
    systemPrompt: string,
    tools: ReadonlyArray<unknown>,
    messages: ReadonlyArray<unknown>,
    betaHeaders: ReadonlyArray<string> | undefined,
    turn: number,
    flags: SuppressionFlags,
  ): ReadonlyArray<CacheBustEvent>;
  reset(): void;
};

export function createCacheDiagnostics(): CacheDiagnostics {
  let previousHashes: Map<CacheDimension, DimensionSnapshot> | null = null;
  let previousPrefixState: MessagePrefixState | null = null;

  return {
    checkForCacheBust(
      _systemPrompt: string,
      _tools: ReadonlyArray<unknown>,
      _messages: ReadonlyArray<unknown>,
      _betaHeaders: ReadonlyArray<string> | undefined,
      _turn: number,
      _flags: SuppressionFlags,
    ) {
      void previousHashes;
      void previousPrefixState;
      return [];
    },
    reset() {
      previousHashes = null;
      previousPrefixState = null;
    },
  };
}
