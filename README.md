# Lattice

**A local-first home for the HTML summaries your agents create.**

Lattice is a tiny Go daemon and CLI that turns standalone HTML files into a
searchable personal library. The filesystem stays the source of truth. A native
macOS menu bar app manages the library, and optional hosted sharing publishes
only the snapshot you choose.

[Download for macOS](https://github.com/yeksax/lattice/releases/download/continuous/Lattice.dmg) | [Website](https://lattice.pub) | [Continuous release](https://github.com/yeksax/lattice/releases/tag/continuous)

## Why

Agents produce useful plans, audits, reports, and explanations. Those artifacts
should not disappear inside chat histories. Lattice treats the finished HTML as
the durable object: portable, inspectable, and yours.

## What is included

| Directory | Purpose |
|---|---|
| `cmd/lattice/` | CLI, daemon, and embedded local dashboard |
| `app/` | Tauri v2 macOS menu bar app |
| `web/` | Astro landing page for `lattice.pub` |
| `cloud/` | Optional Cloudflare Worker for hosted snapshots |
| `launchd/` | macOS LaunchAgent template |
| `skills/` | Agent skills, including the `html-summary` companion skill |
| `examples/` | Example standalone summaries |

The daemon, CLI, dashboard, desktop app, and website are MIT licensed. The
hosted service is optional; local sharing remains available through `expose`.

## Install

Download the current universal DMG from the link above, or build locally:

```sh
git clone https://github.com/yeksax/lattice.git
cd lattice
make install
make app-build
open app/src-tauri/target/release/bundle/macos/Lattice.app
```

The daemon runs at [http://127.0.0.1:4600](http://127.0.0.1:4600) through a
LaunchAgent. Logs live at `~/.summaries/.lattice/lattice.log`.

## CLI

```sh
lattice add report.html --tags infra,q3
lattice ls
lattice open report
lattice rm report

lattice login <token>
lattice share report
lattice shares
lattice results report
lattice unshare report
```

Without a hosted token, `share` uses the local `expose` integration. Once
logged in, hosted snapshots are the default; pass `--local` to override.

## How local storage works

Lattice owns `~/.summaries/`. Each summary is a symlink to its original HTML
file, accompanied by lightweight metadata. The in-memory search index rebuilds
on startup and stays current through filesystem events. Open summaries receive
a hot-reload bridge in the HTTP response only; source files are never modified.

Configuration lives in `~/.summaries/.lattice/config.json` with `0600`
permissions. It contains theme preferences and, when configured, the hosted
access token.

## Development

```sh
make dev          # Go daemon in the foreground
make app          # Tauri app in development mode
make web          # Astro site at localhost:4321
make web-build    # static website build
make web-deploy   # build + wrangler deploy to lattice.pub
```

The JavaScript packages are managed by a pnpm workspace. Run `pnpm install`
from the repository root after cloning.

The cloud backend requires your own Cloudflare resources. Follow
[`cloud/README.md`](cloud/README.md) and start from
[`cloud/wrangler.example.toml`](cloud/wrangler.example.toml). Production
resource identifiers belong only in the ignored `cloud/wrangler.toml`.

## Security and privacy

- The daemon binds to loopback by default.
- The local filesystem is the source of truth.
- Sharing uploads one selected HTML snapshot, never the full library.
- Production credentials and infrastructure configuration are gitignored.

See [SECURITY.md](SECURITY.md) for reporting and trust-model details.

## License

[MIT](LICENSE)
