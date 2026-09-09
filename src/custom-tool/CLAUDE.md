# Custom tool

Last verified: 2026-09-09

## Purpose

Creates, validates, persists, publishes, and executes owner-scoped custom tools without allowing malformed metadata or ambiguous database outcomes to poison the registry.

## Contracts

- **Exposes**: `CustomToolDefinition`, `CustomToolStore`, `CustomToolManager`, validation helpers, and PostgreSQL store.
- **Guarantees**:
  - Names are unique per owner and cannot conflict with built-ins or runtime/credential bindings. Identifiers, reserved words, duplicate parameters, types, required flags, enum shapes, and supplied JSON Schemas are validated without string/boolean coercion.
  - A supplied full `inputSchema` is retained as dispatch authority; flat parameters are a compatibility projection. Nested objects/arrays, unions, integer values, and enums are validated without narrowing them to strings.
  - Create/update/delete mutations serialize per manager, reserve names before publication, and publish validated executable definitions only after confirmed/reconciled commit. Every mutation has an operation receipt.
  - Confirmed rollback preserves the prior callable definition. Commit-unknown or post-commit publication failure quarantines the affected name and blocks dispatch until trusted `loadAll()` recovery. The code does not treat a thrown commit acknowledgement as proof of rollback.
  - `loadAll()` leaves malformed persisted rows intact, reports bounded quarantine reasons/counts, skips invalid rows, and continues loading valid tools. It skips built-in name conflicts without rewriting storage.
  - Handlers inject `PARAMS`, resolve secrets through `SecretResolver`, and pass execution options to `CodeRuntime`; runtime unknown effects are not retried automatically.
- **Expects**: migrated `custom_tools` persistence, `ToolRegistry`, `CodeRuntime`, `SecretResolver`, and an owner.

## Dependencies

- **Uses**: persistence, registry/tool types, runtime, and secrets.
- **Used by**: composition root and custom-tool built-in commands.
- **Boundary**: SQL stays in `CustomToolStore`; registry publication follows durable transaction truth.

## Invariants

- Definitions are immutable values; changes use serialized update/delete operations.
- Quarantined names cannot be ordinary re-registered over.
- Runtime binding rules are shared with secret injection and generated stubs.

## Key files

- `types.ts` -- definitions, store, and mutation outcomes.
- `validation.ts` -- metadata, schema, identifier, and reserved-binding validation.
- `manager.ts` -- serialized CRUD, receipts, quarantine, and registry publication.
- `postgres-store.ts` -- owner-scoped durable mutations and reconciliation.
- `index.ts` -- public exports.
