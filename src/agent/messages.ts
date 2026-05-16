// pattern: Functional Core

/**
 * User message composition with snapshot attachments.
 *
 * Builds Anthropic-compatible user messages with optional dynamic context
 * attachment blocks prepended from snapshot results.
 */

import type {SnapshotResult, SnapshotMode} from './snapshot.ts';
import type {Message} from '../model/types.ts';

/**
 * Wraps snapshot content with a header indicating the snapshot type.
 *
 * For `'full'`: indicates complete context.
 * For `'delta'`: indicates only changed sections.
 */
function formatAttachment(content: string, mode: SnapshotMode): string {
  if (mode === 'full') {
    return `[Dynamic Context — Full Snapshot]\n\n${content}`;
  }
  if (mode === 'delta') {
    return `[Dynamic Context — Updated Sections]\n\n${content}`;
  }
  throw new Error(`Unknown snapshot mode: ${mode}`);
}

/**
 * Builds a user message with optional dynamic context attachment.
 *
 * If snapshot is null, snapshot.mode is 'noop', or snapshot.content is null,
 * returns a plain string message.
 *
 * If snapshot.mode is 'full' or 'delta' with non-null content,
 * returns a message with a content array: [attachment block, user message].
 *
 * @param text - The user's actual message text
 * @param snapshot - The snapshot result from the batch-anchored snapshot pipeline, or null
 * @returns An Anthropic-compatible Message with role 'user'
 */
export function buildUserMessage(
  text: string,
  snapshot: SnapshotResult | null,
): Message {
  // No snapshot, or noop, or no content: return plain string message
  if (snapshot === null || snapshot.mode === 'noop' || snapshot.content === null) {
    return {
      role: 'user',
      content: text,
    };
  }

  // Full or delta mode with content: build content array
  if ((snapshot.mode === 'full' || snapshot.mode === 'delta') && snapshot.content !== null) {
    const attachmentBlock = {
      type: 'text' as const,
      text: formatAttachment(snapshot.content, snapshot.mode),
    };

    const userBlock = {
      type: 'text' as const,
      text: text,
    };

    return {
      role: 'user',
      content: [attachmentBlock, userBlock],
    };
  }

  // Unreachable, but satisfy type system
  throw new Error('Unreachable: snapshot mode/content combination not handled');
}
