// Start screen: the problem in Houston and the Texas law that now lets empty offices become homes.
// Every number here is sourced (links at the bottom). The last line is computed from the towers on this map.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id);
  const KEY = 'lightwell.introSeen';
  const store = { get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (e) { /* private mode */ } } };

  function live() {
    if (!LW.B || !LW.fastTrack) return '';
    const fts = LW.B.map(LW.fastTrack), known = fts.filter(f => f.status !== 'unknown');
    if (!known.length) return 'Import CoStar floor-by-floor availability to check the 65% rule on these towers.';
    const ready = known.filter(f => f.status === 'ready').length, sh = known.filter(f => f.status === 'shuffle').length;
    const sim = LW.B.some(b => LW.srcOf(b, 'vacant') === 'SIMULATED');
    return `On this map: <b>${ready}</b> of ${known.length} towers already have 65% of their floors empty; <b>${sh}</b> could get there if some tenants move.`
      + (sim ? ' <i>(Demo: floor vacancy simulated until CoStar data is loaded.)</i>' : '');
  }

  LW.intro = {
    open() {
      const el = $('intro'); el.querySelector('#introLive').innerHTML = live();
      el.querySelector('#introSkip').checked = !!store.get();
      el.classList.add('show'); el.querySelector('#introGo').focus();
    },
    close() { $('intro').classList.remove('show'); store.set($('introSkip').checked); },
    maybe() { if (!store.get()) this.open(); },
  };
  $('introGo').onclick = () => LW.intro.close();
  $('intro').addEventListener('click', e => { if (e.target.id === 'intro') LW.intro.close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('intro').classList.contains('show')) LW.intro.close(); });
  $('whyHouston').onclick = e => { e.preventDefault(); LW.intro.open(); };
})();
