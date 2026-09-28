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
 * returns a message with a single-string content: composed attachment + user text.
 * This format is byte-identical and persistable without schema migration.
 *
 * @param text - The user's actual message text
 * @param snapshot - The snapshot result from the batch-anchored snapshot pipeline, or null
 * @returns An Anthropic-compatible Message with role 'user'
 */
export function buildUserMessage(
  text: string,
  snapshot: SnapshotResult | null,
): Message {
  // No snapshot: return plain string message
  if (snapshot === null) {
    return {
      role: 'user',
      content: text,
    };
  }

  const removedContent = (snapshot.removedProviders ?? []).length > 0
    ? `## Removed dynamic context sections\n\nThe following dynamic context sections are no longer available and must not be used:\n${(snapshot.removedProviders ?? []).map(name => `- ${name}`).join('\n')}`
    : null;
  const attachmentContent = [snapshot.content, removedContent].filter((content): content is string => content !== null).join('\n\n');

  if (snapshot.mode === 'noop' || attachmentContent.length === 0) {
    return {role: 'user', content: text};
  }

  // Exhaustive switch over snapshot mode with compile-time guarantees
  switch (snapshot.mode) {
    case 'full':
    case 'delta':
      const composedContent = `${formatAttachment(attachmentContent, snapshot.mode)}\n\n${text}`;
      return {
        role: 'user',
        content: composedContent,
      };

    default:
      const _exhaustive: never = snapshot.mode;
      return _exhaustive;
  }
}
