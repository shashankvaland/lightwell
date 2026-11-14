// Panels, building card, floor-plate drawing, corrections, assumptions, exports, view switching.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString(), money = n => isFinite(n) ? '$' + Math.round(n / 1000) + 'k' : '—', pct = x => Math.round(x * 100) + '%';
  Object.assign(LW, { fmt, money, pct });
  LW.scored = false; LW.flagsShown = false; LW.selected = null;

  // ---------- startup ----------
  LW.start = async function () {
    LW.geo = window.HOUSTON_GEOJSON;
    if (!LW.geo) { $('run').textContent = 'Building data not found'; return; }
    LW.B = LW.buildCandidates(LW.geo);
    LW.byOsm = new Map(LW.B.map(b => [b.osmId, b]));
    $('kCand').textContent = LW.B.length;
    if (LW.real) {
      const n = k => LW.B.filter(b => b.real[k]).length;
      $('dataNote').innerHTML = `<b>Real:</b> footprints and heights (OpenStreetMap); <b>${n('market')}</b> towers with CoStar data, <b>${n('aerial')}</b> with Vexcel parking counts, <b>${n('interior')}</b> with Matterport plates (imported ${LW.real.generated.replace('T', ' ')}).<br>
        <b>Simulated:</b> everything else, tagged SIMULATED. Towers without real market data keep their HOU-xx code.`;
    }
    LW.view = LW.views.map; LW.views.map.show(true); LW.views.g3d.show(false);
    labels(); buildAssumptions();
    await LW.views.map.init();
    LW.agent.checkBackend();
  };

  // ---------- recompute + paint ----------
  LW.analyzeAll = function () { LW.B.forEach(LW.analyze); LW.refresh(); };
  LW.refresh = function () {
    LW.B.forEach(b => LW.view.paint(b));
    LW.view.setFlags(LW.flagsShown ? LW.B.filter(b => b.phantom) : []);
    totals(); renderRanking();
    if (LW.selected) { renderCard(LW.selected); if ($('plateBox').style.display === 'block') openPlate(LW.selected); }
  };
  function totals() {
    if (!LW.scored) return;
    const pass = LW.B.filter(b => b.pass);
    $('kHomes').textContent = fmt(pass.reduce((s, b) => s + b.plan.homes, 0));
    $('kCo2').textContent = fmt(pass.reduce((s, b) => s + b.plan.carbon, 0) / 1000) + 'k';
    $('kFlags').textContent = LW.B.filter(b => b.phantom).length;
    $('exports').style.display = 'flex';
  }
  function renderRanking() {
    if (!LW.scored) return;
    const list = [...LW.B].sort((a, b) => (b.pass - a.pass) || (b.score - a.score)).slice(0, 15);
    $('ranking').innerHTML = list.map(b => `<div class="rank ${LW.selected === b ? 'sel' : ''}" data-i="${b.idx}">
      <span class="sc" style="background:${LW.hex(LW.scoreRGB(b.score))}">${b.score}</span>
      <span class="nm"><b>${b.label}</b> · ${LW.eff(b, 'floors')} floors${b.real.market ? ' <span class="realdot" title="Real CoStar data">◆</span>' : ''} ${b.phantom ? '<span class="flag">⚑</span>' : ''}${b.plan.safety.status !== 'ok' ? `<span class="fs ${b.plan.safety.status}">●</span>` : ''}
      <small>${b.pass ? fmt(b.plan.homes) + ' homes · ' + money(b.plan.cpu) + '/home' : (b.plan.safety.status === 'fail' ? 'Fails fire-safety screen' : 'Over cap · ' + money(b.plan.cpu) + '/home')}${b.plan.lw ? ' · lightwell' : ''}</small></span></div>`).join('');
    $('ranking').querySelectorAll('.rank').forEach(el => el.onclick = () => LW.onSelect(LW.B[+el.dataset.i], true));
  }

  // ---------- selection + card ----------
  LW.onSelect = function (b, fly) {
    const prev = LW.selected; LW.selected = b;
    LW.view.select(b, prev); renderRanking();
    if (!b) { $('card').style.display = 'none'; $('plateBox').style.display = 'none'; return; }
    if (b.plan == null) LW.analyze(b);
    renderCard(b); if ($('plateBox').style.display === 'block') openPlate(b);
    if (fly) LW.view.fly(b);
  };
  const tag = (t, c, x) => `<div class="find"><span class="tag ${c}">${t}</span><span>${x}</span></div>`;
  const src = (b, k, layer, cls) => b.overrides[k] != null ? ['YOU', 't-you'] : [layer, cls];
  // which layer a value came from: real CoStar / Vexcel / Matterport, or the simulated stand-in
  const mk = b => b.real.market ? ['COSTAR', 't-cs'] : ['SIMULATED', 't-sim'];
  function renderCard(b) {
    const p = b.plan, s = p.safety, col = LW.hex(LW.scoreRGB(b.score ?? 0)), A = LW.A;
    const [repT, repC] = src(b, 'rep', ...mk(b)), [yrT, yrC] = src(b, 'year', ...mk(b));
    const [f2T, f2C] = src(b, 'f2f', ...(b.real.interior ? ['MATTERPORT', 't-mp'] : ['OSM', 't-osm']));
    const safeTxt = { ok: 'Passes the screen', check: 'Needs design work', fail: 'Fails the screen' }[s.status];
    const layers = ['market', 'aerial', 'interior'].filter(k => b.real[k]);
    const parkTxt = b.real.aerial ? `Parking ${b.obs.map((x, i) => `${pct(x)} (${b.obsDates[i]})`).join(' / ')} full`
      : `Vexcel stand-in: parking ${b.obs.map(pct).join(' / ')} full`;
    $('card').style.display = 'block';
    $('card').innerHTML = `<h3>${b.label}${b.label !== b.id ? ` <small style="color:var(--muted)">${b.id}</small>` : ''}</h3>
      <div class="meta">${layers.length ? `Real ${layers.map(k => ({ market: 'CoStar', aerial: 'Vexcel', interior: 'Matterport' })[k]).join(' + ')} data${b.costarId ? ' · CoStar ' + b.costarId : ''}`
        : 'Real footprint and height · market data simulated'}${b.owner ? ' · ' + b.owner : ''}</div>
      <div style="display:flex;justify-content:space-between"><span>Conversion score</span><b>${b.score ?? '–'}/100</b></div>
      <div class="bar"><i style="width:${b.score ?? 0}%;background:${col}"></i></div>
      <div class="big"><div><b>${fmt(p.homes)}</b><span>homes (${p.mix[0]} studio · ${p.mix[1]} 1-bed · ${p.mix[2]} 2-bed)</span></div>
        <div><b>${money(p.cpu)}</b><span>per home vs ~${money(A.newBuildPerHome)} new build</span></div>
        <div><b>${pct(p.daylitFrac)}</b><span>of each floor within ${LW.S.u} ft of a window</span></div>
        <div><b>${fmt(p.carbon)} t</b><span>CO₂e embodied carbon avoided</span></div></div>
      ${tag(b.heightSrc === 'costar-floors' ? 'COSTAR' : 'OSM', b.heightSrc === 'costar-floors' ? 't-cs' : 't-osm', `Height ${b.heightM} m · ${LW.eff(b, 'floors')} floors`)}
      ${b.real.interior ? tag('MATTERPORT', 't-mp', `Floor plate ${b.W} × ${b.D} ft${b.core ? ', core from the scan' : ''}${b.modelId ? ' · model ' + b.modelId : ''}`)
        : tag(b.irregular ? 'ESTIMATE' : 'OSM', b.irregular ? 't-est' : 't-osm', `Floor plate about ${b.W} × ${b.D} ft from the real footprint${b.irregular ? ' (irregular, simplified)' : ''}`)}
      ${tag(f2T, f2C, `${LW.eff(b, 'f2f')} ft floor-to-floor${LW.eff(b, 'f2f') < A.f2fMin ? ' (tight for homes)' : ''}`)}
      ${tag(repT, repC, `${b.real.market ? '' : 'CoStar stand-in: '}${pct(LW.eff(b, 'rep'))} leased`)}
      ${tag(yrT, yrC, `Built ${LW.eff(b, 'year')}`)}
      ${tag(...(b.real.aerial ? ['VEXCEL', 't-vx'] : ['SIMULATED', 't-sim']), parkTxt)}
      ${tag('FEASIBILITY', 't-fz', p.lw ? `Lightwell cut: ${p.perFloor} homes per floor` : `${p.perFloor} homes per floor along the window walls`)}
      <div class="find"><span class="tag t-safe ${s.status}">FIRE SAFETY</span><span><b>${safeTxt}.</b> Farthest home ${Math.round(s.travel)} ft from a stair.${s.notes.length ? '<br>' + s.notes.join('<br>') : ''}</span></div>
      ${b.phantom ? tag('FLAG', 't-fx', (b.real.market && b.real.aerial)
        ? `Signal to verify, not a finding: reported ${pct(LW.eff(b, 'rep'))} leased, but parking never above ${pct(Math.max(...b.obs))} across ${b.obs.length} captures. Garages or transit can explain this.`
        : `Hidden-vacancy example: reported ${pct(LW.eff(b, 'rep'))} leased, parking never above ${pct(Math.max(...b.obs))}.`) : ''}
      <div class="btns"><button id="orbit">Drone orbit</button><button id="street">3D street level</button>
        <button id="sview" class="sv">Street View</button></div>
      <div class="btns"><button id="showPlate">Floor plate</button><button id="fix">Correct data</button></div>
      <div id="fixForm" style="display:none">
        <label class="row">Leased (%) <input id="fRep" type="number" min="0" max="100" value="${Math.round(LW.eff(b, 'rep') * 100)}"></label>
        <label class="row">Year built <input id="fYear" type="number" min="1900" max="2026" value="${LW.eff(b, 'year')}"></label>
        <label class="row">Floor-to-floor (ft) <input id="fF2f" type="number" step="0.5" min="8" max="20" value="${LW.eff(b, 'f2f')}"></label>
        <div class="btns"><button id="fSave" class="primary">Save and re-score</button><button id="fReset">Reset</button></div>
      </div>
      <div class="btns"><button id="approve" class="primary wide">Approve &amp; draft memo</button></div>`;
    $('showPlate').onclick = () => openPlate(b); $('approve').onclick = () => openMemo(b);
    $('orbit').onclick = () => { $('plateBox').style.display = 'none'; LW.view.orbit(b); };
    $('sview').onclick = () => LW.streetView.open(b);
    // street level needs a true 3D scene, so it switches to the Photoreal 3D view first
    $('street').onclick = async () => { $('plateBox').style.display = 'none'; if (!LW.view.canStreet) await LW.switchView('g3d'); if (LW.view.canStreet) LW.view.street(b); };
    $('fix').onclick = () => { const f = $('fixForm'); f.style.display = f.style.display === 'none' ? 'block' : 'none'; };
    $('fSave').onclick = () => {
      const before = b.score;
      b.overrides = { rep: +$('fRep').value / 100, year: +$('fYear').value, f2f: +$('fF2f').value };
      LW.analyze(b); LW.refresh();
      LW.log('Planner', `Re-scored ${b.id} with your corrections: ${before} → ${b.score}.`);
    };
    $('fReset').onclick = () => { b.overrides = {}; LW.analyze(b); LW.refresh(); };
  }

  // ---------- floor plate ----------
  function openPlate(b) {
    $('plateBox').style.display = 'block'; const p = b.plan, s = p.safety;
    $('plateTitle').textContent = `${b.id} · typical floor (${b.W} × ${b.D} ft)`;
    $('cut').disabled = !b.courtOK; $('cut').classList.toggle('on', p.lw);
    $('cut').textContent = !b.courtOK ? 'Too small for a lightwell' : p.lw ? 'Remove lightwell' : 'Cut a lightwell';
    const cv = $('plate'), g = cv.getContext('2d'), Wc = cv.width, Hc = cv.height, pad = 40; g.clearRect(0, 0, Wc, Hc);
    const sc = Math.min((Wc - 2 * pad) / b.W, (Hc - 2 * pad - 30) / b.D), ox = (Wc - b.W * sc) / 2, oy = pad, L = p.L, u = LW.S.u, step = 2.5;
    const X = x => ox + x * sc, Y = y => oy + y * sc;
    const inR = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
    for (let y = 0; y < b.D; y += step) for (let x = 0; x < b.W; x += step) {
      const cx = x + step / 2, cy = y + step / 2; if (L.court && inR(cx, cy, L.court)) continue;
      let d = Math.min(cx, b.W - cx, cy, b.D - cy);
      if (L.court) { const r = L.court; d = Math.min(d, Math.hypot(Math.max(r[0] - cx, 0, cx - r[2]), Math.max(r[1] - cy, 0, cy - r[3]))); }
      if (d <= u) { const t = d / u; g.fillStyle = `rgb(${245 - t * 60 | 0},${200 - t * 70 | 0},${110 - t * 60 | 0})`; }
      else g.fillStyle = ((x / step + y / step) % 4 === 0) ? '#323a57' : '#28304a';
      g.fillRect(X(x), Y(y), step * sc + .6, step * sc + .6);
    }
    if (L.court) { const r = L.court; g.fillStyle = '#2c8c88'; g.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * sc, (r[3] - r[1]) * sc);
      g.fillStyle = '#d9fffb'; g.font = 'bold 20px system-ui'; g.textAlign = 'center'; g.fillText('LIGHTWELL', X((r[0] + r[2]) / 2), Y((r[1] + r[3]) / 2) + 7); }
    for (const c of L.cores) { g.fillStyle = '#5b6477'; g.fillRect(X(c[0]), Y(c[1]), (c[2] - c[0]) * sc, (c[3] - c[1]) * sc);
      g.fillStyle = '#e9edf5'; g.font = 'bold 14px system-ui'; g.textAlign = 'center'; g.fillText('CORE + STAIRS', X((c[0] + c[2]) / 2), Y((c[1] + c[3]) / 2) + 5); }
    const tc = ['rgba(60,198,180,.25)', 'rgba(127,184,255,.22)', 'rgba(186,140,255,.25)'];
    for (const un of L.units) { const r = un.r; g.fillStyle = tc[un.t]; g.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * sc, (r[3] - r[1]) * sc);
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.strokeRect(X(r[0]) + 1, Y(r[1]) + 1, (r[2] - r[0]) * sc - 2, (r[3] - r[1]) * sc - 2); }
    // fire-safety overlay: the home farthest from a stair, and its route
    if ($('showRoute').checked) {
      // walking distance (along corridors, so horizontal + vertical) from a home's centre to a core
      const walk = (cx, cy, c) => Math.max(c[0] - cx, 0, cx - c[2]) + Math.max(c[1] - cy, 0, cy - c[3]);
      let far = null, best = -1, tgt = null;
      for (const un of L.units) {
        const cx = (un.r[0] + un.r[2]) / 2, cy = (un.r[1] + un.r[3]) / 2;
        const c = L.cores.reduce((a, k) => walk(cx, cy, k) < walk(cx, cy, a) ? k : a), d = walk(cx, cy, c);
        if (d > best) { best = d; far = un; tgt = [cx, cy, Math.min(Math.max(cx, c[0]), c[2]), Math.min(Math.max(cy, c[1]), c[3])]; }
      }
      if (far) {
        const colr = { ok: '#5fd38a', check: '#f5b942', fail: '#ef5d6f' }[s.status];
        g.strokeStyle = colr; g.lineWidth = 4; g.strokeRect(X(far.r[0]) + 2, Y(far.r[1]) + 2, (far.r[2] - far.r[0]) * sc - 4, (far.r[3] - far.r[1]) * sc - 4);
        g.setLineDash([10, 8]); g.lineWidth = 3; g.beginPath(); g.moveTo(X(tgt[0]), Y(tgt[1])); g.lineTo(X(tgt[2]), Y(tgt[1])); g.lineTo(X(tgt[2]), Y(tgt[3])); g.stroke(); g.setLineDash([]);
        g.fillStyle = colr; g.font = 'bold 15px system-ui'; g.textAlign = 'left'; g.fillText(`${Math.round(s.travel)} ft to stair`, X(far.r[0]) + 6, Y(far.r[1]) - 6 < 14 ? Y(far.r[3]) + 18 : Y(far.r[1]) - 6);
      }
    }
    g.strokeStyle = '#e9edf5'; g.lineWidth = 3; g.strokeRect(ox, oy, b.W * sc, b.D * sc);
    g.fillStyle = '#8f9ab0'; g.fillRect(ox, oy + b.D * sc + 18, 50 * sc, 4); g.font = '16px system-ui'; g.textAlign = 'left'; g.fillText('50 ft', ox + 50 * sc + 8, oy + b.D * sc + 25);
    const a = b.alt;
    $('plateStats').innerHTML = `<b>${pct(p.daylitFrac)}</b> daylit · <b>${p.perFloor}</b> homes per floor · <b>${fmt(p.homes)}</b> homes · <b>${money(p.cpu)}</b> per home · fire screen <b class="st-${s.status}">${s.status}</b>` +
      (a ? ` &nbsp;|&nbsp; ${a.lw ? 'With' : 'Without'} lightwell: ${fmt(a.homes)} homes at ${money(a.cpu)}` : '');
  }
  LW.openPlate = openPlate;
  $('cut').onclick = () => { const b = LW.selected; if (!b) return; b.forceLW = !b.plan.lw; LW.analyze(b); LW.refresh(); openPlate(b); };
  $('closePlate').onclick = () => $('plateBox').style.display = 'none';
  $('showRoute').onchange = () => LW.selected && openPlate(LW.selected);

  // ---------- memos + exports ----------
  let memoText = '', memoName = 'memo';
  function openMemo(b) {
    const p = b.plan, s = p.safety; memoName = b.id + '-conversion-memo';
    const allReal = b.real.market && b.real.aerial;
    memoText = `# Conversion screen: ${b.label}, downtown Houston
${b.owner ? `\nTo: ${b.owner}\n` : ''}
**${fmt(p.homes)} homes could fit in this tower.**${allReal ? '' : ' (Demo memo: some figures are simulated, as marked.)'}

## What we found
- **Building (${b.real.interior ? 'Matterport scan' : 'OpenStreetMap'}):** ${b.heightM} m, ${LW.eff(b, 'floors')} floors, floor plate ${b.real.interior ? '' : 'about '}${b.W} x ${b.D} ft, ${LW.eff(b, 'f2f')} ft floor-to-floor.
- **Market (${b.overrides.rep != null ? 'corrected by user' : b.real.market ? 'CoStar' : 'simulated CoStar stand-in'}):** ${pct(LW.eff(b, 'rep'))} leased, built ${LW.eff(b, 'year')}.
- **Aerial (${b.real.aerial ? 'Vexcel' : 'simulated Vexcel stand-in'}):** parking ${b.obs.map(pct).join(', ')} full across ${b.obs.length} captures${b.real.aerial ? ' (' + b.obsDates.join(', ') + ')' : ''}.
- **Daylight test:** ${pct(p.daylitFrac)} of each floor is within ${LW.S.u} ft of a window.${p.lw ? ' A lightwell cut brings light to the core.' : ''}
- **Fire-safety screen (${s.status}):** farthest home ${Math.round(s.travel)} ft from a stair; stairs ${Math.round(s.sep)} ft apart.${s.notes.length ? ' ' + s.notes.join('. ') + '.' : ''}
${b.phantom ? '- **Signal to verify:** reported occupancy and observed parking disagree on every capture. This is not a finding; check the rent roll.\n' : ''}
## Proposal
- ${fmt(p.homes)} homes: ${p.mix[0]} studios, ${p.mix[1]} one-beds, ${p.mix[2]} two-beds (${p.perFloor} per floor; ground floor kept as lobby and retail).
- Estimated ${money(p.cpu)} per home, against roughly ${money(LW.A.newBuildPerHome)} for new construction.
- About ${fmt(p.carbon)} t CO2e of embodied carbon avoided.

## Next steps
1. Structural check of slabs, risers and stair cores.
2. Fire engineer review of exits and sprinklers.
3. Confirm the zoning path for residential use.

_Planning estimates generated by Lightwell.${allReal && b.real.interior ? '' : ' Replace simulated figures with CoStar, Vexcel and Matterport data before any decision.'}_
`;
    showMemo('Owner memo, drafted by the agent');
  }
  LW.openMemo = openMemo;
  function portfolioMemo() {
    const top = [...LW.B].filter(b => b.pass).sort((a, b) => b.score - a.score).slice(0, 5);
    memoName = 'lightwell-portfolio-memo';
    memoText = `# Downtown Houston: office-to-home shortlist

Screened ${LW.B.length} real towers (OpenStreetMap footprints) with a ${LW.S.u} ft daylight rule and a ${money(LW.S.cap)} cap per home. Market data is simulated.

| Tower | Score | Homes | Cost per home | Lightwell | Fire screen | Flag |
|---|---|---|---|---|---|---|
${top.map(b => `| ${b.label} | ${b.score} | ${fmt(b.plan.homes)} | ${money(b.plan.cpu)} | ${b.plan.lw ? 'yes' : 'no'} | ${b.plan.safety.status} | ${b.phantom ? 'hidden vacancy?' : ''} |`).join('\n')}

**Total:** ${fmt(LW.B.filter(b => b.pass).reduce((s, b) => s + b.plan.homes, 0))} homes across ${LW.B.filter(b => b.pass).length} passing towers; about ${fmt(LW.B.filter(b => b.pass).reduce((s, b) => s + b.plan.carbon, 0))} t CO2e avoided.

_Planning estimates. Verify with an architect, fire engineer and cost consultant._
`;
    showMemo('Portfolio memo');
  }
  function showMemo(title) { $('memoTitle').textContent = title; $('memo').textContent = memoText; $('modal').style.display = 'flex'; }
  $('mClose').onclick = () => $('modal').style.display = 'none';
  $('copy').onclick = async () => { try { await navigator.clipboard.writeText(memoText); toast('Copied'); } catch { toast('Copy failed: select the text instead'); } };
  $('dl').onclick = () => download(memoName + '.md', memoText, 'text/markdown');
  $('portfolio').onclick = portfolioMemo;
  $('csv').onclick = () => {
    const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    const rows = [['tower', 'address', 'costar_id', 'score', 'passes', 'homes', 'cost_per_home', 'lightwell', 'daylit_pct', 'fire_screen', 'farthest_home_ft',
      'height_m', 'floors', 'plate_w_ft', 'plate_d_ft', 'leased_pct', 'year_built', 'hidden_vacancy_flag', 'market_data']];
    for (const b of [...LW.B].sort((a, c) => c.score - a.score)) rows.push([b.id, b.real.market ? b.name : '', b.costarId || '', b.score, b.pass, b.plan.homes, Math.round(b.plan.cpu), b.plan.lw,
      Math.round(b.plan.daylitFrac * 100), b.plan.safety.status, Math.round(b.plan.safety.travel), b.heightM, LW.eff(b, 'floors'), b.W, b.D,
      Math.round(LW.eff(b, 'rep') * 100), LW.eff(b, 'year'), b.phantom,
      Object.keys(b.overrides).length ? 'user-corrected' : ['market', 'aerial', 'interior'].filter(k => b.real[k]).join('+') || 'simulated']);
    download('lightwell-houston-ranking.csv', rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
  };
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
  function toast(t) { $('toast').textContent = t; $('toast').style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => $('toast').style.display = 'none', 1800); }
  LW.toast = toast;

  // ---------- controls ----------
  function labels() { LW.S.u = +$('dist').value; LW.S.cap = +$('cap').value * 1000; LW.S.allowLW = $('lw').checked;
    $('dL').textContent = LW.S.u + ' ft'; $('cL').textContent = money(LW.S.cap); }
  LW.labels = labels;
  function recompute() { labels(); if (LW.scored) LW.analyzeAll(); }
  ['dist', 'cap'].forEach(id => $(id).oninput = recompute); $('lw').onchange = recompute;

  const AS = [['costPerSqft', 'Conversion cost ($/sq ft)', 1], ['lightwellPerSqft', 'Lightwell cut ($/sq ft removed)', 1], ['sprinklerPerSqft', 'Sprinkler retrofit ($/sq ft)', 1],
    ['newBuildPerHome', 'New-build cost per home ($)', 1], ['carbonKgPerM2', 'New-build carbon (kg CO₂e/m²)', 1], ['reuseSaving', 'Carbon avoided by reuse (%)', 100],
    ['maxTravelFt', 'Max travel to a stair (ft)', 1]];
  function buildAssumptions() {
    $('assume').innerHTML = AS.map(([k, label, m]) => `<label class="row">${label}<input data-k="${k}" data-m="${m}" type="number" value="${Math.round(LW.A[k] * m)}"></label>`).join('');
    $('assume').querySelectorAll('input').forEach(inp => inp.oninput = () => { const v = +inp.value; if (!isFinite(v) || v <= 0) return;
      LW.A[inp.dataset.k] = v / +inp.dataset.m; if (LW.scored) LW.analyzeAll(); });
  }

  // ---------- view switch ----------
  async function switchView(name) {
    if (LW.view === LW.views[name]) return;
    document.querySelectorAll('#views button').forEach(x => x.classList.toggle('on', x.dataset.v === name));
    const prev = LW.view, next = LW.views[name];
    $('viewNote').style.display = 'none';
    if (name === 'g3d') {
      $('viewNote').style.display = 'block'; $('viewNote').textContent = 'Loading 3D…';
      try { await next.init(); }
      catch (e) { $('viewNote').textContent = e.message; document.querySelectorAll('#views button').forEach(x => x.classList.toggle('on', x.dataset.v === 'map')); return; }
      $('viewNote').textContent = next.mode === 'google' ? 'Google Photorealistic 3D Tiles · coloured towers are Lightwell results'
        : (next.error || 'No Google key in config.js: showing OpenStreetMap buildings in 3D. Add a key for the photoreal city.');
    }
    prev.show(false); next.show(true); LW.view = next;
    prev.stopOrbit(); prev.select(null, LW.selected); LW.refresh(); next.select(LW.selected, null);
    if (LW.selected) next.fly(LW.selected);
  }
  document.querySelectorAll('#views button').forEach(x => x.onclick = () => switchView(x.dataset.v));
  LW.switchView = switchView;
})();
