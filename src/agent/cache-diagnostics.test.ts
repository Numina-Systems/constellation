import {describe, test, expect, beforeEach} from 'bun:test';
import {createCacheDiagnostics, type SuppressionFlags} from './cache-diagnostics.ts';

describe('cache-bust-detection.AC1: Dimension Snapshotting', () => {
  let diagnostics = createCacheDiagnostics();

  beforeEach(() => {
    diagnostics = createCacheDiagnostics();
  });

  describe('AC1.1 — System prompt content hashing', () => {
    test('first call with system prompt returns empty array', () => {
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'system prompt',
        tools: [],
        messages: [],
        turn: 1,
        flags: {},
      });
      expect(events.length).toBe(0);
    });

    test('identical system prompt produces no event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });

    test('changed system prompt produces event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v2',
        tools: [],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('system_prompt');
    });
  });

  describe('AC1.2 — Tool definitions hashing', () => {
    test('first call with tools returns empty array', () => {
      const tools = [{name: 'tool1', description: 'desc'}];
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools,
        messages: [],
        turn: 1,
        flags: {},
      });
      expect(events.length).toBe(0);
    });

    test('identical tools produce no event', () => {
      const flags: SuppressionFlags = {};
      const tool = {name: 'tool1', description: 'desc'};
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [tool],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [tool],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });

    test('changed tools produce event', () => {
      const flags: SuppressionFlags = {};
      const tool1 = {name: 'tool1', description: 'desc1'};
      const tool2 = {name: 'tool1', description: 'desc2'};
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [tool1],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [tool2],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('tool_definitions');
    });

    test('tools in different order but same content produce no event', () => {
      const flags: SuppressionFlags = {};
      const tool1 = {name: 'a', description: 'desc'};
      const tool2 = {name: 'b', description: 'desc'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [tool1, tool2],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [tool2, tool1],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });
  });

  describe('AC1.3 — Message prefix hashing', () => {
    test('no messages in first call returns empty array', () => {
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        turn: 1,
        flags: {},
      });
      expect(events.length).toBe(0);
    });

    test('identical message prefix produces no event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });

    test('edited message in prefix produces event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2],
        turn: 1,
        flags,
      });

      const msg1Modified = {role: 'user', content: 'hello world'};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1Modified, msg2],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('appending a new message does NOT produce event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg3 = {role: 'user', content: 'how are you'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2],
        turn: 1,
        flags,
      });
      // Append msg3 (no edit to existing messages)
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2, msg3],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });

    test('deleting a message from prefix produces event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2],
        turn: 1,
        flags,
      });
      // Remove msg1, keep msg2
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg2],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('reordering messages in prefix produces event', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg3 = {role: 'user', content: 'how are you'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2, msg3],
        turn: 1,
        flags,
      });
      // Reorder: msg2, msg1, msg3 (msg3 becomes the new last message)
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg2, msg1, msg3],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('message_prefix');
    });
  });

  describe('AC1.4 — Beta headers hashing', () => {
    test('identical beta headers produce no event', () => {
      const flags: SuppressionFlags = {};
      const headers = ['header1', 'header2'];
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        betaHeaders: headers,
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        betaHeaders: headers,
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });

    test('changed beta headers produce event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        betaHeaders: ['header1'],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        betaHeaders: ['header2'],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('beta_headers');
    });

    test('undefined to undefined beta headers produce no event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });

    test('undefined to defined beta headers produce event', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        betaHeaders: ['header1'],
        turn: 2,
        flags,
      });
      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('beta_headers');
    });

    test('beta headers order does not matter (sorted before hashing)', () => {
      const flags: SuppressionFlags = {};
      const headers1 = ['z', 'a', 'b'];
      const headers2 = ['a', 'b', 'z'];
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        betaHeaders: headers1,
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [],
        betaHeaders: headers2,
        turn: 2,
        flags,
      });
      expect(events.length).toBe(0);
    });
  });

  describe('AC1.5 — First turn has no previous snapshot', () => {
    test('first turn returns empty array with any content', () => {
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'system prompt',
        tools: [{name: 'tool1'}],
        messages: [{role: 'user', content: 'msg'}],
        betaHeaders: ['header'],
        turn: 1,
        flags: {},
      });
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
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt1',
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt2',
        tools: [],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events[0]?.dimension).toBe('system_prompt');
    });
  });

  describe('AC2.2 — Tool definitions change dimension', () => {
    test('event has dimension "tool_definitions"', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [{name: 'tool1'}],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [{name: 'tool2'}],
        messages: [],
        turn: 2,
        flags,
      });
      expect(events[0]?.dimension).toBe('tool_definitions');
    });
  });

  describe('AC2.3 — Message prefix change dimension', () => {
    test('event has dimension "message_prefix" on edit', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg1mod = {role: 'user', content: 'hello world'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1mod, msg2],
        turn: 2,
        flags,
      });
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('event has dimension "message_prefix" on delete', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg2],
        turn: 2,
        flags,
      });
      expect(events[0]?.dimension).toBe('message_prefix');
    });

    test('event has dimension "message_prefix" on reorder', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const msg3 = {role: 'user', content: 'how'};

      diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg1, msg2, msg3],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: '',
        tools: [],
        messages: [msg2, msg1, msg3],
        turn: 2,
        flags,
      });
      expect(events[0]?.dimension).toBe('message_prefix');
    });
  });

  describe('AC2.4 — Diff summary in event', () => {
    test('event includes previousSize, currentSize, delta for system_prompt', () => {
      const flags: SuppressionFlags = {};
      const prompt1 = 'prompt v1';
      const prompt2 = 'prompt v2 longer';

      diagnostics.checkForCacheBust({
        systemPrompt: prompt1,
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: prompt2,
        tools: [],
        messages: [],
        turn: 2,
        flags,
      });

      expect(events[0]?.previousSize).toBe(prompt1.length);
      expect(events[0]?.currentSize).toBe(prompt2.length);
      expect(events[0]?.delta).toBe(prompt2.length - prompt1.length);
    });

    test('event delta is currentSize - previousSize', () => {
      const flags: SuppressionFlags = {};
      const prompt1 = '12345';
      const prompt2 = '123456789';

      diagnostics.checkForCacheBust({
        systemPrompt: prompt1,
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: prompt2,
        tools: [],
        messages: [],
        turn: 2,
        flags,
      });

      expect(events[0]?.delta).toBe(4);
    });

    test('event delta is negative when content shrinks', () => {
      const flags: SuppressionFlags = {};
      const prompt1 = '123456789';
      const prompt2 = '12345';

      diagnostics.checkForCacheBust({
        systemPrompt: prompt1,
        tools: [],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: prompt2,
        tools: [],
        messages: [],
        turn: 2,
        flags,
      });

      expect(events[0]?.delta).toBe(-4);
    });
  });

  describe('AC2.5 — Multiple dimensions produce separate events', () => {
    test('system prompt and tool changes produce two events', () => {
      const flags: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt1',
        tools: [{name: 'tool1'}],
        messages: [],
        turn: 1,
        flags,
      });
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt2',
        tools: [{name: 'tool2'}],
        messages: [],
        turn: 2,
        flags,
      });

      expect(events.length).toBe(2);
      const dimensions = events.map(e => e.dimension).sort();
      expect(dimensions).toEqual(['system_prompt', 'tool_definitions']);
    });

    test('all four dimensions changing produce four events', () => {
      const flags: SuppressionFlags = {};
      const msg1 = {role: 'user', content: 'hello'};
      const msg2 = {role: 'assistant', content: 'hi'};

      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt1',
        tools: [{name: 'tool1'}],
        messages: [msg1, msg2],
        betaHeaders: ['h1'],
        turn: 1,
        flags,
      });
      const msg1mod = {role: 'user', content: 'hello!'};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt2',
        tools: [{name: 'tool2'}],
        messages: [msg1mod, msg2],
        betaHeaders: ['h2'],
        turn: 2,
        flags,
      });

      expect(events.length).toBe(4);
      const dimensions = events.map(e => e.dimension).sort();
      expect(dimensions).toEqual(['beta_headers', 'message_prefix', 'system_prompt', 'tool_definitions']);
    });
  });
});

describe('cache-bust-detection.AC3: False Positive Suppression', () => {
  let diagnostics = createCacheDiagnostics();

  beforeEach(() => {
    diagnostics = createCacheDiagnostics();
  });

  describe('AC3.1 — Message prefix suppression on compaction', () => {
    test('compactionOccurred suppresses message_prefix event', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [],
        messages: [{role: 'user', content: 'hello'}, {role: 'assistant', content: 'hi'}],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {compactionOccurred: true};
      const msg1Modified = {role: 'user', content: 'hello modified'};
      const msg2 = {role: 'assistant', content: 'hi'};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [],
        messages: [msg1Modified, msg2],
        turn: 2,
        flags: flags2,
      });

      expect(events.length).toBe(0);
    });
  });

  describe('AC3.2 — System prompt suppression on compaction', () => {
    test('compactionOccurred suppresses system_prompt event', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [],
        messages: [],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {compactionOccurred: true};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v2',
        tools: [],
        messages: [],
        turn: 2,
        flags: flags2,
      });

      expect(events.length).toBe(0);
    });
  });

  describe('AC3.3 — isFirstTurn suppresses all dimensions', () => {
    test('isFirstTurn flag suppresses all dimensions on first call', () => {
      const flags: SuppressionFlags = {isFirstTurn: true};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool1'}],
        messages: [{role: 'user', content: 'msg'}],
        betaHeaders: ['header1'],
        turn: 1,
        flags,
      });

      expect(events.length).toBe(0);
    });

    test('isFirstTurn flag suppresses all dimensions even with real changes', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [{name: 'tool1'}],
        messages: [{role: 'user', content: 'msg1'}, {role: 'assistant', content: 'resp'}],
        betaHeaders: ['header1'],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {isFirstTurn: true};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v2',
        tools: [{name: 'tool2'}],
        messages: [{role: 'user', content: 'msg1 modified'}, {role: 'assistant', content: 'resp'}],
        betaHeaders: ['header2'],
        turn: 2,
        flags: flags2,
      });

      expect(events.length).toBe(0);
    });
  });

  describe('AC3.4 — Tool definitions suppression on toolsChanged', () => {
    test('toolsChanged suppresses tool_definitions event', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool1'}],
        messages: [],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {toolsChanged: true};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool2'}],
        messages: [],
        turn: 2,
        flags: flags2,
      });

      expect(events.length).toBe(0);
    });

    test('third call with same tools and no flags produces no event (hashes updated during suppression)', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool1'}],
        messages: [],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {toolsChanged: true};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool2'}],
        messages: [],
        turn: 2,
        flags: flags2,
      });

      const flags3: SuppressionFlags = {};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool2'}],
        messages: [],
        turn: 3,
        flags: flags3,
      });

      expect(events.length).toBe(0);
    });
  });

  describe('AC3.5 — No-op compaction produces no events', () => {
    test('identical content with compactionOccurred flag produces no events', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool1'}],
        messages: [{role: 'user', content: 'msg'}, {role: 'assistant', content: 'resp'}],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {compactionOccurred: true};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [{name: 'tool1'}],
        messages: [{role: 'user', content: 'msg'}, {role: 'assistant', content: 'resp'}],
        turn: 2,
        flags: flags2,
      });

      expect(events.length).toBe(0);
    });
  });

  describe('Additional suppression correctness tests', () => {
    test('hash update on suppression — subsequent identical call produces no event', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [],
        messages: [],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {compactionOccurred: true};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v2',
        tools: [],
        messages: [],
        turn: 2,
        flags: flags2,
      });

      const flags3: SuppressionFlags = {};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v2',
        tools: [],
        messages: [],
        turn: 3,
        flags: flags3,
      });

      expect(events.length).toBe(0);
    });

    test('hash update on suppression — subsequent different value produces event', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [],
        messages: [],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {compactionOccurred: true};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v2',
        tools: [],
        messages: [],
        turn: 2,
        flags: flags2,
      });

      const flags3: SuppressionFlags = {};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v3',
        tools: [],
        messages: [],
        turn: 3,
        flags: flags3,
      });

      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('system_prompt');
    });

    test('selective suppression — system_prompt suppressed but tool_definitions not', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v1',
        tools: [{name: 'tool1'}],
        messages: [],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {compactionOccurred: true};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt v2',
        tools: [{name: 'tool2'}],
        messages: [],
        turn: 2,
        flags: flags2,
      });

      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('tool_definitions');
    });

    test('beta_headers not suppressed by compaction', () => {
      const flags1: SuppressionFlags = {};
      diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [],
        messages: [],
        betaHeaders: ['h1'],
        turn: 1,
        flags: flags1,
      });

      const flags2: SuppressionFlags = {compactionOccurred: true};
      const events = diagnostics.checkForCacheBust({
        systemPrompt: 'prompt',
        tools: [],
        messages: [],
        betaHeaders: ['h2'],
        turn: 2,
        flags: flags2,
      });

      expect(events.length).toBe(1);
      expect(events[0]?.dimension).toBe('beta_headers');
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
    diagnostics.checkForCacheBust({
      systemPrompt: 'prompt1',
      tools: [],
      messages: [],
      turn: 1,
      flags,
    });
    diagnostics.reset();
    const events = diagnostics.checkForCacheBust({
      systemPrompt: 'prompt2',
      tools: [],
      messages: [],
      turn: 2,
      flags,
    });
    expect(events.length).toBe(0);
  });

  test('empty system prompt transitions', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust({
      systemPrompt: '',
      tools: [],
      messages: [],
      turn: 1,
      flags,
    });
    const events = diagnostics.checkForCacheBust({
      systemPrompt: 'non-empty',
      tools: [],
      messages: [],
      turn: 2,
      flags,
    });
    expect(events.length).toBe(1);
    expect(events[0]?.dimension).toBe('system_prompt');
  });

  test('empty to non-empty system prompt', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust({
      systemPrompt: 'non-empty',
      tools: [],
      messages: [],
      turn: 1,
      flags,
    });
    const events = diagnostics.checkForCacheBust({
      systemPrompt: '',
      tools: [],
      messages: [],
      turn: 2,
      flags,
    });
    expect(events.length).toBe(1);
    expect(events[0]?.previousSize).toBe(9);
    expect(events[0]?.currentSize).toBe(0);
  });

  test('empty messages array (no prefix) produces no event', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust({
      systemPrompt: '',
      tools: [],
      messages: [],
      turn: 1,
      flags,
    });
    const events = diagnostics.checkForCacheBust({
      systemPrompt: '',
      tools: [],
      messages: [],
      turn: 2,
      flags,
    });
    expect(events.length).toBe(0);
  });

  test('turn number is recorded in event', () => {
    const flags: SuppressionFlags = {};
    diagnostics.checkForCacheBust({
      systemPrompt: 'prompt1',
      tools: [],
      messages: [],
      turn: 42,
      flags,
    });
    const events = diagnostics.checkForCacheBust({
      systemPrompt: 'prompt2',
      tools: [],
      messages: [],
      turn: 99,
      flags,
    });
    expect(events[0]?.turn).toBe(99);
  });

  test('message prefix size calculation includes all messages except last', () => {
    const flags: SuppressionFlags = {};
    const msg1 = {role: 'user', content: 'a'};
    const msg2 = {role: 'assistant', content: 'b'};
    const msg3 = {role: 'user', content: 'c'};

    diagnostics.checkForCacheBust({
      systemPrompt: '',
      tools: [],
      messages: [msg1, msg2, msg3],
      turn: 1,
      flags,
    });

    // Modify msg1 (in prefix)
    const msg1mod = {role: 'user', content: 'aa'};
    const events = diagnostics.checkForCacheBust({
      systemPrompt: '',
      tools: [],
      messages: [msg1mod, msg2, msg3],
      turn: 2,
      flags,
    });

    expect(events.length).toBe(1);
    // Previous prefix (excluding msg3): msg1, msg2 → total serialized size
    // Current prefix (excluding msg3): msg1mod, msg2 → total serialized size
    expect(events[0]?.previousSize).toBeGreaterThan(0);
    expect(events[0]?.currentSize).toBeGreaterThan(0);
  });
});
