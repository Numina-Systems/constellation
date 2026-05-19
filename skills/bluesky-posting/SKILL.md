---
name: bluesky-posting
description: How to create Bluesky posts with rich text (facets), embeds (link cards, images, quote posts), and threading. Use when composing posts, replies, or any content that needs mentions, links, hashtags, images, or link cards.
tags:
  - bluesky
  - atproto
  - posting
  - facets
  - embeds
---

# Bluesky Posting

Create posts with rich content using `@atproto/api` in the Deno sandbox. The sandbox has these constants pre-injected: `BSKY_SERVICE`, `BSKY_ACCESS_TOKEN`, `BSKY_REFRESH_TOKEN`, `BSKY_DID`, `BSKY_HANDLE`.

## Session Setup (always needed)

```typescript
import { AtpAgent, RichText } from "npm:@atproto/api";

const agent = new AtpAgent({ service: BSKY_SERVICE });
await agent.resumeSession({
  accessJwt: BSKY_ACCESS_TOKEN,
  refreshJwt: BSKY_REFRESH_TOKEN,
  handle: BSKY_HANDLE,
  did: BSKY_DID,
  active: true,
});
```

## Rich Text with Facets

Use `RichText` to auto-detect mentions and links. Never calculate byte offsets manually.

```typescript
const rt = new RichText({
  text: "Hey @alice.bsky.social, check https://example.com",
});
await rt.detectFacets(agent);

await agent.post({
  text: rt.text,
  facets: rt.facets,
  createdAt: new Date().toISOString(),
});
```

`detectFacets` resolves `@handles` to DIDs and detects URLs automatically. It requires the agent instance for handle resolution.

### Hashtags

`detectFacets` does NOT auto-detect hashtags. Add them to the `tags` array instead:

```typescript
await agent.post({
  text: rt.text,
  facets: rt.facets,
  tags: ["bluesky", "atproto"],
  createdAt: new Date().toISOString(),
});
```

### Post Length

- Max **300 graphemes** (not characters, not bytes). Emoji = 1 grapheme each.
- Check with `rt.graphemeLength` before posting.
- Max 3000 UTF-8 bytes.

## Link Cards (External Embed)

```typescript
await agent.post({
  text: "Check out this article",
  embed: {
    $type: "app.bsky.embed.external",
    external: {
      uri: "https://example.com/article",
      title: "Article Title",
      description: "A brief description of the article",
    },
  },
  createdAt: new Date().toISOString(),
});
```

Optional: add a `thumb` blob for the card thumbnail (upload it first, see Images below).

## Images

Two-step: upload blob, then reference it in the post.

```typescript
const imageBytes = await Deno.readFile("./photo.jpg");
const { data: uploaded } = await agent.uploadBlob(imageBytes, {
  encoding: "image/jpeg",
});

await agent.post({
  text: "Look at this",
  embed: {
    $type: "app.bsky.embed.images",
    images: [
      {
        image: uploaded.blob,
        alt: "Description of the image",
        aspectRatio: { width: 1200, height: 800 },
      },
    ],
  },
  createdAt: new Date().toISOString(),
});
```

- Max 4 images per post
- Max 1MB per image
- Supported: JPEG, PNG, WEBP
- Always include `alt` text

## Quote Posts (Record Embed)

Embed another post by its AT-URI and CID:

```typescript
await agent.post({
  text: "This is a great post!",
  embed: {
    $type: "app.bsky.embed.record",
    record: {
      uri: "at://did:plc:xyz/app.bsky.feed.post/abc123",
      cid: "bafyreiecx6...",
    },
  },
  createdAt: new Date().toISOString(),
});
```

## Quote Post + Image

Combine a quote with media using `recordWithMedia`:

```typescript
await agent.post({
  text: "Adding context to this",
  embed: {
    $type: "app.bsky.embed.recordWithMedia",
    record: {
      $type: "app.bsky.embed.record",
      record: {
        uri: "at://did:plc:xyz/app.bsky.feed.post/abc123",
        cid: "bafyreiecx6...",
      },
    },
    media: {
      $type: "app.bsky.embed.images",
      images: [{ image: uploaded.blob, alt: "Screenshot" }],
    },
  },
  createdAt: new Date().toISOString(),
});
```

## Replies and Threading

Every reply requires a `reply` object with two `com.atproto.repo.strongRef` fields:

- **`root`** — the very first post in the thread (never changes as the thread grows)
- **`parent`** — the immediate post you're replying to

Both fields require `uri` (AT-URI) and `cid` (content hash at fetch time).

### Resolving root vs parent

You must fetch the parent post and check whether it's already in a thread. If the parent has its own `reply.root`, use that as your root. If the parent has no `reply` field, the parent itself IS the root.

```typescript
import { AppBskyFeedPost } from "npm:@atproto/api";

// parentUri: the AT-URI of the post you want to reply to
const { data: parentThread } = await agent.getPostThread({ uri: parentUri, depth: 0 });
const parentPost = parentThread.thread.post;
const parentRef = { uri: parentPost.uri, cid: parentPost.cid };

let rootRef: { uri: string; cid: string };

if (AppBskyFeedPost.isRecord(parentPost.record) && parentPost.record.reply) {
  // parent is already a reply — inherit its root
  rootRef = {
    uri: parentPost.record.reply.root.uri,
    cid: parentPost.record.reply.root.cid,
  };
} else {
  // parent is the thread starter — root and parent are the same
  rootRef = parentRef;
}

await agent.post({
  text: rt.text,
  facets: rt.facets,
  reply: {
    root: rootRef,
    parent: parentRef,
  },
  createdAt: new Date().toISOString(),
});
```

### Self-threading (continuing your own thread)

When posting a thread of your own, keep a reference to the first post's URI/CID as root and update parent after each post:

```typescript
const firstPost = await agent.post({
  text: "Thread (1/3): ...",
  createdAt: new Date().toISOString(),
});
const rootRef = { uri: firstPost.uri, cid: firstPost.cid };

const secondPost = await agent.post({
  text: "Thread (2/3): ...",
  reply: { root: rootRef, parent: rootRef },
  createdAt: new Date().toISOString(),
});

await agent.post({
  text: "Thread (3/3): ...",
  reply: { root: rootRef, parent: { uri: secondPost.uri, cid: secondPost.cid } },
  createdAt: new Date().toISOString(),
});
```

### Common mistakes

- **Setting `root = parent` unconditionally** — correct only for direct replies to thread starters. For nested replies, you must walk up to find the actual root. Bluesky will accept the record but the thread view breaks silently.
- **Omitting `cid`** — both `root` and `parent` require it. Fetch the post to get the current CID.
- **Stale CIDs** — CIDs are content-addressed. If a post was edited between when you fetched it and when you reply, your CID won't match. Always use the CID from your most recent fetch.

## Combining Facets + Embeds

Facets and embeds are independent. You can use both:

```typescript
const rt = new RichText({
  text: "Hey @someone.bsky.social, I wrote about this here:",
});
await rt.detectFacets(agent);

await agent.post({
  text: rt.text,
  facets: rt.facets,
  embed: {
    $type: "app.bsky.embed.external",
    external: {
      uri: "https://example.com/post",
      title: "My Article",
      description: "Thoughts on the topic",
    },
  },
  langs: ["en"],
  createdAt: new Date().toISOString(),
});
```

## Likes

```typescript
await agent.like(POST_URI, POST_CID);
```

## Reposts

```typescript
await agent.repost(POST_URI, POST_CID);
```

## Key Gotchas

1. **Always use RichText for facets.** Manual byte offset calculation in JavaScript is wrong because JS uses UTF-16 internally but AT Protocol uses UTF-8 byte offsets.
2. **Always include `createdAt: new Date().toISOString()`** on every post.
3. **Blob references are opaque objects.** After `uploadBlob`, use the returned `data.blob` object directly — don't try to construct it from a CID string.
4. **One embed type per post.** You can't have both `images` and `external` unless wrapped in `recordWithMedia`.
5. **Credentials are pre-injected.** Never hardcode tokens. Use the `BSKY_*` constants.
