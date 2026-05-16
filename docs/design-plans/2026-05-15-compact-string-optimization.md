# Compact String Optimization Design

## Summary

Pattern (a sibling Rust project) uses `smol_str` and `CompactString` to reduce the cost of cloning short strings — in Rust, every string clone allocates. TypeScript/Bun interns short strings automatically, so the direct equivalent is unnecessary. However, the agent loop does have real string pressure: prompt assembly concatenates many fragments on every turn, search result formatting allocates intermediate strings in potentially hot paths, and large memory block content is sometimes copied redundantly. This design audits high-traffic string paths and applies targeted optimizations where profiling confirms a measurable benefit.

**Priority:** Low. A micro-optimization track — only worth pursuing if Bun profiling identifies string allocation as a real bottleneck. Profile first; optimize only what hurts.

## Definition of Done

1. **Audit complete** — all high-traffic string paths in the agent loop are catalogued with estimated allocation frequency per turn.
2. **Baseline benchmark** — a repeatable benchmark suite captures heap allocation and wall-clock time per agent turn before any changes.
3. **Optimizations applied** — targeted changes made to confirmed hot paths only; each change is backed by before/after profiler output.
4. **Benchmark regression test** — the benchmark suite is checked in and runnable via `bun run bench`; a clear pass/fail threshold is documented.
5. **No behavioural changes** — all existing tests pass unchanged after optimizations.

**Out of scope:**
- Optimizing cold paths or one-off startup code
- Replacing standard `string` with a custom type globally
- Any change not confirmed as a bottleneck by profiling

## Acceptance Criteria

### compact-str.AC1: Audit
- **compact-str.AC1.1 Success:** Audit document lists all string-heavy paths in: system prompt assembly (`src/agent/`), search result formatting (`src/search/`), memory block serialization (`src/memory/`), and tool definition rendering
- **compact-str.AC1.2 Success:** Each path is annotated with estimated call frequency (per-turn, per-search, once-per-startup)
- **compact-str.AC1.3 Edge:** Paths already using efficient patterns (template literals, single concatenation) are noted as non-issues and excluded from further work

### compact-str.AC2: Baseline Benchmark
- **compact-str.AC2.1 Success:** A benchmark script exists at `benchmarks/string-paths.ts` and runs via `bun run bench`
- **compact-str.AC2.2 Success:** Benchmark covers at minimum: system prompt assembly with 20 context fragments, search result formatting with 50 results, memory block content round-trip
- **compact-str.AC2.3 Success:** Benchmark outputs heap allocation delta (bytes) and wall-clock time (ms) per operation

### compact-str.AC3: Optimizations
- **compact-str.AC3.1 Success:** Prompt assembly uses an array-join pattern (`parts.push(...); parts.join('\n')`) rather than repeated string concatenation in loops
- **compact-str.AC3.2 Success:** Search result formatting builds output in a single pass without intermediate string copies per result
- **compact-str.AC3.3 Success:** Any memory block content that is only read (not modified) is passed by reference, not copied
- **compact-str.AC3.4 Edge:** No optimization is applied to a path unless the baseline benchmark shows it allocates more than 1 MB per operation or adds more than 10 ms of wall-clock time per agent turn

### compact-str.AC4: Verification
- **compact-str.AC4.1 Success:** Post-optimization benchmark shows measurable improvement (≥10% reduction in heap allocation or wall-clock time) for each changed path
- **compact-str.AC4.2 Success:** `bun test` passes with no failures after all optimizations
- **compact-str.AC4.3 Success:** `bun run build` passes with no new type errors

## Architecture

No new modules, ports, or adapters. This is a targeted refactor of existing hot paths within established module boundaries.

**Paths under audit:**

| Path | Location | Concern |
|------|----------|---------|
| System prompt assembly | `src/agent/context-builder.ts` | Fragment concatenation per turn |
| Context provider output merge | `src/agent/agent.ts` | N provider strings joined each turn |
| Search result formatting | `src/search/` | Per-result string construction |
| Memory block content copy | `src/memory/` | Large string passed through multiple layers |
| Tool definition serialization | `src/tool/` | JSON stringify per turn for context |

**Optimization patterns (apply only where confirmed):**

```typescript
// Instead of:
let prompt = '';
for (const fragment of fragments) {
  prompt += fragment + '\n';
}

// Use:
const prompt = fragments.join('\n');

// Instead of:
const results = items.map(item => formatItem(item)).join('\n');

// Use (single pass, no intermediate array of strings):
const parts: string[] = [];
for (const item of items) {
  parts.push(formatItem(item));
}
const results = parts.join('\n');
```

For large content (>10 KB) that is read-only, pass `Readonly<string>` references through the call chain and avoid `.slice()` or template literal embedding that forces a copy.

## Implementation Phases

### Phase 1: Audit & Baseline
**Goal:** Document hot paths and establish measurable baseline before touching any code.

**Components:**
- `benchmarks/string-paths.ts` — benchmark script
- Audit notes (inline comments in identified files, not a separate doc)

**Done when:** `bun run bench` runs and outputs baseline numbers; all hot paths are annotated. Covers `compact-str.AC1.*`, `compact-str.AC2.*`.

### Phase 2: Targeted Optimizations
**Goal:** Apply array-join and pass-by-reference patterns to confirmed bottlenecks only.

**Components:**
- Edits to files identified in Phase 1 audit (exact files determined by profiler output)

**Done when:** Each changed path shows ≥10% improvement in benchmark; `bun test` passes. Covers `compact-str.AC3.*`.

### Phase 3: Verification & Benchmark Regression
**Goal:** Lock in improvements and prevent regression.

**Components:**
- `benchmarks/string-paths.ts` — add threshold assertions (fail if allocation exceeds post-optimization baseline by >20%)
- `package.json` — `bench` script entry

**Done when:** `bun run bench` is green; `bun run build` and `bun test` pass. Covers `compact-str.AC4.*`.

## Additional Considerations

**Bun's string internment:** Bun (via JavaScriptCore) interns strings shorter than ~32 bytes. String concatenation of many short fragments still allocates the result. The array-join pattern avoids N-1 intermediate allocations and is the primary win available in TypeScript.

**`Buffer` for large content:** For content manipulation exceeding ~1 MB (e.g., large code execution outputs before truncation), `Buffer` operations avoid repeated UTF-8 encode/decode cycles. Applicable to the code runtime output path if profiling flags it.

**Do not prematurely optimize:** If Phase 1 finds no path exceeding the AC3.4 thresholds, the correct outcome is to close this work item as not needed. The audit is the primary deliverable.
