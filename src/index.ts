// pattern: Imperative Shell

/**
 * Machine Spirit daemon entry point.
 * Composition root that wires all adapters and starts the interactive REPL.
 */


import * as readline from 'readline';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { BskyAgent } from '@atproto/api';
import { loadConfig } from '@/config/config';
import type { AppConfig } from '@/config/schema';
import { createPostgresProvider, createMessageStore, createConversationHistoryStore } from '@/persistence';
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
import { createBlueskySource, seedBlueskyTemplates } from '@/extensions/bluesky';
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
import { createPredictionStore, createTraceRecorder } from '@/reflexion';
import { createPredictionTools, createIntrospectionTools } from '@/reflexion';
import { createPredictionContextProvider } from '@/reflexion';
import { createPostgresScheduler } from '@/scheduler';
import { createMailgunSender, createEmailTools } from '@/email';
import { createSchedulingTools } from '@/tool/builtin/scheduling';
import { createSchedulingContextProvider } from '@/agent/scheduling-context';
import { createSubconsciousTools } from '@/tool/builtin/subconscious';
import {
  createInterestRegistry,
  createImpulseAssembler,
  createSubconsciousContextProvider,
  createIntrospectionAssembler,
  createIntrospectionContextProvider,
  createContinuationBudget,
  createContinuationJudge,
} from '@/subconscious';
import { createSearchStore, createMemorySearchDomain, createConversationSearchDomain } from '@/search';
import { createSearchTools } from '@/tool/builtin/search';
import {
  createActivityManager,
  createActivityContextProvider,
  currentMode,
} from '@/activity/index.ts';
import type { ActivityManager, ScheduleConfig } from '@/activity/index.ts';
import {
  createEventDrain,
  registerSchedulerHandlers,
  registerPreStartSystemTasks,
  registerPostStartSystemTasks,
} from '@/orchestration';
import type { MemoryManager } from '@/memory/manager';
import type { SkillRegistry } from '@/skill/types';
import type { CompactionConfig } from '@/compaction/types';
import type { Agent } from '@/agent/types';
import type { BlueskyDataSource } from '@/extensions/bluesky';
import type { ExecutionContext } from '@/runtime/types';
import type { PersistenceProvider } from '@/persistence/types';
import type { MemoryStore } from '@/memory/store';
import type { EmbeddingProvider } from '@/embedding/types';
import type { PendingMutation } from '@/memory/types';
import type { ModelProvider } from '@/model/types';
import type { TraceStore } from '@/reflexion';
import type { ContextProvider, ClassifiedProvider, CheckpointAgentState, CheckpointTrigger, SessionCheckpoint } from '@/agent';
import { createDataSourceRegistry } from '@/extensions/data-source-registry';
import type { DataSourceRegistration, DataSourceRegistry } from '@/extensions/data-source';
import { connectMcpServers, createMcpClient, createMcpInstructionsProvider, createMcpToolProvider, formatMcpStartupSummary, mcpPromptsToSkills, publishMcpRegistrations, resolveServerConfigEnv } from '@/mcp';
import type { McpClient } from '@/mcp';
import type { McpToolRegistration } from '@/mcp/types.ts';
import { createRecallContextProvider } from '@/recall/index.js';
import { createSkillsContextProvider } from '@/skill/index.js';
import { createWorkingMemoryContextProvider } from '@/memory/index.js';
import { buildDiarySection } from '@/diary';
import { createShellSession } from '@/shell/index';
import { createShellExecuteTool } from '@/tool/builtin/shell-execute';
import type { ShellSession } from '@/shell/types';
import { createCheckpointStore } from '@/persistence/checkpoint-store.ts';
import { performCheckpoint, type CheckpointDependencies } from '@/agent/checkpoint-create.ts';
import { type RestorationDependencies, type RestorationResult } from '@/agent/checkpoint-restore.ts';
import { createCheckpointTool } from '@/tool/builtin/checkpoint.ts';
import { createLoopDetector } from '@/loop-detection/index.js';
import type { LoopDetectionConfig } from '@/loop-detection/types.js';
import { createPostgresCustomToolStore, createCustomToolManager } from '@/custom-tool';
import { createCustomToolTools } from '@/tool/builtin/custom-tools';
import { createIngestor } from '@/ingest';
import { createIngestTool } from '@/tool/builtin/ingest';
import { createArchivistPipeline } from '@/archivist';
import type { ArchivistPipeline } from '@/archivist';
import { createCompositionSeam } from '@/composition-seam.ts';
import { createIntegrityLifecycle } from '@/agent/integrity-lifecycle.ts';

const AGENT_OWNER = 'spirit';

/** Build the durable compaction settings from validated application configuration. */
export function buildCompactionConfig(config: AppConfig): CompactionConfig {
  const summarization = config.summarization;
  return {
    chunkSize: summarization?.chunk_size ?? 20,
    keepRecent: summarization?.keep_recent ?? 5,
    maxSummaryTokens: summarization?.max_summary_tokens ?? 1024,
    clipFirst: summarization?.clip_first ?? 2,
    clipLast: summarization?.clip_last ?? 2,
    prompt: summarization?.prompt ?? null,
    scoring: summarization ? {
      roleWeightSystem: summarization.role_weight_system,
      roleWeightUser: summarization.role_weight_user,
      roleWeightAssistant: summarization.role_weight_assistant,
      recencyDecay: summarization.recency_decay,
      questionBonus: summarization.question_bonus,
      toolCallBonus: summarization.tool_call_bonus,
      keywordBonus: summarization.keyword_bonus,
      importantKeywords: summarization.important_keywords,
      contentLengthWeight: summarization.content_length_weight,
    } : undefined,
    timeout: summarization?.compaction_timeout ?? 120000,
    maxRetries: summarization?.compaction_max_retries ?? 2,
    maxChunkTokens: summarization?.max_chunk_tokens,
    maxConsecutiveFailures: summarization?.max_consecutive_failures ?? 3,
    cooldownMs: summarization?.cooldown_ms ?? 60000,
    contextWindow: summarization?.context_window,
    safetyMargin: summarization?.safety_margin,
  };
}

/** Side-effect-free composition helpers for factory-level tests and later startup wiring. */
export const COMPOSITION_SEAM = createCompositionSeam();

/** Production agent construction is routed through the injected composition seam. */
export const createProductionAgent = COMPOSITION_SEAM.createAgent;

export type CompactionRecoveryAction = (command: string) => Promise<string | null>;

type InteractionLoopDeps = {
  agent: Agent;
  memory: MemoryManager;
  persistence: PersistenceProvider;
  readline: readline.Interface;
  compactionRecovery?: CompactionRecoveryAction;
};

/**
 * Trusted, serialized operator recovery action for the compaction breaker.
 * It only inspects/resets the injected compactor through the composition seam;
 * it has no model or tool access and cannot be invoked by the agent.
 */
export function createCompactionRecoveryAction(compactor: import('@/compaction/types').Compactor): CompactionRecoveryAction {
  let tail: Promise<void> = Promise.resolve();
  return (command: string) => {
    let result: string | null = null;
    const run = tail.then(() => {
      const normalized = command.trim().toLowerCase();
      if (normalized === '/compaction status') {
        const status = COMPOSITION_SEAM.getCompactionStatus(compactor);
        result = status ? `compaction breaker: ${status.breaker.state} (failures=${status.consecutiveFailures}, intervention=${status.breaker.interventionRequired})` : 'compaction status unavailable';
      } else if (normalized === '/compaction reset') {
        COMPOSITION_SEAM.resetCompactionBreaker(compactor);
        result = 'compaction breaker reset';
      } else {
        result = null;
      }
    });
    tail = run.catch(() => undefined);
    return run.then(() => result);
  };
}

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
  agentShutdown?: () => Promise<void>,
): () => Promise<void> {
  let shuttingDown = false;
  return async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down...');
    if (agentShutdown) {
      try {
        await agentShutdown();
      } catch (error) {
        console.warn('[agent] shutdown drain failed:', error instanceof Error ? error.message : String(error));
      }
    }
    // The agent drain owns the shutdown checkpoint when available. Keep the
    // callback fallback for legacy callers that do not provide an agent.
    if (!agentShutdown && checkpointFn) {
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
 * Create an interaction loop that can be tested with mock dependencies.
 * Extracts REPL logic for testability.
 */
export function createInteractionLoop(deps: InteractionLoopDeps): (input: string) => Promise<void> {
  return async (userInput: string) => {
    if (deps.compactionRecovery) {
      const recoveryResponse = await deps.compactionRecovery(userInput);
      if (recoveryResponse !== null) {
        process.stdout.write(`\n${recoveryResponse}\n\n`);
        return;
      }
    }
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
  const historyStore = createConversationHistoryStore(persistence);

  const registry = createToolRegistry();

  // Step 1a: Create checkpoint store and load checkpoint for resume (AC6)
  const checkpointStore = createCheckpointStore(persistence);

  const resumeId = resumeCheckpointId ?? config.agent.resume_checkpoint;

  let loadedCheckpoint: {checkpoint: SessionCheckpoint; conversationId: string; mode: 'explicit' | 'auto'} | null = null;

  if (resumeId) {
    const checkpoint = await checkpointStore.load(resumeId);
    if (!checkpoint) {
      console.error(`error: checkpoint ${resumeId} not found`);
      process.exit(1);
    }
    console.log(`resuming from checkpoint ${resumeId} (conversation: ${checkpoint.conversationId})`);
    loadedCheckpoint = { checkpoint, conversationId: checkpoint.conversationId, mode: 'explicit' };
  } else if (config.agent.auto_resume) {
    const checkpoint = await checkpointStore.loadLatest(AGENT_OWNER);
    if (checkpoint) {
      console.log(`auto-resuming durable active history for conversation ${checkpoint.conversationId} (checkpoint metadata: ${checkpoint.id})`);
      loadedCheckpoint = { checkpoint, conversationId: checkpoint.conversationId, mode: 'auto' };
    } else {
      console.log('auto-resume enabled but no checkpoint found — starting fresh');
    }
  }

  // Generate conversation ID for main agent upfront so it can be shared with prediction tools
  // Use resumed conversation ID if available, otherwise generate a new one
  const mainConversationId = loadedCheckpoint?.conversationId ?? crypto.randomUUID();

  // Startup selection is a read-only boundary: auto-resume reads the durable active
  // projection, while explicit resume remains eligible for exact checkpoint restore.
  const integrityLifecycle = createIntegrityLifecycle(persistence, mainConversationId, historyStore);
  let startupSelection;
  try {
    startupSelection = await COMPOSITION_SEAM.selectStartup({
      conversationId: mainConversationId,
      historyStore,
      autoResume: loadedCheckpoint?.mode === 'auto',
      // Auto-resume uses the checkpoint only as conversation identity metadata;
      // passing it here would incorrectly select explicit_restore and rewind durable state.
      checkpoint: loadedCheckpoint?.mode === 'auto' ? null : (loadedCheckpoint?.checkpoint ?? null),
      recovery: () => integrityLifecycle.getRecoveryState(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`failed to select startup state: ${errorMsg}`);
    process.exit(1);
    startupSelection = {mode: 'recovery_required' as const, conversationId: mainConversationId, history: null, checkpoint: null, recoveryReason: errorMsg};
  }
  if (startupSelection.mode === 'recovery_required') {
    console.error(`startup refused: ${startupSelection.recoveryReason ?? 'conversation integrity recovery is required'}`);
    process.exit(1);
  }

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

  // Create skills context provider
  const skillsContextProvider = createSkillsContextProvider();

  // Create working memory context provider
  const workingMemoryContextProvider = createWorkingMemoryContextProvider();

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

  // Ingest tool (requires embedding for vector storage)
  if (embedding) {
    const ingestor = createIngestor({
      memoryStore,
      embedding,
      persistence,
      owner: AGENT_OWNER,
      workspaceRoot: resolve(config.runtime.working_dir),
    });
    registry.register(createIngestTool(ingestor));
    console.log('ingest tool registered');
  }

  const runtime = createDenoExecutor({ ...config.runtime, ...config.agent }, registry);

  // Custom tools system
  const customToolStore = createPostgresCustomToolStore(persistence);
  const customToolManager = createCustomToolManager({
    store: customToolStore,
    registry,
    runtime,
    secretResolver,
    resolveSecretsForCode: async (code) => {
      const keys = await secretResolver.listKeys();
      const referencedKeys = keys.filter(key => new RegExp(`(^|[^A-Za-z0-9_$])${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}($|[^A-Za-z0-9_$])`).test(code));
      return secretResolver.resolve(referencedKeys);
    },
    owner: AGENT_OWNER,
  });

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
    const configuredClients: Array<McpClient> = Object.entries(config.mcp.servers).map(([serverName, rawServerConfig]) => {
      const serverConfig = resolveServerConfigEnv(rawServerConfig, process.env);
      return createMcpClient(serverName, serverConfig, {traceRecorder, traceOwner: AGENT_OWNER});
    });
    console.log(`[mcp] connecting to ${configuredClients.length} server(s)...`);

    const startup = await connectMcpServers(configuredClients);
    mcpFailedServers.push(...startup.failed);

    const stagedProviders = new Map<string, ReturnType<typeof createMcpToolProvider>>();
    const stagedToolCounts = new Map<string, number>();
    const stagedRegistrations: Array<McpToolRegistration> = [];
    for (const client of startup.connected) {
      const provider = createMcpToolProvider(client);
      try {
        const registrations = await provider.discoverRegistrations();
        stagedRegistrations.push(...registrations);
        stagedProviders.set(client.serverName, provider);
        stagedToolCounts.set(client.serverName, registrations.length);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await client.disconnect().catch(() => undefined);
        mcpFailedServers.push({name: client.serverName, error: errorMsg});
        console.error(`[mcp:${client.serverName}] failed during discovery: ${errorMsg}`);
        console.error(`[mcp] continuing without ${client.serverName}`);
      }
    }

    try {
      publishMcpRegistrations(registry, stagedRegistrations);
    } catch (error) {
      await Promise.allSettled(startup.connected.map((client) => client.disconnect()));
      throw error;
    }
    for (const client of startup.connected) {
      const provider = stagedProviders.get(client.serverName);
      const toolCount = stagedToolCounts.get(client.serverName);
      if (!provider || toolCount === undefined) continue;
      mcpClients.push(client);
      console.log(`[mcp:${client.serverName}] registered ${toolCount} tool(s)`);

      if (skillRegistry) {
        try {
          const skills = await mcpPromptsToSkills(client);
          if (skills.length > 0) {
            await skillRegistry.injectSkills(skills);
            console.log(`[mcp:${client.serverName}] injected ${skills.length} skill(s)`);
          }
        } catch (error) {
          console.error(`[mcp:${client.serverName}] prompt discovery failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      try {
        const instructions = await client.getInstructions();
        if (instructions) {
          const mcpProvider = createMcpInstructionsProvider(client.serverName, instructions);
          contextProviders.push(mcpProvider);
          mcpInstructionsProviders.set(client.serverName, mcpProvider);
        }
      } catch (error) {
        console.error(`[mcp:${client.serverName}] instruction discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`[mcp] ${formatMcpStartupSummary(mcpClients.map((client) => client.serverName), mcpFailedServers)}`);
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

  // Cached secrets with 60-second TTL to reduce DB round-trips
  let cachedSecrets: Record<string, string> | null = null;
  let secretsCacheExpiry = 0;
  const SECRET_CACHE_TTL_MS = 60000; // 60 seconds

  // Getter reads fresh tokens from the DataSource at execution time.
  // Shared by both REPL and Bluesky agents so either can post to Bluesky.
  // Returns undefined when bluesky is not connected, so the sandbox
  // simply won't have BSKY_* constants available.
  const getExecutionContext = async (): Promise<ExecutionContext> => {
    // Return cached secrets if still valid
    const now = Date.now();
    let secrets: Record<string, string>;
    if (cachedSecrets && now < secretsCacheExpiry) {
      secrets = cachedSecrets;
    } else {
      // Fetch and cache secrets
      const allKeys = await secretResolver.listKeys();
      secrets = await secretResolver.resolve(allKeys);
      cachedSecrets = secrets;
      secretsCacheExpiry = now + SECRET_CACHE_TTL_MS;
    }

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

  // Create compactor with configuration from validated application config.
  const compactionConfig = buildCompactionConfig(config);

  const compactor = createCompactor({
    model: summarizationModel,
    memory,
    persistence,
    historyStore,
    config: compactionConfig,
    modelName: config.summarization?.name ?? config.model.name,
  });

  // --- Archivist Pipeline (opt-in) ---
  let archivistPipeline: ArchivistPipeline | null = null;

  if (config.archivist?.enabled !== false) {
    archivistPipeline = createArchivistPipeline({
      memoryStore,
      memoryManager: memory,
      embedding: embedding ?? null,
      summarizationModel: summarizationModel ?? null,
      persistence,
      owner: AGENT_OWNER,
      modelName: config.summarization?.name ?? config.model.name,
      dedupThreshold: config.archivist?.dedup_threshold ?? 0.92,
      crossrefThreshold: config.archivist?.crossref_threshold ?? 0.75,
      tokenBudget: config.archivist?.token_budget ?? 50000,
    });
    console.log('archivist pipeline created');
  }

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

  // Skills context provider
  classifiedProviders.push({
    name: 'skills',
    provider: skillsContextProvider,
    classification: 'dynamic',
  });

  // Working memory context provider
  classifiedProviders.push({
    name: 'working-memory',
    provider: workingMemoryContextProvider,
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

  // Explicit resume is the only startup mode that mutates history or memory. Auto-resume
  // trusts the durable active projection selected above and never replays checkpoint state.
  let restoredState: RestorationResult | null = null;
  if (startupSelection.mode === 'explicit_restore' && loadedCheckpoint?.checkpoint) {
    const restorationDeps: RestorationDependencies = {
      persistence,
      memory,
      messageStore,
      historyStore,
      integrityLifecycle,
      predictionStore,
      interestRegistry,
      recallContextState: config.agent.recall_enabled ? recallContextProvider : undefined,
      traceRecorder,
      owner: AGENT_OWNER,
    };
    try {
      restoredState = await COMPOSITION_SEAM.restoreCheckpoint(loadedCheckpoint.checkpoint, restorationDeps);
      const active = await historyStore.readActive(mainConversationId);
      agentStateRef.current = {
        turnNumber: restoredState.turnNumber,
        toolRound: restoredState.toolRound,
        messageIds: active.messages.map(message => message.id),
        transcriptRevision: active.revision,
        activeArchiveIds: loadedCheckpoint.checkpoint.version === 2 ? loadedCheckpoint.checkpoint.activeArchiveIds : [],
        provenanceRefs: loadedCheckpoint.checkpoint.version === 2 ? loadedCheckpoint.checkpoint.provenanceRefs : [],
        compactionMeta: restoredState.compactionMeta,
      };
      console.log(`restored exact history: ${active.messages.length} messages, revision ${active.revision}, turn ${restoredState.turnNumber}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`failed to restore checkpoint: ${errorMsg}`);
      process.exit(1);
    }
  } else if (startupSelection.mode === 'auto_resume' && startupSelection.history) {
    const active = startupSelection.history;
    agentStateRef.current = {
      turnNumber: 0,
      toolRound: 0,
      messageIds: active.messages.map(message => message.id),
      transcriptRevision: active.revision,
      activeArchiveIds: loadedCheckpoint?.checkpoint.version === 2 ? loadedCheckpoint.checkpoint.activeArchiveIds : [],
      provenanceRefs: loadedCheckpoint?.checkpoint.version === 2 ? loadedCheckpoint.checkpoint.provenanceRefs : [],
      compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
    };
    console.log(`auto-resume selected ${active.messages.length} durable active messages at revision ${active.revision}`);
  }

  // Build checkpoint dependencies and bound checkpoint function
  const checkpointDeps: CheckpointDependencies = {
    checkpointStore,
    persistence,
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

  // Load persisted custom tools
  await customToolManager.loadAll();
  console.log('custom tools loaded');

  // Register custom tool management tools
  const customToolTools = createCustomToolTools(customToolManager);
  for (const tool of customToolTools) {
    registry.register(tool);
  }
  console.log('custom tool management tools registered');

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
  const agent = createProductionAgent({
    model,
    memory,
    registry,
    runtime,
    persistence,
    historyStore,
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
    skillsContextState: skillsContextProvider,
    sourceInstructions: sourceInstructions.size > 0 ? sourceInstructions : undefined,
    recallContextState: config.agent.recall_enabled ? recallContextProvider : undefined,
    searchStore: searchStore,
    summarizationModel: summarizationModel,
    summarizationModelName: config.summarization?.name,
    checkpointFn,
    checkpointStateRef: agentStateRef,
    integrityLifecycle,
    loopDetector,
    diarySection,
    workingMemoryContextState: workingMemoryContextProvider,
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

    // Give the subconscious agent isolated mutable context holders so concurrent turns
    // cannot overwrite the main agent's snapshot state.
    const subconsciousSkillsContextProvider = createSkillsContextProvider();
    const subconsciousWorkingMemoryContextProvider = createWorkingMemoryContextProvider();
    const subconsciousLoopDetector = loopDetectionConfig.enabled
      ? createLoopDetector({
          config: loopDetectionConfig,
          traceRecorder,
          owner: AGENT_OWNER,
          conversationId: config.subconscious.inner_conversation_id,
        })
      : undefined;

    // Build classified providers for subconscious agent (subset of main agent)
    const subconsciousClassifiedProviders: Array<ClassifiedProvider> = [
      {name: 'recall', provider: subconsciousRecallContextProvider, classification: 'dynamic'},
      {name: 'skills', provider: subconsciousSkillsContextProvider, classification: 'dynamic'},
      {name: 'working-memory', provider: subconsciousWorkingMemoryContextProvider, classification: 'dynamic'},
      {name: 'prediction', provider: predictionContextProvider, classification: 'dynamic'},
      {name: 'introspection', provider: introspectionContextProvider, classification: 'dynamic'},
    ];

    subconsciousAgent = createProductionAgent({
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
      skillsContextState: subconsciousSkillsContextProvider,
      workingMemoryContextState: subconsciousWorkingMemoryContextProvider,
      sourceInstructions: subconsciousSourceInstructions,
      recallContextState: config.agent.recall_enabled ? subconsciousRecallContextProvider : undefined,
      searchStore: searchStore,
      summarizationModel: summarizationModel,
      summarizationModelName: config.summarization?.name,
      loopDetector: subconsciousLoopDetector,
    }, config.subconscious.inner_conversation_id);

    console.log(`subconscious agent enabled (conversation: ${config.subconscious.inner_conversation_id})`);
  }

  // Create archivist sub-agent for full pipeline runs during sleep (if enabled and configured)
  let archivistAgent: Agent | null = null;

  if (archivistPipeline && config.archivist?.inner_conversation_id) {
    const archivistWorkingMemoryContextProvider = createWorkingMemoryContextProvider();
    const archivistSourceInstructions = new Map<string, string>([
      ['sleep-task', `You are the archivist — a background knowledge maintenance agent.
When you receive a sleep task event, run the full archivist pipeline to maintain knowledge health.
Focus on knowledge quality, deduplication, cross-referencing, and organization.
Report a brief summary of actions taken.`],
    ]);

    archivistAgent = createProductionAgent({
      model,
      memory,
      registry,
      runtime,
      persistence,
      historyStore,
      embedding,
      config: { ...config.agent, max_tool_rounds: 3 },
      owner: AGENT_OWNER,
      sourceInstructions: archivistSourceInstructions,
      contextProviders: [],
      classifiedProviders: [
        {name: 'working-memory', provider: archivistWorkingMemoryContextProvider, classification: 'dynamic'},
      ],
      workingMemoryContextState: archivistWorkingMemoryContextProvider,
    }, config.archivist.inner_conversation_id);

    console.log('archivist sub-agent created');
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

  const externalDrain = createEventDrain({ capacity: 50, agent, sourceLabel: 'external' });

  // Step 4: Build and create DataSource registry
  const dataSourceRegistry: DataSourceRegistry | null = registrations.length > 0
    ? createDataSourceRegistry({
        registrations,
        eventSink: externalDrain.queue,
        processEvents: () => externalDrain.drain(),
        activityManager: activityManager ?? undefined,
      })
    : null;

  if (dataSourceRegistry && blueskySource) {
    console.log(`bluesky datasource connected (watching ${config.bluesky.watched_dids.length} DIDs)`);
  }

  // Set up scheduler for periodic tasks
  const agentScheduler = createPostgresScheduler(persistence, AGENT_OWNER, {pollOffsetMs: 0});
  const systemScheduler = createPostgresScheduler(persistence, 'system', {pollOffsetMs: 15000});

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

  const schedulerDrain = createEventDrain({ capacity: 10, agent, sourceLabel: 'scheduler' });

  // Register handlers before starting either scheduler.
  registerSchedulerHandlers({
    systemScheduler,
    agentScheduler,
    owner: AGENT_OWNER,
    agent,
    subconsciousAgent,
    archivistAgent,
    archivistPipeline,
    predictionStore,
    traceStore: traceRecorder,
    interestRegistry,
    impulseAssembler,
    introspectionAssembler,
    continuationBudget,
    continuationJudge,
    activityManager,
    schedulerSink: schedulerDrain,
    engagementHalfLifeDays: config.subconscious?.engagement_half_life_days ?? 7,
    maxActiveInterests: config.subconscious?.max_active_interests ?? 10,
    trickleDelayMs: 5000,
  });

  // Register default system tasks before schedulers start
  await registerPreStartSystemTasks({
    persistence,
    systemScheduler,
    owner: 'system',
    hasImpulse: Boolean(subconsciousAgent && impulseAssembler),
    hasIntrospection: Boolean(subconsciousAgent && introspectionAssembler),
    impulseIntervalMinutes: config.subconscious?.impulse_interval_minutes,
    introspectionOffsetMinutes: config.subconscious?.introspection_offset_minutes,
  });

  // Start both schedulers
  agentScheduler.start();
  systemScheduler.start();
  console.log('schedulers started (agent + system)');

  // Register archivist and activity tasks after schedulers start
  await registerPostStartSystemTasks({
    persistence,
    systemScheduler,
    owner: 'system',
    archivistEnabled: config.archivist?.enabled !== false,
    incrementalCron: config.archivist?.incremental_cron,
    sleepOffsetHours: config.archivist?.sleep_offset_hours,
    activityScheduleConfig,
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
    compactionRecovery: createCompactionRecoveryAction(compactor),
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
    agent.shutdown ? async () => {
      await agent.shutdown!();
    } : undefined,
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
