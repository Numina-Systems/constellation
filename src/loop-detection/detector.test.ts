// pattern: Imperative Shell

import { describe, test, expect } from 'bun:test';
import type { TraceRecorder, OperationTrace } from '@/reflexion/types.js';
import { createLoopDetector } from './detector.js';
import { DEFAULT_LOOP_DETECTION_CONFIG } from './types.js';

function createMockTraceRecorder() {
  const traces: Array<Omit<OperationTrace, 'id' | 'createdAt'>> = [];
  return {
    recorder: {
      record: async (trace: Omit<OperationTrace, 'id' | 'createdAt'>) => {
        traces.push(trace);
      },
    } satisfies TraceRecorder,
    traces,
  };
}

describe('loop-detection.AC4.1: warn action', () => {
  test('triggers breaker and returns warn action', () => {
    const config = {
      ...DEFAULT_LOOP_DETECTION_CONFIG,
      action: 'warn' as const,
    };
    const detector = createLoopDetector({ config });

    // Push same response 4 times to trigger
    const response = 'Try a different approach';
    detector.check(response);
    detector.check(response);
    detector.check(response);
    const result = detector.check(response);

    expect(result.triggered).toBe(true);
    expect(result.action).toBe('warn');
  });
});

describe('loop-detection.AC4.2: redirect action', () => {
  test('triggers breaker and returns redirect action', () => {
    const config = {
      ...DEFAULT_LOOP_DETECTION_CONFIG,
      action: 'redirect' as const,
    };
    const detector = createLoopDetector({ config });

    const response = 'Try a different approach';
    detector.check(response);
    detector.check(response);
    detector.check(response);
    const result = detector.check(response);

    expect(result.triggered).toBe(true);
    expect(result.action).toBe('redirect');
  });
});

describe('loop-detection.AC4.3: halt action', () => {
  test('triggers breaker and returns halt action', () => {
    const config = {
      ...DEFAULT_LOOP_DETECTION_CONFIG,
      action: 'halt' as const,
    };
    const detector = createLoopDetector({ config });

    const response = 'Try a different approach';
    detector.check(response);
    detector.check(response);
    detector.check(response);
    const result = detector.check(response);

    expect(result.triggered).toBe(true);
    expect(result.action).toBe('halt');
  });
});

describe('loop-detection.AC4.4: action is configurable', () => {
  test('returns different actions based on config', () => {
    const response = 'Try a different approach';

    // Test warn
    const warnDetector = createLoopDetector({
      config: { ...DEFAULT_LOOP_DETECTION_CONFIG, action: 'warn' },
    });
    warnDetector.check(response);
    warnDetector.check(response);
    warnDetector.check(response);
    expect(warnDetector.check(response).action).toBe('warn');

    // Test redirect
    const redirectDetector = createLoopDetector({
      config: { ...DEFAULT_LOOP_DETECTION_CONFIG, action: 'redirect' },
    });
    redirectDetector.check(response);
    redirectDetector.check(response);
    redirectDetector.check(response);
    expect(redirectDetector.check(response).action).toBe('redirect');

    // Test halt
    const haltDetector = createLoopDetector({
      config: { ...DEFAULT_LOOP_DETECTION_CONFIG, action: 'halt' },
    });
    haltDetector.check(response);
    haltDetector.check(response);
    haltDetector.check(response);
    expect(haltDetector.check(response).action).toBe('halt');
  });
});

describe('loop-detection.AC5.1: trace records similarity and consecutive count', () => {
  test('records trace with similarity score and consecutive count on activation', async () => {
    const { recorder, traces } = createMockTraceRecorder();
    const config = DEFAULT_LOOP_DETECTION_CONFIG;
    const detector = createLoopDetector({
      config,
      traceRecorder: recorder,
      owner: 'test-agent',
      conversationId: 'conv-123',
    });

    const response = 'Try a different approach';
    detector.check(response);
    detector.check(response);
    detector.check(response);
    detector.check(response);

    // Allow promise to resolve
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces.length).toBe(1);
    const trace = traces[0]!;
    expect((trace.input['similarity'] as number)).toBeGreaterThanOrEqual(0.85);
    expect((trace.input['consecutiveCount'] as number)).toBe(3);
  });
});

describe('loop-detection.AC5.2: trace recorded via TraceRecorder interface', () => {
  test('calls record() method on TraceRecorder', async () => {
    const { recorder, traces } = createMockTraceRecorder();
    const config = DEFAULT_LOOP_DETECTION_CONFIG;
    const detector = createLoopDetector({
      config,
      traceRecorder: recorder,
      owner: 'test-agent',
      conversationId: 'conv-123',
    });

    const response = 'Try a different approach';
    detector.check(response);
    detector.check(response);
    detector.check(response);
    detector.check(response);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces.length).toBe(1);
    const trace = traces[0]!;
    expect(trace.owner).toBe('test-agent');
    expect(trace.conversationId).toBe('conv-123');
    expect(trace.toolName).toBe('loop_detection');
  });
});

describe('loop-detection.AC5.3: non-activation does not record trace', async () => {
  test('does not record trace when responses do not trigger breaker', async () => {
    const { recorder, traces } = createMockTraceRecorder();
    const config = DEFAULT_LOOP_DETECTION_CONFIG;
    const detector = createLoopDetector({
      config,
      traceRecorder: recorder,
    });

    // Push different responses
    detector.check('response 1');
    detector.check('response 2');
    detector.check('response 3');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces.length).toBe(0);
  });
});

describe('loop-detection.AC6.1: enabled defaults to true', () => {
  test('circuit breaker is active by default', () => {
    const detector = createLoopDetector({
      config: DEFAULT_LOOP_DETECTION_CONFIG,
    });

    const response = 'Try a different approach';
    detector.check(response);
    detector.check(response);
    detector.check(response);
    const result = detector.check(response);

    expect(result.triggered).toBe(true);
  });
});

describe('loop-detection.AC6.2: windowSize defaults to 5', () => {
  test('DEFAULT_LOOP_DETECTION_CONFIG.windowSize is 5', () => {
    expect(DEFAULT_LOOP_DETECTION_CONFIG.windowSize).toBe(5);
  });
});

describe('loop-detection.AC6.3: similarityThreshold defaults to 0.85', () => {
  test('DEFAULT_LOOP_DETECTION_CONFIG.similarityThreshold is 0.85', () => {
    expect(DEFAULT_LOOP_DETECTION_CONFIG.similarityThreshold).toBe(0.85);
  });
});

describe('loop-detection.AC6.4: consecutiveTrigger defaults to 3', () => {
  test('DEFAULT_LOOP_DETECTION_CONFIG.consecutiveTrigger is 3', () => {
    expect(DEFAULT_LOOP_DETECTION_CONFIG.consecutiveTrigger).toBe(3);
  });
});

describe('loop-detection.AC6.5: action defaults to warn', () => {
  test('DEFAULT_LOOP_DETECTION_CONFIG.action is warn', () => {
    expect(DEFAULT_LOOP_DETECTION_CONFIG.action).toBe('warn');
  });
});

describe('loop-detection.AC6.6: enabled false disables detection', () => {
  test('detector never triggers when enabled is false', () => {
    const config = {
      ...DEFAULT_LOOP_DETECTION_CONFIG,
      enabled: false,
    };
    const detector = createLoopDetector({ config });

    // Push identical responses many times
    const response = 'Try a different approach';
    for (let i = 0; i < 10; i++) {
      const result = detector.check(response);
      expect(result.triggered).toBe(false);
      expect(result.action).toBeNull();
    }
  });
});
