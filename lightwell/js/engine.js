// Lightwell feasibility engine.
// Pure functions: floor-plate layout, daylight test, lightwell option, preliminary fire screen, cost, carbon, score.
// The Python backend (backend/engine.py) mirrors this file; keep the two in sync (tests/parity.mjs checks it).
(function () {
  const LW = window.LW = window.LW || {};
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  LW.clamp = clamp;

  // Planning assumptions. All are estimates and editable in the Assumptions panel.
  LW.A = {
    costPerSqft: 255,        // conversion hard + soft cost, $ per sq ft converted
    abatement: 20,           // extra $ per sq ft for pre-1980 buildings (asbestos etc.)
    lightwellPerSqft: 420,   // $ per sq ft of floor removed to cut a lightwell
    sprinklerPerSqft: 9,     // $ per sq ft to add sprinklers to pre-1975 towers
    newBuildPerHome: 400000, // comparison: cost of a new-build home
    carbonKgPerM2: 500,      // embodied carbon of new construction, kg CO2e per m2
    reuseSaving: 0.6,        // share of that carbon avoided by reuse
    f2fMin: 12.5,            // comfortable floor-to-floor height (ft) for homes (below it the score drops)
    f2fHard: 10.5,           // below this floor-to-floor height (ft) homes don't fit ducts and ceilings: fails
    ceilGood: 8.5,           // an office ceiling (ft) measured in a scan at or above this is comfortable for homes (removing it only adds height)
    ceilHard: 7.5,           // below this measured clear ceiling (ft) homes don't fit: fails
    slabFt: 1.5,             // least structure + services between a finished ceiling and the floor above (ft)
    maxTravelFt: 250,        // typical max exit-access travel to a stair (sprinklered residential)
    unknownVacancy: 0.25,    // used only when neither leasing nor parking evidence exists (Houston average, 2026)
    unknownYear: 1970,       // used only when year built is missing: conservative (abatement + sprinkler retrofit)
    moveCostSqft: 15,        // tenant move: moving + fit-out allowance, $ per sq ft (tenant moves)
    buyoutSqftYr: 30,        // early lease exit: rent concession, $ per sq ft per year left after next year
    unknownLeaseYrs: 3,      // years of concessions assumed when a tenant's lease end is not on record (real CoStar tenants)
  };
  // The brief: live constraints from the request and the sliders.
  // neighbours / dayLim / dayStrict: Daylight X-ray (see LW.wallAngle below).
  LW.S = { u: 30, cap: 300000, allowLW: true, minHomes: 20, useParking: true, require: [], neighbours: true, dayLim: 25, dayStrict: false };

  // Layout constants
  const CORR = 5, MIN_DEPTH = 14, MIN_AREA = 300;
  LW.GEOM = { CORR, MIN_DEPTH, MIN_AREA };

  // Effective value: a user correction wins over the data layer.
  LW.eff = (b, k) => (b.overrides && b.overrides[k] != null ? b.overrides[k] : b[k]);

  const area = r => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const inter = (p, q) => Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0])) * Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));
  // Area of the union of axis-aligned rectangles (coordinate compression), so overlaps are never double counted.
  function unionArea(rs) {
    rs = rs.filter(r => r && area(r) > 0); if (!rs.length) return 0;
    const xs = [...new Set(rs.flatMap(r => [r[0], r[2]]))].sort((a, b) => a - b);
    let s = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1], mx = (x0 + x1) / 2;
      const iv = rs.filter(r => r[0] <= mx && mx < r[2]).map(r => [r[1], r[3]]).sort((a, b) => a[0] - b[0]);
      let len = 0, cs = null, ce = null;
      for (const [a, b] of iv) { if (cs === null || a > ce) { if (cs !== null) len += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
      if (cs !== null) len += ce - cs;
      s += len * (x1 - x0);
    }
    return s;
  }
  Object.assign(LW, { area, inter, unionArea });

  // Homes along every window wall: depth u from the glass, cut into bays (studio / 1-bed / 2-bed rhythm).
  // Cores are placed first; any home that would reach into a core (plus a corridor) is trimmed back or dropped.
  // core: optional [x0, y0, x1, y1] in plate feet (Matterport scan or a user correction); otherwise a typical central core.
  // With a lightwell, the layout assumes two new stair cores at opposite inner corners of the courtyard ring.
  LW.layout = function (W, D, u, lw, core) {
    let units = [], cores = [], court = null, coreBasis;
    const strip = (x0, y0, x1, y1, hor, win, court) => {
      const len = hor ? x1 - x0 : y1 - y0, dep = hor ? y1 - y0 : x1 - x0;
      if (len < MIN_DEPTH || dep < MIN_DEPTH) return;
      const PAT = [22, 30, 36, 30], n = Math.max(1, Math.round(len / 29.5));
      const raw = Array.from({ length: n }, (_, i) => PAT[i % PAT.length]);
      const k = len / raw.reduce((s, x) => s + x, 0); let p = 0;
      for (const rw of raw) {
        const w = rw * k, rr = hor ? [x0 + p, y0, x0 + p + w, y1] : [x0, y0 + p, x1, y0 + p + w]; p += w;
        units.push({ r: rr, win, court: !!court });
      }
    };
    if (lw) {
      const wing = 2 * u + 6; court = [wing, wing, W - wing, D - wing];
      const [a, b, c, d] = court;
      cores.push([a - u, b - u, a, b], [c, d, c + u, d + u]);
      coreBasis = 'lightwell';
    } else if (core) {
      cores.push([clamp(core[0], 0, W), clamp(core[1], 0, D), clamp(core[2], 0, W), clamp(core[3], 0, D)]);
      coreBasis = 'given';
    } else {
      const cw = Math.max(40, Math.round(W * 0.26 / 10) * 10), cd = Math.max(30, Math.round(D * 0.2 / 10) * 10);
      cores.push([(W - Math.min(cw, W)) / 2, (D - Math.min(cd, D)) / 2, (W + Math.min(cw, W)) / 2, (D + Math.min(cd, D)) / 2]);
      coreBasis = 'assumed';
    }
    const uy = Math.min(u, D / 2), ux = Math.min(u, W / 2);
    strip(0, 0, W, uy, true, 'n'); strip(0, D - uy, W, D, true, 's');
    if (D - 2 * uy > MIN_DEPTH) { strip(0, uy, ux, D - uy, false, 'w'); strip(W - ux, uy, W, D - uy, false, 'e'); }
    if (court) {
      const [a, b, c, d] = court;   // inner ring; glass faces the courtyard
      strip(a, b - u, c + u, b, true, 's', true); strip(c, b, c + u, d, false, 'w', true);
      strip(a - u, d, c, d + u, true, 'n', true); strip(a - u, b, a, d, false, 'e', true);
    }
    // Trim homes back from the cores: keep the glass side, cut the inner side to leave a corridor.
    const kept = [];
    for (const un of units) {
      let r = un.r.slice(), alive = true;
      const hor = un.win === 'n' || un.win === 's';
      for (const c of cores) {
        const ec = hor ? [c[0], c[1] - CORR, c[2], c[3] + CORR] : [c[0] - CORR, c[1], c[2] + CORR, c[3]];
        if (inter(r, ec) <= 1e-9) continue;
        if (un.win === 'n') { if (ec[1] <= r[1]) alive = false; else r[3] = Math.min(r[3], ec[1]); }
        else if (un.win === 's') { if (ec[3] >= r[3]) alive = false; else r[1] = Math.max(r[1], ec[3]); }
        else if (un.win === 'w') { if (ec[0] <= r[0]) alive = false; else r[2] = Math.min(r[2], ec[0]); }
        else { if (ec[2] >= r[2]) alive = false; else r[0] = Math.max(r[0], ec[2]); }
        if (!alive) break;
      }
      if (!alive) continue;
      const dep = hor ? r[3] - r[1] : r[2] - r[0], a = area(r);
      if (dep < MIN_DEPTH || a < MIN_AREA) continue;
      kept.push({ r, a, win: un.win, court: un.court, t: a < 700 ? 0 : a < 980 ? 1 : 2 });
    }
    return { units: kept, court, cores, coreBasis };
  };

  // Geometry check used by the tests and the agent's review: nothing overlaps that shouldn't, nothing leaves the plate.
  LW.checkLayout = function (L, W, D) {
    const bad = [], eps = 0.01, out = r => r[0] < -eps || r[1] < -eps || r[2] > W + eps || r[3] > D + eps;
    L.units.forEach((u, i) => {
      if (out(u.r)) bad.push(`home ${i} outside plate`);
      L.cores.forEach((c, j) => { if (inter(u.r, c) > eps) bad.push(`home ${i} overlaps core ${j}`); });
      if (L.court && inter(u.r, L.court) > eps) bad.push(`home ${i} overlaps lightwell`);
      for (let j = i + 1; j < L.units.length; j++) if (inter(u.r, L.units[j].r) > eps) bad.push(`homes ${i} and ${j} overlap`);
    });
    L.cores.forEach((c, i) => {
      if (out(c)) bad.push(`core ${i} outside plate`);
      if (L.court && inter(c, L.court) > eps) bad.push(`core ${i} overlaps lightwell`);
      for (let j = i + 1; j < L.cores.length; j++) if (inter(c, L.cores[j]) > eps) bad.push(`cores ${i} and ${j} overlap`);
    });
    return bad;
  };
  LW.courtOK = (b, u) => { const wing = 2 * u + 6; return b.W - 2 * wing >= 30 && b.D - 2 * wing >= 30; };

  // Preliminary fire screen. We know the plate and (at best) the core rectangle, never the real stairs or corridors,
  // so the result is an estimate: 'verify' (no blocker found, needs verification), 'check' (design work likely),
  // 'fail' (likely blocker). It is not a code review.
  LW.safety = function (b, L) {
    const A = LW.A, year = LW.eff(b, 'year'), yearKnown = year != null;
    const walk = (x, y, r) => Math.max(r[0] - x, 0, x - r[2]) + Math.max(r[1] - y, 0, y - r[3]);
    let travel = 0;
    for (const u of L.units) {
      const cx = (u.r[0] + u.r[2]) / 2, cy = (u.r[1] + u.r[3]) / 2;
      travel = Math.max(travel, Math.min(...L.cores.map(c => walk(cx, cy, c))) + 10);
    }
    let sep;
    if (L.cores.length >= 2) {
      const [p, q] = L.cores;
      sep = Math.hypot((p[0] + p[2]) / 2 - (q[0] + q[2]) / 2, (p[1] + p[3]) / 2 - (q[1] + q[3]) / 2);
    } else { const c = L.cores[0]; sep = Math.hypot(c[2] - c[0], c[3] - c[1]); }
    const req = Math.hypot(b.W, b.D) / 3;               // stairs at least 1/3 of the floor diagonal apart (sprinklered)
    // sprinklers: CoStar's record when imported (true / false); otherwise towers built before 1975 are assumed to need them
    const sprk = b.sprinklers === true || b.sprinklers === false ? b.sprinklers : null;
    const retrofit = sprk != null ? !sprk : (yearKnown ? year : A.unknownYear) < 1975;
    const notes = [];
    if (travel > A.maxTravelFt) notes.push(`Farthest home is about ${Math.round(travel)} ft from a stair (limit ~${A.maxTravelFt} ft)`);
    if (sep < req) notes.push(`Stairs about ${Math.round(sep)} ft apart; needs ~${Math.round(req)} ft: likely a remote stair`);
    if (retrofit) notes.push(sprk === false ? 'No sprinklers on record (CoStar): assume a full sprinkler retrofit'
      : yearKnown ? 'Built before 1975: assume a full sprinkler retrofit' : 'Year built unknown: sprinkler retrofit assumed');
    const status = travel > A.maxTravelFt * 1.2 ? 'fail' : (travel > A.maxTravelFt || sep < req) ? 'check' : 'verify';
    const stairs = L.coreBasis === 'lightwell' ? 'Two new stair cores assumed at opposite corners of the courtyard'
      : L.coreBasis === 'given' ? 'Stairs assumed at opposite corners of the measured core'
      : 'Core position and size assumed (typical central core); stairs assumed at its corners';
    return {
      travel, sep, req, retrofit, status, notes, coreBasis: L.coreBasis,
      measured: [`Floor plate ${b.W} × ${b.D} ft`].concat(L.coreBasis === 'given' ? ['Core rectangle'] : [], sprk != null ? [`Sprinklers: ${sprk ? 'yes' : 'none'} (CoStar)`] : []),
      assumed: [stairs, 'Travel = walking distance along corridors from each home to the nearest core, +10 ft inside the home'],
      unverified: ['Two independent exit stairs on every floor', `Exit-access travel within ${A.maxTravelFt} ft (sprinklered)`,
        'Stair separation at least 1/3 of the floor diagonal', 'Rated corridors and stair enclosures', 'Sprinkler and fire-alarm coverage'],
    };
  };
  LW.SAFE_LABEL = { verify: 'No blocker found · needs verification', check: 'Design work likely', fail: 'Likely blocker' };

  // ---- Daylight X-ray: does each window wall see the sky? ----
  // Outside walls: obstruction-angle profile from backend/daylight.py (b.day, attached by data.js from
  // window.LIGHTWELL_DAYLIGHT). Lightwell court walls: the tower itself, across the court.
  // A screening rule (default 25 degrees, after UK BRE daylight guidance), not a daylight study.
  LW.DAY = { eyeFt: 6.5, lim: 25 };
  LW.compass = deg => deg == null ? 'unknown' : ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
  const round1 = x => Math.round(x * 10) / 10;
  LW.dayOn = b => LW.S.neighbours !== false && !!(b.day && b.day.prof);
  LW.wallAngle = function (b, L, un, f, f2f, floors) {
    const z = (f - 1) * f2f + LW.DAY.eyeFt;   // eye height on floor f (floor 1 = street level)
    if (un.court) {
      const c = L.court, across = un.win === 'n' || un.win === 's' ? c[3] - c[1] : c[2] - c[0];
      return Math.max(0, round1(Math.atan2(floors * f2f - z, across) * 180 / Math.PI));
    }
    const prof = b.day.prof[un.win], i = Math.floor(z / (b.day.dz || 10));
    return prof && prof.length ? prof[Math.max(0, Math.min(prof.length - 1, i))] : 0;
  };
  // Per floor: which homes see the sky. Returns null when the check is off or there is no data for this tower.
  LW.daylight = function (b, L, floors, f2f) {
    if (!LW.dayOn(b)) return null;
    const lim = LW.S.dayLim != null ? LW.S.dayLim : LW.DAY.lim, walls = {}, byFloor = [], mix = [0, 0, 0];
    let open = 0, openArea = 0, total = 0;
    for (let f = 2; f <= floors; f++) {
      let o = 0;
      for (const un of L.units) {
        total++;
        if (LW.wallAngle(b, L, un, f, f2f, floors) <= lim) { o++; openArea += un.a; mix[un.t]++; continue; }
        const k = un.court ? 'court' : un.win, w = walls[k] || (walls[k] = { from: f, to: f, homes: 0 });
        w.to = f; w.homes++;
      }
      open += o; byFloor.push(o);
    }
    return { lim, strict: !!LW.S.dayStrict, open, dim: total - open, openArea, mix, byFloor, walls };
  };

  LW.plan = function (b, u, lw) {
    const A = LW.A, L = LW.layout(b.W, b.D, u, lw, LW.eff(b, 'core')), floors = LW.eff(b, 'floors'), fu = floors - 1;
    const yearRaw = LW.eff(b, 'year'), year = yearRaw != null ? yearRaw : A.unknownYear;
    const perFloor = L.units.length, day = LW.daylight(b, L, floors, LW.eff(b, 'f2f'));
    const homes = day && day.strict ? day.open : perFloor * fu;
    const daylit = L.units.reduce((s, x) => s + x.a, 0);
    const courtA = L.court ? area(L.court) : 0, solidA = unionArea(L.court ? [...L.cores, L.court] : L.cores);
    const net = b.W * b.D - solidA, gsf = (b.W * b.D - courtA) * fu;
    const safe = LW.safety(b, L);
    const cost = gsf * A.costPerSqft + (year < 1980 ? gsf * A.abatement : 0) + (lw ? courtA * fu * A.lightwellPerSqft : 0)
      + (safe.retrofit ? gsf * A.sprinklerPerSqft : 0);
    return {
      L, lw, perFloor, homes, gsf, cost, cpu: homes ? cost / homes : Infinity, safety: safe, day,
      // with Daylight X-ray on, only homes that see the sky count as daylit (and, in strict mode, as homes at all)
      daylitFrac: net > 0 ? clamp(day ? (fu > 0 ? day.openArea / (net * fu) : 0) : daylit / net, 0, 1) : 0,
      mix: day && day.strict ? day.mix : [0, 1, 2].map(t => L.units.filter(x => x.t === t).length * fu),
      carbon: gsf * 0.0929 * A.carbonKgPerM2 * A.reuseSaving / 1000,
    };
  };

  LW.analyze = function (b) {
    const S = LW.S, A = LW.A;
    const p0 = LW.plan(b, S.u, false), ok = LW.courtOK(b, S.u), p1 = ok ? LW.plan(b, S.u, true) : null;
    let p = p0;
    if (b.forceLW === true && p1) p = p1;
    else if (b.forceLW == null && S.allowLW && p1 && p1.cpu < p0.cpu) p = p1;
    b.alt = p === p0 ? p1 : p0; b.plan = p; b.courtOK = ok;
    const rep = LW.eff(b, 'rep'), year = LW.eff(b, 'year'), f2f = LW.eff(b, 'f2f');
    // height test: a clear ceiling measured in a Matterport scan decides it; otherwise the floor-to-floor height does
    const ceil = LW.ceilOf(b), tall = ceil != null ? ceil >= A.ceilGood : f2f >= A.f2fMin, low = ceil != null ? ceil < A.ceilHard : f2f < A.f2fHard;
    const obs = S.useParking === false ? [] : (b.obs || []);
    const assumed = [];
    let vac, vacBasis;
    const obsAvg = obs.length ? obs.reduce((s, x) => s + x, 0) / obs.length : null;
    if (rep != null && obs.length) { vac = 1 - (0.35 * rep + 0.65 * obsAvg); vacBasis = 'leasing + parking'; }
    else if (rep != null) { vac = 1 - rep; vacBasis = 'leasing only'; }
    else if (obs.length) { vac = 1 - obsAvg; vacBasis = 'parking only'; }
    else { vac = A.unknownVacancy; vacBasis = 'assumed'; assumed.push(`No leasing or parking evidence: vacancy assumed ${Math.round(A.unknownVacancy * 100)}% (Houston average)`); }
    if (year == null) assumed.push(`Year built unknown: costs assume pre-1975 (abatement and sprinklers)`);
    const costScore = clamp(1 - (p.cpu - 0.6 * S.cap) / (0.8 * S.cap), 0, 1);
    const ageFit = year == null ? .6 : year < 1960 ? .6 : year <= 1995 ? 1 : year <= 2008 ? .6 : .25;
    const safeScore = { verify: 1, check: .5, fail: 0 }[p.safety.status];
    b.vac = vac; b.vacBasis = vacBasis; b.assumed = assumed;
    b.score = Math.round(100 * (0.30 * p.daylitFrac + 0.26 * vac + 0.20 * costScore + 0.06 * (tall ? 1 : .4)
      + 0.08 * ageFit + 0.10 * safeScore));
    const why = [];
    if (!(p.cpu <= S.cap)) why.push('over cost cap');
    if (p.homes < S.minHomes) why.push(`under ${S.minHomes} homes`);
    if (p.safety.status === 'fail') why.push('likely fire-safety blocker');
    if (low) why.push(ceil != null ? `ceilings under ${A.ceilHard} ft (measured ${ceil} ft)` : `floor-to-floor under ${A.f2fHard} ft`);
    const missing = (S.require || []).filter(k => !(b.real && b.real[k]));
    if (missing.length) why.push('missing real ' + missing.map(k => ({ market: 'CoStar', aerial: 'Vexcel', interior: 'Matterport' })[k] || k).join(' + ') + ' data');
    if (b.converted) why.push(`already converted (${b.converted})`);   // CoStar records the building as converted to another use
    b.why = why; b.pass = why.length === 0;
    b.phantom = rep != null && obs.length >= 2 && rep - Math.max(...obs) >= 0.45;
    return b;
  };

  // Compact view of one analysed building; same shape as backend/engine.py summary(). The memo renders from this.
  LW.summary = function (b) {
    const p = b.plan, s = p.safety, r = Math.round;
    return {
      id: b.id, score: b.score, passes: b.pass, why: b.why, homes: p.homes, cost_per_home: p.homes ? r(p.cpu) : null,
      lightwell: p.lw, daylit_pct: r(p.daylitFrac * 100), homes_per_floor: p.perFloor,
      mix: { studio: p.mix[0], one_bed: p.mix[1], two_bed: p.mix[2] },
      fire_screen: s.status, farthest_home_ft: r(s.travel), stair_sep_ft: r(s.sep), fire_notes: s.notes,
      carbon_t: r(p.carbon), hidden_vacancy_flag: b.phantom, vacancy_basis: b.vacBasis, assumed: b.assumed,
      dim_homes: p.day ? p.day.dim : null, daylight_rule_deg: p.day ? p.day.lim : null, daylight_strict: p.day ? p.day.strict : null,
    };
  };


  // ---------------- evidence review (mirrors review_gaps in backend/engine.py) ----------------
  LW.WHATIF = {
    f2f: { label: 'floor-to-floor height', unit: 'ft', srcs: ['ESTIMATE', 'SIMULATED', 'MISSING'], why: 'estimated from the building height and floor count', test: '10 ft', ph: 'e.g. 11.5' },
    core: { label: 'core size', unit: 'ft', srcs: ['ASSUMED', 'MISSING'], why: 'assumed (typical central core), not measured', test: 'a core 40% larger', ph: 'e.g. 60x45' },
    rep: { label: 'percent leased', unit: '%', srcs: ['SIMULATED', 'MISSING'], why: 'not from a CoStar record', test: '90% leased', ph: 'e.g. 85' },
  };
  // A clear ceiling measured in a Matterport scan (b.ceil, ft): direct evidence, so it decides the height test when present.
  LW.ceilOf = b => (b.ceil != null ? b.ceil : null);
  // A floor-to-floor record lower than the scanned ceiling allows cannot be right for the scanned floor.
  LW.f2fConflict = b => LW.ceilOf(b) != null && LW.eff(b, 'f2f') < LW.scanF2f(b);
  // The lowest floor-to-floor worth testing: 10 ft, or the measured ceiling plus the least structure above it.
  LW.scanF2f = b => round1(b.ceil + LW.A.slabFt);   // the lowest floor-to-floor a scanned ceiling allows
  LW.f2fFloor = b => (LW.ceilOf(b) == null ? 10 : Math.max(10, LW.scanF2f(b)));
  LW.defaultCore = (W, D) => { const cw = Math.min(Math.max(40, Math.round(W * 0.26 / 10) * 10), W), cd = Math.min(Math.max(30, Math.round(D * 0.2 / 10) * 10), D);
    return [(W - cw) / 2, (D - cd) / 2, (W + cw) / 2, (D + cd) / 2]; };
  LW.centredCore = (W, D, cw, cd) => { cw = Math.min(cw, W); cd = Math.min(cd, D); return [(W - cw) / 2, (D - cd) / 2, (W + cw) / 2, (D + cd) / 2]; };
  const effCore = b => LW.eff(b, 'core') || LW.defaultCore(b.W, b.D);
  LW.currentValue = (b, f) => { if (f === 'f2f') return `${LW.eff(b, 'f2f')} ft`;
    if (f === 'core') { const c = effCore(b); return `${Math.round(c[2] - c[0])} x ${Math.round(c[3] - c[1])} ft`; }
    const r = LW.eff(b, 'rep'); return r == null ? 'unknown' : Math.round(r * 100) + '%'; };
  function whatIf(b, f) {
    const o = { ...b.overrides };
    if (f === 'f2f') o.f2f = Math.min(LW.eff(b, 'f2f'), LW.f2fFloor(b));
    else if (f === 'core') { const c = effCore(b); o.core = LW.centredCore(b.W, b.D, (c[2] - c[0]) * 1.4, (c[3] - c[1]) * 1.4); }
    else o.rep = 0.9;
    return LW.analyze({ ...b, overrides: o });
  }
  // What the agent says when a scanned ceiling settles the floor-to-floor question (same words as engine.py).
  LW.scanSettles = g => `${g.id}: the Matterport scan measured ${g.scan_ceil} ft clear ceilings, so floor-to-floor is at least ${g.what_if.split(' ft')[0]} ft and homes fit. `
    + 'The height question is settled without a site visit.';
  LW.reviewGaps = function (B, ids) {
    const ranked = B.filter(b => b.pass).sort((a, c) => c.score - a.score), leader = ranked[0], runner = ranked[1], out = [];
    for (const id of ids) {
      const b = B.find(x => x.id === id); if (!b) continue;
      for (const [f, spec] of Object.entries(LW.WHATIF)) {
        const src = LW.srcOf ? LW.srcOf(b, f) : 'MISSING'; if (!spec.srcs.includes(src)) continue;
        const t = whatIf(b, f), sc = f === 'f2f' ? LW.ceilOf(b) : null; let decision = '';
        if (b.pass && !t.pass) decision = `would no longer pass (${t.why.join(', ')})`;
        else if (leader === b && runner && t.score < runner.score) decision = `would drop below ${runner.id} (${t.score} vs ${runner.score})`;
        out.push({ id, field: f, label: spec.label, unit: spec.unit, current: LW.currentValue(b, f), source: src, basis: spec.why,
          what_if: sc != null ? `${LW.f2fFloor(b)} ft, the lowest the Matterport scan allows (${sc} ft clear ceiling measured)` : spec.test,
          score_now: b.score, score_if: t.score, passes_if: t.pass, decision, relevant: !!decision, scan_ceil: sc });
      }
    }
    return out.sort((a, c) => (a.relevant === c.relevant ? 0 : a.relevant ? -1 : 1) || ids.indexOf(a.id) - ids.indexOf(c.id) || (c.score_now - c.score_if) - (a.score_now - a.score_if));
  };
  LW.parseMeasurement = function (b, f, raw) {
    const s = String(raw).trim().toLowerCase().replace(/ft|%/g, '').trim();
    if (f === 'f2f') { const v = +s; if (!(v >= 7 && v <= 25)) throw new Error('floor-to-floor must be 7-25 ft'); return v; }
    if (f === 'rep') { const v = +s; if (!(v >= 0 && v <= 100) || s === '') throw new Error('percent leased must be 0-100'); return v / 100; }
    if (f === 'core') { const p = s.replace(/[×*]/g, 'x').replace(/\s/g, '').split('x').filter(Boolean).map(Number);
      if (p.length !== 2 || p.some(isNaN)) throw new Error('core size as width x depth, e.g. 60x40');
      if (!(p[0] >= 10 && p[0] <= b.W && p[1] >= 10 && p[1] <= b.D)) throw new Error(`core must fit inside the ${b.W} x ${b.D} ft plate`);
      return LW.centredCore(b.W, b.D, p[0], p[1]); }
    throw new Error('unknown field ' + f);
  };

  // Score colour ramp: slate -> teal -> gold.
  const C = { poor: [58, 71, 102], mid: [60, 198, 180], top: [245, 185, 66] };
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  LW.scoreRGB = s => s < 45 ? lerp(C.poor, C.mid, s / 45) : lerp(C.mid, C.top, (s - 45) / 55);
  LW.hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
})();
