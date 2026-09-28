/**
 * Authoritative retained-history contracts live with the persistence adapter.
 * This module is a compatibility barrel; the former compaction-only contract
 * diverged from the implemented store and is superseded.
 */
import type {ConversationHistoryStore as AuthoritativeHistoryStore, HistoryReceipt, PreparedCompactionPlan} from '@/persistence/conversation-history-store.ts';

export type {
  ActiveHistory,
  ArchiveBlockInput,
  ConversationHistoryStore,
  HistoricalMessage,
  HistoryMessageInput,
  HistoryReceipt,
  HistoryStateUnknownError,
  PreparedCompactionPlan,
} from '@/persistence/conversation-history-store.ts';

export type HistoryRevision = Pick<import('@/persistence/conversation-history-store.ts').ActiveHistory, 'conversationId' | 'revision'>;
export type HistoryReadResult = import('@/persistence/conversation-history-store.ts').ActiveHistory;
export type CompactionPlan = PreparedCompactionPlan;
export type CompactionReceipt = HistoryReceipt;
export type CompactionStore = Pick<AuthoritativeHistoryStore, 'commitCompaction'>;
