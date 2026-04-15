# SpaceMolt Auto-Registration Implementation Plan - Phase 2

**Goal:** Create credential storage and retrieval in core memory via pure functions.

**Architecture:** New `src/extensions/spacemolt/credentials.ts` module (Functional Core) with `readCredentials` and `writeCredentials` functions that use `MemoryStore` directly (matching the existing `seed.ts` pattern). Credentials stored as a pinned core memory block with `readwrite` permission.

**Note: MemoryStore vs MemoryManager:** The design document references `MemoryManager` as the dependency, but the implementation uses `MemoryStore` directly. This is intentional — it matches the existing `seed.ts` pattern. `MemoryStore` is the port interface with `getBlockByLabel`/`createBlock`/`updateBlock` methods needed for credential operations. `MemoryManager` is the orchestration layer with permission enforcement and mutation flows that are not needed here (credentials are system-managed, not agent-managed).

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 2 of 5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-auto-register.AC2: Credential memory block read/write
- **spacemolt-auto-register.AC2.1 Success:** `readCredentials` returns null when no `spacemolt:credentials` block exists
- **spacemolt-auto-register.AC2.2 Success:** `writeCredentials` creates a pinned core memory block with username, password, player_id, empire
- **spacemolt-auto-register.AC2.3 Success:** `readCredentials` returns parsed credentials from existing block
- **spacemolt-auto-register.AC2.4 Edge:** `readCredentials` returns null when block content is corrupted (invalid JSON)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create Credentials type and readCredentials/writeCredentials functions

**Verifies:** spacemolt-auto-register.AC2.1, spacemolt-auto-register.AC2.2, spacemolt-auto-register.AC2.3, spacemolt-auto-register.AC2.4

**Files:**
- Create: `src/extensions/spacemolt/credentials.ts`

**Implementation:**

Create a new Functional Core module with the `Credentials` type and two functions:

```typescript
// pattern: Functional Core

import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";

export type Credentials = {
  readonly username: string;
  readonly password: string;
  readonly player_id: string;
  readonly empire: string;
};

const CREDENTIALS_LABEL = "spacemolt:credentials";
const CREDENTIALS_OWNER = "spirit";

export async function readCredentials(store: MemoryStore): Promise<Credentials | null> {
  const block = await store.getBlockByLabel(CREDENTIALS_OWNER, CREDENTIALS_LABEL);
  if (!block) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(block.content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "username" in parsed &&
      "password" in parsed &&
      "player_id" in parsed &&
      "empire" in parsed &&
      typeof (parsed as Record<string, unknown>)["username"] === "string" &&
      typeof (parsed as Record<string, unknown>)["password"] === "string" &&
      typeof (parsed as Record<string, unknown>)["player_id"] === "string" &&
      typeof (parsed as Record<string, unknown>)["empire"] === "string"
    ) {
      return {
        username: (parsed as Record<string, unknown>)["username"] as string,
        password: (parsed as Record<string, unknown>)["password"] as string,
        player_id: (parsed as Record<string, unknown>)["player_id"] as string,
        empire: (parsed as Record<string, unknown>)["empire"] as string,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeCredentials(
  store: MemoryStore,
  embedding: EmbeddingProvider,
  credentials: Credentials,
): Promise<void> {
  const content = JSON.stringify(credentials);

  const generateEmbedding = async (text: string): Promise<Array<number> | null> => {
    try {
      const result = await embedding.embed(text);
      if (!Array.isArray(result)) {
        return null;
      }
      return result;
    } catch {
      return null;
    }
  };

  const existing = await store.getBlockByLabel(CREDENTIALS_OWNER, CREDENTIALS_LABEL);
  if (existing) {
    const emb = await generateEmbedding(content);
    await store.updateBlock(existing.id, content, emb);
    return;
  }

  const emb = await generateEmbedding(content);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: CREDENTIALS_OWNER,
    tier: "core",
    label: CREDENTIALS_LABEL,
    content,
    embedding: emb,
    permission: "readwrite",
    pinned: true,
  });
}
```

Key design decisions:
- Uses `MemoryStore` directly (matching `seed.ts` pattern) — not `MemoryManager`
- `readCredentials` validates JSON structure with type guards (returns null on invalid/corrupted content)
- `writeCredentials` is idempotent: updates existing block if found, creates new if not
- `core` tier (always in system prompt) with `readwrite` permission (agent can update if needed)
- `pinned: true` ensures compaction never evicts credentials
- Embedding generated with fallback to null (matching `seed.ts` error handling)

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(spacemolt): add credential memory block read/write functions`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Export credential functions from barrel

**Verifies:** None (infrastructure wiring)

**Files:**
- Modify: `src/extensions/spacemolt/index.ts`

**Implementation:**

Add to the existing exports in `src/extensions/spacemolt/index.ts`:

```typescript
export { readCredentials, writeCredentials } from "./credentials.ts";
export type { Credentials } from "./credentials.ts";
```

Place near line 14 where `seedSpaceMoltCapabilities` is exported, since credentials are a related concept.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(spacemolt): export credential functions from barrel`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Credential read/write tests

**Verifies:** spacemolt-auto-register.AC2.1, spacemolt-auto-register.AC2.2, spacemolt-auto-register.AC2.3, spacemolt-auto-register.AC2.4

**Files:**
- Create: `src/extensions/spacemolt/credentials.test.ts`

**Testing:**

Follow the exact mock pattern from `src/extensions/spacemolt/seed.test.ts` — use `createMockMemoryStore()` and `createMockEmbeddingProvider()` helper functions with the same structure.

Tests must verify each AC listed above:

- **spacemolt-auto-register.AC2.1:** `readCredentials` returns null when `getBlockByLabel` returns null (no block exists)
- **spacemolt-auto-register.AC2.2:** `writeCredentials` calls `createBlock` with the correct properties: `tier: "core"`, `pinned: true`, `permission: "readwrite"`, `owner: "spirit"`, `label: "spacemolt:credentials"`, and content is valid JSON containing all four credential fields
- **spacemolt-auto-register.AC2.3:** `readCredentials` returns parsed `Credentials` object when block exists with valid JSON content
- **spacemolt-auto-register.AC2.4:** `readCredentials` returns null when block content is invalid JSON (e.g., `"not-json{{"`)
- Additional: `readCredentials` returns null when block content is valid JSON but missing required fields (e.g., `'{"username": "x"}'`)
- Additional: `writeCredentials` calls `updateBlock` (not `createBlock`) when block already exists (idempotent update)

Test structure:
```typescript
describe("readCredentials", () => {
  describe("spacemolt-auto-register.AC2.1: Returns null when no block exists", () => { ... });
  describe("spacemolt-auto-register.AC2.3: Returns parsed credentials from existing block", () => { ... });
  describe("spacemolt-auto-register.AC2.4: Returns null on corrupted JSON", () => { ... });
  it("returns null when JSON is valid but missing required fields", () => { ... });
});

describe("writeCredentials", () => {
  describe("spacemolt-auto-register.AC2.2: Creates pinned core block", () => { ... });
  it("updates existing block instead of creating duplicate", () => { ... });
});
```

Mock pattern (reuse from seed.test.ts):
- `createMockMemoryStore()` returns all MemoryStore methods as no-op stubs
- Override specific methods per test (e.g., `store.getBlockByLabel = async () => existingBlock`)
- Capture calls via arrays (e.g., `const createdBlocks: Array<Record<string, unknown>> = []`)

**Verification:**

Run: `bun test src/extensions/spacemolt/credentials.test.ts`
Expected: All credential tests pass

**Commit:** `test(spacemolt): add credential memory block tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
