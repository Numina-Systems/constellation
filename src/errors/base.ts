// pattern: Functional Core

function safeSerializeContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    try {
      JSON.stringify(value);
      result[key] = value;
    } catch {
      try {
        result[key] = String(value);
      } catch {
        // Skip entirely unserializable values
      }
    }
  }
  return result;
}

export class ConstellationError extends Error {
  readonly code: string;
  readonly subsystem: string;
  readonly context: Record<string, unknown>;
  readonly suggestion: string | undefined;

  constructor(
    message: string,
    code: string,
    subsystem: string,
    context: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ConstellationError';
    this.code = code;
    this.subsystem = subsystem;
    this.context = context;
    this.suggestion = options?.suggestion;
  }

  toDisplayString(): string {
    const base = `[${this.subsystem}:${this.code}] ${this.message}`;
    if (this.suggestion) {
      return `${base} — Suggestion: ${this.suggestion}`;
    }
    return base;
  }

  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      code: this.code,
      subsystem: this.subsystem,
      message: this.message,
      context: safeSerializeContext(this.context),
      stack: this.stack,
    };
    if (this.suggestion !== undefined) {
      result.suggestion = this.suggestion;
    }
    return result;
  }
}
