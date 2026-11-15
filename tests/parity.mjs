// Runs the browser engine (lightwell/js/engine.js + data.js) in Node on the real downtown Houston towers and writes
// tests/js_results.json. tests/test_engine.py then runs backend/engine.py on the same inputs and compares every number.
//   node tests/parity.mjs && python -m pytest tests -q
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import url from 'node:url';
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, console, Math, JSON, Set, Map, Array, Object, String, Number, Infinity, isFinite };
ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['lightwell/data/daylight.js', 'lightwell/js/engine.js', 'lightwell/js/data.js', 'lightwell/js/shuffle.js', 'lightwell/js/scout.js', 'lightwell/js/rent.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const LW = ctx.window.LW;
const gj = JSON.parse(fs.readFileSync(path.join(root, 'lightwell/data/houston_downtown.geojson'), 'utf8'));
const B = LW.buildCandidates(gj, 'demo');
const scenarios = [
  { S: { u: 30, cap: 300000, allowLW: true, minHomes: 20, useParking: true, require: [] } },
  { S: { u: 25, cap: 250000, allowLW: true, minHomes: 200, useParking: false, require: [] } },
  { S: { u: 40, cap: 400000, allowLW: false, minHomes: 20, useParking: true, require: [] } },
  { S: { u: 35, cap: 320000, allowLW: true, minHomes: 20, useParking: true, require: [] }, forceLW: true, core: true, missing: true },
  // Daylight X-ray: strict mode with a looser limit, and the check switched off
  { S: { u: 30, cap: 300000, allowLW: true, minHomes: 20, useParking: true, require: [], neighbours: true, dayLim: 30, dayStrict: true } },
  { S: { u: 30, cap: 300000, allowLW: true, minHomes: 20, useParking: true, require: [], neighbours: false } },
  // real CoStar paths: sprinkler records, converted buildings, tenants sharing floors, lease ends not on record
  { S: { u: 30, cap: 300000, allowLW: true, minHomes: 20, useParking: true, require: [] }, costar: true },
  // Matterport: clear ceilings measured in scans (low, tight, comfortable, tall), some on towers with a real floor-to-floor record
  { S: { u: 30, cap: 300000, allowLW: true, minHomes: 20, useParking: true, require: [] }, scan: true },
];
// CoStar-like tenants: two tenants on every other floor, and some leases with no end on record (null)
const realTenants = b => { const empty = new Set(b.vacantFloors), out = []; let i = 0;
  for (let f = 2; f <= b.floors; f++) { if (empty.has(f)) continue;
    out.push({ name: `CoStar tenant ${i}`, floors: [f], sqft: Math.round(b.W * b.D * 0.6), lease_end: i % 3 === 0 ? null : 2026 + (i % 7), src: 'COSTAR' });
    if (i % 2 === 0) out.push({ name: `CoStar tenant ${i}b`, floors: [f], sqft: Math.round(b.W * b.D * 0.4), lease_end: i % 4 === 0 ? null : 2027 + (i % 5), src: 'COSTAR' });
    i++; }
  return out; };
const out = [];
for (const sc of scenarios) {
  LW.S = { ...sc.S };
  const rows = [], copies = [];
  for (const b0 of B) {
    const b = { ...b0, overrides: {}, forceLW: sc.forceLW && b0.idx % 3 === 0 ? true : null };
    if (sc.core && b.idx % 4 === 1) b.core = [b.W * 0.3, b.D * 0.35, b.W * 0.7, b.D * 0.65];
    if (sc.missing && b.idx % 5 === 2) { b.rep = null; b.year = null; }
    if (sc.missing && b.idx % 5 === 3) b.obs = [];
    if (sc.costar) { b.sprinklers = [true, false, null][b.idx % 3]; if (b.idx % 11 === 5) b.converted = 2022; if (b.idx % 4 === 0) b.tenants = realTenants(b); }
    if (sc.scan && b.idx % 3 !== 1) { b.ceil = [7, 8.5, 9, 12.1][b.idx % 4]; if (b.idx % 6 === 0) b.src = { ...b.src, f2f: 'COSTAR' }; }
    LW.analyze(b);
    const L = b.plan.L, issues = LW.checkLayout(L, b.W, b.D);
    rows.push({ input: { id: b.id, W: b.W, D: b.D, heightM: b.heightM, floors: b.floors, f2f: b.f2f, year: b.year, rep: b.rep,
      obs: b.obs, scanned: b.scanned, core: b.core, forceLW: b.forceLW, real: b.real, vacantFloors: b.vacantFloors, center: b.center, day: b.day,
      sprinklers: b.sprinklers ?? null, converted: b.converted ?? null, tenants: b.tenants ?? null, ceil: b.ceil ?? null,
      src: { vacant: LW.srcOf(b, 'vacant'), f2f: LW.srcOf(b, 'f2f'), core: LW.srcOf(b, 'core'), rep: LW.srcOf(b, 'rep') } }, summary: LW.summary(b), issues,
      courtOK: b.courtOK, altIssues: b.alt ? LW.checkLayout(b.alt.L, b.W, b.D) : [] });
    copies.push(b);
  }
  // Texas fast-track + tenant moves + red team on every tower (both goals)
  copies.forEach((b, i) => { const r = rows[i]; r.fastTrack = LW.fastTrack(b);
    r.moves = { fast: LW.planMoves(b, copies, 'fast'), empty: LW.planMoves(b, copies, 'empty') };
    r.challenge = LW.challengePlan(b, r.moves.fast, copies); });
  // evidence review on the leaders (the what-if for floor-to-floor stops at what a measured ceiling allows)
  const lead = copies.filter(b => b.pass).sort((a, c) => c.score - a.score).slice(0, 6).map(b => b.id);
  out.push({ S: sc.S, A: LW.A, rows, review: { ids: lead, gaps: LW.reviewGaps(copies, lead) } });
}
fs.writeFileSync(path.join(root, 'tests/js_results.json'), JSON.stringify(out));

// Data scout: a quarter of the towers carry "CoStar" records, a quarter have none (real-data gaps), the rest simulated.
LW.S = { ...scenarios[0].S };
const sc = B.map(b0 => {
  const b = { ...b0, overrides: {}, src: { ...b0.src }, ev: {} };
  if (b.idx % 4 === 0) Object.assign(b.src, { rep: 'COSTAR', year: 'COSTAR', vacant: 'COSTAR' });
  else if (b.idx % 4 === 1) { b.rep = null; b.year = null; b.vacantFloors = []; Object.assign(b.src, { rep: 'MISSING', year: 'MISSING', vacant: 'MISSING' }); }
  return b;
});
const scIn = sc.map(b => ({ id: b.id, W: b.W, D: b.D, heightM: b.heightM, floors: b.floors, f2f: b.f2f, year: b.year, rep: b.rep, obs: b.obs,
  scanned: b.scanned, core: b.core, forceLW: null, real: b.real, vacantFloors: b.vacantFloors, center: b.center, day: b.day,
  src: { rep: b.src.rep, year: b.src.year, vacant: b.src.vacant } }));
sc.forEach(b => LW.analyze(b));
const est = LW.scoutGaps(sc);
for (const e of est) { const b = sc.find(x => x.id === e.id); b.rep = e.value; b.src.rep = 'ESTIMATE'; }
sc.forEach(b => LW.analyze(b));
const pri = LW.dataPriority(sc, 8);
fs.writeFileSync(path.join(root, 'tests/js_scout.json'), JSON.stringify({ S: LW.S, A: LW.A, input: scIn, estimates: est, priority: pri }));
// Rent check: a test grid of listings around downtown (test fixture only, never shown in the app)
const comps = [];
for (let i = 0; i < 160; i++) comps.push({ lat: 29.745 + (i % 16) * 0.0018, lon: -95.378 + Math.floor(i / 16) * 0.0025, beds: i % 7 === 6 ? null : i % 3,
  rent: 1200 + (i * 37) % 1500 + (i % 3) * 300, sqft: i % 5 === 4 ? null : 480 + (i % 3) * 320 + (i * 13) % 90 });
const rentRows = [];
for (const [k, b] of sc.entries()) {
  b.rentMarket = k % 9 === 8 ? null : LW.marketRent(b, k % 5 === 3 ? comps.map(c => ({ ...c, beds: null })) : comps);
  rentRows.push({ id: b.id, rentMarket: b.rentMarket, check: LW.rentCheck(b) });
}
fs.writeFileSync(path.join(root, 'tests/js_rent.json'), JSON.stringify({ A: LW.A, rows: rentRows }));
console.log(`Rent check: ${rentRows.filter(r => r.check && r.check.verdict !== 'no_data').length} towers with comps; verdicts ` +
  JSON.stringify(rentRows.reduce((o, r) => { const v = r.check ? r.check.verdict : 'none'; o[v] = (o[v] || 0) + 1; return o; }, {})));
console.log(`Data scout: ${est.length} towers estimated; top data request ${pri[0] ? pri[0].id + ' (' + pri[0].reasons[0] + ')' : 'none'}.`);
const all = out.flatMap(s => s.rows), bad = all.filter(r => r.issues.length || r.altIssues.length);
console.log(`JS engine: ${B.length} towers x ${scenarios.length} scenarios; ${bad.length} layouts with geometry issues; ` +
  `${out[0].rows.filter(r => r.summary.passes).length} pass the default brief.`);
if (bad.length) { console.log(bad.slice(0, 5).map(r => r.input.id + ': ' + [...r.issues, ...r.altIssues].slice(0, 3).join('; ')).join('\n')); process.exit(1); }
