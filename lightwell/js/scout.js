// Data scout: works on the towers that have no CoStar record.
// backend/scout.py mirrors this file; tests/parity.mjs + tests/test_engine.py check both give the same numbers.
//
// 1. scoutGaps: estimates percent leased for towers with no CoStar record from the most similar CoStar towers
//    (nearby, similar height), pulled toward the downtown average (CBRE Houston Q4 2025: 25.2% vacant). The result is
//    tagged ESTIMATE with a range, a confidence and the towers it came from. It never overwrites CoStar, YOU or
//    SIMULATED values, and towers with an estimate still fail "Require real: CoStar".
// 2. dataPriority: which towers are most worth asking CoStar about next. For each tower without a CoStar record it
//    re-runs the screen at the low and high end of what we don't know (occupancy, year built) and ranks towers where
//    the answer would change the decision.
(function () {
  const LW = window.LW;
  const SC = LW.SCOUT = { prior: 0.748, priorW: 1, k: 5, nearM: 600, minHalf: 0.08, repLo: 0.55, repHi: 0.95, yearOld: 1965, yearNew: 2000,
    priorSrc: 'CBRE Houston office figures Q4 2025: 25.2% vacant' };
  const r2 = x => Math.round(x * 100) / 100;
  const distM = (a, c) => {
    const lat = (a.center[1] + c.center[1]) / 2 * Math.PI / 180;
    return Math.round(Math.hypot((a.center[0] - c.center[0]) * Math.cos(lat) * 111320, (a.center[1] - c.center[1]) * 110540));
  };
  const known = b => { const s = LW.srcOf(b, 'rep'); return s === 'COSTAR' || s === 'YOU'; };

  LW.scoutGaps = function (B) {
    const ref = B.filter(b => LW.srcOf(b, 'rep') === 'COSTAR' && LW.eff(b, 'rep') != null && b.center), out = [];
    for (const b of B) {
      if (LW.srcOf(b, 'rep') !== 'MISSING' || !b.center) continue;
      const nf = LW.eff(b, 'floors');
      const nb = ref.map(k => { const d = distM(b, k); return { k, d, w: 1 / (1 + d / 400) / (1 + Math.abs(LW.eff(k, 'floors') - nf) / 15) }; })
        .sort((x, y) => y.w - x.w || x.d - y.d).slice(0, SC.k);
      let sw = 0, sv = 0;
      for (const x of nb) { sw += x.w; sv += x.w * LW.eff(x.k, 'rep'); }
      const est = (sv + SC.priorW * SC.prior) / (sw + SC.priorW);
      let ss = 0; for (const x of nb) ss += x.w * (LW.eff(x.k, 'rep') - est) ** 2;
      const half = Math.max(SC.minHalf, sw ? Math.sqrt(ss / sw) : 0.15), near = nb.filter(x => x.d <= SC.nearM).length;
      out.push({ id: b.id, field: 'rep', value: r2(est), lo: r2(LW.clamp(est - half, 0.05, 0.99)), hi: r2(LW.clamp(est + half, 0.05, 0.99)),
        confidence: near >= 3 ? 'medium' : 'low', near,
        neighbours: nb.map(x => ({ id: x.k.id, leased: r2(LW.eff(x.k, 'rep')), dist_m: x.d })),
        basis: nb.length ? `weighted average of ${nb.length} similar CoStar towers (${near} within ${SC.nearM} m), pulled toward the downtown average`
          : 'downtown average only (no CoStar towers loaded)' });
    }
    return out;
  };

  // Apply estimates (from this file or from the backend agent). Only fills real gaps.
  LW.applyEstimates = function (items) {
    let n = 0;
    for (const e of items || []) {
      const b = LW.B.find(x => x.id === e.id); if (!b || LW.srcOf(b, 'rep') !== 'MISSING') continue;
      b.rep = e.value; b.src.rep = 'ESTIMATE'; b.ev.scout = e; n++;
    }
    return n;
  };
  LW.clearEstimates = function () {
    for (const b of LW.B) if (b.ev.scout) { b.rep = null; b.src.rep = 'MISSING'; delete b.ev.scout; }
  };

  LW.dataPriority = function (B, n) {
    const out = [];
    for (const b of B) {
      if (known(b) || b.converted) continue;
      if (!b.plan) LW.analyze(b);
      const yearUnknown = !['COSTAR', 'YOU'].includes(LW.srcOf(b, 'year'));
      const reps = [SC.repLo, SC.repHi], years = yearUnknown ? [SC.yearOld, SC.yearNew] : [LW.eff(b, 'year')];
      const runs = [];
      for (const rep of reps) for (const year of years) {
        const t = LW.analyze({ ...b, overrides: { ...b.overrides, rep, year } });
        runs.push({ rep, year, score: t.score, pass: t.pass });
      }
      const scores = runs.map(x => x.score), lo = Math.min(...scores), hi = Math.max(...scores);
      const passFlip = runs.some(x => x.pass) && runs.some(x => !x.pass);
      const yearFlip = yearUnknown && reps.some(rep => { const a = runs.filter(x => x.rep === rep); return a[0].pass !== a[1].pass; });
      const ft = LW.fastTrack(b), floorsUnknown = ft.status === 'unknown' || LW.srcOf(b, 'vacant') === 'SIMULATED';
      const reasons = [];
      if (passFlip) reasons.push(yearFlip ? 'passes or fails depending on year built (pre-1980 abatement and sprinkler costs)' : 'passes or fails depending on occupancy');
      if (hi - lo >= 5) reasons.push(`score could be anywhere from ${lo} to ${hi} depending on occupancy${yearUnknown ? ' and age' : ''}`);
      if (b.pass && floorsUnknown) reasons.push('the Texas 65% check needs floor-by-floor availability');
      if (!reasons.length) continue;
      const priority = (passFlip ? 40 : 0) + (hi - lo) + (b.pass ? 15 : 0) + (b.pass && floorsUnknown ? 10 : 0);
      out.push({ id: b.id, priority, score: b.score, passes: b.pass, score_lo: lo, score_hi: hi, pass_flip: passFlip, reasons,
        need: ['occupancy', ...(yearUnknown ? ['year built'] : []), ...(floorsUnknown ? ['available floors'] : [])] });
    }
    out.sort((a, c) => c.priority - a.priority || c.score - a.score || (a.id < c.id ? -1 : 1));
    return out.slice(0, n || 5);
  };
})();
