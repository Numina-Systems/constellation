// pattern: Imperative Shell

/**
 * Machine Spirit daemon entry point.
 * Composition root that wires all adapters and starts the interactive REPL.
 */

const DEFAULT_MODEL_MAX_TOKENS = 200000; // Claude 3 Sonnet context window

import * as readline from 'readline';
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
import type { MemoryManager } from '@/memory/manager';
import type { Agent } from '@/agent/types';
import type { PersistenceProvider } from '@/persistence/types';

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
  onMutationPrompt: (mutation: any) => Promise<string>,
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
): () => Promise<void> {
  return async (): Promise<void> => {
    await performShutdown(rl, persistence);
    process.exit(0);
  };
}

/**
 * Create an interaction loop that can be tested with mock dependencies.
 * Extracts REPL logic for testability.
 */
export function createInteractionLoop(deps: InteractionLoopDeps): (input: string) => Promise<void> {
  return async (userInput: string) => {
    // Check for pending mutations before processing message
    const pendingMutations = await deps.memory.getPendingMutations();

    for (const mutation of pendingMutations) {
      process.stdout.write(
        `\n[Pending mutation] Block: "${mutation.block_id}"\n` +
        `Proposed change: "${mutation.proposed_content}"\n` +
        `Reason: "${mutation.reason ?? 'unspecified'}"\n` +
        `Approve? (y/n/feedback): `,
      );

      // In a real loop, we'd wait for user input here.
      // For testing, this function returns a handler that processes one line at a time.
      // The test environment will call this handler with the user's response.
      await new Promise<void>((resolve) => {
        deps.readline.once('line', async (response: string) => {
          if (response.toLowerCase() === 'y') {
            await deps.memory.approveMutation(mutation.id);
          } else {
            const feedback = response.toLowerCase() === 'n' ? 'user rejected' : response;
            await deps.memory.rejectMutation(mutation.id, feedback);
          }
          resolve();
        });
      });
    }

    // Process the user message
    process.stdout.write(`\n> ${userInput}\n`);
    const response = await deps.agent.processMessage(userInput);
    process.stdout.write(`${response}\n\n`);
  };
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

  // Create domain modules
  const memoryStore = createPostgresMemoryStore(persistence);
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
    },
  });

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
  const shutdownHandler = createShutdownHandler(rl, persistence);

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
