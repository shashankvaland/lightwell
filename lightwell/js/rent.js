// Rent check: would anyone pay the rent a converted tower needs?
// backend/rent.py mirrors rentCheck (parity-tested); marketRent runs in the browser and is sent to the backend.
//
// Market rent: real asking rents from the CoStar data kit (backend/rent_comps.py -> real-data/rents.csv ->
// import_data.py -> LIGHTWELL_REAL.rents). For each tower: listings within 1.2 km (2.5 km if fewer than 5), median rent
// by bedroom count where 3+ listings exist, otherwise median rent per sq ft times the home's size on this layout.
// Required rent: the monthly rent per home that pays back the conversion at a target yield on cost, after operating
// costs and vacancy:  (cost per home x yield + operating cost per home per year) / (12 x (1 - vacancy)).
// Affordability: household income needed to pay the market rent at 30% of income, against Houston's median.
// No CoStar rents loaded -> the check says so; nothing is simulated.
(function () {
  const LW = window.LW;
  const RADII = [1200, 2500], MIN_N = 5, MIN_GROUP = 3;
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const distM = (c, x) => Math.hypot((c[0] - x.lon) * Math.cos(c[1] * Math.PI / 180) * 111320, (c[1] - x.lat) * 110540);
  LW.RENT_TYPES = ['Studio', '1-bed', '2-bed'];

  LW.marketRent = function (b, comps) {
    if (!comps || !comps.length || !b.center) return null;
    let near = [], radius = 0;
    const all = comps.map(c => ({ ...c, d: distM(b.center, c) })).sort((x, y) => x.d - y.d);
    for (const r of RADII) { radius = r; near = all.filter(c => c.d <= r); if (near.length >= MIN_N) break; }
    if (near.length < MIN_GROUP) return null;
    const ps = near.filter(c => c.sqft).map(c => c.rent / c.sqft), byBed = {};
    for (const t of [0, 1, 2]) { const g = near.filter(c => c.beds === t).map(c => c.rent); if (g.length >= MIN_GROUP) byBed[t] = { rent: Math.round(median(g)), n: g.length }; }
    return { n: near.length, radius, psf: ps.length >= MIN_GROUP ? Math.round(median(ps) * 100) / 100 : null, psfN: ps.length,
      all: Math.round(median(near.map(c => c.rent))), byBed,
      nearest: all.slice(0, 6).map(c => ({ rent: c.rent, beds: c.beds ?? null, sqft: c.sqft ?? null, dist_m: Math.round(c.d), src: c.src || 'CoStar kit' })) };
  };

  LW.rentCheck = function (b) {
    const p = b.plan, m = b.rentMarket, A = LW.A;
    if (!p || !p.homes || !isFinite(p.cpu)) return null;
    const required = Math.round((p.cpu * A.yieldOnCost + A.opexPerHomeYr) / (12 * (1 - A.rentVacancy)));
    if (!m) return { verdict: 'no_data', required };
    const total = p.mix[0] + p.mix[1] + p.mix[2], types = [];
    for (const t of [0, 1, 2]) {
      const us = p.L.units.filter(u => u.t === t); if (!us.length || !p.mix[t]) continue;
      const area = us.reduce((s, u) => s + u.a, 0) / us.length, bb = m.byBed[String(t)];
      const rent = bb ? bb.rent : m.psf ? Math.round(m.psf * area) : m.all, basis = bb ? `median of ${bb.n} ${LW.RENT_TYPES[t]} listings` : m.psf ? `median $${m.psf}/sq ft x ${Math.round(area)} sq ft` : 'median of all listings';
      types.push({ t, homes: p.mix[t], area: Math.round(area), rent, basis });
    }
    const market = Math.round(types.reduce((s, x) => s + x.rent * x.homes, 0) / total), ratio = market / required;
    const supports = Math.round((market * 12 * (1 - A.rentVacancy) - A.opexPerHomeYr) / A.yieldOnCost);
    const income = Math.round(market * 12 / A.rentBurden);
    return { verdict: ratio >= 1 ? 'works' : ratio >= 0.9 ? 'close' : 'gap', required, market, gap: market - required,
      ratio: Math.round(ratio * 100) / 100, supports_cost_per_home: supports, types, income_needed: income,
      income_share: Math.round(income / A.medianIncome * 100) / 100, n: m.n, radius_m: m.radius };
  };
  LW.RENT_LABEL = { works: 'Rents cover it', close: 'Rents nearly cover it', gap: 'Rents fall short', no_data: 'No CoStar rents loaded' };
})();
