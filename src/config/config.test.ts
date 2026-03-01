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

describe("loadConfig env var overrides", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = getTempConfigPath();
  });

  afterEach(() => {
    delete process.env["BLUESKY_HANDLE"];
    delete process.env["BLUESKY_APP_PASSWORD"];
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
