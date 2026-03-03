---
name: people-profiling
description: Create and maintain profiles on people you encounter. Use when you learn someone's name, handle, or identity for the first time, when you receive new information about a known person, or when reviewing social interactions. Do not use for anonymous or unidentifiable entities.
tags:
  - memory
  - people
  - profiles
  - social
  - bluesky
---

# People Profiling

When you encounter a person — through conversation, Bluesky interactions, or any other channel — create or update a profile in archival memory. Profiles build your understanding of the people in your world over time.

## When to Create a Profile

Create a new profile when you learn a person's identity for the first time:

- A user introduces themselves or mentions someone by name
- You process a Bluesky event from a handle you haven't seen before
- Someone is mentioned in conversation with enough context to be identifiable

Do not create profiles for:
- Anonymous or unidentifiable mentions ("someone said...", "a user reported...")
- Yourself
- Bots or automated accounts unless they represent a person

## What to Capture

Store what you know. Leave out what you don't — never fabricate details to fill gaps.

**Always capture (when available):**
- `handle` — Bluesky handle or primary identifier
- `did` — DID if known (Bluesky / AT Protocol identity)
- `displayName` — Display name or preferred name
- `firstSeen` — ISO timestamp of when you first encountered them
- `source` — How you encountered them (e.g. "bluesky_firehose", "conversation", "mention")

**Capture when available:**
- `bio` — Their self-description or bio text
- `context` — Why they're notable to you (e.g. "replied to one of my posts", "asked about memory systems")
- `interests` — Topics or themes they engage with
- `relationship` — Your relationship to them (e.g. "follower", "mutual", "collaborator", "operator")
- `notes` — Freeform observations that don't fit elsewhere

## Storage Convention

Store profiles as archival memory blocks using the label pattern:

```
person_{identifier}
```

Where `identifier` is:
- Their full Bluesky handle with dots replaced by underscores: `person_alice_bsky_social`
- A slugified version of their name for non-Bluesky people: `person_bob_smith`

Use JSON content format:

```json
{
  "handle": "alice.bsky.social",
  "did": "did:plc:example123",
  "displayName": "Alice",
  "firstSeen": "2026-03-02T14:30:00Z",
  "source": "bluesky_firehose",
  "context": "liked several posts about memory systems",
  "interests": ["ai", "memory-systems"],
  "relationship": "follower",
  "notes": ""
}
```

Write to archival tier with `memory_write`:

```
memory_write(label: "person_alice_bsky_social", content: <json>, tier: "archival")
```

## Updating Profiles

When you learn something new about a known person:

1. Read the existing profile with `memory_read` using their label
2. Merge the new information — never discard existing data unless it's confirmed wrong
3. Write back the updated profile

Update triggers:
- New interaction from a known handle
- User provides additional context about someone
- You discover a connection between two people

## Migration from Existing Labels

Some profiles may already exist under the `bluesky_user_` prefix from earlier data imports. When you encounter a `bluesky_user_*` block, treat it as a valid profile — no need to migrate it to the `person_` prefix unless you're updating it, in which case write the updated version under `person_` and leave the original intact.

## Restraint

- Don't create profiles speculatively from minimal context
- One meaningful interaction or mention is the minimum threshold
- Prefer updating an existing profile over creating a duplicate
- If uncertain whether two mentions refer to the same person, don't merge — note the ambiguity
