// pattern: Functional Core

import type { ModelRequest, ContentBlock } from '../model/types.js';

function contentBlockToString(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'tool_use':
      return `${block.name} ${JSON.stringify(block.input)}`;
    case 'tool_result':
      return typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);
  }
}

export function estimateInputTokens(request: ModelRequest): number {
  let chars = 0;

  if (request.system) {
    chars += request.system.length;
  }

  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length;
    } else {
      for (const block of message.content) {
        chars += contentBlockToString(block).length;
      }
    }
  }

  if (request.tools) {
    for (const tool of request.tools) {
      chars += tool.name.length + tool.description.length + JSON.stringify(tool.input_schema).length;
    }
  }

  return Math.ceil(chars / 4);
}
