# SpaceMolt Auto-Registration Implementation Plan - Phase 1

**Goal:** Replace `username`/`password` with `registration_code` in the SpaceMolt config schema.

**Architecture:** Modify the existing Zod schema in `src/config/schema.ts` to swap credential fields for a registration code field, update `superRefine` validation to require `registration_code` when enabled, and update env override logic in `src/config/config.ts`.

**Tech Stack:** TypeScript, Zod, Bun

**Scope:** 5 phases from original design (phase 1 of 5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-auto-register.AC1: Config schema accepts registration code
- **spacemolt-auto-register.AC1.1 Success:** Config with `[spacemolt]` section including `enabled = true` and `registration_code` parses successfully
- **spacemolt-auto-register.AC1.2 Success:** `SPACEMOLT_REGISTRATION_CODE` env var overrides config `registration_code`
- **spacemolt-auto-register.AC1.3 Failure:** Config with `enabled = true` but missing `registration_code` is rejected by schema validation
- **spacemolt-auto-register.AC1.4 Success:** Optional `username` and `empire` config hints parse when provided

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Update SpaceMoltConfigSchema in schema.ts

**Verifies:** spacemolt-auto-register.AC1.1, spacemolt-auto-register.AC1.3, spacemolt-auto-register.AC1.4

**Files:**
- Modify: `src/config/schema.ts:192-218`

**Implementation:**

Replace the existing `SpaceMoltConfigSchema` definition at lines 192-218 with:

```typescript
const SpaceMoltConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    registration_code: z.string().optional(),
    username: z.string().optional(),
    empire: z.string().optional(),
    mcp_url: z.string().url().default("https://game.spacemolt.com/mcp"),
    ws_url: z.string().url().default("wss://game.spacemolt.com/ws"),
    event_queue_capacity: z.number().int().positive().default(50),
  })
  .superRefine((data, ctx) => {
    if (data.enabled) {
      if (!data.registration_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "registration_code is required when spacemolt is enabled",
          path: ["registration_code"],
        });
      }
    }
  });
```

Key changes:
- Remove `password` field entirely
- Replace `username` required-when-enabled semantics with optional hint (no `superRefine` check)
- Add `registration_code` field (optional at schema level, required via `superRefine` when `enabled: true`)
- Add `empire` field (optional hint)
- `mcp_url`, `ws_url`, `event_queue_capacity` remain unchanged

**Verification:**

Run: `bun run build`
Expected: Type-check passes. Any compile errors from consumers of `SpaceMoltConfig` that reference `.password` are expected and will be fixed in later phases.

**Commit:** `feat(config): replace spacemolt username/password with registration_code`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update env override logic in config.ts

**Verifies:** spacemolt-auto-register.AC1.2

**Files:**
- Modify: `src/config/config.ts:68-77`

**Implementation:**

Replace the existing SpaceMolt env override block at lines 68-77 with:

```typescript
  if (parsed["spacemolt"] && process.env["SPACEMOLT_REGISTRATION_CODE"]) {
    const spacemoltObj = parsed["spacemolt"] as Record<string, unknown>;
    spacemoltObj["registration_code"] = process.env["SPACEMOLT_REGISTRATION_CODE"];
    envOverrides["spacemolt"] = spacemoltObj;
  }
```

Key changes:
- Remove `SPACEMOLT_PASSWORD` and `SPACEMOLT_USERNAME` env var handling
- Add `SPACEMOLT_REGISTRATION_CODE` env var override
- Simpler logic: only one env var to check

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(config): replace spacemolt env overrides with SPACEMOLT_REGISTRATION_CODE`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Update schema validation tests in schema.test.ts

**Verifies:** spacemolt-auto-register.AC1.1, spacemolt-auto-register.AC1.3, spacemolt-auto-register.AC1.4

**Files:**
- Modify: `src/config/schema.test.ts:853-1014`

**Testing:**

Replace the entire `describe("SpaceMoltConfigSchema", ...)` block (lines 853-1014) with tests covering the new schema:

- **spacemolt-auto-register.AC1.1:** Test that a config with `enabled: true` and `registration_code` parses successfully. Include `mcp_url`, `ws_url`, `event_queue_capacity` in the assertion.
- **spacemolt-auto-register.AC1.3:** Test that a config with `enabled: true` but missing `registration_code` throws.
- **spacemolt-auto-register.AC1.4:** Test that optional `username` and `empire` hints parse when provided alongside `registration_code`.
- Retain existing tests for: disabled config without `registration_code` parses, default values applied, invalid `mcp_url` rejected, absent `[spacemolt]` section allowed.

Test structure should follow existing AC naming convention:
```typescript
describe("SpaceMoltConfigSchema", () => {
  describe("spacemolt-auto-register.AC1.1: Parse spacemolt config with registration_code", () => {
    it("should parse enabled spacemolt config with registration_code", () => { ... });
  });

  describe("spacemolt-auto-register.AC1.3: Reject enabled without registration_code", () => {
    it("should reject enabled spacemolt without registration_code", () => { ... });
  });

  describe("spacemolt-auto-register.AC1.4: Optional username and empire hints", () => {
    it("should parse optional username and empire hints", () => { ... });
  });

  describe("Additional SpaceMolt tests", () => {
    it("should parse disabled spacemolt without registration_code", () => { ... });
    it("should reject invalid mcp_url", () => { ... });
    it("should apply default values for mcp_url and ws_url", () => { ... });
    it("should apply default value for event_queue_capacity", () => { ... });
    it("should allow spacemolt section to be entirely absent", () => { ... });
  });
});
```

All test configs must use `registration_code` instead of `username`/`password`. The base config pattern used in all tests:
```typescript
const config = {
  agent: {},
  model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
  embedding: { provider: "openai", model: "text-embedding-3-small" },
  database: { url: "postgresql://localhost/test" },
  runtime: {},
  spacemolt: { /* fields under test */ },
};
```

**Verification:**

Run: `bun test src/config/schema.test.ts`
Expected: All SpaceMolt schema tests pass

**Commit:** `test(config): update spacemolt schema tests for registration_code`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update env override tests in env-override.test.ts

**Verifies:** spacemolt-auto-register.AC1.2

**Files:**
- Modify: `src/config/env-override.test.ts:141-273`

**Testing:**

Replace the entire `describe("spacemolt-integration.AC1.2: SPACEMOLT_PASSWORD env override", ...)` block (lines 141-273) with tests for the new env var:

- **spacemolt-auto-register.AC1.2:** Test that `SPACEMOLT_REGISTRATION_CODE` env var overrides the config `registration_code` value.
- Retain: test that env overrides not applied if `[spacemolt]` section absent.

The `beforeEach`/`afterEach` should save/restore `SPACEMOLT_REGISTRATION_CODE` (remove `SPACEMOLT_PASSWORD` and `SPACEMOLT_USERNAME` handling).

Test TOML content must use `registration_code` instead of `username`/`password`. Since `registration_code` is the only required field when enabled, and `username`/`password` no longer exist, TOML for enabled configs should look like:

```toml
[spacemolt]
enabled = true
registration_code = "config-reg-code"
```

Test structure:
```typescript
describe("spacemolt-auto-register.AC1.2: SPACEMOLT_REGISTRATION_CODE env override", () => {
  // beforeEach: save SPACEMOLT_REGISTRATION_CODE, create temp config path
  // afterEach: restore env, delete temp file

  it("should use SPACEMOLT_REGISTRATION_CODE env var to override config registration_code", () => { ... });
  it("should not apply env overrides if spacemolt section is absent in config", () => { ... });
});
```

**Verification:**

Run: `bun test src/config/env-override.test.ts`
Expected: All env override tests pass

**Commit:** `test(config): update spacemolt env override tests for SPACEMOLT_REGISTRATION_CODE`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Verify full test suite and build

**Files:** None (verification only)

**Verification:**

**Phase gate: config tests must pass.** The full build (`bun run build`) will fail due to downstream consumers in `src/extensions/spacemolt/source.ts` and `src/extensions/spacemolt/tool-provider.ts` that still reference `.password` — this is expected and NOT a Phase 1 failure. Those files are updated in Phases 3 and 4.

Run: `bun test src/config/`
Expected: All config tests pass (schema tests, env override tests, and config loading tests). This is the phase gate.

**Commit:** No commit for this task (verification only). Downstream compile errors are expected and addressed in later phases.
<!-- END_TASK_5 -->
