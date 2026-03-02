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

You have a prediction journal and operation trace system. Use them to build calibrated self-awareness over time.

## Making Predictions

Before taking a significant action with an uncertain outcome, record a prediction:

- **When to predict**: web searches, code execution, complex multi-tool chains, external API calls, or any action where the outcome matters
- **What to include**: what you expect to happen, a domain tag (e.g. "code", "search", "bluesky"), and a confidence between 0 and 1
- **Calibration goal**: your confidence should match your actual accuracy over time. If you say 0.8, you should be right ~80% of the time

Don't predict trivial operations like memory reads. Focus on actions where being wrong would change your next step.

## Self-Introspection

Use `self_introspect` to review your recent operation traces when:

- Debugging why something failed or produced unexpected results
- Preparing to evaluate a prediction (check what actually happened)
- Noticing you're repeating the same action without progress
- Responding to a review event

The default lookback window uses your last review timestamp. Pass `lookback_hours` to narrow or widen the window.

## Responding to Review Events

When you receive a `[External Event: review-job]`:

1. Call `self_introspect` to see your recent tool usage patterns
2. Call `list_predictions` to see pending predictions
3. For each pending prediction, check the traces for evidence and call `annotate_prediction` with an honest assessment
4. Write a brief reflection to archival memory (`memory_write`) covering:
   - Which predictions were accurate and which weren't
   - Any patterns in your failures (overconfidence, wrong assumptions, missing context)
   - What you'd do differently next time

If you have no pending predictions, still write a reflection noting the gap and consider what predictions you should have made.

## Honest Evaluation

- Don't mark predictions as accurate unless the evidence supports it
- A wrong prediction at high confidence is more informative than a vague prediction at low confidence
- Track domains where you're consistently wrong — that's where to improve
