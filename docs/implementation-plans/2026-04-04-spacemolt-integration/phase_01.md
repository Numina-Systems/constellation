# SpaceMolt Integration — Phase 1: Config Schema & Dependency Setup

**Goal:** Accept `[spacemolt]` configuration and add MCP SDK dependency.

**Architecture:** Extend the existing Zod config schema with an optional `[spacemolt]` section. Add provider-aware env overrides for `SPACEMOLT_PASSWORD` and `SPACEMOLT_USERNAME`. Add `@modelcontextprotocol/sdk` as a dependency.

**Tech Stack:** Zod, TOML, `@modelcontextprotocol/sdk`

**Scope:** 8 phases from original design (phase 1 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC1: Config schema accepts SpaceMolt configuration
- **spacemolt-integration.AC1.1 Success:** Config with `[spacemolt]` section including `enabled = true`, `username`, `mcp_url`, `ws_url` parses successfully
- **spacemolt-integration.AC1.2 Success:** `SPACEMOLT_PASSWORD` env var overrides config `password` when spacemolt is enabled
- **spacemolt-integration.AC1.3 Success:** `SPACEMOLT_USERNAME` env var overrides config `username`
- **spacemolt-integration.AC1.4 Failure:** Config with `mcp_url = "not-a-url"` is rejected by schema validation

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add `@modelcontextprotocol/sdk` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run:
```bash
bun add @modelcontextprotocol/sdk
```

**Step 2: Verify installation**

Run: `bun run build`
Expected: TypeScript compilation succeeds with no errors

**Commit:** `chore: add @modelcontextprotocol/sdk dependency`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add SpaceMolt config schema

**Verifies:** spacemolt-integration.AC1.1, spacemolt-integration.AC1.4

**Files:**
- Modify: `src/config/schema.ts:191-220`
- Test: `src/config/schema.test.ts`

**Implementation:**

Add `SpaceMoltConfigSchema` before `AppConfigSchema` (around line 191 in `src/config/schema.ts`). Follow the pattern of other optional config sections with conditional validation via `superRefine`:

```typescript
const SpaceMoltConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    username: z.string().optional(),
    password: z.string().optional(),
    mcp_url: z.string().url().default("https://game.spacemolt.com/mcp"),
    ws_url: z.string().url().default("wss://game.spacemolt.com/ws"),
    event_queue_capacity: z.number().int().positive().default(50),
  })
  .superRefine((data, ctx) => {
    if (data.enabled) {
      if (!data.username) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "username is required when spacemolt is enabled",
          path: ["username"],
        });
      }
      if (!data.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "password is required when spacemolt is enabled",
          path: ["password"],
        });
      }
    }
  });
```

Add `spacemolt: SpaceMoltConfigSchema.optional(),` to `AppConfigSchema` (after the `activity` line). Use `.optional()` only (like `email`), not `.default({}).optional()`. When absent, `config.spacemolt` is `undefined`, checked via `config.spacemolt?.enabled`.

Add type export: `export type SpaceMoltConfig = z.infer<typeof SpaceMoltConfigSchema>;`

Add to the schema export line: `SpaceMoltConfigSchema`

**Testing:**

Tests must verify each AC listed above:
- spacemolt-integration.AC1.1: Config with `enabled = true`, `username`, `password`, `mcp_url`, `ws_url` parses successfully. Verify all fields have expected values.
- spacemolt-integration.AC1.4: Config with `mcp_url = "not-a-url"` throws `ZodError`.

Additional tests:
- Disabled spacemolt (default) parses without username/password
- Enabled spacemolt without username throws
- Enabled spacemolt without password throws
- Default values for `mcp_url`, `ws_url`, `event_queue_capacity` are correct
- SpaceMolt section is optional (absent entirely still parses)

Follow the existing test structure in `src/config/schema.test.ts`:
```typescript
describe("SpaceMoltConfigSchema", () => {
  describe("spacemolt-integration.AC1.1: Parse spacemolt config with all fields", () => {
    it("should parse enabled spacemolt config", () => { ... });
  });
  describe("spacemolt-integration.AC1.4: Invalid mcp_url rejected", () => {
    it("should reject invalid mcp_url", () => { ... });
  });
});
```

**Verification:**
Run: `bun test src/config/schema.test.ts`
Expected: All tests pass

**Commit:** `feat: add spacemolt config schema with conditional validation`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Add SpaceMolt env var overrides

**Verifies:** spacemolt-integration.AC1.2, spacemolt-integration.AC1.3

**Files:**
- Modify: `src/config/config.ts:66-69`
- Modify: `src/config/config.ts:72` (type re-export line)
- Test: `src/config/env-override.test.ts`

**Implementation:**

In `src/config/config.ts`, add a spacemolt env override block before the final merge (after the email block, around line 66):

```typescript
if (parsed["spacemolt"] && (process.env["SPACEMOLT_PASSWORD"] || process.env["SPACEMOLT_USERNAME"])) {
  const spacemoltObj = parsed["spacemolt"] as Record<string, unknown>;
  if (process.env["SPACEMOLT_PASSWORD"]) {
    spacemoltObj["password"] = process.env["SPACEMOLT_PASSWORD"];
  }
  if (process.env["SPACEMOLT_USERNAME"]) {
    spacemoltObj["username"] = process.env["SPACEMOLT_USERNAME"];
  }
  envOverrides["spacemolt"] = spacemoltObj;
}
```

Note: Guard with `parsed["spacemolt"]` so env vars alone cannot bootstrap a spacemolt config section. The `[spacemolt]` section must exist in TOML; env vars only override fields within it. This matches the Bluesky/email env override pattern.

Add `SpaceMoltConfig` to the type re-export line at the bottom of `config.ts`.

**Testing:**

Tests must verify:
- spacemolt-integration.AC1.2: `SPACEMOLT_PASSWORD` env var overrides config `password` — write a TOML config with `[spacemolt]` section, set env var, verify loaded config has env value
- spacemolt-integration.AC1.3: `SPACEMOLT_USERNAME` env var overrides config `username` — same pattern

Follow the exact pattern from the existing OpenRouter env override tests in `src/config/env-override.test.ts`:
- `beforeEach`: save original env vars, create temp config file
- `afterEach`: restore env vars, delete temp file
- Test that env var takes precedence over TOML value

**Verification:**
Run: `bun test src/config/env-override.test.ts`
Expected: All tests pass

**Commit:** `feat: add SPACEMOLT_PASSWORD and SPACEMOLT_USERNAME env overrides`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update .env.example

**Files:**
- Modify: `.env.example`

**Implementation:**

Add SpaceMolt env vars to `.env.example`:

```
# SpaceMolt
# SPACEMOLT_USERNAME=YourAgentName
# SPACEMOLT_PASSWORD=...
```

**Step 1: Verify build**

Run: `bun run build`
Expected: No errors

**Commit:** `docs: add spacemolt env vars to .env.example`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
