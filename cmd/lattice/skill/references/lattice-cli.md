# Lattice CLI manual

Use this manual whenever operating Lattice from a terminal or an agent. It
covers the complete public CLI, including local library management, hosted
sharing, polls, and discussion threads.

## Contents

- [Operating model](#operating-model)
- [Command map](#command-map)
- [Daemon and dashboard](#daemon-and-dashboard)
- [Summary library](#summary-library)
- [Configuration](#configuration)
- [Skill installation](#skill-installation)
- [Hosted authentication and sharing](#hosted-authentication-and-sharing)
- [Poll results](#poll-results)
- [Discussion threads](#discussion-threads)
- [Environment variables](#environment-variables)
- [Agent safety rules](#agent-safety-rules)
- [Troubleshooting](#troubleshooting)

## Operating model

Lattice is one binary with two roles:

1. `lattice serve` runs the loopback daemon and dashboard.
2. Every other command is a client of that daemon.

Most client commands start the daemon automatically when it is unavailable.
`add` and `rm` can also update the local metadata directly if the daemon still
cannot start.

The filesystem remains the source of truth:

- Registered HTML files stay at their original paths.
- Registration writes a metadata sidecar under
  `~/.summaries/.lattice/meta/`.
- Local discussions live under `~/.summaries/.lattice/comments/`.
- Configuration lives at `~/.summaries/.lattice/config.json`.
- Lattice injects live reload, polls, and comments into HTTP responses. It does
  not add those bridges to the source HTML.

A **slug** identifies a registered summary. It normally comes from the filename:
`Cloud Run Costs.html` becomes `cloud-run-costs`. Collisions receive `-2`,
`-3`, and so on. Re-adding the same source path returns its existing entry.

Run `lattice help` to print the built-in command summary.

## Command map

| Command | Purpose | Changes state |
|---|---|---|
| `lattice serve` | Run the local daemon | starts a process |
| `lattice add` | Register an HTML source | local |
| `lattice ls` | List registered summaries | no |
| `lattice rm` | Unregister a summary | local |
| `lattice open` | Open the dashboard or a summary | may register a file |
| `lattice config` | Read or update configuration | only with `set` or `unset` |
| `lattice skills install` | Install this embedded skill | local |
| `lattice login` | Store a hosted token | local credential |
| `lattice logout` | Remove the hosted token | local credential |
| `lattice share` | Upload or update one hosted snapshot | hosted |
| `lattice unshare` | Remove one hosted snapshot | hosted |
| `lattice shares` | List active hosted snapshots | no |
| `lattice results` | Print hosted poll submissions | no |
| `lattice threads` | List local or hosted threads | no |
| `lattice comment` | Start a local or hosted thread | local or hosted |
| `lattice reply` | Reply to a local or hosted thread | local or hosted |
| `lattice resolve` | Resolve a local or hosted thread | local or hosted |
| `lattice reopen` | Reopen a local or hosted thread | local or hosted |

Aliases: `lattice list` equals `lattice ls`, and `lattice remove` equals
`lattice rm`.

## Daemon and dashboard

### `lattice serve`

```sh
lattice serve
```

Runs the server in the foreground at `http://127.0.0.1:4600` by default. The
dashboard and summary routes remain loopback-only.

The server also attempts a friendly `http://summaries.localhost` alias through
port 80. Failure to bind that alias does not stop the main listener. Set
`LATTICE_ALIAS_ADDR=off` to disable it.

Normal CLI use does not require manually running `serve`. Commands that need the
daemon try to start a detached copy and wait briefly for its health endpoint.
The detached daemon writes logs to:

```text
~/.summaries/.lattice/lattice.log
```

Use a service manager or a foreground `serve` process when automatic startup is
undesirable, then set `LATTICE_NO_AUTOSPAWN=1`.

## Summary library

### `lattice add`

```sh
lattice add <file.html> [--title <title>] [--tags a,b,c] [--no-open]
```

Registers an `.html` or `.htm` source without copying, moving, linking, or
editing it. Relative paths are resolved from the caller's current directory.
Prefer absolute paths in agent workflows.

Flags:

- `--title <title>` overrides the title cached from the document.
- `--tags a,b,c` stores trimmed, comma-separated tags.
- `--no-open` skips opening the registered summary in a browser.

Examples:

```sh
lattice add "/abs/path/cloud-run-costs.html" --tags gcp,costs
lattice add "/abs/path/audit.html" --title "July audit" --no-open
```

The command prints the assigned slug. Capture that value before using
`share`, `threads`, or another slug-based command.

### `lattice ls`

```sh
lattice ls
```

Lists slug, creation date, cached title, and tags. A leading `!` means the
registered source path is missing.

Use this command to discover the canonical slug instead of guessing it.

### `lattice rm`

```sh
lattice rm <slug>
```

Unregisters the local entry. A normally registered source file remains
untouched.

Legacy symlinks or HTML files placed directly in `~/.summaries/` are themselves
library entries, so `rm` removes that library-local entry. Never substitute a
filesystem deletion for this command.

Removing a local registration is separate from hosted sharing. Run
`lattice unshare <slug>` when the hosted snapshot must also stop being
available.

### `lattice open`

```sh
lattice open
lattice open <slug>
lattice open <file.html>
```

With no argument, opens the dashboard. A slug opens that summary. A path to an
existing file registers it idempotently and then opens it.

Examples:

```sh
lattice open
lattice open cloud-run-costs
lattice open "/abs/path/cloud-run-costs.html"
```

## Configuration

### Read configuration

```sh
lattice config
lattice config get
lattice config get <dotted-key>
```

`config` and `config get` print the complete JSON document. A dotted key prints
only its value.

Do not print the complete config or `hosted.token` into chat, logs, or other
shared output. The config file has private permissions because it can contain a
Bearer token.

### Set or clear a value

```sh
lattice config set <dotted-key> <value>
lattice config unset <dotted-key>
```

`unset` stores the empty value for that key, which restores its default
behavior.

Supported keys and accepted values:

| Key | Accepted value |
|---|---|
| `theme.preset` | `lattice`, `warm`, `mono`, or empty |
| `theme.accent` | six-digit hex such as `#c2410c`, or empty |
| `theme.font` | `mono`, `sans`, `serif`, or empty |
| `theme.heading` | `mono`, `sans`, `serif`, or empty |
| `theme.density` | `compact`, `comfortable`, `spacious`, or empty |
| `theme.tone` | `neutral`, `zinc`, `mist`, or empty |
| `theme.dividers` | `hairline`, `soft`, `none`, or empty |
| `theme.modules` | `mixed`, `cards`, `stacks`, or empty |
| `hosted.apiBase` | absolute HTTP(S) URL without query or fragment |
| `hosted.token` | opaque credential |

Examples:

```sh
lattice config get theme.accent
lattice config set theme.accent '#c2410c'
lattice config set theme.density comfortable
lattice config unset theme.accent
```

Prefer `lattice login` and `lattice logout` over directly changing
`hosted.token`.

## Skill installation

### `lattice skills install`

```sh
lattice skills install [--dir <skill-root>] [--force]
```

Installs the lattice-integrated `html-summary` skill embedded in the current
binary.

Without `--dir`, it writes to both default targets:

```text
~/.claude/skills/html-summary
~/.agents/skills/html-summary
```

Flags:

- `--dir <skill-root>` installs only to `<skill-root>/html-summary`.
- `--force` clears an existing destination before installing.

Without `--force`, installation refreshes managed files in place and does not
clear unrelated files that appeared in the skill directory.

Restart the agent session after installation so it discovers the new skill.

## Hosted authentication and sharing

Hosted commands use `https://api.lattice.pub` unless configuration or
`LATTICE_API_BASE` overrides it.

### `lattice login`

```sh
lattice login <token> [--api <base-url>]
```

Stores the opaque hosted token in the private config file. `--api` also stores
an alternate hosted API base for self-hosted or development environments.

Do not expose the token in transcripts. Be aware that placing a token directly
on a command line can preserve it in shell history.

### `lattice logout`

```sh
lattice logout
```

Clears the hosted token. It does not delete shares and does not clear a custom
API base.

### `lattice share`

```sh
lattice share <slug> [--random] [--domain <domains>] [--public]
```

Uploads the pristine HTML source for one registered slug. The hosted snapshot
stays available while the local machine is offline. Re-running the command for
the same share updates its snapshot.

Flags:

- `--random` requests a random eight-character subdomain instead of the slug.
- `--domain example.com` requires Google identity from that Workspace domain.
  Separate multiple domains with commas.
- `--public` removes an existing domain restriction and returns the share to
  public-by-URL access.

`--domain` and `--public` are mutually exclusive. Re-sharing without either
flag preserves the current access policy.

Examples:

```sh
lattice share cloud-run-costs
lattice share internal-audit --domain example.com,subsidiary.example
lattice share internal-audit --public
lattice share demo --random
```

Sharing is an external publication action. An agent must only run it after the
user explicitly requests a hosted share or update.

### `lattice shares`

```sh
lattice shares
```

Lists active shares with URL, vote count, and access policy.

### `lattice unshare`

```sh
lattice unshare <slug>
```

Removes the hosted snapshots and discussions for that share. Hosted poll
submission data is retained.

This command is an external destructive action. Confirm the exact slug and the
user's intent before running it.

## Poll results

### `lattice results`

```sh
lattice results <slug>
```

Prints hosted poll submissions as one JSON value per line, followed by a count.
It requires hosted authentication and an existing share. If no submissions
exist, it prints `no submissions yet`.

This command reads hosted results. Local poll storage remains under:

```text
~/.summaries/.lattice/polls/<slug>.jsonl
```

For poll bridge implementation details, read `references/polls.md`.

## Discussion threads

Discussion commands operate on **local threads by default**. Append `--hosted`
to every command in a workflow when the conversation belongs to a published
snapshot.

Three identifiers have different jobs:

- **Slug** selects the document.
- **Selector** anchors a new thread to an element in that document.
- **Thread ID** identifies an existing conversation for replies and status
  changes.

Do not pass a selector where a thread ID is expected.

### Choose a stable selector

Prefer selectors backed by the semantic anchors required by this skill:

```text
#recommendation
[data-lattice-comment="monthly-cost"]
[data-lattice-comment="regional-breakdown"]
```

Always shell-quote selectors containing `#`, brackets, quotes, spaces, or other
special characters:

```sh
'#recommendation'
'[data-lattice-comment="monthly-cost"]'
```

Do not create durable threads against `:nth-child()`, generated class names, or
visible text. A selector is stored with the thread and must survive document
revisions.

### `lattice threads`

```sh
lattice threads <slug> [--open] [--json] [--hosted]
```

Lists threads and their comments.

Flags:

- `--open` omits resolved threads.
- `--json` prints machine-readable JSON with thread and comment IDs.
- `--hosted` reads threads from the active hosted share.

Human-readable local output includes thread ID, status, selector, and `local`.
Hosted output includes the snapshot version where the thread began.

Use JSON when an agent needs to select a thread reliably:

```sh
lattice threads cloud-run-costs --open --json
lattice threads cloud-run-costs --open --json --hosted
```

Treat returned IDs as opaque strings. Copy them exactly.

### `lattice comment`

```sh
lattice comment <slug> <selector> <message> [--hosted]
```

Starts a new thread with one agent-authored comment. The selector and body are
trimmed. Selectors are limited to 500 characters and messages to 16 KiB.

Examples:

```sh
lattice comment cloud-run-costs \
  '[data-lattice-comment="monthly-cost"]' \
  'Confirm whether this includes committed-use discounts.'

lattice comment cloud-run-costs \
  '#recommendation' \
  'Can we make the owner explicit?' \
  --hosted
```

Quote the message as one shell argument. For multiline or highly structured
content, prepare a safely quoted argument instead of splitting it across
positionals.

### `lattice reply`

```sh
lattice reply <slug> <thread-id> <message> [--hosted]
```

Adds an agent reply to an existing thread. Obtain the thread ID from
`lattice threads`, preferably with `--json`.

```sh
lattice reply cloud-run-costs thr_example \
  'Validated against the July export.'
```

Use `--hosted` if and only if the ID came from the hosted thread list:

```sh
lattice reply cloud-run-costs thr_example \
  'Validated against the July export.' \
  --hosted
```

Local and hosted IDs belong to separate stores even when their slugs match.

### `lattice resolve`

```sh
lattice resolve <slug> <thread-id> [--hosted]
```

Marks an existing thread resolved. Resolution keeps the thread and its replies.

### `lattice reopen`

```sh
lattice reopen <slug> <thread-id> [--hosted]
```

Returns a resolved thread to the open state.

### Recommended agent workflow

For a local summary:

```sh
lattice ls
lattice threads cloud-run-costs --open --json
lattice comment cloud-run-costs \
  '[data-lattice-comment="monthly-cost"]' \
  'Confirm the billing interval.'
lattice threads cloud-run-costs --open --json
lattice reply cloud-run-costs thr_example 'Confirmed: calendar month.'
lattice resolve cloud-run-costs thr_example
```

For a hosted snapshot, use the same sequence with `--hosted` on all five
discussion commands:

```sh
lattice threads cloud-run-costs --open --json --hosted
lattice comment cloud-run-costs '#recommendation' 'Please review.' --hosted
lattice reply cloud-run-costs thr_example 'Reviewed.' --hosted
lattice resolve cloud-run-costs thr_example --hosted
lattice reopen cloud-run-costs thr_example --hosted
```

### Editing and deleting comments

The current public CLI has no edit or delete command. Do not invent
`lattice edit`, `lattice delete`, or undocumented flags.

Authors can edit or delete their own eligible comments through the document UI.
Lattice stores revision history in the comments database. Agent-authored local
CLI comments are identified as agent comments and are not exposed as
human-editable comments in the local UI.

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `LATTICE_ADDR` | `127.0.0.1:4600` | daemon listen address and client target |
| `LATTICE_ALIAS_ADDR` | `:80` | friendly alias listener; use `off` to disable |
| `LATTICE_DIR` | `~/.summaries` | local library and metadata root |
| `LATTICE_API_BASE` | config or `https://api.lattice.pub` | hosted API override |
| `LATTICE_NO_AUTOSPAWN` | unset | any non-empty value disables daemon auto-start |
| `LATTICE_DEV` | unset | serves dashboard files from disk for development |

`LATTICE_API_BASE` takes precedence over `hosted.apiBase`. `LATTICE_DEV=1`
locates dashboard sources relative to the development binary; it can also be an
absolute dashboard directory.

Changing `LATTICE_DIR`, `LATTICE_ADDR`, or the hosted API target changes which
store or service a command sees. Keep those variables consistent throughout a
workflow.

## Agent safety rules

1. Run `lattice ls` before mutating a slug you did not just receive from `add`.
2. Prefer absolute paths with `add` and `open`.
3. Keep discussion operations local unless the user asks to act on a hosted
   share.
4. When using hosted discussions, apply `--hosted` consistently to listing,
   creating, replying, resolving, and reopening.
5. Quote selectors and freeform messages as single shell arguments.
6. Use semantic `id` and `data-lattice-comment` anchors.
7. Run `share`, `unshare`, `login`, and `logout` only when the user authorized
   the corresponding external or credential change.
8. Never reveal `hosted.token`.
9. Use `rm` to unregister. Do not delete the HTML source.
10. Inspect thread IDs with `threads --json`; never derive or shorten them.

## Troubleshooting

### The CLI cannot reach the local daemon

Check the health endpoint and log:

```sh
curl -fsS http://127.0.0.1:4600/api/health
tail -n 100 ~/.summaries/.lattice/lattice.log
```

If auto-start is disabled, run `lattice serve` or start the configured service
manager. If `LATTICE_ADDR` is set, use the corresponding address in the health
check.

### A registered summary is marked missing

`lattice ls` prints `!` when its source path no longer exists. Restore the file,
or unregister the stale slug with `lattice rm <slug>` and add the new source.

### A hosted command says `not logged in`

Authenticate with `lattice login <token>`. For a self-hosted backend, pass
`--api <base-url>` during login or set `LATTICE_API_BASE`.

### A discussion command cannot find a thread

Confirm all three:

1. The slug is correct.
2. The thread ID was copied exactly from `lattice threads --json`.
3. Local versus hosted mode matches the list command that produced the ID.

### A thread becomes visually orphaned

Keep the selector's semantic anchor in later document revisions. If the
underlying concept was removed, preserve the historical thread and resolve it.
Do not retarget it using a positional selector.
