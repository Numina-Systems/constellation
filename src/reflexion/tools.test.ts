import { describe, it, expect } from 'bun:test';
import type { PredictionStore, Prediction } from './types.ts';
import { createPredictionTools } from './tools.ts';

describe('Prediction tools', () => {
  function createMockPredictionStore(): PredictionStore {
    return {
      createPrediction: async () => {
        throw new Error('not implemented');
      },
      listPredictions: async () => [],
      createEvaluation: async () => {
        throw new Error('not implemented');
      },
      markEvaluated: async () => {
        // no-op for testing
      },
      expireStalePredictions: async () => 0,
      getLastReviewTimestamp: async () => null,
    };
  }

  describe('predict tool', () => {
    it('should create a prediction with text parameter', async () => {
      let capturedPrediction: Prediction['predictionText'] | null = null;
      let capturedOwner: string | null = null;
      let capturedConversationId: string | null = null;

      const mockStore = createMockPredictionStore();
      mockStore.createPrediction = async (pred) => {
        capturedPrediction = pred.predictionText;
        capturedOwner = pred.owner;
        capturedConversationId = pred.conversationId;

        return {
          id: 'pred-1',
          owner: pred.owner,
          conversationId: pred.conversationId,
          predictionText: pred.predictionText,
          domain: pred.domain,
          confidence: pred.confidence,
          contextSnapshot: pred.contextSnapshot,
          status: pred.status,
          createdAt: new Date(),
          evaluatedAt: null,
        };
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const predict = tools.find((t) => t.definition.name === 'predict');
      expect(predict).toBeDefined();

      if (!predict) return;

      const result = await predict.handler({
        text: 'This prediction will succeed',
      });

      expect(result.success).toBe(true);
      expect(capturedPrediction === 'This prediction will succeed').toBe(true);
      expect(capturedOwner === 'agent-1').toBe(true);
      expect(capturedConversationId === 'conv-1').toBe(true);
      expect(result.output).toContain('pred-1');
    });

    it('should include context snapshot in createPrediction call', async () => {
      let capturedContextSnapshot: Record<string, unknown> | null = null;

      const mockStore = createMockPredictionStore();
      mockStore.createPrediction = async (pred) => {
        capturedContextSnapshot = pred.contextSnapshot;
        return {
          id: 'pred-1',
          owner: pred.owner,
          conversationId: pred.conversationId,
          predictionText: pred.predictionText,
          domain: pred.domain,
          confidence: pred.confidence,
          contextSnapshot: pred.contextSnapshot,
          status: pred.status,
          createdAt: new Date(),
          evaluatedAt: null,
        };
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const predict = tools.find((t) => t.definition.name === 'predict');
      expect(predict).toBeDefined();

      if (!predict) return;

      await predict.handler({
        text: 'test',
      });

      expect(JSON.stringify(capturedContextSnapshot)).toBe(JSON.stringify({}));
    });

    it('should pass domain and confidence parameters', async () => {
      let capturedDomain: string | null | undefined;
      let capturedConfidence: number | null | undefined;

      const mockStore = createMockPredictionStore();
      mockStore.createPrediction = async (pred) => {
        capturedDomain = pred.domain;
        capturedConfidence = pred.confidence;
        return {
          id: 'pred-1',
          owner: pred.owner,
          conversationId: pred.conversationId,
          predictionText: pred.predictionText,
          domain: pred.domain,
          confidence: pred.confidence,
          contextSnapshot: pred.contextSnapshot,
          status: pred.status,
          createdAt: new Date(),
          evaluatedAt: null,
        };
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const predict = tools.find((t) => t.definition.name === 'predict');
      expect(predict).toBeDefined();

      if (!predict) return;

      await predict.handler({
        text: 'test',
        domain: 'strategy',
        confidence: 0.75,
      });

      expect(capturedDomain === 'strategy').toBe(true);
      expect(capturedConfidence === 0.75).toBe(true);
    });

    it('should return error on store failure', async () => {
      const mockStore = createMockPredictionStore();
      mockStore.createPrediction = async () => {
        throw new Error('database error');
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const predict = tools.find((t) => t.definition.name === 'predict');
      expect(predict).toBeDefined();

      if (!predict) return;

      const result = await predict.handler({
        text: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('database error');
    });
  });

  describe('annotate_prediction tool', () => {
    it('should call createEvaluation and markEvaluated', async () => {
      let createEvaluationCalled = false;
      let markEvaluatedCalled = false;
      let capturedPredictionId: string | null = null;

      const mockStore = createMockPredictionStore();
      mockStore.createEvaluation = async (evaluation) => {
        createEvaluationCalled = true;
        capturedPredictionId = evaluation.predictionId;
        return {
          id: 'eval-1',
          predictionId: evaluation.predictionId,
          owner: evaluation.owner,
          outcome: evaluation.outcome,
          accurate: evaluation.accurate,
          evidence: evaluation.evidence,
          createdAt: new Date(),
        };
      };

      mockStore.markEvaluated = async (predId) => {
        markEvaluatedCalled = true;
        if (predId !== null) {
          expect(predId === capturedPredictionId).toBe(true);
        }
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const annotate = tools.find((t) => t.definition.name === 'annotate_prediction');
      expect(annotate).toBeDefined();

      if (!annotate) return;

      const result = await annotate.handler({
        prediction_id: 'pred-1',
        outcome: 'Prediction was correct',
        accurate: true,
      });

      expect(result.success).toBe(true);
      expect(createEvaluationCalled).toBe(true);
      expect(markEvaluatedCalled).toBe(true);
      expect(result.output).toContain('eval-1');
    });

    it('should include evidence in evaluation when provided', async () => {
      let capturedEvidence: Record<string, unknown> | null = null;

      const mockStore = createMockPredictionStore();
      mockStore.createEvaluation = async (evaluation) => {
        capturedEvidence = evaluation.evidence;
        return {
          id: 'eval-1',
          predictionId: evaluation.predictionId,
          owner: evaluation.owner,
          outcome: evaluation.outcome,
          accurate: evaluation.accurate,
          evidence: evaluation.evidence,
          createdAt: new Date(),
        };
      };

      mockStore.markEvaluated = async () => {
        // no-op
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const annotate = tools.find((t) => t.definition.name === 'annotate_prediction');
      expect(annotate).toBeDefined();

      if (!annotate) return;

      await annotate.handler({
        prediction_id: 'pred-1',
        outcome: 'Failed',
        accurate: false,
        evidence: 'The market moved unexpectedly',
      });

      expect(JSON.stringify(capturedEvidence)).toBe(JSON.stringify({ text: 'The market moved unexpectedly' }));
    });

    it('should return error when createEvaluation fails', async () => {
      const mockStore = createMockPredictionStore();
      mockStore.createEvaluation = async () => {
        throw new Error('nonexistent prediction');
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const annotate = tools.find((t) => t.definition.name === 'annotate_prediction');
      expect(annotate).toBeDefined();

      if (!annotate) return;

      const result = await annotate.handler({
        prediction_id: 'invalid-id',
        outcome: 'test',
        accurate: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent prediction');
    });
  });

  describe('list_predictions tool', () => {
    it('should list predictions for owner', async () => {
      let capturedOwner: string | null = null;

      const mockStore = createMockPredictionStore();
      mockStore.listPredictions = async (owner) => {
        capturedOwner = owner;
        const pred: Prediction = {
          id: 'pred-1',
          owner,
          conversationId: 'conv-1',
          predictionText: 'test prediction',
          domain: null,
          confidence: null,
          contextSnapshot: {},
          status: 'pending',
          createdAt: new Date(),
          evaluatedAt: null,
        };
        return [pred];
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const list = tools.find((t) => t.definition.name === 'list_predictions');
      expect(list).toBeDefined();

      if (!list) return;

      const result = await list.handler({});

      expect(result.success).toBe(true);
      expect(capturedOwner === 'agent-1').toBe(true);
      expect(result.output).toContain('pred-1');
    });

    it('should support status filter', async () => {
      let capturedStatus: string | undefined = undefined;

      const mockStore = createMockPredictionStore();
      mockStore.listPredictions = async (_owner, status) => {
        capturedStatus = status;
        return [];
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const list = tools.find((t) => t.definition.name === 'list_predictions');
      expect(list).toBeDefined();

      if (!list) return;

      await list.handler({
        status: 'pending',
      });

      expect(capturedStatus === 'pending').toBe(true);
    });

    it('should support limit parameter', async () => {
      let capturedLimit: number | undefined = undefined;

      const mockStore = createMockPredictionStore();
      mockStore.listPredictions = async (_owner, _status, limit) => {
        capturedLimit = limit;
        return [];
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const list = tools.find((t) => t.definition.name === 'list_predictions');
      expect(list).toBeDefined();

      if (!list) return;

      await list.handler({
        limit: 25,
      });

      expect(capturedLimit === 25).toBe(true);
    });

    it('should return error on store failure', async () => {
      const mockStore = createMockPredictionStore();
      mockStore.listPredictions = async () => {
        throw new Error('query failed');
      };

      const tools = createPredictionTools({
        store: mockStore,
        owner: 'agent-1',
        conversationId: 'conv-1',
      });

      const list = tools.find((t) => t.definition.name === 'list_predictions');
      expect(list).toBeDefined();

      if (!list) return;

      const result = await list.handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('query failed');
    });
  });
});
