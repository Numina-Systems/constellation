# Test Requirements: Subconscious

Maps every acceptance criterion from the subconscious design to either automated tests or human verification. Test file paths and describe/it blocks reference the implementation plan phases.

---

## Automated Tests

| AC | Description | Test Type | Expected Test File | Phase | Describe/It Blocks |
|----|-------------|-----------|-------------------|-------|--------------------|
| subconscious.AC1.1 | Impulse events fire at configured cron interval during wake hours | unit | `src/subconscious/scheduling.test.ts` | 4 | `describe('subconscious.AC1.1: Impulse scheduling')` / `it('converts impulse_interval_minutes to valid cron expression')`, `it('impulse assembler returns valid ExternalEvent')` |
| subconscious.AC1.2 | Each impulse dispatches a reflect-generate-act prompt to the subconscious agent | unit | `src/subconscious/impulse.test.ts` | 4 | `describe('subconscious.AC1.2: Impulse prompt structure')` / `it('builds a prompt with Reflect, Generate, and Act sections')`, `it('returns ExternalEvent with source subconscious:impulse')` |
| subconscious.AC1.3 | Impulse prompt includes current interests, recent traces, and recent memories | unit | `src/subconscious/impulse.test.ts` | 4 | `describe('subconscious.AC1.3: Impulse prompt content')` / `it('includes active interests with scores')`, `it('includes recent traces via formatTraceSummary')`, `it('includes recent memories')`, `it('includes recent explorations')`, `it('shows cold-start prompt when no interests exist')`, `it('handles all-empty context gracefully')` |
| subconscious.AC1.4 | Impulses are suppressed during sleep hours (activity-gated) | unit | `src/subconscious/scheduling.test.ts` | 4 | `describe('subconscious.AC1.4: Impulse suppression during sleep')` / `it('impulse task name is in suppressDuringSleep list')`, `it('createActivityDispatch suppresses named tasks during sleep')` |
| subconscious.AC2.1 | Subconscious agent maintains dedicated conversation with stable ID across restarts | integration | `src/subconscious/agent.test.ts` | 3 | Create two agents with same deps but different conversation IDs, verify each agent's `conversationId` matches, verify messages persisted under separate conversation IDs |
| subconscious.AC2.2 | Inner conversation compacts independently from main conversation | integration | `src/subconscious/agent.test.ts` | 3 | Create two agents, add messages to both, compact one, verify other's history is unchanged |
| subconscious.AC2.3 | On first startup with no prior inner conversation, agent starts fresh with empty history | integration | `src/subconscious/agent.test.ts` | 3 | Create agent with fresh UUID, verify `getConversationHistory()` returns empty array, process event, verify conversation now has messages |
| subconscious.AC3.1 | Interests can be created with name, description, source, and engagement score | integration | `src/subconscious/persistence.test.ts` | 1 | `describe('subconscious.AC3.1: Create interest with all fields')` / create interest, verify all fields, verify default score 1.0, verify getInterest retrieves, verify listInterests filters by owner, test all three source values |
| subconscious.AC3.2 | Curiosity threads can be created, explored, resolved, or parked within an interest | integration | `src/subconscious/persistence.test.ts` | 1 | `describe('subconscious.AC3.2: Curiosity thread state transitions')` / create thread, verify fields, transition open-exploring-resolved with resolution, transition open-parked, verify listCuriosityThreads filters, verify getCuriosityThread |
| subconscious.AC3.3 | Engagement scores decay over time with configurable half-life | integration | `src/subconscious/persistence.test.ts` | 1 | `describe('subconscious.AC3.3: Engagement score decay')` / create interests with known scores, backdate `last_engaged_at`, apply decay, verify proportional decrease |
| subconscious.AC3.4 | Active interest count is capped; lowest-scoring interest becomes dormant when cap is reached | integration | `src/subconscious/persistence.test.ts` (Phase 1), `src/subconscious/emergent.test.ts` (Phase 7) | 1, 7 | Phase 1: `describe('subconscious.AC3.4: Active interest cap enforcement')` / create 5 interests with varying scores, enforce cap of 3, verify 2 lowest dormant, verify idempotent. Phase 7: `describe('subconscious.AC3.4: Post-impulse housekeeping wiring')` / verify decay-then-cap ordering on decayed scores, verify safe with zero interests |
| subconscious.AC3.5 | Duplicate curiosity threads detected and existing thread resumed | integration | `src/subconscious/persistence.test.ts` (Phase 1), `src/subconscious/emergent.test.ts` (Phase 7) | 1, 7 | Phase 1: `describe('subconscious.AC3.5: Duplicate curiosity thread detection')` / findDuplicateCuriosityThread returns existing, case-insensitive match, resolved thread not returned, different question returns null. Phase 7: `describe('subconscious.AC3.5: Duplicate curiosity thread detection')` / end-to-end via tool handler with real DB, case-insensitive, resolved exclusion, different question |
| subconscious.AC4.1 | manage_interest tool creates, updates, and transitions interests | unit | `src/tool/builtin/subconscious.test.ts` | 2 | `describe('subconscious.AC4.1: manage_interest tool')` / `it('creates an interest with name, description, and source')`, `it('updates an interest name and description')`, `it('transitions an interest to dormant')`, `it('returns error for update without id')`, `it('returns error for unknown action')` |
| subconscious.AC4.2 | manage_curiosity tool creates, explores, resolves, and parks curiosity threads | unit | `src/tool/builtin/subconscious.test.ts` | 2 | `describe('subconscious.AC4.2: manage_curiosity tool')` / `it('creates a new curiosity thread')`, `it('resumes existing duplicate thread instead of creating new')`, `it('transitions thread to exploring')`, `it('resolves thread with resolution text')`, `it('parks thread')`, `it('returns error for create without interest_id')`, `it('returns error for create without question')` |
| subconscious.AC4.3 | list_interests tool returns interests filtered by status, source, or minimum score | unit | `src/tool/builtin/subconscious.test.ts` | 2 | `describe('subconscious.AC4.3: list_interests tool')` / `it('lists all interests for owner')`, `it('filters by status')`, `it('filters by source')`, `it('filters by minimum score')` |
| subconscious.AC4.4 | list_curiosities tool returns curiosity threads for an interest, filtered by status | unit | `src/tool/builtin/subconscious.test.ts` | 2 | `describe('subconscious.AC4.4: list_curiosities tool')` / `it('lists all curiosity threads for an interest')`, `it('filters by status')` |
| subconscious.AC4.5 | Main agent's system prompt includes [Inner Life] section with active interests and recent explorations | unit | `src/subconscious/context.test.ts` | 5 | `describe('subconscious.AC4.5: Inner Life context injection')` / `it('formats active interests with engagement scores')`, `it('includes recent explorations')`, `it('shows dormant interest count')`, `it('caches result within TTL')` |
| subconscious.AC4.6 | Context provider returns undefined when no subconscious activity exists | unit | `src/subconscious/context.test.ts` | 5 | `describe('subconscious.AC4.6: Empty state handling')` / `it('returns undefined when no interests or explorations exist')`, `it('returns undefined on first call before refresh completes')` |
| subconscious.AC5.1 | Wake transition triggers a morning agenda impulse | unit | `src/subconscious/impulse.test.ts` | 6 | `describe('subconscious.AC5.1: Morning agenda impulse')` / `it('buildMorningAgendaEvent produces event with morning-agenda source')`, `it('morning agenda prompt includes interest review instructions')`, `it('morning agenda includes active interests')` |
| subconscious.AC5.2 | Sleep transition triggers a wrap-up reflection impulse | unit | `src/subconscious/impulse.test.ts` | 6 | `describe('subconscious.AC5.2: Wrap-up reflection impulse')` / `it('buildWrapUpEvent produces event with wrap-up source')`, `it('wrap-up prompt includes reflection questions')` |
| subconscious.AC5.3 | Exploration log records each impulse cycle's actions and tools used | unit + integration | `src/subconscious/impulse.test.ts` | 6 | `describe('subconscious.AC5.3: Exploration log in impulse context')` / `it('impulse prompt includes exploration log entries when present')`, `it('impulse prompt handles empty exploration log gracefully')`, `it('exploration log entries include tools_used as JSONB array')` (integration, real DB) |
| subconscious.AC5.4 | Starting from zero interests, agent creates first interests autonomously on first impulse | unit | `src/subconscious/emergent.test.ts` | 7 | `describe('subconscious.AC5.4: Cold-start impulse prompt')` / `it('impulse with empty interests produces cold-start prompt')`, `it('impulse with empty interests still includes Reflect/Generate/Act sections')` |
| subconscious.AC5.5 | No interests are hardcoded or prescribed at startup -- the registry starts empty | integration | `src/subconscious/emergent.test.ts` | 7 | `describe('subconscious.AC5.5: Empty registry at startup')` / `it('interest registry starts with zero interests')`, `it('migration does not seed any interests')` |

---

## Human Verification

| AC | Description | Why Not Automated | Verification Approach |
|----|-------------|-------------------|----------------------|
| subconscious.AC4.7 | A topic from human conversation appears as a seeded interest after the next impulse cycle | Emergent LLM behaviour. The architecture provides the mechanism (shared memory feeds impulse prompts, subconscious agent decides to create interests), but the *decision to seed* depends on the model's interpretation of the impulse prompt. No deterministic assertion is possible. | Start a human conversation about a distinctive topic. Wait for the next impulse cycle (or trigger one manually). Verify the subconscious created an interest with `source: 'seeded'` related to the conversation topic. Check via `list_interests` tool or direct DB query. The automated tests for AC1.3 (memories included in impulse) and AC4.2 (manage_curiosity tool works) verify the plumbing; this step verifies the LLM actually uses it. |
| subconscious.AC4.8 | Main agent can reference subconscious discoveries naturally during human conversation | Emergent LLM behaviour. The `[Inner Life]` context injection (AC4.5) and shared memory give the main agent access to subconscious discoveries, but whether it *references them naturally* depends on the model's judgement of relevance. | After the subconscious has explored a topic (verified via exploration log), start a human conversation touching that topic. Observe whether the main agent references discoveries from the `[Inner Life]` section or retrieves relevant memories written by the subconscious. The automated tests for AC4.5 (context injection) and AC4.6 (empty state) verify the mechanism; this step verifies the model leverages it. |
| subconscious.AC5.4 (partial) | Agent creates its *first* interests autonomously -- the actual creation, not just the prompt | The cold-start prompt ("You have no interests yet. What are you curious about?") is tested automatically (emergent.test.ts). However, whether the LLM *actually calls manage_interest to create interests* in response to that prompt is emergent behaviour. | Start the system with an empty interest registry and subconscious enabled. Wait for the first impulse cycle. Verify the subconscious agent called `manage_interest` with `action: 'create'` and at least one interest now exists. Check via DB query or exploration log. |

---

## Coverage Summary

| Category | AC Count | Automated | Human Only | Both |
|----------|----------|-----------|------------|------|
| AC1: Autonomous firing | 4 | 4 | 0 | 0 |
| AC2: Persistent conversation | 3 | 3 | 0 | 0 |
| AC3: Interest registry | 5 | 5 | 0 | 0 |
| AC4: Bidirectional interaction | 8 | 6 | 2 | 0 |
| AC5: Emergent interests | 5 | 5 | 0 | 1 |
| **Total** | **25** | **23** | **2** | **1** |

All 25 acceptance criteria are covered. 23 have full automated test coverage. AC4.7 and AC4.8 require human verification because they depend on emergent LLM behaviour (the model choosing to act on information that is provably available to it). AC5.4 has automated coverage for the prompt mechanism but requires human verification for the end-to-end behaviour.

---

## Test File Summary

| Test File | Phase(s) | Type | ACs Covered |
|-----------|----------|------|-------------|
| `src/subconscious/persistence.test.ts` | 1 | integration (PostgreSQL) | AC3.1, AC3.2, AC3.3, AC3.4, AC3.5 |
| `src/tool/builtin/subconscious.test.ts` | 2 | unit (mock registry) | AC4.1, AC4.2, AC4.3, AC4.4 |
| `src/subconscious/agent.test.ts` | 3 | integration (PostgreSQL + mock model) | AC2.1, AC2.2, AC2.3 |
| `src/subconscious/impulse.test.ts` | 4, 6 | unit (pure functions) | AC1.2, AC1.3, AC5.1, AC5.2, AC5.3 |
| `src/subconscious/scheduling.test.ts` | 4 | unit + integration (activity dispatch) | AC1.1, AC1.4 |
| `src/subconscious/context.test.ts` | 5 | unit (mock registry, async cache) | AC4.5, AC4.6 |
| `src/subconscious/emergent.test.ts` | 7 | integration (PostgreSQL + tool handlers) | AC3.4, AC3.5, AC5.4, AC5.5 |

---

## Design Rationale

**Why AC4.7 and AC4.8 cannot be automated:** These ACs describe cross-agent information flow that terminates in an LLM decision. The automated tests verify every link in the chain independently: shared memory writes (existing memory tests), memory inclusion in impulse prompts (AC1.3), interest creation tools (AC4.1/AC4.2), and context injection (AC4.5). What cannot be tested deterministically is whether the model *chooses* to act on the information. A mock model would test the plumbing (which is already covered) rather than the behaviour.

**Why AC5.4 has both automated and human verification:** The cold-start prompt is a pure function and is tested automatically. But "the agent creates its first interests" is a statement about model behaviour in response to that prompt. The automated test verifies the prompt is correct; the human verification confirms the model responds as expected.

**Phase 7 AC3.4/AC3.5 re-testing rationale:** These ACs are first tested at the registry level in Phase 1 (unit isolation). Phase 7 re-tests them as integration tests through the full tool handler chain with real PostgreSQL, verifying the end-to-end wiring (tool handler -> registry method -> SQL query -> result). The Phase 7 AC3.4 tests specifically verify the decay-then-cap ordering in the post-impulse housekeeping sequence, which is a composition-root concern not covered by Phase 1.
