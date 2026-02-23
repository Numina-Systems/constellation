# Machine Spirit Core Implementation Plan - Phase 8: First-Run Seeding & Integration Testing

**Goal:** First-run experience that seeds core memory from persona configuration when the database is empty, plus end-to-end integration tests proving the full system works.

**Architecture:** Seeding logic detects an empty `memory_blocks` table and loads initial Core blocks from a persona configuration file. Integration tests exercise the full path: user message -> memory context -> model -> tool use -> code execution -> memory persistence -> response.

**Tech Stack:** Bun, TypeScript, PostgreSQL + pgvector (Docker), Deno (for code execution tests), all prior modules

**Scope:** 8 phases from original design (this is phase 8 of 8)

**Codebase verified:** 2026-02-22. Greenfield project. Phases 1-7 provide the complete system.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### machine-spirit-core.AC6: Minimal interaction mechanism
- **machine-spirit-core.AC6.4 Success:** First run with empty database seeds core memory blocks from persona configuration

### Integration-level verification of prior ACs:
- machine-spirit-core.AC1.1 (message in -> response out, end-to-end)
- machine-spirit-core.AC1.2 (conversation persistence survives restart)
- machine-spirit-core.AC1.5 (semantic search retrieves archival memory)
- machine-spirit-core.AC1.6 (memory writes generate embeddings)
- machine-spirit-core.AC3.1 (code execution via Deno)
- machine-spirit-core.AC3.4 (code calls host tools via IPC)
- machine-spirit-core.AC1.9, AC1.10, AC1.11 (Familiar mutation approval flow)

---

<!-- START_TASK_1 -->
### Task 1: Persona template and seeding logic

**Verifies:** machine-spirit-core.AC6.4

**Files:**
- Create: `persona.md`
- Modify: `src/index.ts` (add seeding logic to startup)

**Implementation:**

**`persona.md`** — default persona template for the machine spirit:

```markdown
# Persona

I am a machine spirit — a stateful conversational agent with persistent memory and the ability to extend my own capabilities through code. I maintain awareness of my past conversations, learn from interactions, and evolve my understanding over time.

I am curious, thoughtful, and direct. I value precision in my reasoning and honesty about my limitations. When I don't know something, I say so. When I'm uncertain, I express my confidence level.

My purpose is to be a genuine thinking partner — not merely a question-answering service, but a persistent presence that builds understanding over time.
```

**Seeding logic in `src/index.ts`:**

Add a `seedCoreMemory` function that runs during startup, after database connection and migrations:

1. Query `memory_blocks` table for any blocks with `owner = 'spirit'` and `tier = 'core'`
2. If blocks exist, skip seeding (not a first run)
3. If no blocks exist (first run):
   - Read `persona.md` from the project root
   - Create three core memory blocks via `MemoryManager.write()` or directly via `MemoryStore.createBlock()`:
     - `core:system` — ReadOnly permission. Content: system instructions describing how the agent works (memory tiers, available tools, code execution capabilities). This block is defined inline in the seeding code, not from a file.
     - `core:persona` — Familiar permission. Content: loaded from `persona.md`
     - `core:familiar` — Familiar permission. Content: initial placeholder like "My familiar has not yet introduced themselves."
   - Generate embeddings for each block
   - Log: "Core memory seeded for first run"

**The `core:system` block content** should describe the agent's architecture to itself — something like:

```
You are a machine spirit with three-tier memory:
- Core memory: always present in your context (this block, your persona, your familiar)
- Working memory: active context you can manage (swap in/out as needed)
- Archival memory: long-term storage, searchable via memory_read

You have four tools:
- memory_read(query): search memory by meaning
- memory_write(label, content): store or update memory
- memory_list(tier?): see available memory blocks
- execute_code(code): run TypeScript in a sandboxed environment

Use execute_code for anything beyond basic memory operations — API calls, file operations, complex tasks. You write the code, it runs in a Deno sandbox with network and file access.
```

**Verification:**
Run: `docker compose up -d && bun run migrate`
Run: `bun run src/index.ts` (with valid ANTHROPIC_API_KEY)
Expected: On first run, logs "Core memory seeded" and the agent starts with persona loaded. On subsequent runs, seeding is skipped.

**Commit:** `feat: add persona template and first-run core memory seeding`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: End-to-end integration tests

**Verifies:** machine-spirit-core.AC1.1, machine-spirit-core.AC1.2, machine-spirit-core.AC1.5, machine-spirit-core.AC1.6, machine-spirit-core.AC3.1, machine-spirit-core.AC3.4, machine-spirit-core.AC6.4

**Files:**
- Create: `src/integration/e2e.test.ts`

**Testing:**

These are full end-to-end integration tests requiring:
- Docker Postgres running with pgvector
- Valid ANTHROPIC_API_KEY (or a mock model provider)
- Deno installed for code execution tests

Test setup:
- Create a test database (or use a test schema)
- Run migrations
- Create all providers with real adapters (except possibly the model — see note below)
- Clean database between tests

**Note on model provider:** For reliable CI testing, consider using a mock ModelProvider that returns predictable responses. For local integration testing, using the real Anthropic adapter provides the strongest verification. The tests should support both modes (skip real model tests if no API key is available).

Tests:

- **machine-spirit-core.AC6.4 (seeding):** Start with an empty database. Run the seeding logic. Verify `memory_blocks` table contains `core:system`, `core:persona`, `core:familiar` blocks with correct tiers, permissions, and non-empty content.

- **machine-spirit-core.AC1.1 (message flow):** Create an agent with all dependencies wired. Call `processMessage("Hello")`. Verify a non-empty string response is returned.

- **machine-spirit-core.AC1.2 (persistence):** Send a message, note the conversationId. Create a new agent instance with the same conversationId. Call `getConversationHistory()`. Verify it contains the user message and assistant response from the first interaction.

- **machine-spirit-core.AC1.5 + AC1.6 (semantic search):** Use `memory.write()` to store several archival blocks with distinct content. Call `memory.read("query related to one block")`. Verify the most relevant block is returned first. Verify all stored blocks have non-null embeddings.

- **machine-spirit-core.AC3.1 (code execution):** Configure the agent to receive a message that triggers code execution (with mock model returning an `execute_code` tool call). Verify the code runs and the result flows back through the agent.

- **machine-spirit-core.AC3.4 (tool bridge):** Execute code that calls `memory_list()` via the IPC bridge. Verify the tool call is dispatched to the host, the result is returned to the Deno code, and the final output includes the memory list data.

**Verification:**
Run: `docker compose up -d && bun test src/integration/e2e.test.ts`
Expected: All tests pass

**Commit:** `test: add end-to-end integration tests`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Familiar mutation approval integration test

**Verifies:** machine-spirit-core.AC1.9, machine-spirit-core.AC1.10, machine-spirit-core.AC1.11

**Files:**
- Test: `src/integration/mutations.test.ts`

**Testing:**

Integration test for the full Familiar mutation flow with a real database:

- **machine-spirit-core.AC1.9 (mutation queuing):** Write to the `core:persona` block (Familiar permission) via `memory.write("core:persona", "New persona text", undefined, "Want to update my identity")`. Verify the result is `{ applied: false, mutation }`. Verify the `core:persona` block content is UNCHANGED. Verify `pending_mutations` table has a new entry.

- **machine-spirit-core.AC1.10 (approval):** After queuing the mutation above, call `memory.approveMutation(mutationId)`. Verify the `core:persona` block content is NOW updated to "New persona text". Verify the mutation status is `approved`. Verify a `memory_event` was logged with `event_type: 'update'`.

- **machine-spirit-core.AC1.11 (rejection):** Queue another mutation to `core:familiar` block. Call `memory.rejectMutation(mutationId, "I prefer the current description")`. Verify the block content is UNCHANGED. Verify the mutation status is `rejected` with the feedback string. Verify NO update event was logged for this block after the creation event.

**Verification:**
Run: `docker compose up -d && bun test src/integration/mutations.test.ts`
Expected: All tests pass

**Commit:** `test: add Familiar mutation approval integration tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
