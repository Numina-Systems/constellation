// pattern: Imperative Shell
import TOML from "@iarna/toml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppConfigSchema, type AppConfig } from "./schema.ts";

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = resolve(configPath ?? "config.toml");
  const raw = readFileSync(resolvedPath, "utf-8");
  const parsed = TOML.parse(raw);

  const envOverrides: Record<string, unknown> = {};

  if (process.env["ANTHROPIC_API_KEY"] || process.env["OPENAI_COMPAT_API_KEY"]) {
    const modelObj = (parsed["model"] as Record<string, unknown>) ?? {};
    modelObj["api_key"] =
      process.env["ANTHROPIC_API_KEY"] ??
      process.env["OPENAI_COMPAT_API_KEY"] ??
      modelObj["api_key"];
    envOverrides["model"] = modelObj;
  }

  if (process.env["EMBEDDING_API_KEY"]) {
    const embeddingObj = (parsed["embedding"] as Record<string, unknown>) ?? {};
    embeddingObj["api_key"] = process.env["EMBEDDING_API_KEY"] ?? embeddingObj["api_key"];
    envOverrides["embedding"] = embeddingObj;
  }

  if (process.env["DATABASE_URL"]) {
    envOverrides["database"] = { url: process.env["DATABASE_URL"] };
  }

  const merged = { ...parsed, ...envOverrides };
  return AppConfigSchema.parse(merged);
}

export type { AppConfig, AgentConfig, ModelConfig, EmbeddingConfig, DatabaseConfig, RuntimeConfig, SummarizationConfig } from "./schema.ts";
