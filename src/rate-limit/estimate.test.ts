import { describe, it, expect } from 'bun:test';
import { estimateInputTokens } from './estimate.js';
import type { ModelRequest, TextBlock, ToolUseBlock, ToolResultBlock } from '../model/types.js';

describe('estimateInputTokens', () => {
  it('empty request returns 0', () => {
    const request: ModelRequest = {
      messages: [],
      model: 'test-model',
      max_tokens: 100,
    };
    expect(estimateInputTokens(request)).toBe(0);
  });

  it('system prompt only', () => {
    const systemText = 'You are helpful.'; // 16 chars
    const request: ModelRequest = {
      system: systemText,
      messages: [],
      model: 'test-model',
      max_tokens: 100,
    };
    // 16 chars / 4 = 4 tokens
    expect(estimateInputTokens(request)).toBe(4);
  });

  it('single text message', () => {
    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: 'hello',
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // 5 chars / 4 = 1.25 → 2 tokens (ceil)
    expect(estimateInputTokens(request)).toBe(2);
  });

  it('message with ContentBlock array (text)', () => {
    const textBlock: TextBlock = {
      type: 'text',
      text: 'test',
    };
    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: [textBlock],
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // 4 chars / 4 = 1 token
    expect(estimateInputTokens(request)).toBe(1);
  });

  it('message with ToolUseBlock', () => {
    const toolUseBlock: ToolUseBlock = {
      type: 'tool_use',
      id: '1',
      name: 'foo',
      input: { x: 1 },
    };
    const request: ModelRequest = {
      messages: [
        {
          role: 'assistant',
          content: [toolUseBlock],
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // "foo " (name + space before JSON) + JSON = "foo " + '{"x":1}' = "foo {"x":1}"
    // = 11 chars / 4 = 2.75 → 3 tokens
    const str = `foo ${JSON.stringify({ x: 1 })}`;
    expect(estimateInputTokens(request)).toBe(Math.ceil(str.length / 4));
  });

  it('message with ToolResultBlock (string content)', () => {
    const toolResultBlock: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: '1',
      content: 'result text',
    };
    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: [toolResultBlock],
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // 11 chars / 4 = 2.75 → 3 tokens
    expect(estimateInputTokens(request)).toBe(3);
  });

  it('message with ToolResultBlock (array content)', () => {
    const toolResultBlock: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: '1',
      content: [{ type: 'text', text: 'data' }],
    };
    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: [toolResultBlock],
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // JSON.stringify([{ type: 'text', text: 'data' }]) = '{"type":"text","text":"data"}'
    const jsonStr = JSON.stringify([{ type: 'text', text: 'data' }]);
    const expected = Math.ceil(jsonStr.length / 4);
    expect(estimateInputTokens(request)).toBe(expected);
  });

  it('request with tools', () => {
    const request: ModelRequest = {
      messages: [],
      tools: [
        {
          name: 'add',
          description: 'adds two numbers',
          input_schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // name (3) + description (15) + input_schema JSON
    const schema = JSON.stringify({ type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } });
    const totalChars = 3 + 15 + schema.length;
    const expected = Math.ceil(totalChars / 4);
    expect(estimateInputTokens(request)).toBe(expected);
  });

  it('combined: system + messages + tools', () => {
    const systemText = 'Help.'; // 5 chars
    const request: ModelRequest = {
      system: systemText,
      messages: [
        {
          role: 'user',
          content: 'Hello', // 5 chars
        },
      ],
      tools: [
        {
          name: 'fn',
          description: 'A function', // 10 chars
          input_schema: { type: 'object' }, // '{"type":"object"}' = 18 chars
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // Total: 5 + 5 + 2 + 10 + 18 = 40 chars
    // 40 / 4 = 10 tokens
    expect(estimateInputTokens(request)).toBe(10);
  });

  it('rounding with Math.ceil: 5 chars = 2 tokens, not 1', () => {
    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: 'hello', // exactly 5 chars
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // 5 / 4 = 1.25 → ceil = 2
    expect(estimateInputTokens(request)).toBe(2);
  });

  it('multiple messages sum correctly', () => {
    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: 'msg1',
        },
        {
          role: 'assistant',
          content: 'msg2',
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // 4 + 4 = 8 chars / 4 = 2 tokens
    expect(estimateInputTokens(request)).toBe(2);
  });

  it('complex mixed content blocks', () => {
    const textBlock: TextBlock = {
      type: 'text',
      text: 'aa',
    };
    const toolResultBlock: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: '1',
      content: 'bb',
    };
    const request: ModelRequest = {
      system: 'cc',
      messages: [
        {
          role: 'user',
          content: [textBlock, toolResultBlock],
        },
      ],
      model: 'test-model',
      max_tokens: 100,
    };
    // System: 2 chars (cc)
    // Text block: 2 chars (aa)
    // Tool result block: 2 chars (bb)
    // Total: 6 chars / 4 = 1.5 → 2 tokens
    expect(estimateInputTokens(request)).toBe(2);
  });
});
