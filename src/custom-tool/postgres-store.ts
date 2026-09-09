// pattern: Imperative Shell

import type {PersistenceProvider, QueryFunction} from '@/persistence/types.js';
import type {ToolParameter} from '@/tool/types.js';
import type {CustomToolDefinition, CustomToolLoadIssue, CustomToolLoadResult, CustomToolReceipt, CustomToolStore, CustomToolOperationType, TransactionMutationResult} from './types.js';

export function createPostgresCustomToolStore(persistence: PersistenceProvider): CustomToolStore {
  async function mutate(operationId: string, operationType: CustomToolOperationType, action: (query: QueryFunction) => Promise<CustomToolDefinition | boolean | null>): Promise<TransactionMutationResult> {
    const runner = persistence.withTransactionOutcome;
    if (!runner) throw new Error('custom tool persistence does not support transaction outcomes');
    const outcome = await runner(async (scope) => {
      const value = await action(scope.query);
      await scope.query(
        `INSERT INTO operation_receipts (operation_id, operation_type, status, details)
         VALUES ($1, $2, 'committed', $3::jsonb)`,
        [operationId, `custom_tool_${operationType}`, JSON.stringify({operation_id: operationId})],
      );
      return value;
    }, async (outcome, query) => {
      if (outcome.status !== 'commit_unknown') return {truth: 'committed'};
      const receipts = await query<ReceiptRow>('SELECT operation_id, operation_type, status FROM operation_receipts WHERE operation_id = $1', [operationId]);
      const receipt = receipts[0];
      if (!receipt) return {truth: 'unknown', error: outcome.error};
      if (receipt.status === 'committed') return {truth: 'committed'};
      if (receipt.status === 'rolled_back') return {truth: 'rolled_back'};
      return {truth: 'unknown', error: outcome.error};
    });
    return outcome;
  }

  async function getReceipt(operationId: string): Promise<CustomToolReceipt | null> {
    const rows = await persistence.query<ReceiptRow>('SELECT operation_id, operation_type, status FROM operation_receipts WHERE operation_id = $1', [operationId]);
    const row = rows[0];
    return row ? {operation_id: row.operation_id, operation_type: row.operation_type, status: row.status} : null;
  }

  async function listWithIssues(owner: string): Promise<CustomToolLoadResult> {
    const rows = await persistence.query<CustomToolRow>(
      'SELECT * FROM custom_tools WHERE owner = $1 ORDER BY name',
      [owner],
    );
    const definitions: Array<CustomToolDefinition> = [];
    const issues: Array<CustomToolLoadIssue> = [];
    for (const row of rows) {
      try {
        definitions.push(rowToDefinition(row));
      } catch (error) {
        issues.push({name: row.name, reason: safeDecodeError(error)});
      }
    }
    return {definitions, issues};
  }

  return {
    mutate,
    getReceipt,
    async create(def, query = persistence.query) {
      const rows = await query<CustomToolRow>(
        `INSERT INTO custom_tools (id, owner, name, description, parameters, code)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [def.id, def.owner, def.name, def.description, encodeMetadata(def), def.code],
      );
      return rowToDefinition(rows[0]!);
    },

    async update(owner, name, patch, query = persistence.query) {
      const setClauses: Array<string> = ['updated_at = NOW()'];
      const values: Array<unknown> = [];
      let paramIndex = 1;

      // Dynamically build SET clauses with parameter indices ($1, $2, ...)
      // based on which fields are present in the patch.
      if (patch.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(patch.description);
      }
      if (patch.parameters !== undefined || patch.inputSchema !== undefined) {
        setClauses.push(`parameters = $${paramIndex++}`);
        values.push(JSON.stringify({parameters: patch.parameters ?? [], ...(patch.inputSchema === undefined ? {} : {inputSchema: patch.inputSchema})}));
      }
      if (patch.code !== undefined) {
        setClauses.push(`code = $${paramIndex++}`);
        values.push(patch.code);
      }

      // Append owner and name to values array after all patch fields.
      // Their indices are paramIndex and paramIndex+1 respectively.
      values.push(owner, name);
      const rows = await query<CustomToolRow>(
        `UPDATE custom_tools SET ${setClauses.join(', ')}
         WHERE owner = $${paramIndex++} AND name = $${paramIndex}
         RETURNING *`,
        values,
      );
      return rows[0] ? rowToDefinition(rows[0]) : null;
    },

    async delete(owner, name, query = persistence.query) {
      const rows = await query(
        'DELETE FROM custom_tools WHERE owner = $1 AND name = $2 RETURNING id',
        [owner, name],
      );
      return rows.length > 0;
    },

    async list(owner) {
      const result = await listWithIssues(owner);
      return result.definitions;
    },

    listWithIssues,

    async getByName(owner, name) {
      const rows = await persistence.query<CustomToolRow>(
        'SELECT * FROM custom_tools WHERE owner = $1 AND name = $2',
        [owner, name],
      );
      return rows[0] ? rowToDefinition(rows[0]) : null;
    },
  };
}

type CustomToolRow = {
  id: string;
  owner: string;
  name: string;
  description: string;
  parameters: unknown;
  code: string;
  created_at: Date;
  updated_at: Date;
};

type StoredMetadata = Readonly<{parameters: ReadonlyArray<ToolParameter>; inputSchema?: Readonly<Record<string, unknown>>}>;

type ReceiptRow = {operation_id: string; operation_type: string; status: 'committed' | 'rolled_back' | 'unknown'};

function encodeMetadata(definition: Readonly<Pick<CustomToolDefinition, 'parameters' | 'inputSchema'>>): string {
  return JSON.stringify({parameters: definition.parameters, ...(definition.inputSchema === undefined ? {} : {inputSchema: definition.inputSchema})});
}

function decodeMetadata(raw: unknown): StoredMetadata {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
  if (Array.isArray(parsed)) return {parameters: parsed as Array<ToolParameter>};
  if (typeof parsed === 'object' && parsed !== null && 'parameters' in parsed && Array.isArray(parsed.parameters)) {
    const metadata = parsed as {parameters: Array<ToolParameter>; inputSchema?: Readonly<Record<string, unknown>>};
    return {parameters: metadata.parameters, ...(metadata.inputSchema === undefined ? {} : {inputSchema: metadata.inputSchema})};
  }
  throw new Error('invalid persisted custom tool metadata');
}

function safeDecodeError(error: unknown): string {
  const detail = error instanceof Error ? error.message : 'decode failed';
  return `invalid persisted custom tool metadata: ${detail}`.slice(0, 500);
}

function rowToDefinition(row: CustomToolRow): CustomToolDefinition {
  const metadata = decodeMetadata(row.parameters);
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    parameters: metadata.parameters,
    ...(metadata.inputSchema === undefined ? {} : {inputSchema: metadata.inputSchema}),
    code: row.code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
