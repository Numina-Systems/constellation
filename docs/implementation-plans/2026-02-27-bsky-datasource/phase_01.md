# Bluesky DataSource Implementation Plan — Phase 1: Config & Schema

**Goal:** Add a `[bluesky]` configuration section with Zod validation, env var overrides, and feature-flag semantics so the rest of the integration has a typed config to depend on.

**Architecture:** Extends the existing TOML → Zod → typed config pipeline. BlueskyConfigSchema is conditionally required (fields mandatory only when `enabled: true`). Env vars `BLUESKY_HANDLE` and `BLUESKY_APP_PASSWORD` override TOML values following the established pattern.

**Tech Stack:** Zod 3.x (already in project), TOML config, Bun test

**Scope:** 6 phases from original design (phase 1 of 6)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bsky-datasource.AC4: Config & Auth
- **bsky-datasource.AC4.1 Success:** `[bluesky]` section in config.toml parses with all fields (enabled, handle, app_password, did, watched_dids, jetstream_url)
- **bsky-datasource.AC4.2 Failure:** Config validation fails when `enabled: true` but required fields (handle, app_password, did) are missing
- **bsky-datasource.AC4.3 Success:** `BLUESKY_HANDLE` env var overrides `bluesky.handle` in TOML
- **bsky-datasource.AC4.4 Success:** `BLUESKY_APP_PASSWORD` env var overrides `bluesky.app_password` in TOML
- **bsky-datasource.AC4.5 Edge:** `watched_dids` can be empty (agent only receives replies to own account)
- **bsky-datasource.AC4.6 Success:** Feature is entirely disabled when `enabled: false` or `[bluesky]` section absent

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add BlueskyConfigSchema to schema.ts and update AppConfigSchema

**Verifies:** bsky-datasource.AC4.1, bsky-datasource.AC4.2, bsky-datasource.AC4.5, bsky-datasource.AC4.6

**Files:**
- Modify: `src/config/schema.ts:37-54`

**Implementation:**

Add `BlueskyConfigSchema` between `RuntimeConfigSchema` (line 37) and `AppConfigSchema` (line 39). The schema uses Zod's `.superRefine()` to enforce that `handle`, `app_password`, and `did` are required only when `enabled` is `true`.

```typescript
const BlueskyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    handle: z.string().optional(),
    app_password: z.string().optional(),
    did: z.string().optional(),
    watched_dids: z.array(z.string()).default([]),
    jetstream_url: z.string().url().default("wss://jetstream2.us-east.bsky.network/subscribe"),
  })
  .superRefine((data, ctx) => {
    if (data.enabled) {
      if (!data.handle) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "handle is required when bluesky is enabled", path: ["handle"] });
      }
      if (!data.app_password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "app_password is required when bluesky is enabled", path: ["app_password"] });
      }
      if (!data.did) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "did is required when bluesky is enabled", path: ["did"] });
      }
    }
  });
```

Add `bluesky: BlueskyConfigSchema.default({})` to `AppConfigSchema`.

Add `export type BlueskyConfig = z.infer<typeof BlueskyConfigSchema>;` to the type exports block.

Add `BlueskyConfigSchema` to the named schema exports on the final line.

**Testing:**

Tests must verify each AC listed above:
- bsky-datasource.AC4.1: Parse a full `[bluesky]` config with all fields and verify the typed result contains correct values
- bsky-datasource.AC4.2: Parse a config with `enabled: true` but missing `handle`/`app_password`/`did` — expect Zod validation error
- bsky-datasource.AC4.5: Parse a config with `enabled: true`, required fields present, `watched_dids` omitted — expect it defaults to `[]`
- bsky-datasource.AC4.6: Parse a config with no `[bluesky]` section — expect `bluesky.enabled` is `false`; parse with `enabled: false` — same result

Test file: `src/config/schema.test.ts` (new file, unit test)

Follow project testing patterns: `import { describe, it, expect } from "bun:test"`, test against `AppConfigSchema.parse()` directly with fixture objects. No mocking needed — these are pure schema validation tests.

**Verification:**
Run: `bun test src/config/schema.test.ts`
Expected: All tests pass

**Commit:** `feat(config): add BlueskyConfig schema with conditional validation`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add env var overrides for BLUESKY_HANDLE and BLUESKY_APP_PASSWORD in config.ts

**Verifies:** bsky-datasource.AC4.3, bsky-datasource.AC4.4

**Files:**
- Modify: `src/config/config.ts:29-37` (after DATABASE_URL block, before merge line)

**Implementation:**

Add an env var override block between the `DATABASE_URL` block (line 31) and the final merge (line 33), following the established pattern:

```typescript
if (process.env["BLUESKY_HANDLE"] || process.env["BLUESKY_APP_PASSWORD"]) {
  const blueskyObj = (parsed["bluesky"] as Record<string, unknown>) ?? {};
  blueskyObj["handle"] = process.env["BLUESKY_HANDLE"] ?? blueskyObj["handle"];
  blueskyObj["app_password"] = process.env["BLUESKY_APP_PASSWORD"] ?? blueskyObj["app_password"];
  envOverrides["bluesky"] = blueskyObj;
}
```

Also add `BlueskyConfig` to the re-export statement on line 37:

```typescript
export type { AppConfig, AgentConfig, ModelConfig, EmbeddingConfig, DatabaseConfig, RuntimeConfig, BlueskyConfig } from "./schema.ts";
```

**Testing:**

Tests must verify each AC listed above:
- bsky-datasource.AC4.3: Set `process.env["BLUESKY_HANDLE"]` before calling `loadConfig()` — verify the returned config has the env var value, not the TOML value
- bsky-datasource.AC4.4: Set `process.env["BLUESKY_APP_PASSWORD"]` before calling `loadConfig()` — verify the returned config has the env var value

Test file: `src/config/config.test.ts` (new file, unit test)

These tests need a temp TOML file on disk. Use `Bun.write()` to create a temp config file in each test, call `loadConfig(tempPath)`, and verify. Set/unset env vars in `beforeEach`/`afterEach` to avoid pollution.

**Verification:**
Run: `bun test src/config/config.test.ts`
Expected: All tests pass

**Commit:** `feat(config): add BLUESKY_HANDLE and BLUESKY_APP_PASSWORD env var overrides`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Update config.toml.example with [bluesky] section

**Verifies:** None (infrastructure)

**Files:**
- Modify: `config.toml.example:24-27` (append after `[runtime]` section)

**Implementation:**

Append the following after the `[runtime]` section at the end of `config.toml.example`:

```toml

# Bluesky integration. Requires handle, app_password, and did when enabled.
# For production, use environment variables: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD
[bluesky]
enabled = false
handle = "spirit.bsky.social"
app_password = "xxxx-xxxx-xxxx-xxxx"
did = "did:plc:example"
watched_dids = ["did:plc:friend1", "did:plc:friend2"]
jetstream_url = "wss://jetstream2.us-east.bsky.network/subscribe"
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes (no runtime changes, just example file)

**Commit:** `docs(config): add [bluesky] section to config.toml.example`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Run full test suite

**Verifies:** None (verification gate)

**Files:** None (read-only)

**Verification:**
Run: `bun test`
Expected: All previously-passing tests still pass (116 pass). The 3 pre-existing PostgreSQL connection failures are expected. New schema and config tests pass.

Run: `bun run build`
Expected: Type-check passes with zero errors.

**Commit:** No commit (verification only)
<!-- END_TASK_4 -->
