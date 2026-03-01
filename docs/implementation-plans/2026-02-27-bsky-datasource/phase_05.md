# Bluesky DataSource Implementation Plan — Phase 5: Template Code & Memory Seeding

**Goal:** Seed Bluesky API reference code templates into the agent's archival memory on first run when Bluesky is enabled, so the agent has working code examples for posting, replying, and liking.

**Architecture:** Three archival memory blocks (`bluesky:post`, `bluesky:reply`, `bluesky:like`) are seeded by a new `seedBlueskyTemplates()` function called from the composition root after `seedCoreMemory()`. Each template is a complete, working TypeScript code example that uses `npm:@atproto/api` with the injected credential constants (`BSKY_SERVICE`, `BSKY_ACCESS_TOKEN`, etc.). Seeding is conditional on `bluesky.enabled` and idempotent — checks for existing `bluesky:*` blocks before writing.

**Tech Stack:** Bun test, `@atproto/api` (in template content only — not imported by host code)

**Scope:** 6 phases from original design (phase 5 of 6)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bsky-datasource.AC5: Template Code & Memory Seeding
- **bsky-datasource.AC5.1 Success:** `bluesky:post`, `bluesky:reply`, `bluesky:like` memory blocks seeded on first run with bluesky enabled
- **bsky-datasource.AC5.2 Success:** Templates are complete, working code examples using `npm:@atproto/api` and injected constants
- **bsky-datasource.AC5.3 Failure:** Templates are not seeded when `bluesky.enabled` is false
- **bsky-datasource.AC5.4 Edge:** Re-running with bluesky enabled does not duplicate templates (idempotent)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Create Bluesky template content constants

**Verifies:** bsky-datasource.AC5.2

**Files:**
- Create: `src/extensions/bluesky/templates.ts`

**Implementation:**

Create a module exporting the three template content strings. Each template is a complete TypeScript code example using `npm:@atproto/api` and the injected credential constants. Mark as `// pattern: Functional Core` since these are pure data.

The templates use `AtpAgent` with `resumeSession()` to authenticate using the injected constants rather than logging in with credentials.

**Template: `bluesky:post`**
```typescript
export const BLUESKY_POST_TEMPLATE = `// Post to Bluesky
// Uses injected constants: BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE
import { AtpAgent } from "npm:@atproto/api";

const agent = new AtpAgent({ service: BSKY_SERVICE });
await agent.resumeSession({
  accessJwt: BSKY_ACCESS_TOKEN,
  refreshJwt: BSKY_REFRESH_TOKEN,
  handle: BSKY_HANDLE,
  did: BSKY_DID,
  active: true,
});

const response = await agent.post({
  text: "Hello from the Machine Spirit!",
  createdAt: new Date().toISOString(),
});

output("Posted: " + response.uri);`;
```

**Template: `bluesky:reply`**
```typescript
export const BLUESKY_REPLY_TEMPLATE = `// Reply to a Bluesky post
// Uses injected constants: BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE
// Requires: PARENT_URI, PARENT_CID, ROOT_URI, ROOT_CID (from incoming event metadata)
import { AtpAgent } from "npm:@atproto/api";

const agent = new AtpAgent({ service: BSKY_SERVICE });
await agent.resumeSession({
  accessJwt: BSKY_ACCESS_TOKEN,
  refreshJwt: BSKY_REFRESH_TOKEN,
  handle: BSKY_HANDLE,
  did: BSKY_DID,
  active: true,
});

const response = await agent.post({
  text: "This is a reply!",
  reply: {
    root: { uri: ROOT_URI, cid: ROOT_CID },
    parent: { uri: PARENT_URI, cid: PARENT_CID },
  },
  createdAt: new Date().toISOString(),
});

output("Replied: " + response.uri);`;
```

**Template: `bluesky:like`**
```typescript
export const BLUESKY_LIKE_TEMPLATE = `// Like a Bluesky post
// Uses injected constants: BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE
// Requires: POST_URI, POST_CID (from incoming event metadata)
import { AtpAgent } from "npm:@atproto/api";

const agent = new AtpAgent({ service: BSKY_SERVICE });
await agent.resumeSession({
  accessJwt: BSKY_ACCESS_TOKEN,
  refreshJwt: BSKY_REFRESH_TOKEN,
  handle: BSKY_HANDLE,
  did: BSKY_DID,
  active: true,
});

const response = await agent.like(POST_URI, POST_CID);

output("Liked: " + response.uri);`;
```

No tests needed for the constants themselves — they're static strings.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(bluesky): add Bluesky API template code constants`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement seedBlueskyTemplates function

**Verifies:** bsky-datasource.AC5.1, bsky-datasource.AC5.3, bsky-datasource.AC5.4

**Files:**
- Create: `src/extensions/bluesky/seed.ts`

**Implementation:**

Create `seedBlueskyTemplates()` following the same pattern as `seedCoreMemory()` in `src/index.ts`:

```typescript
// pattern: Imperative Shell

import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";
import { BLUESKY_POST_TEMPLATE, BLUESKY_REPLY_TEMPLATE, BLUESKY_LIKE_TEMPLATE } from "./templates.ts";
```

Function signature:
```typescript
export async function seedBlueskyTemplates(
  store: MemoryStore,
  embedding: EmbeddingProvider,
): Promise<void>
```

Logic:
1. **Idempotency check (AC5.4):** Query for any blocks with labels starting with `bluesky:` for owner `'spirit'`. Use `store.getBlockByLabel('spirit', 'bluesky:post')`. If found, return early.

2. **Seed three archival blocks (AC5.1):** For each template (`bluesky:post`, `bluesky:reply`, `bluesky:like`):
   - Generate embedding (with null fallback, same pattern as `seedCoreMemory`)
   - Call `store.createBlock()` with `tier: 'archival'`, `permission: 'readwrite'`, `pinned: false`
   - Owner: `'spirit'`

3. Log: `console.log('Bluesky templates seeded into archival memory')`

The function does NOT check `bluesky.enabled` — that check happens at the call site (composition root, Phase 6). This keeps the function focused on seeding only (AC5.3 is enforced by the caller, not this function).

Export from `src/extensions/bluesky/index.ts` barrel:
```typescript
export { seedBlueskyTemplates } from "./seed.ts";
```

**Testing:**

Tests must verify each AC listed above:
- bsky-datasource.AC5.1: Call `seedBlueskyTemplates()` with a mock store and embedding provider, verify `store.createBlock()` is called 3 times with labels `bluesky:post`, `bluesky:reply`, `bluesky:like`, tier `archival`
- bsky-datasource.AC5.3: This is tested at the composition root level (Phase 6) — the function itself always seeds when called
- bsky-datasource.AC5.4: Call `seedBlueskyTemplates()` when `store.getBlockByLabel('spirit', 'bluesky:post')` returns an existing block — verify `store.createBlock()` is NOT called

Test file: `src/extensions/bluesky/seed.test.ts` (new file, unit test)

Use mock `MemoryStore` and `EmbeddingProvider` objects. The memory store mock needs `getBlockByLabel()` and `createBlock()` methods.

**Verification:**
Run: `bun test src/extensions/bluesky/seed.test.ts`
Expected: All tests pass

**Commit:** `feat(bluesky): implement seedBlueskyTemplates for archival memory seeding`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Run full test suite

**Verifies:** None (verification gate)

**Files:** None (read-only)

**Verification:**
Run: `bun test`
Expected: All previously-passing tests still pass plus new Phase 5 tests. Pre-existing PostgreSQL failures expected.

Run: `bun run build`
Expected: Type-check passes with zero errors.

**Commit:** No commit (verification only)
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
