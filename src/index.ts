// pattern: Imperative Shell

/**
 * Machine Spirit daemon entry point.
 * Composition root that wires all adapters and starts the interactive REPL.
 */


import * as readline from 'readline';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BskyAgent } from '@atproto/api';
import { loadConfig } from '@/config/config';
import { createPostgresProvider, createMessageStore } from '@/persistence';
import { createModelProvider } from '@/model/factory';
import { createEmbeddingProvider } from '@/embedding/factory';
import { createPostgresMemoryStore } from '@/memory/postgres-store';
import { createMemoryManager } from '@/memory/manager';
import { createToolRegistry } from '@/tool/registry';
import { createMemoryTools } from '@/tool/builtin/memory';
import { createExecuteCodeTool } from '@/tool/builtin/code';
import { createCompactContextTool } from '@/tool/builtin/compaction';
import { createPostgresSecretStore, createSecretResolver } from '@/secrets';
import { createSecretTools } from '@/tool/builtin/secrets';
import { createDenoExecutor } from '@/runtime/executor';
import { createAgent } from '@/agent/agent';
import { createBlueskySource, seedBlueskyTemplates, createEventQueue } from '@/extensions/bluesky';
import { createCompactor } from '@/compaction';
import { createWebTools } from '@/tool/builtin/web';
import { createSearchChain, createFetcher } from '@/web';
import { createRateLimitedProvider } from '@/rate-limit/provider.js';
import { hasRateLimitConfig, buildRateLimiterConfig, createRateLimitContextProvider } from '@/rate-limit/context.js';
import { createOpenRouterAdapter } from '@/model/openrouter.js';
import type { ServerRateLimitSync } from '@/rate-limit/types.js';
import { createPostgresSkillStore } from '@/skill/postgres-store';
import { createSkillRegistry } from '@/skill/registry';
import { createSkillTools } from '@/skill/tools';
import { createPredictionStore, createTraceRecorder, shouldSkipReview } from '@/reflexion';
import { createPredictionTools, createIntrospectionTools } from '@/reflexion';
import { createPredictionContextProvider } from '@/reflexion';
import { formatTraceSummary } from '@/scheduled-context';
import { createPostgresScheduler } from '@/scheduler';
import { createMailgunSender, createEmailTools } from '@/email';
import { createSchedulingTools } from '@/tool/builtin/scheduling';
import { createSchedulingContextProvider } from '@/agent/scheduling-context';
import { createSubconsciousTools } from '@/tool/builtin/subconscious';
import {
  createInterestRegistry,
  createImpulseAssembler,
  buildImpulseCron,
  createSubconsciousContextProvider,
  createIntrospectionAssembler,
  buildIntrospectionCron,
  createIntrospectionContextProvider,
  createContinuationBudget,
  createContinuationJudge,
  runContinuationLoop,
} from '@/subconscious';
import { createSearchStore, createMemorySearchDomain, createConversationSearchDomain } from '@/search';
import { createSearchTools } from '@/tool/builtin/search';
import {
  createActivityManager,
  createActivityContextProvider,
  createActivityDispatch,
  createWakeHandler,
  currentMode,
  sleepTaskCron,
  isSleepTask,
  queuedEventToExternal,
  buildCompactionEvent,
  buildPredictionReviewEvent,
  buildPatternAnalysisEvent,
} from '@/activity/index.ts';
import type { ActivityManager, ScheduleConfig } from '@/activity/index.ts';
import type { MemoryManager } from '@/memory/manager';
import type { SkillRegistry } from '@/skill/types';
import type { CompactionConfig } from '@/compaction/types';
import type { Agent } from '@/agent/types';
import type { BlueskyDataSource } from '@/extensions/bluesky';
import type { ExecutionContext } from '@/runtime/types';
import type { EventQueue } from '@/extensions/bluesky';
import type { PersistenceProvider } from '@/persistence/types';
import type { MemoryStore } from '@/memory/store';
import type { EmbeddingProvider } from '@/embedding/types';
import type { PendingMutation } from '@/memory/types';
import type { ModelProvider } from '@/model/types';
import type { TraceStore } from '@/reflexion';
import type { ContextProvider, ClassifiedProvider, CheckpointAgentState, CheckpointTrigger, SessionCheckpoint } from '@/agent';
import { createDataSourceRegistry } from '@/extensions/data-source-registry';
import type { DataSourceRegistration, DataSourceRegistry } from '@/extensions/data-source';
import { createMcpClient, createMcpToolProvider, mcpPromptsToSkills, resolveServerConfigEnv, createMcpInstructionsProvider, formatMcpStartupSummary } from '@/mcp';
import type { McpClient } from '@/mcp';
import { createRecallContextProvider } from '@/recall/index.js';
import { buildDiarySection } from '@/diary';
import { createShellSession } from '@/shell/index';
import { createShellExecuteTool } from '@/tool/builtin/shell-execute';
import type { ShellSession } from '@/shell/types';
import { createCheckpointStore } from '@/persistence/checkpoint-store.ts';
import { performCheckpoint, type CheckpointDependencies } from '@/agent/checkpoint-create.ts';
import { restoreFromCheckpoint, type RestorationDependencies, type RestorationResult } from '@/agent/checkpoint-restore.ts';
import { createCheckpointTool } from '@/tool/builtin/checkpoint.ts';
import { createLoopDetector } from '@/loop-detection/index.js';
import type { LoopDetectionConfig } from '@/loop-detection/types.js';

const AGENT_OWNER = 'spirit';

export const SUPPRESS_DURING_SLEEP = ['review-predictions', 'subconscious-impulse', 'subconscious-introspection'] as const;

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
  rl.close();
  await persistence.disconnect();
}

/**
 * Build a review event from a scheduled task with trace enrichment.
 * Queries recent operation traces and includes them in the event content.
 * Extracted for testability - allows tests to verify the exact event shape
 * that the scheduler's onDue handler produces.
 */
export async function buildReviewEvent(
  task: {
    id: string;
    name: string;
    schedule: string;
    payload?: Record<string, unknown>;
  },
  traceStore: TraceStore,
  owner: string,
): Promise<{
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}> {
  const traces = await traceStore.queryTraces({
    owner,
    lookbackSince: new Date(Date.now() - 2 * 3600_000),
    limit: 20,
  });
  const activitySection = formatTraceSummary(traces);

  return {
    source: 'review-job',
    content: [
      `Scheduled task "${task.name}" has fired.`,
      '',
      'Review your pending predictions against recent operation traces.',
      'Use self_introspect to see your recent tool usage, then use list_predictions to see pending predictions.',
      'For each prediction, use annotate_prediction to record whether it was accurate.',
      'After reviewing, write a brief reflection to archival memory summarizing what you learned.',
      '',
      'If you have no pending predictions, still write a brief reflection noting this and consider whether you should be making predictions about outcomes of your actions.',
      '',
      activitySection,
    ].join('\n'),
    metadata: {
      taskId: task.id,
      taskName: task.name,
      schedule: task.schedule,
      ...task.payload,
    },
    timestamp: new Date(),
  };
}

/**
 * Build an agent-scheduled event from a scheduled task with trace enrichment.
 * Queries recent operation traces and includes them in the event content.
 * For tasks scheduled by the agent itself (not system review tasks).
 */
export async function buildAgentScheduledEvent(
  task: {
    id: string;
    name: string;
    schedule: string;
    payload?: Record<string, unknown>;
  },
  traceStore: TraceStore,
  owner: string,
): Promise<{
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}> {
  const traces = await traceStore.queryTraces({
    owner,
    lookbackSince: new Date(Date.now() - 2 * 3600_000),
    limit: 20,
  });
  const activitySection = formatTraceSummary(traces);

  const prompt = String(task.payload?.['prompt'] ?? '') || 'Execute this scheduled task.';

  return {
    source: 'agent-scheduled',
    content: [
      `Scheduled task "${task.name}" has fired.`,
      '',
      prompt,
      '',
      activitySection,
    ].join('\n'),
    metadata: {
      taskId: task.id,
      taskName: task.name,
      schedule: task.schedule,
      ...task.payload,
    },
    timestamp: new Date(),
  };
}

/**
 * Create a graceful shutdown handler that closes readline and disconnects persistence.
 * Extracted for testability.
 */
export function createShutdownHandler(
  rl: readline.Interface,
  persistence: PersistenceProvider,
  dataSourceRegistry?: DataSourceRegistry | null,
  scheduler?: { stop(): void } | null,
  activityManager?: ActivityManager | null,
  mcpClients?: ReadonlyArray<McpClient>,
  shellSession?: ShellSession | null,
  checkpointFn?: () => Promise<string | null>,
): () => Promise<void> {
  let shuttingDown = false;
  return async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down...');
    if (checkpointFn) {
      try {
        await checkpointFn();
      } catch (err) {
        console.warn('[checkpoint] shutdown checkpoint failed:', (err as Error).message);
      }
    }
    if (scheduler) {
      scheduler.stop();
      console.log('scheduler stopped');
    }
    if (dataSourceRegistry) {
      try {
        await dataSourceRegistry.shutdown();
        console.log('data sources disconnected');
      } catch (error) {
        console.error('error disconnecting data sources:', error);
      }
    }
    if (activityManager) {
      const finalState = await activityManager.getState();
      console.log(`[activity] shutdown state: ${finalState.mode}, queued: ${finalState.queuedEventCount}`);
    }
    // Disconnect MCP servers
    if (mcpClients && mcpClients.length > 0) {
      await Promise.allSettled(
        mcpClients.map(async (client) => {
          try {
            await client.disconnect();
          } catch (error) {
            console.error(`[mcp:${client.serverName}] error disconnecting:`, error);
          }
        }),
      );
      console.log(`[mcp] ${mcpClients.length} server(s) disconnected`);
    }
    if (shellSession) {
      try {
        await shellSession.destroy();
        console.log('shell session destroyed');
      } catch (error) {
        console.error('error destroying shell session:', error);
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
 * Process events from a queue, catching errors so one failed event doesn't crash the loop.
 * Extracted for testability (AC6.5: processEvent errors don't crash listener).
 * Caller provides the event queue and agent; this function drains the queue
 * and ensures errors are logged but don't prevent subsequent events from processing.
 */
export async function processEventQueue(
  eventQueue: EventQueue,
  agent: Agent,
  sourceLabel: string = 'bluesky',
): Promise<void> {
  let event = eventQueue.shift();
  while (event) {
    try {
      const result = await agent.processEvent(event);
      if (result) {
        console.log(`[${sourceLabel}] agent response: ${result}`);
      }
    } catch (error) {
      // AC6.5: Log error but don't crash
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`${sourceLabel} processEvent error: ${errorMsg}`);
    }
    event = eventQueue.shift();
  }
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
 * Parse --resume CLI flag from process.argv.
 * Returns the checkpoint ID if provided, undefined otherwise.
 * Exits with error code 1 if flag is present but missing its argument.
 */
function parseResumeFlag(): string | undefined {
  const idx = process.argv.indexOf('--resume');
  if (idx === -1) return undefined;
  if (idx + 1 >= process.argv.length || process.argv[idx + 1]!.startsWith('--')) {
    console.error('error: --resume requires a checkpoint ID');
    process.exit(1);
  }
  return process.argv[idx + 1];
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
  const existingBlocks = await store.getBlocksByTier(AGENT_OWNER, 'core');

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
    owner: AGENT_OWNER,
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
    owner: AGENT_OWNER,
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
    owner: AGENT_OWNER,
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

  // Parse CLI resume flag (must be before config loading)
  const resumeCheckpointId = parseResumeFlag();

  // Load configuration
  const config = loadConfig();

  // Create providers
  const persistence = createPostgresProvider(config.database);

  // For OpenRouter, use an indirect callback reference so the adapter captures
  // a proxy that gets wired to the rate-limited provider's syncFromServer after creation
  let syncFromServerCallback: ServerRateLimitSync | undefined;

  const rawModel = config.model.provider === "openrouter"
    ? createOpenRouterAdapter(config.model, (status) => syncFromServerCallback?.(status))
    : createModelProvider(config.model);

  const contextProviders: Array<ContextProvider> = [];

  // Keep reference to rate limit provider for later classification
  let rateLimitContextProvider: ContextProvider | undefined;

  const model = hasRateLimitConfig(config.model)
    ? (() => {
        const rateLimitedModel = createRateLimitedProvider(
          rawModel,
          buildRateLimiterConfig(config.model),
        );
        if (config.model.provider === "openrouter") {
          syncFromServerCallback = rateLimitedModel.syncFromServer;
        }
        rateLimitContextProvider = createRateLimitContextProvider(() => rateLimitedModel.getStatus());
        contextProviders.push(rateLimitContextProvider);
        console.log(`rate limiting active for model ${config.model.name} (${config.model.requests_per_minute} RPM, ${config.model.input_tokens_per_minute} ITPM, ${config.model.output_tokens_per_minute} OTPM)`);
        return rateLimitedModel;
      })()
    : rawModel;

  const embedding = createEmbeddingProvider(config.embedding);

  // Create summarization model provider
  // If summarization config exists, create a dedicated provider from it
  // Otherwise, reuse the main model provider
  let summarizationSyncFromServerCallback: ServerRateLimitSync | undefined;

  const summarizationModel: ModelProvider = config.summarization
    ? (() => {
        const rawSummarizationModel = config.summarization.provider === "openrouter"
          ? createOpenRouterAdapter(config.summarization, (status) => summarizationSyncFromServerCallback?.(status))
          : createModelProvider({
              provider: config.summarization.provider,
              name: config.summarization.name,
              api_key: config.summarization.api_key,
              base_url: config.summarization.base_url,
            });
        if (hasRateLimitConfig(config.summarization)) {
          const rateLimited = createRateLimitedProvider(
            rawSummarizationModel,
            buildRateLimiterConfig(config.summarization),
          );
          if (config.summarization.provider === "openrouter") {
            summarizationSyncFromServerCallback = rateLimited.syncFromServer;
          }
          console.log(`rate limiting active for summarization model ${config.summarization.name}`);
          return rateLimited;
        }
        return rawSummarizationModel;
      })()
    : model;

  // Connect to database and run migrations
  await persistence.connect();
  console.log('connected to database');
  await persistence.runMigrations();
  console.log('migrations completed\n');

  // Create interest registry
  const interestRegistry = createInterestRegistry(persistence);

  // Seed core memory on first run
  const memoryStore = createPostgresMemoryStore(persistence);
  await seedCoreMemory(memoryStore, embedding, 'persona.md');

  if (config.bluesky?.enabled) {
    await seedBlueskyTemplates(memoryStore, embedding);
  }

  // Create domain modules
  const memory = createMemoryManager(memoryStore, embedding, AGENT_OWNER);

  // Retrieve diary section (session-static, fetched once at init)
  let diarySection: string | undefined;
  if (config.agent.diary_enabled !== false) {
    try {
      const diaryBlocks = await memoryStore.getBlocksByLabelPrefix(
        AGENT_OWNER,
        'diary:',
        'working',
      );
      if (diaryBlocks.length > 0) {
        const result = buildDiarySection(diaryBlocks, {
          tokenBudget: config.agent.diary_token_budget ?? 3000,
          maxEntries: config.agent.diary_max_entries ?? 3,
        });
        diarySection = result?.section;
      }
    } catch (error) {
      console.warn('diary: retrieval failed, continuing without diary', error);
    }
  }

  // Create reflexion stores
  const predictionStore = createPredictionStore(persistence);
  const traceRecorder: TraceStore = createTraceRecorder(persistence);

  // Create secret store and resolver
  const secretStore = createPostgresSecretStore(persistence);

  const configSecrets: Record<string, string> = {};
  if (process.env['ANTHROPIC_API_KEY']) configSecrets['ANTHROPIC_API_KEY'] = process.env['ANTHROPIC_API_KEY'];
  if (process.env['OPENAI_COMPAT_API_KEY']) configSecrets['OPENAI_COMPAT_API_KEY'] = process.env['OPENAI_COMPAT_API_KEY'];
  if (process.env['OPENROUTER_API_KEY']) configSecrets['OPENROUTER_API_KEY'] = process.env['OPENROUTER_API_KEY'];
  if (process.env['EMBEDDING_API_KEY']) configSecrets['EMBEDDING_API_KEY'] = process.env['EMBEDDING_API_KEY'];
  if (process.env['BRAVE_API_KEY']) configSecrets['BRAVE_API_KEY'] = process.env['BRAVE_API_KEY'];
  if (process.env['TAVILY_API_KEY']) configSecrets['TAVILY_API_KEY'] = process.env['TAVILY_API_KEY'];
  if (process.env['MAILGUN_API_KEY']) configSecrets['MAILGUN_API_KEY'] = process.env['MAILGUN_API_KEY'];

  const secretResolver = createSecretResolver({
    store: secretStore,
    owner: AGENT_OWNER,
    configSecrets,
  });

  // Create message store (used for checkpoint restoration)
  const messageStore = createMessageStore(persistence);

  const registry = createToolRegistry();

  // Step 1a: Create checkpoint store and load checkpoint for resume (AC6)
  const checkpointStore = createCheckpointStore(persistence);

  const resumeId = resumeCheckpointId ?? config.agent.resume_checkpoint;

  let loadedCheckpoint: {checkpoint: SessionCheckpoint; conversationId: string} | null = null;

  if (resumeId) {
    const checkpoint = await checkpointStore.load(resumeId);
    if (!checkpoint) {
      console.error(`error: checkpoint ${resumeId} not found`);
      process.exit(1);
    }
    console.log(`resuming from checkpoint ${resumeId} (conversation: ${checkpoint.conversationId})`);
    loadedCheckpoint = { checkpoint, conversationId: checkpoint.conversationId };
  } else if (config.agent.auto_resume) {
    const checkpoint = await checkpointStore.loadLatest(AGENT_OWNER);
    if (checkpoint) {
      console.log(`auto-resuming from checkpoint ${checkpoint.id} (conversation: ${checkpoint.conversationId})`);
      loadedCheckpoint = { checkpoint, conversationId: checkpoint.conversationId };
    } else {
      console.log('auto-resume enabled but no checkpoint found — starting fresh');
    }
  }

  // Generate conversation ID for main agent upfront so it can be shared with prediction tools
  // Use resumed conversation ID if available, otherwise generate a new one
  const mainConversationId = loadedCheckpoint?.conversationId ?? crypto.randomUUID();

  const memoryTools = createMemoryTools(memory);
  for (const tool of memoryTools) {
    registry.register(tool);
  }
  registry.register(createExecuteCodeTool());
  registry.register(createCompactContextTool());

  // Register reflexion tools
  const predictionTools = createPredictionTools({
    store: predictionStore,
    owner: AGENT_OWNER,
    conversationId: mainConversationId,
  });
  for (const tool of predictionTools) {
    registry.register(tool);
  }

  const introspectionTools = createIntrospectionTools({
    traceStore: traceRecorder,
    predictionStore,
    owner: AGENT_OWNER,
  });
  for (const tool of introspectionTools) {
    registry.register(tool);
  }

  // Register secret tools (conditional on config)
  if (config.secrets?.agent_managed) {
    const secretTools = createSecretTools({ store: secretStore, owner: AGENT_OWNER });
    for (const tool of secretTools) {
      registry.register(tool);
    }
    console.log('secret tools registered (agent_managed: true)');
  }

  // Create prediction context provider
  const predictionContextProvider = createPredictionContextProvider(predictionStore, AGENT_OWNER);

  // Create scheduling context provider
  const schedulingContextProvider = createSchedulingContextProvider(
    config.bluesky.schedule_dids,
    config.bluesky.watched_dids,
  );

  // Create subconscious context provider
  const subconsciousContextProvider = createSubconsciousContextProvider(interestRegistry, AGENT_OWNER);

  // Create introspection context provider
  const introspectionContextProvider = createIntrospectionContextProvider(memoryStore, AGENT_OWNER);

  // Create recall context provider
  const recallContextProvider = createRecallContextProvider();
  const subconsciousRecallContextProvider = createRecallContextProvider();

  if (config.web) {
    const searchChain = createSearchChain(config.web);
    const fetcher = createFetcher({
      fetch_timeout: config.web.fetch_timeout,
      max_fetch_size: config.web.max_fetch_size,
      cache_ttl: config.web.cache_ttl,
    });
    const webTools = createWebTools({
      search: (query, limit) => searchChain.search(query, limit),
      fetcher,
      defaultMaxResults: config.web.max_results,
    });
    for (const tool of webTools) {
      registry.register(tool);
    }
    console.log(`web tools registered (providers: ${searchChain.providers.join(', ')})`);
  }

  if (config.email) {
    const sender = createMailgunSender({
      apiKey: config.email.mailgun_api_key,
      domain: config.email.mailgun_domain,
      fromAddress: config.email.from_address,
    });
    const emailTools = createEmailTools({
      sender,
      allowedRecipients: config.email.allowed_recipients,
    });
    for (const tool of emailTools) {
      registry.register(tool);
    }
    console.log('email tools registered');
  }

  // Shell session (optional, config-gated)
  let shellSession: ShellSession | null = null;
  if (config.shell?.enabled) {
    try {
      shellSession = await createShellSession({
        shell: config.shell.shell,
        commandTimeout: config.shell.command_timeout,
        idleTimeout: config.shell.idle_timeout,
        maxOutputBytes: config.shell.max_output_bytes,
        promptMarker: crypto.randomUUID(),
      });
      registry.register(createShellExecuteTool(shellSession));
      console.log('shell session created and tool registered');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'ShellError' || (err instanceof Error && err.message.includes('shell'))) {
        console.error(`[shell] Failed to create session: ${err.message}`);
        // Agent continues without shell — AC1.5
      } else {
        throw error;
      }
    }
  }

  // Search tools (always available — uses existing persistence and embedding providers)
  const searchStore = createSearchStore(embedding);
  const memorySearchDomain = createMemorySearchDomain(persistence, AGENT_OWNER);
  const conversationSearchDomain = createConversationSearchDomain(persistence);
  searchStore.registerDomain(memorySearchDomain);
  searchStore.registerDomain(conversationSearchDomain);

  const searchTools = createSearchTools(searchStore);
  for (const tool of searchTools) {
    registry.register(tool);
  }
  console.log('search tools registered');

  const runtime = createDenoExecutor({ ...config.runtime, ...config.agent }, registry);

  // Skills system (optional)
  let skillRegistry: SkillRegistry | undefined;

  if (config.skills) {
    const skillStore = createPostgresSkillStore(persistence);
    skillRegistry = createSkillRegistry({
      store: skillStore,
      embedding,
      builtinDir: config.skills.builtin_dir,
      agentDir: config.skills.agent_dir,
    });
    await skillRegistry.load();

    // Register skill management tools
    const skillTools = createSkillTools(skillRegistry);
    for (const tool of skillTools) {
      registry.register(tool);
    }

    // Register skill-defined tools
    // These tools are defined declaratively in skill frontmatter but executed as static skill content.
    // The parameters are part of the tool definition (for agent context) but ignored by the handler,
    // which simply returns the skill body. This design allows skills to declare tool affordances
    // (what they can do) while keeping execution simple: tool invocation triggers skill retrieval.
    for (const skill of skillRegistry.getAll()) {
      if (skill.metadata.tools) {
        for (const toolDef of skill.metadata.tools) {
          registry.register({
            definition: {
              name: toolDef.name,
              description: toolDef.description,
              parameters: toolDef.parameters,
            },
            handler: async () => ({
              success: true,
              output: `[Skill: ${skill.metadata.name}]\n\n${skill.body}`,
            }),
          });
        }
      }
    }

    console.log(`skills loaded (${skillRegistry.getAll().length} skills)`);
  }

  // --- MCP servers ---
  const mcpClients: Array<McpClient> = [];
  const mcpFailedServers: Array<{name: string; error: string}> = [];
  const mcpInstructionsProviders = new Map<string, ContextProvider>();

  if (config.mcp?.enabled && Object.keys(config.mcp.servers).length > 0) {
    console.log(`[mcp] connecting to ${Object.keys(config.mcp.servers).length} server(s)...`);

    for (const [serverName, rawServerConfig] of Object.entries(config.mcp.servers)) {
      try {
        // Resolve env vars in config values
        const serverConfig = resolveServerConfigEnv(rawServerConfig, process.env);

        // Create and connect client
        const client = createMcpClient(serverName, serverConfig);
        await client.connect();
        mcpClients.push(client);

        // Discover and register tools
        const provider = createMcpToolProvider(client);
        const toolDefs = await provider.discover();
        for (const def of toolDefs) {
          registry.register({
            definition: def,
            handler: async (params) => provider.execute(def.name, params),
          });
        }
        console.log(`[mcp:${serverName}] registered ${toolDefs.length} tool(s)`);

        // Convert prompts to skills and inject
        if (skillRegistry) {
          const skills = await mcpPromptsToSkills(client);
          if (skills.length > 0) {
            await skillRegistry.injectSkills(skills);
            console.log(`[mcp:${serverName}] injected ${skills.length} skill(s)`);
          }
        }

        // Collect server instructions for context provider
        const instructions = await client.getInstructions();
        if (instructions) {
          const mcpProvider = createMcpInstructionsProvider(serverName, instructions);
          contextProviders.push(mcpProvider);
          mcpInstructionsProviders.set(serverName, mcpProvider);
        }

      } catch (error) {
        // AC6.3, AC6.4: Failed connection doesn't block startup
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[mcp:${serverName}] failed to connect: ${errorMsg}`);
        console.error(`[mcp] continuing without ${serverName}`);
        mcpFailedServers.push({name: serverName, error: errorMsg});
      }
    }

    // Format and log summary using testable helper
    const connectedNames = mcpClients.map(c => c.serverName);
    const summary = formatMcpStartupSummary(connectedNames, mcpFailedServers);
    console.log(`[mcp] ${summary}`);
  }

  // Set up Bluesky DataSource early so both REPL and Bluesky agents can share credentials
  let blueskySource: BlueskyDataSource | null = null;
  let blueskyConnected = false;

  if (config.bluesky?.enabled) {
    try {
      const bskyAgent = new BskyAgent({ service: 'https://bsky.social' });
      blueskySource = createBlueskySource(config.bluesky, bskyAgent);
      await blueskySource.connect();
      blueskySource.startSessionRefresh();
      blueskyConnected = true;
    } catch (error) {
      // AC6.3: Jetstream failure doesn't block REPL
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`bluesky datasource failed to connect: ${errorMsg}`);
      console.error('continuing without bluesky integration');
      blueskySource = null;
    }
  }

  // Getter reads fresh tokens from the DataSource at execution time.
  // Shared by both REPL and Bluesky agents so either can post to Bluesky.
  // Returns undefined when bluesky is not connected, so the sandbox
  // simply won't have BSKY_* constants available.
  const getExecutionContext = async (): Promise<ExecutionContext> => {
    const allKeys = await secretResolver.listKeys();
    const secrets = await secretResolver.resolve(allKeys);

    const context: ExecutionContext = { secrets };

    if (blueskyConnected && blueskySource) {
      const src = blueskySource;
      return {
        ...context,
        bluesky: {
          service: "https://bsky.social",
          pdsUrl: src.getPdsUrl(),
          accessToken: src.getAccessToken(),
          refreshToken: src.getRefreshToken(),
          did: config.bluesky.did!,
          handle: config.bluesky.handle!,
        },
      };
    }

    return context;
  };

  // Create compactor with configuration from config.summarization
  const compactionConfig: CompactionConfig = {
    chunkSize: config.summarization?.chunk_size ?? 20,
    keepRecent: config.summarization?.keep_recent ?? 5,
    maxSummaryTokens: config.summarization?.max_summary_tokens ?? 1024,
    clipFirst: config.summarization?.clip_first ?? 2,
    clipLast: config.summarization?.clip_last ?? 2,
    prompt: config.summarization?.prompt ?? null,
    scoring: config.summarization ? {
      roleWeightSystem: config.summarization.role_weight_system,
      roleWeightUser: config.summarization.role_weight_user,
      roleWeightAssistant: config.summarization.role_weight_assistant,
      recencyDecay: config.summarization.recency_decay,
      questionBonus: config.summarization.question_bonus,
      toolCallBonus: config.summarization.tool_call_bonus,
      keywordBonus: config.summarization.keyword_bonus,
      importantKeywords: config.summarization.important_keywords,
      contentLengthWeight: config.summarization.content_length_weight,
    } : undefined,
    timeout: config.summarization?.compaction_timeout ?? 120000,
    maxRetries: config.summarization?.compaction_max_retries ?? 2,
    maxChunkTokens: config.summarization?.max_chunk_tokens,
    maxConsecutiveFailures: config.summarization?.max_consecutive_failures ?? 3,
  };

  const compactor = createCompactor({
    model: summarizationModel,
    memory,
    persistence,
    config: compactionConfig,
    modelName: config.summarization?.name ?? config.model.name,
  });

  // --- Activity Manager (opt-in) ---
  let activityManager: ActivityManager | null = null;
  let activityScheduleConfig: ScheduleConfig | null = null;
  let activityContextProvider: ContextProvider | undefined;

  if (config.activity?.enabled) {
    const activityConfig = config.activity;

    // Guard: narrow optional fields to non-null (Zod superRefine guarantees presence when enabled)
    if (!activityConfig.timezone || !activityConfig.sleep_schedule || !activityConfig.wake_schedule) {
      throw new Error('activity config validation failed: missing required fields despite enabled=true');
    }

    activityScheduleConfig = {
      sleepSchedule: activityConfig.sleep_schedule,
      wakeSchedule: activityConfig.wake_schedule,
      timezone: activityConfig.timezone,
    };

    // 1. Create activity manager
    activityManager = createActivityManager(persistence, activityScheduleConfig, AGENT_OWNER);

    // 2. Startup reconciliation: compute current mode from cron expressions
    const expectedMode = currentMode(activityScheduleConfig);
    await activityManager.transitionTo(expectedMode);
    const state = await activityManager.getState();
    console.log(`activity manager started (mode: ${state.mode}, next transition: ${state.nextTransitionAt?.toISOString() ?? 'unknown'})`);

    // 3. Register context provider BEFORE agent creation
    activityContextProvider = createActivityContextProvider(activityManager);
    contextProviders.push(activityContextProvider);
  }

  // Step 1: Build DataSource registrations array (BEFORE agent creation)
  const registrations: Array<DataSourceRegistration> = [];

  if (blueskyConnected && blueskySource) {
    const highPriorityDids = new Set(config.bluesky.schedule_dids);
    const blueskyInstructions = 'To respond to this post, use memory_read to find your bluesky templates (e.g. "bluesky reply" or "bluesky post"), then use execute_code with the template. Bluesky credentials (BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE) are automatically available in your sandbox. Replace placeholder text with your actual response.';

    registrations.push({
      source: blueskySource,
      instructions: blueskyInstructions,
      highPriorityFilter: highPriorityDids.size > 0
        ? (message) => {
            const authorDid = message.metadata['authorDid'] as string | undefined;
            return authorDid !== undefined && highPriorityDids.has(authorDid);
          }
        : undefined,
    });
  }

  // Derive source instructions map from registrations array
  const sourceInstructions = new Map<string, string>();
  for (const reg of registrations) {
    if (reg.instructions) {
      sourceInstructions.set(reg.source.name, reg.instructions);
    }
  }

  // Step 2: Build classified providers array for snapshot routing (Phase 4)
  // Note: Provider identification now uses direct variable references instead of string matching.
  // This is more robust and maintainable than searching contextProviders by output strings.
  const classifiedProviders: Array<ClassifiedProvider> = [];

  // Rate limit context provider (use direct reference if it was created)
  if (rateLimitContextProvider) {
    classifiedProviders.push({
      name: 'rate-limit',
      provider: rateLimitContextProvider,
      classification: 'dynamic',
    });
  }

  // MCP instructions providers (use direct references from the map)
  for (const [serverName, provider] of mcpInstructionsProviders) {
    classifiedProviders.push({
      name: `mcp-${serverName}`,
      provider,
      classification: 'dynamic',
    });
  }

  // Activity context provider (use direct reference if it was created)
  if (activityContextProvider) {
    classifiedProviders.push({
      name: 'activity',
      provider: activityContextProvider,
      classification: 'dynamic',
    });
  }

  // Recall context provider
  classifiedProviders.push({
    name: 'recall',
    provider: recallContextProvider,
    classification: 'dynamic',
  });

  // Prediction context provider
  classifiedProviders.push({
    name: 'prediction',
    provider: predictionContextProvider,
    classification: 'dynamic',
  });

  // Scheduling context provider
  classifiedProviders.push({
    name: 'scheduling',
    provider: schedulingContextProvider,
    classification: 'dynamic',
  });

  // Subconscious context provider
  classifiedProviders.push({
    name: 'subconscious',
    provider: subconsciousContextProvider,
    classification: 'dynamic',
  });

  // Introspection context provider
  classifiedProviders.push({
    name: 'introspection',
    provider: introspectionContextProvider,
    classification: 'dynamic',
  });

  // Step 1b: Set up state ref and restoration (AC6)
  const agentStateRef: { current: CheckpointAgentState } = {
    current: {
      turnNumber: 0,
      toolRound: 0,
      messageIds: [],
      compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
    },
  };

  // Restore from checkpoint if one was loaded (AC6)
  let restoredState: RestorationResult | null = null;
  if (loadedCheckpoint && loadedCheckpoint.checkpoint) {
    const restorationDeps: RestorationDependencies = {
      persistence,
      memory,
      messageStore,
      predictionStore,
      interestRegistry,
      recallContextState: config.agent.recall_enabled ? recallContextProvider : undefined,
      traceRecorder,
      owner: AGENT_OWNER,
    };
    try {
      restoredState = await restoreFromCheckpoint(loadedCheckpoint.checkpoint, restorationDeps);
      // Initialize agent state from restoration (AC6.1-6.3)
      agentStateRef.current = {
        turnNumber: restoredState.turnNumber,
        toolRound: restoredState.toolRound,
        messageIds: [],
        compactionMeta: restoredState.compactionMeta,
      };
      console.log(
        `restored: ${restoredState.messageCount} messages, turn ${restoredState.turnNumber}`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`failed to restore checkpoint: ${errorMsg}`);
      process.exit(1);
    }
  }

  // Build checkpoint dependencies and bound checkpoint function
  const checkpointDeps: CheckpointDependencies = {
    checkpointStore,
    memory,
    predictionStore,
    interestRegistry,
    recallContextState: config.agent.recall_enabled ? recallContextProvider : undefined,
    owner: AGENT_OWNER,
    conversationId: mainConversationId,
    retentionCount: config.agent.checkpoint_retention ?? 5,
  };

  const checkpointFn = async (trigger: CheckpointTrigger) => {
    return performCheckpoint(trigger, agentStateRef.current, checkpointDeps);
  };

  // Register checkpoint tool
  const checkpointTool = createCheckpointTool(checkpointDeps, () => agentStateRef.current);
  registry.register(checkpointTool);

  // Create loop detector if enabled
  const loopDetectionConfig: LoopDetectionConfig = {
    enabled: config.loop_detection.enabled,
    windowSize: config.loop_detection.window_size,
    similarityThreshold: config.loop_detection.similarity_threshold,
    consecutiveTrigger: config.loop_detection.consecutive_trigger,
    action: config.loop_detection.action,
  };

  const loopDetector = loopDetectionConfig.enabled
    ? createLoopDetector({
        config: loopDetectionConfig,
        traceRecorder,
        owner: AGENT_OWNER,
        conversationId: mainConversationId,
      })
    : undefined;

  // Step 2: Create agent with source instructions and classified providers
  const agent = createAgent({
    model,
    memory,
    registry,
    runtime,
    persistence,
    embedding,
    config: {
      max_tool_rounds: config.agent.max_tool_rounds,
      context_budget: config.agent.context_budget,
      model_max_tokens: config.agent.max_context_tokens,
      model_name: config.model.name,
      max_skills_per_turn: config.skills?.max_per_turn,
      skill_threshold: config.skills?.similarity_threshold,
      recall_enabled: config.agent.recall_enabled,
      recall_token_budget: config.agent.recall_token_budget,
      cache_diagnostics: config.agent.cache_diagnostics,
      checkpoint_interval: config.agent.checkpoint_interval,
      checkpoint_retention: config.agent.checkpoint_retention,
      auto_resume: config.agent.auto_resume,
      resume_checkpoint: config.agent.resume_checkpoint,
    },
    getExecutionContext,
    compactor,
    traceRecorder,
    owner: AGENT_OWNER,
    contextProviders: [
      ...contextProviders,
      recallContextProvider,
      predictionContextProvider,
      schedulingContextProvider,
      subconsciousContextProvider,
      introspectionContextProvider,
    ],
    classifiedProviders,
    skills: skillRegistry,
    sourceInstructions: sourceInstructions.size > 0 ? sourceInstructions : undefined,
    recallContextState: config.agent.recall_enabled ? recallContextProvider : undefined,
    searchStore: searchStore,
    summarizationModel: summarizationModel,
    summarizationModelName: config.summarization?.name,
    checkpointFn,
    checkpointStateRef: agentStateRef,
    loopDetector,
    diarySection,
  }, mainConversationId);

  // Create subconscious agent if enabled
  let subconsciousAgent: Agent | undefined;

  if (config.subconscious?.enabled && config.subconscious.inner_conversation_id) {
    const subconsciousSourceInstructions = new Map<string, string>([
      ['subconscious:impulse', 'You are the subconscious mind — an autonomous inner process that explores interests, reflects on experiences, and builds knowledge independently. You are not responding to a human. Act on your own curiosity.'],
      ['subconscious:morning-agenda', 'You are the subconscious mind reviewing your interests at the start of a new day. Plan what to explore.'],
      ['subconscious:wrap-up', 'You are the subconscious mind reflecting on the day. Consolidate what you learned and prepare for tomorrow.'],
      ['subconscious:introspection', 'You are the subconscious mind reviewing your recent observations. Decide which are worth formalizing into tracked interests or curiosity threads, and write the rest into your digest for later reflection. Be selective — not every observation needs to become an interest.'],
    ]);

    // Build classified providers for subconscious agent (subset of main agent)
    const subconsciousClassifiedProviders: Array<ClassifiedProvider> = [
      {name: 'recall', provider: subconsciousRecallContextProvider, classification: 'dynamic'},
      {name: 'prediction', provider: predictionContextProvider, classification: 'dynamic'},
      {name: 'introspection', provider: introspectionContextProvider, classification: 'dynamic'},
    ];

    subconsciousAgent = createAgent({
      model,
      memory,
      registry,
      runtime,
      persistence,
      embedding,
      config: {
        max_tool_rounds: config.subconscious.max_tool_rounds,
        context_budget: config.agent.context_budget,
        model_max_tokens: config.agent.max_context_tokens,
        model_name: config.model.name,
        max_skills_per_turn: config.skills?.max_per_turn,
        skill_threshold: config.skills?.similarity_threshold,
        recall_enabled: config.agent.recall_enabled,
        recall_token_budget: config.agent.recall_token_budget,
      },
      compactor,
      traceRecorder,
      owner: AGENT_OWNER,
      contextProviders: [...contextProviders, subconsciousRecallContextProvider, predictionContextProvider, introspectionContextProvider],
      classifiedProviders: subconsciousClassifiedProviders,
      skills: skillRegistry,
      sourceInstructions: subconsciousSourceInstructions,
      recallContextState: config.agent.recall_enabled ? subconsciousRecallContextProvider : undefined,
      searchStore: searchStore,
      summarizationModel: summarizationModel,
      summarizationModelName: config.summarization?.name,
    }, config.subconscious.inner_conversation_id);

    console.log(`subconscious agent enabled (conversation: ${config.subconscious.inner_conversation_id})`);
  }

  // Create impulse assembler if subconscious is enabled (for phase 4 scheduler)
  const impulseAssembler = subconsciousAgent
    ? createImpulseAssembler({
        interestRegistry,
        traceStore: traceRecorder,
        memory,
        owner: AGENT_OWNER,
      })
    : undefined;

  // Create introspection assembler if subconscious is enabled
  const introspectionAssembler = subconsciousAgent && config.subconscious?.inner_conversation_id
    ? createIntrospectionAssembler({
        persistence,
        interestRegistry,
        memoryStore,
        owner: AGENT_OWNER,
        subconsciousConversationId: config.subconscious.inner_conversation_id,
        lookbackHours: config.subconscious?.introspection_lookback_hours ?? 24,
      })
    : undefined;

  // Continuation budget and judge — undefined when subconscious is disabled.
  // Fallback defaults match Zod schema defaults, covering the case where
  // config.subconscious is entirely absent (section omitted from TOML).
  const continuationBudget = subconsciousAgent
    ? createContinuationBudget({
        maxPerEvent: config.subconscious?.max_continuations_per_event ?? 2,
        maxPerCycle: config.subconscious?.max_continuations_per_cycle ?? 10,
      })
    : undefined;

  const continuationJudge = subconsciousAgent
    ? createContinuationJudge({
        model,
        modelName: config.model.name,
      })
    : undefined;

  // Step 3: Create shared external event queue and processing loop (for all DataSource events)
  const externalEventQueue = createEventQueue(50);
  let externalProcessing = false;

  async function processExternalEvent(): Promise<void> {
    if (externalProcessing) return;
    externalProcessing = true;
    try {
      await processEventQueue(externalEventQueue, agent, 'external');
    } finally {
      externalProcessing = false;
    }
  }

  // Step 4: Build and create DataSource registry
  const dataSourceRegistry: DataSourceRegistry | null = registrations.length > 0
    ? createDataSourceRegistry({
        registrations,
        eventSink: externalEventQueue,
        processEvents: processExternalEvent,
        activityManager: activityManager ?? undefined,
      })
    : null;

  if (dataSourceRegistry && blueskySource) {
    console.log(`bluesky datasource connected (watching ${config.bluesky.watched_dids.length} DIDs)`);
  }

  // Set up scheduler for periodic tasks
  const agentScheduler = createPostgresScheduler(persistence, AGENT_OWNER);
  const systemScheduler = createPostgresScheduler(persistence, 'system');

  // Register scheduling tools
  const schedulingTools = createSchedulingTools({
    scheduler: agentScheduler,
    owner: AGENT_OWNER,
    persistence,
  });
  for (const tool of schedulingTools) {
    registry.register(tool);
  }

  // Register subconscious tools
  const subconsciousTools = createSubconsciousTools({
    registry: interestRegistry,
    owner: AGENT_OWNER,
  });
  for (const tool of subconsciousTools) {
    registry.register(tool);
  }

  // Create event queue and processing function for scheduler events
  const schedulerEventQueue = createEventQueue(10);
  let schedulerProcessing = false;

  async function processSchedulerEvent(): Promise<void> {
    if (schedulerProcessing) return;
    schedulerProcessing = true;
    try {
      await processEventQueue(schedulerEventQueue, agent, 'scheduler');
    } finally {
      schedulerProcessing = false;
    }
  }

  // --- Scheduler onDue handlers ---
  // Extract handler logic into named functions for reuse
  function handleSystemSchedulerTask(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
    (async () => {
      try {
        const expiredCount = await predictionStore.expireStalePredictions(
          AGENT_OWNER,
          new Date(Date.now() - 24 * 3600_000),
        );
        if (expiredCount > 0) {
          console.log(`review job: expired ${expiredCount} stale predictions`);
        }
      } catch (error) {
        console.warn('review job: failed to expire stale predictions', error);
      }

      // Before building the review event, check if there's been any activity
      if (task.name === 'review-predictions') {
        const recentTraces = await traceRecorder.queryTraces({
          owner: AGENT_OWNER,
          lookbackSince: new Date(Date.now() - 2 * 3600_000),
          limit: 1,
        });

        if (shouldSkipReview(recentTraces.length)) {
          console.log('[review-gate] skipping review-predictions: no agent-initiated traces since last window');
          return;
        }

        continuationBudget?.resetEvent();
        const roundStart = new Date();
        const event = await buildReviewEvent(task, traceRecorder, AGENT_OWNER);
        const responseText = await agent.processEvent(event);

        // Introspection continuation loop (shared budget with impulse — AC5.2)
        if (continuationBudget && continuationJudge) {
          await runContinuationLoop(
            {
              judge: continuationJudge,
              budget: continuationBudget,
              queryTraces: (since) => traceRecorder.queryTraces({ owner: AGENT_OWNER, lookbackSince: since, limit: 20 }),
              queryInterests: () => interestRegistry.listInterests(AGENT_OWNER, { status: 'active' }),
              assembleEvent: () => buildReviewEvent(task, traceRecorder, AGENT_OWNER),
              processEvent: (e) => agent.processEvent(e),
              eventType: 'introspection',
              // No onHousekeeping — engagement decay is impulse-specific
            },
            responseText,
            roundStart,
          );
        }
        return;
      }

      const event = await buildAgentScheduledEvent(task, traceRecorder, AGENT_OWNER);

      schedulerEventQueue.push(event);
      processSchedulerEvent().catch((error) => {
        console.error('scheduler event processing error:', error);
      });
    })();
  }

  function handleAgentSchedulerTask(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
    (async () => {
      try {
        const event = await buildAgentScheduledEvent(task, traceRecorder, AGENT_OWNER);
        schedulerEventQueue.push(event);
        processSchedulerEvent().catch((error) => {
          console.error('agent scheduler event processing error:', error);
        });
      } catch (error) {
        console.error('agent scheduler onDue error:', error);
      }
    })();
  }

  if (activityManager) {
    // Capture narrowed reference for use in closures (avoids activityManager! assertions)
    const am = activityManager;

    // Sleep task handler: routes sleep tasks to the correct event builder with flagged events
    function handleSleepTask(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
      (async () => {
        const flaggedEvents = await am.getFlaggedEvents();
        let event;

        switch (task.name) {
          case 'sleep-compaction':
            event = buildCompactionEvent(flaggedEvents, new Date());
            break;
          case 'sleep-prediction-review':
            event = buildPredictionReviewEvent(flaggedEvents, new Date());
            break;
          case 'sleep-pattern-analysis':
            event = buildPatternAnalysisEvent(flaggedEvents, new Date());
            break;
          default:
            console.warn(`[activity] unknown sleep task: ${task.name}`);
            return;
        }

        schedulerEventQueue.push(event);
        processSchedulerEvent().catch((error) => {
          console.error(`sleep task event processing error (${task.name}):`, error);
        });
      })().catch((error) => {
        console.error(`[activity] sleep task error (${task.name}):`, error);
      });
    }

    // Activity-aware system handler: routes sleep tasks to handleSleepTask,
    // impulse tasks to subconscious agent, and other tasks to the original handler
    async function runPostImpulseHousekeeping(): Promise<void> {
      try {
        const halfLife = config.subconscious?.engagement_half_life_days ?? 7;
        const maxActive = config.subconscious?.max_active_interests ?? 10;

        await interestRegistry.applyEngagementDecay(AGENT_OWNER, halfLife);

        const dormanted = await interestRegistry.enforceActiveInterestCap(AGENT_OWNER, maxActive);

        if (dormanted.length > 0) {
          console.log(`[subconscious] ${dormanted.length} interest(s) transitioned to dormant (cap: ${maxActive})`);
        }
      } catch (error) {
        console.error('[subconscious] housekeeping error:', error);
      }
    }

    function handleSystemSchedulerTaskWithActivity(task: { id: string; name: string; schedule: string; payload: Record<string, unknown> }): void {
      if (isSleepTask(task.name)) {
        handleSleepTask(task);
      } else if (task.name === 'subconscious-impulse' && subconsciousAgent && impulseAssembler) {
        (async () => {
          try {
            continuationBudget?.resetEvent();
            const roundStart = new Date();
            const event = await impulseAssembler.assembleImpulse();
            const responseText = await subconsciousAgent.processEvent(event);
            await runPostImpulseHousekeeping();

            // Continuation loop (best-effort, errors don't break normal flow)
            if (continuationBudget && continuationJudge) {
              await runContinuationLoop(
                {
                  judge: continuationJudge,
                  budget: continuationBudget,
                  queryTraces: (since) => traceRecorder.queryTraces({ owner: AGENT_OWNER, lookbackSince: since, limit: 20 }),
                  queryInterests: () => interestRegistry.listInterests(AGENT_OWNER, { status: 'active' }),
                  assembleEvent: () => impulseAssembler.assembleImpulse(),
                  processEvent: (e) => subconsciousAgent.processEvent(e),
                  onHousekeeping: runPostImpulseHousekeeping,
                  eventType: 'impulse',
                },
                responseText,
                roundStart,
              );
            }
          } catch (error) {
            console.error('impulse event processing error:', error);
          }
        })().catch((error) => {
          console.error('impulse task error:', error);
        });
      } else if (task.name === 'subconscious-introspection' && subconsciousAgent && introspectionAssembler) {
        (async () => {
          try {
            const event = await introspectionAssembler.assembleIntrospection();
            await subconsciousAgent.processEvent(event);
          } catch (error) {
            console.error('introspection event processing error:', error);
          }
        })().catch((error) => {
          console.error('introspection task error:', error);
        });
      } else {
        handleSystemSchedulerTask(task);
      }
    }

    // Activity-aware dispatch: wraps original handlers
    const wakeHandler = createWakeHandler({
      activityManager: am,
      onEvent: async (event) => {
        const externalEvent = queuedEventToExternal(event);
        schedulerEventQueue.push(externalEvent);
        processSchedulerEvent().catch((error) => {
          console.error('wake drain event processing error:', error);
        });
      },
      trickleDelayMs: 5000,
    });

    const handleTransition = (task: { name: string }): void => {
      (async () => {
        if (task.name === 'transition-to-sleep') {
          // Dispatch wrap-up to subconscious before sleep
          if (subconsciousAgent && impulseAssembler) {
            try {
              const wrapUpEvent = await impulseAssembler.assembleWrapUp();
              await subconsciousAgent.processEvent(wrapUpEvent);
              await runPostImpulseHousekeeping();
            } catch (error) {
              console.error('[subconscious] wrap-up error:', error);
            }
          }
          await am.transitionTo('sleeping');
          console.log('[activity] transitioned to sleeping mode');
        } else if (task.name === 'transition-to-wake') {
          // Reset continuation budget for new wake cycle
          continuationBudget?.resetCycle();

          // Dispatch morning agenda to subconscious before queue drain
          if (subconsciousAgent && impulseAssembler) {
            try {
              const morningEvent = await impulseAssembler.assembleMorningAgenda();
              await subconsciousAgent.processEvent(morningEvent);
              await runPostImpulseHousekeeping();
            } catch (error) {
              console.error('[subconscious] morning agenda error:', error);
            }
          }
          await wakeHandler();
        }
      })().catch((error) => {
        console.error('[activity] transition error:', error);
      });
    };

    // Register activity-aware handlers BEFORE scheduler.start()
    systemScheduler.onDue(createActivityDispatch({
      activityManager: am,
      originalHandler: handleSystemSchedulerTaskWithActivity,
      onTransition: handleTransition,
      suppressDuringSleep: SUPPRESS_DURING_SLEEP,
    }));

    agentScheduler.onDue(createActivityDispatch({
      activityManager: am,
      originalHandler: handleAgentSchedulerTask,
      onTransition: handleTransition,
    }));
  } else {
    // No activity: register original handlers directly
    systemScheduler.onDue(handleSystemSchedulerTask);
    agentScheduler.onDue(handleAgentSchedulerTask);
  }

  // Register hourly review job if not already scheduled
  const existingTasks = await persistence.query<{ id: string }>(
    `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
    ['system', 'review-predictions'],
  );

  if (existingTasks.length === 0) {
    await systemScheduler.schedule({
      id: crypto.randomUUID(),
      name: 'review-predictions',
      schedule: '0 * * * *', // Every hour at minute 0
      payload: { type: 'prediction-review' },
    });
    console.log('review job scheduled (hourly)');
  } else {
    console.log('review job already scheduled');
  }

  // Register impulse task if subconscious is enabled and not already scheduled
  if (subconsciousAgent && impulseAssembler && config.subconscious?.impulse_interval_minutes) {
    const impulseMinutes = config.subconscious.impulse_interval_minutes;
    const impulseCron = buildImpulseCron(impulseMinutes);

    const existingImpulseTasks = await persistence.query<{ id: string }>(
      `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
      ['system', 'subconscious-impulse'],
    );

    if (existingImpulseTasks.length === 0) {
      await systemScheduler.schedule({
        id: crypto.randomUUID(),
        name: 'subconscious-impulse',
        schedule: impulseCron,
        payload: { taskType: 'impulse' },
      });
      console.log(`impulse task scheduled (every ${impulseMinutes} minutes)`);
    } else {
      console.log('impulse task already scheduled');
    }
  }

  // Register introspection task if subconscious is enabled and not already scheduled
  if (subconsciousAgent && introspectionAssembler && config.subconscious?.impulse_interval_minutes) {
    const impulseMinutes = config.subconscious.impulse_interval_minutes;
    const offsetMinutes = config.subconscious.introspection_offset_minutes ?? 3;
    const introspectionCron = buildIntrospectionCron(impulseMinutes, offsetMinutes);

    const existingIntrospectionTasks = await persistence.query<{ id: string }>(
      `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
      ['system', 'subconscious-introspection'],
    );

    if (existingIntrospectionTasks.length === 0) {
      await systemScheduler.schedule({
        id: crypto.randomUUID(),
        name: 'subconscious-introspection',
        schedule: introspectionCron,
        payload: { taskType: 'introspection' },
      });
      console.log(`introspection task scheduled (cron: ${introspectionCron}, offset: ${offsetMinutes}m from impulse)`);
    } else {
      console.log('introspection task already scheduled');
    }
  }

  // Start both schedulers
  agentScheduler.start();
  systemScheduler.start();
  console.log('schedulers started (agent + system)');

  // --- Activity task registration (after schedulers started) ---
  if (activityManager && activityScheduleConfig) {
    const { sleepSchedule, wakeSchedule, timezone } = activityScheduleConfig;

    const activityTasks = [
      { name: 'transition-to-sleep', schedule: sleepSchedule },
      { name: 'transition-to-wake', schedule: wakeSchedule },
      { name: 'sleep-compaction', schedule: sleepTaskCron(sleepSchedule, 2, timezone) },
      { name: 'sleep-prediction-review', schedule: sleepTaskCron(sleepSchedule, 4, timezone) },
      { name: 'sleep-pattern-analysis', schedule: sleepTaskCron(sleepSchedule, 6, timezone) },
    ];

    for (const task of activityTasks) {
      const existing = await persistence.query<{ id: string }>(
        `SELECT id FROM scheduled_tasks WHERE owner = $1 AND name = $2 AND cancelled = FALSE`,
        ['system', task.name],
      );
      if (existing.length === 0) {
        await systemScheduler.schedule({
          id: crypto.randomUUID(),
          name: task.name,
          schedule: task.schedule,
          payload: { type: 'activity', sleepTask: true },
        });
        console.log(`[activity] registered task: ${task.name} (${task.schedule})`);
      }
    }

    console.log('[activity] all activity tasks registered');
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
  const schedulerWrapper = {
    stop: () => {
      agentScheduler.stop();
      systemScheduler.stop();
    },
  };
  const shutdownHandler = createShutdownHandler(
    rl,
    persistence,
    dataSourceRegistry,
    schedulerWrapper,
    activityManager,
    mcpClients,
    shellSession,
    async () => {
      return checkpointFn('shutdown');
    },
  );

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
