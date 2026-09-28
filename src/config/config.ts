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

  if (modelEnvKey?.trim()) {
    modelObj["api_key"] = modelEnvKey;
    envOverrides["model"] = modelObj;
  }

  if (parsed["summarization"]) {
    const summObj = parsed["summarization"] as Record<string, unknown>;
    const summProvider = summObj["provider"] as string | undefined;
    const summEnvKeyName = summProvider ? providerEnvKeys[summProvider] : undefined;
    const summEnvKey = summEnvKeyName ? process.env[summEnvKeyName] : undefined;
    if (summEnvKey?.trim()) {
      summObj["api_key"] = summEnvKey;
      envOverrides["summarization"] = summObj;
    }
  }

  const embeddingEnvKey = process.env["EMBEDDING_API_KEY"];
  if (embeddingEnvKey?.trim()) {
    const embeddingObj = (parsed["embedding"] as Record<string, unknown>) ?? {};
    embeddingObj["api_key"] = embeddingEnvKey;
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

  const braveEnvKey = process.env["BRAVE_API_KEY"];
  const tavilyEnvKey = process.env["TAVILY_API_KEY"];
  if (parsed["web"] && (braveEnvKey?.trim() || tavilyEnvKey?.trim())) {
    const webObj = parsed["web"] as Record<string, unknown>;
    if (braveEnvKey?.trim()) {
      webObj["brave_api_key"] = braveEnvKey;
    }
    if (tavilyEnvKey?.trim()) {
      webObj["tavily_api_key"] = tavilyEnvKey;
    }
    envOverrides["web"] = webObj;
  }

  const mailgunEnvKey = process.env["MAILGUN_API_KEY"];
  if (parsed["email"] && (mailgunEnvKey?.trim() || process.env["MAILGUN_DOMAIN"])) {
    const emailObj = parsed["email"] as Record<string, unknown>;
    if (mailgunEnvKey?.trim()) {
      emailObj["mailgun_api_key"] = mailgunEnvKey;
    }
    if (process.env["MAILGUN_DOMAIN"]) {
      emailObj["mailgun_domain"] = process.env["MAILGUN_DOMAIN"];
    }
    envOverrides["email"] = emailObj;
  }

  const merged = { ...parsed, ...envOverrides };
  return AppConfigSchema.parse(merged);
}

export type { AppConfig, AgentConfig, ModelConfig, OpenRouterConfig, EmbeddingConfig, DatabaseConfig, RuntimeConfig, BlueskyConfig, SummarizationConfig, WebConfig, EmailConfig, ActivityConfig } from "./schema.ts";
