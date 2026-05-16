// pattern: Functional Core

function hashContent(value: string): DimensionSnapshot {
  return {
    hash: BigInt(Bun.hash(value)),
    size: value.length,
  };
}

function serializeTools(tools: ReadonlyArray<unknown>): string {
  const sorted = Array.from(tools).sort((a, b) => {
    const aName = (a as {name?: string}).name ?? '';
    const bName = (b as {name?: string}).name ?? '';
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

  const messageHashes = prefixMessages.map(msg =>
    BigInt(Bun.hash(JSON.stringify(msg))),
  );

  const totalSize = prefixMessages.reduce((sum: number, msg) => {
    return sum + JSON.stringify(msg).length;
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
      systemPrompt,
      tools,
      messages,
      betaHeaders,
      turn,
      _flags,
    ) {
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
        events.push({
          dimension: 'system_prompt',
          previousSize: prevSystemPromptHash.size,
          currentSize: currentSystemPromptHash.size,
          delta: currentSystemPromptHash.size - prevSystemPromptHash.size,
          turn,
        });
      }

      // Check tool_definitions dimension
      const prevToolsHash = previousHashes.get('tool_definitions');
      if (prevToolsHash && prevToolsHash.hash !== currentToolsHash.hash) {
        events.push({
          dimension: 'tool_definitions',
          previousSize: prevToolsHash.size,
          currentSize: currentToolsHash.size,
          delta: currentToolsHash.size - prevToolsHash.size,
          turn,
        });
      }

      // Check beta_headers dimension
      const prevBetaHeadersHash = previousHashes.get('beta_headers');
      if (prevBetaHeadersHash && prevBetaHeadersHash.hash !== currentBetaHeadersHash.hash) {
        events.push({
          dimension: 'beta_headers',
          previousSize: prevBetaHeadersHash.size,
          currentSize: currentBetaHeadersHash.size,
          delta: currentBetaHeadersHash.size - prevBetaHeadersHash.size,
          turn,
        });
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

        if (prefixChanged) {
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
