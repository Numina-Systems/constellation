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

Replies need both `root` (thread starter) and `parent` (post you're replying to):

```typescript
await agent.post({
  text: rt.text,
  facets: rt.facets,
  reply: {
    root: { uri: ROOT_URI, cid: ROOT_CID },
    parent: { uri: PARENT_URI, cid: PARENT_CID },
  },
  createdAt: new Date().toISOString(),
});
```

If replying directly to the root post, `root` and `parent` are the same. These values come from the incoming event metadata.

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
