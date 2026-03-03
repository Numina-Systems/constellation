// pattern: Imperative Shell

import { describe, it, expect } from "bun:test";
import { createMailgunSender } from "./sender.ts";

interface MessagesAPI {
  create(
    domain: string,
    data: Record<string, unknown>,
  ): Promise<{ id?: string; message?: string; status?: number }>;
}

describe("agent-email.AC1.1: Sender sends text email", () => {
  it("should return success with messageId when Mailgun succeeds with text format", async () => {
    const mockMessages: MessagesAPI = {
      async create(domain, data) {
        expect(domain).toBe("example.com");
        expect(data["from"]).toBe("noreply@example.com");
        expect(data["to"]).toBe("user@example.com");
        expect(data["subject"]).toBe("Test Subject");
        expect(data["text"]).toBe("Test body");
        expect(data["html"]).toBeUndefined();

        return {
          id: "<20250302.123456@example.com>",
          message: "Queued",
          status: 200,
        };
      },
    };

    const sender = createMailgunSender(
      "test-api-key",
      "example.com",
      "noreply@example.com",
      mockMessages,
    );

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "Test body",
      "text",
    );

    expect(result).toEqual({
      success: true,
      messageId: "<20250302.123456@example.com>",
    });
  });
});

describe("agent-email.AC1.2: Sender sends HTML email", () => {
  it("should return success with messageId when Mailgun succeeds with html format", async () => {
    const mockMessages: MessagesAPI = {
      async create(domain, data) {
        expect(domain).toBe("example.com");
        expect(data["from"]).toBe("noreply@example.com");
        expect(data["to"]).toBe("user@example.com");
        expect(data["subject"]).toBe("Test Subject");
        expect(data["html"]).toBe("<html><body>Test HTML</body></html>");
        expect(data["text"]).toBeUndefined();

        return {
          id: "<20250302.234567@example.com>",
          message: "Queued",
          status: 200,
        };
      },
    };

    const sender = createMailgunSender(
      "test-api-key",
      "example.com",
      "noreply@example.com",
      mockMessages,
    );

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "<html><body>Test HTML</body></html>",
      "html",
    );

    expect(result).toEqual({
      success: true,
      messageId: "<20250302.234567@example.com>",
    });
  });
});

describe("agent-email.AC1.3: Sender handles Mailgun API errors", () => {
  it("should return failure when Mailgun API returns non-2xx status", async () => {
    const mockMessages: MessagesAPI = {
      async create() {
        const error = new Error("Forbidden");
        const errorAsUnknown = error as unknown;
        if (
          typeof errorAsUnknown === "object" &&
          errorAsUnknown !== null &&
          "statusCode" in errorAsUnknown
        ) {
          (errorAsUnknown as Record<string, unknown>)["statusCode"] = 401;
        }
        throw error;
      },
    };

    const sender = createMailgunSender(
      "test-api-key",
      "example.com",
      "noreply@example.com",
      mockMessages,
    );

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "Test body",
      "text",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Forbidden");
    }
  });
});

describe("agent-email.AC1.4: Sender handles network errors", () => {
  it("should return failure when Mailgun request throws network error", async () => {
    const mockMessages: MessagesAPI = {
      async create() {
        throw new Error("ECONNREFUSED");
      },
    };

    const sender = createMailgunSender(
      "test-api-key",
      "example.com",
      "noreply@example.com",
      mockMessages,
    );

    const result = await sender(
      "user@example.com",
      "Test Subject",
      "Test body",
      "text",
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("ECONNREFUSED");
    }
  });
});
