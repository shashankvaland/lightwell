// Runs the browser engine (lightwell/js/engine.js + data.js) in Node on the real downtown Houston towers and writes
// tests/js_results.json. tests/test_engine.py then runs backend/engine.py on the same inputs and compares every number.
//   node tests/parity.mjs && python -m pytest tests -q
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import url from 'node:url';
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, console, Math, JSON, Set, Map, Array, Object, String, Number, Infinity, isFinite };
ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['lightwell/data/daylight.js', 'lightwell/js/engine.js', 'lightwell/js/data.js', 'lightwell/js/shuffle.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
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
];
const out = [];
for (const sc of scenarios) {
  LW.S = { ...sc.S };
  const rows = [], copies = [];
  for (const b0 of B) {
    const b = { ...b0, overrides: {}, forceLW: sc.forceLW && b0.idx % 3 === 0 ? true : null };
    if (sc.core && b.idx % 4 === 1) b.core = [b.W * 0.3, b.D * 0.35, b.W * 0.7, b.D * 0.65];
    if (sc.missing && b.idx % 5 === 2) { b.rep = null; b.year = null; }
    if (sc.missing && b.idx % 5 === 3) b.obs = [];
    LW.analyze(b);
    const L = b.plan.L, issues = LW.checkLayout(L, b.W, b.D);
    rows.push({ input: { id: b.id, W: b.W, D: b.D, heightM: b.heightM, floors: b.floors, f2f: b.f2f, year: b.year, rep: b.rep,
      obs: b.obs, scanned: b.scanned, core: b.core, forceLW: b.forceLW, real: b.real, vacantFloors: b.vacantFloors, center: b.center, day: b.day,
      src: { vacant: LW.srcOf(b, 'vacant') } }, summary: LW.summary(b), issues,
      courtOK: b.courtOK, altIssues: b.alt ? LW.checkLayout(b.alt.L, b.W, b.D) : [] });
    copies.push(b);
  }
  // Texas fast-track + tenant moves + red team on every tower (both goals)
  copies.forEach((b, i) => { const r = rows[i]; r.fastTrack = LW.fastTrack(b);
    r.moves = { fast: LW.planMoves(b, copies, 'fast'), empty: LW.planMoves(b, copies, 'empty') };
    r.challenge = LW.challengePlan(b, r.moves.fast, copies); });
  out.push({ S: sc.S, A: LW.A, rows });
}
fs.writeFileSync(path.join(root, 'tests/js_results.json'), JSON.stringify(out));
const all = out.flatMap(s => s.rows), bad = all.filter(r => r.issues.length || r.altIssues.length);
console.log(`JS engine: ${B.length} towers x ${scenarios.length} scenarios; ${bad.length} layouts with geometry issues; ` +
  `${out[0].rows.filter(r => r.summary.passes).length} pass the default brief.`);
if (bad.length) { console.log(bad.slice(0, 5).map(r => r.input.id + ': ' + [...r.issues, ...r.altIssues].slice(0, 3).join('; ')).join('\n')); process.exit(1); }
