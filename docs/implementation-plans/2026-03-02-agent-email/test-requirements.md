# Agent Email Tool -- Test Requirements

Maps each acceptance criterion from the [design plan](../../../docs/design-plans/2026-03-02-agent-email.md) to specific automated tests. Organized by AC group, then by individual criterion.

---

## AC1: Sender delivers email via Mailgun

All AC1 tests are **unit tests** exercising the `createMailgunSender` factory with an injected mock `messages` object (no real HTTP calls). The mock replaces the Mailgun SDK's `mg.messages.create()` method.

| AC | Description | Test Type | Test File | Verifies |
|----|-------------|-----------|-----------|----------|
| AC1.1 | Sender sends text email successfully | Unit | `src/email/sender.test.ts` | Calling sender with `format: "text"` returns `{ success: true, messageId }`. Mock receives `text` field (not `html`). |
| AC1.2 | Sender sends HTML email successfully | Unit | `src/email/sender.test.ts` | Calling sender with `format: "html"` returns `{ success: true, messageId }`. Mock receives `html` field (not `text`). |
| AC1.3 | Sender handles Mailgun API error (non-2xx) | Unit | `src/email/sender.test.ts` | Mock throws error with `statusCode: 401`. Sender returns `{ success: false, error }` containing the error message. Function does not throw. |
| AC1.4 | Sender handles network/timeout error | Unit | `src/email/sender.test.ts` | Mock throws generic `Error("ECONNREFUSED")`. Sender returns `{ success: false, error }` containing the error message. Function does not throw. |

---

## AC2: Tool validates recipients and dispatches send

All AC2 tests are **unit tests** exercising the `createEmailTools` tool handler with an injected mock `SendEmailFn`. No Mailgun SDK involvement -- the mock sender is a plain function that tracks calls and returns a preconfigured `SendResult`.

| AC | Description | Test Type | Test File | Verifies |
|----|-------------|-----------|-----------|----------|
| AC2.1 | Allowed recipient triggers send, returns success ToolResult | Unit | `src/email/tools.test.ts` | Handler called with `to` in allowlist. Mock sender returns `{ success: true, messageId: "<id>" }`. Assert `ToolResult` has `success: true` and output contains the messageId. Assert mock sender was called exactly once with correct args. |
| AC2.2 | Format defaults to "text" when omitted | Unit | `src/email/tools.test.ts` | Handler called without `format` parameter. Assert mock sender received `format: "text"`. |
| AC2.3 | Disallowed recipient is rejected without calling sender | Unit | `src/email/tools.test.ts` | Handler called with `to` NOT in allowlist. Assert `ToolResult` has `success: false` and error contains "not in allowlist". Assert mock sender was NOT called (0 invocations). |
| AC2.4 | Sender failure propagated as failed ToolResult | Unit | `src/email/tools.test.ts` | Mock sender returns `{ success: false, error: "connection refused" }`. Assert `ToolResult` has `success: false` and error contains the sender error message. |

---

## AC3: Configuration and registration

AC3 tests span two files: config override tests in the existing config test file, and registration tests in a dedicated file.

| AC | Description | Test Type | Test File | Verifies |
|----|-------------|-----------|-----------|----------|
| AC3.1 | `send_email` present in registry when config exists | Unit | `src/email/registration.test.ts` | Create `ToolRegistry`, register tools from `createEmailTools(...)`. Assert `registry.getDefinitions()` includes a tool named `send_email` with expected parameters (`to`, `subject`, `body`, `format`). |
| AC3.2 | `send_email` absent from registry when config omitted | Unit | `src/email/registration.test.ts` | Create `ToolRegistry` without registering email tools. Assert `registry.getDefinitions()` does not include `send_email`. |
| AC3.3 | Env vars override config.toml values | Unit | `src/config/config.test.ts` | Three sub-cases: (a) `MAILGUN_API_KEY` env var overrides `mailgun_api_key` from TOML. (b) `MAILGUN_DOMAIN` env var overrides `mailgun_domain` from TOML. (c) TOML values preserved when no env vars are set. Cleanup in `afterEach`. |

### AC3 supplementary: IPC stub generation

| AC | Description | Test Type | Test File | Verifies |
|----|-------------|-----------|-----------|----------|
| AC3.1 (supplementary) | IPC stubs generated for Deno bridge | Unit | `src/email/registration.test.ts` | Register `send_email`, call `registry.generateStubs()`. Assert returned string contains `async function send_email` with correct parameter signature. |

---

## Criteria requiring manual verification

### End-to-end delivery via real Mailgun API

**Criteria affected:** AC1.1, AC1.2 (real delivery path)

**Justification:** All automated tests use a mock Mailgun `messages` object. Verifying that `createMailgunSender` correctly constructs the real Mailgun SDK client (`new Mailgun(FormData)`, `mailgun.client(...)`, `mg.messages.create(...)`) and that the SDK actually delivers mail requires a live Mailgun sandbox domain and real API credentials. This is a classic integration boundary that mocks cannot fully cover.

**Manual verification approach:**
1. Configure a Mailgun sandbox domain in `config.toml` under `[email]`
2. Add a sandbox-verified recipient to `allowed_recipients`
3. Start the agent (`bun run start`) and issue a `send_email` tool call
4. Confirm delivery in the Mailgun dashboard (message appears in logs with `delivered` status)
5. Confirm the recipient receives the email
6. Repeat with `format: "html"` to verify HTML path

### Conditional registration in production composition root

**Criteria affected:** AC3.1, AC3.2 (composition root wiring)

**Justification:** The unit tests in `registration.test.ts` verify that `createEmailTools` produces registrable tools and that an empty registry lacks them. They do not test the actual conditional block in `src/index.ts`. Verifying it actually works end-to-end is simpler and more valuable as a manual smoke test.

**Manual verification approach:**
1. Start with a `config.toml` that has NO `[email]` section. Start the agent. Confirm `send_email` does not appear in the tool list
2. Add an `[email]` section with valid Mailgun credentials. Restart. Confirm `send_email` appears and "email tools registered" is logged
3. Confirm the agent can invoke `send_email` successfully

---

## Summary

| Test File | AC Coverage | Test Count |
|-----------|-------------|------------|
| `src/email/sender.test.ts` | AC1.1, AC1.2, AC1.3, AC1.4 | 4 |
| `src/email/tools.test.ts` | AC2.1, AC2.2, AC2.3, AC2.4 | 4 |
| `src/email/registration.test.ts` | AC3.1, AC3.2 + IPC stub | 3 |
| `src/config/config.test.ts` | AC3.3 | 3 |
| **Total automated** | | **14** |
| **Manual verification** | AC1.1-1.2 (real delivery), AC3.1-3.2 (composition root) | 2 scenarios |
