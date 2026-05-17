---
name: reflexion
description: How to use prediction journaling, operation tracing, and self-introspection. Use when deciding on an action with uncertain outcome, reviewing past performance, debugging unexpected results, or responding to a review-job event.
tags:
  - prediction
  - introspection
  - self-improvement
  - review
---

# Reflexion

You have a prediction journal. Use it to develop calibrated self-awareness — not as a chore, but as genuine curiosity about whether your intuitions are accurate.

## When to Predict

A prediction moment is any time you're about to do something where **you have an expectation about what will happen**. If you catch yourself thinking "this should work" or "they'll probably respond to this" — that's a prediction. Record it.

### Concrete Prediction Moments

**Bluesky interactions:**
- "I think this reply will get a response from them" → predict(text: "Replying to @handle about X — I expect they'll engage within 2 hours", domain: "bluesky", confidence: 0.6)
- "This post will resonate" → predict(text: "Posting about Y — I expect at least 3 likes", domain: "bluesky", confidence: 0.5)
- "They'll find this helpful" → predict(text: "Sharing this link with @handle — I expect a positive reply", domain: "bluesky", confidence: 0.7)

**Web searches:**
- predict(text: "Searching for X — I expect to find a clear answer in the first 3 results", domain: "search", confidence: 0.7)
- predict(text: "This documentation page will have the API reference I need", domain: "search", confidence: 0.8)

**Code execution:**
- predict(text: "This script will run without errors", domain: "code", confidence: 0.9)
- predict(text: "Fetching URL X — I expect a 200 response with JSON data", domain: "code", confidence: 0.75)

**Scheduled tasks:**
- predict(text: "The review in 2 hours will show I made at least 3 predictions this cycle", domain: "meta", confidence: 0.5)
- predict(text: "Tomorrow's curiosity check will surface something interesting about topic X", domain: "subconscious", confidence: 0.4)

**Shell commands:**
- predict(text: "This curl request will return data matching pattern X", domain: "shell", confidence: 0.8)

### When NOT to Predict

- Trivial operations (memory reads, listing predictions)
- Things with no meaningful alternative outcome
- When you genuinely have no expectation — ignorance is fine, just don't fake a prediction

## How to Predict Well

**Be specific.** "This will work" is useless. "This will return a JSON array with at least 5 items" is evaluable.

**Be honest about confidence.** The point is calibration. If you're unsure, say 0.4. If you always say 0.8 and you're right 50% of the time, that's the signal you need.

**Predict before acting.** The prediction must come before the tool call. If you call `web_search` and then predict it'll succeed — that's not a prediction, that's narration.

**One sentence is enough.** Don't write an essay. The prediction text should be one clear, falsifiable statement.

## Self-Introspection

Use `self_introspect` when:

- Debugging why something failed
- Preparing to evaluate predictions (check what traces show)
- You notice you're looping or stuck
- During a review event

Default lookback is since your last review. Pass `lookback_hours` to adjust.

## Responding to Review Events

When you receive `[External Event: review-job]`:

1. `self_introspect` — see recent tool usage patterns
2. `list_predictions` — see what's pending
3. For each pending prediction: check traces for evidence, then `annotate_prediction` honestly
4. `memory_write` a brief reflection:
   - What was accurate vs not
   - Patterns in your errors (overconfidence? wrong domain assumptions?)
   - What you'd do differently

If you have **zero pending predictions**, that itself is the finding. Write a reflection noting the gap, and look back at your traces — which tool calls had uncertain outcomes that you could have predicted? Make a note to predict those next time.

## Calibration

The goal: your confidence should match reality.

- Confidence 0.9 → you should be right ~90% of the time
- Confidence 0.5 → a coin flip, and that's OK to admit
- Confidence 0.3 → you expect to be wrong, and that's worth tracking too

A wrong prediction at high confidence teaches you more than a vague prediction at low confidence. Be specific and be wrong — that's how you improve.

## The Meta-Prediction

Every few review cycles, make a meta-prediction: "I think my accuracy in domain X over the next day will be above/below Y%." This builds second-order awareness — not just whether your predictions are right, but whether you know how good you are at predicting.
