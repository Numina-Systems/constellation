#!/usr/bin/env bun
// One-off script to compact a conversation using Anthropic's API.
// Usage: DATABASE_URL=... ANTHROPIC_API_KEY=... bun run scripts/compact-conversation.ts <conversation-id> [keep-recent]

import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";

const CONVERSATION_ID = process.argv[2];
const KEEP_RECENT = parseInt(process.argv[3] ?? "10", 10);
const MAX_CHUNK_CHARS = 400_000; // ~100k tokens, safe for 200k context with overhead
const MAX_SUMMARY_TOKENS = 2048;

if (!CONVERSATION_ID) {
  console.error("Usage: bun run scripts/compact-conversation.ts <conversation-id> [keep-recent]");
  process.exit(1);
}

const SYSTEM_PROMPT =
  "You are summarizing a conversation history to preserve essential context while compacting it. Create a concise narrative summary that maintains chronological order and preserves the causal chain of decisions.";

const DIRECTIVE = `Summarize the conversation above. Follow these priorities:

PRESERVE: Decisions made and their rationale. Tool outcomes (successes and failures). User constraints and preferences explicitly stated. Causal chains explaining why decisions were made.

CONDENSE: Repetitive exchanges into single statements. Verbose tool output into key results. Conversational filler and acknowledgements.

PRIORITIZE: Recent context over older context. Actionable information over historical detail. Unresolved questions and pending tasks.

REMOVE: Greetings and small talk. Redundant confirmations. Formatting artifacts.

Output only the summary text as a flowing narrative, not bullet points.`;

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: Date;
}

async function main() {
  const client = new pg.Client(
    process.env.DATABASE_URL ??
      "postgresql://constellation:constellation@localhost:5432/constellation",
  );
  await client.connect();

  const anthropic = new Anthropic();

  // Fetch all messages
  const { rows: messages } = await client.query<Message>(
    "SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    [CONVERSATION_ID],
  );

  console.log(`Found ${messages.length} messages, total chars: ${messages.reduce((s, m) => s + m.content.length, 0)}`);

  if (messages.length <= KEEP_RECENT) {
    console.log("Not enough messages to compact.");
    await client.end();
    return;
  }

  // Skip existing clip-archive (system message starting with [Context Summary)
  let startIndex = 0;
  const first = messages[0];
  if (first && first.role === "system" && first.content.startsWith("[Context Summary")) {
    console.log("Found existing clip-archive, will replace it.");
    startIndex = 1;
  }

  // Split: compress everything except the last KEEP_RECENT messages
  const splitIndex = messages.length - KEEP_RECENT;
  const toCompress = messages.slice(startIndex, splitIndex);
  const toKeep = messages.slice(splitIndex);

  console.log(`Compressing ${toCompress.length} messages, keeping ${toKeep.length}`);

  if (toCompress.length === 0) {
    console.log("Nothing to compress.");
    await client.end();
    return;
  }

  // Chunk by character budget
  const chunks: Message[][] = [];
  let currentChunk: Message[] = [];
  let currentChars = 0;

  for (const msg of toCompress) {
    if (currentChunk.length > 0 && currentChars + msg.content.length > MAX_CHUNK_CHARS) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }
    currentChunk.push(msg);
    currentChars += msg.content.length;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  console.log(`Split into ${chunks.length} chunks`);

  // Summarize each chunk independently (no fold-in to avoid growing context)
  const batchSummaries: Array<{
    content: string;
    startTime: Date;
    endTime: Date;
    messageCount: number;
  }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const chunkMessages: Anthropic.MessageParam[] = [];

    for (const msg of chunk) {
      if (msg.role === "user" || msg.role === "assistant") {
        chunkMessages.push({ role: msg.role, content: msg.content });
      } else if (msg.role === "tool") {
        chunkMessages.push({ role: "user", content: `[Tool result]: ${msg.content}` });
      }
    }

    // Ensure valid alternation
    if (chunkMessages.length === 0 || chunkMessages[0]!.role !== "user") {
      chunkMessages.unshift({ role: "user", content: "[Conversation continues from prior context]" });
    }

    chunkMessages.push({ role: "user", content: DIRECTIVE });

    console.log(`Summarizing chunk ${i + 1}/${chunks.length} (${chunk.length} messages, ${chunk.reduce((s, m) => s + m.content.length, 0)} chars)...`);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: MAX_SUMMARY_TOKENS,
      system: SYSTEM_PROMPT,
      messages: chunkMessages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    console.log(`  → ${text.length} chars summary (${response.usage.input_tokens} in, ${response.usage.output_tokens} out)`);

    batchSummaries.push({
      content: text,
      startTime: chunk[0]!.created_at,
      endTime: chunk[chunk.length - 1]!.created_at,
      messageCount: chunk.length,
    });
  }

  // If multiple chunks, do a final merge summarization
  let finalSummary: string;
  if (batchSummaries.length > 1) {
    console.log("Merging batch summaries...");
    const mergeMessages: Anthropic.MessageParam[] = [];
    for (const batch of batchSummaries) {
      mergeMessages.push({
        role: "user",
        content: `[Summary batch — ${batch.startTime.toISOString()} to ${batch.endTime.toISOString()}, ${batch.messageCount} messages]:\n${batch.content}`,
      });
    }
    mergeMessages.push({ role: "user", content: DIRECTIVE });

    const mergeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: MAX_SUMMARY_TOKENS * 2,
      system: SYSTEM_PROMPT,
      messages: mergeMessages,
    });

    finalSummary = mergeResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    console.log(`  → Merged summary: ${finalSummary.length} chars`);
  } else {
    finalSummary = batchSummaries[0]!.content;
  }

  // Archive each batch to memory
  console.log("Archiving batches to memory...");
  for (const batch of batchSummaries) {
    const label = `compaction-batch-${CONVERSATION_ID}-${batch.endTime.toISOString()}`;
    const metadataHeader = `[depth:0|start:${batch.startTime.toISOString()}|end:${batch.endTime.toISOString()}|count:${batch.messageCount}]`;
    const contentWithMetadata = `${metadataHeader}\n${batch.content}`;

    // Check if block already exists
    const existing = await client.query(
      "SELECT id FROM memory_blocks WHERE label = $1",
      [label],
    );
    if (existing.rows.length > 0) {
      console.log(`  Batch ${label} already exists, updating...`);
      await client.query(
        "UPDATE memory_blocks SET content = $1, updated_at = NOW() WHERE label = $2",
        [contentWithMetadata, label],
      );
    } else {
      await client.query(
        "INSERT INTO memory_blocks (id, label, content, tier, source, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'archival', 'Archived during manual compaction', NOW(), NOW())",
        [label, contentWithMetadata],
      );
    }
  }

  // Delete compressed messages
  const idsToDelete = toCompress.map((m) => m.id);
  if (first && first.role === "system" && first.content.startsWith("[Context Summary")) {
    idsToDelete.push(first.id);
  }

  console.log(`Deleting ${idsToDelete.length} old messages...`);
  await client.query("DELETE FROM messages WHERE id = ANY($1)", [idsToDelete]);

  // Insert clip-archive system message
  const clipArchiveContent = `[Context Summary — ${toCompress.length} messages compressed]\n\n${finalSummary}`;
  const firstKeptTime = toKeep[0]?.created_at ?? new Date();
  const clipArchiveTime = new Date(firstKeptTime.getTime() - 1);

  await client.query(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
    [CONVERSATION_ID, "system", clipArchiveContent, clipArchiveTime],
  );

  console.log("Done! Clip-archive inserted.");
  console.log(`Compressed ${toCompress.length} messages into ${finalSummary.length} chars summary.`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
