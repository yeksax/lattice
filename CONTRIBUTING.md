# Contributing

Lattice is intentionally small: standard-library Go for the daemon and CLI,
Tauri for the macOS app, Astro for the public site, and a Cloudflare Worker for
optional hosted sharing.

## Local setup

```sh
make build
make install
make app
make web
```

For the hosted backend, copy `cloud/wrangler.example.toml` to
`cloud/wrangler.toml`, provision your own D1 database and R2 bucket, and fill in
your own resource identifiers. Never commit the resulting file.

JavaScript dependencies are managed as one pnpm workspace. Run `pnpm install`
from the repository root; do not create package-level npm lockfiles.

Use Conventional Commits for commit messages. Keep the daemon dependency-light
and preserve the local-first trust boundary.
