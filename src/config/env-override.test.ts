// pattern: Imperative Shell
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

describe("openrouter-provider.AC1.3: OPENROUTER_API_KEY env override", () => {
  let configPath: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Create a temp config file
    configPath = join(tmpdir(), `test-config-${Date.now()}.toml`);

    // Save original env vars
    originalEnv["OPENROUTER_API_KEY"] = process.env["OPENROUTER_API_KEY"];
    originalEnv["ANTHROPIC_API_KEY"] = process.env["ANTHROPIC_API_KEY"];
    originalEnv["OPENAI_COMPAT_API_KEY"] = process.env["OPENAI_COMPAT_API_KEY"];
  });

  afterEach(() => {
    // Restore original env vars
    if (originalEnv["OPENROUTER_API_KEY"] === undefined) {
      delete process.env["OPENROUTER_API_KEY"];
    } else {
      process.env["OPENROUTER_API_KEY"] = originalEnv["OPENROUTER_API_KEY"];
    }
    if (originalEnv["ANTHROPIC_API_KEY"] === undefined) {
      delete process.env["ANTHROPIC_API_KEY"];
    } else {
      process.env["ANTHROPIC_API_KEY"] = originalEnv["ANTHROPIC_API_KEY"];
    }
    if (originalEnv["OPENAI_COMPAT_API_KEY"] === undefined) {
      delete process.env["OPENAI_COMPAT_API_KEY"];
    } else {
      process.env["OPENAI_COMPAT_API_KEY"] = originalEnv["OPENAI_COMPAT_API_KEY"];
    }

    // Clean up temp file
    try {
      rmSync(configPath);
    } catch {
      // ignore
    }
  });

  it("should use OPENROUTER_API_KEY env var when provider is openrouter", () => {
    const tomlContent = `
[model]
provider = "openrouter"
name = "anthropic/claude-sonnet-4"

[embedding]
provider = "openai"
model = "text-embedding-3-small"

[database]
url = "postgresql://localhost/test"
`;
    writeFileSync(configPath, tomlContent);
    process.env["OPENROUTER_API_KEY"] = "sk-or-test-key-12345";

    const config = loadConfig(configPath);

    expect(config.model.provider).toBe("openrouter");
    expect(config.model.api_key).toBe("sk-or-test-key-12345");
  });

  it("should prefer ANTHROPIC_API_KEY when provider is anthropic (not openrouter)", () => {
    const tomlContent = `
[model]
provider = "anthropic"
name = "claude-3-sonnet-20240229"

[embedding]
provider = "openai"
model = "text-embedding-3-small"

[database]
url = "postgresql://localhost/test"
`;
    writeFileSync(configPath, tomlContent);
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-anthropic-key";
    process.env["OPENROUTER_API_KEY"] = "sk-or-ignored-key";

    const config = loadConfig(configPath);

    expect(config.model.provider).toBe("anthropic");
    expect(config.model.api_key).toBe("sk-ant-anthropic-key");
  });

  it("should prefer OPENAI_COMPAT_API_KEY when provider is openai-compat", () => {
    const tomlContent = `
[model]
provider = "openai-compat"
name = "gpt-4"
base_url = "https://api.openai.com/v1"

[embedding]
provider = "openai"
model = "text-embedding-3-small"

[database]
url = "postgresql://localhost/test"
`;
    writeFileSync(configPath, tomlContent);
    process.env["OPENAI_COMPAT_API_KEY"] = "sk-openai-compat-key";
    process.env["OPENROUTER_API_KEY"] = "sk-or-ignored-key";

    const config = loadConfig(configPath);

    expect(config.model.provider).toBe("openai-compat");
    expect(config.model.api_key).toBe("sk-openai-compat-key");
  });

  it("should use config api_key when env var is not set", () => {
    const tomlContent = `
[model]
provider = "openrouter"
name = "anthropic/claude-sonnet-4"
api_key = "sk-or-config-key"

[embedding]
provider = "openai"
model = "text-embedding-3-small"

[database]
url = "postgresql://localhost/test"
`;
    writeFileSync(configPath, tomlContent);
    delete process.env["OPENROUTER_API_KEY"];

    const config = loadConfig(configPath);

    expect(config.model.provider).toBe("openrouter");
    expect(config.model.api_key).toBe("sk-or-config-key");
  });
});
