-- 005_scheduler_owner.sql
-- Migrate the review-predictions job from agent owner to system owner.
-- This enables owner isolation: agent scheduling tools only see agent-owned tasks,
-- system jobs are invisible to the agent.
-- Note: cancelled = FALSE guard ensures only active review jobs are migrated;
-- any cancelled historical entries remain under their original owner (harmless).

UPDATE scheduled_tasks
SET owner = 'system'
WHERE name = 'review-predictions'
  AND owner = 'spirit'
  AND cancelled = FALSE;
