// Home designer check: runs lightwell/js/homes.js on every home of every downtown tower, with and without a lightwell,
// at several window distances, and checks every plan it offers against the rules (inside the home, no overlaps,
// rooms fill the home, bedrooms on the glass, every room reachable). Also checks that the designer is read-only.
//   node tests/homes.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import url from 'node:url';
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, console, Math, JSON, Set, Map, Array, Object, String, Number, Infinity, isFinite };
ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['lightwell/data/daylight.js', 'lightwell/js/engine.js', 'lightwell/js/data.js', 'lightwell/js/homes.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const LW = ctx.window.LW, H = LW.homes;
const gj = JSON.parse(fs.readFileSync(path.join(root, 'lightwell/data/houston_downtown.geojson'), 'utf8'));
const B = LW.buildCandidates(gj, 'demo');

const prefsList = [{}, { beds: 0 }, { beds: 1 }, { beds: 2 }, { beds: 2, baths: 2 }, { beds: 3 }, { wfh: true }, { acc: true }, { beds: 1, acc: true }];
let homes = 0, plans = 0, none = 0, bad = 0, mutated = 0; const examples = [], noneEx = [], beds = [0, 0, 0, 0];
for (const u of [25, 30, 35, 40]) {
  LW.S = { ...LW.S, u };
  for (const b of B) {
    for (const lw of [false, true]) {
      if (lw && !LW.courtOK(b, u)) continue;
      const L = LW.layout(b.W, b.D, u, lw, b.core);
      L.units.forEach((un, i) => {
        const c = H.context(b, L, i); homes++;
        const before = JSON.stringify(L);
        for (const prefs of prefsList) {
          const res = H.design(c, prefs);
          if (!prefs.beds && prefs.beds !== 0 && !prefs.wfh && !prefs.acc && !prefs.baths) {
            if (!res.options.length) { none++; if (noneEx.length < 8) noneEx.push(`${b.id} u=${u} lw=${lw} home ${i}: ${c.a.toFixed(1)} x ${c.d.toFixed(1)} ft`); }
            res.options.forEach(p => beds[p.beds]++);
          }
          if (!res.options.length && !res.reasons.length) { bad++; examples.push(`${b.id} home ${i}: no options and no reason`); }
          for (const p of res.options) {
            plans++;
            const issues = H.check(p.rooms, c, { acc: !!prefs.acc });
            if (prefs.beds != null && p.beds !== prefs.beds) issues.push(`asked for ${prefs.beds} beds, got ${p.beds}`);
            if (prefs.baths != null && p.baths !== prefs.baths) issues.push(`asked for ${prefs.baths} baths, got ${p.baths}`);
            if (prefs.wfh && !p.rooms.some(x => x.type === 'den')) issues.push('asked for a work nook, got none');
            if (p.rooms.filter(x => x.type === 'bed').length !== p.beds) issues.push('bedroom count does not match');
            if (p.rooms.filter(x => x.type === 'bath').length !== p.baths) issues.push('bath count does not match');
            if (issues.length) { bad++; if (examples.length < 8) examples.push(`${b.id} home ${i} ${p.title} ${p.sub}: ${issues.join('; ')}`); }
          }
        }
        if (JSON.stringify(L) !== before) mutated++;
      });
    }
  }
}
console.log(`Home designer: ${homes} homes, ${plans} plans offered; ${bad} rule failures; ${none} homes with no plan; ${mutated} layouts changed by the designer.`);
console.log(`Default options by size: ${beds[0]} studio, ${beds[1]} 1-bed, ${beds[2]} 2-bed, ${beds[3]} 3-bed.`);
if (noneEx.length) console.log('No plan for:\n  ' + noneEx.join('\n  '));
if (examples.length) console.log(examples.join('\n'));
// the plain-words parser
const pq = [['family home with two bathrooms', { beds: 2, baths: 2 }], ['studio please', { beds: 0 }], ['3 bedroom with a home office', { beds: 3, wfh: true }],
  ['wheelchair accessible one-bed', { beds: 1, acc: true }]];
let parseBad = 0;
for (const [t, want] of pq) { const got = H.parse(t, {}); for (const k of Object.keys(want)) if (got[k] !== want[k]) { parseBad++; console.log(`parse "${t}": ${k} = ${got[k]}, want ${want[k]}`); } }
if (bad || mutated || none || parseBad) process.exit(1);
