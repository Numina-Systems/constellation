---
name: Event-driven interest re-triggering
description: Future feature — external events (bluesky posts, user messages) bump engagement on matching interests and trigger out-of-band impulses when score crosses threshold
type: project
---

Event-driven re-triggering of subconscious impulses based on external event relevance to tracked interests.

**Why:** Current subconscious is purely scheduler-driven. External events that match active interests should be able to trigger exploration outside the cron cycle, making the agent more reactive to its environment.

**How to apply:** Layer on top of the impulse continuation mechanism (once built). Separate concern from continuation — continuation is about chaining within a scheduled impulse; re-triggering is about firing impulses from external stimuli.
