// pattern: Functional Core

/**
 * Markdown-aware document chunking with heading context preservation.
 * Splits documents into semantically coherent chunks, preserving heading hierarchy.
 */

export type Chunk = {
  readonly content: string;
  readonly headingContext: string;
  readonly index: number;
  readonly tokenEstimate: number;
};

type ChunkOptions = {
  readonly maxChunkTokens?: number;
};

const DEFAULT_MAX_CHUNK_TOKENS = 1500;
const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Split markdown text on headings, preserving heading hierarchy as context.
 * Non-markdown text splits on double newlines.
 *
 * @param text - Document text to chunk
 * @param options - Configuration (maxChunkTokens default 1500)
 * @returns Array of chunks with heading context and token estimates
 */
export function chunkDocument(
  text: string,
  options?: ChunkOptions,
): ReadonlyArray<Chunk> {
  const maxChunkTokens = options?.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;

  if (!text || text.trim().length === 0) {
    return [];
  }

  const isMarkdown = /^#{1,6}\s/m.test(text);

  if (isMarkdown) {
    return chunkMarkdown(text, maxChunkTokens);
  } else {
    return chunkPlainText(text, maxChunkTokens);
  }
}

/**
 * Chunk markdown text preserving heading hierarchy.
 */
function chunkMarkdown(text: string, maxChunkTokens: number): ReadonlyArray<Chunk> {
  const lines = text.split('\n');
  const chunks: Array<Chunk> = [];
  const headingStack: Array<string> = [];
  let currentContent: Array<string> = [];
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // New heading found - flush current content if any
      if (currentContent.length > 0) {
        const contentText = currentContent.join('\n').trim();
        if (contentText.length > 0) {
          const contextStr = headingStack.join(' > ');
          const subcontent = contentText;

          // Split if exceeds token budget
          const subcontent_chunks = splitLongContent(
            subcontent,
            contextStr,
            maxChunkTokens,
            chunkIndex,
          );
          chunks.push(...subcontent_chunks);
          chunkIndex += subcontent_chunks.length;
        }
        currentContent = [];
      }

      // Update heading stack
      const headingLevel = headingMatch[1]!.length;
      const headingText = headingMatch[2]!;

      // Pop stack to same or lower level (higher level = fewer #s)
      while (headingStack.length > 0) {
        const lastHeadingText = headingStack[headingStack.length - 1]!;
        const lastLevel = lastHeadingText.match(/^(#{1,6})/)![1]!.length;
        if (lastLevel >= headingLevel) {
          headingStack.pop();
        } else {
          break;
        }
      }

      // Push new heading
      const headingLine = `${'#'.repeat(headingLevel)} ${headingText}`;
      headingStack.push(headingLine);

      // Start new chunk with the heading line
      currentContent = [headingLine];
    } else {
      // Regular content line
      currentContent.push(line);
    }
  }

  // Flush remaining content
  if (currentContent.length > 0) {
    const contentText = currentContent.join('\n').trim();
    if (contentText.length > 0) {
      const contextStr = headingStack.join(' > ');
      const subcontent_chunks = splitLongContent(
        contentText,
        contextStr,
        maxChunkTokens,
        chunkIndex,
      );
      chunks.push(...subcontent_chunks);
    }
  }

  return chunks;
}

/**
 * Chunk plain text on double newlines.
 */
function chunkPlainText(text: string, maxChunkTokens: number): ReadonlyArray<Chunk> {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  const chunks: Array<Chunk> = [];
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const tokenEstimate = estimateTokens(paragraph);

    if (tokenEstimate <= maxChunkTokens) {
      chunks.push({
        content: paragraph.trim(),
        headingContext: '',
        index: chunkIndex,
        tokenEstimate,
      });
      chunkIndex++;
    } else {
      // Split long paragraph on sentences if needed
      const sentences = paragraph
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim().length > 0);

      let buffer = '';
      for (const sentence of sentences) {
        const bufferWithSentence = buffer ? `${buffer}\n\n${sentence}` : sentence;
        const bufferTokens = estimateTokens(bufferWithSentence);

        if (bufferTokens <= maxChunkTokens) {
          buffer = bufferWithSentence;
        } else {
          if (buffer) {
            chunks.push({
              content: buffer.trim(),
              headingContext: '',
              index: chunkIndex,
              tokenEstimate: estimateTokens(buffer),
            });
            chunkIndex++;
          }
          buffer = sentence;
        }
      }

      if (buffer.trim().length > 0) {
        chunks.push({
          content: buffer.trim(),
          headingContext: '',
          index: chunkIndex,
          tokenEstimate: estimateTokens(buffer),
        });
        chunkIndex++;
      }
    }
  }

  return chunks;
}

/**
 * Split content that exceeds token budget, respecting heading context.
 */
function splitLongContent(
  content: string,
  headingContext: string,
  maxChunkTokens: number,
  startIndex: number,
): Array<Chunk> {
  const tokenEstimate = estimateTokens(content);

  if (tokenEstimate <= maxChunkTokens) {
    return [
      {
        content,
        headingContext,
        index: startIndex,
        tokenEstimate,
      },
    ];
  }

  // Split on double newlines first
  const parts = content.split(/\n\n+/).filter(p => p.trim().length > 0);
  const chunks: Array<Chunk> = [];
  let buffer = '';
  let chunkIndex = startIndex;

  for (const part of parts) {
    const partTrimmed = part.trim();
    const bufferWithPart = buffer ? `${buffer}\n\n${partTrimmed}` : partTrimmed;
    const bufferTokens = estimateTokens(bufferWithPart);

    if (bufferTokens <= maxChunkTokens) {
      buffer = bufferWithPart;
    } else {
      if (buffer) {
        chunks.push({
          content: buffer,
          headingContext,
          index: chunkIndex,
          tokenEstimate: estimateTokens(buffer),
        });
        chunkIndex++;
      }
      buffer = partTrimmed;
    }
  }

  if (buffer.trim().length > 0) {
    chunks.push({
      content: buffer,
      headingContext,
      index: chunkIndex,
      tokenEstimate: estimateTokens(buffer),
    });
  }

  return chunks;
}

/**
 * Estimate tokens as content length / APPROX_CHARS_PER_TOKEN.
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / APPROX_CHARS_PER_TOKEN);
}
