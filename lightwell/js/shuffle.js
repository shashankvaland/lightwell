// Texas fast-track screen + tenant moves ("Tenant Shuffle").
// backend/shuffle.py mirrors this file; tests/parity.mjs + tests/test_engine.py check both give the same numbers.
//
// Texas SB 840 / SB 2477 (in force 1 Sep 2025, cities over 150k people in counties over 300k, so Houston qualifies):
// an office building at least 5 years old can convert to homes without rezoning, traffic studies or extra parking,
// if at least 65% of the building (and of each occupied floor) becomes residential. A screen, not legal advice.
//
// The catch on a real tower: empty space is scattered and tenants hold leases. A tower that is 40% empty can't reach
// 65% residential until some tenants move. Lightwell plans those moves: which tenants, into which nearby towers
// (preferring towers that are poor conversion candidates, so they stay offices and fill up), and what it costs.
// Tenants come from CoStar's tenant / lease records when imported (b.tenants); otherwise they are derived from the
// leased floors (SIMULATED in demo mode).
(function () {
  const LW = window.LW;
  const P = LW.POLICY = { year: 2026, minAge: 5, resShare: 0.65, farM: 800, longLease: 5 };
  const INDUSTRY = ['Energy', 'Law firm', 'Engineering', 'Bank', 'Consulting', 'Insurance', 'Tech', 'Public agency'];
  const num = b => parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;

  // Tenants of one tower: [{ name, floors: [..], sqft, lease_end, src }]
  LW.tenantsOf = function (b) {
    if (Array.isArray(b.tenants)) return b.tenants;
    if (LW.srcOf(b, 'vacant') === 'MISSING') return null;
    const n = LW.eff(b, 'floors'), empty = new Set(b.vacantFloors || []), k = num(b), out = [];
    let f = 2;
    while (f <= n) {
      if (empty.has(f)) { f++; continue; }
      const size = 1 + ((k * 3 + f) % 4), floors = [];
      while (f <= n && !empty.has(f) && floors.length < size) floors.push(f++);
      const i = out.length;
      out.push({ name: `${INDUSTRY[(k + floors[0]) % 8]} tenant ${String.fromCharCode(65 + (i % 26))}`, floors,
        sqft: Math.round(floors.length * b.W * b.D), lease_end: P.year + ((k * 7 + floors[0] * 13) % 9), src: 'SIMULATED' });
    }
    return out;
  };

  // Texas fast-track screen for one tower.
  LW.fastTrack = function (b) {
    const n = LW.eff(b, 'floors'), year = LW.eff(b, 'year'), age = year == null ? null : P.year - year;
    const known = LW.srcOf(b, 'vacant') !== 'MISSING', free = known ? (b.vacantFloors || []).length : null;
    const need = Math.ceil(P.resShare * n - 1e-9);   // residential floors needed (ground floor stays lobby/retail)
    const short = known ? Math.max(0, need - free) : null;
    const status = !known ? 'unknown' : age != null && age < P.minAge ? 'too_new' : short === 0 ? 'ready' : 'shuffle';
    return { status, floors: n, need, free, short, age, ageKnown: age != null, share: known ? free / n : null };
  };
  LW.FT_LABEL = { ready: 'Fast-track ready', shuffle: 'Needs tenant moves', too_new: 'Too new (under 5 years)', unknown: 'Unknown (no floor data)' };

  const distM = (a, c) => {
    const lat = (a.center[1] + c.center[1]) / 2 * Math.PI / 180;
    return Math.hypot((a.center[0] - c.center[0]) * Math.cos(lat) * 111320, (a.center[1] - c.center[1]) * 110540);
  };

  // Plan tenant moves that free `goal` floors in tower t: 'fast' = reach 65% residential, 'empty' = empty the tower.
  LW.planMoves = function (t, B, goal) {
    goal = goal || 'fast';
    const ft = LW.fastTrack(t), tenants = LW.tenantsOf(t), A = LW.A;
    if (!tenants || ft.status === 'unknown') return null;
    // Real CoStar floors can be shared by several tenants: a floor is freed only when every tenant on it moves.
    const ts = tenants.filter(x => x.floors && x.floors.length), onFloor = new Map();
    for (const x of ts) for (const f of x.floors) onFloor.set(f, (onFloor.get(f) || 0) + 1);
    const want = goal === 'empty' ? onFloor.size : ft.short;
    // leases that end soonest first; a lease end that is not on record (null) goes last
    const key = x => [x.lease_end == null ? 1 : 0, x.lease_end == null ? 0 : x.lease_end, x.floors.length, x.floors[0]];
    const order = [...ts].sort((a, c) => { const p = key(a), q = key(c); for (let i = 0; i < 4; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; });
    const left = new Map(onFloor), pick = []; let freed = 0;
    for (const x of order) { if (freed >= want) break; pick.push(x); for (const f of x.floors) { left.set(f, left.get(f) - 1); if (!left.get(f)) freed++; } }
    // receiving towers: known empty space, not the target; their remaining capacity in sq ft
    const cap = new Map();
    for (const r of B) if (r !== t && LW.srcOf(r, 'vacant') !== 'MISSING' && (r.vacantFloors || []).length)
      cap.set(r, r.vacantFloors.length * r.W * r.D);
    const moves = [], unplaced = [];
    for (const x of pick) {
      const opts = [...cap.keys()].filter(r => cap.get(r) >= x.sqft)
        .map(r => ({ r, d: distM(t, r) })).sort((a, c) => (a.r.pass ? 1 : 0) - (c.r.pass ? 1 : 0) || a.d - c.d || a.r.idx - c.r.idx);
      const yrs = x.lease_end == null ? A.unknownLeaseYrs : Math.max(0, x.lease_end - P.year - 1), cost = x.sqft * (A.moveCostSqft + A.buyoutSqftYr * yrs);
      if (!opts.length) { unplaced.push({ tenant: x.name, sqft: x.sqft, floors: x.floors }); continue; }
      const o = opts[0]; cap.set(o.r, cap.get(o.r) - x.sqft);
      moves.push({ tenant: x.name, floors: x.floors, sqft: x.sqft, lease_end: x.lease_end, src: x.src, from: t.id, to: o.r.id,
        to_passes: !!o.r.pass, dist_m: Math.round(o.d), cost: Math.round(cost), buyout_years: yrs });
    }
    const done = new Map(); for (const m of moves) for (const f of m.floors) done.set(f, (done.get(f) || 0) + 1);
    const movedFloors = [...done].filter(([f, n]) => n === onFloor.get(f)).length, per = t.plan ? t.plan.perFloor : 0;
    const cost = moves.reduce((s, m) => s + m.cost, 0), gained = movedFloors * per;
    const fastAfter = ft.status !== 'too_new' && ft.free + movedFloors >= ft.need;
    return { tower: t.id, goal, want, moves, unplaced, freed_floors: movedFloors, cost, homes_now: ft.free * per,
      homes_after: (ft.free + movedFloors) * per, homes_gained: gained, cost_per_home_gained: gained ? Math.round(cost / gained) : null,
      fast_track_after: fastAfter, receivers: [...new Set(moves.map(m => m.to))] };
  };

  // Red team: attack a tenant-move plan. Returns [{ level: 'high'|'medium'|'low', text }] and a verdict.
  LW.challengePlan = function (t, plan, B) {
    const out = [], ft = LW.fastTrack(t), byId = new Map(B.map(b => [b.id, b]));
    if (!plan) return { verdict: 'no_plan', risks: [{ level: 'high', text: `${t.id} has no floor-by-floor data, so no move plan can be made.` }] };
    if (!t.pass) out.push({ level: 'high', text: `${t.id} itself doesn't pass the brief (${(t.why || []).join(', ')}): emptying it may not lead to homes.` });
    if (ft.status === 'too_new') out.push({ level: 'high', text: `${t.id} is under ${P.minAge} years old, so the Texas fast-track doesn't apply.` });
    if (!ft.ageKnown) out.push({ level: 'medium', text: `Year built is missing for ${t.id}: fast-track eligibility (5+ years old) is unverified.` });
    for (const m of plan.moves) if (m.lease_end != null && m.lease_end - P.year >= P.longLease)
      out.push({ level: 'high', text: `${m.tenant} has a lease to ${m.lease_end}: they can refuse, and a buyout of ~$${Math.round(m.cost / 1e5) / 10}M is an estimate.` });
    const unk = plan.moves.filter(m => m.lease_end == null);
    if (unk.length) out.push({ level: 'medium', text: `${unk.length} tenant(s) have no lease end on record: the buyout assumes ${unk[0].buyout_years} more years; confirm with the rent roll.` });
    for (const m of plan.moves) if (m.dist_m > P.farM) out.push({ level: 'medium', text: `${m.tenant} would move ${m.dist_m} m to ${m.to}: far enough that they may prefer to leave downtown.` });
    for (const id of plan.receivers) { const r = byId.get(id); if (r && r.pass) out.push({ level: 'medium', text: `${id} receives tenants but is itself a conversion candidate: filling it blocks its own homes.` }); }
    if (plan.unplaced.length) out.push({ level: 'high', text: `${plan.unplaced.length} tenant(s) have no tower nearby with enough empty space.` });
    if (!plan.fast_track_after && plan.goal === 'fast') out.push({ level: 'high', text: `The moves don't reach 65% residential, so the fast-track still doesn't apply.` });
    if (plan.moves.some(m => m.src !== 'COSTAR')) out.push({ level: 'low', text: 'Tenant list and leases are simulated until CoStar tenant records are imported.' });
    const high = out.filter(x => x.level === 'high').length;
    return { verdict: high ? 'weak' : out.some(x => x.level === 'medium') ? 'holds_with_caveats' : 'holds', risks: out };
  };
  LW.bigMoney = n => n == null ? '—' : n >= 1e6 ? '$' + (Math.round(n / 1e5) / 10) + 'M' : '$' + Math.round(n / 1000) + 'k';
  LW.VERDICT = { holds: 'Plan holds', holds_with_caveats: 'Holds, with caveats', weak: 'Plan is weak', no_plan: 'No plan possible' };
})();
