# Agent Email Tool Design

## Summary

This feature adds a `send_email` tool to Constellation's agent, giving it the ability to compose and deliver freeform emails via the Mailgun transactional email API. The tool lives in a new `src/email/` module and is conditionally registered — only when an `[email]` config section is present — mirroring how the existing `[web]` section gates search and fetch tools.

The implementation follows Constellation's established patterns throughout: a factory function (`createMailgunSender`) wraps the Mailgun client and returns a typed `SendEmailFn` closure that never throws; the tool handler validates the recipient against a configured allowlist before delegating to that closure; and both layers return discriminated-union result types (`SendResult`, `ToolResult`) rather than relying on exceptions for control flow. Once registered, the tool is available to the agent loop and, via the IPC bridge stub generator, also callable from within the Deno sandbox.

## Definition of Done

The agent gets a `send_email` tool that sends freeform emails via Mailgun to recipients on a configured allowlist. Success means:

- A `src/email/` module exists with sender (Mailgun client factory), tool definitions, and types
- A `send_email` tool is registered when `[email]` config section is present
- The tool validates recipients against an allowlist before sending
- Config supports `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` env var overrides
- Unit tests cover allowlist rejection, success path, and failure path

Out of scope: email templates, receive/read, DB tracking of sent emails.

## Acceptance Criteria

### agent-email.AC1: Sender delivers email via Mailgun
- **agent-email.AC1.1 Success:** Sender sends text email and returns `SendResult` with `success: true` and `messageId`
- **agent-email.AC1.2 Success:** Sender sends HTML email (format `html`) and Mailgun receives `html` field instead of `text`
- **agent-email.AC1.3 Failure:** Sender returns `{ success: false, error }` when Mailgun API responds with non-2xx status
- **agent-email.AC1.4 Failure:** Sender returns `{ success: false, error }` when Mailgun request throws (network error, timeout)

### agent-email.AC2: Tool validates recipients and dispatches send
- **agent-email.AC2.1 Success:** `send_email` with allowed recipient calls sender and returns `ToolResult` with success output including messageId
- **agent-email.AC2.2 Success:** `send_email` defaults format to `text` when not specified
- **agent-email.AC2.3 Failure:** `send_email` with recipient not in allowlist returns `ToolResult` with `success: false` and "not in allowlist" error without calling sender
- **agent-email.AC2.4 Failure:** `send_email` propagates sender failure as `ToolResult` with `success: false`

### agent-email.AC3: Configuration and registration
- **agent-email.AC3.1 Success:** `send_email` appears in `registry.getDefinitions()` when `[email]` config section exists
- **agent-email.AC3.2 Success:** `send_email` is absent from registry when `[email]` config section is omitted
- **agent-email.AC3.3 Success:** `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` environment variables override config.toml values

## Glossary

- **Mailgun**: A transactional email API service. The sender factory wraps its HTTP API to deliver email programmatically.
- **Allowlist**: A configured list of recipient email addresses the agent is permitted to send to. Any address not on the list is rejected before a network call is made.
- **`ToolRegistry`**: The central registry that holds all tools the agent can call. Tools register themselves at startup; the registry handles dispatch, parameter validation, and model-format conversion.
- **`ToolResult`**: The standard return type for all tool handlers — a `{ success, output, error? }` object. Handlers never throw; failures are expressed as `success: false`.
- **`SendResult`**: A discriminated union specific to the email sender — either `{ success: true, messageId }` or `{ success: false, error }`. Mirrors `ToolResult` but is decoupled from the tool layer so the sender can be tested independently.
- **`SendEmailFn`**: A typed function alias for the sender closure returned by `createMailgunSender`. Represents the port the tool calls into.
- **Discriminated union**: A TypeScript pattern where a shared literal field (here `success: true | false`) lets the compiler narrow the type to its exact shape. Used instead of exceptions to model expected failure modes.
- **Factory function**: A plain function (e.g., `createMailgunSender(...)`) that constructs and returns a value implementing an interface. Used throughout the codebase instead of classes.
- **Dependency injection**: Passing dependencies (like the `SendEmailFn`) as arguments to a factory rather than constructing them internally. Enables substituting a mock in tests.
- **IPC bridge / Deno sandbox**: The agent can execute code in an isolated Deno subprocess. The `ToolRegistry` generates TypeScript function stubs that serialise tool calls over an inter-process channel, so sandboxed code can invoke host-side tools without direct access to the host runtime.
- **Conditional registration**: Tools are registered at startup only when their corresponding config section exists. This keeps the agent's tool surface minimal and avoids errors from missing credentials.
- **Functional Core / Imperative Shell**: The architectural pattern used project-wide. Pure functions (the "core") handle data transformation; side-effecting code (the "shell") handles I/O. The email sender and tool handler both live in the imperative shell.
- **Zod**: A TypeScript-first schema validation library. Used here to define and validate the `[email]` config section, with support for environment variable overrides.
- **`AppConfigSchema`**: The top-level Zod schema that describes the entire `config.toml` file. The new `EmailConfigSchema` is added as an optional field on it.
- **Barrel export / `index.ts`**: A module's `index.ts` re-exports its public API, so consumers import from `src/email/` rather than from individual files.

## Architecture

A single `send_email` tool registered in the `ToolRegistry`, backed by a new `src/email/` module following the project's factory-function and dependency-injection patterns.

### Email Sending

`send_email` delegates to a `SendEmailFn` closure created by `createMailgunSender()`. The sender captures Mailgun credentials at construction time and returns a `SendResult` discriminated union (never throws). The tool handler validates the recipient against a configured allowlist before calling the sender.

```typescript
type SendResult =
  | { readonly success: true; readonly messageId: string }
  | { readonly success: false; readonly error: string };

type SendEmailFn = (
  to: string,
  subject: string,
  body: string,
  format: 'text' | 'html',
) => Promise<SendResult>;
```

### Data Flow

```
Agent loop
  └─ send_email(to, subject, body, format?)
       ├─ Validate: to ∈ allowedRecipients?
       │    └─ No → ToolResult { success: false, error: "recipient not in allowlist" }
       └─ Yes → SendEmailFn(to, subject, body, format)
            ├─ Mailgun success → ToolResult { success: true, output: "Email sent (messageId: ...)" }
            └─ Mailgun failure → ToolResult { success: false, error: "send_email failed: ..." }
```

The tool dispatches through the standard `ToolRegistry`. No special-case handling in the agent loop. Also available from the Deno sandbox via IPC bridge stubs generated by `registry.generateStubs()`.

## Existing Patterns

This design follows established patterns from the codebase:

- **Factory functions** — `createMailgunSender(apiKey, domain, fromAddress)` and `createEmailTools(options)` follow the `createWebTools()`, `createMemoryTools()` pattern. No classes.
- **Dependency injection** — Sender function injected into tool factory via options object, same as `SearchFn` injected into web tools. Enables testing with mock sender.
- **Never-throw handlers** — Tool handlers return `ToolResult`, sender returns `SendResult`. Errors captured in result fields, never thrown. Matches all existing tools.
- **Conditional registration** — Tools registered only when `[email]` config section exists, same as `[web]` gating web tools.
- **Config schema** — New `EmailConfigSchema` added to `AppConfigSchema` with Zod validation and env var overrides, following the existing pattern in `src/config/config.ts`.
- **Horizon-scan alignment** — Sender factory and `SendResult` type mirror `src/digest/sender.ts` in the horizon-scan project, keeping email patterns consistent across the codebase.

No divergence from existing patterns. The `src/email/` module structure mirrors `src/web/` but is simpler (no port interface needed — single provider, not a chain).

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Types, Config, and Module Scaffold
**Goal:** Establish the `src/email/` module structure, types, config schema, and environment variable overrides.

**Components:**
- `src/email/types.ts` — `SendResult`, `SendEmailFn` types
- `src/email/index.ts` — Barrel exports
- `src/config/schema.ts` — `EmailConfigSchema` added to `AppConfigSchema` (optional section)
- `src/config/config.ts` — Environment variable overrides for `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`

**Dependencies:** None (first phase)

**Done when:** `bun run build` succeeds with new types and config schema. Config loads with and without `[email]` section.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Mailgun Sender
**Goal:** Mailgun client factory that creates a `SendEmailFn` closure.

**Components:**
- `src/email/sender.ts` — `createMailgunSender(apiKey, domain, fromAddress)` factory returning `SendEmailFn`
- New dependencies: `mailgun.js`, `form-data`

**Dependencies:** Phase 1 (types)

**Covers:** agent-email.AC1.1–AC1.4

**Done when:** Sender creates Mailgun client, sends email via API, returns `SendResult` with messageId on success or error string on failure. Tests pass with mocked Mailgun client.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Tool Definition, Registration, and Allowlist
**Goal:** Wire `send_email` as a `Tool` object with recipient allowlist validation and register in composition root.

**Components:**
- `src/email/tools.ts` — `createEmailTools(options)` factory returning `[send_email]` tool with allowlist enforcement
- `src/email/index.ts` — Updated exports
- `src/tool/index.ts` — Updated exports
- `src/index.ts` — Conditional registration when `config.email` exists

**Dependencies:** Phase 2 (sender)

**Covers:** agent-email.AC2.1–AC2.4, agent-email.AC3.1–AC3.2

**Done when:** Tool appears in `registry.getDefinitions()` when email config is present, absent when not. Handler rejects recipients not in allowlist. Handler delegates to sender and returns `ToolResult`. IPC stubs generated for Deno bridge. Tests pass.
<!-- END_PHASE_3 -->

## Additional Considerations

**Allowlist as safety rail:** The allowlist is the primary guard against the agent sending emails to unintended recipients. The agent sees a clear error when a recipient is rejected, so it can explain the constraint rather than silently failing.

**No retry logic:** If Mailgun fails, the error is returned to the agent. The agent can decide whether to retry or inform the user. Adding automatic retries would obscure failures and complicate the handler.
