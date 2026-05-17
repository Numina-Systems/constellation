// pattern: Imperative Shell

import type { Tool } from '../types.js';
import type { Ingestor } from '@/ingest/ingest.js';

export function createIngestTool(ingestor: Ingestor): Tool {
  return {
    definition: {
      name: 'ingest_file',
      description:
        'Read a file from the workspace, split it into semantic chunks, and store the chunks as archival memory blocks with embeddings. Supports markdown (heading-aware chunking) and plain text. Re-ingesting the same file replaces old chunks atomically. Max file size: 1MB.',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to workspace root (e.g., "docs/guide.md")',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      const path = params['path'] as string;
      try {
        const result = await ingestor.ingest(path);
        return {
          success: true,
          output: `Ingested "${path}": ${result.chunksCreated} chunks stored with label prefix "${result.label}".`,
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
