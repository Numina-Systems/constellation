// pattern: Imperative Shell

import type { PersistenceProvider } from '@/persistence/types.js';
import type { ToolParameter } from '@/tool/types.js';
import type { CustomToolDefinition, CustomToolStore } from './types.js';

export function createPostgresCustomToolStore(persistence: PersistenceProvider): CustomToolStore {
  return {
    async create(def) {
      const rows = await persistence.query<CustomToolRow>(
        `INSERT INTO custom_tools (id, owner, name, description, parameters, code)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [def.id, def.owner, def.name, def.description, JSON.stringify(def.parameters), def.code],
      );
      return rowToDefinition(rows[0]!);
    },

    async update(owner, name, patch) {
      const setClauses: Array<string> = ['updated_at = NOW()'];
      const values: Array<unknown> = [];
      let paramIndex = 1;

      if (patch.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(patch.description);
      }
      if (patch.parameters !== undefined) {
        setClauses.push(`parameters = $${paramIndex++}`);
        values.push(JSON.stringify(patch.parameters));
      }
      if (patch.code !== undefined) {
        setClauses.push(`code = $${paramIndex++}`);
        values.push(patch.code);
      }

      values.push(owner, name);
      const rows = await persistence.query<CustomToolRow>(
        `UPDATE custom_tools SET ${setClauses.join(', ')}
         WHERE owner = $${paramIndex++} AND name = $${paramIndex}
         RETURNING *`,
        values,
      );
      return rows[0] ? rowToDefinition(rows[0]) : null;
    },

    async delete(owner, name) {
      const rows = await persistence.query(
        'DELETE FROM custom_tools WHERE owner = $1 AND name = $2 RETURNING id',
        [owner, name],
      );
      return rows.length > 0;
    },

    async list(owner) {
      const rows = await persistence.query<CustomToolRow>(
        'SELECT * FROM custom_tools WHERE owner = $1 ORDER BY name',
        [owner],
      );
      return rows.map(rowToDefinition);
    },

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
  parameters: ReadonlyArray<ToolParameter> | string;
  code: string;
  created_at: Date;
  updated_at: Date;
};

function rowToDefinition(row: CustomToolRow): CustomToolDefinition {
  const parameters = typeof row.parameters === 'string'
    ? JSON.parse(row.parameters) as ReadonlyArray<ToolParameter>
    : row.parameters;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    parameters,
    code: row.code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
