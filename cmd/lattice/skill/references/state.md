# Persistent state — the bridge reference

Ticked checkboxes, a note someone typed, a section they left open: lattice
persists them for you. Read this **before** writing any "save the checkbox" JS —
you almost certainly do not need to write any.

Working example: `examples/state-checklist.html`.

This only works with lattice, for the same reason polls do: storing a value
needs a network POST. It works when the page is served *through* lattice —
opened from the dashboard (`/s/<slug>`) or published with `lattice share <slug>`.
The file on disk is never modified; the bridge is injected at serve time.

---

## Two scopes, chosen per key

| scope | who sees it | where it lives |
|---|---|---|
| `document` (default) | every reader of the summary | `~/.summaries/.lattice/state/<slug>.json`, or D1 on a hosted share |
| `user` | only that reader | the same store, keyed by a viewer id |

The viewer id is the browser's own id (minted in `localStorage`) or, on a
domain-gated hosted share where the reader signed in with Google, their actor id
— so their keys follow them across devices.

Pick per element with `data-lattice-scope`, which any ancestor can carry:

```html
<!-- shared: the team's decision about this line item -->
<input type="checkbox" data-lattice-state="cut.analytics-api">

<!-- personal: my own reading progress, invisible to everyone else -->
<section data-lattice-scope="user">
  <input type="checkbox" data-lattice-state="read.section-b">
  <textarea data-lattice-state="notes.section-b"></textarea>
</section>
```

Set a page-wide default with `<body data-lattice-scope="user">` when the whole
summary is personal.

> On a **public-by-URL** share, anyone with the link can write the document
> scope — the same trust model as voting. If a value must not be editable by
> whoever holds the link, use `user`, or gate the share with `--domain`.

## Zero-JS: bind by attribute

Give the element `data-lattice-state="<key>"` and it persists itself. No script,
no listener, no save button:

| element | stored value |
|---|---|
| `<input type="checkbox">` | `true` / `false` |
| radio group (same key on each) | the selected `value` |
| `<input>`, `<textarea>` | the string (debounced ~400 ms while typing) |
| `<select>`, `<select multiple>` | value, or array of values |
| `<details>` | `true` / `false` (open) |

Keys follow the `data-lattice-comment` rule: **stable and semantic**.
`cut.cloudrun-analytics`, never `item-7`. A renamed key is a lost value, and
positional keys break the moment the page is reordered.

## The API — `window.lattice.state`

For anything the attribute can't express: totals, progress bars, a value that
isn't a form control.

| call | does |
|---|---|
| `lattice.state.get(key)` | current value, or `undefined` |
| `lattice.state.set(key, value, {scope})` | optimistic write + queued POST |
| `lattice.state.remove(key)` | delete the key |
| `lattice.state.all(scope?)` | `{key: value}` snapshot |
| `lattice.state.scopeOf(key)` | `'document'` or `'user'` |
| `lattice.state.subscribe(fn)` | `fn({key, value, scope, remote})` on every change |
| `await lattice.state.ready` | resolves once the server's values have landed |
| `lattice.state.bind(el?)` | bind elements you added to the DOM later |
| `lattice.state.flush()` | force the pending POST (rarely needed) |
| `lattice.viewer` | this reader's id |

Values are JSON: booleans, numbers, strings, arrays, objects. Keep them small
(8 KB per key, 500 keys per scope).

## The ordering gotcha

The bridge is injected **after** the page's scripts, so `window.lattice` is
`undefined` at load. Wait for its event — `lattice:state-ready`, not the poll
bridge's `lattice:ready` — and then for the values to arrive:

```js
function boot(){
  lattice.state.ready.then(paint);            // values are in
  lattice.state.subscribe(paint);             // and keep painting on change
}
window.lattice?.state ? boot() : document.addEventListener('lattice:state-ready', boot, { once:true });
```

`subscribe` also fires for **remote** changes (`remote: true`): another reader
ticking a document key, or an agent running `lattice state set`. Locally those
arrive over SSE within a second, so two open windows stay in step; on a hosted
share they arrive when the tab regains focus.

Recomputing derived numbers belongs in the same `paint` — a checklist that
persists ticks but shows a stale total is worse than one that persists nothing.

## Degrading without the bridge

A file opened straight from disk never fires `lattice:state-ready`. The page
**stays readable** and the checkboxes still tick — they just don't persist. Add
a short timeout as a safety net and say so, honestly and briefly:

```js
setTimeout(function(){ if(!window.lattice?.state) degrade() }, 600);
```

`degrade()` shows one line ("open through lattice to keep these ticks") and
nothing else changes. Never fake a saved state, never invent a progress number,
and never build an "export your ticks / paste them back" flow — for state, as
for polls, **the link is the sharing mechanism, not the file**.

## Reading and writing it outside the page

```sh
lattice state <slug>                       # everything, per scope and reader
lattice state <slug> --json                # machine-readable
lattice state set <slug> <key> <value>     # value parses as JSON, else a string
lattice state set <slug> <key> true --scope user --user <viewer-id>
lattice state rm <slug> <key>
lattice state clear <slug> [--scope document|user]
lattice state <slug> --hosted              # the hosted share's state instead
```

This is the point of the feature for agents: `lattice state <slug> --json` tells
you **what the human actually ticked** before you write the follow-up summary.
Writing is how you pre-fill a checklist from what you already know.

State survives `lattice rm` (the file is keyed by slug) but not `lattice
unshare` on the hosted side — a released subdomain must not hand its state to
whatever share claims it next.

## Before handing off a stateful page

- [ ] Keys are stable and semantic; nothing positional or generated.
- [ ] The scope is deliberate per key — shared decisions `document`, private
      reading state `user` — and you said which is which in the page if it
      matters to the reader.
- [ ] No synchronous `window.lattice` read at load; the `lattice:state-ready`
      gate is there.
- [ ] Derived numbers (totals, progress, counts) repaint from `subscribe`, not
      only from the click handler.
- [ ] Reloading restores everything, including `<details>` and text fields.
- [ ] Opened as a loose file: readable, honest one-line notice, nothing faked.
- [ ] Actually tested — `lattice add`, open `/s/<slug>`, tick, reload,
      `lattice state <slug>`.

Summaries that persist nothing are untouched by any of this: no state keys, no
bridge use, pure single file.
