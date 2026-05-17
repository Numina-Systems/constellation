// pattern: Functional Core

/**
 * Diary injection module.
 * Builds a formatted diary section from memory blocks with diary: labels.
 * Selects entries by date (most recent first), respects token budget,
 * and renders chronologically (oldest first) for insertion into system prompts.
 */

import type { MemoryBlock } from '@/memory/types';
import { estimateTokens } from '@/agent';

export type DiaryEntry = {
  readonly label: string;
  readonly content: string;
  readonly date: string;
};

export type DiaryInjection = {
  readonly entries: ReadonlyArray<DiaryEntry>;
  readonly totalTokens: number;
  readonly section: string;
};

/**
 * Builds a formatted diary section from memory blocks.
 *
 * Algorithm:
 * 1. Filter blocks with diary: prefix
 * 2. Extract date from label (diary:2026-05-17 -> 2026-05-17)
 * 3. Sort by date descending (most recent first)
 * 4. Cap at maxEntries
 * 5. Accumulate tokens, truncate final entry if needed
 * 6. Reverse to chronological order (oldest first) for rendering
 * 7. Format as markdown section
 */
export function buildDiarySection(
  blocks: ReadonlyArray<MemoryBlock>,
  options: { readonly tokenBudget: number; readonly maxEntries: number },
): DiaryInjection | null {
  // Filter for diary blocks
  const diaryBlocks = blocks.filter((block) => block.label.startsWith('diary:'));

  if (diaryBlocks.length === 0) {
    return null;
  }

  // Extract dates and create entries with date field
  const entriesWithDates: Array<DiaryEntry> = diaryBlocks.map((block) => ({
    label: block.label,
    content: block.content,
    date: block.label.slice('diary:'.length),
  }));

  // Sort by date descending (most recent first)
  const sortedByDateDesc = [...entriesWithDates].sort((a, b) => b.date.localeCompare(a.date));

  // Cap at maxEntries
  const capped = sortedByDateDesc.slice(0, options.maxEntries);

  // Accumulate tokens and truncate as needed
  const header = '## Diary\n\n';
  let accumulatedTokens = estimateTokens(header);
  const selectedEntries: Array<DiaryEntry> = [];

  for (let i = 0; i < capped.length; i++) {
    const entry = capped[i]!;
    const subheader = `### ${entry.date}\n`;
    const subheaderTokens = estimateTokens(subheader);

    // Check if adding this entry header alone would exceed budget
    const tokensAfterHeader = accumulatedTokens + subheaderTokens;

    if (tokensAfterHeader > options.tokenBudget) {
      // Even the header exceeds budget, stop here
      break;
    }

    // Check if full content fits
    const contentTokens = estimateTokens(entry.content);
    const tokensAfterContent = tokensAfterHeader + contentTokens;
    const separator = '\n\n';
    const separatorTokens = estimateTokens(separator);

    if (tokensAfterContent + separatorTokens <= options.tokenBudget) {
      // Full content fits
      selectedEntries.push(entry);
      accumulatedTokens = tokensAfterContent + separatorTokens;
    } else {
      // Content exceeds budget; truncate it
      const remainingBudget = options.tokenBudget - tokensAfterHeader - separatorTokens;

      if (remainingBudget <= 0) {
        // Can't fit any content for this entry
        break;
      }

      // Estimate character count: 4 chars per token, reserve 3 for "..."
      const truncationMarker = '...';
      const maxChars = Math.max(1, remainingBudget * 4 - estimateTokens(truncationMarker) * 4);
      let truncated = entry.content.slice(0, maxChars);

      // Verify truncated version fits
      let truncatedWithMarker = truncated + truncationMarker;
      let truncatedTokens = estimateTokens(truncatedWithMarker);

      // Iteratively shrink until it fits
      while (tokensAfterHeader + truncatedTokens + separatorTokens > options.tokenBudget && truncated.length > 1) {
        truncated = truncated.slice(0, truncated.length - 1);
        truncatedWithMarker = truncated + truncationMarker;
        truncatedTokens = estimateTokens(truncatedWithMarker);
      }

      const truncatedEntry: DiaryEntry = {
        ...entry,
        content: truncatedWithMarker,
      };

      selectedEntries.push(truncatedEntry);
      accumulatedTokens = tokensAfterHeader + truncatedTokens + separatorTokens;
      break; // Stop after truncating (no more entries fit)
    }
  }

  // Reverse for chronological rendering (oldest first)
  const chronological = [...selectedEntries].reverse();

  // Format as markdown
  const lines: Array<string> = [header];
  for (const entry of chronological) {
    lines.push(`### ${entry.date}`);
    lines.push(entry.content);
    lines.push('');
  }

  const section = lines.join('\n').trim() + '\n';
  const finalTokens = estimateTokens(section);

  return {
    entries: chronological,
    totalTokens: finalTokens,
    section,
  };
}
