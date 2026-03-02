import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createPredictionStore } from './prediction-store.ts';

const TEST_OWNER = 'test-user-' + Math.random().toString(36).substring(7);
const TEST_OWNER_2 = 'test-user-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let store: ReturnType<typeof createPredictionStore>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE prediction_evaluations CASCADE');
  await persistence.query('TRUNCATE TABLE predictions CASCADE');
}

describe('PredictionStore', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    store = createPredictionStore(persistence);
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('AC1.1: Create prediction with all fields', () => {
    it('creates a prediction with text, domain, and confidence', async () => {
      const prediction = await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        predictionText: 'The model will learn from this interaction',
        domain: 'learning',
        confidence: 0.85,
        contextSnapshot: { step: 1 },
        status: 'pending',
      });

      expect(prediction.id).toBeTruthy();
      expect(prediction.owner).toBe(TEST_OWNER);
      expect(prediction.conversationId).toBe('conv-1');
      expect(prediction.predictionText).toBe('The model will learn from this interaction');
      expect(prediction.domain).toBe('learning');
      expect(prediction.confidence).toBe(0.85);
      expect(prediction.contextSnapshot).toEqual({ step: 1 });
      expect(prediction.status).toBe('pending');
      expect(prediction.createdAt).toBeInstanceOf(Date);
      expect(prediction.evaluatedAt).toBeNull();
    });
  });

  describe('AC1.2: Owner isolation', () => {
    it('owner A cannot see owner B predictions', async () => {
      const predA = await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        predictionText: 'Prediction from A',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      const predB = await store.createPrediction({
        owner: TEST_OWNER_2,
        conversationId: 'conv-2',
        predictionText: 'Prediction from B',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      const listA = await store.listPredictions(TEST_OWNER);
      const listB = await store.listPredictions(TEST_OWNER_2);

      expect(listA).toHaveLength(1);
      expect(listA[0]?.id).toBe(predA.id);
      expect(listB).toHaveLength(1);
      expect(listB[0]?.id).toBe(predB.id);
    });
  });

  describe('AC1.4: List with status filter and limit', () => {
    it('filters by status and respects limit', async () => {
      // Create predictions with different statuses
      await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        predictionText: 'Pending 1',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-2',
        predictionText: 'Pending 2',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-3',
        predictionText: 'Evaluated 1',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'evaluated',
      });

      // List all pending
      const allPending = await store.listPredictions(TEST_OWNER, 'pending');
      expect(allPending).toHaveLength(2);

      // List with limit
      const limited = await store.listPredictions(TEST_OWNER, 'pending', 1);
      expect(limited).toHaveLength(1);

      // List evaluated
      const evaluated = await store.listPredictions(TEST_OWNER, 'evaluated');
      expect(evaluated).toHaveLength(1);
    });
  });

  describe('AC1.5: Null optional fields', () => {
    it('creates prediction with null domain and confidence', async () => {
      const prediction = await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        predictionText: 'Simple prediction',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      expect(prediction.domain).toBeNull();
      expect(prediction.confidence).toBeNull();
    });
  });

  describe('AC3.2: Mark evaluation', () => {
    it('markEvaluated updates status and evaluatedAt', async () => {
      const pred = await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        predictionText: 'Test prediction',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      expect(pred.status).toBe('pending');
      expect(pred.evaluatedAt).toBeNull();

      // Create an evaluation first
      await store.createEvaluation({
        predictionId: pred.id,
        owner: TEST_OWNER,
        outcome: 'correct',
        accurate: true,
        evidence: { reason: 'test' },
      });

      // Mark as evaluated
      await store.markEvaluated(pred.id);

      // Fetch updated prediction
      const updated = await store.listPredictions(TEST_OWNER);
      expect(updated).toHaveLength(1);
      expect(updated[0]?.status).toBe('evaluated');
      expect(updated[0]?.evaluatedAt).not.toBeNull();
    });
  });

  describe('AC3.4: Expire stale predictions', () => {
    it('expireStalePredictions marks old pending predictions as expired', async () => {
      // Create predictions with backdated created_at
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Create two predictions
      const pred1 = await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        predictionText: 'Recent',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      const pred2 = await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-2',
        predictionText: 'Old',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      // Manually insert with backdated times using persistence to test expiration
      await persistence.query(
        `UPDATE predictions SET created_at = $1 WHERE id = $2`,
        [twoDaysAgo.toISOString(), pred2.id],
      );

      // Expire predictions older than 1 day
      const expiredCount = await store.expireStalePredictions(TEST_OWNER, oneDayAgo);

      expect(expiredCount).toBe(1);

      // Verify the old one is expired
      const remaining = await store.listPredictions(TEST_OWNER, 'pending');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(pred1.id);

      const expired = await store.listPredictions(TEST_OWNER, 'expired');
      expect(expired).toHaveLength(1);
      expect(expired[0]?.id).toBe(pred2.id);
    });
  });

  describe('getLastReviewTimestamp', () => {
    it('returns the timestamp of the last evaluation', async () => {
      const pred = await store.createPrediction({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        predictionText: 'Test',
        domain: null,
        confidence: null,
        contextSnapshot: {},
        status: 'pending',
      });

      // No evaluations yet
      let lastReview = await store.getLastReviewTimestamp(TEST_OWNER);
      expect(lastReview).toBeNull();

      // Create an evaluation
      const eval1 = await store.createEvaluation({
        predictionId: pred.id,
        owner: TEST_OWNER,
        outcome: 'correct',
        accurate: true,
        evidence: {},
      });

      lastReview = await store.getLastReviewTimestamp(TEST_OWNER);
      expect(lastReview).not.toBeNull();
      expect(lastReview?.getTime()).toBeCloseTo(eval1.createdAt.getTime(), -2);
    });
  });
});
