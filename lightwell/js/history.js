// Team history: every agent run the backend finishes is saved in MongoDB Atlas (backend/store.py). This panel shows
// which towers keep winning across everyone's briefs, and the latest runs; click one to re-open that brief.
// Hidden unless the backend reports a connected store (MONGODB_URI set), so nothing changes without Atlas.
(function () {
  const LW = window.LW = window.LW || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const name = id => { const b = LW.B && LW.B.find(x => x.id === id); return b ? b.label || id : id; };
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000;
    return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
  const briefLine = S => S ? `under ${LW.money ? LW.money(S.cap) : S.cap}/home, ${S.u} ft window, ${S.minHomes}+ homes` +
    (S.allowLW ? '' : ', no lightwells') + (S.require && S.require.length ? ', real data only' : '') : '';
  let runs = [];

  async function load() {
    const A = LW.agent, box = $('history');
    if (!box || !A || !A.backend || !A.backend.store) { if (box) box.hidden = true; return; }
    const url = A.backendUrl();
    try {
      const [r, l] = await Promise.all([fetch(url + '/api/runs?n=8').then(x => x.json()), fetch(url + '/api/leaderboard?n=5').then(x => x.json())]);
      runs = r.runs || [];
      box.hidden = false;
      $('histCount').textContent = runs.length ? runs.length : '';
      const towers = l.towers || [];
      $('histBoard').innerHTML = towers.length
        ? `<div class="hh">Most picked across all saved runs</div>` + towers.map(t =>
          `<button class="hrow" data-t="${esc(t.tower)}"><b>${esc(name(t.tower))}</b><span>${t.wins} win${t.wins === 1 ? '' : 's'} · ${t.briefs} brief${t.briefs === 1 ? '' : 's'}</span></button>`).join('')
        : '<div class="hh">No saved runs yet. Run the agent and it is saved here for the whole team.</div>';
      $('histRuns').innerHTML = runs.length ? `<div class="hh">Latest runs</div>` + runs.map((x, i) =>
        `<button class="hrow" data-i="${i}" title="Load this brief"><b>${esc(x.top ? name(x.top) : 'nothing passed')}</b>` +
        `<span>${esc(briefLine(x.brief))} · ${x.passing}/${x.towers} pass · ${esc(x.mode || '')} · ${ago(x.at)}</span></button>`).join('') : '';
    } catch (e) { box.hidden = true; }
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('#history .hrow'); if (!t) return;
    if (t.dataset.t) { const b = LW.B && LW.B.find(x => x.id === t.dataset.t); if (b && LW.onSelect) LW.onSelect(b, true); return; }
    const r = runs[+t.dataset.i]; if (!r) return;
    if (r.prompt && $('prompt')) $('prompt').value = r.prompt;
    if (r.brief && LW.setBrief) { LW.setBrief(r.brief); if (LW.scored && LW.analyzeAll) LW.analyzeAll(); if (LW.refresh) LW.refresh(); }
    const b = r.top && LW.B && LW.B.find(x => x.id === r.top); if (b && LW.onSelect) LW.onSelect(b, true);
  });

  LW.history = { load };
})();
