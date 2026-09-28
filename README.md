# Constellation

A stateful AI agent daemon with persistent memory, tool use, and sandboxed code execution. Constellation maintains a three-tier memory system (core, working, archival) backed by PostgreSQL with pgvector, runs user-generated code in a Deno sandbox, and exposes an interactive REPL for conversation.

## Install and run

Constellation runs from source. This repository does not provide a separate end-user installer. Follow [Developer setup](#developer-setup) to install it.

You need a terminal, PostgreSQL with pgvector, and access to model and embedding services. Hosted providers can require accounts and charge for requests. Local Ollama models do not require an API key. The repository does not declare a supported operating-system list.

After setup:

1. Open your terminal application.
2. Enter the `constellation` folder with `cd constellation` from its parent folder.
3. Start the daemon:

   ```bash
   bun run start
   ```

4. Wait for the `>` prompt in the interactive terminal, also called the REPL.
5. Type a message and press Enter. An agent response confirms that the model connection works.
6. Press Ctrl+C to stop the daemon.

On first run, Constellation seeds core memory blocks from `persona.md`. This step requires a working embedding service.

## Developer setup

### Prerequisites

- [Git](https://git-scm.com/) to clone the source.
- [Bun](https://bun.sh) for dependency installation, execution, and tests. Development dependencies use Bun 1.3 type definitions.
- [Deno](https://deno.land) on `PATH` for sandbox execution and Deno integration tests.
- [Docker Compose](https://docs.docker.com/compose/) for the supplied PostgreSQL 17/pgvector service, or an existing PostgreSQL service with pgvector.
- A model provider: Anthropic, an OpenAI-compatible endpoint, Ollama, or OpenRouter.
- An embedding provider: Ollama or an OpenAI-compatible embedding API.

The manifest does not enforce minimum Bun or Deno versions. `bun install` installs TypeScript from the declared `^5.7.0` range.

### Set up the source and services

1. Copy this repository's clone URL from its hosting page.
2. Clone it with `git clone` followed by that URL.
3. Enter the cloned folder:

   ```bash
   cd constellation
   ```

4. Install dependencies:

   ```bash
   bun install
   ```

5. Create the local configuration:

   ```bash
   cp config.toml.example config.toml
   ```

6. Edit `[model]` in `config.toml` with your provider and an available model name.
7. Edit `[embedding]` with your service endpoint, installed model, and matching output dimensions. Replace the example's non-local endpoint.
8. Set credentials through the environment variables in the table below. Bun also reads a local `.env` file.
9. If you use the supplied database, start it:

   ```bash
   docker compose up -d --wait
   ```

10. If you use another database, set `DATABASE_URL` to its connection URL.
11. Apply migrations to the configured database:

    ```bash
    bun run migrate
    ```

12. Create the default sandbox folder with `mkdir -p workspace`. If you changed `runtime.working_dir`, create that folder instead.
13. Start the daemon with `bun run start`. Wait for the `>` prompt.

Review `config.toml` before starting. Enabled integrations can contact external services and modify stored data.

### Configuration

Constellation reads `config.toml` at the project root. See [config.toml.example](config.toml.example) for available settings.

| Variable | Overrides | When needed |
|---|---|---|
| `ANTHROPIC_API_KEY` | `model.api_key` for Anthropic | When using Anthropic |
| `OPENAI_COMPAT_API_KEY` | `model.api_key` for openai-compat | When the endpoint requires authentication |
| `OPENROUTER_API_KEY` | `model.api_key` for OpenRouter | When using OpenRouter |
| `EMBEDDING_API_KEY` | `embedding.api_key` | When the embedding endpoint requires authentication |
| `DATABASE_URL` | `database.url` | When not using the example's local database settings |

Environment variables override the corresponding TOML values. Ollama does not require a model API key.

Git ignores `.env` and `config.toml`. Keep credentials out of tracked files. On Unix-like systems, restrict local configuration permissions with `chmod 600 .env config.toml` after creating both files.

### Development checks

`bun run build` runs `tsc --noEmit`. It checks Bun-side TypeScript but excludes `src/runtime/deno/`. The manifest has no lint command.

```bash
bun run build
bun test src/memory/manager.test.ts
```

`bun test` runs the full suite. `bun test src/integration/` runs tests in that directory, not every integration test.

**Use an isolated disposable database for database tests.** Tests can create, truncate, and drop tables. Check each test's database configuration before running it. Deno integration tests require real Deno subprocesses.

Planning documents live in [docs/design-plans](docs/design-plans/), [docs/implementation-plans](docs/implementation-plans/), and [docs/test-plans](docs/test-plans/). Plans describe intent, not proof of completed features.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Model      │     │   Embedding   │     │  Persistence  │
│  (provider    │     │  (OpenAI/     │     │  (PostgreSQL   │
│   adapters)   │     │   Ollama)     │     │   + pgvector)  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └──────────┬─────────┴────────────────────┘
                  │
           ┌──────┴───────┐
           │    Agent      │  ← tool loop + context management
           └──────┬───────┘
                  │
      ┌───────────┼───────────┐
      │           │           │
┌─────┴─────┐ ┌──┴──┐ ┌──────┴──────┐
│  Memory    │ │Tool │ │  Runtime     │
│ (3-tier)   │ │Reg. │ │ (Deno IPC)   │
└───────────┘ └─────┘ └─────────────┘
```

Each module defines port interfaces in `types.ts` with swappable adapters. The composition root in `src/index.ts` wires everything together.

### Memory tiers

| Tier | Description | Behaviour |
|---|---|---|
| **Core** | Identity, persona, system instructions | Always in context. Familiar-permission blocks require user approval to modify. |
| **Working** | Active conversation context | Swapped in/out as needed. The agent manages this tier. |
| **Archival** | Long-term storage | Semantic search via pgvector embeddings. Capacity depends on database resources. |

### Sandboxed code execution

The agent can write and execute TypeScript code in a Deno subprocess. In restricted mode, configuration controls these permissions:

- Network access through `allowed_hosts`.
- File access through `working_dir`, `allowed_read_paths`, and `allowed_write_paths`.
- Subprocess access through `allowed_run`.

`runtime.unrestricted` disables the Deno permission restrictions. Do not enable it for untrusted code.

The executor applies timeout and output limits. Tool calls reach the host through JSON-line IPC.

### Project structure

```
src/
├── config/        # TOML config loading, Zod schemas
├── persistence/   # PostgreSQL adapter, migrations
├── model/         # LLM providers (Anthropic, OpenAI-compat, Ollama, OpenRouter)
├── embedding/     # Embedding provider port (OpenAI, Ollama)
├── memory/        # Three-tier memory system
├── tool/          # Tool registry, built-in tools
├── runtime/       # Deno sandbox executor + IPC bridge
│   └── deno/      # Deno-side runtime (excluded from tsconfig)
├── agent/         # Agent loop, context building
├── extensions/    # Extension interfaces (DataSource, Coordinator, etc.)
├── integration/   # Integration tests
└── index.ts       # Entry point, composition root, REPL
```

## Licence

Private.
