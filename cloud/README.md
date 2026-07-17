# lattice-share - hosted share backend

The paid half of lattice: a Cloudflare Worker that keeps a shared summary online
**24/7, independent of your laptop**. `lattice share <slug>` uploads a snapshot
here instead of tunnelling to the local daemon; the local `--local` path (expose
/ cloudflared) still works for the fully self-hosted OSS setup.

- **Snapshots** live in R2 (`snap/<sub>`), one HTML object per share.
- **Metadata + votes** live in D1 (`shares`, `votes`, `tokens`).
- **Auth** is a Bearer token per user. No signup yet - insert token rows by hand
  (see below). Free-tier caps (active shares, snapshot size) are `[vars]` in
  `wrangler.toml`.

## API (CLI talks to this)

| Route | Auth | |
|---|---|---|
| `POST /v1/shares` | Bearer | `{slug, html, sub?, title?, random?}` → upload snapshot, upsert share. Re-posting the same slug updates it and keeps the subdomain. |
| `GET /v1/shares` | Bearer | list your shares + vote counts |
| `DELETE /v1/shares/{slug}` | Bearer | stop sharing (votes kept) |
| `GET /v1/shares/{slug}/results` | Bearer | dump submissions (same shape as local `.jsonl`) |

## Public serving (no auth)

Production uses `https://<sub>.lattice.pub`. Existing
`https://share.lattice.pub/s/<sub>` links remain supported. Development uses
the same `/s/<sub>` path on localhost because `workers.dev` has no wildcard
DNS.

- `GET /` (or `/s/<sub>`) - the snapshot with the poll bridge injected
- `POST /submit` - record a vote (`CF-Connecting-IP`, UA, timestamp)
- `GET /results` - aggregate counts only (never voter/IP/UA)

The poll bridge and `/results` aggregation are byte/logic-identical to the local
daemon (`src/poll.bridge.txt` mirrors `cmd/lattice/dashboard/poll.js`; `aggregate()` ports
`pollagg.go`), so a page behaves the same shared locally or hosted.

## Setup

```sh
cd cloud
pnpm install
# Self-hosters: copy wrangler.example.toml to wrangler.local.toml and pass
# --config wrangler.local.toml to the Wrangler commands below.
wrangler r2 bucket create lattice-snapshots
wrangler d1 create lattice                      # paste the id into your local config
pnpm db:init                                    # local; use db:init:remote for prod
# mint a token for a friend:
wrangler d1 execute lattice --command \
  "INSERT INTO tokens (token, owner, created) VALUES ('tok_demo', 'demo', unixepoch())"
pnpm dev           # http://localhost:8787  (share URLs are /s/<sub>)
pnpm run deploy    # production API + wildcard and legacy share URLs
```

## Dev round-trip

```sh
# with `pnpm dev` running and a token in the local D1:
lattice login tok_demo --api http://localhost:8787
lattice share <slug>                # uploads snapshot, prints /s/<sub> URL
curl http://localhost:8787/s/<sub>  # snapshot + injected bridge
lattice results <slug>              # votes recorded via /submit show up
```
