# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, Copilot, …) working
in this repository.

## Read the local rules file first

If `CLAUDE.local.md` exists at the repository root, **read it before doing
anything else.** It carries machine-specific instructions — checkout paths of
sibling repositories, local service ports, whatever the person on this machine
needs you to know. It is gitignored, so it is not in a fresh clone, and it is
not in the copy of this file you may have memorized.

It is named for Claude Code because that is the only agent with a convention for
a local, untracked rules file. Every agent reading this should treat it as
theirs too, regardless of what it is called.

## Repository overview

A local-first library for the standalone HTML summaries agents produce. The
filesystem is the source of truth; the daemon indexes it and serves a dashboard.

| Directory | Purpose |
|---|---|
| `cmd/lattice/` | CLI, daemon, and embedded dashboard — standard-library Go, one package |
| `cmd/lattice/dashboard/` | Dashboard front end, plain HTML/CSS/JS, embedded via `go:embed` |
| `cmd/lattice/skill/` | The lattice-integrated `html-summary` skill the binary embeds |
| `web/` | Astro landing page for `lattice.pub` |
| `cloud/` | Cloudflare Worker for hosted snapshot sharing |
| `launchd/` | macOS LaunchAgent template |
| `examples/` | Example standalone summaries |

## Commands

```sh
make build        # CGO-free binary at ./lattice
make dev          # build + run the daemon in the foreground
make dev-dash     # dashboard live-reload loop on :4601 (see below)
make web          # Astro site at localhost:4321
make web-build    # static site build
go test ./...     # the Go tests (cmd/lattice/store_test.go)
```

`make dev-dash` is the loop to use for any dashboard work. `LATTICE_DEV=1`
serves `cmd/lattice/dashboard/` from disk instead of the embedded FS, so HTML,
CSS, and JS edits reload the browser with no rebuild; wgo rebuilds and restarts
on `.go` changes. It runs on `:4601` so it never fights an installed daemon on
`:4600`. Do not add a bundler or a JS build step to the dashboard.

## Conventions

- **Go**: standard library only for the daemon and CLI. Keep it
  dependency-light; a new module in `go.mod` needs a real justification.
- **Dashboard**: no framework, no build step, no npm dependency. Plain
  `index.html` / `style.css` / `app.js`, embedded into the binary.
- **JS packages**: one pnpm workspace, `pnpm install` from the repository root.
  Never create package-level npm lockfiles.
- **Commits**: Conventional Commits. Separate commits by concern.
- **Trust boundary**: the daemon binds to loopback, the local filesystem stays
  the source of truth, and sharing uploads one selected snapshot — never the
  library. Do not weaken any of those without being asked to.
- **Credentials** stay out of the repository. `cloud/wrangler.toml` is the
  tracked production topology; for a self-hosted backend copy
  `cloud/wrangler.example.toml` and pass it with `--config`.

## The html-summary skill exists twice

There are two copies of the skill, in two repositories, and they must not
drift apart:

1. **`cmd/lattice/skill/`** (here) — the lattice-integrated copy the binary
   embeds and `lattice skills install` writes out. It documents theme config,
   `lattice add`, and the poll bridge, which only work with the CLI present.
2. **[yeksax/html-summary](https://github.com/yeksax/html-summary)** — the
   standalone design system, which depends on nothing.

**Every design-system change belongs in both.** Only lattice-specific
material — theme config, daemon hooks, poll wiring — is allowed to exist here
alone. Editing `cmd/lattice/skill/SKILL.md` and stopping there is the failure
mode this section exists to prevent.

`CLAUDE.local.md` has the local checkout path for the standalone repository and
the procedure. Read it before touching either copy.
