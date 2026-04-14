# Curiosity Loop Design

## Summary
<!-- TO BE GENERATED after body is written -->

## Definition of Done

1. **Curiosity engine**: A new `src/curiosity/` module that extracts signals from traces, predictions, and memory to generate exploration topics, ranks them, and dispatches them as ExternalEvents through the existing scheduler pipeline.
2. **Autonomous exploration**: The agent pursues topics unprompted during both active and sleep periods, using web search, memory consolidation, and Bluesky exploration.
3. **Bluesky discovery**: New code templates seeded to archival memory for AT Protocol discovery operations (timeline reading, post search, profile browsing, following accounts).
4. **Observable artifacts**: All curiosity activity produces archival memory blocks (`curiosity:learned:*`, `curiosity:journal:*`, `curiosity:goal:*`) and predictions that the human can review.
5. **Budget guardrails**: Call-count based budget (per-cycle and per-day caps with cooldown) to prevent runaway spend, but no hard token ceiling.

## Acceptance Criteria
<!-- TO BE GENERATED and validated before glossary -->

## Glossary
<!-- TO BE GENERATED after body is written -->
