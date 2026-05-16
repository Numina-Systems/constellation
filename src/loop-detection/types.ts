// pattern: Functional Core

export type LoopDetectionAction = 'warn' | 'redirect' | 'halt';

export type LoopDetectionConfig = {
  readonly enabled: boolean;
  readonly windowSize: number;
  readonly similarityThreshold: number;
  readonly consecutiveTrigger: number;
  readonly action: LoopDetectionAction;
};

export type LoopDetectionResult = {
  readonly triggered: boolean;
  readonly similarity: number;
  readonly consecutiveCount: number;
  readonly action: LoopDetectionAction | null;
};

export type LoopDetector = {
  check(response: string): LoopDetectionResult;
  reset(): void;
};

export const DEFAULT_LOOP_DETECTION_CONFIG: LoopDetectionConfig = {
  enabled: true,
  windowSize: 5,
  similarityThreshold: 0.85,
  consecutiveTrigger: 3,
  action: 'warn',
};
