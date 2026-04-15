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
    delete process.env["MAILGUN_API_KEY"];
    delete process.env["MAILGUN_DOMAIN"];
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

  describe("agent-email.AC3.3: MAILGUN_API_KEY and MAILGUN_DOMAIN env vars override TOML values", () => {
    it("should override mailgun_api_key when MAILGUN_API_KEY env var is set", () => {
      const tomlContent = `
${baseTomlContent}
[email]
mailgun_api_key = "toml-key"
mailgun_domain = "example.com"
from_address = "noreply@example.com"
allowed_recipients = ["user@example.com"]
`;
      writeFileSync(tempPath, tomlContent);

      process.env["MAILGUN_API_KEY"] = "env-key";

      const config = loadConfig(tempPath);

      expect(config.email?.mailgun_api_key).toBe("env-key");
      expect(config.email?.mailgun_domain).toBe("example.com");
    });

    it("should override mailgun_domain when MAILGUN_DOMAIN env var is set", () => {
      const tomlContent = `
${baseTomlContent}
[email]
mailgun_api_key = "test-key"
mailgun_domain = "toml.domain.com"
from_address = "noreply@toml.domain.com"
allowed_recipients = ["user@example.com"]
`;
      writeFileSync(tempPath, tomlContent);

      process.env["MAILGUN_DOMAIN"] = "env.domain.com";

      const config = loadConfig(tempPath);

      expect(config.email?.mailgun_domain).toBe("env.domain.com");
      expect(config.email?.mailgun_api_key).toBe("test-key");
    });

    it("should preserve TOML values when no env vars are set", () => {
      const tomlContent = `
${baseTomlContent}
[email]
mailgun_api_key = "toml-key"
mailgun_domain = "toml.domain.com"
from_address = "noreply@toml.domain.com"
allowed_recipients = ["user@example.com"]
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.email?.mailgun_api_key).toBe("toml-key");
      expect(config.email?.mailgun_domain).toBe("toml.domain.com");
    });

    it("should override both mailgun_api_key and mailgun_domain when both env vars are set", () => {
      const tomlContent = `
${baseTomlContent}
[email]
mailgun_api_key = "toml-key"
mailgun_domain = "toml.domain.com"
from_address = "noreply@toml.domain.com"
allowed_recipients = ["user@example.com"]
`;
      writeFileSync(tempPath, tomlContent);

      process.env["MAILGUN_API_KEY"] = "env-key";
      process.env["MAILGUN_DOMAIN"] = "env.domain.com";

      const config = loadConfig(tempPath);

      expect(config.email?.mailgun_api_key).toBe("env-key");
      expect(config.email?.mailgun_domain).toBe("env.domain.com");
    });
  });
});

describe("GH-24: agent max_context_tokens configuration", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = getTempConfigPath();
  });

  afterEach(() => {
    try {
      unlinkSync(tempPath);
    } catch {
      // file might not exist
    }
  });

  it("defaults to 200000 when not specified", () => {
    writeFileSync(tempPath, baseTomlContent);

    const config = loadConfig(tempPath);

    expect(config.agent.max_context_tokens).toBe(200000);
  });

  it("uses configured value when specified", () => {
    const tomlContent = `
${baseTomlContent}
[agent]
max_context_tokens = 131072
`;
    writeFileSync(tempPath, tomlContent);

    const config = loadConfig(tempPath);

    expect(config.agent.max_context_tokens).toBe(131072);
  });
});

describe("skills.AC3: Skill configuration", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = getTempConfigPath();
  });

  afterEach(() => {
    try {
      unlinkSync(tempPath);
    } catch {
      // file might not exist
    }
  });

  describe("skills.AC3.1: Config parses [skills] section with all fields", () => {
    it("should parse [skills] section with all four fields", () => {
      const tomlContent = `
${baseTomlContent}
[skills]
builtin_dir = "/opt/skills"
agent_dir = "/home/user/skills"
max_per_turn = 5
similarity_threshold = 0.7
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.skills).toBeDefined();
      expect(config.skills?.builtin_dir).toBe("/opt/skills");
      expect(config.skills?.agent_dir).toBe("/home/user/skills");
      expect(config.skills?.max_per_turn).toBe(5);
      expect(config.skills?.similarity_threshold).toBe(0.7);
    });
  });

  describe("skills.AC3.2: Config defaults are applied when [skills] section is present but fields are omitted", () => {
    it("should apply defaults when [skills] section exists with no fields", () => {
      const tomlContent = `
${baseTomlContent}
[skills]
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.skills).toBeDefined();
      expect(config.skills?.builtin_dir).toBe("./skills");
      expect(config.skills?.agent_dir).toBe("./agent-skills");
      expect(config.skills?.max_per_turn).toBe(3);
      expect(config.skills?.similarity_threshold).toBe(0.3);
    });

    it("should apply defaults for omitted fields when some fields are specified", () => {
      const tomlContent = `
${baseTomlContent}
[skills]
builtin_dir = "/custom/skills"
max_per_turn = 7
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.skills).toBeDefined();
      expect(config.skills?.builtin_dir).toBe("/custom/skills");
      expect(config.skills?.agent_dir).toBe("./agent-skills");
      expect(config.skills?.max_per_turn).toBe(7);
      expect(config.skills?.similarity_threshold).toBe(0.3);
    });
  });

  describe("skills.AC3.3: Config is fully optional — absence of [skills] section results in undefined", () => {
    it("should result in undefined when [skills] section is absent", () => {
      writeFileSync(tempPath, baseTomlContent);

      const config = loadConfig(tempPath);

      expect(config.skills).toBeUndefined();
    });
  });
});

describe("SubconsciousConfigSchema", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = getTempConfigPath();
  });

  afterEach(() => {
    try {
      unlinkSync(tempPath);
    } catch {
      // file might not exist
    }
  });

  describe("subconscious.AC2: Subconscious config validation", () => {
    it("accepts disabled subconscious with no other fields", () => {
      const tomlContent = `
${baseTomlContent}
[subconscious]
enabled = false
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.subconscious).toBeDefined();
      expect(config.subconscious?.enabled).toBe(false);
    });

    it("accepts enabled subconscious with inner_conversation_id", () => {
      const tomlContent = `
${baseTomlContent}
[subconscious]
enabled = true
inner_conversation_id = "abc-123"
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.subconscious).toBeDefined();
      expect(config.subconscious?.enabled).toBe(true);
      expect(config.subconscious?.inner_conversation_id).toBe("abc-123");
    });

    it("rejects enabled subconscious without inner_conversation_id", () => {
      const tomlContent = `
${baseTomlContent}
[subconscious]
enabled = true
`;
      writeFileSync(tempPath, tomlContent);

      expect(() => loadConfig(tempPath)).toThrow();
    });

    it("applies default values when subconscious is disabled", () => {
      const tomlContent = `
${baseTomlContent}
[subconscious]
enabled = false
`;
      writeFileSync(tempPath, tomlContent);

      const config = loadConfig(tempPath);

      expect(config.subconscious?.enabled).toBe(false);
      expect(config.subconscious?.impulse_interval_minutes).toBe(20);
      expect(config.subconscious?.max_tool_rounds).toBe(5);
      expect(config.subconscious?.engagement_half_life_days).toBe(7);
      expect(config.subconscious?.max_active_interests).toBe(10);
    });

    it("rejects impulse_interval_minutes below 5", () => {
      const tomlContent = `
${baseTomlContent}
[subconscious]
enabled = false
impulse_interval_minutes = 3
`;
      writeFileSync(tempPath, tomlContent);

      expect(() => loadConfig(tempPath)).toThrow();
    });

    it("rejects impulse_interval_minutes above 120", () => {
      const tomlContent = `
${baseTomlContent}
[subconscious]
enabled = false
impulse_interval_minutes = 125
`;
      writeFileSync(tempPath, tomlContent);

      expect(() => loadConfig(tempPath)).toThrow();
    });
  });
});
