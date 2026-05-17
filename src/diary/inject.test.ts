/**
 * Unit tests for diary injection.
 * Tests the buildDiarySection pure function against acceptance criteria.
 */

import { describe, test, expect } from 'bun:test';
import type { MemoryBlock } from '@/memory/types';
import { buildDiarySection } from './inject.js';

function createBlock(label: string, content: string): MemoryBlock {
  return {
    id: crypto.randomUUID(),
    owner: 'test-agent',
    tier: 'working',
    label,
    content,
    embedding: null,
    permission: 'readwrite',
    pinned: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('buildDiarySection', () => {
  test('diary-injection.AC1.1: selects blocks with diary: labels', () => {
    const blocks = [
      createBlock('diary:2026-05-16', 'Entry from May 16'),
      createBlock('diary:2026-05-17', 'Entry from May 17'),
      createBlock('other-label', 'Not a diary entry'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 10 });

    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries.some((e) => e.label === 'diary:2026-05-16')).toBe(true);
    expect(result!.entries.some((e) => e.label === 'diary:2026-05-17')).toBe(true);
  });

  test('diary-injection.AC1.2: sorts entries by date descending for selection, renders chronologically', () => {
    const blocks = [
      createBlock('diary:2026-05-15', 'Oldest'),
      createBlock('diary:2026-05-17', 'Newest'),
      createBlock('diary:2026-05-16', 'Middle'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 3 });

    expect(result).not.toBeNull();
    // All three should be selected (most recent 3)
    expect(result!.entries).toHaveLength(3);
    // But they should be rendered in chronological order (oldest first)
    const section = result!.section;
    const firstDateIndex = section.indexOf('### 2026-05-15');
    const secondDateIndex = section.indexOf('### 2026-05-16');
    const thirdDateIndex = section.indexOf('### 2026-05-17');

    expect(firstDateIndex).toBeLessThan(secondDateIndex);
    expect(secondDateIndex).toBeLessThan(thirdDateIndex);
  });

  test('diary-injection.AC1.3: caps selection at maxEntries', () => {
    const blocks = [
      createBlock('diary:2026-05-13', 'Entry 1'),
      createBlock('diary:2026-05-14', 'Entry 2'),
      createBlock('diary:2026-05-15', 'Entry 3'),
      createBlock('diary:2026-05-16', 'Entry 4'),
      createBlock('diary:2026-05-17', 'Entry 5'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 3 });

    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(3);
    // Should be the 3 most recent: 2026-05-15, 2026-05-16, 2026-05-17
    const dates = result!.entries.map((e) => e.date);
    expect(dates).toContain('2026-05-15');
    expect(dates).toContain('2026-05-16');
    expect(dates).toContain('2026-05-17');
    expect(dates).not.toContain('2026-05-13');
    expect(dates).not.toContain('2026-05-14');
  });

  test('diary-injection.AC1.4: sub-day labels sort correctly via lexicographic ordering', () => {
    const blocks = [
      createBlock('diary:2026-05-17', 'Morning'),
      createBlock('diary:2026-05-17-evening', 'Evening'),
      createBlock('diary:2026-05-16', 'Previous day'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 3 });

    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(3);

    // All three should be selected; render order should be: 2026-05-16, 2026-05-17, 2026-05-17-evening
    const section = result!.section;
    const idx16 = section.indexOf('### 2026-05-16');
    const idx17 = section.indexOf('### 2026-05-17');
    const idxEvening = section.indexOf('### 2026-05-17-evening');

    expect(idx16).toBeLessThan(idx17);
    expect(idx17).toBeLessThan(idxEvening);
  });

  test('diary-injection.AC1.5: single diary entry returns that entry alone', () => {
    const blocks = [createBlock('diary:2026-05-17', 'Single entry')];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 10 });

    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(1);
    expect(result!.entries[0]!.label).toBe('diary:2026-05-17');
    expect(result!.entries[0]!.content).toBe('Single entry');
  });

  test('diary-injection.AC2.1: total injected content is <= tokenBudget', () => {
    const blocks = [
      createBlock('diary:2026-05-16', 'x'.repeat(500)),
      createBlock('diary:2026-05-17', 'y'.repeat(500)),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 500, maxEntries: 10 });

    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBeLessThanOrEqual(500);
  });

  test('diary-injection.AC2.2: truncates final entry if exceeds remaining budget, does not drop it', () => {
    const blocks = [
      createBlock('diary:2026-05-16', 'x'.repeat(200)),
      createBlock('diary:2026-05-17', 'y'.repeat(200)),
    ];

    // Budget only allows first entry + part of second (first entry is ~60 tokens, budget is 80)
    const result = buildDiarySection(blocks, { tokenBudget: 80, maxEntries: 10 });

    expect(result).not.toBeNull();
    // Both date headers should be present
    expect(result!.section).toContain('### 2026-05-16');
    expect(result!.section).toContain('### 2026-05-17');
    // But second entry should be truncated
    expect(result!.section).toContain('...');
    expect(result!.totalTokens).toBeLessThanOrEqual(80);
  });

  test('diary-injection.AC2.3: entry exactly at budget limit included in full', () => {
    // Build a content size that will fit exactly in the budget
    // "## Diary\n\n" = 10 chars ≈ 3 tokens
    // "### 2026-05-16\n" = 15 chars ≈ 4 tokens
    // remaining = 50 - 3 - 4 = 43 tokens for content ≈ 172 chars
    const contentSize = 150;
    const blocks = [createBlock('diary:2026-05-16', 'x'.repeat(contentSize))];

    const result = buildDiarySection(blocks, { tokenBudget: 50, maxEntries: 10 });

    expect(result).not.toBeNull();
    // Content should not have truncation marker (fits within budget)
    expect(result!.section).not.toContain('...');
    expect(result!.totalTokens).toBeLessThanOrEqual(50);
  });

  test('diary-injection.AC2.4: single large entry truncated to fit budget', () => {
    const largeContent = 'x'.repeat(5000);
    const blocks = [createBlock('diary:2026-05-16', largeContent)];

    const result = buildDiarySection(blocks, { tokenBudget: 200, maxEntries: 10 });

    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBeLessThanOrEqual(200);
    // Should have truncation marker
    expect(result!.section).toContain('...');
    // Should not have full content
    expect(result!.section).not.toContain(largeContent);
  });

  test('diary-injection.AC3.1: output starts with "## Diary" header and uses "### YYYY-MM-DD" subheaders', () => {
    const blocks = [
      createBlock('diary:2026-05-16', 'Entry 1'),
      createBlock('diary:2026-05-17', 'Entry 2'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 10 });

    expect(result).not.toBeNull();
    expect(result!.section).toMatch(/^## Diary\n\n/);
    expect(result!.section).toContain('### 2026-05-16');
    expect(result!.section).toContain('### 2026-05-17');
  });

  test('diary-injection.AC3.2: entries rendered in chronological order (oldest first)', () => {
    const blocks = [
      createBlock('diary:2026-05-17', 'May 17'),
      createBlock('diary:2026-05-15', 'May 15'),
      createBlock('diary:2026-05-16', 'May 16'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 10 });

    expect(result).not.toBeNull();
    const idx15 = result!.section.indexOf('### 2026-05-15');
    const idx16 = result!.section.indexOf('### 2026-05-16');
    const idx17 = result!.section.indexOf('### 2026-05-17');

    expect(idx15).toBeLessThan(idx16);
    expect(idx16).toBeLessThan(idx17);
  });

  test('diary-injection.AC3.3: output contains no metadata (no tier, owner, label, embedding, permission)', () => {
    const blocks = [createBlock('diary:2026-05-16', 'Entry content')];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 10 });

    expect(result).not.toBeNull();
    expect(result!.section).not.toContain('tier:');
    expect(result!.section).not.toContain('owner:');
    expect(result!.section).not.toContain('label:');
    expect(result!.section).not.toContain('embedding');
    expect(result!.section).not.toContain('permission');
    expect(result!.section).not.toContain('diary:');
  });

  test('returns null on empty input', () => {
    const result = buildDiarySection([], { tokenBudget: 3000, maxEntries: 10 });
    expect(result).toBeNull();
  });

  test('returns null when no blocks match diary: label prefix', () => {
    const blocks = [
      createBlock('other-label', 'Not diary'),
      createBlock('memory:something', 'Also not diary'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 10 });
    expect(result).toBeNull();
  });

  test('filters out non-diary blocks and only includes diary blocks', () => {
    const blocks = [
      createBlock('diary:2026-05-16', 'Diary entry'),
      createBlock('memory:note', 'Not a diary entry'),
      createBlock('diary:2026-05-17', 'Another diary entry'),
      createBlock('nondiary', 'Definitely not diary'),
    ];

    const result = buildDiarySection(blocks, { tokenBudget: 3000, maxEntries: 10 });

    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(2);
    expect(result!.section).toContain('2026-05-16');
    expect(result!.section).toContain('2026-05-17');
    expect(result!.section).not.toContain('memory:note');
    expect(result!.section).not.toContain('Definitely not diary');
  });
});
