// Turns the real OpenStreetMap footprints into candidate towers and attaches market / aerial / interior values.
// Every value carries its own source tag in b.src (per field, not per layer):
//   OSM, ESTIMATE, COSTAR, VEXCEL, MATTERPORT, SIMULATED, MISSING (and YOU for a user correction, see LW.srcOf).
// Two modes:
//   'demo' fills gaps with SIMULATED stand-ins, but only on anonymous towers (no real CoStar record), so a simulated
//          number never sits next to a real name.
//   'real' never invents a value: missing stays MISSING and the engine states any assumption it has to make.
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
  // Daylight X-ray profiles written by backend/daylight.py (lightwell/data/daylight.js), keyed by OSM id.
  LW.daylightData = window.LIGHTWELL_DAYLIGHT || null;
  LW.dataMode = LW.real ? 'real' : 'demo';

  // Source of a field, with user corrections winning.
  LW.srcOf = (b, k) => (b.overrides && b.overrides[k] != null ? 'YOU' : (b.src && b.src[k]) || 'MISSING');
  LW.SRC_CLASS = { OSM: 't-osm', ESTIMATE: 't-est', COSTAR: 't-cs', VEXCEL: 't-vx', MATTERPORT: 't-mp', SIMULATED: 't-sim',
    MISSING: 't-miss', YOU: 't-you', ASSUMED: 't-est' };

  LW.buildCandidates = function (gj, mode) {
    mode = mode || LW.dataMode;
    const B = [], R = (LW.real && LW.real.buildings) || {};
    for (const f of gj.features) {
      const p = f.properties, real = R[String(p.id)] || null;
      const ring = f.geometry.coordinates[0], pts = ring.map(toFt), r = minRect(pts), fa = polyArea(pts);
      // A real CoStar office record always qualifies; otherwise use the map filters.
      let ok = p.heightSource !== 'default' && p.height >= 40 && KINDS.has(p.kind) && fa <= 70000 && r.D >= 55;
      if (ok && p.name && SKIP.test(p.name) && !/energy center|plaza|tower/i.test(p.name)) ok = false;
      if (!ok && !(real && (p.heightSource !== 'default' || real.floors >= 6))) continue;
      const i = B.length, rnd = mulberry(p.id % 100000 + 7);
      const osmHeight = p.heightSource !== 'default', osmLevels = p.levels && p.levels !== 'null';
      // CoStar replaces an OpenStreetMap height that is missing or does not fit the storey count (backend/costar_kit.py)
      const heightM = real && real.height_m ? real.height_m : osmHeight ? p.height : Math.round(real.floors * 3.9);
      const floors = real && real.floors ? real.floors : osmLevels ? +p.levels : Math.round(heightM / 3.9);
      // ---- SIMULATED stand-ins (drawn for every tower so the random sequence is stable; used only in demo mode) ----
      const sYear = Math.round(1965 + rnd() * 50);
      let sRep = 0.55 + rnd() * 0.4, base = sRep * (0.5 + rnd() * 0.5);
      if (rnd() < 0.1) { sRep = 0.84 + rnd() * 0.08; base = 0.09; }
      const sObs = [0, 1, 2].map(() => LW.clamp(base + (rnd() - .5) * 0.12, .03, .97));
      // ---------------------------------------------------------------------------------------------------------
      const simulate = mode === 'demo' && !real;
      const center = ring.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]).map(v => v / ring.length);
      const irregular = fa / r.a < 0.8;
      const b = {
        idx: i, osmId: p.id, id: 'HOU-' + String(i + 1).padStart(2, '0'), realName: p.name, ring, center,
        heightM, W: Math.min(300, 10 * Math.round(r.W / 10)), D: Math.min(260, 10 * Math.round(r.D / 10)),
        irregular, footprint: Math.round(fa), floors, f2f: Math.round((heightM * FT / floors) * 2) / 2,
        year: simulate ? sYear : null, rep: simulate ? sRep : null, obs: simulate ? sObs : [], obsDates: null, obsMeta: null,
        scanned: false, core: null, forceLW: null, overrides: {}, score: null,
        real: { market: false, aerial: false, interior: false, floors: false }, vacantFloors: [],
        src: {
          heightM: real && real.height_m ? (real.height_src || 'COSTAR') : osmHeight ? 'OSM' : 'ESTIMATE', floors: real && real.floors ? 'COSTAR' : osmLevels ? 'OSM' : 'ESTIMATE',
          plate: irregular ? 'ESTIMATE' : 'OSM', f2f: 'ESTIMATE', core: 'ASSUMED',
          rep: simulate ? 'SIMULATED' : 'MISSING', year: simulate ? 'SIMULATED' : 'MISSING', obs: simulate ? 'SIMULATED' : 'MISSING',
          vacant: simulate ? 'SIMULATED' : 'MISSING',
        },
        ev: {},   // evidence records behind the values, for the evidence drawer
      };
      if (real) applyReal(b, real);
      // real CoStar asking rents near this tower (rent check); location-based, so every tower gets them when loaded
      b.rentMarket = LW.marketRent ? LW.marketRent(b, (LW.real && LW.real.rents) || null) : null;
      b.src.rent = b.rentMarket ? 'COSTAR' : 'MISSING';
      const day = LW.daylightData && LW.daylightData.buildings[String(p.id)];
      b.day = day || null; b.src.daylight = day ? (Object.values(day.blk).some(x => x && x.src === 'ESTIMATE') ? 'ESTIMATE' : 'OSM') : 'MISSING';
      // floor-by-floor vacancy: CoStar's available-space floors when imported; simulated only on anonymous demo towers
      if (simulate) b.vacantFloors = simVacantFloors(b.floors, b.rep, mulberry(p.id % 100000 + 99));
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
    for (const f of b.vacantFloors || []) { if (s !== null && f === prev + 1) prev = f; else { if (s !== null) out.push({ from: s, to: prev, len: prev - s + 1 }); s = prev = f; } }
    if (s !== null) out.push({ from: s, to: prev, len: prev - s + 1 });
    return out.sort((a, c) => c.len - a.len || a.from - c.from);
  };

  function applyReal(b, real) {
    b.costarId = real.costar_id; b.owner = real.owner || null;
    b.name = real.name || real.address || ('CoStar ' + real.costar_id); b.address = real.address || null; b.real.market = true;
    b.ev.costar = { costar_id: real.costar_id, address: real.address || null, owner: real.owner || null, leased: real.leased,
      year: real.year, rba_sqft: real.rba_sqft, floors: real.floors, match: real.match || null };
    // everything else the CoStar data kit gives (backend/costar_kit.py): kept for the card and the evidence drawer
    for (const k of ['name', 'class', 'rating', 'renovated', 'height_m', 'height_src', 'typical_sqft', 'f2f', 'f2f_note', 'sprinklers',
      'parking_spaces', 'converted', 'converted_to', 'leased_method', 'leased_tenancy', 'sale_leased', 'sale_date', 'available_sqft',
      'vacant_now_sqft', 'tenants_current', 'tenants_with_lease_end', 'models']) if (real[k] != null) b.ev.costar[k] = real[k];
    if (real.leased != null) { b.rep = real.leased; b.src.rep = 'COSTAR'; }
    if (real.year != null) { b.year = real.year; b.src.year = 'COSTAR'; }
    if (real.rba_sqft) b.rba = real.rba_sqft;
    if (real.f2f) { b.f2f = real.f2f; b.src.f2f = 'COSTAR'; }   // slab-to-slab, only when it agrees with the building's height
    if (real.sprinklers === true || real.sprinklers === false) { b.sprinklers = real.sprinklers; b.src.sprinklers = 'COSTAR'; }
    if (real.converted) { b.converted = real.converted; b.convertedTo = real.converted_to || null; }
    if (Array.isArray(real.tenants)) b.tenants = real.tenants.map(t => ({ ...t, src: 'COSTAR' }));   // current tenancies (tenant moves)
    b.photo = real.photo || null; b.models = real.models || [];
    if (Array.isArray(real.vacant_floors)) {
      b.vacantFloors = real.vacant_floors.filter(f => f >= 2 && f <= b.floors).sort((a, c) => a - c); b.real.floors = true; b.src.vacant = 'COSTAR';
      b.ev.costar.vacant_floors = real.vacant_floors;
    }
    if (real.parking && real.parking.length) {
      const pk = [...real.parking].sort((a, c) => String(a.date).localeCompare(String(c.date)));
      b.obs = pk.map(x => x.pct); b.obsDates = pk.map(x => x.date); b.obsMeta = pk; b.real.aerial = true; b.src.obs = 'VEXCEL';
    }
    const I = real.interior;
    if (I) {
      b.ev.matterport = I; b.scanned = !!I.scanned; b.modelId = I.model_id || null; b.real.interior = true;
      if (I.W && I.D) { b.W = Math.max(I.W, I.D); b.D = Math.min(I.W, I.D); b.irregular = false; b.src.plate = 'MATTERPORT'; }
      if (I.f2f) { b.f2f = I.f2f; b.src.f2f = 'MATTERPORT'; }
      if (I.core && I.W >= I.D) { b.core = I.core; b.src.core = 'MATTERPORT'; }   // core given in the plate's own orientation
    }
  }
})();
