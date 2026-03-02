// pattern: Functional Core

export interface SkillStore {
  upsertEmbedding(id: string, name: string, description: string, contentHash: string, embedding: ReadonlyArray<number>): Promise<void>;
  deleteEmbedding(id: string): Promise<void>;
  getByHash(id: string): Promise<string | null>;
  searchByEmbedding(embedding: ReadonlyArray<number>, limit: number, threshold: number): Promise<ReadonlyArray<{ id: string; score: number }>>;
  getAllIds(): Promise<ReadonlyArray<string>>;
}
