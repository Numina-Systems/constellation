// pattern: Functional Core (barrel export)

export type {
  Prediction,
  PredictionEvaluation,
  OperationTrace,
  TraceRecorder,
  PredictionStore,
  IntrospectionQuery,
} from './types.ts';

export { createPredictionStore } from './prediction-store.ts';
export type { TraceStore } from './trace-recorder.ts';
export { createTraceRecorder } from './trace-recorder.ts';
export { createPredictionTools } from './tools.ts';
export { createIntrospectionTools } from './introspection-tools.ts';
