# KDL Persona Configuration Design

## Summary

Constellation uses TOML+Zod for all configuration. For flat key-value settings this works well, but hierarchical capability policies — per-agent tool permissions, effect gating, approval rules — don't map naturally to TOML's flat structure. Pattern (a sibling Rust project) uses KDL for persona and capability configuration with layered precedence. This design adds KDL as an optional, additive format for persona definitions only, not replacing TOML for general configuration.

**Priority:** Low. Only relevant if Constellation grows to support multiple agent personas with distinct capability sets.

## Definition of Done

1. **KDL parser integration** — a TypeScript KDL library parses persona files; Zod validation runs on the parsed result.
2. **Persona file schema** — defined format covering name, description, system prompt additions, tool allowlist/denylist, approval-required tools, and custom flags.
3. **Precedence layer** — TOML defaults < KDL persona file < runtime overrides; merge is explicit and auditable.
4. **Persona loader** — `createPersonaLoader()` factory reads from a configurable `personas/` directory and returns a validated `Persona` type.
5. **Composition root hook** — persona is optionally loaded at startup and passed into the agent; no change if no persona file is present.

**Out of scope:**
- UI for selecting personas at runtime
- Persona hot-reload without restart
- Replacing TOML for any existing configuration

## Acceptance Criteria

### kdl-persona.AC1: Parsing & Validation
- **kdl-persona.AC1.1 Success:** A valid KDL persona file parses and produces a `Persona` value
- **kdl-persona.AC1.2 Failure:** A KDL file with an invalid structure produces a descriptive Zod validation error, not a raw parse crash
- **kdl-persona.AC1.3 Edge:** Unknown KDL nodes are ignored (forward-compatible parsing)
- **kdl-persona.AC1.4 Success:** A persona file with only `name` and `description` (minimal valid config) succeeds

### kdl-persona.AC2: Capability Policy
- **kdl-persona.AC2.1 Success:** `tools allow` list restricts the active tool set to named tools only
- **kdl-persona.AC2.2 Success:** `tools deny` list removes named tools from the active set even if globally registered
- **kdl-persona.AC2.3 Success:** `tools require-approval` list causes named tools to surface for confirmation before execution
- **kdl-persona.AC2.4 Edge:** Allow and deny for the same tool name is a validation error

### kdl-persona.AC3: Precedence
- **kdl-persona.AC3.1 Success:** A value present in the persona file overrides the equivalent TOML default
- **kdl-persona.AC3.2 Success:** A runtime override (env var or flag) takes precedence over the persona file value
- **kdl-persona.AC3.3 Edge:** Absent persona file leaves all TOML defaults in effect; daemon starts normally

### kdl-persona.AC4: Wiring
- **kdl-persona.AC4.1 Success:** `personas/` directory path is configurable in `config.toml`; defaults to `./personas`
- **kdl-persona.AC4.2 Success:** Daemon starts without error when no persona file is present
- **kdl-persona.AC4.3 Success:** `bun run build` passes with no new type errors after integration

## Architecture

```
config.toml (defaults)
    ↓ merge
personas/<name>.kdl (parsed + Zod-validated)
    ↓ merge
Runtime overrides (env vars / startup flags)
    ↓
Persona value → AgentDependencies
```

**New files:**
- `src/config/persona-types.ts` — `Persona`, `CapabilityPolicy`, `PersonaLoader` port types (Functional Core)
- `src/config/kdl-persona-loader.ts` — `createPersonaLoader(config)` factory; KDL parse → Zod validate → merge (Imperative Shell)
- `src/config/index.ts` — extend barrel export

**Key types:**
```typescript
type CapabilityPolicy = {
  readonly allow: ReadonlyArray<string> | 'all';
  readonly deny: ReadonlyArray<string>;
  readonly requireApproval: ReadonlyArray<string>;
};

type Persona = {
  readonly name: string;
  readonly description: string;
  readonly systemPromptAddition: string | null;
  readonly capabilities: CapabilityPolicy;
  readonly flags: Readonly<Record<string, string | boolean | number>>;
};

type PersonaLoader = {
  load(name: string): Promise<Persona | null>;
};
```

## Implementation Phases

### Phase 1: Types & Schema
**Goal:** Define `Persona` types and Zod schema without any KDL dependency yet.

**Components:**
- `src/config/persona-types.ts` — types above
- `src/config/persona-schema.ts` — Zod schemas for all persona fields

**Done when:** Types compile, `bun run build` passes.

### Phase 2: KDL Loader
**Goal:** Parse KDL persona files and validate against Zod schema.

**Components:**
- `src/config/kdl-persona-loader.ts` — `createPersonaLoader(baseDir)` reads `<name>.kdl`, parses with KDL library, runs Zod validation, returns `Persona | null`

**Done when:** Tests cover valid file, invalid schema, unknown nodes ignored, missing file returns null. Covers `kdl-persona.AC1.*`, `kdl-persona.AC2.*`.

### Phase 3: Precedence Merge & Composition Root
**Goal:** Integrate persona into startup with correct precedence.

**Components:**
- `src/config/merge-persona.ts` — pure function merging TOML config + persona + runtime overrides
- `src/index.ts` — optionally load persona, apply capability policy to tool registry before agent construction

**Done when:** Daemon starts with and without a persona file; tool filtering works end-to-end. Covers `kdl-persona.AC3.*`, `kdl-persona.AC4.*`.

## Additional Considerations

**KDL library choice:** `kdljs` is the most maintained TypeScript KDL parser as of this writing. Pin to a specific minor version and evaluate alternatives at implementation time.

**Approval gate:** The `requireApproval` capability requires a mechanism for confirmation — currently absent from the agent loop. A minimal implementation could log a warning and proceed; full interactive approval is deferred.
