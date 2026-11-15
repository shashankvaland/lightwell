// Home designer engine: turns one home from LW.layout() into a few concept apartment plans.
// Pure functions, no page code (like engine.js). Read-only: nothing here changes a building, its score or the memo.
//
// Local frame for one home: u runs along the window wall (0..a), v runs from the glass (v = 0) to the corridor (v = d).
// A plan is a list of rooms { type, label, r: [u0, v0, u1, v1] } that tile the home exactly.
// Every plan is checked against the rules below (H.check) before it is offered; plans that fail are never shown.
// These are early concept plans for screening, not construction drawings: an architect makes the final call.
(function () {
  const LW = window.LW = window.LW || {};
  const H = LW.homes = {};
  const EPS = 0.01;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const area = r => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const sum = xs => xs.reduce((s, x) => s + x, 0);
  const avg = xs => xs.length ? sum(xs) / xs.length : 1;

  // Screening rules (typical code minimums and marketable sizes, in feet). Verify against the building code in use.
  const RULE = {
    hall: 3.5,                        // hallway width
    door: 2.5,                        // shared wall needed for a door between two rooms
    open: 1,                          // shared edge that counts as an opening between open-plan spaces
    bed: { min: 9.5, area: 95 },      // bedroom: smallest side, floor area
    living: { min: 11, area: 150 },
    studio: { min: 11, area: 170 },   // studio: living + sleeping in one room
    bath: { w: 5, d: 7.5 }, bathAcc: { w: 8, d: 8 },   // accessible bath: room for a 5 ft turning circle
    kitchen: { min: 6, area: 45 },
    den: { min: 6.5, area: 45 },
    entry: { min: 3.5 },
  };
  H.RULE = RULE;
  // Rough fit-out allowances, only to compare plans with each other (the engine's $ per sq ft covers the conversion).
  H.COST = { bath: 28000, kitchen: 32000, accessible: 4000, wetAway: 6000, den: 3000 };
  // Typical home sizes (sq ft) by bedrooms, for scoring "right-sized": studio, 1-bed, 2-bed, 3-bed.
  H.SIZE = [[350, 650], [550, 900], [800, 1250], [1100, 1700]];

  const HAB = new Set(['bed', 'living', 'studio']);                       // rooms people live in: need a window
  const CIRC = new Set(['living', 'studio', 'kitchen', 'entry', 'hall']); // rooms you walk through
  const WET = new Set(['bath', 'kitchen']);
  H.TYPES = { bed: 'Bedroom', living: 'Living', studio: 'Living + sleeping', kitchen: 'Kitchen', bath: 'Bath', entry: 'Entry',
    hall: 'Hall', closet: 'Closet', den: 'Den / work nook', laundry: 'Laundry', storage: 'Storage' };

  const R = (type, label, u0, v0, u1, v1) => ({ type, label, r: [u0, v0, u1, v1] });
  const W = x => x.r[2] - x.r[0], Dp = x => x.r[3] - x.r[1];

  // ---------- one home from the floor layout, in its own frame ----------
  // s0 / s1: the home also has glass on its u = 0 / u = a end (a corner home on the outside wall).
  H.context = function (b, L, i) {
    const un = L && L.units[i]; if (!un) return null;
    const r = un.r, hor = un.win === 'n' || un.win === 's';
    const a = hor ? r[2] - r[0] : r[3] - r[1], d = hor ? r[3] - r[1] : r[2] - r[0];
    let s0 = false, s1 = false;
    if (!un.court && hor) {
      const left = r[0] < 0.5, right = r[2] > b.W - 0.5;
      if (un.win === 'n') { s0 = left; s1 = right; } else { s0 = right; s1 = left; }
    }
    return { i, a, d, win: un.win, court: !!un.court, s0, s1, sqft: a * d, r: r.slice() };
  };
  H.sig = r => r.map(x => Math.round(x * 10) / 10).join(',');   // identifies a home across re-renders

  // ---------- shared walls ----------
  function shared(p, q) {
    const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    if (Math.abs(p[2] - q[0]) < EPS || Math.abs(q[2] - p[0]) < EPS) return ov(p[1], p[3], q[1], q[3]);
    if (Math.abs(p[3] - q[1]) < EPS || Math.abs(q[3] - p[1]) < EPS) return ov(p[0], p[2], q[0], q[2]);
    return 0;
  }
  H.shared = shared;
  const touchesGlass = (x, c) => x.r[1] < EPS || (c.s0 && x.r[0] < EPS) || (c.s1 && x.r[2] > c.a - EPS);

  // ---------- the rule check: returns a list of problems (empty = the plan passes) ----------
  H.check = function (rooms, c, o) {
    o = o || {};
    const bad = [], a = c.a, d = c.d;
    rooms.forEach((x, i) => {
      const [u0, v0, u1, v1] = x.r;
      if (u0 < -EPS || v0 < -EPS || u1 > a + EPS || v1 > d + EPS || u1 - u0 < 1 || v1 - v0 < 1) bad.push(`${x.label} is outside the home`);
      for (let j = i + 1; j < rooms.length; j++) {
        const q = rooms[j].r, ov = Math.max(0, Math.min(u1, q[2]) - Math.max(u0, q[0])) * Math.max(0, Math.min(v1, q[3]) - Math.max(v0, q[1]));
        if (ov > EPS) bad.push(`${x.label} overlaps ${rooms[j].label}`);
      }
      const mn = Math.min(W(x), Dp(x)), ar = area(x.r);
      if (x.type === 'bed' && (mn < RULE.bed.min - EPS || ar < RULE.bed.area)) bad.push(`${x.label} is too small`);
      if (x.type === 'living' && (mn < RULE.living.min - EPS || ar < RULE.living.area)) bad.push('Living room is too small');
      if (x.type === 'studio' && (mn < RULE.studio.min - EPS || ar < RULE.studio.area)) bad.push('Studio room is too small');
      if (x.type === 'kitchen' && (mn < RULE.kitchen.min - EPS || ar < RULE.kitchen.area)) bad.push('Kitchen is too small');
      if (x.type === 'den' && (mn < RULE.den.min - EPS || ar < RULE.den.area)) bad.push('Den is too small');
      if (x.type === 'hall' && mn < RULE.hall - EPS) bad.push('Hall is too narrow');
      if (x.type === 'entry' && mn < RULE.entry.min - EPS) bad.push('Entry is too narrow');
      if (x.type === 'bath') { const B = o.acc ? RULE.bathAcc : RULE.bath;
        if (mn < B.w - EPS || Math.max(W(x), Dp(x)) < B.d - EPS) bad.push(`${x.label} is under ${B.w} × ${B.d} ft`); }
      if (HAB.has(x.type) && !touchesGlass(x, c)) bad.push(`${x.label} has no window`);
    });
    if (Math.abs(sum(rooms.map(x => area(x.r))) - a * d) > Math.max(1, a * d * 0.005)) bad.push('Rooms do not fill the home');
    if (!rooms.some(x => x.type === 'bath')) bad.push('No bathroom');
    if (!rooms.some(x => x.type === 'kitchen')) bad.push('No kitchen');
    if (!rooms.some(x => x.type === 'living' || x.type === 'studio')) bad.push('No living room');
    if (bad.length) return bad;
    // Access: walk from the corridor door through open-plan spaces and halls; every other room needs a door off them.
    const circ = rooms.filter(x => CIRC.has(x.type)), seen = new Set(circ.filter(x => x.r[3] > d - EPS));
    if (!seen.size) return ['No front door on the corridor'];
    let grew = true;
    while (grew) { grew = false;
      for (const x of circ) if (!seen.has(x) && [...seen].some(y => shared(x.r, y.r) >= RULE.open)) { seen.add(x); grew = true; } }
    for (const x of circ) if (!seen.has(x)) bad.push(`${x.label} can't be reached`);
    const reach = x => [...seen].some(y => shared(x.r, y.r) >= RULE.door);
    for (const x of rooms) {
      if (CIRC.has(x.type)) continue;
      if (reach(x)) continue;
      // an en-suite bath, a closet or storage may open off a bedroom (or storage off a closet)
      const viaBed = ['bath', 'closet', 'storage', 'laundry'].includes(x.type) && rooms.some(y => y.type === 'bed' && reach(y) && shared(x.r, y.r) >= RULE.door);
      const viaAny = x.type === 'storage' && rooms.some(y => y !== x && shared(x.r, y.r) >= RULE.door);
      if (!viaBed && !viaAny) bad.push(`${x.label} can't be reached`);
    }
    if (!rooms.some(x => x.type === 'bath' && reach(x)) && !rooms.some(x => x.type === 'bath' && rooms.every(y => y.type !== 'bed')))
      bad.push('No bathroom off the living space or hall (guests would walk through a bedroom)');
    return bad;
  };

  // ---------- plan builders (each returns rooms or null when the home is the wrong size for it) ----------
  // Studio: one room on the glass; bath, kitchen and entry along the corridor wall (kitchen and bath share a wet wall).
  function studio(a, d, o) {
    const kd = 8, bw = o.acc ? 8 : 5.5, ew = 4, kw = a - bw - ew;
    if (d - kd < RULE.studio.min || kw < 7) return null;
    return [R('studio', 'Living + sleeping', 0, 0, a, d - kd),
      R('bath', 'Bath', 0, d - kd, bw, d), R('kitchen', 'Kitchen', bw, d - kd, bw + kw, d), R('entry', 'Entry', bw + kw, d - kd, a, d)];
  }
  // Shallow studio: a service strip down one side (kitchen at the glass, bath at the corridor).
  function studioSide(a, d, o) {
    const sw = o.acc ? 8 : 7.5, bd = o.acc ? 8 : 7.5;
    if (a - sw < RULE.studio.min || d - bd < RULE.kitchen.min) return null;
    return [R('studio', 'Living + sleeping', sw, 0, a, d), R('kitchen', 'Kitchen', 0, 0, sw, d - bd), R('bath', 'Bath', 0, d - bd, sw, d)];
  }
  // Narrow, deep studio: room on the glass, then a full-width kitchen, then bath and entry.
  function studioNarrow(a, d, o) {
    const bd = o.acc ? 8 : 7.5, kd = 8, bw = Math.min(a - RULE.entry.min, o.acc ? 8 : 6);
    if (bw < (o.acc ? 8 : 5) || d - bd - kd < RULE.studio.min) return null;
    return [R('studio', 'Living + sleeping', 0, 0, a, d - bd - kd), R('kitchen', 'Kitchen', 0, d - bd - kd, a, d - bd),
      R('bath', 'Bath', 0, d - bd, bw, d), R('entry', 'Entry', bw, d - bd, a, d)];
  }

  // Homes with bedrooms: columns along the glass, one per bedroom plus one for living.
  //   o.beds 1-3, o.baths 1-2, o.pos 'left' | 'right' | 'split' (living between bedrooms), o.kitchen 'open' | 'back', o.den, o.acc
  // Bedroom column, from the glass: bedroom, then (deep homes) a hall, then bath / closets / den on the corridor side.
  // Living column, from the glass: living, then kitchen and entry (open kitchen), or kitchen + entry side by side (back kitchen).
  function bedHome(a, d, o) {
    const n = o.beds, lmin = n >= 2 ? 13 : 12, bw = Math.min(13.5, (a - lmin) / n);
    if (bw < RULE.bed.min) return null;
    const lw = a - n * bw, bth = o.acc ? RULE.bathAcc : RULE.bath, bthW = o.acc ? 8 : 5.5, bthD = Math.max(bth.d, 8);
    const fd = clamp(d - RULE.hall - 9.5, 11, 15);            // bedroom depth from the glass
    const hallMode = d - fd - RULE.hall >= bthD;               // deep enough for a hall behind the bedrooms
    const cols = o.pos === 'left' ? ['L', ...Array(n).fill('B')] : o.pos === 'right' ? [...Array(n).fill('B'), 'L']
      : ['B', 'L', ...Array(n - 1).fill('B')];
    const xs = []; let x = 0;
    for (const k of cols) { const w = k === 'L' ? lw : bw; xs.push([x, x + w]); x += w; }
    const li = cols.indexOf('L'), [lx0, lx1] = xs[li];
    // bedroom columns nearest the living room get the baths (short pipe runs to the kitchen)
    const bedIdx = cols.map((k, i) => i).filter(i => cols[i] === 'B').sort((p, q) => Math.abs(p - li) - Math.abs(q - li));
    const rooms = []; let bathsLeft = o.baths, denLeft = !!o.den, laundry = false, bn = 0;
    const livingBath = !hallMode;                               // no hall: the shared bath goes in the living column
    if (livingBath) bathsLeft--;
    for (const i of bedIdx) {
      const [x0, x1] = xs[i], towardL = i < li ? 'right' : 'left'; bn++;
      const label = n === 1 ? 'Bedroom' : `Bedroom ${bn}`;
      if (hallMode) {
        rooms.push(R('bed', label, x0, 0, x1, fd), R('hall', 'Hall', x0, fd, x1, fd + RULE.hall));
        const v0 = fd + RULE.hall, bk = d - v0, vb = bk >= 8.5 + 6 ? v0 + 8.5 : d;   // very deep: storage or a den behind
        let rem = [x0, x1];
        if (bathsLeft > 0) {
          const w = bw - bthW >= 2.5 ? bthW : bw, bx = towardL === 'right' ? [x1 - w, x1] : [x0, x0 + w];
          rooms.push(R('bath', o.baths - bathsLeft === 0 ? 'Bath' : 'Bath 2', bx[0], v0, bx[1], vb)); bathsLeft--;
          rem = towardL === 'right' ? [x0, x1 - w] : [x0 + w, x1];
        }
        if (rem[1] - rem[0] > EPS) {
          const rw = rem[1] - rem[0];
          if (denLeft && rw >= RULE.den.min && vb - v0 >= RULE.den.min) { rooms.push(R('den', 'Den / work nook', rem[0], v0, rem[1], vb)); denLeft = false; }
          else if (!laundry && rw >= 3) { rooms.push(R('laundry', 'Laundry + closet', rem[0], v0, rem[1], vb)); laundry = true; }
          else rooms.push(R('closet', 'Closet', rem[0], v0, rem[1], vb));
        }
        if (vb < d - EPS) {
          const nextToL = Math.abs(i - li) === 1;
          if (nextToL && denLeft && d - vb >= RULE.den.min && bw >= RULE.den.min) { rooms.push(R('den', 'Den / work nook', x0, vb, x1, d)); denLeft = false; }
          else rooms.push(R('storage', 'Storage', x0, vb, x1, d));
        }
      } else {
        const bk = d - fd;
        if (bk < 2.5) { rooms.push(R('bed', label, x0, 0, x1, d)); continue; }
        rooms.push(R('bed', label, x0, 0, x1, fd));
        if (bathsLeft > 0 && bk >= bth.d) {
          const w = bw - bthW >= 2.5 ? bthW : bw, bx = towardL === 'right' ? [x1 - w, x1] : [x0, x0 + w];
          rooms.push(R('bath', 'Bath (en suite)', bx[0], fd, bx[1], d)); bathsLeft--;
          const rem = towardL === 'right' ? [x0, x1 - w] : [x0 + w, x1];
          if (rem[1] - rem[0] > EPS) rooms.push(R('closet', 'Closet', rem[0], fd, rem[1], d));
        } else rooms.push(R('closet', 'Walk-in closet', x0, fd, x1, d));
      }
    }
    if (bathsLeft > 0) return null;   // not enough room for the baths asked for
    // living column: the kitchen sits on the side of the nearest bath (one wet wall)
    const kSide = bedIdx.length && bedIdx[0] > li ? 'right' : 'left';
    const ew = o.acc ? 5 : 4;
    if (o.kitchen === 'open') {
      const kd = 9, ed = livingBath ? bthD : 5, ld = d - kd - ed;
      if (ld < RULE.living.min) return null;
      rooms.push(R('living', 'Living + dining', lx0, 0, lx1, ld), R('kitchen', 'Kitchen (open)', lx0, ld, lx1, ld + kd));
      if (livingBath) {
        const bx = kSide === 'right' ? [lx1 - bthW, lx1] : [lx0, lx0 + bthW];
        if (lw - bthW < RULE.entry.min) return null;
        rooms.push(R('bath', 'Bath', bx[0], ld + kd, bx[1], d), R('entry', 'Entry', kSide === 'right' ? lx0 : lx0 + bthW, ld + kd, kSide === 'right' ? lx1 - bthW : lx1, d));
      } else rooms.push(R('entry', 'Entry', lx0, ld + kd, lx1, d));
    } else {
      const kd = livingBath ? bthD : 8, ld = d - kd, kw = lw - ew - (livingBath ? bthW : 0);
      if (ld < RULE.living.min || kw < 7) return null;
      rooms.push(R('living', 'Living + dining', lx0, 0, lx1, ld));
      // along the corridor wall, from the bedroom side: kitchen, (bath), entry
      const seq = [['kitchen', 'Kitchen', kw]].concat(livingBath ? [['bath', 'Bath', bthW]] : [], [['entry', 'Entry', ew]]);
      let p = kSide === 'right' ? lx1 : lx0;
      for (const [t, lab, w] of seq) {
        if (kSide === 'right') { rooms.push(R(t, lab, p - w, ld, p, d)); p -= w; } else { rooms.push(R(t, lab, p, ld, p + w, d)); p += w; }
      }
    }
    if (denLeft) return null;         // a den was asked for and doesn't fit
    return rooms;
  }

  const mirror = (rooms, a) => rooms.map(x => ({ ...x, r: [a - x.r[2], x.r[1], a - x.r[0], x.r[3]] }));

  // ---------- scoring (0-100): light, room sizes, proportions, plumbing, wasted space ----------
  function wetShared(rooms) {
    const wet = rooms.filter(x => WET.has(x.type));
    for (let i = 0; i < wet.length; i++) for (let j = i + 1; j < wet.length; j++) if (shared(wet[i].r, wet[j].r) >= 2) return true;
    return false;
  }
  function wetAway(rooms, c) {   // wet rooms that neither reach the corridor wall nor back onto one that does
    const wet = rooms.filter(x => WET.has(x.type)), atC = wet.filter(x => x.r[3] > c.d - EPS);
    return wet.filter(x => !atC.includes(x) && !atC.some(y => shared(x.r, y.r) >= 2)).length;
  }
  function score(rooms, c) {
    const A = c.a * c.d, ar = x => area(x.r), by = t => rooms.filter(x => x.type === t);
    const hab = rooms.filter(x => HAB.has(x.type)), habA = sum(hab.map(ar));
    const glass = sum(hab.filter(x => x.r[1] < EPS).map(W)) / c.a;
    const beds = by('bed'), liv = by('living').concat(by('studio'));
    const bedQ = avg(beds.map(x => Math.min(1, ar(x) / 130)));
    const livQ = Math.min(1, sum(liv.map(ar)) / (170 + 60 * beds.length));
    const shape = avg(rooms.filter(x => HAB.has(x.type) || x.type === 'kitchen' || x.type === 'bath').map(x => {
      const k = Math.max(W(x), Dp(x)) / Math.min(W(x), Dp(x)); return k <= 1.8 ? 1 : Math.max(0, 1 - (k - 1.8) / 1.5); }));
    const circ = sum(rooms.filter(x => x.type === 'hall' || x.type === 'entry' || x.type === 'storage').map(ar)) / A;
    const corner = (c.s0 || c.s1) && liv.some(x => (c.s0 && x.r[0] < EPS) || (c.s1 && x.r[2] > c.a - EPS)) ? 1 : 0;
    // right-sized: a 1,000 sq ft studio or a 600 sq ft 2-bed is a poor use of the space
    const [lo, hi] = H.SIZE[Math.min(3, beds.length)], fit = A < lo ? A / lo : A > hi ? Math.max(0, 1 - (A - hi) / hi) : 1;
    const s = 0.2 * Math.min(1, habA / A / 0.7) + 0.1 * glass + 0.12 * bedQ + 0.12 * livQ + 0.08 * shape
      + 0.1 * (wetShared(rooms) ? 1 : 0.4) + 0.08 * (1 - Math.min(1, circ / 0.18)) + 0.2 * fit + 0.05 * corner - 0.04 * wetAway(rooms, c);
    return Math.round(100 * clamp(s, 0, 1));
  }

  // ---------- describe a plan ----------
  function describe(p, c, o) {
    const rooms = p.rooms, by = t => rooms.filter(x => x.type === t), notes = [];
    const habA = sum(rooms.filter(x => HAB.has(x.type)).map(x => area(x.r)));
    if (p.kind === 'studio-side') notes.push('Kitchen on the window wall: bright, but less of the glass for living');
    if (p.pos === 'split') notes.push('Bedrooms on both sides of the living room (more privacy)');
    if ((c.s0 || c.s1) && rooms.some(x => (x.type === 'living' || x.type === 'studio') && ((c.s0 && x.r[0] < EPS) || (c.s1 && x.r[2] > c.a - EPS))))
      notes.push('Living room gets the corner windows');
    if (wetShared(rooms)) notes.push('Kitchen and bath share a wet wall (cheaper plumbing)');
    const away = wetAway(rooms, c);
    notes.push(away ? `${away} wet room${away > 1 ? 's' : ''} away from the corridor wall: longer pipe runs` : 'Kitchen and baths on the corridor side, where new water and drain lines can run');
    if (by('bath').some(x => /en suite/.test(x.label))) notes.push('Bath en suite off the bedroom');
    if (by('den').length) notes.push('Den / work nook has no window: not a legal bedroom');
    if (by('storage').length) notes.push('Very deep home: storage at the back');
    if (o.acc) notes.push('Accessible bath (8 × 8 ft, 5 ft turning circle): verify against the Fair Housing Act / ADA');
    const cost = by('bath').length * H.COST.bath + H.COST.kitchen + (o.acc ? by('bath').length * H.COST.accessible : 0)
      + by('den').length * H.COST.den + away * H.COST.wetAway;
    const title = p.beds === 0 ? 'Studio' : `${p.beds}-bed`;
    const sub = `${p.baths} bath${p.baths > 1 ? 's' : ''} · ${p.kitchen === 'open' ? 'open kitchen' : p.kitchen === 'side' ? 'side kitchen' : 'kitchen by the entry'}${p.den ? ' · den' : ''}${p.pos === 'split' ? ' · bedrooms either side' : ''}`;
    const checks = [
      ['Every bedroom and the living room has a window', true],
      [`Bedrooms at least ${RULE.bed.min} ft wide and ${RULE.bed.area} sq ft`, true],
      [`Bath at least ${(o.acc ? RULE.bathAcc : RULE.bath).w} × ${(o.acc ? RULE.bathAcc : RULE.bath).d} ft${o.acc ? ' (accessible)' : ''}`, true],
      ['Every room reachable from the front door; a bathroom off the hall or living space', true],
      ['Rooms fill the home with no overlaps', true],
      ['Kitchen and bath share a wet wall', wetShared(rooms)],
    ];
    return { title, sub, notes, cost, checks, habPct: Math.round(100 * habA / (c.a * c.d)) };
  }

  // ---------- generate, check, score and pick 3-5 different plans ----------
  // prefs: { beds: 0-3 | null, baths: 1-2 | null, wfh: bool, acc: bool }
  H.design = function (c, prefs) {
    prefs = prefs || {};
    const o0 = { acc: !!prefs.acc }, all = [];
    let tried = 0;
    const add = (rooms, meta) => {
      if (!rooms) return;
      for (const m of [false, true]) {
        const rs = m ? mirror(rooms, c.a) : rooms; tried++;
        if (H.check(rs, c, o0).length) continue;
        all.push({ ...meta, rooms: rs, score: score(rs, c) });
      }
    };
    add(studio(c.a, c.d, o0), { kind: 'studio', beds: 0, baths: 1, kitchen: 'back', den: false });
    add(studioSide(c.a, c.d, o0), { kind: 'studio-side', beds: 0, baths: 1, kitchen: 'side', den: false });
    add(studioNarrow(c.a, c.d, o0), { kind: 'studio-narrow', beds: 0, baths: 1, kitchen: 'open', den: false });
    for (const beds of [1, 2, 3]) for (const baths of beds >= 2 ? [1, 2] : [1]) for (const pos of beds >= 2 ? ['left', 'right', 'split'] : ['left', 'right'])
      for (const kitchen of ['open', 'back']) for (const den of [false, true]) {
        const meta = { kind: 'bed', beds, baths, pos, kitchen, den };
        add(bedHome(c.a, c.d, { ...o0, ...meta }), meta);
      }
    const want = all.filter(p => (prefs.beds == null || p.beds === prefs.beds) && (prefs.baths == null || p.baths === prefs.baths) && (!prefs.wfh || p.den));
    const best = new Map();
    for (const p of want) { const k = `${p.beds}|${p.baths}|${p.kitchen}|${p.den}|${p.pos === 'split'}`; if (!best.has(k) || best.get(k).score < p.score) best.set(k, p); }
    const ranked = [...best.values()].sort((x, y) => y.score - x.score || x.beds - y.beds);
    // variety: the best plan for each bedroom count first, then the next best plans
    const pick = [], beds = new Set();
    for (const p of ranked) if (!beds.has(p.beds)) { beds.add(p.beds); pick.push(p); }
    for (const p of ranked) if (pick.length < 5 && !pick.includes(p)) pick.push(p);
    const options = pick.slice(0, 5).sort((x, y) => y.score - x.score).map(p => ({ ...p, ...describe(p, c, o0) }));
    if (options.length) {
      const top = Math.max(...options.map(p => p.score)), cheap = Math.min(...options.map(p => p.cost)), most = Math.max(...options.map(p => p.beds));
      const light = Math.max(...options.map(p => p.habPct));
      // each badge goes to one plan only (the best-scoring of any tie), so it means something
      const first = f => options.find(f);
      const give = (p, t) => p && p.badges.push(t);
      for (const p of options) { p.badges = []; p.costDelta = p.cost - cheap; }
      give(first(p => p.score === top), 'Best overall');
      if (options.some(p => p.cost !== cheap)) give(first(p => p.cost === cheap), 'Cheapest fit-out');
      if (most > 0 && options.some(q => q.beds < most)) give(first(p => p.beds === most), 'Most bedrooms');
      give(first(p => p.habPct === light && !p.badges.length), 'Most living space');
    }
    return { options, tried, valid: all.length, reasons: options.length ? [] : H.explain(c, prefs, all) };
  };

  // Why nothing fits, in plain words.
  H.explain = function (c, prefs, all) {
    const out = [];
    if (prefs.beds >= 1) {
      const need = prefs.beds * RULE.bed.min + (prefs.beds >= 2 ? 13 : 12);
      if (c.a < need) out.push(`A ${prefs.beds}-bed needs about ${Math.ceil(need)} ft of window wall; this home has ${Math.round(c.a)} ft. Merging it with the next home would give more.`);
    }
    if (prefs.wfh && prefs.beds === 0) out.push('A separate work nook needs a 1-bed or larger layout here.');
    if (prefs.baths === 2 && prefs.beds != null && prefs.beds < 2) out.push('Two bathrooms are offered only with 2 or more bedrooms.');
    if (prefs.acc) out.push('The accessible bath (8 × 8 ft) needs more room than the standard one.');
    if (!all.length) out.push(`This home (${Math.round(c.a)} × ${Math.round(c.d)} ft) is too small or narrow for any plan that passes every rule.`);
    if (!out.length) out.push('No plan passes every rule with these choices. Try "Any" bedrooms or bathrooms.');
    return out;
  };

  // Plain-words request -> preferences ("family home with two bathrooms and a work nook").
  H.parse = function (text, base) {
    const t = String(text || '').toLowerCase(), p = { ...(base || {}) };
    const num = { one: 1, two: 2, three: 3, '1': 1, '2': 2, '3': 3 };
    if (/\bstudio\b/.test(t)) p.beds = 0;
    const mb = t.match(/\b(one|two|three|1|2|3)[\s-]*(bed|br|bedroom)/); if (mb) p.beds = num[mb[1]];
    if (/\bfamil/.test(t) && p.beds == null) p.beds = 2;
    const mt = t.match(/\b(one|two|1|2)[\s-]*(bath|bathroom)/); if (mt) p.baths = num[mt[1]];
    if (/work|office|wfh|study|\bden\b|nook/.test(t)) p.wfh = true;
    if (/accessib|wheelchair|\bada\b|disab|step-free/.test(t)) p.acc = true;
    return p;
  };
})();
