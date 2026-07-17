// lattice poll bridge. Injected at serve time (never into the file on disk):
// gives the page window.lattice.{submit,results,recall} so a summary can run an
// interactive poll. Endpoints differ by context (public share vs local /s/),
// carried on this script's data-* attributes, so the page never hard-codes them.
//
//   window.lattice.submit({ poll, choice })  → POST one vote (voter auto-attached)
//   window.lattice.submit({ votes: {...} })  → POST many at once
//   window.lattice.results()                 → { polls: { q: { total, counts } }, voters }
//   window.lattice.recall(poll)              → this browser's remembered choice | null
//   window.lattice.recallAll()               → { poll: choice, ... }
//   window.lattice.voter                     → this browser's stable voter id
//
// Persistence: the voter id and the browser's own choices live in localStorage
// (per summary), so a reload restores "you already voted" state and a re-vote
// overwrites rather than double-counts (server dedupes last-write-wins by voter).
(() => {
  'use strict';
  const me = document.currentScript || document.getElementById('lattice-poll');
  const submitEP = (me && me.dataset.endpoint) || '/submit';
  const resultsEP = (me && me.dataset.results) || '/results';

  const NS = 'lattice-poll:' + location.pathname;
  const get = (k, d) => { try { const v = localStorage.getItem(NS + ':' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(NS + ':' + k, JSON.stringify(v)); } catch {} };

  let voter = get('voter', null);
  if (!voter) { voter = 'v-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); set('voter', voter); }

  const rememberMine = (payload) => {
    const mine = get('mine', {});
    if (payload.poll != null && payload.choice != null) mine[payload.poll] = payload.choice;
    if (payload.votes && typeof payload.votes === 'object') Object.assign(mine, payload.votes);
    set('mine', mine);
  };

  window.lattice = Object.assign(window.lattice || {}, {
    poll: true,
    voter,
    async submit(data) {
      const payload = Object.assign({ voter }, data);
      rememberMine(payload);
      try {
        const r = await fetch(submitEP, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return r.ok;
      } catch { return false; }
    },
    async results() {
      try { return await (await fetch(resultsEP, { cache: 'no-store' })).json(); }
      catch { return null; }
    },
    recall: (poll) => get('mine', {})[poll] ?? null,
    recallAll: () => get('mine', {}),
  });

  // Zero-JS integration: any <form data-lattice-poll> submits its fields.
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f || !f.matches || !f.matches('form[data-lattice-poll]')) return;
    e.preventDefault();
    window.lattice.submit(Object.fromEntries(new FormData(f))).then((ok) => {
      f.dispatchEvent(new CustomEvent(ok ? 'lattice:submitted' : 'lattice:error', { bubbles: true }));
    });
  });

  // This bridge is injected AFTER the page's own scripts, so a page's load-time
  // code (e.g. restoring a prior vote) can't see window.lattice synchronously.
  // Fire an event they can wait on. Pattern for pages:
  //   const go = () => { /* uses window.lattice */ };
  //   window.lattice?.poll ? go() : document.addEventListener('lattice:ready', go, {once:true});
  document.dispatchEvent(new CustomEvent('lattice:ready', { detail: window.lattice }));
})();
