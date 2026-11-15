// Record cross-check: compares independent records about the same tower and lists where they disagree.
// Every finding names both sources and both values, so anyone can check it against the evidence drawer.
// A finding is an observation to investigate, never proof of an error or of wrongdoing. A finding that rests on a
// simulated value says so (sim: true); the browser sends the findings to the backend agent with each tower.
(function () {
  const LW = window.LW, pct = x => Math.round(x * 100) + '%', fmt = n => Math.round(n).toLocaleString('en-US'), FT = 3.28084;
  // thresholds: points of occupancy, floor-area ratios, plausible floor-to-floor range (ft), the current year
  LW.REC = { leasedGap: 25, saleDrop: 25, areaHi: 1.35, areaLo: 0.5, f2fLo: 9, f2fHi: 20, year: new Date().getFullYear() };
  const SIM = ['SIMULATED'];

  LW.recordCheck = function (b) {
    const out = [], R = LW.REC, c = (b.ev && b.ev.costar) || null, I = (b.ev && b.ev.matterport) || null, src = k => LW.srcOf(b, k);
    const add = (key, title, a, z, note, sim) => out.push({ key, title, a, b: z, note, sim: !!sim });
    const f2f = LW.eff(b, 'f2f'), rep = LW.eff(b, 'rep'), floors = LW.eff(b, 'floors');

    // 1. a floor-to-floor record lower than the ceiling a scan measured
    if (LW.f2fConflict(b) && src('f2f') !== 'ESTIMATE') add('f2f', 'Floor-to-floor record is lower than the scanned ceiling allows',
      [src('f2f'), `${f2f} ft slab to slab on record`], ['MATTERPORT', `${b.ceil} ft clear ceiling measured, which needs at least ${LW.scanF2f(b)} ft`],
      'The record may describe another floor, or be out of date. Measure one floor on site.');
    // 2. a slab-to-slab record that does not fit the building's own height and storeys (noted when the CoStar data was imported)
    if (c && c.f2f_note && / but /.test(c.f2f_note)) { const m = c.f2f_note.split(/, but |: /);
      add('f2fHeight', 'Slab-to-slab record does not fit the height and storeys', ['COSTAR', m[0]], ['OSM', m[1] || c.f2f_note], 'Lightwell uses the height-based value and asks for a site measurement.'); }
    // 3. occupancy two ways: space not on the market against the space the tenant list covers
    if (c && c.leased != null && c.leased_tenancy != null) { const lp = c.leased <= 1 ? c.leased * 100 : c.leased, gap = lp - c.leased_tenancy;
      if (gap >= R.leasedGap) add('roster', 'Leased space the tenant list does not account for',
        ['COSTAR', `${Math.round(lp)}% leased, from the space on the market`], ['COSTAR', `${Math.round(c.leased_tenancy)}% of the building in ${c.tenants_current || 0} current tenancies`],
        `About ${Math.round(gap)} points of the building are neither listed as available nor on the tenant list. Leases may be missing from the list, or space may be empty but not marketed. Ask for the rent roll.`); }
    // 4. timeline: occupancy at the last sale against occupancy now
    if (c && c.sale_leased != null && rep != null && src('rep') === 'COSTAR' && c.sale_leased - rep * 100 >= R.saleDrop) add('sale', 'Occupancy has fallen sharply since the last sale',
      ['COSTAR', `${Math.round(c.sale_leased)}% leased at the sale${c.sale_date ? ' on ' + c.sale_date : ''}`], ['COSTAR', `${pct(rep)} leased now`],
      'A fall like this is the vacancy signal Lightwell looks for. Confirm the current rent roll with the owner.');
    // 5. floor area three ways: CoStar's typical floor, the map footprint, and the largest scan
    if (c && c.typical_sqft && b.footprint) { const r = c.typical_sqft / b.footprint;
      if (r > R.areaHi || r < R.areaLo) add('area', 'Typical floor on record does not match the map footprint',
        ['COSTAR', `${fmt(c.typical_sqft)} sq ft typical floor`], ['OSM', `${fmt(b.footprint)} sq ft footprint`],
        r < R.areaLo ? 'The footprint may include a podium or a garage, or the tower steps back above it.' : 'The footprint may be only part of the building. Check the plate before trusting the home count.'); }
    if (c && c.typical_sqft && I && I.scan_area > c.typical_sqft * 1.1) add('scanArea', 'A scan covers more floor than the typical floor on record',
      ['MATTERPORT', `${fmt(I.scan_area)} sq ft scanned on one floor`], ['COSTAR', `${fmt(c.typical_sqft)} sq ft typical floor`], 'The typical floor on record is too small for that floor.');
    // 6. storeys against height (both real): an implausible height per floor means one of the two is wrong
    if (src('floors') !== 'ESTIMATE' && ['OSM', 'COSTAR'].includes((b.src || {}).heightM) && b.heightM && floors) { const per = b.heightM * FT / floors;
      if (per < R.f2fLo || per > R.f2fHi) add('storeys', 'Storey count and height do not fit each other',
        [src('floors'), `${floors} storeys`], [b.src.heightM, `${b.heightM} m tall: ${per.toFixed(1)} ft a floor`], `Office floors are ${R.f2fLo} to ${R.f2fHi} ft apart, so the storey count or the height is wrong.`); }
    // 7. reported occupancy against the cars counted from the air (the engine's occupancy discrepancy)
    if (b.phantom && rep != null) add('parking', 'Reported occupancy is far above the cars counted from the air',
      [src('rep'), `${pct(rep)} leased`], [src('obs'), `parking never above ${pct(Math.max(...b.obs))} across ${b.obs.length} captures`],
      'Garages, transit or remote work can explain this. Ask for garage counts or badge data before drawing any conclusion.', SIM.includes(src('rep')) || SIM.includes(src('obs')));
    // 8. leases on the tenant list that have already ended
    const T = Array.isArray(b.tenants) ? b.tenants.filter(t => t.lease_end != null && t.lease_end < R.year) : [];
    if (T.length && c) add('stale', `${T.length} lease${T.length > 1 ? 's' : ''} on the tenant list ${T.length > 1 ? 'have' : 'has'} already ended`,
      ['COSTAR', `lease end ${[...new Set(T.map(t => t.lease_end))].sort().join(', ')}`], ['COSTAR', `still listed as current: ${T.slice(0, 3).map(t => t.name).join('; ')}${T.length > 3 ? '; …' : ''}`],
      'The tenant may be holding over, may have renewed, or may have left. Either way the record needs an update.');
    return out;
  };
  // All towers: [{ id, label, findings }] for towers with at least one finding, most findings first.
  LW.recordCheckAll = B => B.map(b => ({ id: b.id, label: b.label, findings: LW.recordCheck(b) })).filter(x => x.findings.length).sort((a, c) => c.findings.length - a.findings.length);
  // One sentence for the agent's log and the chat.
  LW.recordSummary = function (B) {
    const all = LW.recordCheckAll(B), n = all.reduce((s, x) => s + x.findings.length, 0), real = all.reduce((s, x) => s + x.findings.filter(f => !f.sim).length, 0);
    if (!n) return 'Record cross-check: no two sources disagree on any tower.';
    const top = all.find(x => x.findings.some(f => !f.sim)) || all[0], f = top.findings.find(x => !x.sim) || top.findings[0];
    return `Record cross-check: ${n} place${n > 1 ? 's' : ''} where two sources disagree, on ${all.length} tower${all.length > 1 ? 's' : ''} (${real} on real data). `
      + `For example ${top.label}: ${f.title.toLowerCase()} (${f.a[0]}: ${f.a[1]}; ${f.b[0]}: ${f.b[1]}). Observations to investigate, not findings.`;
  };
})();
