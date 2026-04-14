import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createInterestRegistry } from './persistence.ts';
import { buildImpulseEvent } from './impulse.ts';
import { createSubconsciousTools } from '../tool/builtin/subconscious.ts';

const TEST_OWNER = 'test-user-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let registry: ReturnType<typeof createInterestRegistry>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE exploration_log CASCADE');
  await persistence.query('TRUNCATE TABLE curiosity_threads CASCADE');
  await persistence.query('TRUNCATE TABLE interests CASCADE');
}

describe('subconscious.AC5: Interests emerge without prescribed topics', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    registry = createInterestRegistry(persistence);
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('subconscious.AC5.5: No interests are hardcoded or prescribed at startup', () => {
    it('interest registry starts with zero interests', async () => {
      const interests = await registry.listInterests(TEST_OWNER);
      expect(interests).toHaveLength(0);
    });

    it('migration does not seed any interests', async () => {
      const result = await persistence.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM interests',
      );
      expect(result[0]?.count).toBe('0');
    });
  });

  describe('subconscious.AC5.4: Starting from zero interests, the agent creates its first interests autonomously', () => {
    it('impulse with empty interests produces cold-start prompt', async () => {
      const event = buildImpulseEvent({
        interests: [],
        recentExplorations: [],
        recentTraces: [],
        recentMemories: [],
        timestamp: new Date(),
      });

      expect(event.content).toContain('You have no interests yet. What are you curious about?');
    });

    it('impulse with empty interests still includes Reflect/Generate/Act sections', async () => {
      const event = buildImpulseEvent({
        interests: [],
        recentExplorations: [],
        recentTraces: [],
        recentMemories: [],
        timestamp: new Date(),
      });

      expect(event.content).toContain('[Reflect]');
      expect(event.content).toContain('[Generate]');
      expect(event.content).toContain('[Act]');
    });
  });
});

describe('subconscious.AC3: Interest registry tracks what the agent cares about', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    registry = createInterestRegistry(persistence);
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('subconscious.AC3.4: Active interest count is capped', () => {
    it('post-impulse housekeeping applies decay then enforces cap in correct order', async () => {
      // Create 5 active interests with varying scores and backdated last_engaged_at
      const now = new Date();
      const interests = [];

      for (let i = 0; i < 5; i++) {
        const interest = await registry.createInterest({
          owner: TEST_OWNER,
          name: `Interest ${i}`,
          description: `Description for interest ${i}`,
          source: 'emergent',
          engagementScore: 5.0 - i, // Scores: 5, 4, 3, 2, 1
          status: 'active',
        });
        interests.push(interest);

        // Backdate last_engaged_at by i days (oldest first)
        const daysAgo = i;
        const backdatedDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        await persistence.query(
          'UPDATE interests SET last_engaged_at = $1 WHERE id = $2',
          [backdatedDate, interest.id],
        );
      }

      // Apply decay (7 day half-life)
      const decayedCount = await registry.applyEngagementDecay(TEST_OWNER, 7);
      expect(decayedCount === 5).toBe(true); // All 5 interests decayed

      // Get scores after decay to verify they changed
      const afterDecay = await registry.listInterests(TEST_OWNER);
      expect(afterDecay).toHaveLength(5);

      // Verify decay actually reduced scores (older interests have lower scores)
      const scores = afterDecay.map(i => i.engagementScore).sort((a, b) => b - a);
      expect(scores[0]! > scores[4]!).toBe(true); // Highest > lowest

      // Now enforce cap at 3 active interests
      const dormanted = await registry.enforceActiveInterestCap(TEST_OWNER, 3);

      // Should have dormanted 2 interests (the lowest-scoring ones)
      expect(dormanted).toHaveLength(2);

      // Verify dormanted interests are actually dormant
      const remaining = await registry.listInterests(TEST_OWNER);
      const activeCount = remaining.filter(i => i.status === 'active').length;
      expect(activeCount).toBe(3); // 3 active
    });

    it('housekeeping is safe to call when no interests exist', async () => {
      // Should not throw or fail
      const decayedCount = await registry.applyEngagementDecay(TEST_OWNER, 7);
      expect(decayedCount).toBe(0);

      const dormanted = await registry.enforceActiveInterestCap(TEST_OWNER, 10);
      expect(dormanted).toHaveLength(0);
    });
  });

  describe('subconscious.AC3.5: Duplicate curiosity threads are detected', () => {
    it('manage_curiosity create action detects duplicate and returns existing thread', async () => {
      // Create interest
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'For testing duplicates',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      // Create first thread via tool handler
      const tools = createSubconsciousTools({ registry, owner: TEST_OWNER });
      const curiosityTool = tools.find(t => t.definition.name === 'manage_curiosity');
      expect(curiosityTool).toBeDefined();

      const firstResult = await curiosityTool!.handler({
        action: 'create',
        interest_id: interest.id,
        question: 'How does X work?',
      });

      expect(firstResult.success).toBe(true);
      const firstThread = JSON.parse(firstResult.output);
      const firstThreadId = firstThread.id;

      // Try to create duplicate via tool handler
      const secondResult = await curiosityTool!.handler({
        action: 'create',
        interest_id: interest.id,
        question: 'How does X work?',
      });

      expect(secondResult.success).toBe(true);
      const secondThread = JSON.parse(secondResult.output);

      // Should return the existing thread, not create new one
      expect(secondThread.id).toBe(firstThreadId);
      expect(secondThread.status).toBe('open'); // Same thread, not modified

      // Verify only 1 thread in DB
      const threads = await registry.listCuriosityThreads(interest.id);
      expect(threads).toHaveLength(1);
    });

    it('case-insensitive duplicate detection', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'For testing case insensitivity',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const tools = createSubconsciousTools({ registry, owner: TEST_OWNER });
      const curiosityTool = tools.find(t => t.definition.name === 'manage_curiosity');

      // Create with mixed case
      const firstResult = await curiosityTool!.handler({
        action: 'create',
        interest_id: interest.id,
        question: 'How does X work?',
      });

      const firstThread = JSON.parse(firstResult.output);
      const firstThreadId = firstThread.id;

      // Try lowercase version
      const secondResult = await curiosityTool!.handler({
        action: 'create',
        interest_id: interest.id,
        question: 'how does x work?',
      });

      const secondThread = JSON.parse(secondResult.output);
      expect(secondThread.id).toBe(firstThreadId); // Should be same thread
    });

    it('resolved threads are not considered duplicates', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'For testing resolved exclusion',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      // Create first thread
      const firstThread = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'How does X work?',
        status: 'open',
        resolution: null,
      });

      // Resolve it
      await registry.updateCuriosityThread(firstThread.id, {
        status: 'resolved',
        resolution: 'X works by doing Y',
      });

      // Create new thread with same question via tool
      const tools = createSubconsciousTools({ registry, owner: TEST_OWNER });
      const curiosityTool = tools.find(t => t.definition.name === 'manage_curiosity');

      const newResult = await curiosityTool!.handler({
        action: 'create',
        interest_id: interest.id,
        question: 'How does X work?',
      });

      const newThread = JSON.parse(newResult.output);

      // Should create NEW thread because first is resolved
      expect(newThread.id).not.toBe(firstThread.id);
      expect(newThread.status).toBe('open');

      // Verify 2 threads in DB
      const threads = await registry.listCuriosityThreads(interest.id);
      expect(threads).toHaveLength(2);
    });

    it('different questions are not duplicates', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'For testing different questions',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const tools = createSubconsciousTools({ registry, owner: TEST_OWNER });
      const curiosityTool = tools.find(t => t.definition.name === 'manage_curiosity');

      // Create first thread
      const firstResult = await curiosityTool!.handler({
        action: 'create',
        interest_id: interest.id,
        question: 'How does X work?',
      });

      const firstThread = JSON.parse(firstResult.output);

      // Create second thread with different question
      const secondResult = await curiosityTool!.handler({
        action: 'create',
        interest_id: interest.id,
        question: 'How does Y work?',
      });

      const secondThread = JSON.parse(secondResult.output);

      // Should create NEW thread
      expect(secondThread.id).not.toBe(firstThread.id);

      // Verify 2 threads in DB
      const threads = await registry.listCuriosityThreads(interest.id);
      expect(threads).toHaveLength(2);
    });
  });
});
