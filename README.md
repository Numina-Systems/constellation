# Constellation

A stateful AI agent daemon with persistent memory, tool use, and sandboxed code execution. Constellation maintains a three-tier memory system (core, working, archival) backed by PostgreSQL with pgvector, runs user-generated code in a Deno sandbox, and exposes an interactive REPL for conversation.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Deno](https://deno.land) >= 2.6
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL)
- An [Anthropic API key](https://console.anthropic.com/) (or an OpenAI-compatible endpoint)
- An embedding provider — either [Ollama](https://ollama.com) running `nomic-embed-text`, or an OpenAI-compatible embedding API

## Quick Start

```bash
# 1. Clone and install dependencies
git clone <repo-url> && cd constellation
bun install

# 2. Start PostgreSQL with pgvector
docker compose up -d

# 3. Set your API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 4. Run database migrations
bun run migrate

# 5. Start the daemon
bun run start
```

On first run, Constellation seeds core memory blocks from `persona.md` and drops you into a REPL. Type a message and press enter.

## Configuration

Constellation reads `config.toml` at the project root. Environment variables override config values for secrets.

### config.toml

```toml
[agent]
max_tool_rounds = 20        # max LLM tool-use rounds per message
context_budget = 0.8         # fraction of context window to use

[model]
provider = "anthropic"       # "anthropic" or "openai-compat"
name = "claude-sonnet-4-5-20250514"

[embedding]
provider = "ollama"          # "openai" or "ollama"
model = "nomic-embed-text"
endpoint = "http://localhost:11434"
dimensions = 768

[database]
url = "postgresql://constellation:constellation@localhost:5432/constellation"

[runtime]
working_dir = "./workspace"
allowed_hosts = ["api.anthropic.com"]
```

### Environment Variables

| Variable | Overrides | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | `model.api_key` (Anthropic provider) | Yes, unless using openai-compat |
| `OPENAI_COMPAT_API_KEY` | `model.api_key` (openai-compat provider) | Yes, if using openai-compat |
| `EMBEDDING_API_KEY` | `embedding.api_key` | Only for OpenAI embeddings |
| `DATABASE_URL` | `database.url` | No (defaults to local Docker) |

### Using a Different LLM Provider

To use an OpenAI-compatible endpoint instead of Anthropic:

```toml
[model]
provider = "openai-compat"
name = "your-model-name"
base_url = "https://your-endpoint/v1"
```

```bash
export OPENAI_COMPAT_API_KEY="your-key"
```

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Model      │     │   Embedding   │     │  Persistence  │
│  (Anthropic/  │     │  (OpenAI/     │     │  (PostgreSQL   │
│   OAI-compat) │     │   Ollama)     │     │   + pgvector)  │
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

### Memory Tiers

| Tier | Description | Behaviour |
|---|---|---|
| **Core** | Identity, persona, system instructions | Always in context. Familiar-permission blocks require user approval to modify. |
| **Working** | Active conversation context | Swapped in/out as needed. The agent manages this tier. |
| **Archival** | Long-term storage | Semantic search via pgvector embeddings. Unlimited capacity. |

### Sandboxed Code Execution

The agent can write and execute TypeScript code in a Deno subprocess. The sandbox enforces:

- Network access restricted to `allowed_hosts` only
- Filesystem limited to `working_dir`
- No subprocess spawning, env access, or FFI
- Execution timeout and output size limits
- Tool calls bridged back to the host via JSON-line IPC

## Development

```bash
# Type-check
bun run build

# Run all tests
bun test

# Run a specific test file
bun test src/memory/manager.test.ts

# Run integration tests (requires Docker Postgres running)
bun test src/integration/
```

### Project Structure

```
src/
├── config/        # TOML config loading, Zod schemas
├── persistence/   # PostgreSQL adapter, migrations
├── model/         # LLM provider port (Anthropic, OpenAI-compat)
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
