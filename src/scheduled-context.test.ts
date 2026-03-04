// pattern: Functional Core

/**
 * Tests for scheduled task context formatting.
 * Verifies trace summaries are formatted compactly and readably.
 */

import { describe, test, expect } from 'bun:test';
import type { OperationTrace } from '@/reflexion';
import { formatTraceSummary } from './scheduled-context.ts';

function createTestTrace(overrides: Partial<OperationTrace> = {}): OperationTrace {
  return {
    id: 'test-trace-1',
    owner: 'spirit',
    conversationId: 'conv-1',
    toolName: 'memory_write',
    input: {},
    outputSummary: 'Wrote block core:persona with updated personality traits',
    durationMs: 125,
    success: true,
    error: null,
    createdAt: new Date('2026-03-03T14:32:00Z'),
    ...overrides,
  };
}

describe('formatTraceSummary', () => {
  test('AC1.3: returns section header with "No recent activity recorded." when traces is empty', () => {
    const result = formatTraceSummary([]);
    expect(result).toBe('[Recent Activity]\nNo recent activity recorded.');
  });

  test('AC3.1: formats single trace with timestamp, tool name, status, and output', () => {
    const createdAt = new Date('2026-03-03T14:32:00Z');
    const traces = [
      createTestTrace({
        createdAt,
        toolName: 'memory_write',
        success: true,
        outputSummary: 'Wrote block core:persona with updated personality traits',
      }),
    ];

    const expectedTime = createdAt.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const result = formatTraceSummary(traces);
    expect(result).toContain(`[${expectedTime}]`);
    expect(result).toContain('memory_write');
    expect(result).toContain('✓');
    expect(result).toContain('Wrote block core:persona with updated personality traits');
  });

  test('AC3.1: uses ✗ status indicator for failed traces', () => {
    const traces = [
      createTestTrace({
        success: false,
        outputSummary: 'Search failed: connection timeout',
      }),
    ];

    const result = formatTraceSummary(traces);
    expect(result).toContain('✗');
    expect(result).toContain('Search failed: connection timeout');
  });

  test('AC3.2: truncates output summaries longer than 80 chars with … appended', () => {
    const longOutput = 'a'.repeat(100);
    const traces = [
      createTestTrace({
        outputSummary: longOutput,
      }),
    ];

    const result = formatTraceSummary(traces);
    expect(result).toContain('…');
    // Verify the output itself is truncated to 80 chars (before the ellipsis)
    const lines = result.split('\n');
    const traceLine = lines[1];
    if (traceLine === undefined) throw new Error('traceLine should exist');
    // Extract the output part after the tool name
    const outputParts = traceLine.split('memory_write');
    const outputPart = outputParts[1];
    if (outputPart === undefined) throw new Error('outputPart should exist');
    const outputOnly = outputPart.replace(/^\s*✓\s*/, '');
    expect(outputOnly).toMatch(/^a{80}…$/);
  });

  test('AC3.2: does not truncate output summaries at or under 80 chars', () => {
    const shortOutput = 'Executed Python snippet, returned 42';
    const traces = [
      createTestTrace({
        outputSummary: shortOutput,
      }),
    ];

    const result = formatTraceSummary(traces);
    expect(result).toContain(shortOutput);
    expect(result).not.toMatch(/\.\.\.$/m); // No ellipsis at end of output section
  });

  test('AC3.3: preserves input order (newest-first from queryTraces)', () => {
    const time1 = new Date('2026-03-03T14:32:00Z');
    const time2 = new Date('2026-03-03T14:30:00Z');
    const time3 = new Date('2026-03-03T14:28:00Z');

    const traces = [
      createTestTrace({
        createdAt: time1,
        toolName: 'memory_write',
        outputSummary: 'First (newest)',
      }),
      createTestTrace({
        createdAt: time2,
        toolName: 'web_search',
        outputSummary: 'Second',
      }),
      createTestTrace({
        createdAt: time3,
        toolName: 'code_execute',
        outputSummary: 'Third (oldest)',
      }),
    ];

    const expectedTime1 = time1.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const expectedTime2 = time2.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const expectedTime3 = time3.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const result = formatTraceSummary(traces);
    const lines = result.split('\n');
    expect(lines[1]).toContain(`[${expectedTime1}]`);
    expect(lines[2]).toContain(`[${expectedTime2}]`);
    expect(lines[3]).toContain(`[${expectedTime3}]`);
  });

  test('section header: output starts with [Recent Activity]\\n', () => {
    const traces = [createTestTrace()];
    const result = formatTraceSummary(traces);
    expect(result.startsWith('[Recent Activity]\n')).toBe(true);
  });

  test('mixed success/failure traces render correct status indicators', () => {
    const traces = [
      createTestTrace({ success: true, outputSummary: 'Success 1' }),
      createTestTrace({ success: false, outputSummary: 'Failed' }),
      createTestTrace({ success: true, outputSummary: 'Success 2' }),
    ];

    const result = formatTraceSummary(traces);
    const lines = result.split('\n');
    expect(lines[1]).toContain('✓');
    expect(lines[2]).toContain('✗');
    expect(lines[3]).toContain('✓');
  });

  test('formats multiple traces as separate lines', () => {
    const traces = [
      createTestTrace({
        createdAt: new Date('2026-03-03T14:32:00Z'),
        outputSummary: 'First',
      }),
      createTestTrace({
        createdAt: new Date('2026-03-03T14:30:00Z'),
        outputSummary: 'Second',
      }),
    ];

    const result = formatTraceSummary(traces);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3); // header + 2 traces
    expect(lines[0]).toBe('[Recent Activity]');
  });
});
