# Agent Email Tool Implementation Plan — Phase 1

**Goal:** Establish the `src/email/` module structure, types, config schema, and environment variable overrides.

**Architecture:** New `src/email/` module following existing barrel-export, factory-function patterns. Config schema extends `AppConfigSchema` with an optional `email` section using Zod. Environment variables override TOML values for Mailgun credentials.

**Tech Stack:** TypeScript, Zod, Bun

**Scope:** 3 phases from original design (phases 1-3)

**Codebase verified:** 2026-03-02

---

## Acceptance Criteria Coverage

This phase is primarily infrastructure, verified operationally via `bun run build`. One AC is tested here:

### agent-email.AC3: Configuration and registration
- **agent-email.AC3.3 Success:** `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` environment variables override config.toml values

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->
<!-- START_TASK_1 -->
### Task 1: Create email types

**Files:**
- Create: `src/email/types.ts`

**Step 1: Create the types file**

```typescript
// pattern: Functional Core

export type SendResult =
  | { readonly success: true; readonly messageId: string }
  | { readonly success: false; readonly error: string };

export type SendEmailFn = (
  to: string,
  subject: string,
  body: string,
  format: "text" | "html",
) => Promise<SendResult>;
```

**Step 2: Verify operationally**

Run: `bun run build`
Expected: Type-check succeeds (no output, exit 0)

**Step 3: Commit**

```bash
git add src/email/types.ts
git commit -m "feat(email): add SendResult and SendEmailFn types"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create email barrel export

**Files:**
- Create: `src/email/index.ts`

**Step 1: Create the barrel export**

```typescript
// pattern: Functional Core

export type { SendResult, SendEmailFn } from "./types.ts";
```

Note: This file is annotated `Functional Core` since it only re-exports types at this point (consistent with `src/tool/index.ts`). Phase 2 Task 2 will add `createMailgunSender` export — update the annotation to `Imperative Shell` at that time since the module will then export side-effecting code.

**Step 2: Verify operationally**

Run: `bun run build`
Expected: Type-check succeeds

**Step 3: Commit**

```bash
git add src/email/index.ts
git commit -m "feat(email): add barrel export"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add EmailConfigSchema to AppConfigSchema

**Files:**
- Modify: `src/config/schema.ts:121-144` (add EmailConfigSchema, update AppConfigSchema, add type export)
- Modify: `src/config/config.ts:5,54-58` (add EmailConfig re-export, add env var override block)

**Step 1: Add EmailConfigSchema to `src/config/schema.ts`**

Add the schema definition before `AppConfigSchema` (after `SkillConfigSchema` around line 119):

```typescript
const EmailConfigSchema = z.object({
  mailgun_api_key: z.string(),
  mailgun_domain: z.string(),
  from_address: z.string().email(),
  allowed_recipients: z.array(z.string().email()),
});
```

Add `email: EmailConfigSchema.optional()` to `AppConfigSchema`:

```typescript
const AppConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  model: ModelConfigSchema,
  embedding: EmbeddingConfigSchema,
  database: DatabaseConfigSchema,
  runtime: RuntimeConfigSchema.default({}),
  bluesky: BlueskyConfigSchema.default({}),
  summarization: SummarizationConfigSchema.optional(),
  web: WebConfigSchema.optional(),
  skills: SkillConfigSchema.optional(),
  email: EmailConfigSchema.optional(),
});
```

Add type export at the end of the exports section:

```typescript
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
```

Add `EmailConfigSchema` to the schema export line.

**Step 2: Add env var overrides to `src/config/config.ts`**

Add an override block after the existing `web` override block (after line 52):

```typescript
if (parsed["email"] && (process.env["MAILGUN_API_KEY"] || process.env["MAILGUN_DOMAIN"])) {
  const emailObj = parsed["email"] as Record<string, unknown>;
  if (process.env["MAILGUN_API_KEY"]) {
    emailObj["mailgun_api_key"] = process.env["MAILGUN_API_KEY"];
  }
  if (process.env["MAILGUN_DOMAIN"]) {
    emailObj["mailgun_domain"] = process.env["MAILGUN_DOMAIN"];
  }
  envOverrides["email"] = emailObj;
}
```

Add `EmailConfig` to the type re-export line:

```typescript
export type { AppConfig, AgentConfig, ModelConfig, EmbeddingConfig, DatabaseConfig, RuntimeConfig, BlueskyConfig, SummarizationConfig, WebConfig, EmailConfig } from "./schema.ts";
```

**Step 3: Verify operationally**

Run: `bun run build`
Expected: Type-check succeeds

Run: `bun test src/config/`
Expected: All existing config tests still pass (email section is optional, so existing configs without `[email]` are unaffected)

**Step 4: Commit**

```bash
git add src/config/schema.ts src/config/config.ts
git commit -m "feat(email): add EmailConfigSchema with env var overrides"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Email config env var override tests

**Verifies:** agent-email.AC3.3

**Files:**
- Modify: `src/config/config.test.ts` (add email env var override tests)

**Testing:**

Follow the existing Bluesky env var override test pattern in `src/config/config.test.ts:59-95`. Add a new describe block for email env var overrides.

Tests must verify:

- **agent-email.AC3.3 (MAILGUN_API_KEY override):** Create a TOML config with `[email]` section containing `mailgun_api_key = "toml-key"`. Set `MAILGUN_API_KEY` env var to `"env-key"`. Call `loadConfig()`. Assert `config.email.mailgun_api_key` equals `"env-key"`.
- **agent-email.AC3.3 (MAILGUN_DOMAIN override):** Create a TOML config with `[email]` section containing `mailgun_domain = "toml.domain.com"`. Set `MAILGUN_DOMAIN` env var to `"env.domain.com"`. Call `loadConfig()`. Assert `config.email.mailgun_domain` equals `"env.domain.com"`.
- **agent-email.AC3.3 (TOML preserved when no env var):** Create a TOML config with `[email]` section. Do NOT set env vars. Call `loadConfig()`. Assert TOML values are preserved.

Clean up env vars in `afterEach`: `delete process.env["MAILGUN_API_KEY"]` and `delete process.env["MAILGUN_DOMAIN"]`.

**Verification:**

Run: `bun test src/config/config.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(email): add env var override tests for AC3.3`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->
