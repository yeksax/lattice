# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting for `yeksax/lattice` instead.

Include the affected version, reproduction steps, impact, and any suggested
mitigation. You can expect an acknowledgement within seven days.

## Trust model

Lattice is a single-user, local-first application. The daemon binds to loopback
by default and the desktop app talks to it over `127.0.0.1`. Hosted sharing only
uploads summaries selected explicitly by the user.

Access tokens are stored locally in
`~/.summaries/.lattice/config.json` with `0600` permissions. Never include that
file, Wrangler credentials, or environment files in bug reports. The tracked
`cloud/wrangler.toml` contains resource identifiers and routing configuration,
not credentials.
