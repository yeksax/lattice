# Layout — the template is a guide, not a mould

`template.html` shows **one** possible arrangement. It is not the mandatory
skeleton of every summary, and following it step by step is exactly how you end
up with a stack of documents that all look like the same document.

The split that matters:

| | |
|---|---|
| **Identity — fixed** | mono, monochrome, hairline, no radius, no shadow, no tracked caps, dense. This does not bend (except through `theme` in the config). |
| **Layout — yours** | which sections exist, in what order, which components, what density, what opens the page, whether there is a table, a grid, a simulator. |

Every ban in SKILL.md is about **identity**. None of them says "open with a metric
strip". If the content has no four numbers that matter, a strip of four numbers
is filler.

## The KPI-strip trap

The pattern that installs itself the moment the template becomes a mould:

```
4-metric strip → 3-cell bento → table → inverted block
```

It is excellent for a bake-off and wrong for almost everything else. Symptoms
that it was applied on autopilot:

- Metrics nobody asked for, rounded to fit ("~3 days", "6 files").
- An empty bento cell, or one with a sentence stretched to fill the space.
- Three "findings" because the grid has three columns, not because there are three.
- An inverted block carrying a recommendation the page already made.

If you are filling a component instead of choosing one, delete the component.

## Pick the form from the genre

| Genre | What the page is | Form that serves it |
|---|---|---|
| **Decision** | one choice and why | the decision as `h1`, discarded alternatives with their reason, consequences. No metrics. |
| **Audit / costs** | many comparable numbers | the table is the lead component; stacked bars for composition; totals emphasised. A long document, and that's fine. |
| **Diagnosis** | what broke and why | symptom → cause → evidence → fix, as sequential blocks. Evidence is quoted, not paraphrased. |
| **Plan / workstreams** | work not done yet | numbered steps with dependency and owner. No chart. |
| **Bake-off** | comparing candidates | now you want it: metrics, grid, table. |
| **Manual / onboarding** | how a thing is used | re-enacted interaction + step-by-step narration (`examples/interactive-walkthrough.html`). |
| **Period recap** | what happened | grouped by workstream, each with its current state. Chronology only if the order carries meaning. |

## Vocabulary worth having on hand

Components that show up repeatedly in real summaries and are not in
`template.html`. Reach for them when the content asks:

```css
/* opening paragraph — wider and darker than body copy */
.lead{color:var(--ink);font-size:14.5px;max-width:80ch}

/* secondary line: caption, unit, caveat */
.sub{color:var(--muted);font-size:11px}

/* a wide table must not blow the page out on a phone */
.tblwrap{overflow-x:auto}

/* the row that matters — no colour, just fill weight and a stronger rule */
tr.hot td{background:var(--bg-sub);border-bottom-color:var(--line-2)}

/* numbered steps with dependency */
.steps{counter-reset:s;list-style:none;padding:0;margin:18px 0 0}
.steps li{counter-increment:s;position:relative;padding:12px 0 12px 34px;border-top:1px solid var(--line)}
.steps li::before{content:counter(s,decimal-leading-zero);position:absolute;left:0;color:var(--muted);font-size:11px}

/* two columns when there are two things, not three */
.two{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line)}
.two>*{background:var(--bg);padding:18px}
@media(max-width:760px){.two{grid-template-columns:1fr}}

/* legend for the stacked bar */
.barkey{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:6px}
```

The template's opacity ramp stops at four steps. Real data rarely has exactly
four categories — extend it rather than recycling shades:

```
1.00 · 0.72 · 0.52 · 0.34 · 0.22 · 0.14
```

Past six categories, fold the tail into "other" — nobody tells the last shades
apart.

## Simulated surfaces — quoting is not adopting

When the summary re-enacts a product (a Slack conversation, an app screen, a
terminal), **that surface follows the simulated product's rules**, not the
house's. Slack has rounded corners, a bold display name and a green confirm
button; drawing it in monochrome hairline does not make the document more
correct, it makes the simulation unrecognisable — which defeats the point.

The rule is not "anything goes", it is **an explicit boundary**:

- Every token of the simulated product lives in its own namespace
  (`--sim-radius`, `--sim-accent`, `--sim-surface`) declared **on the simulator's
  container**. Outside it the token does not exist, so it cannot leak by accident.
- The frame around it — controls, narration, captions, the rest of the page — is
  the house: mono, hairline, no radius.
- Simulate what is needed for recognition, not a pixel-perfect clone.

`examples/interactive-walkthrough.html` implements exactly that boundary.

## Long documents

"One to two screens" is the default, not a ceiling. A cost audit and an
operations manual exceed it by nature — and there the problem stops being length
and becomes **navigation**. A five-screen document with no orientation is worse
than a ten-screen one with it.

Past roughly three screens:

- An `id` on every section and a short index at the top (titles only, hairline,
  no decorative numbering).
- `scroll-margin-top` on sections so the anchor doesn't weld to the viewport edge.
- A subtotal or closing line per section, for someone reading only one part.
- No sticky header eating height: on 1366×768 every vertical pixel counts.

What does **not** justify a long document: restating in prose what the table
already says, or including the process ("first I ran X, then Y") when only the
result matters.

## `theme` re-skins all of this

If `~/.summaries/.lattice/config.json` has a non-empty `theme`, it overrides the
default identity — `font`, `heading`, `accent`, `tone`, `density`, `dividers`,
`modules`. A summary with `font: sans` and `heading: serif` is still a house
summary: what changes is the skin, not the structure or the rigour.

Apply the theme through the tokens, **at the top of your `<style>`**, never by
hard-coding around them inside a component.

## Procedure

1. Write the conclusion first, in one sentence. That is the `h1`.
2. List what the reader needs in order to believe it. Those become the sections.
3. **Only then** pick the components, one section at a time, from the shape of
   the data. Comparable numbers → table. Composition → stacked bar. Sequence →
   steps. Interaction → simulator. None of the above → prose, which is a
   legitimate answer.
4. If a component is left over with no content justifying it, delete it.
