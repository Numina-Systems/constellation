# Agent Email Tool Implementation Plan — Phase 2

**Goal:** Implement the Mailgun sender factory that creates a `SendEmailFn` closure.

**Architecture:** `createMailgunSender(apiKey, domain, fromAddress)` factory returns a `SendEmailFn` closure. The closure captures the Mailgun client at construction time and never throws — all errors are captured in a `SendResult` discriminated union. Bun provides native `FormData`, so only `mailgun.js` is needed (not `form-data`).

**Tech Stack:** TypeScript, mailgun.js, Bun

**Scope:** 3 phases from original design (phases 1-3)

**Codebase verified:** 2026-03-02

---

## Acceptance Criteria Coverage

This phase implements and tests:

### agent-email.AC1: Sender delivers email via Mailgun
- **agent-email.AC1.1 Success:** Sender sends text email and returns `SendResult` with `success: true` and `messageId`
- **agent-email.AC1.2 Success:** Sender sends HTML email (format `html`) and Mailgun receives `html` field instead of `text`
- **agent-email.AC1.3 Failure:** Sender returns `{ success: false, error }` when Mailgun API responds with non-2xx status
- **agent-email.AC1.4 Failure:** Sender returns `{ success: false, error }` when Mailgun request throws (network error, timeout)

---

<!-- START_TASK_1 -->
### Task 1: Install mailgun.js dependency

**Files:**
- Modify: `package.json` (add mailgun.js dependency)

**Step 1: Install the dependency**

Run: `bun add mailgun.js`
Expected: Package installs successfully, `package.json` updated

**Step 2: Verify operationally**

Run: `bun run build`
Expected: Type-check succeeds

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add mailgun.js dependency"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: Implement createMailgunSender factory

**Files:**
- Create: `src/email/sender.ts`
- Modify: `src/email/index.ts` (add sender export)

**Implementation:**

Create `src/email/sender.ts`. The file begins with `// pattern: Imperative Shell`. The factory takes `apiKey`, `domain`, and `fromAddress` as arguments, instantiates the Mailgun client using Bun's native `FormData`, and returns a `SendEmailFn` closure.

The Mailgun client is created via:
```typescript
// pattern: Imperative Shell
import Mailgun from "mailgun.js";

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({ username: "api", key: apiKey });
```

The returned closure calls `mg.messages.create(domain, messageData)` where `messageData` includes:
- `from`: the configured `fromAddress`
- `to`: the recipient
- `subject`: the email subject
- `text` or `html`: the body, depending on the `format` parameter

On success, `mg.messages.create()` returns `{ id, message }`. Extract `id` and return `{ success: true, messageId: id }`.

On error, catch the thrown error and return `{ success: false, error: error.message }`. Never throw.

Update `src/email/index.ts` to export `createMailgunSender`.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat(email): implement Mailgun sender factory`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Sender tests

**Verifies:** agent-email.AC1.1, agent-email.AC1.2, agent-email.AC1.3, agent-email.AC1.4

**Files:**
- Create: `src/email/sender.test.ts`

**Testing:**

The sender wraps the Mailgun SDK. To test it without making real HTTP calls, `createMailgunSender` accepts an optional fourth parameter: a `messages` object with a `create(domain, data)` method matching the `mg.messages` interface. When provided, skip Mailgun client construction and use the injected `messages` object directly. When omitted, create the real Mailgun client as default. This follows the existing dependency injection pattern used throughout the codebase.

Tests must verify each AC listed above:

- **agent-email.AC1.1:** Call sender with `format: "text"`, mock returns `{ id: "<msg-id>", message: "Queued" }`. Assert result is `{ success: true, messageId: "<msg-id>" }`. Assert mock received `text` field (not `html`).
- **agent-email.AC1.2:** Call sender with `format: "html"`, mock returns `{ id: "<msg-id>", message: "Queued" }`. Assert result is `{ success: true, messageId: "<msg-id>" }`. Assert mock received `html` field (not `text`).
- **agent-email.AC1.3:** Mock throws an error with `statusCode: 401` and `message: "Forbidden"`. Assert result is `{ success: false, error }` containing the error message. Assert the function does not throw.
- **agent-email.AC1.4:** Mock throws a generic `Error("ECONNREFUSED")` (no statusCode). Assert result is `{ success: false, error }` containing the error message. Assert the function does not throw.

Follow existing test patterns:
- Import from `bun:test`: `describe`, `it`, `expect`
- Name describe blocks after AC identifiers (e.g., `"agent-email.AC1.1: Sender sends text email"`)
- Use factory function for mock `messages.create`
- File annotated with `// pattern: Imperative Shell`

**Verification:**

Run: `bun test src/email/sender.test.ts`
Expected: All tests pass

**Commit:** `test(email): add sender tests for AC1.1-AC1.4`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
