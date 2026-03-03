# Agent Email Tool Implementation Plan — Phase 3

**Goal:** Wire `send_email` as a `Tool` with recipient allowlist validation and register it conditionally in the composition root.

**Architecture:** `createEmailTools(options)` factory returns an array containing the `send_email` tool. The handler validates the recipient against a configured allowlist before delegating to the `SendEmailFn` closure from Phase 2. Registration in `src/index.ts` follows the existing `config.web` gating pattern. IPC stubs are generated automatically by `registry.generateStubs()`.

**Note:** The design lists `src/tool/index.ts` as a component for this phase. Email tools are imported directly from `@/email` in the composition root, not re-exported through the tool module, so no changes to `src/tool/index.ts` are needed.

**Tech Stack:** TypeScript, Bun

**Scope:** 3 phases from original design (phases 1-3)

**Codebase verified:** 2026-03-02

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-email.AC2: Tool validates recipients and dispatches send
- **agent-email.AC2.1 Success:** `send_email` with allowed recipient calls sender and returns `ToolResult` with success output including messageId
- **agent-email.AC2.2 Success:** `send_email` defaults format to `text` when not specified
- **agent-email.AC2.3 Failure:** `send_email` with recipient not in allowlist returns `ToolResult` with `success: false` and "not in allowlist" error without calling sender
- **agent-email.AC2.4 Failure:** `send_email` propagates sender failure as `ToolResult` with `success: false`

### agent-email.AC3: Configuration and registration
- **agent-email.AC3.1 Success:** `send_email` appears in `registry.getDefinitions()` when `[email]` config section exists
- **agent-email.AC3.2 Success:** `send_email` is absent from registry when `[email]` config section is omitted

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Implement createEmailTools factory

**Verifies:** agent-email.AC2.1, agent-email.AC2.2, agent-email.AC2.3, agent-email.AC2.4

**Files:**
- Create: `src/email/tools.ts`
- Modify: `src/email/index.ts` (add tools export)

**Implementation:**

Create `src/email/tools.ts` as an Imperative Shell file. Define a `EmailToolOptions` type:

```typescript
type EmailToolOptions = {
  readonly sender: SendEmailFn;
  readonly allowedRecipients: ReadonlyArray<string>;
};
```

Implement `createEmailTools(options: EmailToolOptions): Array<Tool>` that returns an array containing a single `send_email` tool.

The tool definition has these parameters:
- `to` (string, required) — recipient email address
- `subject` (string, required) — email subject
- `body` (string, required) — email body
- `format` (string, optional, enum: `["text", "html"]`) — body format, defaults to `"text"`

The handler:
1. Extracts params: `to`, `subject`, `body`, `format` (defaulting to `"text"`)
2. Checks if `to` is in `allowedRecipients` — if not, returns `{ success: false, output: "", error: "recipient <to> not in allowlist" }`
3. Inside a try/catch, calls `sender(to, subject, body, format)`
4. On sender success (`result.success === true`): returns `{ success: true, output: "Email sent (messageId: <id>)" }`
5. On sender failure (`result.success === false`): returns `{ success: false, output: "", error: "send_email failed: <error>" }`
6. On unexpected throw (catch branch): returns `{ success: false, output: "", error: "send_email failed: <error.message>" }`

Wrap the `sender()` call in try/catch as defense-in-depth, matching the `createWebTools` pattern from `src/tool/builtin/web.ts:44-61`. Even though `SendEmailFn` never throws by contract, the handler should handle unexpected errors gracefully. Factory takes options, returns `Array<Tool>`, handler never throws.

Import `Tool` from `@/tool/types.ts` and `SendEmailFn` from `./types.ts`.

Update `src/email/index.ts` to export `createEmailTools`.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat(email): implement send_email tool with allowlist`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tool handler tests

**Verifies:** agent-email.AC2.1, agent-email.AC2.2, agent-email.AC2.3, agent-email.AC2.4

**Files:**
- Create: `src/email/tools.test.ts`

**Testing:**

Tests must verify each AC listed above. Inject a mock `SendEmailFn` via the options — this follows the existing DI pattern (no need to mock Mailgun here, the sender is already a closure).

Create a mock sender factory that tracks calls:

```typescript
function createMockSender(result: SendResult): SendEmailFn & { calls: Array<{ to: string; subject: string; body: string; format: string }> } {
  const sender = async (to, subject, body, format) => {
    sender.calls.push({ to, subject, body, format });
    return result;
  };
  sender.calls = [];
  return sender;
}
```

Test cases:

- **agent-email.AC2.1:** Create tools with mock sender returning `{ success: true, messageId: "<msg-id>" }`, call handler with `to` in allowlist. Assert `ToolResult` has `success: true` and output contains `messageId`. Assert mock sender was called once with correct args.
- **agent-email.AC2.2:** Call handler without `format` parameter. Assert mock sender received `format: "text"` as default.
- **agent-email.AC2.3:** Call handler with `to` NOT in allowlist. Assert `ToolResult` has `success: false` and error contains "not in allowlist". Assert mock sender was NOT called (0 calls).
- **agent-email.AC2.4:** Create tools with mock sender returning `{ success: false, error: "connection refused" }`, call handler with `to` in allowlist. Assert `ToolResult` has `success: false` and error contains the sender error message.

Follow existing test patterns:
- Import from `bun:test`: `describe`, `it`, `expect`
- Name describe blocks after AC identifiers
- File annotated with `// pattern: Imperative Shell`

**Verification:**

Run: `bun test src/email/tools.test.ts`
Expected: All tests pass

**Commit:** `test(email): add tool handler tests for AC2.1-AC2.4`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Conditional registration in composition root

**Verifies:** agent-email.AC3.1, agent-email.AC3.2

**Files:**
- Modify: `src/index.ts:458` (add conditional email registration after web tools block)

**Implementation:**

Add a conditional registration block after the web tools block (after line 458 in `src/index.ts`), following the exact pattern of the `config.web` block:

```typescript
if (config.email) {
  const sender = createMailgunSender(
    config.email.mailgun_api_key,
    config.email.mailgun_domain,
    config.email.from_address,
  );
  const emailTools = createEmailTools({
    sender,
    allowedRecipients: config.email.allowed_recipients,
  });
  for (const tool of emailTools) {
    registry.register(tool);
  }
  console.log("email tools registered");
}
```

Add imports at the top of `src/index.ts`:
- `import { createMailgunSender, createEmailTools } from "@/email";`

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

Run: `bun test`
Expected: All existing tests pass (email section is optional, absent configs are unaffected)

**Commit:** `feat(email): add conditional email tool registration`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Registration tests

**Verifies:** agent-email.AC3.1, agent-email.AC3.2

**Files:**
- Create: `src/email/registration.test.ts`

**Testing:**

Tests verify conditional registration by creating a `ToolRegistry`, calling `createEmailTools`, and checking `getDefinitions()`.

- **agent-email.AC3.1:** Create `createEmailTools` with valid options, register all returned tools. Assert `registry.getDefinitions()` includes a tool named `send_email`. Assert the definition has the expected parameters (`to`, `subject`, `body`, `format`).
- **agent-email.AC3.2:** Create a registry without registering email tools. Assert `registry.getDefinitions()` does not include `send_email`. (This is essentially testing that not calling `register` means the tool is absent — straightforward but explicitly validates the conditional pattern.)
- **IPC stub generation:** Register `send_email`, call `registry.generateStubs()`, assert the returned string contains `async function send_email` with correct parameter signature. This verifies the tool is available from the Deno sandbox via IPC bridge.

Follow existing test patterns from `src/tool/registry.test.ts`.

**Verification:**

Run: `bun test src/email/registration.test.ts`
Expected: All tests pass

Run: `bun test`
Expected: All tests pass (full suite)

**Commit:** `test(email): add registration tests for AC3.1-AC3.2`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
