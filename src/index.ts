// pattern: Imperative Shell

/**
 * Machine Spirit daemon entry point.
 * Composition root that wires all adapters and starts the interactive REPL.
 */

const DEFAULT_MODEL_MAX_TOKENS = 200000; // Claude 3 Sonnet context window

import * as readline from 'readline';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BskyAgent } from '@atproto/api';
import { loadConfig } from '@/config/config';
import { createPostgresProvider } from '@/persistence/postgres';
import { createModelProvider } from '@/model/factory';
import { createEmbeddingProvider } from '@/embedding/factory';
import { createPostgresMemoryStore } from '@/memory/postgres-store';
import { createMemoryManager } from '@/memory/manager';
import { createToolRegistry } from '@/tool/registry';
import { createMemoryTools } from '@/tool/builtin/memory';
import { createExecuteCodeTool } from '@/tool/builtin/code';
import { createDenoExecutor } from '@/runtime/executor';
import { createAgent } from '@/agent/agent';
import { createBlueskySource, seedBlueskyTemplates, createEventQueue } from '@/extensions/bluesky';
import type { MemoryManager } from '@/memory/manager';
import type { Agent } from '@/agent/types';
import type { BlueskyDataSource } from '@/extensions/bluesky';
import type { ExecutionContext } from '@/runtime/types';
import type { IncomingMessage } from '@/extensions/data-source';
import type { PersistenceProvider } from '@/persistence/types';
import type { MemoryStore } from '@/memory/store';
import type { EmbeddingProvider } from '@/embedding/types';
import type { PendingMutation } from '@/memory/types';

type InteractionLoopDeps = {
  agent: Agent;
  memory: MemoryManager;
  persistence: PersistenceProvider;
  readline: readline.Interface;
};

/**
 * Process pending mutations with provided user responses.
 * Extracted for testability without readline event loop complexity.
 */
export async function processPendingMutations(
  memory: MemoryManager,
  onMutationPrompt: (mutation: PendingMutation) => Promise<string>,
): Promise<void> {
  const mutations = await memory.getPendingMutations();

  for (const mutation of mutations) {
    const response = await onMutationPrompt(mutation);

    if (response.toLowerCase() === 'y') {
      await memory.approveMutation(mutation.id);
    } else {
      const feedback = response.toLowerCase() === 'n' ? 'user rejected' : response;
      await memory.rejectMutation(mutation.id, feedback);
    }
  }
}

/**
 * Core shutdown logic without process.exit - for testability.
 * Extracted so tests can verify the actual shutdown behavior.
 */
export async function performShutdown(
  rl: readline.Interface,
  persistence: PersistenceProvider,
): Promise<void> {
  console.log('\nShutting down...');
  rl.close();
  await persistence.disconnect();
}

/**
 * Create a graceful shutdown handler that closes readline and disconnects persistence.
 * Extracted for testability.
 */
export function createShutdownHandler(
  rl: readline.Interface,
  persistence: PersistenceProvider,
  blueskySource?: BlueskyDataSource | null,
): () => Promise<void> {
  return async (): Promise<void> => {
    console.log('\nShutting down...');
    if (blueskySource) {
      try {
        await blueskySource.disconnect();
        console.log('bluesky datasource disconnected');
      } catch (error) {
        console.error('error disconnecting bluesky:', error);
      }
    }
    await performShutdown(rl, persistence);
    process.exit(0);
  };
}

/**
 * Prompt for a single line of input from readline.
 * Used by the interaction loop for mutation approval prompts.
 */
function promptForLine(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Create an interaction loop that can be tested with mock dependencies.
 * Extracts REPL logic for testability.
 */
export function createInteractionLoop(deps: InteractionLoopDeps): (input: string) => Promise<void> {
  return async (userInput: string) => {
    const response = await deps.agent.processMessage(userInput);
    process.stdout.write(`\n${response}\n\n`);

    // After processing, check for any pending mutations that were created
    const pendingMutations = await deps.memory.getPendingMutations();

    for (const mutation of pendingMutations) {
      const answer = await promptForLine(
        deps.readline,
        `\n[Pending mutation] Block: "${mutation.block_id}"\n` +
        `Proposed change: "${mutation.proposed_content}"\n` +
        `Reason: "${mutation.reason ?? 'unspecified'}"\n` +
        `Approve? (y/n/feedback): `,
      );

      if (answer.toLowerCase() === 'y') {
        await deps.memory.approveMutation(mutation.id);
      } else {
        const feedback = answer.toLowerCase() === 'n' ? 'user rejected' : answer;
        await deps.memory.rejectMutation(mutation.id, feedback);
      }
    }
  };
}

/**
 * Seed core memory blocks on first run.
 * If the database is empty (no core blocks exist), load persona from persona.md
 * and create three core memory blocks: system, persona, and familiar.
 */
export async function seedCoreMemory(
  store: MemoryStore,
  embedding: EmbeddingProvider,
  personaPath: string,
): Promise<void> {
  // Check if core blocks already exist
  const existingBlocks = await store.getBlocksByTier('spirit', 'core');

  if (existingBlocks.length > 0) {
    // Not a first run, skip seeding
    return;
  }

  // Read persona from file, resolving relative to project root (parent of src/)
  let personaContent: string;
  try {
    const projectRoot = join(import.meta.dir, '..');
    const resolvedPath = join(projectRoot, personaPath);
    personaContent = readFileSync(resolvedPath, 'utf-8');
  } catch (error) {
    console.warn('could not read persona.md, skipping seeding:', error);
    return;
  }

  // Generate embeddings for each block
  const generateEmbedding = async (text: string): Promise<Array<number> | null> => {
    try {
      const result = await embedding.embed(text);
      // Validate that the embedding is an array of numbers
      if (!Array.isArray(result)) {
        console.warn('embedding provider returned non-array, storing block with null embedding');
        return null;
      }
      return result;
    } catch (error) {
      console.warn('embedding provider failed, storing block with null embedding');
      return null;
    }
  };

  // System instructions block
  const systemContent = `You are a machine spirit with three-tier memory:
- Core memory: always present in your context (this block, your persona, your familiar)
- Working memory: active context you can manage (swap in/out as needed)
- Archival memory: long-term storage, searchable via memory_read

You have four tools:
- memory_read(query): search memory by meaning
- memory_write(label, content): store or update memory
- memory_list(tier?): see available memory blocks
- execute_code(code): run TypeScript in a sandboxed environment

Use execute_code for anything beyond basic memory operations — API calls, file operations, complex tasks. You write the code, it runs in a Deno sandbox with network and file access.`;

  const systemEmbedding = await generateEmbedding(systemContent);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: 'spirit',
    tier: 'core',
    label: 'core:system',
    content: systemContent,
    embedding: systemEmbedding,
    permission: 'readonly',
    pinned: true,
  });

  // Persona block from persona.md
  const personaEmbedding = await generateEmbedding(personaContent);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: 'spirit',
    tier: 'core',
    label: 'core:persona',
    content: personaContent,
    embedding: personaEmbedding,
    permission: 'readwrite',
    pinned: true,
  });

  // Familiar placeholder block
  const familiarContent = 'My familiar has not yet introduced themselves.';
  const familiarEmbedding = await generateEmbedding(familiarContent);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: 'spirit',
    tier: 'core',
    label: 'core:familiar',
    content: familiarContent,
    embedding: familiarEmbedding,
    permission: 'familiar',
    pinned: true,
  });

  console.log('Core memory seeded for first run');
}

/**
 * Main entry point: wires all components and starts the REPL.
 */
async function main(): Promise<void> {
  console.log('constellation daemon starting...\n');

  // Load configuration
  const config = loadConfig();

  // Create providers
  const persistence = createPostgresProvider(config.database);
  const model = createModelProvider(config.model);
  const embedding = createEmbeddingProvider(config.embedding);

  // Connect to database and run migrations
  await persistence.connect();
  console.log('connected to database');
  await persistence.runMigrations();
  console.log('migrations completed\n');

  // Seed core memory on first run
  const memoryStore = createPostgresMemoryStore(persistence);
  await seedCoreMemory(memoryStore, embedding, 'persona.md');

  if (config.bluesky?.enabled) {
    await seedBlueskyTemplates(memoryStore, embedding);
  }

  // Create domain modules
  const memory = createMemoryManager(memoryStore, embedding, 'spirit');

  const registry = createToolRegistry();
  const memoryTools = createMemoryTools(memory);
  for (const tool of memoryTools) {
    registry.register(tool);
  }
  registry.register(createExecuteCodeTool());

  const runtime = createDenoExecutor({ ...config.runtime, ...config.agent }, registry);
  const agent = createAgent({
    model,
    memory,
    registry,
    runtime,
    persistence,
    config: {
      max_tool_rounds: config.agent.max_tool_rounds,
      context_budget: config.agent.context_budget,
      model_max_tokens: DEFAULT_MODEL_MAX_TOKENS,
      model_name: config.model.name,
    },
  });

  // Set up Bluesky DataSource if enabled
  let blueskySource: BlueskyDataSource | null = null;

  if (config.bluesky?.enabled) {
    try {
      const bskyAgent = new BskyAgent({ service: 'https://bsky.social' });
      blueskySource = createBlueskySource(config.bluesky, bskyAgent);
      await blueskySource.connect();

      // Create dedicated Bluesky agent with deterministic conversation ID
      // Zod validates that did is present when enabled, but TypeScript doesn't know it
      const blueskyConversationId = `bluesky-${config.bluesky.did!}`;

      // Getter reads fresh tokens from the DataSource at execution time,
      // so auto-refreshed credentials are always current
      const src = blueskySource; // capture for closure (blueskySource may be nulled on error)
      const getExecutionContext = (): ExecutionContext => ({
        bluesky: {
          service: "https://bsky.social",
          accessToken: src.getAccessToken(),
          refreshToken: src.getRefreshToken(),
          did: config.bluesky.did!,
          handle: config.bluesky.handle!,
        },
      });

      const blueskyAgent = createAgent({
        model,
        memory,
        registry,
        runtime,
        persistence,
        config: {
          max_tool_rounds: config.agent.max_tool_rounds,
          context_budget: config.agent.context_budget,
          model_max_tokens: DEFAULT_MODEL_MAX_TOKENS,
          model_name: config.model.name,
        },
        getExecutionContext,
      }, blueskyConversationId);

      // Set up event queue and processing loop
      const eventQueue = createEventQueue(50);
      let processing = false;

      async function processNextEvent(): Promise<void> {
        if (processing) return;
        processing = true;

        try {
          let event = eventQueue.shift();
          while (event) {
            try {
              await blueskyAgent.processEvent(event);
            } catch (error) {
              // AC6.5: Log error but don't crash
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error(`bluesky processEvent error: ${errorMsg}`);
            }
            event = eventQueue.shift();
          }
        } finally {
          processing = false;
        }
      }

      blueskySource.onMessage((message: IncomingMessage) => {
        eventQueue.push(message);
        processNextEvent().catch((error) => {
          console.error('bluesky event processing error:', error);
        });
      });

      console.log(`bluesky datasource connected (watching ${config.bluesky.watched_dids.length} DIDs)`);
    } catch (error) {
      // AC6.3: Jetstream failure doesn't block REPL
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`bluesky datasource failed to connect: ${errorMsg}`);
      console.error('continuing without bluesky integration');
      blueskySource = null;
    }
  }

  // Set up readline interface for REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const interactionHandler = createInteractionLoop({
    agent,
    memory,
    persistence,
    readline: rl,
  });

  // Set up graceful shutdown
  const shutdownHandler = createShutdownHandler(rl, persistence, blueskySource);

  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);

  // REPL loop
  console.log('Type your message (press Ctrl+C to exit):\n');

  rl.setPrompt('> ');
  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        await interactionHandler(trimmed);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`error: ${errorMsg}`);
      }
    }
    rl.prompt();
  });

  rl.prompt();
}

// Run main entry point only when file is executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
