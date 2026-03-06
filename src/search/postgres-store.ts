// pattern: Imperative Shell

import type { EmbeddingProvider } from '../embedding/types.ts';
import type {
  DomainSearchParams,
  SearchDomain,
  SearchDomainName,
  SearchParams,
  SearchResult,
} from './types.ts';
import type { SearchStore } from './store.ts';
import { mergeWithRRF } from './rrf.ts';

export function createSearchStore(embeddingProvider: EmbeddingProvider): SearchStore {
  const domains = new Map<SearchDomainName, SearchDomain>();

  function registerDomain(domain: SearchDomain): void {
    if (domains.has(domain.name)) {
      throw new Error(`Domain "${domain.name}" is already registered`);
    }
    domains.set(domain.name, domain);
  }

  async function search(params: SearchParams): Promise<ReadonlyArray<SearchResult>> {
    const { query, mode, domains: requestedDomains, limit } = params;

    // Generate embedding if needed
    let embedding: ReadonlyArray<number> | null = null;
    if (mode === 'semantic' || mode === 'hybrid') {
      try {
        embedding = await embeddingProvider.embed(query);
      } catch (error) {
        console.warn(
          `Embedding generation failed (${error instanceof Error ? error.message : String(error)}), falling back to keyword mode`,
        );
        // Fall back to keyword-only mode by setting embedding to null
        // If mode was 'semantic', we can't proceed, so treat as keyword
        // If mode was 'hybrid', this gracefully degrades to keyword
      }
    }

    // Resolve target domains
    const targetDomains: Array<SearchDomain> = [];
    for (const domainName of requestedDomains) {
      const domain = domains.get(domainName);
      if (domain) {
        targetDomains.push(domain);
      }
      // Silently skip unregistered domains
    }

    // Fan-out to domains
    const domainSearchParams: DomainSearchParams = {
      query,
      mode,
      domains: requestedDomains,
      embedding,
      limit,
      startTime: params.startTime,
      endTime: params.endTime,
      role: params.role,
      tier: params.tier,
    };

    const resultLists = await Promise.all(targetDomains.map((domain) => domain.search(domainSearchParams)));

    // Merge with RRF
    const merged = mergeWithRRF(resultLists);

    // Apply limit
    return merged.slice(0, limit);
  }

  return {
    search,
    registerDomain,
  };
}
