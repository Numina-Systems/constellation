// pattern: Imperative Shell

/**
 * PostgreSQL implementation of the PredictionStore port.
 * Manages prediction journal creation, listing, evaluation, and expiration.
 */

import { randomUUID } from 'node:crypto';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { Prediction, PredictionEvaluation, PredictionStore } from './types.ts';

type PredictionRow = {
  id: string;
  owner: string;
  conversation_id: string;
  prediction_text: string;
  domain: string | null;
  confidence: number | null;
  context_snapshot: Record<string, unknown>;
  status: string;
  created_at: string;
  evaluated_at: string | null;
};

type EvaluationRow = {
  id: string;
  prediction_id: string;
  owner: string;
  outcome: string;
  accurate: boolean;
  evidence: Record<string, unknown>;
  created_at: string;
};

function parsePrediction(row: PredictionRow): Prediction {
  return {
    id: row.id,
    owner: row.owner,
    conversationId: row.conversation_id,
    predictionText: row.prediction_text,
    domain: row.domain,
    confidence: row.confidence,
    contextSnapshot: row.context_snapshot,
    status: row.status as Prediction['status'],
    createdAt: new Date(row.created_at),
    evaluatedAt: row.evaluated_at ? new Date(row.evaluated_at) : null,
  };
}

function parseEvaluation(row: EvaluationRow): PredictionEvaluation {
  return {
    id: row.id,
    predictionId: row.prediction_id,
    owner: row.owner,
    outcome: row.outcome,
    accurate: row.accurate,
    evidence: row.evidence,
    createdAt: new Date(row.created_at),
  };
}

export function createPredictionStore(
  persistence: PersistenceProvider,
): PredictionStore {
  async function createPrediction(
    prediction: Omit<Prediction, 'id' | 'createdAt' | 'evaluatedAt'>,
  ): Promise<Prediction> {
    const id = randomUUID();
    const rows = await persistence.query<PredictionRow>(
      `INSERT INTO predictions
       (id, owner, conversation_id, prediction_text, domain, confidence, context_snapshot, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        prediction.owner,
        prediction.conversationId,
        prediction.predictionText,
        prediction.domain,
        prediction.confidence,
        prediction.contextSnapshot,
        prediction.status,
      ],
    );

    // INSERT RETURNING always produces a row or throws
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parsePrediction(rows[0]!);
  }

  async function listPredictions(
    owner: string,
    status?: Prediction['status'],
    limit?: number,
  ): Promise<ReadonlyArray<Prediction>> {
    let query = 'SELECT * FROM predictions WHERE owner = $1';
    const params: Array<string | number> = [owner];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const effectiveLimit = limit ?? 50;
    query += ` LIMIT $${params.length + 1}`;
    params.push(effectiveLimit);

    const rows = await persistence.query<PredictionRow>(query, params);
    return rows.map(parsePrediction);
  }

  async function createEvaluation(
    evaluation: Omit<PredictionEvaluation, 'id' | 'createdAt'>,
  ): Promise<PredictionEvaluation> {
    const id = randomUUID();
    const rows = await persistence.query<EvaluationRow>(
      `INSERT INTO prediction_evaluations
       (id, prediction_id, owner, outcome, accurate, evidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        evaluation.predictionId,
        evaluation.owner,
        evaluation.outcome,
        evaluation.accurate,
        evaluation.evidence,
      ],
    );

    // INSERT RETURNING always produces a row or throws
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseEvaluation(rows[0]!);
  }

  async function markEvaluated(predictionId: string): Promise<void> {
    await persistence.query(
      `UPDATE predictions
       SET status = $1, evaluated_at = NOW()
       WHERE id = $2`,
      ['evaluated', predictionId],
    );
  }

  async function expireStalePredictions(owner: string, olderThan: Date): Promise<number> {
    const rows = await persistence.query<{ id: string }>(
      `UPDATE predictions
       SET status = $1
       WHERE owner = $2 AND status = $3 AND created_at < $4
       RETURNING id`,
      ['expired', owner, 'pending', olderThan.toISOString()],
    );
    return rows.length;
  }

  async function getLastReviewTimestamp(owner: string): Promise<Date | null> {
    const rows = await persistence.query<{ max: string | null }>(
      `SELECT MAX(created_at) as max FROM prediction_evaluations WHERE owner = $1`,
      [owner],
    );

    if (rows.length === 0 || rows[0]?.max === null) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return new Date(rows[0]!.max);
  }

  return {
    createPrediction,
    listPredictions,
    createEvaluation,
    markEvaluated,
    expireStalePredictions,
    getLastReviewTimestamp,
  };
}
