# Lattice

**A local-first home for the HTML summaries your agents create.**

Lattice is a tiny cross-platform Go daemon and CLI that turns standalone HTML
files into a searchable personal library. The filesystem stays the source of
truth. Its embedded dashboard manages the library and appearance on macOS,
Linux, and Windows; the native macOS app is an optional companion.

[Download CLI builds](https://github.com/yeksax/lattice/releases/tag/continuous) | [macOS app](https://github.com/yeksax/lattice/releases/download/continuous/Lattice.dmg) | [Website](https://lattice.pub)

## Why

Agents produce useful plans, audits, reports, and explanations. Those artifacts
should not disappear inside chat histories. Lattice treats the finished HTML as
the durable object: portable, inspectable, and yours.

## What is included

| Directory | Purpose |
|---|---|
| `cmd/lattice/` | CLI, daemon, and embedded local dashboard |
| `app/` | Optional Tauri v2 macOS menu bar app |
| `web/` | Astro landing page for `lattice.pub` |
| `cloud/` | Optional Cloudflare Worker for hosted snapshots |
| `launchd/` | macOS LaunchAgent template |
| `skills/` | Agent skills, including the `html-summary` companion skill |
| `examples/` | Example standalone summaries |

The daemon, CLI, dashboard, desktop app, and website are MIT licensed. The
hosted service is optional; local sharing remains available through `expose`.

## Install

Download the matching CLI from the continuous release:

- `lattice-darwin-arm64` or `lattice-darwin-amd64`
- `lattice-linux-arm64` or `lattice-linux-amd64`
- `lattice-windows-amd64.exe`

Rename it to `lattice` (`lattice.exe` on Windows), put it on your `PATH`, then
run any command. The CLI starts the local daemon on demand and writes its log to
`~/.summaries/.lattice/lattice.log`. Set `LATTICE_NO_AUTOSPAWN=1` if another
service manager owns the daemon lifecycle.

The binary carries the lattice-integrated `html-summary` skill. Install it for
your agents (Claude Code, and anything reading `~/.agents/skills`) with:

```sh
lattice skills install
```

`make install` runs this for you. The standalone, lattice-free version of the
skill lives in `skills/html-summary` for anyone who just wants the design system.

To build locally:

```sh
git clone https://github.com/yeksax/lattice.git
cd lattice
go build -o lattice ./cmd/lattice
```

On macOS, `make install` remains available for a persistent LaunchAgent. The
desktop app can be built separately with `make app-build`.

## CLI

```sh
lattice add report.html --tags infra,q3
lattice ls
lattice open report
lattice rm report

lattice config
lattice config get theme.accent
lattice config set theme.accent '#c2410c'
lattice config unset theme.accent

lattice login <token>
lattice share report
lattice shares
lattice results report
lattice unshare report
```

Without a hosted token, `share` uses the local `expose` integration. Once
logged in, hosted snapshots are the default; pass `--local` to override.

## How local storage works

Lattice registers each summary by storing its absolute source path in a small
metadata sidecar under `~/.summaries/.lattice/meta/`. It does not copy, move, or
symlink newly added files, so registration behaves the same on every platform.
Legacy symlinks and HTML files dropped directly into `~/.summaries/` remain
supported. The in-memory search index rebuilds on startup and stays current
through filesystem events. Open summaries receive a hot-reload bridge in the
HTTP response only; source files are never modified.

Configuration lives in `~/.summaries/.lattice/config.json` with private file
permissions. It contains theme preferences and, when configured, the hosted
access token. Edit it through `lattice config` or the dashboard's Settings view.

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
[`cloud/wrangler.example.toml`](cloud/wrangler.example.toml). The tracked
`cloud/wrangler.toml` contains the deployment topology for the hosted service;
credentials and access tokens remain outside the repository.

## Security and privacy

- The daemon binds to loopback by default.
- The local filesystem is the source of truth.
- Sharing uploads one selected HTML snapshot, never the full library.
- Production credentials and access tokens are kept outside the repository.

See [SECURITY.md](SECURITY.md) for reporting and trust-model details.

## License

[MIT](LICENSE)
