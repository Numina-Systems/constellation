// pattern: Functional Core

// Interest source types
export type InterestSource = 'emergent' | 'seeded' | 'external';

// Interest status types
export type InterestStatus = 'active' | 'dormant' | 'abandoned';

// Curiosity thread status types
export type CuriosityStatus = 'open' | 'exploring' | 'resolved' | 'parked';

// Core domain types for interest registry
export type Interest = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly source: InterestSource;
  readonly engagementScore: number;
  readonly status: InterestStatus;
  readonly lastEngagedAt: Date;
  readonly createdAt: Date;
};

export type CuriosityThread = {
  readonly id: string;
  readonly interestId: string;
  readonly owner: string;
  readonly question: string;
  readonly status: CuriosityStatus;
  readonly resolution: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ExplorationLogEntry = {
  readonly id: string;
  readonly owner: string;
  readonly interestId: string | null;
  readonly curiosityThreadId: string | null;
  readonly action: string;
  readonly toolsUsed: ReadonlyArray<string>;
  readonly outcome: string;
  readonly createdAt: Date;
};

// Configuration for interest registry behavior
export type InterestRegistryConfig = {
  readonly engagementHalfLifeDays: number;
  readonly maxActiveInterests: number;
};

// Port interface for interest registry
export type InterestRegistry = {
  // Interest CRUD
  createInterest(
    interest: Omit<Interest, 'id' | 'createdAt' | 'lastEngagedAt'>
  ): Promise<Interest>;
  getInterest(id: string): Promise<Interest | null>;
  updateInterest(
    id: string,
    updates: Partial<
      Pick<Interest, 'name' | 'description' | 'engagementScore' | 'status'>
    >
  ): Promise<Interest | null>;
  listInterests(
    owner: string,
    filters?: {
      status?: InterestStatus;
      source?: InterestSource;
      minScore?: number;
    }
  ): Promise<ReadonlyArray<Interest>>;

  // Curiosity thread CRUD
  createCuriosityThread(
    thread: Omit<CuriosityThread, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CuriosityThread>;
  getCuriosityThread(id: string): Promise<CuriosityThread | null>;
  updateCuriosityThread(
    id: string,
    updates: Partial<Pick<CuriosityThread, 'status' | 'resolution'>>
  ): Promise<CuriosityThread | null>;
  listCuriosityThreads(
    interestId: string,
    filters?: { status?: CuriosityStatus }
  ): Promise<ReadonlyArray<CuriosityThread>>;
  findDuplicateCuriosityThread(
    interestId: string,
    question: string
  ): Promise<CuriosityThread | null>;

  // Exploration log
  logExploration(
    entry: Omit<ExplorationLogEntry, 'id' | 'createdAt'>
  ): Promise<ExplorationLogEntry>;
  listExplorationLog(
    owner: string,
    limit?: number
  ): Promise<ReadonlyArray<ExplorationLogEntry>>;

  // Engagement decay
  applyEngagementDecay(owner: string, halfLifeDays: number): Promise<number>;

  // Cap enforcement
  enforceActiveInterestCap(
    owner: string,
    maxActive: number
  ): Promise<ReadonlyArray<Interest>>;

  // Engagement bump
  bumpEngagement(interestId: string, amount: number): Promise<Interest | null>;
};
