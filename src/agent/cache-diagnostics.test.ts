// pattern: Functional Core

import {describe, test, expect, beforeEach} from 'bun:test';
import {createCacheDiagnostics, type SuppressionFlags} from './cache-diagnostics.ts';

describe('cache-bust-detection.AC1: Dimension Snapshotting', () => {
  let diagnostics = createCacheDiagnostics();

  beforeEach(() => {
    diagnostics = createCacheDiagnostics();
  });

  describe('AC1.1 — System prompt content hashing', () => {
    test('first call with system prompt returns empty array', () => {
      const events = diagnostics.checkForCacheBust(
        'system prompt',
        [],
        [],
        undefined,
        1,
        {},
      );
      expect(events.length).toBe(0);
    });

    test('identical system prompt produces no event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('prompt v1', [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('prompt v1', [], [], undefined, 2, flags);
      expect(events.length).toBe(0);
    });

    test('changed system prompt produces event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('prompt v1', [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('prompt v2', [], [], undefined, 2, flags);
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('system_prompt');
    });
  });

  describe('AC1.2 — Tool definitions hashing', () => {
    test('first call with tools returns empty array', () => {
      const tools = [{name: 'tool1', description: 'desc'}];
      const events = diagnostics.checkForCacheBust('', tools, [], undefined, 1, {});
      expect(events.length).toBe(0);
    });

    test('identical tools produce no event', () => {
      const flags: SuppressionFlags = {};
      const tool = {name: 'tool1', description: 'desc'};
      diagnostics.checkForCacheBust('', [tool], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [tool], [], undefined, 2, flags);
      expect(events.length).toBe(0);
    });

    test('changed tools produce event', () => {
      const flags: SuppressionFlags = {};
      const tool1 = {name: 'tool1', description: 'desc1'};
      const tool2 = {name: 'tool1', description: 'desc2'};
      diagnostics.checkForCacheBust('', [tool1], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [tool2], [], undefined, 2, flags);
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('tool_definitions');
    });

    test('tools in different order but same content produce no event', () => {
      const flags: SuppressionFlags = {};
      const tool1 = {name: 'a', description: 'desc'};
      const tool2 = {name: 'b', description: 'desc'};

      diagnostics.checkForCacheBust('', [tool1, tool2], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [tool2, tool1], [], undefined, 2, flags);
      expect(events.length).toBe(0);
    });
  });

  describe('AC1.3 — Message prefix hashing', () => {
    test('no messages in first call returns empty array', () => {
      const events = diagnostics.checkForCacheBust('', [], [], undefined, 1, {});
      expect(events.length).toBe(0);
    });

    test('identical message prefix produces no event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [msg1, msg2], undefined, 2, flags);
      expect(events.length).toBe(0);
    });

    test('edited message in prefix produces event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2], undefined, 1, flags);

      const msg1Modified = {role: 'user', content: 'hello world'};
      const events = diagnostics.checkForCacheBust('', [], [msg1Modified, msg2], undefined, 2, flags);
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('appending a new message does NOT produce event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg3 = {role: 'user', content: 'how are you'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2], undefined, 1, flags);
      // Append msg3 (no edit to existing messages)
      const events = diagnostics.checkForCacheBust('', [], [msg1, msg2, msg3], undefined, 2, flags);
      expect(events.length).toBe(0);
    });

    test('deleting a message from prefix produces event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2], undefined, 1, flags);
      // Remove msg1, keep msg2
      const events = diagnostics.checkForCacheBust('', [], [msg2], undefined, 2, flags);
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('reordering messages in prefix produces event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg3 = {role: 'user', content: 'how are you'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2, msg3], undefined, 1, flags);
      // Reorder: msg2, msg1, msg3 (msg3 becomes the new last message)
      const events = diagnostics.checkForCacheBust('', [], [msg2, msg1, msg3], undefined, 2, flags);
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('message_prefix');
    });
  });

  describe('AC1.4 — Beta headers hashing', () => {
    test('identical beta headers produce no event', () => {
      const flags: SuppressionFlags = {};
      const headers = ['header1', 'header2'];
      diagnostics.checkForCacheBust('', [], [], headers, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [], headers, 2, flags);
      expect(events.length).toBe(0);
    });

    test('changed beta headers produce event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('', [], [], ['header1'], 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [], ['header2'], 2, flags);
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('beta_headers');
    });

    test('undefined to undefined beta headers produce no event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('', [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [], undefined, 2, flags);
      expect(events.length).toBe(0);
    });

    test('undefined to defined beta headers produce event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('', [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [], ['header1'], 2, flags);
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('beta_headers');
    });

    test('beta headers order does not matter (sorted before hashing)', () => {
      const flags: SuppressionFlags = {};
      const headers1 = ['z', 'a', 'b'];
      const headers2 = ['a', 'b', 'z'];
      diagnostics.checkForCacheBust('', [], [], headers1, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [], headers2, 2, flags);
      expect(events.length).toBe(0);
    });
  });

  describe('AC1.5 — First turn has no previous snapshot', () => {
    test('first turn returns empty array with any content', () => {
      const events = diagnostics.checkForCacheBust(
        'system prompt',
        [{name: 'tool1'}],
        [{role: 'user', content: 'msg'}],
        ['header'],
        1,
        {},
      );
      expect(events.length).toBe(0);
    });
  });
});

describe('cache-bust-detection.AC2: Change Detection', () => {
  let diagnostics = createCacheDiagnostics();

  beforeEach(() => {
    diagnostics = createCacheDiagnostics();
  });

  describe('AC2.1 — System prompt change dimension', () => {
    test('event has dimension "system_prompt"', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('prompt1', [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('prompt2', [], [], undefined, 2, flags);
      expect(events[0]?.dimension).toBe('system_prompt');
    });
  });

  describe('AC2.2 — Tool definitions change dimension', () => {
    test('event has dimension "tool_definitions"', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('', [{name: 'tool1'}], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [{name: 'tool2'}], [], undefined, 2, flags);
      expect(events[0]?.dimension).toBe('tool_definitions');
    });
  });

  describe('AC2.3 — Message prefix change dimension', () => {
    test('event has dimension "message_prefix" on edit', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg1mod = {role: 'user', content: 'hello world'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [msg1mod, msg2], undefined, 2, flags);
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('event has dimension "message_prefix" on delete', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [msg2], undefined, 2, flags);
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('event has dimension "message_prefix" on reorder', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg3 = {role: 'user', content: 'how'};

      diagnostics.checkForCacheBust('', [], [msg1, msg2, msg3], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('', [], [msg2, msg1, msg3], undefined, 2, flags);
      expect(events[0]?.dimension).toBe('message_prefix');
    });
  });

  describe('AC2.4 — Diff summary in event', () => {
    test('event includes previousSize, currentSize, delta for system_prompt', () => {
      const flags: SuppressionFlags = {};
      const prompt1 = 'prompt v1';
      const prompt2 = 'prompt v2 longer';

      diagnostics.checkForCacheBust(prompt1, [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust(prompt2, [], [], undefined, 2, flags);

      expect(events[0]?.previousSize).toBe(prompt1.length);
      expect(events[0]?.currentSize).toBe(prompt2.length);
      expect(events[0]?.delta).toBe(prompt2.length - prompt1.length);
    });

    test('event delta is currentSize - previousSize', () => {
      const flags: SuppressionFlags = {};
      const prompt1 = '12345';
      const prompt2 = '123456789';

      diagnostics.checkForCacheBust(prompt1, [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust(prompt2, [], [], undefined, 2, flags);

      expect(events[0]?.delta).toBe(4);
    });

    test('event delta is negative when content shrinks', () => {
      const flags: SuppressionFlags = {};
      const prompt1 = '123456789';
      const prompt2 = '12345';

      diagnostics.checkForCacheBust(prompt1, [], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust(prompt2, [], [], undefined, 2, flags);

      expect(events[0]?.delta).toBe(-4);
    });
  });

  describe('AC2.5 — Multiple dimensions produce separate events', () => {
    test('system prompt and tool changes produce two events', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust('prompt1', [{name: 'tool1'}], [], undefined, 1, flags);
      const events = diagnostics.checkForCacheBust('prompt2', [{name: 'tool2'}], [], undefined, 2, flags);

      expect(events.length).toBe(2);
      const dimensions = events.map(e => e.dimension).sort();
      expect(dimensions).toEqual(['system_prompt', 'tool_definitions']);
    });

    test('all four dimensions changing produce four events', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust('prompt1', [{name: 'tool1'}], [msg1, msg2], ['h1'], 1, flags);
      const msg1mod = {role: 'user', content: 'hello!'};
      const events = diagnostics.checkForCacheBust('prompt2', [{name: 'tool2'}], [msg1mod, msg2], ['h2'], 2, flags);

      expect(events.length).toBe(4);
      const dimensions = events.map(e => e.dimension).sort();
      expect(dimensions).toEqual(['beta_headers', 'message_prefix', 'system_prompt', 'tool_definitions']);
    });
  });
});

describe('cache-diagnostics edge cases', () => {
  let diagnostics = createCacheDiagnostics();

  beforeEach(() => {
    diagnostics = createCacheDiagnostics();
  });

  test('reset() clears state — next call behaves like first turn', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust('prompt1', [], [], undefined, 1, flags);
    diagnostics.reset();
    const events = diagnostics.checkForCacheBust('prompt2', [], [], undefined, 2, flags);
    expect(events.length).toBe(0);
  });

  test('empty system prompt transitions', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust('', [], [], undefined, 1, flags);
    const events = diagnostics.checkForCacheBust('non-empty', [], [], undefined, 2, flags);
    expect(events.length).toBe(1);
    expect(events[0]?.dimension).toBe('system_prompt');
  });

  test('empty to non-empty system prompt', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust('non-empty', [], [], undefined, 1, flags);
    const events = diagnostics.checkForCacheBust('', [], [], undefined, 2, flags);
    expect(events.length).toBe(1);
    expect(events[0]?.previousSize).toBe(9);
    expect(events[0]?.currentSize).toBe(0);
  });

  test('empty messages array (no prefix) produces no event', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust('', [], [], undefined, 1, flags);
    const events = diagnostics.checkForCacheBust('', [], [], undefined, 2, flags);
    expect(events.length).toBe(0);
  });

  test('turn number is recorded in event', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust('prompt1', [], [], undefined, 42, flags);
    const events = diagnostics.checkForCacheBust('prompt2', [], [], undefined, 99, flags);
    expect(events[0]?.turn).toBe(99);
  });

  test('message prefix size calculation includes all messages except last', () => {
    const flags: SuppressionFlags = {};
    const msg1 = {role: 'user', content: 'a'};
    const msg2 = {role: 'assistant', content: 'b'};
    const msg3 = {role: 'user', content: 'c'};

    diagnostics.checkForCacheBust('', [], [msg1, msg2, msg3], undefined, 1, flags);

    // Modify msg1 (in prefix)
    const msg1mod = {role: 'user', content: 'aa'};
    const events = diagnostics.checkForCacheBust('', [], [msg1mod, msg2, msg3], undefined, 2, flags);

    expect(events.length).toBe(1);
    // Previous prefix (excluding msg3): msg1, msg2 → total serialized size
    // Current prefix (excluding msg3): msg1mod, msg2 → total serialized size
    expect(events[0]?.previousSize).toBeGreaterThan(0);
    expect(events[0]?.currentSize).toBeGreaterThan(0);
  });
});
