// Home designer panel: click a home on the floor plate and get 3-5 concept plans for it (plans from js/homes.js).
// Shift+click (or "Select several") picks neighbouring homes on the same wall; "Merge and design" plans them as one home.
// Read-only: saved designs live in LW.designs for this browser session and never change a tower's score, the agent's
// review, the memo or the CSV. Floor facts (empty or leased, tenants, sky view) come from the data already loaded.
(function () {
  const LW = window.LW, H = LW.homes, $ = id => document.getElementById(id);
  const esc = s => LW.esc(s), fmt = n => LW.fmt(n);
  LW.designs = {};   // tower id -> [{ sigs, lw, units, floors: [from, to], key, title, sub, beds, baths, prefs }]
  let cur = null;    // the open design: { b, sigs, lw, floor, key }
  const pick = { idx: null, lw: null, sigs: [], mode: false };   // homes picked on the floor plate for a merge
  const FILL = { studio: '#f5b942', living: '#f5b942', bed: '#7fb8ff', kitchen: '#3cc6b4', bath: '#8fd3ff', entry: '#8f9ab0',
    hall: '#6b7590', closet: '#566079', laundry: '#566079', storage: '#465068', den: '#ba8cff' };
  const keyOf = p => `${p.beds}|${p.baths}|${p.kitchen}|${p.den}|${p.pos === 'split'}`;
  const homeName = idxs => idxs.length === 1 ? `home ${idxs[0] + 1}` : `homes ${idxs.map(i => i + 1).join(' + ')} merged`;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // The home(s) behind a list of signatures in the current layout: { idxs, c, un, r } or { error }.
  function resolve(b, sigs) {
    const L = b.plan.L, idxs = sigs.map(s => L.units.findIndex(u => H.sig(u.r) === s));
    if (idxs.some(i => i < 0)) return { error: 'changed' };
    if (idxs.length === 1) { const un = L.units[idxs[0]]; return { idxs, un, r: un.r, c: H.context(b, L, idxs[0]) }; }
    const m = H.merge(L, idxs); if (!m.ok) return { error: m.reason };
    return { idxs: idxs.slice().sort((p, q) => p - q), un: { win: m.win, court: m.court, r: m.r }, r: m.r, c: H.contextRect(b, m.r, m.win, m.court) };
  }

  // ---------- floor facts ----------
  function defaultFloor(b) {
    const n = LW.eff(b, 'floors'), pf = LW.pickedFloor;
    if (pf && pf.idx === b.idx && pf.f >= 2 && pf.f <= n) return pf.f;
    const big = LW.emptyBlocks(b)[0];
    return big ? big.from : 2;
  }
  function floorStatus(b, f) {
    if (LW.srcOf(b, 'vacant') === 'MISSING') return { k: 'unknown', text: 'occupancy unknown' };
    return b.vacantFloors.includes(f) ? { k: 'empty', text: 'empty' } : { k: 'leased', text: 'leased' };
  }
  function sky(b, L, un, f) {
    if (!LW.dayOn(b)) return { ok: null, text: 'Sky view not checked (no neighbour data for this tower, or the check is off)' };
    const ang = LW.wallAngle(b, L, un, f, LW.eff(b, 'f2f'), LW.eff(b, 'floors')), lim = LW.S.dayLim != null ? LW.S.dayLim : LW.DAY.lim;
    return ang <= lim ? { ok: true, text: `Sees the sky on floor ${f} (${ang}° blocked, limit ${lim}°)` }
      : { ok: false, text: `Faces a nearby building on floor ${f} (${ang}° blocked, limit ${lim}°): rooms on this wall get little daylight. Consider a higher floor.` };
  }
  function facing(b, un) {
    if (un.court) return 'the lightwell court';
    if (b.day && b.day.face && b.day.face[un.win] != null) return LW.compass(b.day.face[un.win]);
    return `plate side ${un.win.toUpperCase()}`;
  }
  const srcTag = (b, k) => { const s = LW.srcOf(b, k); return `<button class="tag ${LW.SRC_CLASS[s] || 't-est'}" data-ev="${k}" title="Show the evidence">${s}</button>`; };

  // ---------- drawing (SVG in feet; glass at the top, corridor at the bottom) ----------
  function furniture(x, s) {
    const [u0, v0, u1, v1] = x.r, w = u1 - u0, h = v1 - v0, cx = (u0 + u1) / 2, out = [];
    const rect = (a, b, c, d, extra = '') => out.push(`<rect x="${a}" y="${b}" width="${c}" height="${d}" ${extra}/>`);
    if ((x.type === 'bed' && w >= 7 && h >= 9) || (x.type === 'studio' && w >= 12)) {
      const bw = 5, bl = 6.7, bx = x.type === 'studio' ? u1 - bw - 1.5 : cx - bw / 2, by = x.type === 'studio' ? v0 + 1.5 : v1 - bl - 0.6;
      rect(bx, by, bw, bl, 'rx=".3"'); rect(bx + 0.4, x.type === 'studio' ? by + 0.4 : by + bl - 1.6, bw - 0.8, 1.2, 'rx=".3"');
    }
    if ((x.type === 'living' || x.type === 'studio') && w >= 10 && h >= 10) {
      const sx = x.type === 'studio' ? u0 + 1.5 : cx - 3.5, sy = v0 + h * 0.45;
      rect(sx, sy, 7, 2.8, 'rx=".5"');
      out.push(`<circle cx="${sx + 3.5}" cy="${Math.max(v0 + 2.5, sy - 3)}" r="1.6"/>`);
    }
    if (x.type === 'kitchen' && w >= 5 && h >= 5) rect(u0 + 0.3, v1 - 2.3, w - 0.6, 2, 'rx=".2"');
    if (x.type === 'bath' && w >= 4.5 && h >= 7) { rect(u0 + 0.3, v0 + 0.3, Math.min(2.5, w - 0.6), 5, 'rx=".6"'); out.push(`<circle cx="${u1 - 1.4}" cy="${v1 - 1.6}" r=".9"/>`); }
    return out.length ? `<g class="dgFurn" stroke-width="${s.toFixed(3)}">${out.join('')}</g>` : '';
  }
  function planSvg(c, p, small, joins) {
    const a = c.a, d = c.d, pad = small ? 1 : 3, top = small ? 1 : 4, bot = small ? 1 : 5, sw = Math.max(a, d) / (small ? 60 : 160);
    const fs = Math.max(0.85, Math.min(1.35, Math.min(a, d) / 20));
    let s = `<svg viewBox="${-pad} ${-top} ${a + 2 * pad} ${d + top + bot}" class="${small ? 'dgThumb' : 'dgSvg'}" role="img" aria-label="${esc(p.title + ' ' + p.sub)}">`;
    for (const x of p.rooms) {
      const [u0, v0, u1, v1] = x.r;
      s += `<rect x="${u0}" y="${v0}" width="${u1 - u0}" height="${v1 - v0}" fill="${FILL[x.type] || '#566079'}" fill-opacity="${small ? 0.45 : 0.22}" stroke="#e9edf5" stroke-width="${sw.toFixed(3)}"/>`;
    }
    if (!small) {
      // where the old homes met: the party wall that comes down (dotted, for reference)
      for (const u of joins || []) s += `<line x1="${u}" y1="0" x2="${u}" y2="${d}" stroke="#ef5d6f" stroke-width="${(sw * 1.2).toFixed(3)}" stroke-dasharray="${(sw * 5).toFixed(2)} ${(sw * 4).toFixed(2)}" opacity=".75"/>`;
      for (const x of p.rooms) s += furniture(x, sw * 0.8);
      for (const x of p.rooms) {
        const [u0, v0, u1, v1] = x.r, w = u1 - u0, h = v1 - v0, cx = (u0 + u1) / 2, cy = (v0 + v1) / 2;
        const short = { closet: 'CL', laundry: 'W/D', storage: 'ST', hall: '', entry: 'Entry' }[x.type];
        if (w < 6 || h < 4) { if (short && w >= 2 && h >= 2) s += `<text x="${cx}" y="${cy + fs * 0.3}" class="dgLab" font-size="${fs * 0.8}">${short}</text>`; continue; }
        const name = x.type === 'hall' ? (w > 8 ? 'Hall' : '') : x.label;
        if (!name) continue;
        s += `<text x="${cx}" y="${cy - fs * 0.15}" class="dgLab" font-size="${fs}">${esc(name)}</text>`;
        if (x.type !== 'hall') s += `<text x="${cx}" y="${cy + fs * 1.05}" class="dgDim" font-size="${fs * 0.82}">${Math.round(w)}′ × ${Math.round(h)}′</text>`;
      }
    }
    // outer walls, glass and front door
    s += `<rect x="0" y="0" width="${a}" height="${d}" fill="none" stroke="#e9edf5" stroke-width="${(sw * 2.2).toFixed(3)}"/>`;
    s += `<line x1="0" y1="0" x2="${a}" y2="0" stroke="#8fd3ff" stroke-width="${(sw * 4).toFixed(3)}"/>`;
    if (c.s0) s += `<line x1="0" y1="0" x2="0" y2="${d}" stroke="#8fd3ff" stroke-width="${(sw * 4).toFixed(3)}"/>`;
    if (c.s1) s += `<line x1="${a}" y1="0" x2="${a}" y2="${d}" stroke="#8fd3ff" stroke-width="${(sw * 4).toFixed(3)}"/>`;
    const door = p.rooms.find(x => x.type === 'entry') || p.rooms.find(x => ['studio', 'living', 'kitchen'].includes(x.type) && x.r[3] > d - 0.01);
    if (door) { const cx = (door.r[0] + door.r[2]) / 2; s += `<rect x="${cx - 1.5}" y="${d - sw * 2}" width="3" height="${sw * 4}" fill="#f5b942"/>`; }
    if (!small) {
      s += `<text x="${a / 2}" y="${-1.4}" class="dgEdge" font-size="${fs * 0.85}">WINDOW WALL</text>`;
      s += `<text x="${a / 2}" y="${d + 2.2}" class="dgEdge" font-size="${fs * 0.85}">CORRIDOR${door ? ' · front door' : ''}</text>`;
      s += `<rect x="0" y="${d + 3.4}" width="10" height="${sw * 2}" fill="#8f9ab0"/><text x="11" y="${d + 3.4 + fs * 0.45}" class="dgDim" font-size="${fs * 0.8}" text-anchor="start">10 ft</text>`;
    }
    return s + '</svg>';
  }
  // Positions (along the window wall, in the merged home's frame) where the original homes met.
  function joinsOf(b, idxs, c) {
    if (idxs.length < 2) return [];
    const L = b.plan.L, hor = c.win === 'n' || c.win === 's', s0 = hor ? 0 : 1, s1 = hor ? 2 : 3;
    const us = idxs.map(i => L.units[i]).sort((p, q) => p.r[s0] - q.r[s0]), out = [];
    for (let k = 0; k < us.length - 1; k++) {
      const e = us[k].r[s1];   // plate coordinate of the shared wall; map it to u in the home's frame (see H.contextRect)
      const u = c.win === 'n' ? e - c.r[0] : c.win === 's' ? c.r[2] - e : c.win === 'w' ? c.r[3] - e : e - c.r[1];
      out.push(u);
    }
    return out;
  }

  // ---------- preferences ----------
  function prefs() {
    const v = id => $(id).value;
    return { beds: v('dgBeds') === '' ? null : +v('dgBeds'), baths: v('dgBaths') === '' ? null : +v('dgBaths'), wfh: $('dgWfh').checked, acc: $('dgAcc').checked };
  }
  function setPrefs(p) {
    $('dgBeds').value = p.beds == null ? '' : String(p.beds); $('dgBaths').value = p.baths == null ? '' : String(p.baths);
    $('dgWfh').checked = !!p.wfh; $('dgAcc').checked = !!p.acc;
  }

  // ---------- render ----------
  function render() {
    if (!cur) return;
    const b = cur.b;
    if (!LW.B || !LW.B.includes(b)) return close();
    const L = b.plan.L, h = resolve(b, cur.sigs);
    if (h.error || b.plan.lw !== cur.lw) {
      $('dgTitle').textContent = `${b.label} · design a home`; $('dgSub').textContent = '';
      $('dgBody').innerHTML = `<div class="note">${h.error && h.error !== 'changed' ? esc(h.error)
        : 'The floor layout changed (window distance, lightwell or a data correction), so this home no longer exists. Go back to the floor plate and pick a home again.'}</div>`;
      return;
    }
    const { idxs, un, c } = h, merged = idxs.length > 1, n = LW.eff(b, 'floors'), f = Math.min(Math.max(cur.floor, 2), n);
    cur.floor = f;
    const st = floorStatus(b, f), sk = sky(b, L, un, f), ten = (b.tenants || []).filter(t => (t.floors || []).includes(f));
    $('dgTitle').textContent = `${b.label} · floor ${f} · ${homeName(idxs)}`;
    $('dgSub').textContent = ` ${Math.round(c.a)} × ${Math.round(c.d)} ft · ${fmt(c.sqft)} sq ft · windows face ${facing(b, un)}${c.s0 || c.s1 ? ' + corner' : ''}`;
    const res = H.design(c, prefs()), opts = res.options;
    let p = opts.find(o => keyOf(o) === cur.key) || opts[0];
    cur.key = p ? keyOf(p) : null;
    // floor picker: every floor above the lobby, with its status
    const fopts = []; for (let k = 2; k <= n; k++) { const s2 = floorStatus(b, k); fopts.push(`<option value="${k}" ${k === f ? 'selected' : ''}>Floor ${k}${s2.k === 'unknown' ? '' : ' · ' + s2.text}</option>`); }
    $('dgFloor').innerHTML = fopts.join('');
    const facts = `<div class="dgFacts">
      ${merged ? `<div class="dgMerged">Merged home: ${idxs.length} homes from the floor plate (${idxs.map(i => fmt(L.units[i].a) + ' sq ft').join(' + ')}) become one. The red dotted line${idxs.length > 2 ? 's show' : ' shows'} the old party wall${idxs.length > 2 ? 's' : ''} that would come down. The floor then has ${idxs.length - 1} fewer home${idxs.length > 2 ? 's' : ''}.</div>` : ''}
      <div><span class="dgPill ${st.k}">${st.k === 'unknown' ? 'Floor occupancy unknown' : 'Floor ' + f + ' ' + st.text}</span> ${srcTag(b, 'vacant')}
        ${ten.length ? `<span class="muted"> · ${ten.length} tenant${ten.length > 1 ? 's' : ''}: ${ten.slice(0, 3).map(t => esc(t.name) + (t.lease_end ? ' (to ' + esc(t.lease_end) + ')' : '')).join(', ')}${ten.length > 3 ? '…' : ''}. Design for later, once they move.</span>` : st.k === 'leased' ? '<span class="muted"> · design for later, once the floor is free.</span>' : ''}</div>
      <div class="${sk.ok === false ? 'dgWarn' : 'muted'}">${sk.ok === true ? '☀ ' : sk.ok === false ? '◐ ' : ''}${esc(sk.text)}</div>
      <div class="muted">Home from the floor plate: plate ${srcTag(b, 'plate')} · core ${srcTag(b, 'core')}${b.irregular ? ' · <b>irregular footprint simplified to a rectangle</b>' : ''}</div></div>`;
    if (!p) {
      $('dgBody').innerHTML = facts + `<div class="note dgNone"><b>No plan fits with these choices.</b><br>${res.reasons.map(esc).join('<br>')}</div>`;
      bindEv(b); return;
    }
    const cards = opts.map(o => `<button class="dgOpt ${keyOf(o) === cur.key ? 'on' : ''}" data-k="${esc(keyOf(o))}">${planSvg(c, o, true)}
      <span class="dgOptT"><b>${esc(o.title)}</b> <small>${esc(o.sub)}</small>
      <small>score ${o.score} · ${o.habPct}% living space${o.costDelta ? ` · +$${Math.round(o.costDelta / 1000)}k fit-out` : ''}</small>
      ${o.badges.length ? `<span class="dgBadges">${o.badges.map(x => `<i>${esc(x)}</i>`).join('')}</span>` : ''}</span></button>`).join('');
    const rows = p.rooms.filter(x => x.type !== 'hall').map(x => {
      const w = x.r[2] - x.r[0], hh = x.r[3] - x.r[1], win = x.r[1] < 0.01 || (c.s0 && x.r[0] < 0.01) || (c.s1 && x.r[2] > c.a - 0.01);
      return `<tr><td>${esc(x.label)}</td><td>${Math.round(w)}′ × ${Math.round(hh)}′</td><td>${fmt(w * hh)}</td><td>${win ? 'yes' : '—'}</td></tr>`; }).join('');
    const saved = (LW.designs[b.id] || []);
    const live = s => s.lw === b.plan.lw && !resolve(b, s.sigs).error;
    $('dgBody').innerHTML = facts + `
      <div class="dgMain"><div class="dgDraw">${planSvg(c, p, false, joinsOf(b, idxs, c))}</div><div class="dgOpts">${cards}</div></div>
      <div class="dgCols">
        <div><h4>Rooms</h4><table class="kv grid"><tr><td>Room</td><td>Size</td><td>Sq ft</td><td>Window</td></tr>${rows}</table></div>
        <div><h4>Checks</h4><ul class="dgChecks">${p.checks.map(([t, ok]) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '—'} ${esc(t)}</li>`).join('')}</ul>
          <h4>Notes</h4><ul class="dgChecks">${p.notes.concat(merged ? ['Merging removes a party wall and a front door; check the wall is not structural'] : []).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
      </div>
      <div class="dgSave">Use this plan for ${homeName(idxs)} on floors <input id="dgFrom" type="number" min="2" max="${n}" value="${f}"> to <input id="dgTo" type="number" min="2" max="${n}" value="${f}">
        <button id="dgSaveBtn" class="primary">Save design</button></div>
      ${saved.length ? `<h4>Saved designs for ${esc(b.label)} <small class="muted">(this session only; they don't change the score or the memo)</small></h4>
        <div class="dgSaved">${saved.map((s, k) => `<div><span>${cap(homeName(s.units))} · <b>${esc(s.title)}</b> ${esc(s.sub)} · floors ${s.floors[0]}–${s.floors[1]} (${s.floors[1] - s.floors[0] + 1} home${s.floors[1] > s.floors[0] ? 's' : ''})${live(s) ? '' : ' · <i>layout changed</i>'}</span>
          <span><button data-show="${k}">Show</button><button data-del="${k}">Remove</button></span></div>`).join('')}</div>` : ''}`;
    $('dgBody').querySelectorAll('.dgOpt').forEach(el => el.onclick = () => { cur.key = el.dataset.k; render(); });
    $('dgSaveBtn').onclick = () => {
      let a = Math.round(+$('dgFrom').value), z = Math.round(+$('dgTo').value);
      if (!(a >= 2 && z >= 2 && a <= n && z <= n)) { LW.toast(`Floors must be 2–${n}`); return; }
      if (a > z) [a, z] = [z, a];
      const list = LW.designs[b.id] || (LW.designs[b.id] = []);
      // a home can hold one design per floor: replace saved designs that share a home and a floor with this one
      const clash = s => s.lw === cur.lw && s.sigs.some(x => cur.sigs.includes(x)) && !(z < s.floors[0] || a > s.floors[1]);
      const dropped = list.filter(clash).length;
      LW.designs[b.id] = list.filter(s => !clash(s));
      LW.designs[b.id].push({ sigs: cur.sigs.slice(), lw: cur.lw, units: idxs, floors: [a, z], key: cur.key, title: p.title, sub: p.sub, beds: p.beds, baths: p.baths, prefs: prefs() });
      LW.toast(`Saved: ${p.title} on floors ${a}–${z}${dropped ? ` (replaced ${dropped} earlier design${dropped > 1 ? 's' : ''})` : ''}`); render();
    };
    $('dgBody').querySelectorAll('[data-del]').forEach(el => el.onclick = () => { saved.splice(+el.dataset.del, 1); render(); });
    $('dgBody').querySelectorAll('[data-show]').forEach(el => el.onclick = () => {
      const s = saved[+el.dataset.show]; if (!live(s)) { LW.toast('That home no longer exists in this layout'); return; }
      cur.sigs = s.sigs.slice(); cur.floor = s.floors[0]; cur.key = s.key; setPrefs(s.prefs || {}); render(); });
    bindEv(b);
  }
  function bindEv(b) { $('dgBody').querySelectorAll('[data-ev]').forEach(el => el.onclick = () => LW.evidence(b, el.dataset.ev)); }

  // ---------- open / close ----------
  // idxs: one home index, or several neighbouring homes to merge (indexes into b.plan.L.units)
  function open(b, idxs) {
    idxs = Array.isArray(idxs) ? idxs : [idxs];
    const L = b.plan.L; if (!idxs.length || idxs.some(i => !L.units[i])) return;
    if (idxs.length > 1) { const m = H.merge(L, idxs); if (!m.ok) { LW.toast(m.reason); return; } }
    cur = { b, sigs: idxs.map(i => H.sig(L.units[i].r)), lw: b.plan.lw, floor: defaultFloor(b), key: null };
    $('plateBox').style.display = 'none'; $('evidence').style.display = 'none'; $('designBox').style.display = 'block';
    render();
  }
  function close() { cur = null; $('designBox').style.display = 'none'; }
  $('dgClose').onclick = close;
  $('dgBack').onclick = () => { const b = cur && cur.b; close(); if (b && LW.selected === b) LW.openPlate(b); };
  $('dgFloor').onchange = () => { if (cur) { cur.floor = +$('dgFloor').value; render(); } };
  ['dgBeds', 'dgBaths', 'dgWfh', 'dgAcc'].forEach(id => $(id).onchange = () => { if (cur) { cur.key = null; render(); } });
  const ask = () => { const t = $('dgAsk').value; if (!t.trim()) return; setPrefs(H.parse(t, {})); if (cur) { cur.key = null; render(); } };
  $('dgAskGo').onclick = ask; $('dgAsk').onkeydown = e => { if (e.key === 'Enter') ask(); };

  // From the tower card: open the floor plate and say what to do next.
  function start(b) { close(); LW.openPlate(b); LW.toast('Click any home on the floor plate to design it'); }

  // ---------- picking homes on the floor plate (for a merge) ----------
  function pickedIdxs(b) { const L = b.plan.L; return pick.sigs.map(s => L.units.findIndex(u => H.sig(u.r) === s)).filter(i => i >= 0); }
  function togglePick(b, i) {
    const s = H.sig(b.plan.L.units[i].r), k = pick.sigs.indexOf(s);
    if (k >= 0) pick.sigs.splice(k, 1);
    else if (pick.sigs.length >= H.MAX_MERGE) { LW.toast(`Merge at most ${H.MAX_MERGE} homes into one`); return; }
    else pick.sigs.push(s);
    LW.openPlate(b);
  }
  function clearPick(b) { pick.sigs = []; if (b) LW.openPlate(b); }

  // Called at the end of openPlate (ui.js): remember where the plate was drawn, mark picked homes and saved designs,
  // and add the hint and merge controls under the plate.
  function afterPlate(b, g, geo) {
    if (cur) close();   // the floor plate and the designer share the same spot on screen
    LW.plateGeom = { b, ...geo };
    if (pick.idx !== b.idx || pick.lw !== b.plan.lw) { pick.idx = b.idx; pick.lw = b.plan.lw; pick.sigs = []; }
    const L = b.plan.L, P = r => [geo.ox + r[0] * geo.sc, geo.oy + r[1] * geo.sc, (r[2] - r[0]) * geo.sc, (r[3] - r[1]) * geo.sc];
    pick.sigs = pick.sigs.filter(s => L.units.some(u => H.sig(u.r) === s));
    const sel = pickedIdxs(b), m = sel.length >= 2 ? H.merge(L, sel) : null;
    g.save();
    // picked homes: gold fill and outline; a valid merge: one dashed outline around the whole new home
    for (const i of sel) { const [x, y, w, h] = P(L.units[i].r); g.fillStyle = 'rgba(245,185,66,.28)'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#f5b942'; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4); }
    if (m && m.ok) { const [x, y, w, h] = P(m.r); g.setLineDash([12, 7]); g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.strokeRect(x - 3, y - 3, w + 6, h + 6); g.setLineDash([]); }
    // saved designs: a badge on each designed home (or merged home)
    const list = (LW.designs[b.id] || []).filter(s => s.lw === b.plan.lw);
    g.font = 'bold 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of list) {
      const h = resolve(b, s.sigs); if (h.error) continue;
      const [x, y, w, hh] = P(h.r), cx = x + w / 2, cy = y + hh / 2, t = `${s.title} ✓`, tw = g.measureText(t).width + 10;
      g.fillStyle = 'rgba(10,14,24,.85)'; g.fillRect(cx - tw / 2, cy - 10, tw, 20); g.fillStyle = '#f5b942'; g.fillText(t, cx, cy + 1);
    }
    g.restore();
    const pf = LW.pickedFloor && LW.pickedFloor.idx === b.idx ? LW.pickedFloor.f : null;
    let html = `<div class="dgHint">Click a home to design it${pf ? ` (floor ${pf})` : ''}. <b>Shift+click</b> neighbouring homes to merge them into one.
      <button id="dgPickMode" class="${pick.mode ? 'on' : ''}" title="Click homes to pick them, without holding Shift">Select several: ${pick.mode ? 'on' : 'off'}</button>${list.length ? ` · ${list.length} saved design${list.length > 1 ? 's' : ''} marked ✓` : ''}</div>`;
    if (sel.length) {
      const what = sel.length === 1 ? 'Pick one or two neighbouring homes on the same wall to merge with it.'
        : m.ok ? (mc => `Together: one ${Math.round(mc.a)} × ${Math.round(mc.d)} ft home, ${fmt(mc.sqft)} sq ft.`)(H.contextRect(b, m.r, m.win, m.court))
        : m.reason;
      html += `<div class="dgSel ${sel.length >= 2 && !m.ok ? 'bad' : ''}"><span>Picked: ${sel.map(i => 'home ' + (i + 1)).join(', ')} · ${esc(what)}</span>
        <span><button id="dgMerge" class="primary" ${m && m.ok ? '' : 'disabled'}>Merge and design</button><button id="dgClearSel">Clear</button></span></div>`;
    }
    $('plateStats').insertAdjacentHTML('beforeend', html);
    $('dgPickMode').onclick = () => { pick.mode = !pick.mode; if (!pick.mode) pick.sigs = []; LW.openPlate(b); };
    if ($('dgMerge')) $('dgMerge').onclick = () => { const s = pickedIdxs(b); pick.sigs = []; open(b, s); };
    if ($('dgClearSel')) $('dgClearSel').onclick = () => clearPick(b);
  }

  // Which home is under the mouse on the floor plate canvas (index into b.plan.L.units, or -1).
  function hit(e) {
    const g = LW.plateGeom; if (!g || g.b !== LW.selected) return -1;
    const cv = $('plate'), rc = cv.getBoundingClientRect();
    const x = ((e.clientX - rc.left) * cv.width / rc.width - g.ox) / g.sc, y = ((e.clientY - rc.top) * cv.height / rc.height - g.oy) / g.sc;
    return g.b.plan.L.units.findIndex(u => x >= u.r[0] && x <= u.r[2] && y >= u.r[1] && y <= u.r[3]);
  }
  $('plate').addEventListener('click', e => {
    const i = hit(e); if (i < 0) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || pick.mode) togglePick(LW.selected, i);
    else open(LW.selected, [i]);
  });
  $('plate').addEventListener('mousemove', e => { const i = hit(e); $('plate').style.cursor = i >= 0 ? 'pointer' : '';
    $('plate').title = i < 0 ? '' : pick.mode ? `Home ${i + 1}: click to pick it for a merge` : `Home ${i + 1}: click to design it, Shift+click to pick it for a merge`; });

  // Keep the panel in step with the rest of the page: another tower closes it; a re-score re-checks the home.
  const onSelect0 = LW.onSelect;
  LW.onSelect = function (b) { if (cur && b !== cur.b) close(); const r = onSelect0.apply(this, arguments); if (cur) render(); return r; };
  const refresh0 = LW.refresh;
  LW.refresh = function () { const r = refresh0.apply(this, arguments); if (cur) render(); return r; };

  LW.designer = { open, close, start, afterPlate, render, isOpen: () => !!cur, pick };
})();
