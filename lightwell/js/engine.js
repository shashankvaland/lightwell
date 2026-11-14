// Lightwell feasibility engine.
// Pure functions: floor-plate layout, daylight test, lightwell option, fire-safety check, cost, carbon, score.
// The Python backend (backend/engine.py) mirrors this file; keep the two in sync.
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
    f2fMin: 12.5,            // minimum floor-to-floor height (ft) for homes
    maxTravelFt: 250,        // typical max travel distance to an exit stair (sprinklered residential)
  };
  // Live constraints from the sliders.
  LW.S = { u: 30, cap: 300000, allowLW: true };

  // Effective value: a user correction wins over the data layer.
  LW.eff = (b, k) => (b.overrides && b.overrides[k] != null ? b.overrides[k] : b[k]);

  const area = r => (r[2] - r[0]) * (r[3] - r[1]);
  LW.area = area;

  // Homes along every window wall: depth u from the glass, cut into bays (studio / 1-bed / 2-bed rhythm).
  // core: optional [x0, y0, x1, y1] in plate feet from a Matterport scan; otherwise a typical central core is assumed.
  LW.layout = function (W, D, u, lw, core) {
    const units = [], cores = []; let court = null;
    const strip = (x0, y0, x1, y1, hor) => {
      const len = hor ? x1 - x0 : y1 - y0, dep = hor ? y1 - y0 : x1 - x0;
      if (len < 14 || dep < 14) return;
      const PAT = [22, 30, 36, 30], n = Math.max(1, Math.round(len / 29.5));
      const raw = Array.from({ length: n }, (_, i) => PAT[i % PAT.length]);
      const k = len / raw.reduce((s, x) => s + x, 0); let p = 0;
      for (const rw of raw) {
        const w = rw * k, rr = hor ? [x0 + p, y0, x0 + p + w, y1] : [x0, y0 + p, x1, y0 + p + w]; p += w;
        const a = w * dep; units.push({ r: rr, a, t: a < 700 ? 0 : a < 980 ? 1 : 2 });
      }
    };
    if (lw) { const wing = 2 * u + 6; court = [wing, wing, W - wing, D - wing]; }
    const uy = Math.min(u, D / 2), ux = Math.min(u, W / 2);
    strip(0, 0, W, uy, true); strip(0, D - uy, W, D, true);
    if (D - 2 * uy > 14) { strip(0, uy, ux, D - uy, false); strip(W - ux, uy, W, D - uy, false); }
    if (court) {
      const [a, b, c, d] = court;
      strip(a - u, b - u, c + u, b, true); strip(a - u, d, c + u, d + u, true);
      strip(a - u, b, a, d, false); strip(c, b, c + u, d, false);
      cores.push([a, b, a + 26, b + 26], [c - 26, d - 26, c, d]);
    } else if (core) {
      cores.push(core.slice());
    } else {
      const cw = Math.max(40, Math.round(W * 0.26 / 10) * 10), cd = Math.max(30, Math.round(D * 0.2 / 10) * 10);
      cores.push([(W - cw) / 2, (D - cd) / 2, (W + cw) / 2, (D + cd) / 2]);
    }
    return { units, court, cores };
  };
  LW.courtOK = (b, u) => { const wing = 2 * u + 6; return b.W - 2 * wing >= 30 && b.D - 2 * wing >= 30; };

  // Fire-safety screen: travel distance to a stair, stair separation, sprinklers.
  LW.safety = function (b, L) {
    const A = LW.A, year = LW.eff(b, 'year');
    const distToRect = (x, y, r) => Math.max(r[0] - x, 0, x - r[2]) + Math.max(r[1] - y, 0, y - r[3]);
    let travel = 0;
    for (const u of L.units) {
      const cx = (u.r[0] + u.r[2]) / 2, cy = (u.r[1] + u.r[3]) / 2;
      travel = Math.max(travel, Math.min(...L.cores.map(c => distToRect(cx, cy, c))) + 10);
    }
    let sep;
    if (L.cores.length >= 2) {
      const [p, q] = L.cores;
      sep = Math.hypot((p[0] + p[2]) / 2 - (q[0] + q[2]) / 2, (p[1] + p[3]) / 2 - (q[1] + q[3]) / 2);
    } else { const c = L.cores[0]; sep = Math.hypot(c[2] - c[0], c[3] - c[1]); }
    const req = Math.hypot(b.W, b.D) / 3;               // stairs at least 1/3 of the floor diagonal apart
    const retrofit = year < 1975;
    const notes = [];
    if (travel > A.maxTravelFt) notes.push(`Farthest home is ${Math.round(travel)} ft from a stair (limit ~${A.maxTravelFt} ft)`);
    if (sep < req) notes.push(`Stairs ${Math.round(sep)} ft apart; needs ~${Math.round(req)} ft: add a remote stair`);
    if (retrofit) notes.push('Built before 1975: assume a full sprinkler retrofit');
    const status = travel > A.maxTravelFt * 1.2 ? 'fail' : (travel > A.maxTravelFt || sep < req) ? 'check' : 'ok';
    return { travel, sep, req, retrofit, status, notes };
  };

  LW.plan = function (b, u, lw) {
    const A = LW.A, L = LW.layout(b.W, b.D, u, lw, b.core), floors = LW.eff(b, 'floors'), fu = floors - 1, year = LW.eff(b, 'year');
    const perFloor = L.units.length, homes = perFloor * fu;
    const daylit = L.units.reduce((s, x) => s + x.a, 0), coreA = L.cores.reduce((s, c) => s + area(c), 0);
    const courtA = L.court ? area(L.court) - coreA : 0;
    const net = b.W * b.D - (L.court ? area(L.court) : coreA), gsf = (b.W * b.D - courtA) * fu;
    const safe = LW.safety(b, L);
    const cost = gsf * A.costPerSqft + (year < 1980 ? gsf * A.abatement : 0) + (lw ? courtA * fu * A.lightwellPerSqft : 0)
      + (safe.retrofit ? gsf * A.sprinklerPerSqft : 0);
    return {
      L, lw, perFloor, homes, daylitFrac: clamp(daylit / net, 0, 1), gsf, cost, cpu: homes ? cost / homes : Infinity,
      mix: [0, 1, 2].map(t => L.units.filter(x => x.t === t).length * fu), safety: safe,
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
    const rep = LW.eff(b, 'rep'), obs = b.obs, year = LW.eff(b, 'year'), f2f = LW.eff(b, 'f2f');
    const obsAvg = obs.reduce((s, x) => s + x, 0) / obs.length, vac = 1 - (0.35 * rep + 0.65 * obsAvg);
    const costScore = clamp(1 - (p.cpu - 0.6 * S.cap) / (0.8 * S.cap), 0, 1);
    const ageFit = year < 1960 ? .6 : year <= 1995 ? 1 : year <= 2008 ? .6 : .25;
    const safeScore = { ok: 1, check: .5, fail: 0 }[p.safety.status];
    b.vac = vac;
    b.score = Math.round(100 * (0.30 * p.daylitFrac + 0.26 * vac + 0.20 * costScore + 0.06 * (f2f >= A.f2fMin ? 1 : .4)
      + 0.08 * ageFit + 0.10 * safeScore));
    b.pass = p.cpu <= S.cap && p.homes >= 20 && p.safety.status !== 'fail';
    b.phantom = rep - Math.max(...obs) >= 0.45;
    return b;
  };

  // Score colour ramp: slate -> teal -> gold.
  const C = { poor: [58, 71, 102], mid: [60, 198, 180], top: [245, 185, 66] };
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  LW.scoreRGB = s => s < 45 ? lerp(C.poor, C.mid, s / 45) : lerp(C.mid, C.top, (s - 45) / 55);
  LW.hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
})();
