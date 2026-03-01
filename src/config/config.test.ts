// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "./config.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const getTempConfigPath = () => {
  const tempDir = Bun.env["TMPDIR"] ?? "/tmp";
  return join(tempDir, `test-config-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`);
};

const baseTomlContent = `
[model]
provider = "anthropic"
name = "claude-3-5-sonnet-20241022"

[embedding]
provider = "openai"
model = "text-embedding-3-small"

[database]
url = "postgresql://localhost/test"
`;

const openaiCompatTomlContent = `
[model]
provider = "openai-compat"
name = "kimi-k2.5"
base_url = "https://api.moonshot.ai/v1"

[embedding]
provider = "openai"
model = "text-embedding-3-small"

[database]
url = "postgresql://localhost/test"
`;

describe("loadConfig env var overrides", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = getTempConfigPath();
  });

  afterEach(() => {
    delete process.env["BLUESKY_HANDLE"];
    delete process.env["BLUESKY_APP_PASSWORD"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_COMPAT_API_KEY"];
    try {
      unlinkSync(tempPath);
    } catch {
      // file might not exist
    }
  });

  describe("bsky-datasource.AC4.3: BLUESKY_HANDLE env var overrides TOML value", () => {
    it("should override handle when BLUESKY_HANDLE env var is set", () => {
      const tomlContent = `
${baseTomlContent}
[bluesky]
enabled = true
handle = "toml-handle.bsky.social"
app_password = "xxxx-xxxx-xxxx-xxxx"
did = "did:plc:example"
`;
      writeFileSync(tempPath, tomlContent);

      process.env["BLUESKY_HANDLE"] = "env-handle.bsky.social";

      const config = loadConfig(tempPath);

      expect(config.bluesky.handle).toBe("env-handle.bsky.social");
      expect(config.bluesky.app_password).toBe("xxxx-xxxx-xxxx-xxxx");
    });

    it("should use BLUESKY_HANDLE even when TOML handle is missing", () => {
      const tomlContent = `
${baseTomlContent}
[bluesky]
enabled = true
app_password = "xxxx-xxxx-xxxx-xxxx"
did = "did:plc:example"
`;
      writeFileSync(tempPath, tomlContent);

      process.env["BLUESKY_HANDLE"] = "env-handle.bsky.social";

      const config = loadConfig(tempPath);

      expect(config.bluesky.handle).toBe("env-handle.bsky.social");
    });
  });

  describe("bsky-datasource.AC4.4: BLUESKY_APP_PASSWORD env var overrides TOML value", () => {
    it("should override app_password when BLUESKY_APP_PASSWORD env var is set", () => {
      const tomlContent = `
${baseTomlContent}
[bluesky]
enabled = true
handle = "spirit.bsky.social"
app_password = "toml-password"
did = "did:plc:example"
`;
      writeFileSync(tempPath, tomlContent);

      process.env["BLUESKY_APP_PASSWORD"] = "env-password";

      const config = loadConfig(tempPath);

      expect(config.bluesky.app_password).toBe("env-password");
      expect(config.bluesky.handle).toBe("spirit.bsky.social");
    });

    it("should use BLUESKY_APP_PASSWORD even when TOML app_password is missing", () => {
      const tomlContent = `
${baseTomlContent}
[bluesky]
enabled = true
handle = "spirit.bsky.social"
did = "did:plc:example"
`;
      writeFileSync(tempPath, tomlContent);

      process.env["BLUESKY_APP_PASSWORD"] = "env-password";

      const config = loadConfig(tempPath);

      expect(config.bluesky.app_password).toBe("env-password");
    });
  });

  describe("model API key env overrides respect provider", () => {
    it("should use ANTHROPIC_API_KEY for anthropic provider", () => {
      writeFileSync(tempPath, baseTomlContent);
      process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";

      const config = loadConfig(tempPath);
      expect(config.model.api_key).toBe("sk-ant-test");
    });

    it("should use OPENAI_COMPAT_API_KEY for openai-compat provider", () => {
      writeFileSync(tempPath, openaiCompatTomlContent);
      process.env["OPENAI_COMPAT_API_KEY"] = "sk-moonshot-test";

      const config = loadConfig(tempPath);
      expect(config.model.api_key).toBe("sk-moonshot-test");
    });

    it("should not use ANTHROPIC_API_KEY for openai-compat provider", () => {
      const toml = `${openaiCompatTomlContent}\n`;
      writeFileSync(tempPath, toml);
      process.env["ANTHROPIC_API_KEY"] = "sk-ant-wrong";

      const config = loadConfig(tempPath);
      expect(config.model.api_key).toBeUndefined();
    });

    it("should not use OPENAI_COMPAT_API_KEY for anthropic provider", () => {
      writeFileSync(tempPath, baseTomlContent);
      process.env["OPENAI_COMPAT_API_KEY"] = "sk-compat-wrong";

      const config = loadConfig(tempPath);
      expect(config.model.api_key).toBeUndefined();
    });

    it("should prefer env var over TOML api_key", () => {
      const toml = openaiCompatTomlContent + 'api_key = "toml-key"\n';
      writeFileSync(tempPath, toml);
      process.env["OPENAI_COMPAT_API_KEY"] = "env-key";

      const config = loadConfig(tempPath);
      expect(config.model.api_key).toBe("env-key");
    });
  });

  describe("env var priority", () => {
    it("should handle both BLUESKY_HANDLE and BLUESKY_APP_PASSWORD together", () => {
      const tomlContent = `
${baseTomlContent}
[bluesky]
enabled = true
handle = "toml-handle.bsky.social"
app_password = "toml-password"
did = "did:plc:example"
`;
      writeFileSync(tempPath, tomlContent);

      process.env["BLUESKY_HANDLE"] = "env-handle.bsky.social";
      process.env["BLUESKY_APP_PASSWORD"] = "env-password";

      const config = loadConfig(tempPath);

      expect(config.bluesky.handle).toBe("env-handle.bsky.social");
      expect(config.bluesky.app_password).toBe("env-password");
      expect(config.bluesky.did).toBe("did:plc:example");
    });

    it("should use TOML values when env vars are not set", () => {
      const tomlContent = `
${baseTomlContent}
[bluesky]
enabled = true
handle = "toml-handle.bsky.social"
app_password = "toml-password"
did = "did:plc:example"
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.bluesky.handle).toBe("toml-handle.bsky.social");
      expect(config.bluesky.app_password).toBe("toml-password");
    });
  });
});
