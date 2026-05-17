# Secrets

Last verified: 2026-05-17

## Purpose
Provides secret storage with owner isolation, enabling the agent to persist API keys and credentials that are injected into Deno sandbox code execution as TypeScript constants.

## Contracts
- **Exposes**: `SecretStore` port interface (`get`, `set`, `delete`, `listKeys`, `getAll`), `createPostgresSecretStore(persistence)`, `SecretResolver` interface (`resolve(keys)`, `listKeys()`), `createSecretResolver(options)`
- **Guarantees**: All operations are owner-scoped. `SecretResolver.resolve()` merges config-file secrets with database-stored secrets (config takes precedence). `listKeys()` returns a deduplicated sorted union of config and stored keys. Secret values are never returned in tool output (tool layer enforces this).
- **Expects**: `PersistenceProvider` with migration 011 applied. Owner string for isolation. Optional `configSecrets` record for config-file-sourced secrets.

## Dependencies
- **Uses**: `src/persistence/` (PostgreSQL queries), `src/errors/secrets.ts` (SecretsError)
- **Used by**: `src/tool/builtin/secrets.ts` (secret_set, secret_list, secret_delete tools), `src/custom-tool/manager.ts` (resolves secrets for custom tool execution), `src/runtime/executor.ts` (injects secrets into sandbox via ExecutionContext), `src/index.ts` (composition root wiring)
- **Boundary**: This module stores and retrieves secrets. It does not decide how they are injected into execution -- that is the runtime's responsibility.

## Key Decisions
- Port/adapter pattern: `SecretStore` port with PostgreSQL adapter for testability
- Two-tier resolution: Config-file secrets override database-stored secrets, allowing environment-based defaults with agent-managed overrides
- Batch optimization: `resolve()` uses `getAll()` when requesting all known keys

## Invariants
- Owner isolation: all queries are scoped by owner string
- Secret values are never logged, never included in error context, never returned in tool output
- Key names must be valid TypeScript identifiers (enforced at tool layer, validated again at runtime injection)

## Key Files
- `types.ts` -- `SecretStore` port interface
- `postgres-store.ts` -- PostgreSQL adapter
- `resolver.ts` -- Two-tier secret resolution (config + database)
