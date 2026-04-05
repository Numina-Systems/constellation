// pattern: Imperative Shell

/**
 * Stream assembly: converts a streaming response into a ModelResponse
 * while publishing event bus updates for TUI consumption.
 *
 * Handles StreamEvent iteration, accumulates content blocks, and publishes
 * stream events (start, chunk, thinking, end) for real-time display.
 */

import type {
  StreamEvent,
  ModelResponse,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  UsageStats,
  StopReason,
} from '../model/types.ts';
import type { AgentEventBus } from '../tui/types.ts';

/**
 * Finalizes the current block by adding it to contentBlocks if it has accumulated content.
 */
function finalizeCurrentBlock(
  blockType: string | null,
  textAccumulator: string,
  toolInputAccumulator: string,
  blockId: string | null,
  blockName: string | null,
): ContentBlock | null {
  if (blockType === 'text' && textAccumulator) {
    return {
      type: 'text',
      text: textAccumulator,
    } as TextBlock;
  } else if (blockType === 'tool_use' && toolInputAccumulator) {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(toolInputAccumulator);
    } catch {
      parsedInput = { _raw: toolInputAccumulator };
    }
    return {
      type: 'tool_use',
      id: blockId || '',
      name: blockName || '',
      input: parsedInput,
    } as ToolUseBlock;
  }
  return null;
}

/**
 * Assembles a ModelResponse from a streaming response while publishing
 * event bus updates for progress tracking and TUI display.
 *
 * Publishes:
 * - stream:start with model name and turn index
 * - stream:chunk for each text delta
 * - stream:thinking for each thinking delta
 * - stream:end with final usage stats and stop reason
 */
export async function assembleResponseFromStream(
  stream: AsyncIterable<StreamEvent>,
  eventBus: AgentEventBus,
  turnIndex: number,
  modelName: string,
): Promise<ModelResponse> {
  let usage: UsageStats | null = null;
  let stopReason: StopReason = 'end_turn';

  const contentBlocks: Array<ContentBlock> = [];
  let currentBlockType: string | null = null;
  let currentBlockId: string | null = null;
  let currentBlockName: string | null = null;
  let currentTextAccumulator = '';
  let currentToolInputAccumulator = '';
  let thinkingAccumulator = '';

  // Publish stream:start
  eventBus.publish({
    type: 'stream:start',
    model: modelName,
    turnIndex,
  });

  // Iterate through stream events
  for await (const event of stream) {
    if (event.type === 'message_start') {
      usage = event.message.usage;
    } else if (event.type === 'content_block_start') {
      // Save previous block if exists
      const finalized = finalizeCurrentBlock(
        currentBlockType,
        currentTextAccumulator,
        currentToolInputAccumulator,
        currentBlockId,
        currentBlockName,
      );
      if (finalized) {
        contentBlocks.push(finalized);
      }

      // Reset accumulators
      currentTextAccumulator = '';
      currentToolInputAccumulator = '';
      currentBlockId = null;
      currentBlockName = null;

      // Start new block
      currentBlockType = event.content_block.type;

      if (event.content_block.type === 'tool_use') {
        currentBlockId = event.content_block.id || null;
        currentBlockName = event.content_block.name || null;
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        const text = event.delta.text;
        if (text) {
          currentTextAccumulator += text;
          eventBus.publish({
            type: 'stream:chunk',
            text,
            turnIndex,
          });
        }
      } else if (event.delta.type === 'input_json_delta') {
        const input = event.delta.input;
        if (input) {
          currentToolInputAccumulator += input;
        }
      } else if (event.delta.type === 'thinking_delta') {
        const thinking = (event.delta as unknown as { thinking?: string }).thinking;
        if (thinking) {
          thinkingAccumulator += thinking;
          eventBus.publish({
            type: 'stream:thinking',
            text: thinking,
            turnIndex,
          });
        }
      }
    } else if (event.type === 'message_stop') {
      stopReason = event.message.stop_reason;
    }
  }

  // Save final block if exists
  const finalBlock = finalizeCurrentBlock(
    currentBlockType,
    currentTextAccumulator,
    currentToolInputAccumulator,
    currentBlockId,
    currentBlockName,
  );
  if (finalBlock) {
    contentBlocks.push(finalBlock);
  }

  // Ensure we have at least one content block (even if empty)
  if (contentBlocks.length === 0) {
    contentBlocks.push({
      type: 'text',
      text: '',
    } as TextBlock);
  }

  // Publish stream:end
  if (!usage) {
    usage = { input_tokens: 0, output_tokens: 0 };
  }
  eventBus.publish({
    type: 'stream:end',
    usage,
    stopReason,
  });

  return {
    content: contentBlocks,
    stop_reason: stopReason,
    usage,
    reasoning_content: thinkingAccumulator || undefined,
  };
}
