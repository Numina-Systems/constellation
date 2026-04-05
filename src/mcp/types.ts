// pattern: Functional Core (type definitions only)

export type McpToolInfo = Readonly<{
  name: string;
  description: string | undefined;
  inputSchema: Readonly<Record<string, unknown>>;
}>;

export type McpPromptInfo = Readonly<{
  name: string;
  description: string | undefined;
  arguments: ReadonlyArray<{
    readonly name: string;
    readonly description: string | undefined;
    readonly required: boolean | undefined;
  }>;
}>;

export type McpPromptResult = Readonly<{
  description: string | undefined;
  messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
}>;
