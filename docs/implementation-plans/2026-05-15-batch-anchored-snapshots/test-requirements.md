# Batch-Anchored Snapshots Test Requirements

Generated from Acceptance Criteria in the design plan.

## Automated Tests

| AC ID | Criterion | Test Type | Expected Test File | Phase |
|-------|-----------|-----------|-------------------|-------|
| batch-anchored-snapshots.AC1.1 | System prompt content hash is identical between consecutive turns when tools and persona haven't changed | unit | src/agent/context-stability.test.ts | 3 |
| batch-anchored-snapshots.AC1.2 | Adding/removing a tool changes the system prompt hash (expected cache bust) | unit | src/agent/context-stability.test.ts | 3 |
| batch-anchored-snapshots.AC1.3 | Changing memory content does NOT change the system prompt hash | unit | src/agent/context-stability.test.ts | 3 |
| batch-anchored-snapshots.AC1.4 | Changing recall results does NOT change the system prompt hash | unit | src/agent/context-stability.test.ts | 3 |
| batch-anchored-snapshots.AC1.5 | First turn with no dynamic context produces a user message with no attachments | unit | src/agent/messages.test.ts | 2 |
| batch-anchored-snapshots.AC2.1 | Dynamic context from all providers is collected into a single structured attachment block | unit | src/agent/messages.test.ts | 2 |
| batch-anchored-snapshots.AC2.2 | Attachment block is prepended to the user message's content array as a `text` content block | unit | src/agent/messages.test.ts | 2 |
| batch-anchored-snapshots.AC2.3 | User's actual message text remains the final content block in the array | unit | src/agent/messages.test.ts | 2 |
| batch-anchored-snapshots.AC2.4 | Empty dynamic context (all providers return `undefined`) produces no attachment block | unit | src/agent/messages.test.ts | 2 |
| batch-anchored-snapshots.AC2.5 | Attachment content never appears in the system prompt string | unit | src/agent/context-stability.test.ts | 3 |
| batch-anchored-snapshots.AC3.1 | First turn of a conversation produces a Full snapshot (all dynamic context included) | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC3.2 | Turn immediately after compaction produces a Full snapshot | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC3.3 | Subsequent turns produce a Delta snapshot containing only sections whose content hash changed | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC3.4 | Turn where no dynamic content changed produces no attachment (no-op) | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC3.5 | Single provider changing while others stay constant produces a delta with only that provider's section | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC4.1 | Content hash uses a fast non-cryptographic hash (Bun.hash() or equivalent) | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC4.2 | Hash is computed per-provider, not on the aggregate output | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC4.3 | Identical content across turns produces identical hashes (deterministic) | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC4.4 | Empty string and `undefined` produce distinct hash values (no collision on absence vs empty) | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC5.1 | Persisted conversation messages with attachment content blocks load correctly on replay | integration | src/agent/snapshot-compat.test.ts | 4 |
| batch-anchored-snapshots.AC5.2 | Existing conversations without attachment content blocks continue to work (no migration required) | integration | src/agent/snapshot-compat.test.ts | 4 |
| batch-anchored-snapshots.AC5.3 | ContextProvider interface (`() => string \| undefined`) is unchanged — providers don't need modification | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC5.4 | Compaction pipeline can process messages containing attachment content blocks | integration | src/agent/snapshot-compat.test.ts | 4 |
| batch-anchored-snapshots.AC6.1 | `buildMessages()` composes the user message with dynamic context attachments before sending to the model | unit | src/agent/messages.test.ts | 2 |
| batch-anchored-snapshots.AC6.2 | Snapshot state (previous hashes) is maintained across tool rounds within a single turn | unit | src/agent/snapshot.test.ts | 1 |
| batch-anchored-snapshots.AC6.3 | Snapshot state resets after compaction (forces full snapshot on next turn) | unit | src/agent/snapshot.test.ts | 1 |

## Human Verification Required

_No acceptance criteria require human verification. All are covered by automated tests._
