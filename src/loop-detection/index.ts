// pattern: Functional Core (barrel export)

export type {
  LoopDetectionAction,
  LoopDetectionConfig,
  LoopDetectionResult,
  LoopDetector,
} from './types.js';
export { DEFAULT_LOOP_DETECTION_CONFIG } from './types.js';
export { tokenBigrams } from './bigrams.js';
export { jaccardSimilarity } from './similarity.js';
