import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createInterestRegistry } from './persistence.ts';

const TEST_OWNER = 'test-user-' + Math.random().toString(36).substring(7);
const TEST_OWNER_2 = 'test-user-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let registry: ReturnType<typeof createInterestRegistry>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE exploration_log CASCADE');
  await persistence.query('TRUNCATE TABLE curiosity_threads CASCADE');
  await persistence.query('TRUNCATE TABLE interests CASCADE');
}

describe('InterestRegistry', () => {
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

  describe('subconscious.AC3.1: Create interest with all fields', () => {
    it('creates an interest with name, description, source, and engagement score', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Machine Learning',
        description: 'Interest in learning how ML models work',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      expect(interest.id).toBeTruthy();
      expect(interest.owner).toBe(TEST_OWNER);
      expect(interest.name).toBe('Machine Learning');
      expect(interest.description).toBe('Interest in learning how ML models work');
      expect(interest.source).toBe('emergent');
      expect(interest.engagementScore).toBe(1.0);
      expect(interest.status).toBe('active');
      expect(interest.createdAt).toBeInstanceOf(Date);
      expect(interest.lastEngagedAt).toBeInstanceOf(Date);
    });

    it('supports all three source values: emergent, seeded, external', async () => {
      const emergent = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Emergent Interest',
        description: 'Naturally arose',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });
      expect(emergent.source).toBe('emergent');

      const seeded = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Seeded Interest',
        description: 'Planted by system',
        source: 'seeded',
        engagementScore: 1.0,
        status: 'active',
      });
      expect(seeded.source).toBe('seeded');

      const external = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'External Interest',
        description: 'From user input',
        source: 'external',
        engagementScore: 1.0,
        status: 'active',
      });
      expect(external.source).toBe('external');
    });

    it('retrieves created interest with getInterest', async () => {
      const created = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Blockchain',
        description: 'Understanding distributed systems',
        source: 'external',
        engagementScore: 2.5,
        status: 'active',
      });

      const retrieved = await registry.getInterest(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('Blockchain');
      expect(retrieved!.engagementScore).toBe(2.5);
    });

    it('lists interests filtered by owner', async () => {
      const int1 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Interest A',
        description: 'Owner 1',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const int2 = await registry.createInterest({
        owner: TEST_OWNER_2,
        name: 'Interest B',
        description: 'Owner 2',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const owner1List = await registry.listInterests(TEST_OWNER);
      const owner2List = await registry.listInterests(TEST_OWNER_2);

      expect(owner1List).toHaveLength(1);
      expect(owner1List[0]?.id).toBe(int1.id);

      expect(owner2List).toHaveLength(1);
      expect(owner2List[0]?.id).toBe(int2.id);
    });
  });

  describe('subconscious.AC3.2: Curiosity thread state transitions', () => {
    it('creates a curiosity thread within an interest', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Science',
        description: 'General science curiosity',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const thread = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'How do photons behave?',
        status: 'open',
        resolution: null,
      });

      expect(thread.id).toBeTruthy();
      expect(thread.interestId).toBe(interest.id);
      expect(thread.owner).toBe(TEST_OWNER);
      expect(thread.question).toBe('How do photons behave?');
      expect(thread.status).toBe('open');
      expect(thread.resolution).toBeNull();
      expect(thread.createdAt).toBeInstanceOf(Date);
      expect(thread.updatedAt).toBeInstanceOf(Date);
    });

    it('transitions curiosity thread from open -> exploring -> resolved', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Physics',
        description: 'Physics questions',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const thread = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is quantum entanglement?',
        status: 'open',
        resolution: null,
      });

      expect(thread.status).toBe('open');

      const exploring = await registry.updateCuriosityThread(thread.id, {
        status: 'exploring',
      });

      expect(exploring!.status).toBe('exploring');

      const resolved = await registry.updateCuriosityThread(thread.id, {
        status: 'resolved',
        resolution: 'Entanglement is a phenomenon where particles remain connected regardless of distance.',
      });

      expect(resolved!.status).toBe('resolved');
      expect(resolved!.resolution).toBe('Entanglement is a phenomenon where particles remain connected regardless of distance.');
    });

    it('transitions curiosity thread from open -> parked', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Philosophy',
        description: 'Philosophical questions',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const thread = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is consciousness?',
        status: 'open',
        resolution: null,
      });

      const parked = await registry.updateCuriosityThread(thread.id, {
        status: 'parked',
      });

      expect(parked!.status).toBe('parked');
    });

    it('lists curiosity threads filtered by status', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Math',
        description: 'Math questions',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is zero divided by zero?',
        status: 'open',
        resolution: null,
      });

      await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is infinity?',
        status: 'open',
        resolution: null,
      });

      const resolved = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is pi?',
        status: 'resolved',
        resolution: 'Pi is approximately 3.14159...',
      });

      const openThreads = await registry.listCuriosityThreads(interest.id, { status: 'open' });
      const resolvedThreads = await registry.listCuriosityThreads(interest.id, { status: 'resolved' });

      expect(openThreads).toHaveLength(2);
      expect(resolvedThreads).toHaveLength(1);
      expect(resolvedThreads[0]?.id).toBe(resolved.id);
    });

    it('retrieves a curiosity thread by id', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'History',
        description: 'Historical questions',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const created = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'When did the Renaissance begin?',
        status: 'open',
        resolution: null,
      });

      const retrieved = await registry.getCuriosityThread(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.question).toBe('When did the Renaissance begin?');
    });
  });

  describe('Interest and thread updates', () => {
    it('updates interest name and description', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Old Name',
        description: 'Old description',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const updated = await registry.updateInterest(interest.id, {
        name: 'New Name',
        description: 'New description',
      });

      expect(updated!.name).toBe('New Name');
      expect(updated!.description).toBe('New description');
    });

    it('updates interest status', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'Testing',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const dormant = await registry.updateInterest(interest.id, {
        status: 'dormant',
      });

      expect(dormant!.status).toBe('dormant');
    });

    it('updates interest engagement score', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'Testing',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const increased = await registry.updateInterest(interest.id, {
        engagementScore: 5.0,
      });

      expect(increased!.engagementScore).toBe(5.0);
    });

    it('updates lastEngagedAt when interest is updated', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'Testing',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const originalEngagedAt = interest.lastEngagedAt.getTime();

      // Wait a tiny bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await registry.updateInterest(interest.id, {
        name: 'Updated Name',
      });

      expect(updated!.lastEngagedAt.getTime()).toBeGreaterThan(originalEngagedAt);
    });
  });

  describe('Exploration logging', () => {
    it('logs an exploration entry', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'Testing',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const logEntry = await registry.logExploration({
        owner: TEST_OWNER,
        interestId: interest.id,
        curiosityThreadId: null,
        action: 'searched for information',
        toolsUsed: ['web_search', 'summarize'],
        outcome: 'Found 3 relevant articles',
      });

      expect(logEntry.id).toBeTruthy();
      expect(logEntry.owner).toBe(TEST_OWNER);
      expect(logEntry.interestId).toBe(interest.id);
      expect(logEntry.action).toBe('searched for information');
      expect(logEntry.toolsUsed).toEqual(['web_search', 'summarize']);
      expect(logEntry.outcome).toBe('Found 3 relevant articles');
      expect(logEntry.createdAt).toBeInstanceOf(Date);
    });

    it('lists exploration log with limit', async () => {
      for (let i = 0; i < 5; i++) {
        await registry.logExploration({
          owner: TEST_OWNER,
          interestId: null,
          curiosityThreadId: null,
          action: `action ${i}`,
          toolsUsed: [],
          outcome: `outcome ${i}`,
        });
      }

      const all = await registry.listExplorationLog(TEST_OWNER);
      const limited = await registry.listExplorationLog(TEST_OWNER, 2);

      expect(all).toHaveLength(5);
      expect(limited).toHaveLength(2);
    });

    it('lists exploration log ordered by created_at DESC', async () => {
      const log1 = await registry.logExploration({
        owner: TEST_OWNER,
        interestId: null,
        curiosityThreadId: null,
        action: 'first',
        toolsUsed: [],
        outcome: 'outcome 1',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const log2 = await registry.logExploration({
        owner: TEST_OWNER,
        interestId: null,
        curiosityThreadId: null,
        action: 'second',
        toolsUsed: [],
        outcome: 'outcome 2',
      });

      const logs = await registry.listExplorationLog(TEST_OWNER);

      expect(logs).toHaveLength(2);
      expect(logs[0]!.id).toBe(log2.id);
      expect(logs[1]!.id).toBe(log1.id);
    });
  });

  describe('Engagement bumping', () => {
    it('bumps engagement score and updates lastEngagedAt', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'Testing',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const originalEngagedAt = interest.lastEngagedAt.getTime();
      await new Promise(resolve => setTimeout(resolve, 10));

      const bumped = await registry.bumpEngagement(interest.id, 2.5);

      expect(bumped!.engagementScore).toBe(3.5);
      expect(bumped!.lastEngagedAt.getTime()).toBeGreaterThan(originalEngagedAt);
    });

    it('returns null when bumping non-existent interest', async () => {
      const result = await registry.bumpEngagement('non-existent-id', 1.0);
      expect(result).toBeNull();
    });
  });

  describe('Owner isolation', () => {
    it('interests from owner A are not visible to owner B', async () => {
      const intA = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Interest A',
        description: 'Belongs to A',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const intB = await registry.createInterest({
        owner: TEST_OWNER_2,
        name: 'Interest B',
        description: 'Belongs to B',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const listA = await registry.listInterests(TEST_OWNER);
      const listB = await registry.listInterests(TEST_OWNER_2);

      expect(listA).toHaveLength(1);
      expect(listA[0]?.id).toBe(intA.id);

      expect(listB).toHaveLength(1);
      expect(listB[0]?.id).toBe(intB.id);
    });
  });

  describe('Filtering interests', () => {
    it('filters interests by status', async () => {
      const active1 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Active 1',
        description: 'Active',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const dormant1 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Dormant 1',
        description: 'Dormant',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'dormant',
      });

      const activeList = await registry.listInterests(TEST_OWNER, { status: 'active' });
      const dormantList = await registry.listInterests(TEST_OWNER, { status: 'dormant' });

      expect(activeList).toHaveLength(1);
      expect(activeList[0]?.id).toBe(active1.id);

      expect(dormantList).toHaveLength(1);
      expect(dormantList[0]?.id).toBe(dormant1.id);
    });

    it('filters interests by source', async () => {
      const emergent = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Emergent',
        description: 'Emergent source',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const seeded = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Seeded',
        description: 'Seeded source',
        source: 'seeded',
        engagementScore: 1.0,
        status: 'active',
      });

      const emergentList = await registry.listInterests(TEST_OWNER, { source: 'emergent' });
      const seededList = await registry.listInterests(TEST_OWNER, { source: 'seeded' });

      expect(emergentList).toHaveLength(1);
      expect(emergentList[0]?.id).toBe(emergent.id);

      expect(seededList).toHaveLength(1);
      expect(seededList[0]?.id).toBe(seeded.id);
    });

    it('filters interests by minimum score', async () => {
      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Low Score',
        description: 'Low',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'High Score',
        description: 'High',
        source: 'emergent',
        engagementScore: 5.0,
        status: 'active',
      });

      const above3 = await registry.listInterests(TEST_OWNER, { minScore: 3.0 });

      expect(above3).toHaveLength(1);
      expect(above3[0]?.name).toBe('High Score');
    });

    it('orders interests by engagement score descending', async () => {
      const int1 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 1',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const int3 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 3',
        description: 'Test',
        source: 'emergent',
        engagementScore: 3.0,
        status: 'active',
      });

      const int2 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 2',
        description: 'Test',
        source: 'emergent',
        engagementScore: 2.0,
        status: 'active',
      });

      const list = await registry.listInterests(TEST_OWNER);

      expect(list[0]?.id).toBe(int3.id);
      expect(list[1]?.id).toBe(int2.id);
      expect(list[2]?.id).toBe(int1.id);
    });
  });

  describe('subconscious.AC3.3: Engagement score decay', () => {
    it('decays engagement scores with half-life formula', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Decay Test',
        description: 'Test decay',
        source: 'emergent',
        engagementScore: 100.0,
        status: 'active',
      });

      // Backdate last_engaged_at to 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await persistence.query(
        'UPDATE interests SET last_engaged_at = $1 WHERE id = $2',
        [tenDaysAgo.toISOString(), interest.id],
      );

      // Apply decay with 10-day half-life
      const updatedCount = await registry.applyEngagementDecay(TEST_OWNER, 10);

      expect(updatedCount).toBe(1);

      const updated = await registry.getInterest(interest.id);

      // After 10 days with 10-day half-life, score should be ~50
      expect(updated!.engagementScore).toBeCloseTo(50.0, 1);
    });

    it('decays only active interests', async () => {
      const active = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Active',
        description: 'Active',
        source: 'emergent',
        engagementScore: 100.0,
        status: 'active',
      });

      const dormant = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Dormant',
        description: 'Dormant',
        source: 'emergent',
        engagementScore: 100.0,
        status: 'dormant',
      });

      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await persistence.query(
        'UPDATE interests SET last_engaged_at = $1 WHERE id IN ($2, $3)',
        [tenDaysAgo.toISOString(), active.id, dormant.id],
      );

      const updatedCount = await registry.applyEngagementDecay(TEST_OWNER, 10);

      expect(updatedCount).toBe(1);

      const updatedActive = await registry.getInterest(active.id);
      const updatedDormant = await registry.getInterest(dormant.id);

      expect(updatedActive!.engagementScore).toBeCloseTo(50.0, 1);
      expect(updatedDormant!.engagementScore).toBe(100.0);
    });

    it('recent interests decay minimally', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Recent',
        description: 'Recent',
        source: 'emergent',
        engagementScore: 100.0,
        status: 'active',
      });

      // Just engaged (last_engaged_at is NOW())
      const updatedCount = await registry.applyEngagementDecay(TEST_OWNER, 10);

      expect(updatedCount).toBe(1);

      const updated = await registry.getInterest(interest.id);

      // Should still be very close to 100
      expect(updated!.engagementScore).toBeCloseTo(100.0, 0);
    });
  });

  describe('subconscious.AC3.4: Active interest cap enforcement', () => {
    it('caps active interests to max, dormanting lowest-scoring', async () => {
      const int1 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 1',
        description: 'Low',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const int2 = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 2',
        description: 'Low-Mid',
        source: 'emergent',
        engagementScore: 2.0,
        status: 'active',
      });

      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 3',
        description: 'Mid',
        source: 'emergent',
        engagementScore: 3.0,
        status: 'active',
      });

      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 4',
        description: 'High',
        source: 'emergent',
        engagementScore: 4.0,
        status: 'active',
      });

      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Score 5',
        description: 'Highest',
        source: 'emergent',
        engagementScore: 5.0,
        status: 'active',
      });

      const dormanted = await registry.enforceActiveInterestCap(TEST_OWNER, 3);

      expect(dormanted).toHaveLength(2);

      const dormantedIds = dormanted.map(i => i.id).sort();
      const expectedIds = [int1.id, int2.id].sort();
      expect(dormantedIds).toEqual(expectedIds);

      // Verify they're dormant
      const dormantList = await registry.listInterests(TEST_OWNER, { status: 'dormant' });
      const activeList = await registry.listInterests(TEST_OWNER, { status: 'active' });

      expect(dormantList).toHaveLength(2);
      expect(activeList).toHaveLength(3);
    });

    it('is idempotent when already at cap', async () => {
      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test 1',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test 2',
        description: 'Test',
        source: 'emergent',
        engagementScore: 2.0,
        status: 'active',
      });

      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test 3',
        description: 'Test',
        source: 'emergent',
        engagementScore: 3.0,
        status: 'active',
      });

      // First enforcement
      const dormanted1 = await registry.enforceActiveInterestCap(TEST_OWNER, 3);
      expect(dormanted1).toHaveLength(0);

      // Second enforcement with same cap
      const dormanted2 = await registry.enforceActiveInterestCap(TEST_OWNER, 3);
      expect(dormanted2).toHaveLength(0);

      const activeList = await registry.listInterests(TEST_OWNER, { status: 'active' });
      expect(activeList).toHaveLength(3);
    });

    it('returns empty array when under cap', async () => {
      await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test 1',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const dormanted = await registry.enforceActiveInterestCap(TEST_OWNER, 10);

      expect(dormanted).toHaveLength(0);
    });
  });

  describe('subconscious.AC3.5: Duplicate curiosity thread detection', () => {
    it('finds duplicate curiosity thread with same question', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const thread = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'How does quantum computing work?',
        status: 'open',
        resolution: null,
      });

      const duplicate = await registry.findDuplicateCuriosityThread(
        interest.id,
        'How does quantum computing work?',
      );

      expect(duplicate).not.toBeNull();
      expect(duplicate!.id).toBe(thread.id);
    });

    it('finds duplicate with case-insensitive matching', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const thread = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'How Does Quantum Computing Work?',
        status: 'open',
        resolution: null,
      });

      const duplicate = await registry.findDuplicateCuriosityThread(
        interest.id,
        'how does quantum computing work?',
      );

      expect(duplicate).not.toBeNull();
      expect(duplicate!.id).toBe(thread.id);
    });

    it('does not return resolved threads as duplicates', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is gravity?',
        status: 'resolved',
        resolution: 'Gravity is a fundamental force.',
      });

      const duplicate = await registry.findDuplicateCuriosityThread(
        interest.id,
        'What is gravity?',
      );

      expect(duplicate).toBeNull();
    });

    it('returns null for different question', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'Question A',
        status: 'open',
        resolution: null,
      });

      const duplicate = await registry.findDuplicateCuriosityThread(
        interest.id,
        'Question B',
      );

      expect(duplicate).toBeNull();
    });

    it('returns first non-resolved duplicate', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test',
        description: 'Test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      const first = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is time?',
        status: 'open',
        resolution: null,
      });

      // Create same question again - different thread
      const second = await registry.createCuriosityThread({
        interestId: interest.id,
        owner: TEST_OWNER,
        question: 'What is time?',
        status: 'exploring',
        resolution: null,
      });

      const duplicate = await registry.findDuplicateCuriosityThread(
        interest.id,
        'What is time?',
      );

      expect(duplicate).not.toBeNull();
      // Should find one of the non-resolved threads
      expect([first.id, second.id]).toContain(duplicate!.id);
    });
  });
});
