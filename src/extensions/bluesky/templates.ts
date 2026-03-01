// pattern: Functional Core

/**
 * Bluesky API reference code templates.
 * These are complete, working TypeScript code examples that the agent can reference
 * for posting, replying, and liking on Bluesky.
 *
 * Templates use @atproto/api with injected credential constants.
 */

export const BLUESKY_POST_TEMPLATE = `// Post to Bluesky
// Uses injected constants: BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE
import { AtpAgent } from "npm:@atproto/api";

const agent = new AtpAgent({ service: BSKY_SERVICE });
await agent.resumeSession({
  accessJwt: BSKY_ACCESS_TOKEN,
  refreshJwt: BSKY_REFRESH_TOKEN,
  handle: BSKY_HANDLE,
  did: BSKY_DID,
  active: true,
});

const response = await agent.post({
  text: "Hello from the Machine Spirit!",
  createdAt: new Date().toISOString(),
});

output("Posted: " + response.uri);`;

export const BLUESKY_REPLY_TEMPLATE = `// Reply to a Bluesky post
// Uses injected constants: BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE
// Requires: PARENT_URI, PARENT_CID, ROOT_URI, ROOT_CID (from incoming event metadata)
import { AtpAgent } from "npm:@atproto/api";

const agent = new AtpAgent({ service: BSKY_SERVICE });
await agent.resumeSession({
  accessJwt: BSKY_ACCESS_TOKEN,
  refreshJwt: BSKY_REFRESH_TOKEN,
  handle: BSKY_HANDLE,
  did: BSKY_DID,
  active: true,
});

const response = await agent.post({
  text: "This is a reply!",
  reply: {
    root: { uri: ROOT_URI, cid: ROOT_CID },
    parent: { uri: PARENT_URI, cid: PARENT_CID },
  },
  createdAt: new Date().toISOString(),
});

output("Replied: " + response.uri);`;

export const BLUESKY_LIKE_TEMPLATE = `// Like a Bluesky post
// Uses injected constants: BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE
// Requires: POST_URI, POST_CID (from incoming event metadata)
import { AtpAgent } from "npm:@atproto/api";

const agent = new AtpAgent({ service: BSKY_SERVICE });
await agent.resumeSession({
  accessJwt: BSKY_ACCESS_TOKEN,
  refreshJwt: BSKY_REFRESH_TOKEN,
  handle: BSKY_HANDLE,
  did: BSKY_DID,
  active: true,
});

const response = await agent.like(POST_URI, POST_CID);

output("Liked: " + response.uri);`;
