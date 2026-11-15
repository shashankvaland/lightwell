// Memory between visits (this browser only, nothing leaves the page): the brief you settled on and the values you
// corrected or measured. On the next visit Lightwell restores them, says so, and the agent does not ask again for a
// value you already gave. "Forget" clears it.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id), KEY = 'lightwell.memory.v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const write = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ } };
  const DEF = JSON.stringify(LW.S);   // the default brief, before anything is restored
  let on = false;                     // nothing is saved until the page has started and restored
  const M = LW.memory = {
    restored: null,
    // corrections for the towers just built (called on every load of the tower list, so a data-mode switch keeps them)
    apply() { const m = read(); if (!m || !m.fixes) return 0; let n = 0;
      LW.B.forEach(b => { if (m.fixes[b.osmId]) { b.overrides = { ...m.fixes[b.osmId] }; n++; } }); return n; },
    restore() { const m = read(); on = true; if (!m) return;
      const n = LW.B.filter(b => Object.keys(b.overrides || {}).length).length;
      if (m.brief) LW.setBrief(m.brief);
      if (m.brief || n) M.restored = { brief: !!m.brief, fixes: n, at: m.at };
      M.note(); },
    save() { if (!on || !LW.B) return;
      const fixes = {}; LW.B.forEach(b => { if (Object.keys(b.overrides || {}).length) fixes[b.osmId] = b.overrides; });
      const brief = JSON.stringify(LW.S) === DEF ? null : LW.S;
      write(brief || Object.keys(fixes).length ? { brief, fixes, at: new Date().toISOString() } : null); M.note(); },
    forget() { write(null); M.restored = null; LW.B.forEach(b => { b.overrides = {}; }); LW.setBrief(JSON.parse(DEF));
      if (LW.scored) LW.analyzeAll(); M.note(); LW.toast('Forgotten: default brief, no corrections'); },
    // one sentence for the agent's log
    line() { const r = M.restored; if (!r) return '';
      return `Using what you taught me${r.at ? ' on ' + new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}: ${[r.brief ? 'your brief' : '', r.fixes ? `${r.fixes} corrected tower${r.fixes > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')}. `
        + 'I won\'t ask again for a value you already gave.'; },
    note() { const el = $('memNote'); if (!el) return; const m = read();
      const n = m && m.fixes ? Object.keys(m.fixes).length : 0;
      el.style.display = m ? 'flex' : 'none';
      if (m) { el.innerHTML = `<span>${M.restored ? 'Restored from your last visit' : 'Remembered for next time'}: ${[m.brief ? 'this brief' : '', n ? `${n} corrected tower${n > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')}.</span>`
        + '<button id="memForget" title="Go back to the default brief and drop your corrections">Forget</button>';
        $('memForget').onclick = M.forget; } },
  };
  // save after anything that can change the brief or a correction
  for (const k of ['refresh', 'setBrief']) { const f = LW[k]; LW[k] = function () { const r = f.apply(this, arguments); M.save(); return r; }; }
})();
