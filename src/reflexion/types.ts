// pattern: Functional Core

/**
 * Reflexion system types for prediction journaling, operation tracing, and introspection.
 * These types define the domain model for agent self-observation and improvement.
 */

export type Prediction = {
  readonly id: string;
  readonly owner: string;
  readonly conversationId: string;
  readonly predictionText: string;
  readonly domain: string | null;
  readonly confidence: number | null;
  readonly contextSnapshot: Record<string, unknown>;
  readonly status: 'pending' | 'evaluated' | 'expired';
  readonly createdAt: Date;
  readonly evaluatedAt: Date | null;
};

export type PredictionEvaluation = {
  readonly id: string;
  readonly predictionId: string;
  readonly owner: string;
  readonly outcome: string;
  readonly accurate: boolean;
  readonly evidence: Record<string, unknown>;
  readonly createdAt: Date;
};

export type OperationTrace = {
  readonly id: string;
  readonly owner: string;
  readonly conversationId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly outputSummary: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error: string | null;
  readonly createdAt: Date;
};

export type TraceRecorder = {
  record(trace: Omit<OperationTrace, 'id' | 'createdAt'>): Promise<void>;
};

export type PredictionStore = {
  createPrediction(prediction: Omit<Prediction, 'id' | 'createdAt' | 'evaluatedAt'>): Promise<Prediction>;
  listPredictions(owner: string, status?: Prediction['status'], limit?: number): Promise<ReadonlyArray<Prediction>>;
  createEvaluation(evaluation: Omit<PredictionEvaluation, 'id' | 'createdAt'>): Promise<PredictionEvaluation>;
  markEvaluated(predictionId: string): Promise<void>;
  expireStalePredictions(owner: string, olderThan: Date): Promise<number>;
  getLastReviewTimestamp(owner: string): Promise<Date | null>;
};

export type IntrospectionQuery = {
  readonly owner: string;
  readonly lookbackSince?: Date;
  readonly toolName?: string;
  readonly successOnly?: boolean;
  readonly limit?: number;
};
