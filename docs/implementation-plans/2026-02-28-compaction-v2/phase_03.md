# Compaction V2 Implementation Plan — Phase 3: Remove Persona Injection

**Goal:** Remove automatic persona injection from the compaction pipeline. The agent's voice in summaries now comes entirely from the user's custom system prompt in config.

**Architecture:** The `getPersona` callback in `CreateCompactorOptions` is removed. The `compress()` method no longer calls `getPersona()`. The `persona` parameter is removed from `summarizeChunk()` (already done in Phase 2). The composition root in `src/index.ts` is updated to omit the callback.

**Tech Stack:** TypeScript, Bun

**Scope:** 3 of 6 phases from original design (phase 3)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-v2.AC4: Persona Via Custom Prompt Only
- **compaction-v2.AC4.1 Success:** No code path in compaction module injects persona content
- **compaction-v2.AC4.2 Success:** `getPersona` callback is fully removed from `CreateCompactorOptions`

---

<!-- START_TASK_1 -->
### Task 1: Remove getPersona from CreateCompactorOptions and compress()

**Verifies:** compaction-v2.AC4.1, compaction-v2.AC4.2

**Files:**
- Modify: `src/compaction/compactor.ts:26-33` (CreateCompactorOptions type)
- Modify: `src/compaction/compactor.ts:437` (createCompactor destructuring)
- Modify: `src/compaction/compactor.ts:518-519` (compress method — remove getPersona call)

**Implementation:**

1. Remove `getPersona` from the `CreateCompactorOptions` type:

```typescript
export type CreateCompactorOptions = {
  readonly model: ModelProvider;
  readonly memory: MemoryManager;
  readonly persistence: PersistenceProvider;
  readonly config: CompactionConfig;
  readonly modelName: string;
};
```

2. Update the `createCompactor` destructuring (line 437):

```typescript
// Remove getPersona from destructuring:
const { model, memory, persistence, config, modelName } = options;
```

3. In the `compress()` method, remove the `getPersona` call (line 519):

```typescript
// Remove this line entirely:
// const persona = await getPersona();
```

Phase 2 already changed `summarizeChunk` to not accept `persona`. If Phase 2 hasn't been applied yet when implementing this, the `summarizeChunk` signature also needs `persona` removed — but per the dependency chain, Phase 2 runs first.

**Verification:**

Run: `bun run build`
Expected: Type-check passes. The compiler will flag any remaining references to `getPersona` or `persona` within the compaction module.

**Commit:** `refactor(compaction): remove getPersona from CreateCompactorOptions`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update composition root to omit getPersona

**Verifies:** compaction-v2.AC4.2

**Files:**
- Modify: `src/index.ts:378-389` (createCompactor call)

**Implementation:**

Remove the `getPersona` property from the `createCompactor()` call in the composition root:

```typescript
const compactor = createCompactor({
  model: summarizationModel,
  memory,
  persistence,
  config: compactionConfig,
  modelName: config.summarization?.name ?? config.model.name,
});
```

Remove lines 384-388 (the `getPersona` callback definition):
```typescript
// Remove this entire block:
//   getPersona: async () => {
//     const blocks = await memory.list('core');
//     const persona = blocks.find(b => b.label === 'core:persona');
//     return persona?.content ?? '';
//   },
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `refactor(index): remove getPersona from compactor wiring`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update compactor tests to not provide getPersona

**Verifies:** compaction-v2.AC4.1, compaction-v2.AC4.2

**Files:**
- Modify: `src/compaction/compactor.test.ts`

**Testing:**

Update all `createCompactor` calls in tests to remove the `getPersona` property. The test factory helpers that construct `CreateCompactorOptions` need updating.

Tests must verify:
- compaction-v2.AC4.1: Grep the test file for any remaining `persona` references — there should be none in the compactor options or summarization calls.
- compaction-v2.AC4.2: The `createCompactor` calls in tests compile without `getPersona`.

Specifically:
- Remove `getPersona: async () => '...'` from any mock option objects
- Remove `persona` from `ResummarizeBatchesOptions` construction in `createResummarizeTestContext` (already changed in Phase 2)
- Verify no test asserts on persona content in model requests

**Verification:**

Run: `bun test src/compaction/compactor.test.ts`
Expected: All tests pass

**Commit:** `test(compaction): remove persona from compactor test fixtures`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify no persona references remain in compaction module

**Verifies:** compaction-v2.AC4.1

**Files:** None (verification only)

**Verification:**

Run: `grep -rw "persona" src/compaction/`
Expected: No matches. The `-w` flag ensures word boundary matching to avoid false positives from words containing "persona" as a substring.

Run: `grep -rw "getPersona" src/`
Expected: No matches anywhere in the codebase.

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass

**Commit:** No commit needed — verification only
<!-- END_TASK_4 -->
