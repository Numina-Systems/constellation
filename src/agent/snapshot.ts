// pattern: Functional Core

/**
 * Batch-anchored snapshot state management.
 *
 * Implements per-provider content hashing and snapshot mode detection (full/delta/noop).
 * Uses `Bun.hash()` (wyhash) for fast non-cryptographic hashing. Tracks per-provider
 * content hashes across calls to determine whether to send all dynamic context (full),
 * only changed sections (delta), or nothing (noop).
 */

export type SnapshotMode = 'full' | 'delta' | 'noop';

export type SnapshotResult = {
  readonly mode: SnapshotMode;
  readonly content: string | null;
  readonly hashes: ReadonlyMap<string, bigint>;
  readonly changedProviders: ReadonlyArray<string>;
};

export type SnapshotState = {
  computeSnapshot(
    providers: ReadonlyMap<string, () => string | undefined>,
    forceFullSnapshot: boolean,
  ): SnapshotResult;
  reset(): void;
};

/**
 * Hashes a provider's output using Bun.hash().
 *
 * For undefined, uses a sentinel value distinct from empty string to satisfy AC4.4.
 * Both are deterministic (AC4.3).
 */
export function hashProviderOutput(value: string | undefined): bigint {
  if (value === undefined) {
    return BigInt(Bun.hash('__SNAPSHOT_UNDEFINED_SENTINEL__'));
  }
  return BigInt(Bun.hash(value));
}

/**
 * Formats provider sections into a single string with ## headers.
 *
 * Sections are separated by double newlines for readability.
 */
export function formatSnapshotContent(
  sections: ReadonlyArray<{name: string; content: string}>,
): string {
  return sections.map(section => `## ${section.name}\n\n${section.content}`).join('\n\n');
}

/**
 * Creates a snapshot state tracker for per-provider content hashing.
 *
 * Internal state tracks `previousHashes` (Map of provider name to hash) and
 * `isFirstCall` (starts true). Evaluates providers on each call to detect changes.
 */
export function createSnapshotState(): SnapshotState {
  let previousHashes = new Map<string, bigint>();
  let isFirstCall = true;

  return {
    computeSnapshot(providers, forceFullSnapshot) {
      // Evaluate each provider, collecting { name, output, hash } tuples
      const providerResults = Array.from(providers.entries()).map(([name, fn]) => {
        const output = fn();
        const hash = hashProviderOutput(output);
        return {name, output, hash};
      });

      // Build new hashes map for return value
      const newHashes = new Map(providerResults.map(r => [r.name, r.hash]));

      // FULL snapshot: first call or forced
      if (isFirstCall || forceFullSnapshot) {
        isFirstCall = false;
        previousHashes = newHashes;

        // Collect providers with non-undefined content
        const contentSections = providerResults
          .filter(r => r.output !== undefined)
          .map(r => ({name: r.name, content: r.output!}));

        if (contentSections.length === 0) {
          return {
            mode: 'full',
            content: null,
            hashes: newHashes,
            changedProviders: [],
          };
        }

        return {
          mode: 'full',
          content: formatSnapshotContent(contentSections),
          hashes: newHashes,
          changedProviders: contentSections.map(s => s.name),
        };
      }

      // SUBSEQUENT call: compare hashes
      const changedSections: Array<{name: string; content: string}> = [];
      const changedProviderNames: Array<string> = [];

      for (const {name, output, hash} of providerResults) {
        const previousHash = previousHashes.get(name);

        // Hash changed
        if (previousHash !== hash) {
          changedProviderNames.push(name);
          // Include in content sections only if output is non-undefined
          if (output !== undefined) {
            changedSections.push({name, content: output});
          }
        }
      }

      // Update previousHashes for next call
      previousHashes = newHashes;

      // NOOP: no hashes changed
      if (changedProviderNames.length === 0) {
        return {
          mode: 'noop',
          content: null,
          hashes: newHashes,
          changedProviders: [],
        };
      }

      // DELTA: some hashes changed
      return {
        mode: 'delta',
        content: changedSections.length > 0 ? formatSnapshotContent(changedSections) : null,
        hashes: newHashes,
        changedProviders: changedProviderNames,
      };
    },

    reset() {
      previousHashes.clear();
      isFirstCall = true;
    },
  };
}
