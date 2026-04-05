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

  const modelObj = (parsed["model"] as Record<string, unknown>) ?? {};
  const modelProvider = modelObj["provider"] as string | undefined;
  const providerEnvKeys: Record<string, string> = {
    "openai-compat": "OPENAI_COMPAT_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
  };
  const envKeyName = modelProvider ? providerEnvKeys[modelProvider] : undefined;
  const modelEnvKey = envKeyName ? process.env[envKeyName] : undefined;

  if (modelEnvKey) {
    modelObj["api_key"] = modelEnvKey;
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

  if (process.env["BLUESKY_HANDLE"] || process.env["BLUESKY_APP_PASSWORD"]) {
    const blueskyObj = (parsed["bluesky"] as Record<string, unknown>) ?? {};
    blueskyObj["handle"] = process.env["BLUESKY_HANDLE"] ?? blueskyObj["handle"];
    blueskyObj["app_password"] = process.env["BLUESKY_APP_PASSWORD"] ?? blueskyObj["app_password"];
    envOverrides["bluesky"] = blueskyObj;
  }

  if (parsed["web"] && (process.env["BRAVE_API_KEY"] || process.env["TAVILY_API_KEY"])) {
    const webObj = parsed["web"] as Record<string, unknown>;
    if (process.env["BRAVE_API_KEY"]) {
      webObj["brave_api_key"] = process.env["BRAVE_API_KEY"];
    }
    if (process.env["TAVILY_API_KEY"]) {
      webObj["tavily_api_key"] = process.env["TAVILY_API_KEY"];
    }
    envOverrides["web"] = webObj;
  }

  if (parsed["email"] && (process.env["MAILGUN_API_KEY"] || process.env["MAILGUN_DOMAIN"])) {
    const emailObj = parsed["email"] as Record<string, unknown>;
    if (process.env["MAILGUN_API_KEY"]) {
      emailObj["mailgun_api_key"] = process.env["MAILGUN_API_KEY"];
    }
    if (process.env["MAILGUN_DOMAIN"]) {
      emailObj["mailgun_domain"] = process.env["MAILGUN_DOMAIN"];
    }
    envOverrides["email"] = emailObj;
  }

  if (parsed["spacemolt"] && (process.env["SPACEMOLT_PASSWORD"] || process.env["SPACEMOLT_USERNAME"])) {
    const spacemoltObj = parsed["spacemolt"] as Record<string, unknown>;
    if (process.env["SPACEMOLT_PASSWORD"]) {
      spacemoltObj["password"] = process.env["SPACEMOLT_PASSWORD"];
    }
    if (process.env["SPACEMOLT_USERNAME"]) {
      spacemoltObj["username"] = process.env["SPACEMOLT_USERNAME"];
    }
    envOverrides["spacemolt"] = spacemoltObj;
  }

  const merged = { ...parsed, ...envOverrides };
  return AppConfigSchema.parse(merged);
}

export type { AppConfig, AgentConfig, ModelConfig, OpenRouterConfig, EmbeddingConfig, DatabaseConfig, RuntimeConfig, BlueskyConfig, SummarizationConfig, WebConfig, EmailConfig, ActivityConfig, SpaceMoltConfig } from "./schema.ts";
