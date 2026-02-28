// pattern: Functional Core

import type { DataSource } from "../data-source.ts";

export type BlueskyPostMetadata = {
  readonly platform: "bluesky";
  readonly did: string;
  readonly handle: string;
  readonly uri: string;
  readonly cid: string;
  readonly rkey: string;
  readonly reply_to?: {
    readonly parent_uri: string;
    readonly parent_cid: string;
    readonly root_uri: string;
    readonly root_cid: string;
  };
};

export interface BlueskyDataSource extends DataSource {
  getAccessToken(): string;
  getRefreshToken(): string;
  getPdsUrl(): string;
}
