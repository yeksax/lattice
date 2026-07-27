# Diagrams — the drawing vocabulary

A summary transmits **shape**: a sequence, a split, a proportion, a hierarchy.
Drawn, the shape lands in a second. Written, it costs a paragraph nobody reads.

Everything here is copy-paste: house tokens only (`--ink`, `--ink-2`, `--muted`,
`--line`, `--bg`, `--bg-sub`), hairline, no radius, no shadow, no hue. Take the
one that matches the content and delete the rest.

## Rules that apply to every diagram

- **≤ 6 nodes / rows / bands.** Past six nobody follows the picture, and you are
  drawing the file instead of summarising it. Fold the tail into "outros".
- **Labels of 1–3 words.** A node containing a sentence is a paragraph in a box.
  The sentence goes in the two lines of prose under the diagram, if at all.
- **No legend** when the labels fit inline. A legend means the drawing failed.
- **Line art is `--muted`.** An inline SVG with `stroke="currentColor"` inherits
  `--ink` and glows near-white on dark. Set `color:var(--muted)` on the diagram
  container. The exception is **data ink** (a filled bar, a metric) — that
  inverts normally.
- **≤ ~140px tall.** A diagram that eats a third of the fold is a hero.
- Diagrams are static unless the motion carries information (SKILL.md → Motion).

## Flow chain — a sequence, a mechanism, a request path

The default drawing. Nodes left→right, connector between them, wraps to a
column on narrow screens (where the arrows disappear rather than rotate).

```css
.flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:10px;margin-top:20px}
.flow .node{flex:1 1 170px;min-width:0;background:var(--bg-sub);padding:12px 14px}
.flow .node .k{font-size:11px;color:var(--muted)}
.flow .node .v{font-size:12.5px;margin-top:4px;color:var(--ink)}
.flow .node.hot{background:var(--ink);color:var(--bg)}      /* where it breaks */
.flow .node.hot .k{color:var(--bg);opacity:.6}
.flow .node.hot .v{color:var(--bg)}
.flow .arrow{display:flex;align-items:center;color:var(--muted)}
.flow .arrow svg{width:16px;height:16px}
@media(max-width:820px){.flow .arrow{display:none}}
```

```html
<div class="flow">
  <div class="node"><div class="k">cookie</div><div class="v">sessão válida</div></div>
  <div class="arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/></svg></div>
  <div class="node hot"><div class="k">server render</div><div class="v">shell vazio</div></div>
  <div class="arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/></svg></div>
  <div class="node"><div class="k">hidratação</div><div class="v">3 fetches</div></div>
</div>
```

One inverted node marks where the chain breaks. Never more than one — the point
of the drawing is that the eye lands on it immediately.

## Before → after — what changed, or what should

Two states side by side, the old one quieter. Nothing between them but the
connector; the comparison is the content.

```css
.ba{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:stretch;margin-top:20px}
.ba .side{background:var(--bg-sub);padding:14px 16px}
.ba .side .k{font-size:11px;color:var(--muted);margin-bottom:6px}
.ba .side .v{font-size:12.5px;color:var(--ink)}
.ba .side.old{opacity:.62}                     /* the state being left behind */
.ba .mid{display:flex;align-items:center;color:var(--muted)}
.ba .mid svg{width:16px;height:16px}
@media(max-width:760px){.ba{grid-template-columns:1fr}.ba .mid{display:none}}
```

Use it for a migration, a proposed contract change, a fix. If both sides need
more than a line each, it is a two-column table, not this.

## Layer stack — layers of a system

One band per layer, top = closest to the user. The band the page is about gets
the fill; the others stay plain.

```css
.layers{display:grid;gap:1px;background:var(--line);border:1px solid var(--line);margin-top:20px}
.layers .layer{background:var(--bg);display:flex;gap:14px;align-items:baseline;padding:11px 16px}
.layers .layer .k{font-size:11px;color:var(--muted);flex:0 0 130px}
.layers .layer .v{font-size:12.5px}
.layers .layer.hot{background:var(--bg-sub)}
```

```html
<div class="layers">
  <div class="layer"><span class="k">página</span><span class="v">renderiza casca</span></div>
  <div class="layer hot"><span class="k">route handler</span><span class="v">exige Bearer</span></div>
  <div class="layer"><span class="k">banco</span><span class="v">RLS por usuário</span></div>
</div>
```

## Count strip — an inventory, before (or instead of) the table

The reduction of a long list into the one line that is actually the finding.
Put it directly under the heading; the table, if it survives at all, comes after.

```css
.counts{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:14px;font-size:12.5px;color:var(--ink-2)}
.counts b{color:var(--ink);font-weight:500}
.counts span:not(:first-child)::before{content:"· ";color:var(--muted)}
```

```html
<p class="counts">
  <span><b>3</b> ficam</span><span><b>5</b> duplicam o banco</span>
  <span><b>3</b> viram server-side</span><span><b>2</b> mortos</span>
</p>
```

## Waterfall — cost in time, and how much of it is waiting

Offset bars on a shared track. This is the drawing that makes a latency problem
obvious without a single adjective.

```css
.wf{display:grid;grid-template-columns:auto 1fr auto;gap:6px 14px;align-items:center;margin-top:20px;font-size:12px}
.wf .k{color:var(--muted);font-size:11px;white-space:nowrap}
.wf .track{position:relative;height:8px;background:var(--bg-sub);border:1px solid var(--line)}
.wf .fill{position:absolute;top:0;bottom:0;background:var(--ink)}
.wf .fill.s2{opacity:.72} .wf .fill.s3{opacity:.52} .wf .fill.s4{opacity:.34}
.wf .n{color:var(--ink-2);font-size:11px;text-align:right}
```

```html
<div class="wf">
  <span class="k">html</span><span class="track"><i class="fill" style="left:0;width:16%"></i></span><span class="n">120ms</span>
  <span class="k">getSession</span><span class="track"><i class="fill s2" style="left:16%;width:22%"></i></span><span class="n">160ms</span>
  <span class="k">fetch</span><span class="track"><i class="fill s3" style="left:38%;width:44%"></i></span><span class="n">330ms</span>
</div>
```

## 2×2 matrix — position on two axes

Only when **both** axes genuinely matter (effort × impact, risk × reach). If one
axis is decorative, it's a ranked list.

```css
.matrix{display:grid;grid-template-columns:auto 1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);margin-top:20px;font-size:12.5px}
.matrix>*{background:var(--bg);padding:12px 14px}
.matrix .ax{color:var(--muted);font-size:11px}
```

First cell is empty, then the two column axes, then each row: label + two cells.

## Hand-coded SVG — when no box layout fits

For a real drawing (a topology, a shape, an annotated wireframe), author the SVG
inline. Fixed `viewBox`, `fill="none"`, `stroke="currentColor"`, `stroke-width`
1.5–2, rounded caps, and `color:var(--muted)` on the wrapper so it never glows
on dark. Simple primitives only — `<line>`, `<rect>`, `<polyline>`, `<path>`
with straight segments. Geometry you can verify by eye is geometry you can ship;
a curve you guessed at is a broken drawing at 100% zoom.

Label with real `<text>` at 10–11px in the mono stack, or with HTML positioned
around the SVG. Never with an image.

## What not to draw

- **Boxes-and-arrows spaghetti** — anything crossing lines or needing a routing
  algorithm. If the connections don't lay out left→right or top→bottom, it is a
  table of pairs.
- **A diagram of something the reader already pictures** (a login form, a REST
  request). Draw the part that is unusual, not the frame around it.
- **Charts of two numbers.** Two numbers are two numbers; write them.
- **Anything that restates a table you're also printing.** Choose one.
