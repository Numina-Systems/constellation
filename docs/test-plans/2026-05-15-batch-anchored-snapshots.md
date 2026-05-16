# Human Test Plan: Batch-Anchored Snapshots

## Overview

Verify that the batch-anchored snapshot system correctly routes dynamic context through user message attachments instead of the system prompt, enabling stable prefix caching across turns.

## Prerequisites

- PostgreSQL running locally with pgvector (`docker compose up -d`)
- Valid `config.toml` with at least one LLM provider configured
- `bun run migrate` completed

## Test Scenarios

### 1. Basic Conversation Flow

**Steps:**
1. Start the daemon: `bun run start`
2. Send a message: "Hello, what's your name?"
3. Wait for response
4. Send a follow-up: "Tell me more about yourself"

**Expected:**
- First turn: Agent responds normally with full context available
- Second turn: Agent responds with awareness of prior turn
- No visible regressions in conversation quality

### 2. Dynamic Context Attachment Visibility

**Steps:**
1. Start the daemon with debug logging enabled
2. Send a message that triggers recall (reference something from a prior conversation)
3. Observe the message structure in logs

**Expected:**
- User message should contain content array with attachment block prepended
- Attachment should show `[Dynamic Context — Full Snapshot]` on first turn
- Subsequent turns with unchanged context should show no attachment (noop)
- Changed context should show `[Dynamic Context — Updated Sections]`

### 3. System Prompt Stability

**Steps:**
1. Start the daemon
2. Send two consecutive messages with no tool/persona changes between them
3. Compare system prompt content across turns (via debug logging)

**Expected:**
- System prompt string should be identical between turns
- No dynamic context (recall, scheduling, activity) should appear in system prompt
- System prompt should contain only persona and core memory blocks

### 4. Compaction Compatibility

**Steps:**
1. Start the daemon
2. Have a long conversation (10+ exchanges) to trigger automatic compaction
3. Continue conversation after compaction

**Expected:**
- Compaction should complete without errors
- Post-compaction turn should produce a full snapshot (not delta/noop)
- Conversation should continue normally with full context re-sent

### 5. Manual Compaction Reset

**Steps:**
1. During a conversation, invoke the `compact_context` tool (ask the agent to compact)
2. Send a follow-up message

**Expected:**
- Compaction completes successfully
- Next turn produces full snapshot (reset confirmed)
- No loss of conversation coherence

### 6. Backward Compatibility — Existing Conversations

**Steps:**
1. Ensure existing conversations exist in the database (from before this feature)
2. Start the daemon
3. Continue an existing conversation

**Expected:**
- Old messages load and display correctly
- Agent can reference prior context from old messages
- No errors or missing content

### 7. Provider Classification Verification

**Steps:**
1. Start the daemon with all optional features enabled (scheduling, subconscious, recall, etc.)
2. Send a message that activates multiple context providers
3. Verify dynamic context appears in user message attachment, not system prompt

**Expected:**
- All 8 provider types (rate-limit, MCP, activity, recall, prediction, scheduling, subconscious, introspection) route through snapshot pipeline
- System prompt contains only persona/core memory

### 8. Known Limitation: Skills in System Prompt

**Steps:**
1. Configure skills in the agent
2. Send messages that trigger skill injection
3. Observe system prompt content

**Expected (known limitation):**
- Skills still appear in the system prompt (not routed through snapshot pipeline)
- This is documented and tracked for future work
- All other dynamic context correctly routes through attachments

## Automated Test Summary

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `src/agent/snapshot.test.ts` | 13 | AC3.1-3.5, AC4.1-4.4 |
| `src/agent/messages.test.ts` | 12 | AC2.1-2.5, AC6.1 |
| `src/agent/context-stability.test.ts` | 6 | AC1.1-1.5 |
| `src/agent/snapshot-compat.test.ts` | 15 | AC5.1-5.4, AC6.2-6.3 |
| **Total** | **46** | **24/24 ACs** |
