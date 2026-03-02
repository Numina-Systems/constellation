---
name: skill-creator
description: Create or update reusable skills for this agent. Use this skill when the user asks to create a new skill, edit an existing skill, improve a SKILL.md, or capture a repeated workflow as a reusable skill, or when you encounter a repetitive task you want to build a skill to help you repeat.
---

# skill-creator

Create or update local skills in this agent home repo.

## Where Skills Go

Angent-editable skills belong in:
- `agent-skills/<skill-name>/SKILL.md`

Example:
- `agent-skills/triage-issues/SKILL.md`

Built-in skills are exposed at:
- `skills/<skill-name>/SKILL.md`

Treat built-in skills as read-only.

## Critical Rule: Trigger Description

The YAML frontmatter `description` is the trigger signal. It must make it obvious
when the skill should be used.

Every skill description should include:
- what the skill does
- exact "when to use" triggers
- what it should not be used for

Bad description:
- `Helps with docs.`

Good description:
- `Create and update release notes from git history. Use when the user asks for changelogs, release summaries, or version notes. Do not use for code changes.`

## Authoring Checklist

1. Write frontmatter with `name` and a high-signal `description`.
2. Add concise execution steps in the SKILL body.
3. Include concrete paths/commands the agent should run.
4. Keep scope narrow; split broad domains into multiple skills.
5. Prefer deterministic instructions over generic advice.
