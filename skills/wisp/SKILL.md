---
name: wisp
description: Deploy static sites to the AT Protocol via wisp.place. Use when building or deploying a static site, managing wisp.place domains, or the user mentions wisp.place hosting.
user-invocable: true
---

# wisp — static site hosting on AT Protocol

Stores static sites as blobs on the user's PDS with a `place.wisp.fs` manifest record. The `wispctl` CLI handles build-artifact upload, manifest creation, and domain management.

**Source:** https://tangled.org/nekomimi.pet/wisp.place-monorepo
**CLI binaries:** https://sites.wisp.place/nekomimi.pet/wisp-cli-binaries/

## deploy

```bash
wispctl deploy <handle> --path ./build --site my-site
```

Use `--spa` for single-page apps. Redeployments only upload changed files. Sites go live at `https://sites.wisp.place/{did}/{site-name}`.

## critical: subpath serving

Wisp serves sites at `/{did}/{site-name}/`, not at root. This means:

- **Frameworks must use relative paths.** Absolute paths like `/_app/...` will break.
- **SvelteKit**: set `paths.relative = true` in `svelte.config.js`. Avoid SPA fallback — prerender instead.
- **Wisp's path rewriter runs on the entire HTML string**, not just HTML tags. It regex-matches the attribute names `src`, `href`, `action`, `data`, `poster`, `srcset` using `\b` word boundaries, then rewrites the value. This means JS variables with those names get mangled — e.g. `const data = await res.json()` becomes `const data=/did:plc:.../site/await res.json()`. **Always use external `.js` files instead of inline scripts.**
- When in doubt, prerender everything, use relative paths, and keep JS in external files.

## domains

```bash
wispctl domain claim-subdomain <handle> --subdomain alice     # alice.wisp.place
wispctl domain claim <handle> --domain example.com            # returns DNS instructions
wispctl domain add-site <handle> --domain example.com --site my-site
```

## auth

Auth happens inline during `deploy` and other commands — there is no separate `login` subcommand. On first use, the CLI opens a browser for AT Protocol OAuth. Sessions are cached after that. Don't automate the auth flow — ensure the user has run wispctl once interactively.

## other commands

`wispctl list sites`, `wispctl list domains`, `wispctl domain status`, `wispctl serve` (local preview). All accept `--json`.
