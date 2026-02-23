// pattern: Functional Core

export type { EmbeddingProvider } from "./types.js";
export { createOpenAIEmbeddingAdapter } from "./openai.js";
export { createOllamaEmbeddingAdapter } from "./ollama.js";
export { createEmbeddingProvider } from "./factory.js";
