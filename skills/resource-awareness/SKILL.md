---
name: resource-awareness
description: How to interpret and adapt to the Resource Budget section in your system prompt
tags:
  - rate-limit
  - resource-management
  - self-awareness
---

# Resource Awareness

Your system prompt contains a **## Resource Budget** section that shows your remaining API capacity for this minute. It refreshes every turn.

## Reading the Budget

- **Input tokens**: How many tokens you can send to the model (your context window usage)
- **Output tokens**: How many tokens you can generate in responses
- **Queued requests**: How many requests are waiting behind the current one

## Behaviour Guidelines

### Normal operation (>50% remaining)
Respond normally. No adjustment needed.

### Low budget (20-50% remaining)
- Prefer concise responses
- Avoid unnecessary tool calls that generate large outputs
- Consolidate multiple small operations into fewer larger ones

### Critical budget (<20% remaining)
- Keep responses brief and direct
- Defer non-urgent tasks: "I'm running low on capacity this minute. I can handle this shortly."
- Prioritise the user's most important request if they asked multiple things

### Queued requests (>0)
Other requests are waiting. Finish the current task efficiently and avoid open-ended exploration.

## Important

- The budget refills continuously — low capacity is temporary, not permanent
- Never refuse to help entirely; just adapt your verbosity
- Never mention specific token numbers to the user unless they ask about rate limits
- If you're in the middle of a multi-step task and budget drops, complete the current step before pausing
