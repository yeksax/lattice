---
name: html-summary
description: >-
  Design system for building standalone HTML summaries, reports, comparison
  pages, and shareable single-file docs in the Lattice visual language — monospace,
  monochrome, sharp hairline borders, dense and functional (the "Lattice" look).
  Use this skill whenever the user asks to produce an HTML summary/report/recap,
  a self-contained .html to share with coworkers, a comparison or bake-off page,
  a status/results writeup as a web page, or "make this a nice HTML page."
  Invoke it BEFORE writing any HTML/CSS so the output matches the house style
  instead of defaulting to generic cream-and-serif slop. Also invoke it when
  updating or following up on an earlier summary — summaries are per-step
  snapshots and must never be overwritten to reflect later state.
---

# HTML Summary — house style

You are building a **standalone, self-contained `.html` file** (all CSS inline in
one `<style>`, no external requests, no build step) that you share with
coworkers. The goal is **information transfer, A → B, in the most direct form
possible** — dense, scannable, functional. Not an editorial landing page.

Read `template.html` in this skill directory first — it is a working starter with
every token and component below already wired for light/dark. Copy it and adapt;
do not start from a blank file.

## One file, zero external assets — non-negotiable

The whole deliverable is **a single `.html` file** a colleague opens by clicking
it — no zip, no folder, no build, no network. Everything lives inline:

- CSS in one `<style>`; any JS in one `<script>`.
- **Images/fonts/icons bundled as `data:` URIs** (base64 or, for SVG, inline the
  markup). No `<img src="./logo.png">`, no CDN `<link>`/`<script>`, no web-font URL.
- If it needs a network request to render fully, it's wrong. Test it with the
  network off.
- **Minimize footprint** — this file may be pasted into chat or email. Downscale
  and compress images before embedding, inline only the icon glyphs you actually
  use (not a whole icon font), drop unused CSS. Small enough to open instantly.

## Length — short by default

**A summary is a short read, not a document.** Default target: **one to two
screens of scroll** — roughly 4–6 sections, ~10–12KB of HTML. Someone opens it,
gets the point, closes it. If it takes more than ~2 minutes to read, it stopped
being a summary.

Go long **only when explicitly asked** ("full writeup", "be exhaustive", "map
everything") — or when the piece genuinely IS a map/audit whose value is the
inventory. Even then, front-load: the first screen carries the conclusion.

Cut, in this order, when it's running long:
- **Detail the reader won't act on.** Supporting evidence belongs in the
  companion `.md`, not here. Link to it; don't inline it.
- **Anything the reader already knows** — context they lived through, a recap of
  the previous step, restating the ask.
- **Sections that repeat a point** already made in a table or metric row.

A hover disclosure is the pressure valve: headline number visible, breakdown
one hover away. Use it instead of a paragraph explaining the number.

## One file per step — never overwrite a previous summary

Each summary is **a snapshot of one moment**: what was known, decided, or done
at that step. It is a record, not a working draft.

**When work moves to a new step, write a NEW file.** Never rewrite an existing
summary to reflect later state — that destroys the earlier record, and the user
loses the context they were relying on. The old file stays exactly as it was.

- New step → new file → new lattice slug (`thing-decisions.html`,
  `thing-phase1.html`, …). Cross-link them in the footer or the inverted block.
- **Only** edit an existing summary to fix something wrong *about that moment*
  (a typo, a broken number, a bug in the markup) — never to add later events.
- Iterating on a summary you're still writing, before handing it off, is fine —
  lattice live-reloads. The rule is about steps, not keystrokes.

## Copy & voice — write it like a person, not a model

The visual identity is only half the deliverable; the words carry the other half.
Two rules govern the copy, and both matter as much as the CSS.

### Executive summaries are political documents

An executive summary gets **forwarded** — to finance, to leadership, to people who
weren't in the room and will read it literally. Assume it leaves the building.
Write it so it never makes the team (or the reader) look bad.

- **Diplomatic, never accusatory.** State what the numbers are, not who let them
  get there. Never name-and-shame recursos, teams, or decisions ("bancos parados",
  "máquinas esquecidas há um ano", "cópias duplicadas ninguém limpou"). Describe
  neutrally ("recursos sem uso atual", "oportunidade de dimensionamento"). The
  audit/action files can be blunt; the executive summary cannot.
- **Don't expose the operation.** Strip specifics that would embarrass if a
  competitor or a board member read them — exact per-item costs, internal service
  names, counts of dead things, security near-misses. Aggregate and round instead.
- **Never over-promise.** Projected/future savings are always a ceiling, written
  with **"até R$ X"** or "cerca de", never a hard figure. Only numbers already
  *measured and realized* may be stated flat (and even then, framed as done, not
  as a guarantee of more). If a claim can be questioned and fail, it sinks the
  whole document's credibility — cite less, cite what's certain.
- **Constructive framing.** Sections point forward ("o que evita a próxima
  surpresa"), not backward at fault ("por que ninguém viu chegando"). Same fact,
  political register.

### Creative copy — kill the clichés (and the em-dashes)

Default AI phrasing is instantly recognizable and reads as slop. Actively avoid it:

- **No "não foi X, foi Y" / "not X — it's Y" antithesis.** This negation-contrast
  frame is the single most manjado AI tell. Rewrite as a plain positive statement.
  ✗ "Não foi gasto novo. Um crédito acabou e o custo apareceu de uma vez."
  ✓ "O fim de um crédito trouxe para o cartão um custo que já existia."
- **No em-dashes as connective drama** (`—`). The em-dash pause-for-effect is a
  dead giveaway. Use a period, a comma, or restructure. (Em-dashes are fine inside
  *data* — ranges, table cells — just not as prose rhythm.) This applies to the
  copy you write; it is not a change to how table/label punctuation renders.
- **Ban the tics:** "isso é X, não Y"; tricolon triples for cadence ("dense,
  scannable, functional"); "vale ouro / vale destacar / cabe ressaltar"; opening
  with "Em um mundo onde…"; rhetorical questions as headings; "não se trata apenas
  de… mas de…"; hollow intensifiers ("verdadeiramente", "de forma cirúrgica").
- **Write plainly and let the number carry the weight.** Short declarative
  sentences beat clever ones. If a line sounds like a LinkedIn post or a press
  release, cut it. Read it aloud — if no colleague would say it that way, rewrite.

## Non-negotiable identity

Monochrome. Monospace. Sharp. Hairline borders. Flat. Dense. That's the whole
brand. When in doubt, remove color, remove radius, remove shadow, tighten space.

## Hard bans (this is what "slop" looks like — never do it)

- ❌ **Cream / warm backgrounds** (`#faf8f5`, `#fffdfb`, beige, off-white paper).
  Backgrounds are pure white or pure near-black. Nothing warm, ever.
- ❌ **Sans-serif or serif body text.** No `system-ui`, no `ui-sans-serif`, no
  Georgia. **Everything is monospace**, including headings. (Lattice's LP mixes
  mono + serif — a summary does NOT. Lock to mono.)
- ❌ **Rounded corners.** `border-radius: 0` everywhere. No pills, no `999px`, no
  soft `12px` cards.
- ❌ **Box-shadows / elevation.** Flat only. Depth comes from hairlines and
  inverted (solid black) blocks, never from blur.
- ❌ **Accent colors** — no terracotta, no blue links, no colored buttons. The
  palette is ink + white + grays. Full stop, no exceptions, not even for status.
- ❌ **Dummy status indicators** — `● live`, fake dots, decorative "online" pills.
  They're noise. A colored one is worse. Only surface status if it reflects *real*
  state, and render it as a plain ink **hairline tag** (like `pass`) — never a dot,
  never colored.
- ❌ **Tracked caps.** No `text-transform: uppercase`, and no custom
  `letter-spacing` — especially not the two together (the spaced-out-caps label is
  a dead AI-slop tell). Monospace is already evenly spaced; it needs no tracking.
  Label hierarchy comes from **color (`--muted`) and size**, in natural case — not
  from caps or spacing.
- ❌ **Gradients** (except a single deliberate hero wash, and only if the piece
  warrants a hero at all — most summaries don't).
- ❌ **Editorial whitespace.** No `padding: 120px 0`, no full-`100vh` hero on a
  summary. Coworkers open these on 1366×768 laptops — respect the fold.
- ❌ **Emoji as UI**, decorative icons, drop caps, gratuitous entrance animations.

## Theme config — read it before you style

The look can be customized from the lattice dashboard's Settings view (or
`lattice config`). That writes `~/.summaries/.lattice/config.json`. **Before writing any CSS, read that file**
(it may not exist). If it has a non-empty `theme`, it is a *deliberate*
override of the house defaults — apply it. If the file is absent or `theme` is
empty, use the house style exactly as documented below (that IS the default
`lattice` preset). Fetch it live if the daemon is up:
`curl -s http://127.0.0.1:4600/api/config` — or just read the file.

`theme` fields, all optional:

- **`preset`** — named starting point. `lattice` (default) is this document.
  An unknown value falls back to `lattice`.
- **`accent`** — a hex like `#c2410c`. When set, it is the **one** allowed color:
  links, the voter's-own-pick marker, the leading bar segment. Everything else
  stays ink/white/gray. When empty, there is no accent (the house rule holds).
- **`font`** — body / running prose. `mono` (default) · `sans` · `serif`.
  (`sans` → `ui-sans-serif, system-ui, …`; `serif` → `ui-serif, Georgia, …`).
- **`heading`** — headings **and** big numbers / metric values. Same choices as
  `font`. Empty inherits `font` (or mono). Pair freely — e.g. `heading: serif` +
  `font: sans` for display contrast without forcing serif on long body copy.
- **`density`** — `compact` (default, section pad ~40px) · `comfortable` (~56px)
  · `spacious` (~72px). Scales section vertical padding and base line-height.
- **`tone`** — page base temperature. Empty keeps the house pure white / near-black.
  Cooler, shadcn-like bases when set:
  - `neutral` → light `#ffffff` / `#f5f5f5`, dark `#0a0a0a` / `#171717`
  - `zinc` → light `#fafafa` / `#f4f4f5`, dark `#09090b` / `#18181b`
  - `mist` → light `#f8fafc` / `#f1f5f9`, dark `#020617` / `#0f172a`
  Never invent a warm/cream/olive paper base. If `tone` is set, those cool tokens
  win over any yellowed default.
- **`dividers`** — when to draw borders / separators:
  - `hairline` (default) — 1px `--line` is the workhorse (bento gaps, stack cells,
    table rules). Still ≤1–2 section rules per page.
  - `soft` — prefer fill + gap over strokes. Hairlines only for numeric stacks and
    data tables; qualitative blocks stay borderless.
  - `none` — no module borders. Separate with `--bg-sub` fills and whitespace only
    (tables may keep zebra; skip outer strokes).
- **`modules`** — whether peer cells sit **together** or **apart** (not what
  content goes in them):
  - `mixed` (default) — use both: joined stacks for dense peer data, separated
    cards when each peer needs air.
  - `cards` — peers are **separated** (gap between panels, each on its own).
  - `stacks` — peers are **joined** into one compound block (shared edges /
    hairlines, no gutter between cells).

### Cards vs stacks (apply `modules`)

This is about **spacing**, not content type. A cost strip and a habits grid can
both be either form:

**Stack (juntos)** = one compound unit. Cells share edges (1px gap over `--line`,
or collapsed borders). No gutter between peers.

**Card (separados)** = peers with gap between them. Each panel stands alone
(usually on `--bg-sub`).

Apply a theme by setting the token values / font stack / spacing / divider+module
rules at the **top of your `<style>`** — never hard-code around them. A themed
summary still passes every *structural* rule (single file, both schemes, short):
the theme moves color, font, spacing, divider language, and module language.
When `theme` sets `accent`, `font`, `heading`, `tone`, `dividers`, or `modules`,
honor it — Hard bans describe the default, not a choice explicitly configured.
Apply `font` on `body` / paragraphs; apply `heading` on `h1–h3` and large metric
values (`.metric .val`, stack/card strong numbers). Do **not** put `heading` on
body copy.

## Tokens (baked into template.html)

```
Light                          Dark
--bg        #ffffff            #0b0b0b
--bg-sub    #fafafa            #141414   (alt rows, quiet panels)
--ink       #111111            #f2f2f2   (primary text)
--ink-2     #555555            #b5b5b5   (secondary text)
--muted     #8a8a8a            #7d7d7d   (labels, meta, captions)
--line      #e4e4e4            #1f1f1f   (hairline borders — the workhorse)
--line-2    #111111            #3a3a3a   (emphasis border / underline)
```

No status/accent token exists on purpose. Everything is ink, white, and grays.
Tonal *ranking* (bar segments, heatmaps) uses opacity steps of the ink, not hue.

### Dark mode is not an inversion — the lines get muted

Look at `--line-2`: light `#111111`, dark `#3a3a3a`. That is **not** the inverse.
A light hairline on a dark background reads far heavier than a dark hairline on
white at the same contrast ratio — invert `#111` naively and you get `#f2f2f2`, a
glowing white rule that turns every card into a lightbox. Text and fills invert;
**borders and line art get pulled back.**

- Go by contrast against the background, not by hex symmetry. Light `--line`
  sits at **1.27:1** and light `--line-2` at **18.9:1**; on dark you want roughly
  **1.2:1** and **1.7:1**. The emphasis rule only has to be distinguishable from
  the hairline — it does not have to shout, and on dark it must not.
- `--line-2` in dark lands around `#383838`–`#404040`. Never `--ink`: that is the
  white ruler that turns every card into a lightbox.
- `--line` in dark sits slightly *below* its light counterpart (`#1f1f1f`).
- **Line art follows the same rule.** An inline SVG with `stroke="currentColor"`
  inherits `--ink` and comes out near-white on black. Give diagrams and
  wireframes `color: var(--muted)` — it is the one token that reads calm in both
  schemes without per-mode overrides.
- The exception is **data ink**: a filled bar, a metric, the inverted block. Those
  are content, not chrome, and they invert normally.

Support both schemes: `@media (prefers-color-scheme: dark)` as the default
signal, plus `:root[data-theme]` overrides if you add a theme toggle. **Never
write a static `data-theme` on `<html>`** — it outranks the media query by
specificity and silently kills dark mode for everyone who never clicks the
toggle. Let the attribute exist only once the toggle sets it, and gate the dark
media query on `:root:not([data-theme="light"])`.

## Type

- **Font:** system monospace stack for portability across coworkers' machines —
  `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`.
  (Do NOT depend on a licensed font they won't have; embed one only on request.)
- **Base:** 13–14px / line-height 1.5. Dense but readable.
- **Scale, restrained:** h1 22–26px · h2 16–18px · h3 14px. No custom tracking —
  mono is already spaced. Headings are mono like everything else.
- **Weight caps at medium (500).** Never semibold/bold (600+) — heavy monospace
  reads as shouting. Emphasis is 400 body vs. 500 headings/values; for anything
  louder, invert the block, don't fatten the type.
- **Eyebrows/labels:** 11px, `--muted`, **natural case** (no uppercase, no
  tracking). Prefix sections with an index: `01 — results`. The muted color and
  small size carry the "label" role; caps are not needed and are banned.
- **Numbers:** `font-variant-numeric: tabular-nums` on any table or metric so
  columns align.

## Layout

- Content column `max-width: 1080–1180px`, centered, `padding: 0 20px`.
- **Don't rule every section.** Whitespace + the uppercase eyebrow label *is* the
  delimiter. A hairline divider between every section is visual noise — cut them.
  Use a divider only where scanning genuinely needs one (≤1–2 per page); the header
  underline and footer top-rule are usually the only rules a summary needs.
- Vertical padding per section ~40–56px. No more.
- **Bento grids:** cells divided by shared hairlines, not gaps + shadows. Use a
  1px grid gap over a `--line` background, or borders with collapsed edges.
- **Emphasis block:** invert — solid `--ink` background, `--bg` text — for a CTA,
  a headline number, or a footer. This is the one "loud" move; use it sparingly.
- **Optional flourishes** (earn their place, don't sprinkle): corner registration
  brackets `⌐ ¬`, a faint dotted-matrix, an index counter `01 / 07`. These are in
  template.html — mono, monochrome, tiny.

## Motion — only where it explains something

Small interactions are welcome, but **only where a static frame is genuinely worse.**
The test: *does the animation carry information the still image can't?* If not, cut it.

- ✅ Earns it: a state machine stepping through states; a diff revealing before→after;
  a flow lighting up A→B→C; a metric counting to its value; hover revealing detail.
- ❌ Doesn't: fade-in-on-scroll for every card, bouncing arrows, parallax, spinners
  on a static page, decorative loops that repeat forever.
- Keep it **subtle and fast** — 120–200ms, ease-out, small translations (≤8px).
- Inline SVG or CSS for illustrations (like the Anthropic "small diagrams" style):
  monochrome line art, hairline strokes, one accent max, no fills unless functional.
- **Always** ship the reduced-motion kill switch:
  `@media (prefers-reduced-motion: reduce) { *{animation:none!important;transition:none!important} }`

## Components (see template.html)

Section header (eyebrow + title) · hairline bento grid · dense data table with
`tabular-nums` and `--bg-sub` zebra · square hairline tag/chip · inline metric /
stat cell · inverted callout/footer block · corner registration marks. Reach for
these before inventing new ones.

### Bars & rankings — the house treatment

Never a set of thin, single-color, one-value-each lines (that reads as broken).
Bars are the **stacked segmented bar**: one composite bar, ~7–10px tall, on a
`--bg-sub` track, whose segments are widths proportional to weighted value and
whose color is a **single ink at stepped opacity** — darkest→lightest:

```
segment 1  opacity 1.00   segment 2  0.72   segment 3  0.52   segment 4  0.34
```

That opacity ramp is the whole color story — no hue. For per-row comparison,
prefer folding the detail into a **hover disclosure card** (a `max-content`
trigger showing the headline number; on `:hover`/`:focus-within` a hairline
popover, `border-radius: 2px`, `--bg` panel, that reveals the bar + a `<dl>` of
the parts) rather than laying thin bars out on the page. Both are in template.html.

**A hover disclosure MUST advertise itself** — a bare number gives no hint that
detail hides behind it. Always: `cursor: pointer` (never `default`) + a small
hand-coded caret/chevron SVG that reacts on hover (e.g. caret rotates toward the
popover). No affordance = nobody hovers = the detail is invisible.

**One popover per trigger — never shared.** Each hoverable thing reveals *its own*
detail. A cost trigger shows a cost breakdown; an elapsed trigger shows a time
breakdown; row N shows row N's parts. Wiring several triggers to one shared
popover (so hovering "elapsed" shows a cost breakdown) is confusing and wrong.
Give each its own `.disclose` with its own content.

### Icons — hand-coded inline SVG only

No icon libraries, no icon fonts, no CDN. Every icon is a small **hand-coded inline
`<svg>`**, authored right in the markup. This keeps the one-file rule intact (zero
requests, a few hundred bytes each) and keeps the icons on-brand: thin, monochrome,
geometric.

Use icons *only* for genuine affordances/wayfinding (a disclosure caret, an
external-link arrow), never decoration.

**How to draw them:**
- Fixed `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"` so the icon
  inherits ink and sizes to the text; `stroke-width` ~1.5–2, `stroke-linecap`/
  `stroke-linejoin="round"`. (Solid shapes use `fill="currentColor"` instead.)
- Prefer simple primitives — `<path>`, `<line>`, `<polyline>` — over dense curves.
  A caret is a two-segment polyline; an arrow is a line + a chevron; a check is a
  polyline; a plus is two lines. These you *can* author by hand safely because the
  geometry is trivial and verifiable by eye.
- Size via a `1em` wrapper (`.ico` / `.caret` in template.html), not fixed px, so
  the glyph tracks the text it sits with.

```html
<!-- caret (expand/collapse) -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
<!-- arrow-right (wayfinding) -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/></svg>
```

**Use icons, not text symbols.** Replace UI glyph characters — `→ ← ↗ ✓ ✕ ●` — with
a hand-coded SVG. Leave *punctuation* as text: em-dash `—`, middot `·`, and a
genuinely running-prose arrow are fine — the rule targets symbols standing in for
icons (buttons, list markers, status), not typography.


## Before you hand it off — checklist

- [ ] **Theme checked**: you read `~/.summaries/.lattice/config.json`; if it set
      a `theme`, you applied `accent`/`font`/`heading`/`density`/`tone`/`dividers`/
      `modules` via tokens + layout rules. Body uses `font`; headings + big numbers
      use `heading` (or `font` if heading empty). No config → house defaults.
      Cool `tone` means no warm/cream paper. `modules`/`dividers` match the guidelines.
- [ ] **Short**: one to two screens of scroll unless length was explicitly asked
      for. If it reads like a document, cut detail to the companion `.md`.
- [ ] **New step = new file.** You did NOT overwrite an earlier summary to bring
      it up to date. Earlier snapshots are untouched and cross-linked.
- [ ] Single `.html`, everything inline (CSS/JS/images-as-`data:`/SVG glyphs),
      opens offline with the network OFF. No `src=`/`href=`/CDN to any other file.
- [ ] Grep your CSS: no `border-radius` > 0, no `box-shadow`, no `#f*f*e*`/cream.
      Under the default (no-theme) look, also no `sans`/`serif` and no color
      beyond ink/white/gray — unless `config.json`'s `theme` set `font`/`accent`,
      in which case only that configured font/accent may appear.
- [ ] No dummy/decorative status dots (`● live`). No hairline rule between every
      section — dividers only where scanning needs one.
- [ ] Any bar is a stacked, opacity-ramped composite — never thin single-value lines.
- [ ] No `text-transform: uppercase` and no custom `letter-spacing` anywhere.
- [ ] Every hover disclosure has its own popover (no trigger shares another's).
- [ ] Renders on **1366×768** without a scroll-trap hero; the first screen shows
      real content, not a title card.
- [ ] Light AND dark both legible. **Check dark on a real screen**: no glowing
      white rules, no near-white SVG strokes. Borders muted, `data-theme` absent
      from the static markup.
- [ ] Every animation passes the "carries information" test; reduced-motion honored.
- [ ] It reads A → B: someone scanning for 15 seconds gets the point.

If the user shares it externally, offer `lattice share <slug>` (a public link that
stays up) or just hand them the file.

## Register in lattice (your summary knowledge base)

Every summary gets registered in **lattice**, the local app serving `~/.summaries`
at `http://127.0.0.1:4600`.

1. **Before naming the file**, check slugs already taken: `ls ~/.summaries`.
   Lattice slugifies the filename (`My Report.html` → `my-report`) and de-dupes
   with `-2`, `-3`… — pick a filename whose slug doesn't collide so the URL
   stays clean.
2. **After writing the file**, register it:
   `~/.local/bin/lattice add "<abs path>" --tags <comma,separated,topics>`
   This symlinks it into `~/.summaries` (original file untouched) and opens it
   at `http://127.0.0.1:4600/s/<slug>` — which live-reloads on every edit to
   the file, so register early if iterating. Add `--no-open` to skip the browser.
3. **Non-fatal**: if the `lattice` binary or server is missing, skip silently and
   mention the file can be added later with `lattice add`.

### Interactive polls & bake-offs

Polls are the **one deliberate exception** to "single file works anywhere": a
vote needs a network POST, so it only collects when the summary is served
*through* lattice — opened from the dashboard (`/s/<slug>`) or shared as a link
(`lattice share <slug>` → a public URL). Lattice injects a poll
**bridge** at serve time; the file on disk stays pristine. **For a poll the LINK
is the sharing mechanism, not the file** — never build export-code /
copy-your-vote flows; there's no way to collect a vote from a bare offline file,
so degrade gracefully instead of faking one.

**The bridge — `window.lattice`** (methods are all no-arg-safe):

| call | does |
|---|---|
| `lattice.poll` | truthy when the bridge is present |
| `await lattice.submit({ poll, choice, name? })` | record one vote → `true`/`false`. Also `{ votes: {q1:'a',q2:'b'} }` for many at once |
| `await lattice.results()` | live aggregate: `{ polls: { <poll>: { total, counts: {<choice>: n} } }, voters }` — **counts only, never who voted** |
| `lattice.recall(poll)` | this browser's remembered choice for `poll`, or `null` |
| `lattice.recallAll()` | `{ poll: choice, … }` for resuming multi-question flows |
| `lattice.voter` | this browser's stable id (auto-attached to every submit) |

Identity & dedup are automatic: the bridge mints a per-browser `voter` id in
`localStorage` and attaches it, so the server dedups **last-write-wins per
(voter, poll)** — a reload doesn't double-count and re-voting *changes* the vote.
`submit` also remembers the choice locally, which is what `recall` reads back.

**Ordering gotcha (important).** The bridge is injected *after* your page's
scripts, so at initial load `window.lattice` is `undefined` — you cannot read it
synchronously for load-time work like restoring a prior vote. Wait for the
`lattice:ready` event; at *submit* time (a click, later) it's always present:
```js
const start = () => { /* uses window.lattice */ };
window.lattice?.poll ? start() : document.addEventListener('lattice:ready', start, { once: true });
```

#### Pattern A — live-reveal poll (results appear the moment you vote)

Vote → reveal the breakdown → let them change their mind → survive reloads.
```js
const POLL = 'would-you-run-it';
async function paint(mine) {                       // fetch + render the bars
  const q = (await lattice.results()).polls[POLL] ?? { total: 0, counts: {} };
  for (const btn of buttons) {
    const n = q.counts[btn.dataset.choice] || 0, pct = q.total ? Math.round(n/q.total*100) : 0;
    btn.querySelector('.bar').style.width = pct + '%';               // proportional fill
    btn.querySelector('.pct').textContent = pct + '% · ' + n;
    btn.classList.toggle('mine', btn.dataset.choice === mine);       // highlight my pick
  }
}
async function vote(choice) {
  if (!window.lattice?.poll) return degradeToNote();                 // bare file: quiet note, don't fake
  if (!await lattice.submit({ poll: POLL, choice, name })) return retryHint();
  paint(choice);                                                     // includes the vote just cast
}
// restore on reload (see ordering gotcha):
const restore = () => { const m = lattice.recall(POLL); if (m) paint(m); };
window.lattice?.poll ? restore() : document.addEventListener('lattice:ready', restore, { once: true });
```
Keep the options **clickable after voting** so a second click re-submits and the
bars update — that's the "change your vote" affordance.

#### Pattern B — blind bake-off (nothing reveals until EVERY case is voted)

For A/B/C/D image bake-offs. This is the pattern agents get wrong — they reveal
each case as it's voted. Don't. **Blind means blind until the last vote.** Three
hard rules:

1. **Blind phase** (not all voted): a vote only marks your pick (a "seu voto"
   badge on the chosen option) and updates a `n / total` progress bar. Reveal
   **nothing** per case — no engine identity, no cost/latency, no tally. Keep
   that data in the DOM but CSS-hidden behind a `.revealed` class you don't add
   yet.
2. **Reveal all at once**, only when `allVoted()` — add `.revealed` to every
   case and paint each one's `%` bars together. One gate decides blind-vs-reveal
   on every vote; there is no per-case reveal path.
3. **A final summary at the END of the page** (never a live leaderboard at the
   top — it spoils the blind test and looks broken while empty). Gate it on
   `allVoted()` too: a champion block + an engine leaderboard (totals across all
   cases) + a per-case table of *winner vs. your pick*. This is the payoff — the
   "sumariozão" — and it's what makes finishing feel worth it.

```js
const CASES = DATA.scenes.map(s => s.id), N = CASES.length;
const pick = id => lattice.recall(id);                    // or a local store when offline
const votedCount = () => CASES.filter(pick).length;
const allVoted = () => votedCount() === N;

async function vote(id, choice) {
  await lattice.submit({ poll: id, choice, name });       // recorded, still hidden
  afterVote(await lattice.results());
}
function afterVote(agg) {                                  // the ONE gate
  updateProgress(votedCount(), N);
  if (allVoted()) { CASES.forEach(id => reveal(id, agg)); renderSummary(agg); }
  else            { CASES.forEach(markPickOnly); renderSummary(agg); /* → locked */ }
}
function renderSummary(agg) {
  if (!allVoted()) return lockedSummary(N - votedCount());     // "vote nas N cenas…"
  const totals = tallyAcrossCases(agg);                        // {engine: n}
  renderChampion(top(totals)); renderLeaderboard(totals);      // at the END of the doc
  renderPerCaseTable(agg, pick);                               // winner vs your pick
}
// boot / restore: same lattice:ready gate as Pattern A, then afterVote(results())
```
While voting, show only progress ("3 / 6 votadas") and the "seu voto" marker.
Everything else waits for the last vote.

**House style for result bars.** Not thin free-floating lines. Give each option
row a **proportional ink fill behind the text** (`position:absolute; width:<pct>%;
background:var(--ink); opacity:.12`) with the `% · count` tabular-aligned on the
right; mark the voter's own pick with an inverted key badge + "· you". Honor
reduced-motion on the fill's width transition.

**Collecting.** Votes cast while viewing through the local daemon append to
`~/.summaries/.lattice/polls/<slug>.jsonl`; votes on a public share are collected
by the hosted backend (lattice.pub). Share with `lattice share <slug>` (add
`--random` for an unguessable subdomain, or use the **share button in the
dashboard reader's top bar**) — requires `lattice login <token>`, and only that
one summary, its `POST /submit`, and read-only `GET /results` are public.
Tally shared votes with `lattice results <slug>`; `lattice unshare` when done.

**Non-poll summaries are unaffected** — no bridge, pure single-file, fully offline.
