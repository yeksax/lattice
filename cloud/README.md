# lattice-share - hosted share backend

The paid half of lattice: a Cloudflare Worker that keeps a shared summary online
**24/7, independent of your laptop**. All public sharing goes through here -
`lattice share <slug>` (and the dashboard's share button, proxied by the local
daemon) uploads a snapshot. Self-hosters can run their own Worker and point the
CLI at it with `--api` / `LATTICE_API_BASE`.

- **Snapshot versions** live in R2 (`snap/<sub>/v<version>`).
- **Metadata, votes, identities, discussions, and page state** live in D1.
- **Auth** is a Bearer token per user. No signup yet - insert token rows by hand
  (see below). Free-tier caps (active shares, snapshot size) are `[vars]` in
  `wrangler.toml`.
- **Viewer identity** uses Google OpenID Connect. It creates a lightweight
  collaboration actor and session, not a Lattice workspace or owned account.

## API (CLI talks to this)

| Route | Auth | |
|---|---|---|
| `POST /v1/shares` | Bearer | `{slug, html, sub?, title?, random?}` → upload snapshot, upsert share. Re-posting the same slug updates it and keeps the subdomain. |
| `GET /v1/shares` | Bearer | list your shares + vote counts |
| `DELETE /v1/shares/{slug}` | Bearer | stop sharing (votes kept) |
| `GET /v1/shares/{slug}/results` | Bearer | dump submissions (same shape as local `.jsonl`) |
| `GET /v1/shares/{slug}/threads` | Bearer | list threads and replies |
| `POST /v1/shares/{slug}/threads` | Bearer | start a thread at `{selector, anchor_text?, body}` |
| `POST /v1/shares/{slug}/threads/{id}/comments` | Bearer | reply with `{body}` |
| `PATCH /v1/shares/{slug}/threads/{id}/comments/{comment}` | Bearer | edit the actor's own comment |
| `DELETE /v1/shares/{slug}/threads/{id}/comments/{comment}` | Bearer | soft-delete the actor's own comment |
| `POST /v1/shares/{slug}/threads/{id}/resolve` | Bearer | resolve a thread |
| `POST /v1/shares/{slug}/threads/{id}/reopen` | Bearer | reopen a thread |
| `GET /v1/shares/{slug}/state` | Bearer | dump the snapshot's persisted state, per scope and reader |
| `POST /v1/shares/{slug}/state` | Bearer | apply `{viewer?, ops:[{key, value, scope?, delete?}]}` |

## Hosted serving

Production uses `https://<sub>.lattice.pub`. Existing
`https://share.lattice.pub/s/<sub>` links remain supported. Development uses
the same `/s/<sub>` path on localhost because `workers.dev` has no wildcard
DNS.

- `GET /` (or `/s/<sub>`) - the snapshot with the poll bridge injected
- `POST /submit` - record a vote (`CF-Connecting-IP`, UA, timestamp)
- `GET /results` - aggregate counts only (never voter/IP/UA)
- `GET /threads` - list the snapshot's discussion
- `POST /threads` - start a thread after Google authentication
- `POST /threads/{id}/comments` - reply after Google authentication
- `PATCH /threads/{id}/comments/{comment}` - edit your own comment
- `DELETE /threads/{id}/comments/{comment}` - soft-delete your own comment
- `GET /state` - this reader's window on the page's persisted state
- `POST /state` - apply state operations (`document` scope is shared, `user` is
  per reader: the Google actor when signed in, the browser's own id otherwise)

Each upload creates an immutable snapshot version. A thread stores its stable
CSS selector, fallback anchor text, and the version where it began. The live
snapshot receives the discussion UI through an injected Shadow DOM bridge, so
the source HTML and its styles remain untouched.

Comment edits and deletions append the previous body to `comment_revisions`.
Deletion leaves a tombstone in the conversation so replies retain their context.
Only the comment's actor can mutate it.

Shares are public by URL unless they have a row in `share_access`. Passing
`allowed_domains` during upload enables Google Workspace domain gating for the
page, polls, and discussion endpoints.

Page state carries the trust model of the share it belongs to: on a public-by-URL
snapshot, anyone with the link can write the `document` scope, exactly as anyone
with the link can vote. Per-reader values belong in the `user` scope. Caps are
8 KB per value, 500 keys per scope, and 5000 rows per snapshot.

`DELETE /v1/shares/{slug}` removes every stored snapshot version, access policy,
thread, comment, and state row for that share - a released subdomain must not
hand its state to whatever share claims it next. Poll submissions retain the
existing keep-on-unshare behavior.

The poll and state bridges and the `/results` aggregation are byte/logic-identical
to the local daemon (`src/poll.bridge.txt` mirrors `cmd/lattice/dashboard/poll.js`
and `src/state.bridge.txt` mirrors `dashboard/state.js`; `aggregate()` ports
`pollagg.go` and `src/state.ts` ports `state.go`), so a page behaves the same
viewed locally or shared.

## Setup

```sh
cd cloud
pnpm install
# Self-hosters: copy wrangler.example.toml to wrangler.local.toml and pass
# --config wrangler.local.toml to the Wrangler commands below.
wrangler r2 bucket create lattice-snapshots
wrangler d1 create lattice                      # paste the id into your local config
pnpm db:init                                    # local database
# mint a token for a friend:
wrangler d1 execute lattice --command \
  "INSERT INTO tokens (token, owner, created) VALUES ('tok_demo', 'demo', unixepoch())"
pnpm dev           # http://localhost:8787  (share URLs are /s/<sub>)
pnpm run deploy    # applies the remote schema, then deploys production
```

Production deploys apply the idempotent `schema.sql` to D1 before publishing
the Worker. Keep that ordering when configuring a Git-connected Cloudflare
build: use `pnpm run deploy`, not a bare `wrangler deploy`.

## Google identity

Create a Web OAuth client in Google Cloud and register this redirect URI:

```text
https://api.example.com/auth/google/callback
```

Set `AUTH_BASE` to the same API origin and `SESSION_COOKIE_DOMAIN` to the shared
parent domain, such as `.example.com`. Store both OAuth values as Worker
secrets:

```sh
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

For local development, put the same values in an ignored `cloud/.dev.vars`
file and use local values for `AUTH_BASE` and `SESSION_COOKIE_DOMAIN`. Google
must also allow the local callback URI printed by Wrangler. The
server validates the one-time state cookie, nonce, issuer, audience, expiry,
verified email, and Google `hd` claim. Email suffix alone never grants
domain-restricted access.

## Dev round-trip

```sh
# with `pnpm dev` running and a token in the local D1:
lattice login tok_demo --api http://localhost:8787
lattice share <slug>                # uploads snapshot, prints /s/<sub> URL
lattice share <slug> --domain example.com
curl http://localhost:8787/s/<sub>  # snapshot + injected bridge
lattice results <slug>              # votes recorded via /submit show up
lattice threads <slug>              # humans and agents share one discussion
lattice state <slug> --hosted       # what readers ticked on the public snapshot
```
