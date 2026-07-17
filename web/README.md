# Lattice website

Static Astro landing page for `lattice.pub`, served as a Cloudflare Worker
with static assets.

```sh
pnpm install
pnpm dev
pnpm build
pnpm run deploy   # builds + wrangler deploy → lattice.pub / www.lattice.pub
```

Or from the repo root: `make web-deploy`.

Custom domains are declared in `wrangler.toml` (`lattice.pub`,
`www.lattice.pub`) on the same Cloudflare account as `lattice-share`.

The macOS download links point to the stable assets maintained by
`.github/workflows/release.yml` on the `continuous` GitHub Release.
