import { describe, test, expect } from 'bun:test';
import { formatRecallSection, createRecallContextProvider } from './context.js';
import type { RecallResult, RecallFragment } from './types.js';

describe('formatRecallSection', () => {
  test('renders section header with recalled context title', () => {
    const fragment: RecallFragment = {
      id: '1',
      label: 'personality',
      domain: 'memory',
      content: 'This is the content of the fragment...',
      score: 0.95,
      source: 'semantic',
      tier: null,
    };

    const result: RecallResult = {
      fragments: [fragment],
      totalTokens: 100,
      queryCount: 1,
      elapsed: 500,
    };

    const output = formatRecallSection(result);

    expect(output).toContain('## Recalled Context');
  });

  test('renders single fragment with label and domain header', () => {
    const fragment: RecallFragment = {
      id: '1',
      label: 'personality',
      domain: 'memory',
      content: 'This is the content of the fragment...',
      score: 0.95,
      source: 'semantic',
      tier: null,
    };

    const result: RecallResult = {
      fragments: [fragment],
      totalTokens: 100,
      queryCount: 1,
      elapsed: 500,
    };

    const output = formatRecallSection(result);

    expect(output).toContain('### personality | memory');
    expect(output).toContain('This is the content of the fragment...');
  });

  test('does not include score metadata in output', () => {
    const fragment: RecallFragment = {
      id: '1',
      label: 'test label',
      domain: 'memory',
      content: 'test content',
      score: 0.95,
      source: 'semantic',
      tier: null,
    };

    const result: RecallResult = {
      fragments: [fragment],
      totalTokens: 100,
      queryCount: 1,
      elapsed: 500,
    };

    const output = formatRecallSection(result);

    expect(output).not.toContain('0.95');
    expect(output).not.toContain('score');
  });

  test('renders multiple fragments each with separate headers', () => {
    const fragments: Array<RecallFragment> = [
      {
        id: '1',
        label: 'personality',
        domain: 'memory',
        content: 'First fragment content',
        score: 0.95,
        source: 'semantic',
        tier: null,
      },
      {
        id: '2',
        label: '2024-01-15 conversation',
        domain: 'conversations',
        content: 'Second fragment content',
        score: 0.87,
        source: 'semantic',
        tier: null,
      },
    ];

    const result: RecallResult = {
      fragments,
      totalTokens: 200,
      queryCount: 2,
      elapsed: 1000,
    };

    const output = formatRecallSection(result);

    expect(output).toContain('### personality | memory');
    expect(output).toContain('### 2024-01-15 conversation | conversations');
    expect(output).toContain('First fragment content');
    expect(output).toContain('Second fragment content');
  });

  test('renders fragment with tier in header', () => {
    const fragment: RecallFragment = {
      id: '1',
      label: 'important memory',
      domain: 'memory',
      content: 'Test content',
      score: 0.95,
      source: 'semantic',
      tier: 'tier-1',
    };

    const result: RecallResult = {
      fragments: [fragment],
      totalTokens: 100,
      queryCount: 1,
      elapsed: 500,
    };

    const output = formatRecallSection(result);

    // Should include label and domain, tier should be incorporated appropriately
    expect(output).toContain('important memory');
    expect(output).toContain('memory');
  });

  test('renders fragments from memory domain correctly', () => {
    const fragment: RecallFragment = {
      id: '1',
      label: 'core belief',
      domain: 'memory',
      content: 'Important value here',
      score: 0.9,
      source: 'entity',
      tier: null,
    };

    const result: RecallResult = {
      fragments: [fragment],
      totalTokens: 50,
      queryCount: 1,
      elapsed: 200,
    };

    const output = formatRecallSection(result);

    expect(output).toContain('core belief');
    expect(output).toContain('memory');
    expect(output).toContain('Important value here');
  });

  test('renders fragments from conversations domain correctly', () => {
    const fragment: RecallFragment = {
      id: '1',
      label: 'decision discussion',
      domain: 'conversations',
      content: 'We decided to implement feature X',
      score: 0.85,
      source: 'semantic',
      tier: null,
    };

    const result: RecallResult = {
      fragments: [fragment],
      totalTokens: 75,
      queryCount: 1,
      elapsed: 300,
    };

    const output = formatRecallSection(result);

    expect(output).toContain('decision discussion');
    expect(output).toContain('conversations');
    expect(output).toContain('We decided to implement feature X');
  });
});

describe('createRecallContextProvider', () => {
  test('returns undefined when no result is set', () => {
    const provider = createRecallContextProvider();

    const result = provider();

    expect(result).toBeUndefined();
  });

  test('returns undefined when result is set to null', () => {
    const provider = createRecallContextProvider();
    provider.setResult(null);

    const result = provider();

    expect(result).toBeUndefined();
  });

  test('returns undefined when result has empty fragments array', () => {
    const provider = createRecallContextProvider();
    provider.setResult({
      fragments: [],
      totalTokens: 0,
      queryCount: 0,
      elapsed: 0,
    });

    const result = provider();

    expect(result).toBeUndefined();
  });

  test('returns formatted section when result is set with fragments', () => {
    const provider = createRecallContextProvider();

    const fragment: RecallFragment = {
      id: '1',
      label: 'test',
      domain: 'memory',
      content: 'test content',
      score: 0.95,
      source: 'semantic',
      tier: null,
    };

    const recallResult: RecallResult = {
      fragments: [fragment],
      totalTokens: 100,
      queryCount: 1,
      elapsed: 500,
    };

    provider.setResult(recallResult);
    const result = provider();

    expect(result).toBeDefined();
    expect(result).toContain('## Recalled Context');
    expect(result).toContain('test');
  });

  test('provider output includes recalled context header', () => {
    const provider = createRecallContextProvider();

    const fragment: RecallFragment = {
      id: '1',
      label: 'personality',
      domain: 'memory',
      content: 'This is the content of the fragment...',
      score: 0.95,
      source: 'semantic',
      tier: null,
    };

    const recallResult: RecallResult = {
      fragments: [fragment],
      totalTokens: 100,
      queryCount: 1,
      elapsed: 500,
    };

    provider.setResult(recallResult);
    const result = provider();

    expect(result).toContain('## Recalled Context');
  });

  test('handles multiple calls to setResult', () => {
    const provider = createRecallContextProvider();

    const fragment1: RecallFragment = {
      id: '1',
      label: 'first',
      domain: 'memory',
      content: 'first content',
      score: 0.95,
      source: 'semantic',
      tier: null,
    };

    const result1: RecallResult = {
      fragments: [fragment1],
      totalTokens: 100,
      queryCount: 1,
      elapsed: 500,
    };

    provider.setResult(result1);
    const output1 = provider();

    expect(output1).toContain('first');

    const fragment2: RecallFragment = {
      id: '2',
      label: 'second',
      domain: 'conversations',
      content: 'second content',
      score: 0.87,
      source: 'semantic',
      tier: null,
    };

    const result2: RecallResult = {
      fragments: [fragment2],
      totalTokens: 150,
      queryCount: 1,
      elapsed: 600,
    };

    provider.setResult(result2);
    const output2 = provider();

    expect(output2).toContain('second');
    expect(output2).not.toContain('first');
  });
});
