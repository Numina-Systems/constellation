# Agent Email Tool — Human Test Plan

## Prerequisites

- Mailgun sandbox domain with API key
- At least one sandbox-verified recipient email address
- `config.toml` with `[email]` section configured
- All automated tests passing: `bun test src/email/ src/config/config.test.ts`

## Phase 1: End-to-End Email Delivery (AC1.1, AC1.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add a `[email]` section to `config.toml` with Mailgun sandbox credentials: `mailgun_api_key`, `mailgun_domain`, `from_address`, and `allowed_recipients` containing a sandbox-verified address | Config file saved without errors |
| 2 | Start the agent with `bun run start` | Agent starts, logs show "email tools registered", no config errors |
| 3 | In the agent REPL, issue a `send_email` tool call: `to` = the sandbox-verified recipient, `subject` = "Text test", `body` = "Plain text body", `format` = "text" | Agent returns a successful tool result containing a Mailgun message ID (format: `<timestamp.hex@domain>`) |
| 4 | Open the Mailgun dashboard, navigate to Logs for the sandbox domain | The message appears with `delivered` status. Content-Type is `text/plain`. |
| 5 | Check the recipient's inbox (or Mailgun's "Delivered" events) | Email received with subject "Text test" and plain text body |
| 6 | Issue another `send_email` tool call: same recipient, `subject` = "HTML test", `body` = `<h1>Hello</h1><p>HTML body</p>`, `format` = "html" | Agent returns a successful tool result with a Mailgun message ID |
| 7 | Check Mailgun dashboard and recipient inbox | Message delivered. Content-Type is `text/html`. HTML renders correctly. |

## Phase 2: Conditional Registration in Composition Root (AC3.1, AC3.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Remove the `[email]` section from `config.toml` entirely (or comment it out) | Config file has no email section |
| 2 | Start the agent with `bun run start` | Agent starts normally. No "email tools registered" log. No errors about missing email config. |
| 3 | Attempt to invoke `send_email` via the agent (e.g., ask the agent to send an email) | The agent does not have `send_email` in its tool list. It should indicate the tool is unavailable or not attempt to use it. |
| 4 | Add a valid `[email]` section back to `config.toml` with Mailgun credentials and at least one `allowed_recipients` entry | Config file saved |
| 5 | Restart the agent with `bun run start` | Agent starts, logs show "email tools registered". `send_email` appears in the available tool definitions. |
| 6 | Issue a `send_email` tool call to the allowed recipient | Sends successfully, returns messageId |

## Phase 3: Allowlist Enforcement (Live)

| Step | Action | Expected |
|------|--------|----------|
| 1 | With the `[email]` section configured and agent running, issue a `send_email` tool call with a `to` address that is NOT in `allowed_recipients` | Tool returns a failure result containing "not in allowlist". No email sent. |
| 2 | Verify in Mailgun dashboard | No send attempt logged for the disallowed address |

## End-to-End: Agent Initiates Email from Conversation

**Purpose:** Validates the full path from agent decision to email delivery — the agent interprets a user request, selects the `send_email` tool, provides correct parameters, and the email arrives.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Configure `config.toml` with a valid `[email]` section. Start the agent. | Agent running with email tools registered |
| 2 | In the REPL, give the agent a natural language instruction: "Send an email to [allowed-recipient] with the subject 'Weekly Summary' and a brief summary of what you know about me" | Agent selects `send_email` tool, provides `to`, `subject`, `body` parameters. Format defaults to "text". |
| 3 | Observe the tool result in the REPL | Shows `success: true` with a Mailgun message ID |
| 4 | Check recipient inbox | Email arrives with subject "Weekly Summary" and agent-generated body content |
| 5 | Ask the agent to send an HTML email: "Send a nicely formatted HTML email to [allowed-recipient] about today's date" | Agent uses `format: "html"`, generates HTML body |
| 6 | Check recipient inbox | HTML email renders with formatting |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 — Text email | `sender.test.ts` — AC1.1 | Phase 1, Steps 3-5 |
| AC1.2 — HTML email | `sender.test.ts` — AC1.2 | Phase 1, Steps 6-7 |
| AC1.3 — API error handling | `sender.test.ts` — AC1.3 | — |
| AC1.4 — Network error handling | `sender.test.ts` — AC1.4 | — |
| AC2.1 — Allowed recipient send | `tools.test.ts` — AC2.1 | End-to-End, Steps 2-4 |
| AC2.2 — Default format | `tools.test.ts` — AC2.2 | End-to-End, Step 2 |
| AC2.3 — Disallowed recipient | `tools.test.ts` — AC2.3 | Phase 3, Steps 1-2 |
| AC2.4 — Sender failure propagation | `tools.test.ts` — AC2.4 | — |
| AC3.1 — Tool in registry | `registration.test.ts` — AC3.1 + IPC stub | Phase 2, Steps 5-6 |
| AC3.2 — Tool absent from registry | `registration.test.ts` — AC3.2 | Phase 2, Steps 1-3 |
| AC3.3 — Env var overrides | `config.test.ts` — AC3.3 (4 tests) | — |
