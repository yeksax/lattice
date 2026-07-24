# Polls and bake-offs — the bridge reference

This only works with lattice: collecting votes depends on the daemon (or on
lattice.pub). Read this file **before** writing any voting JS.

Working examples:

| file | pattern |
|---|---|
| `examples/poll-live-reveal.html` | A — vote, reveal immediately |
| `examples/poll-bakeoff.html` | B — blind until the last vote |

---

## How it works

A vote needs a POST. That makes a poll **the one deliberate exception** to "one
file, works anywhere": it only collects when the page is served *through*
lattice — opened from the dashboard (`/s/<slug>`) or published with
`lattice share <slug>`.

Lattice injects a **bridge** at serve time. The file on disk stays intact: no
collection script is ever written into it.

**For a poll the LINK is the sharing mechanism, not the file.** Never build an
"export your vote", "copy the vote code", "paste the result here" flow. There is
no way to collect from a loose file — degrade honestly instead of faking one.

## The bridge — `window.lattice`

Every method is safe to call with no arguments.

| call | does |
|---|---|
| `lattice.poll` | truthy when the bridge is present |
| `await lattice.submit({ poll, choice, name? })` | record one vote → `true`/`false`. Also takes `{ votes: {q1:'a', q2:'b'} }` for several at once |
| `await lattice.results()` | live aggregate: `{ polls: { <poll>: { total, counts: {<choice>: n} } }, voters }` — **counts only, never who voted** |
| `lattice.recall(poll)` | this browser's remembered choice, or `null` |
| `lattice.recallAll()` | `{ poll: choice, … }` for resuming multi-question flows |
| `lattice.voter` | this browser's stable id, attached to every submit automatically |

Identity and dedup are automatic: the bridge mints a per-browser `voter` id in
`localStorage` and attaches it to every submit. The server dedups
**last-write-wins per (voter, poll)** — a reload doesn't double-count, and voting
again *changes* the vote. `submit` also remembers the choice locally, which is
what `recall` reads back.

## The ordering gotcha (what breaks most often)

The bridge is injected **after** your page's scripts. At load `window.lattice` is
still `undefined`, so you **cannot** read it synchronously for load-time work —
restoring a previous vote, for instance. At submit time (a click, later) it is
always there.

```js
function boot(){ /* uses window.lattice */ }
window.lattice?.poll ? boot() : document.addEventListener('lattice:ready', boot, { once:true });
```

A file opened straight from disk **never** fires `lattice:ready`. If the page has
to show something in that case (the degradation notice), add a short timeout as a
safety net — and make `boot` idempotent, because the bridge can still arrive
afterwards:

```js
setTimeout(function(){ if(!window.lattice?.poll) boot() }, 600);
```

---

## Pattern A — immediate reveal

`examples/poll-live-reveal.html`

Vote → reveal → let them change their mind → survive reloads. Use it when seeing
the tally early spoils nothing.

```js
const POLL = 'is-the-nightly-job-worth-it';   // stable id: changing it loses the votes
async function paint(mine){
  const q = (await lattice.results()).polls[POLL] ?? { total:0, counts:{} };
  for (const btn of buttons){
    const n = q.counts[btn.dataset.choice] || 0;
    const pct = q.total ? Math.round(n/q.total*100) : 0;
    btn.querySelector('.fill').style.width = pct + '%';
    btn.querySelector('.pct').textContent = pct + '% · ' + n;
    btn.classList.toggle('mine', btn.dataset.choice === mine);
  }
}
async function vote(choice){
  if (!window.lattice?.poll) return degrade();
  if (!await lattice.submit({ poll: POLL, choice })) return retryHint();
  paint(choice);                              // includes the vote just cast
}
```

Two rules:

- **The option stays clickable after the vote.** A second click re-submits and
  the bars update — that is the "change your vote" affordance. Locking the option
  after the first click is the most common mistake here.
- **No percentages before voting.** Someone who hasn't voted yet shouldn't see
  the tally; that is a bandwagon effect.

## Pattern B — blind bake-off

`examples/poll-bakeoff.html`

For comparing A/B/C across several cases. **This is the pattern agents get
wrong**: they reveal each case as soon as it is voted. Don't. Three hard rules:

1. **Blind phase** (not all voted): a vote only marks the pick (a "your vote"
   badge) and moves the `n / total` progress bar. Reveal **nothing** per case —
   no identity, no cost/latency, no tally. Keep the data in the DOM, hidden
   behind a `.revealed` class you have not added yet.
2. **Reveal everything at once**, only when `allVoted()`. One gate decides blind
   vs. revealed on every vote; **there is no per-case reveal path**.
3. **The closing block lives at the END of the page** — never a live leaderboard
   at the top, which spoils the blind test and looks broken while empty. Gated on
   `allVoted()` too: champion block + summed leaderboard + a winner-vs-your-pick
   table. That is the payoff for finishing.

```js
const CASES = DATA.scenes.map(s => s.id), N = CASES.length;
const pick = id => lattice.recall(id);
const votedCount = () => CASES.filter(pick).length;
const allVoted   = () => votedCount() === N;

function afterVote(agg){                       // THE one gate
  updateProgress(votedCount(), N);
  if (allVoted()) CASES.forEach(id => reveal(id, agg));
  else            CASES.forEach(markPickOnly);
  renderSummary(agg);                          // locked while !allVoted()
}
```

While voting, show only progress ("3 / 6 voted") and the "your vote" marker.
Everything else waits for the last vote.

---

## Result-bar styling

Not thin free-floating lines. Each option row gets a **proportional ink fill
behind the text**, with `% · count` right-aligned in `tabular-nums`:

```css
.opt{position:relative;overflow:hidden}
.opt .fill{position:absolute;left:0;top:0;bottom:0;width:0;
           background:var(--ink);opacity:.12;transition:width .18s ease-out}
.opt .row{position:relative}          /* content sits above the fill */
```

Mark the voter's own pick with the inverted key badge (`--ink` background, `--bg`
text) and a "your vote" in `--muted`. Honour `prefers-reduced-motion` on the
fill's width transition.

## Degrading without the bridge

When `window.lattice` doesn't exist the page **stays readable** — it just doesn't
collect. What to do:

- Disable the vote buttons (`disabled`, `cursor:default`).
- Show a short, truthful notice: the file was opened loose; register it with
  `lattice add` and open it at `127.0.0.1:4600/s/<slug>`.
- In pattern B, the closing block stays locked, with the same explanation.

What **not** to do: sample numbers, a fake tally, "illustrative data", or local
voting that pretends to have been recorded.

## Collecting and sharing

Votes cast through the local daemon land in
`~/.summaries/.lattice/polls/<slug>.jsonl`. Votes on a public link are collected
by the hosted backend (lattice.pub).

```sh
lattice add path/to/file.html --tags poll
lattice share <slug>          # publishes; --random for an unguessable subdomain
lattice results <slug>        # dumps the responses
lattice unshare <slug>
```

`share` requires `lattice login <token>`, and exposes only that one summary, its
`POST /submit` and the read-only `GET /results`.

> `share` publishes to the internet. It is an external action and effectively
> irreversible (the snapshot may be cached). Only run it if the user explicitly
> asks for it.

## Before handing off a poll

- [ ] Poll ids stable and descriptive (`scene-01-density`, not `p1`).
- [ ] No synchronous read of `window.lattice` at load; the `lattice:ready` gate is there.
- [ ] Reloading restores the vote and does **not** count it again.
- [ ] Clicking another option **changes** the vote and the bars follow.
- [ ] Pattern B: with one vote missing — no identity, no numbers, no partial tally.
- [ ] Pattern B: the closing block is at the end of the document, not the top.
- [ ] Opened as a loose file: honest notice, voting disabled, zero invented numbers.
- [ ] Actually tested — `lattice add`, open `/s/<slug>`, vote, `lattice results <slug>`.

Summaries without a poll are untouched by any of this: no bridge, pure single
file, fully offline.
