// pattern: Functional Core

function isDimensionSuppressed(
  dimension: CacheDimension,
  flags: SuppressionFlags,
): boolean {
  if (flags.isFirstTurn) return true;

  switch (dimension) {
    case 'system_prompt':
    case 'message_prefix':
      return flags.compactionOccurred === true;
    case 'tool_definitions':
      return flags.toolsChanged === true;
    case 'beta_headers':
      return false;
  }
}

function hashContent(value: string): DimensionSnapshot {
  return {
    hash: BigInt(Bun.hash(value)),
    size: value.length,
  };
}

function serializeTools(
  tools: ReadonlyArray<{readonly name?: string; [key: string]: unknown}>,
): string {
  const sorted = Array.from(tools).sort((a, b) => {
    const aName = a.name ?? '';
    const bName = b.name ?? '';
    return aName.localeCompare(bName);
  });
  return JSON.stringify(sorted);
}

function computeMessagePrefixState(
  messages: ReadonlyArray<unknown>,
): MessagePrefixState {
  if (messages.length === 0) {
    return {
      messageHashes: [],
      prefixLength: 0,
      totalSize: 0,
    };
  }

  const prefixLength = messages.length - 1;
  const prefixMessages = Array.from(messages).slice(0, prefixLength);

  const serializedMessages = prefixMessages.map(msg => JSON.stringify(msg));

  const messageHashes = serializedMessages.map(serialized =>
    BigInt(Bun.hash(serialized)),
  );

  const totalSize = serializedMessages.reduce((sum: number, serialized) => {
    return sum + serialized.length;
  }, 0);

  return {
    messageHashes,
    prefixLength,
    totalSize,
  };
}

function serializeBetaHeaders(
  headers: ReadonlyArray<string> | undefined,
): string {
  if (!headers || headers.length === 0) {
    return '';
  }
  return Array.from(headers).sort().join(',');
}

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

export type CheckForCacheBustOptions = {
  readonly systemPrompt: string;
  readonly tools: ReadonlyArray<{readonly name?: string; [key: string]: unknown}>;
  readonly messages: ReadonlyArray<unknown>;
  readonly betaHeaders?: ReadonlyArray<string>;
  readonly turn: number;
  readonly flags: SuppressionFlags;
};

export type CacheDiagnostics = {
  checkForCacheBust(options: CheckForCacheBustOptions): ReadonlyArray<CacheBustEvent>;
  reset(): void;
};

export function createCacheDiagnostics(): CacheDiagnostics {
  let previousHashes: Map<CacheDimension, DimensionSnapshot> | null = null;
  let previousPrefixState: MessagePrefixState | null = null;

  return {
    checkForCacheBust(options) {
      const {systemPrompt, tools, messages, betaHeaders, turn, flags} = options;

      // Compute current dimension hashes
      const currentSystemPromptHash = hashContent(systemPrompt);
      const toolsSerialised = serializeTools(tools);
      const currentToolsHash = hashContent(toolsSerialised);
      const currentBetaHeadersSerialized = serializeBetaHeaders(betaHeaders);
      const currentBetaHeadersHash = hashContent(currentBetaHeadersSerialized);
      const currentPrefixState = computeMessagePrefixState(messages);

      // First call: store hashes and return empty
      if (previousHashes === null) {
        previousHashes = new Map([
          ['system_prompt', currentSystemPromptHash],
          ['tool_definitions', currentToolsHash],
          ['beta_headers', currentBetaHeadersHash],
        ]);
        previousPrefixState = currentPrefixState;
        return [];
      }

      const events: Array<CacheBustEvent> = [];

      // Check system_prompt dimension
      const prevSystemPromptHash = previousHashes.get('system_prompt');
      if (prevSystemPromptHash && prevSystemPromptHash.hash !== currentSystemPromptHash.hash) {
        if (!isDimensionSuppressed('system_prompt', flags)) {
          events.push({
            dimension: 'system_prompt',
            previousSize: prevSystemPromptHash.size,
            currentSize: currentSystemPromptHash.size,
            delta: currentSystemPromptHash.size - prevSystemPromptHash.size,
            turn,
          });
        }
      }

      // Check tool_definitions dimension
      const prevToolsHash = previousHashes.get('tool_definitions');
      if (prevToolsHash && prevToolsHash.hash !== currentToolsHash.hash) {
        if (!isDimensionSuppressed('tool_definitions', flags)) {
          events.push({
            dimension: 'tool_definitions',
            previousSize: prevToolsHash.size,
            currentSize: currentToolsHash.size,
            delta: currentToolsHash.size - prevToolsHash.size,
            turn,
          });
        }
      }

      // Check beta_headers dimension
      const prevBetaHeadersHash = previousHashes.get('beta_headers');
      if (prevBetaHeadersHash && prevBetaHeadersHash.hash !== currentBetaHeadersHash.hash) {
        if (!isDimensionSuppressed('beta_headers', flags)) {
          events.push({
            dimension: 'beta_headers',
            previousSize: prevBetaHeadersHash.size,
            currentSize: currentBetaHeadersHash.size,
            delta: currentBetaHeadersHash.size - prevBetaHeadersHash.size,
            turn,
          });
        }
      }

      // Check message_prefix dimension
      if (previousPrefixState) {
        const overlapLength = Math.min(
          previousPrefixState.prefixLength,
          currentPrefixState.prefixLength,
        );

        let prefixChanged = false;

        // Check if prefix shrunk (messages deleted)
        if (currentPrefixState.prefixLength < previousPrefixState.prefixLength) {
          prefixChanged = true;
        } else {
          // Check if any overlapping message hashes differ (edited or reordered)
          for (let i = 0; i < overlapLength; i++) {
            if (
              previousPrefixState.messageHashes[i] !== currentPrefixState.messageHashes[i]
            ) {
              prefixChanged = true;
              break;
            }
          }
        }

        if (prefixChanged && !isDimensionSuppressed('message_prefix', flags)) {
          events.push({
            dimension: 'message_prefix',
            previousSize: previousPrefixState.totalSize,
            currentSize: currentPrefixState.totalSize,
            delta: currentPrefixState.totalSize - previousPrefixState.totalSize,
            turn,
          });
        }
      }

      // Store current hashes for next call
      previousHashes = new Map([
        ['system_prompt', currentSystemPromptHash],
        ['tool_definitions', currentToolsHash],
        ['beta_headers', currentBetaHeadersHash],
      ]);
      previousPrefixState = currentPrefixState;

      return events;
    },
    reset() {
      previousHashes = null;
      previousPrefixState = null;
    },
  };
}
