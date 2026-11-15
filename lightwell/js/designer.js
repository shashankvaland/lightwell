// Home designer panel: click a home on the floor plate and get 3-5 concept plans for it (plans from js/homes.js).
// Read-only: saved designs live in LW.designs for this browser session and never change a tower's score, the agent's
// review, the memo or the CSV. Floor facts (empty or leased, tenants, sky view) come from the data already loaded.
(function () {
  const LW = window.LW, H = LW.homes, $ = id => document.getElementById(id);
  const esc = s => LW.esc(s), fmt = n => LW.fmt(n), ft = x => Math.round(x * 10) / 10;
  LW.designs = {};   // tower id -> [{ sig, lw, unit, floors: [from, to], key, title, sub, beds, baths }]
  let cur = null;    // { b, sig, lw, floor, key }
  const FILL = { studio: '#f5b942', living: '#f5b942', bed: '#7fb8ff', kitchen: '#3cc6b4', bath: '#8fd3ff', entry: '#8f9ab0',
    hall: '#6b7590', closet: '#566079', laundry: '#566079', storage: '#465068', den: '#ba8cff' };
  const keyOf = p => `${p.beds}|${p.baths}|${p.kitchen}|${p.den}|${p.pos === 'split'}`;

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
    return out.length ? `<g class="dgFurn" stroke-width="${s}">${out.join('')}</g>` : '';
  }
  function planSvg(c, p, small) {
    const a = c.a, d = c.d, pad = small ? 1 : 3, top = small ? 1 : 4, bot = small ? 1 : 5, sw = Math.max(a, d) / (small ? 60 : 160);
    const fs = Math.max(0.85, Math.min(1.35, Math.min(a, d) / 20));
    let s = `<svg viewBox="${-pad} ${-top} ${a + 2 * pad} ${d + top + bot}" class="${small ? 'dgThumb' : 'dgSvg'}" role="img" aria-label="${esc(p.title + ' ' + p.sub)}">`;
    for (const x of p.rooms) {
      const [u0, v0, u1, v1] = x.r;
      s += `<rect x="${u0}" y="${v0}" width="${u1 - u0}" height="${v1 - v0}" fill="${FILL[x.type] || '#566079'}" fill-opacity="${small ? 0.45 : 0.22}" stroke="#e9edf5" stroke-width="${sw}"/>`;
    }
    if (!small) {
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
    s += `<rect x="0" y="0" width="${a}" height="${d}" fill="none" stroke="#e9edf5" stroke-width="${sw * 2.2}"/>`;
    s += `<line x1="0" y1="0" x2="${a}" y2="0" stroke="#8fd3ff" stroke-width="${sw * 4}"/>`;
    if (c.s0) s += `<line x1="0" y1="0" x2="0" y2="${d}" stroke="#8fd3ff" stroke-width="${sw * 4}"/>`;
    if (c.s1) s += `<line x1="${a}" y1="0" x2="${a}" y2="${d}" stroke="#8fd3ff" stroke-width="${sw * 4}"/>`;
    const door = p.rooms.find(x => x.type === 'entry') || p.rooms.find(x => ['studio', 'living', 'kitchen'].includes(x.type) && x.r[3] > d - 0.01);
    if (door) { const cx = (door.r[0] + door.r[2]) / 2; s += `<rect x="${cx - 1.5}" y="${d - sw * 2}" width="3" height="${sw * 4}" fill="#f5b942"/>`; }
    if (!small) {
      s += `<text x="${a / 2}" y="${-1.4}" class="dgEdge" font-size="${fs * 0.85}">WINDOW WALL</text>`;
      s += `<text x="${a / 2}" y="${d + 2.2}" class="dgEdge" font-size="${fs * 0.85}">CORRIDOR${door ? ' · front door' : ''}</text>`;
      s += `<rect x="0" y="${d + 3.4}" width="10" height="${sw * 2}" fill="#8f9ab0"/><text x="11" y="${d + 3.4 + fs * 0.45}" class="dgDim" font-size="${fs * 0.8}" text-anchor="start">10 ft</text>`;
    }
    return s + '</svg>';
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
    const L = b.plan.L, i = L.units.findIndex(u => H.sig(u.r) === cur.sig);
    if (i < 0 || b.plan.lw !== cur.lw) {
      $('dgTitle').textContent = `${b.label} · design a home`; $('dgSub').textContent = '';
      $('dgBody').innerHTML = '<div class="note">The floor layout changed (window distance, lightwell or a data correction), so this home no longer exists. Go back to the floor plate and pick a home again.</div>';
      return;
    }
    const un = L.units[i], c = H.context(b, L, i), n = LW.eff(b, 'floors'), f = Math.min(Math.max(cur.floor, 2), n);
    cur.floor = f;
    const st = floorStatus(b, f), sk = sky(b, L, un, f), ten = (b.tenants || []).filter(t => (t.floors || []).includes(f));
    $('dgTitle').textContent = `${b.label} · floor ${f} · home ${i + 1}`;
    $('dgSub').textContent = ` ${Math.round(c.a)} × ${Math.round(c.d)} ft · ${fmt(c.sqft)} sq ft · windows face ${facing(b, un)}${c.s0 || c.s1 ? ' + corner' : ''}`;
    const res = H.design(c, prefs()), opts = res.options;
    let p = opts.find(o => keyOf(o) === cur.key) || opts[0];
    cur.key = p ? keyOf(p) : null;
    // floor picker: every floor above the lobby, with its status
    const fopts = []; for (let k = 2; k <= n; k++) { const s2 = floorStatus(b, k); fopts.push(`<option value="${k}" ${k === f ? 'selected' : ''}>Floor ${k}${s2.k === 'unknown' ? '' : ' · ' + s2.text}</option>`); }
    $('dgFloor').innerHTML = fopts.join('');
    const facts = `<div class="dgFacts">
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
      const w = x.r[2] - x.r[0], h = x.r[3] - x.r[1], win = x.r[1] < 0.01 || (c.s0 && x.r[0] < 0.01) || (c.s1 && x.r[2] > c.a - 0.01);
      return `<tr><td>${esc(x.label)}</td><td>${Math.round(w)}′ × ${Math.round(h)}′</td><td>${fmt(w * h)}</td><td>${win ? 'yes' : '—'}</td></tr>`; }).join('');
    const saved = (LW.designs[b.id] || []);
    $('dgBody').innerHTML = facts + `
      <div class="dgMain"><div class="dgDraw">${planSvg(c, p, false)}</div><div class="dgOpts">${cards}</div></div>
      <div class="dgCols">
        <div><h4>Rooms</h4><table class="kv grid"><tr><td>Room</td><td>Size</td><td>Sq ft</td><td>Window</td></tr>${rows}</table></div>
        <div><h4>Checks</h4><ul class="dgChecks">${p.checks.map(([t, ok]) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '—'} ${esc(t)}</li>`).join('')}</ul>
          <h4>Notes</h4><ul class="dgChecks">${p.notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
      </div>
      <div class="dgSave">Use this plan for home ${i + 1} on floors <input id="dgFrom" type="number" min="2" max="${n}" value="${f}"> to <input id="dgTo" type="number" min="2" max="${n}" value="${f}">
        <button id="dgSaveBtn" class="primary">Save design</button></div>
      ${saved.length ? `<h4>Saved designs for ${esc(b.label)} <small class="muted">(this session only; they don't change the score or the memo)</small></h4>
        <div class="dgSaved">${saved.map((s, k) => `<div><span>Home ${s.unit + 1} · <b>${esc(s.title)}</b> ${esc(s.sub)} · floors ${s.floors[0]}–${s.floors[1]} (${s.floors[1] - s.floors[0] + 1} home${s.floors[1] > s.floors[0] ? 's' : ''})${s.lw !== b.plan.lw || !L.units.some(u => H.sig(u.r) === s.sig) ? ' · <i>layout changed</i>' : ''}</span>
          <span><button data-show="${k}">Show</button><button data-del="${k}">Remove</button></span></div>`).join('')}</div>` : ''}`;
    $('dgBody').querySelectorAll('.dgOpt').forEach(el => el.onclick = () => { cur.key = el.dataset.k; render(); });
    $('dgSaveBtn').onclick = () => {
      let a = Math.round(+$('dgFrom').value), z = Math.round(+$('dgTo').value);
      if (!(a >= 2 && z >= 2 && a <= n && z <= n)) { LW.toast(`Floors must be 2–${n}`); return; }
      if (a > z) [a, z] = [z, a];
      const list = LW.designs[b.id] || (LW.designs[b.id] = []);
      const prev = list.findIndex(s => s.sig === cur.sig && s.lw === cur.lw && !(z < s.floors[0] || a > s.floors[1]));
      const rec = { sig: cur.sig, lw: cur.lw, unit: i, floors: [a, z], key: cur.key, title: p.title, sub: p.sub, beds: p.beds, baths: p.baths, prefs: prefs() };
      if (prev >= 0) list[prev] = rec; else list.push(rec);
      LW.toast(`Saved: ${p.title} on floors ${a}–${z}`); render();
    };
    $('dgBody').querySelectorAll('[data-del]').forEach(el => el.onclick = () => { saved.splice(+el.dataset.del, 1); render(); });
    $('dgBody').querySelectorAll('[data-show]').forEach(el => el.onclick = () => {
      const s = saved[+el.dataset.show]; if (s.lw !== b.plan.lw || !L.units.some(u => H.sig(u.r) === s.sig)) { LW.toast('That home no longer exists in this layout'); return; }
      cur.sig = s.sig; cur.floor = s.floors[0]; cur.key = s.key; setPrefs(s.prefs || {}); render(); });
    bindEv(b);
  }
  function bindEv(b) { $('dgBody').querySelectorAll('[data-ev]').forEach(el => el.onclick = () => LW.evidence(b, el.dataset.ev)); }

  // ---------- open / close ----------
  function open(b, i) {
    const un = b.plan.L.units[i]; if (!un) return;
    cur = { b, sig: H.sig(un.r), lw: b.plan.lw, floor: defaultFloor(b), key: null };
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

  // Called at the end of openPlate (ui.js): remember where the plate was drawn, mark saved designs, add a hint.
  function afterPlate(b, g, geo) {
    if (cur) close();   // the floor plate and the designer share the same spot on screen
    LW.plateGeom = { b, ...geo };
    const L = b.plan.L, list = (LW.designs[b.id] || []).filter(s => s.lw === b.plan.lw);
    g.save(); g.font = 'bold 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of list) {
      const un = L.units.find(u => H.sig(u.r) === s.sig); if (!un) continue;
      const cx = geo.ox + (un.r[0] + un.r[2]) / 2 * geo.sc, cy = geo.oy + (un.r[1] + un.r[3]) / 2 * geo.sc, t = `${s.title} ✓`;
      const w = g.measureText(t).width + 10;
      g.fillStyle = 'rgba(10,14,24,.85)'; g.fillRect(cx - w / 2, cy - 10, w, 20); g.fillStyle = '#f5b942'; g.fillText(t, cx, cy + 1);
    }
    g.restore();
    const pf = LW.pickedFloor && LW.pickedFloor.idx === b.idx ? LW.pickedFloor.f : null;
    $('plateStats').insertAdjacentHTML('beforeend', `<div class="dgHint">Click any home to design it${pf ? ` (floor ${pf})` : ''}.${list.length ? ` ${list.length} saved design${list.length > 1 ? 's' : ''} marked ✓.` : ''}</div>`);
  }

  // Which home is under the mouse on the floor plate canvas (index into b.plan.L.units, or -1).
  function hit(e) {
    const g = LW.plateGeom; if (!g || g.b !== LW.selected) return -1;
    const cv = $('plate'), rc = cv.getBoundingClientRect();
    const x = ((e.clientX - rc.left) * cv.width / rc.width - g.ox) / g.sc, y = ((e.clientY - rc.top) * cv.height / rc.height - g.oy) / g.sc;
    return g.b.plan.L.units.findIndex(u => x >= u.r[0] && x <= u.r[2] && y >= u.r[1] && y <= u.r[3]);
  }
  $('plate').addEventListener('click', e => { const i = hit(e); if (i >= 0) open(LW.selected, i); });
  $('plate').addEventListener('mousemove', e => { const i = hit(e); $('plate').style.cursor = i >= 0 ? 'pointer' : ''; $('plate').title = i >= 0 ? `Home ${i + 1}: click to design it` : ''; });

  // Keep the panel in step with the rest of the page: another tower closes it; a re-score re-checks the home.
  const onSelect0 = LW.onSelect;
  LW.onSelect = function (b) { if (cur && b !== cur.b) close(); const r = onSelect0.apply(this, arguments); if (cur) render(); return r; };
  const refresh0 = LW.refresh;
  LW.refresh = function () { const r = refresh0.apply(this, arguments); if (cur) render(); return r; };

  LW.designer = { open, close, start, afterPlate, render, isOpen: () => !!cur };
})();
