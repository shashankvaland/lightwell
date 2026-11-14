// Turns the real OpenStreetMap footprints into candidate towers and attaches stand-in market / aerial data.
// Replace the SIMULATED block with real CoStar, Vexcel and Matterport values at the event.
(function () {
  const LW = window.LW;
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  LW.mulberry = mulberry;

  const LAT0 = 29.7575, LON0 = -95.3665, FT = 3.281;
  const toFt = ([x, y]) => [(x - LON0) * Math.cos(LAT0 * Math.PI / 180) * 111320 * FT, (y - LAT0) * 110540 * FT];
  function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return Math.abs(s) / 2; }
  function minRect(pts) {
    let best = null;
    for (let a = 0; a < 90; a++) {
      const t = a * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, y] of pts) { const u = x * c + y * s, v = -x * s + y * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      const w = x1 - x0, d = y1 - y0; if (!best || w * d < best.a) best = { a: w * d, W: Math.max(w, d), D: Math.min(w, d) };
    }
    return best;
  }
  const SKIP = /stadium|park|arena|garage|parking|church|cathedral|hotel|apartment|residen|court|jail|theat|hall|center$/i;
  const KINDS = new Set(['office', 'commercial', 'tower', 'yes']);

  // Real data written by backend/import_data.py (lightwell/data/real_overlay.js), keyed by OSM id.
  LW.real = window.LIGHTWELL_REAL || null;

  LW.buildCandidates = function (gj) {
    const B = [], R = (LW.real && LW.real.buildings) || {};
    for (const f of gj.features) {
      const p = f.properties, real = R[String(p.id)] || null;
      const ring = f.geometry.coordinates[0], pts = ring.map(toFt), r = minRect(pts), fa = polyArea(pts);
      // A real CoStar office record always qualifies; otherwise use the map filters.
      let ok = p.heightSource !== 'default' && p.height >= 40 && KINDS.has(p.kind) && fa <= 70000 && r.D >= 55;
      if (ok && p.name && SKIP.test(p.name) && !/energy center|plaza|tower/i.test(p.name)) ok = false;
      if (!ok && !(real && (p.heightSource !== 'default' || real.floors >= 6))) continue;
      const i = B.length, rnd = mulberry(p.id % 100000 + 7);
      const heightM = p.heightSource !== 'default' ? p.height : Math.round(real.floors * 3.9);
      const floors = real && real.floors ? real.floors : p.levels && p.levels !== 'null' ? +p.levels : Math.round(heightM / 3.9);
      // ---- SIMULATED (stand-ins for CoStar / Vexcel / Matterport) ----
      const year = Math.round(1965 + rnd() * 50);
      let rep = 0.55 + rnd() * 0.4, base = rep * (0.5 + rnd() * 0.5);
      if (rnd() < 0.1) { rep = 0.84 + rnd() * 0.08; base = 0.09; }
      const obs = [0, 1, 2].map(() => LW.clamp(base + (rnd() - .5) * 0.12, .03, .97));
      const scanned = rnd() < 0.62;
      // ------------------------------------------------------------------
      const center = ring.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]).map(v => v / ring.length);
      const b = {
        idx: i, osmId: p.id, id: 'HOU-' + String(i + 1).padStart(2, '0'), realName: p.name, ring, center,
        heightM, heightSrc: p.heightSource !== 'default' ? p.heightSource : 'costar-floors',
        W: Math.min(300, 10 * Math.round(r.W / 10)), D: Math.min(260, 10 * Math.round(r.D / 10)),
        irregular: fa / r.a < 0.8, footprint: Math.round(fa),
        floors, f2f: Math.round((heightM * FT / floors) * 2) / 2, year, rep, obs, scanned, core: null,
        forceLW: null, overrides: {}, score: null, real: { market: false, aerial: false, interior: false, floors: false },
      };
      if (real) applyReal(b, real);
      // floor-by-floor vacancy: CoStar's available-space floors when imported, otherwise simulated from % leased
      if (!b.real.floors) b.vacantFloors = simVacantFloors(b.floors, b.rep, mulberry(p.id % 100000 + 99));
      b.label = b.real.market ? b.name : b.id;   // real names only appear next to real market data
      B.push(b);
    }
    return B;
  };

  // Empty space in offices tends to come in blocks of whole floors (a tenant leaves, their floors go dark).
  // Floor 1 is the lobby and never counted. Returns sorted floor numbers.
  function simVacantFloors(n, rep, rnd) {
    const usable = n - 1, v = new Set(); let need = Math.round((1 - rep) * usable), guard = 0;
    while (need > 0 && guard++ < 60) {
      const len = Math.min(need, 1 + Math.floor(rnd() * Math.max(2, usable / 3)));
      const start = 2 + Math.floor(rnd() * Math.max(1, usable - len + 1));
      for (let f = start; f < start + len && f <= n; f++) if (!v.has(f)) { v.add(f); need--; }
    }
    return [...v].sort((a, c) => a - c);
  }
  // Runs of consecutive empty floors, biggest first: [{ from, to, len }]
  LW.emptyBlocks = function (b) {
    const out = []; let s = null, prev = null;
    for (const f of b.vacantFloors) { if (s !== null && f === prev + 1) prev = f; else { if (s !== null) out.push({ from: s, to: prev, len: prev - s + 1 }); s = prev = f; } }
    if (s !== null) out.push({ from: s, to: prev, len: prev - s + 1 });
    return out.sort((a, c) => c.len - a.len || a.from - c.from);
  };

  function applyReal(b, real) {
    b.costarId = real.costar_id; b.owner = real.owner || null;
    b.name = real.address || ('CoStar ' + real.costar_id);
    if (real.leased != null) { b.rep = real.leased; b.real.market = true; }
    if (real.year != null) { b.year = real.year; b.real.market = true; }
    if (real.rba_sqft) b.rba = real.rba_sqft;
    if (Array.isArray(real.vacant_floors)) {
      b.vacantFloors = real.vacant_floors.filter(f => f >= 2 && f <= b.floors).sort((a, c) => a - c); b.real.floors = true;
    }
    if (real.parking && real.parking.length) {
      const pk = [...real.parking].sort((a, c) => String(a.date).localeCompare(String(c.date)));
      b.obs = pk.map(x => x.pct); b.obsDates = pk.map(x => x.date); b.real.aerial = true;
    }
    const I = real.interior;
    if (I) {
      if (I.W && I.D) { b.W = Math.max(I.W, I.D); b.D = Math.min(I.W, I.D); b.irregular = false; }
      if (I.f2f) b.f2f = I.f2f;
      if (I.core && I.W >= I.D) b.core = I.core;   // core given in the plate's own orientation
      b.scanned = !!I.scanned; b.modelId = I.model_id || null; b.real.interior = true;
    }
  }
})();
