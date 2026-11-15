// Panels, building card, evidence drawer, floor plate, corrections, brief, assumptions, memos, exports, view switching.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString(), money = n => isFinite(n) && n != null ? '$' + Math.round(n / 1000) + 'k' : '—', pct = x => x == null ? '—' : Math.round(x * 100) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const usd = n => n == null || !isFinite(n) ? '—' : '$' + Math.round(n).toLocaleString();
  Object.assign(LW, { fmt, money, pct, esc, usd });
  LW.scored = false; LW.flagsShown = false; LW.selected = null; LW.reviewed = null;
  const LAYERS = { market: 'CoStar', aerial: 'Vexcel', interior: 'Matterport' };

  // ---------- startup ----------
  LW.start = async function () {
    LW.geo = window.HOUSTON_GEOJSON;
    if (!LW.geo) { $('run').textContent = 'Building data not found'; return; }
    loadBuildings();
    LW.view = LW.views.map; LW.views.map.show(true); LW.views.g3d.show(false);
    LW.setBrief(LW.S); buildAssumptions();
    await LW.views.map.init();
    LW.agent.checkBackend();
  };
  function loadBuildings() {
    LW.B = LW.buildCandidates(LW.geo, LW.dataMode);
    LW.byOsm = new Map(LW.B.map(b => [b.osmId, b]));
    $('kCand').textContent = LW.B.length;
    document.querySelectorAll('#dataMode button').forEach(x => x.classList.toggle('on', x.dataset.m === LW.dataMode));
    const n = k => LW.B.filter(b => b.real[k]).length;
    $('dataNote').innerHTML = (LW.real ? `<b>Imported real data</b> (${esc(LW.real.generated.replace('T', ' '))}): <b>${n('market')}</b> towers with CoStar records, <b>${n('aerial')}</b> with Vexcel parking counts, <b>${n('interior')}</b> with Matterport plates${LW.real.counts && LW.real.counts.tenants ? `, <b>${LW.real.counts.tenants}</b> current tenancies` : ''}.<br>`
      : '<b>Real:</b> building footprints and heights (OpenStreetMap). No CoStar, Vexcel or Matterport data imported yet.<br>')
      + (LW.dataMode === 'demo' ? '<b>Demo fill-in:</b> towers without real records get SIMULATED values. Real names stay hidden next to simulated numbers.'
        : '<b>Real data only:</b> nothing is simulated. Missing values show as MISSING and any assumption the engine makes is stated.')
      + ' Click any source tag to see the evidence.';
  }
  document.querySelectorAll('#dataMode button').forEach(x => x.onclick = () => {
    if (LW.dataMode === x.dataset.m || (LW.agent && LW.agent.running)) return;
    LW.dataMode = x.dataset.m; const sel = LW.selected && LW.selected.osmId; loadBuildings();
    $('log').innerHTML = ''; LW.reviewed = null; LW.flagsShown = false; $('card').style.display = 'none'; $('plateBox').style.display = 'none'; LW.selected = null;
    if (LW.scored) LW.analyzeAll(); else LW.B.forEach(b => LW.view.paint(b));
    if (sel && LW.byOsm.get(sel) && LW.scored) LW.onSelect(LW.byOsm.get(sel), false);
    LW.toast(LW.dataMode === 'demo' ? 'Demo fill-in on' : 'Real data only');
  });

  // ---------- recompute + paint ----------
  LW.analyzeAll = function () { LW.B.forEach(LW.analyze); LW.refresh(); };
  LW.refresh = function () {
    LW.B.forEach(b => LW.view.paint(b));
    LW.view.setFlags(LW.flagsShown ? LW.B.filter(b => b.phantom) : []);
    totals(); renderRanking();
    if (LW.selected) { renderCard(LW.selected); if ($('plateBox').style.display === 'block') openPlate(LW.selected); }
    if (LW.dayViewOn) { LW.view.setDaylight(true); daySum(); }   // the brief sliders recolour the Daylight view live
  };
  function totals() {
    if (!LW.scored) return;
    const pass = LW.B.filter(b => b.pass);
    $('kHomes').textContent = fmt(pass.reduce((s, b) => s + b.plan.homes, 0));
    $('kCo2').textContent = fmt(pass.reduce((s, b) => s + b.plan.carbon, 0) / 1000) + 'k';
    $('kFlags').textContent = LW.B.filter(b => b.phantom).length;
    $('exports').style.display = 'flex';
  }
  const fsDot = s => s !== 'verify' ? `<span class="fs ${s}" title="${LW.SAFE_LABEL[s]}">●</span>` : '';
  function renderRanking() {
    if (!LW.scored) return;
    const list = [...LW.B].sort((a, b) => (b.pass - a.pass) || (b.score - a.score)).slice(0, 15);
    $('ranking').innerHTML = list.map(b => `<div class="rank ${LW.selected === b ? 'sel' : ''}" data-i="${b.idx}">
      <span class="sc" style="background:${LW.hex(LW.scoreRGB(b.score))}">${b.score}</span>
      <span class="nm"><b>${esc(b.label)}</b> · ${LW.eff(b, 'floors')} floors${b.real.market ? ' <span class="realdot" title="Real CoStar record">◆</span>' : ''} ${b.phantom ? '<span class="flag" title="Occupancy discrepancy to investigate">⚑</span>' : ''}${fsDot(b.plan.safety.status)}${Object.keys(b.overrides).length ? ' <span class="you" title="Includes your corrections">✎</span>' : ''}
      <small>${b.pass ? fmt(b.plan.homes) + ' homes · ' + money(b.plan.cpu) + '/home' : esc(b.why.join(' · ')) + (b.plan.homes ? ' · ' + money(b.plan.cpu) + '/home' : '')}${b.plan.lw ? ' · lightwell' : ''}</small></span></div>`).join('');
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
  // A source tag is a button: it opens the evidence drawer for that field.
  const tagFor = (b, k, label) => { const s = k ? LW.srcOf(b, k) : label; return `<button class="tag ${LW.SRC_CLASS[s] || 't-est'}" data-ev="${k || ''}" title="Show the evidence">${s}</button>`; };
  const row = (b, k, text, label) => `<div class="find">${tagFor(b, k, label)}<span>${text}</span></div>`;
  // Rent check: real CoStar asking rents nearby vs the rent this conversion needs (js/rent.js)
  function rentRow(b) {
    const r = LW.rentCheck(b); if (!r) return '';
    const head = `<button class="tag t-rent ${r.verdict}" data-ev="rent" title="Show the evidence">RENT CHECK</button>`;
    if (r.verdict === 'no_data') return `<div class="find">${head}<span><b>Needs about ${usd(r.required)}/month per home</b> to pay back the conversion. No CoStar rents loaded to compare (run backend/rent_comps.py).</span></div>`;
    return `<div class="find">${head}<span><b>${LW.RENT_LABEL[r.verdict]}.</b> Needs ${usd(r.required)}/month per home; ${r.n} CoStar listings within ${fmt(r.radius_m)} m ask about ${usd(r.market)}`
      + ` (${r.gap >= 0 ? '+' : '−'}${usd(Math.abs(r.gap))}). The market supports up to ${money(r.supports_cost_per_home)} per home.`
      + ` Affordable on ${money(r.income_needed)}/yr, ${pct(r.income_share)} of Houston's median income.</span></div>`;
  }
  // A mini elevation of the tower: one bar per floor, empty floors gold, the biggest empty block outlined.
  function stackSvg(b) {
    const n = LW.eff(b, 'floors'), H = Math.min(150, Math.max(60, n * 4)), fh = H / n, W = 30, empty = new Set(b.vacantFloors);
    const big = LW.emptyBlocks(b)[0];
    let s = `<svg width="${W + 4}" height="${H + 4}" viewBox="-2 -2 ${W + 4} ${H + 4}" role="img" aria-label="Floor stack">`;
    for (let f = 1; f <= n; f++) {
      const y = H - f * fh, c = f === 1 ? '#2c8c88' : empty.has(f) ? '#f5b942' : '#3a4766';
      s += `<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${Math.max(0.6, fh - (fh > 3 ? 1 : 0.3)).toFixed(1)}" fill="${c}"/>`;
    }
    if (big) s += `<rect x="-1.5" y="${(H - big.to * fh - 0.5).toFixed(1)}" width="${W + 3}" height="${(big.len * fh).toFixed(1)}" fill="none" stroke="#fff" stroke-width="1.2" rx="1"/>`;
    return s + '</svg>';
  }
  function floorsRow(b) {
    const n = LW.eff(b, 'floors'), k = b.vacantFloors.length, big = LW.emptyBlocks(b)[0], p = b.plan;
    if (LW.srcOf(b, 'vacant') === 'MISSING') return `<div class="floorsRow"><div class="txt">${tagFor(b, 'vacant')} <b>Empty floors:</b> unknown (no CoStar available-space floors imported for this tower).</div></div>`;
    return `<div class="floorsRow">${stackSvg(b)}<div class="txt">${tagFor(b, 'vacant')} <b>Empty floors</b><br>
      ${k} of ${n - 1} office floors empty${big ? `; biggest block is floors ${big.from}–${big.to}.<br>
      <b>Phase one:</b> ${fmt(big.len * p.perFloor)} homes on those ${big.len} floors now, the rest as leases end.` : '. No phase one yet.'}</div></div>`;
  }
  // Texas fast-track (SB 840 / SB 2477) + tenant moves + red team, for one tower
  const range = f => f.length > 1 ? `${f[0]}–${f[f.length - 1]}` : `${f[0]}`;
  function moveSection(b) {
    if (!LW.fastTrack) return '';
    const ft = LW.fastTrack(b), mp = LW.movePlan && LW.movePlan.tower === b.id ? LW.movePlan : null, ch = mp && LW.moveChallenge;
    const head = `<div class="find"><button class="tag t-tx ${ft.status}" data-ev="texas">TX FAST-TRACK</button><span><b>${LW.FT_LABEL[ft.status]}.</b> `
      + (ft.status === 'unknown' ? 'Needs CoStar floor-by-floor availability to check the 65% residential rule.'
        : `${ft.free} of ${ft.floors} floors empty; 65% homes needs ${ft.need}${ft.short ? `, so <b>${ft.short} more floors</b> must be freed` : ''}.`
          + (ft.ageKnown ? ` Built ${ft.age} years ago${ft.age >= LW.POLICY.minAge ? ' (5+ ✓)' : ''}.` : ' Year built unknown (must be 5+ years).'))
      + `</span></div>`;
    if (ft.status === 'unknown' || ft.status === 'too_new') return head;
    let body = `<div class="btns"><button id="mvFast" class="${mp && mp.goal === 'fast' ? 'on' : ''}">Plan tenant moves</button><button id="mvEmpty" class="${mp && mp.goal === 'empty' ? 'on' : ''}">Empty the tower</button>${mp ? '<button id="mvClear">Hide</button>' : ''}</div>`;
    if (mp) {
      body += `<div class="moves"><div class="mvSum">${mp.moves.some(m => m.src === 'COSTAR') ? '<i>Hypothetical plan using real CoStar tenants, not their intentions.</i><br>' : ''}<b>${mp.moves.length}</b> tenants · <b>${mp.freed_floors}</b> floors freed → <b>${fmt(mp.homes_after)}</b> homes can start now (+${fmt(mp.homes_gained)})<br>
        Incentives ≈ <b>${LW.bigMoney(mp.cost)}</b>${mp.cost_per_home_gained ? ` · <b>${money(mp.cost_per_home_gained)}</b> per home unlocked` : ''} ${tagFor(b, null, 'ESTIMATE')}<br>
        ${mp.fast_track_after ? '<span class="ok">✓ reaches the 65% fast-track</span>' : '<span class="bad">✗ still short of 65%</span>'}</div>
        ${mp.moves.map(m => `<div class="mv"><span class="tag ${m.src === 'COSTAR' ? 't-cs' : 't-sim'}">${m.src === 'COSTAR' ? 'COSTAR' : 'SIMULATED'}</span>
          <span><b>${esc(m.tenant)}</b> · fl ${range(m.floors)} · ${fmt(m.sqft / 1000)}k sq ft · ${m.lease_end ? 'lease to ' + m.lease_end : 'lease end not on record'}<br>→ <a href="#" data-go="${m.to}">${esc((LW.B.find(x => x.id === m.to) || {}).label || m.to)}</a> · ${m.dist_m} m · ${LW.bigMoney(m.cost)}</span></div>`).join('')}
        ${mp.unplaced.length ? `<div class="mv bad">${mp.unplaced.length} tenant(s) found no nearby tower with room.</div>` : ''}
        ${ch ? `<div class="redteam ${ch.verdict}"><b>RED TEAM · ${LW.VERDICT[ch.verdict]}</b>${ch.risks.length ? '<ul>' + ch.risks.map(r => `<li class="${r.level}">${esc(r.text)}</li>`).join('') + '</ul>' : ''}</div>` : ''}</div>`;
    }
    return head + body;
  }
  LW.showMoves = function (plan, challenge, quiet) {
    LW.movePlan = plan || null; LW.moveChallenge = challenge || null;
    LW.view.setMoves && LW.view.setMoves(LW.movePlan);
    if (plan && !quiet) { const t = LW.B.find(x => x.id === plan.tower); if (t) LW.onSelect(t, false); if (LW.view.overview) LW.view.overview(); }
    if (LW.selected) renderCard(LW.selected);
  };
  function planFor(b, goal) {
    const plan = LW.planMoves(b, LW.B, goal), ch = LW.challengePlan(b, plan, LW.B);
    LW.showMoves(plan, ch);
    if (plan) {
      LW.log('Deals', `${b.id}: move ${plan.moves.length} tenants (${plan.freed_floors} floors) into ${plan.receivers.join(', ') || 'no tower'} → ${fmt(plan.homes_after)} homes can start now; incentives about ${LW.bigMoney(plan.cost)}.`);
      LW.log('Red team', `${b.id}: ${LW.VERDICT[ch.verdict].toLowerCase()}.${ch.risks.find(r => r.level !== 'low') ? ' ' + ch.risks.find(r => r.level !== 'low').text : ''}`);
    }
  }

  LW.phaseOne = b => { const big = LW.emptyBlocks(b)[0]; return big ? { ...big, homes: big.len * b.plan.perFloor } : null; };

  // Daylight X-ray: which wall is dim and what blocks it. A blocker is named by its candidate label or its height, never its OSM name.
  const wallName = (b, k) => k === 'court' ? 'lightwell court' : LW.compass(b.day.face[k]) + '-facing wall';
  const an = n => /^(8|11|18|8\d|8\d\d)$/.test(String(n)) ? 'an' : 'a';   // "an 8 m building", "a 176 m building"
  const blkLabel = blk => { if (!blk) return 'a nearby building'; const c = LW.byOsm.get(blk.osm), h = Math.round(blk.h);
    return (c ? `${esc(c.label)} (${h} m)` : `${an(h)} ${h} m building`) + (blk.d <= 1 ? ' on a shared wall' : ` ${blk.d} ft away`); };
  const worstWall = d => Object.entries(d.walls).sort((x, y) => y[1].homes - x[1].homes)[0];
  function dayRow(b) {
    const d = b.plan.day;
    if (!d) return row(b, 'daylight', LW.S.neighbours === false ? '<b>Daylight from neighbours:</b> not checked (switched off in the brief).' : '<b>Daylight from neighbours:</b> no data for this tower.');
    if (!d.dim) return row(b, 'daylight', `<b>Daylight from neighbours:</b> every home sees the sky at ${d.lim}°.`);
    const [k, w] = worstWall(d);
    return row(b, 'daylight', `<b>Daylight from neighbours:</b> ${fmt(d.dim)} of ${fmt(d.open + d.dim)} homes face a nearby building (${wallName(b, k)}, floors ${w.from}–${w.to}). `
      + (d.strict ? 'Strict: not counted.' : 'They lower the daylight score.'));
  }

  function renderCard(b) {
    const p = b.plan, s = p.safety, col = LW.hex(LW.scoreRGB(b.score ?? 0)), A = LW.A, f2f = LW.eff(b, 'f2f'), rep = LW.eff(b, 'rep'), year = LW.eff(b, 'year');
    const layers = ['market', 'aerial', 'interior'].filter(k => b.real[k]), obs = b.obs || [];
    const parkTxt = !obs.length ? 'Parking: no aerial counts' : `Parking ${obs.map((x, i) => `${pct(x)}${b.obsDates ? ` (${esc(b.obsDates[i])})` : ''}`).join(' / ')} full${LW.S.useParking ? '' : ' · ignored by the brief'}`;
    const c = LW.eff(b, 'core') || LW.defaultCore(b.W, b.D);
    const checklist = LW.checklist(b);
    const cs = b.ev.costar || {}, photo = b.photo && (window.LIGHTWELL_CONFIG || {}).COSTAR_PHOTOS ? String(b.photo) : '';
    $('card').style.display = 'block';
    $('card').innerHTML = `${photo ? `<a href="${esc(photo.replace('/112/', '/113/'))}" target="_blank" rel="noopener" title="CoStar photo (opens larger)"><img class="cphoto" src="${esc(photo.replace('/112/', '/110/'))}" alt="${esc(b.label)}: CoStar photo" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
      <h3>${esc(b.label)}${b.label !== b.id ? ` <small style="color:var(--muted)">${b.id}</small>` : ''}</h3>
      <div class="meta">${layers.length ? `Real ${layers.map(k => LAYERS[k]).join(' + ')} data${b.costarId ? ' · CoStar ' + esc(b.costarId) : ''}`
        : LW.dataMode === 'demo' ? 'Real footprint and height · market data simulated' : 'Real footprint and height · no market records'}${cs.class ? ' · Class ' + esc(cs.class) : ''}${cs.rating ? ` · ${cs.rating}-star` : ''}${b.owner ? ' · ' + esc(b.owner) : ''}</div>
      <div style="display:flex;justify-content:space-between"><span>Conversion score</span><b>${b.score ?? '–'}/100</b></div>
      <div class="bar"><i style="width:${b.score ?? 0}%;background:${col}"></i></div>
      ${b.pass ? '' : `<div class="why">Doesn't pass the brief: ${esc(b.why.join(' · '))}</div>`}
      ${b.converted ? `<div class="conv"><b>Already converted</b> (CoStar, ${esc(b.converted)})${b.convertedTo ? `: now ${esc(b.convertedTo)}` : ''}. Downtown Houston offices do become homes.</div>` : ''}
      <div class="big"><div><b>${fmt(p.homes)}</b><span>homes (${p.mix[0]} studio · ${p.mix[1]} 1-bed · ${p.mix[2]} 2-bed)</span></div>
        <div><b>${money(p.cpu)}</b><span>per home vs ~${money(A.newBuildPerHome)} new build</span></div>
        <div><b>${pct(p.daylitFrac)}</b><span>of usable floor is homes within ${LW.S.u} ft of a window${p.day ? ' that sees the sky' : ''}</span></div>
        <div><b>${fmt(p.carbon)} t</b><span>CO₂e embodied carbon avoided</span></div></div>
      ${row(b, 'floors', `Height ${b.heightM} m · ${LW.eff(b, 'floors')} floors`)}
      ${row(b, 'plate', `Floor plate ${LW.srcOf(b, 'plate') === 'MATTERPORT' ? '' : 'about '}${b.W} × ${b.D} ft${b.irregular ? ' (irregular footprint, simplified)' : ''}`)}
      ${row(b, 'core', `Core ${Math.round(c[2] - c[0])} × ${Math.round(c[3] - c[1])} ft${LW.srcOf(b, 'core') === 'ASSUMED' ? ', assumed central' : ''}`)}
      ${row(b, 'f2f', `${f2f} ft floor-to-floor${f2f < A.f2fHard ? ' (too low for homes)' : f2f < A.f2fMin ? ' (tight for homes)' : ''}`)}
      ${b.sprinklers === true || b.sprinklers === false ? row(b, 'sprinklers', b.sprinklers ? 'Sprinklers on record' : 'No sprinklers on record: a full retrofit is priced in') : ''}
      ${row(b, 'rep', rep == null ? 'Leased: unknown' : b.ev.scout && LW.srcOf(b, 'rep') === 'ESTIMATE'
        ? `About ${pct(rep)} leased (scout estimate, ${pct(b.ev.scout.lo)}–${pct(b.ev.scout.hi)}, ${b.ev.scout.confidence} confidence)` : `${pct(rep)} leased`)}
      ${rentRow(b)}
      ${row(b, 'year', year == null ? 'Year built: unknown' : `Built ${year}${cs.renovated && LW.srcOf(b, 'year') === 'COSTAR' ? ` · renovated ${esc(cs.renovated)}` : ''}`)}
      ${row(b, 'obs', parkTxt)}
      ${row(b, null, `Vacancy signal ${pct(b.vac)} (from ${b.vacBasis})`, b.vacBasis === 'assumed' ? 'ASSUMED' : 'FEASIBILITY')}
      ${row(b, null, p.lw ? `Lightwell cut: ${p.perFloor} homes per floor` : `${p.perFloor} homes per floor along the window walls`, 'FEASIBILITY')}
      ${dayRow(b)}
      ${floorsRow(b)}
      ${moveSection(b)}
      <div class="find"><button class="tag t-safe ${s.status}" data-ev="fire">FIRE · PRELIM</button><span><b>${LW.SAFE_LABEL[s.status]}.</b> Farthest home about ${Math.round(s.travel)} ft from a stair (estimate).${s.notes.length ? '<br>' + s.notes.map(esc).join('<br>') : ''}</span></div>
      ${b.phantom ? `<div class="find"><button class="tag t-fx" data-ev="obs">INVESTIGATE</button><span>${(b.real.market && b.real.aerial)
        ? `Observation to investigate, not a finding: reported ${pct(rep)} leased, but parking never above ${pct(Math.max(...obs))} across ${obs.length} captures. Garages, transit or remote work can explain this.`
        : `Simulated example of an occupancy discrepancy: reported ${pct(rep)} leased, parking never above ${pct(Math.max(...obs))}.`}</span></div>` : ''}
      ${b.assumed && b.assumed.length ? `<div class="note" style="margin-top:6px">${b.assumed.map(esc).join('<br>')}</div>` : ''}
      <details class="cl"><summary>Before a site visit (${checklist.length})</summary><ol>${checklist.map(x => `<li>${esc(x.text)}${x.from ? ` <small>· ${esc(x.from)}</small>` : ''}</li>`).join('')}</ol></details>
      <div class="btns"><button id="orbit">Drone orbit</button><button id="street">3D street level</button>
        <button id="sview" class="sv">Street View</button></div>
      ${(b.models || []).length ? `<div class="btns"><button id="tour" class="sv" title="CoStar's Matterport scans of this building">3D tour inside · Matterport (${b.models.length})</button></div>` : ''}
      <div class="btns"><button id="showPlate">Floor plate</button><button id="fix">Correct data</button></div>
      <div id="fixForm" style="display:none">
        <label class="row">Leased (%) <input id="fRep" type="number" min="0" max="100" placeholder="unknown" value="${rep == null ? '' : Math.round(rep * 100)}"></label>
        <label class="row">Year built <input id="fYear" type="number" min="1900" max="2026" placeholder="unknown" value="${year ?? ''}"></label>
        <label class="row">Floor-to-floor (ft) <input id="fF2f" type="number" step="0.5" min="7" max="25" value="${f2f}"></label>
        <label class="row">Core W × D (ft) <input id="fCore" type="text" value="${Math.round(c[2] - c[0])}x${Math.round(c[3] - c[1])}"></label>
        <div class="askErr" id="fErr"></div>
        <div class="btns"><button id="fSave" class="primary">Save and re-score</button><button id="fReset">Reset</button></div>
      </div>
      <div class="btns"><button id="approve" class="primary wide">${LW.reviewFresh(b) ? 'Approve reviewed memo' : 'Draft memo'}</button></div>`;
    $('card').querySelectorAll('[data-ev]').forEach(el => el.onclick = () => LW.evidence(b, el.dataset.ev));
    $('showPlate').onclick = () => openPlate(b); $('approve').onclick = () => openMemo(b);
    $('orbit').onclick = () => { $('plateBox').style.display = 'none'; LW.view.orbit(b); };
    $('sview').onclick = () => LW.streetView.open(b);
    if ($('tour')) $('tour').onclick = () => LW.tour(b);
    if ($('mvFast')) { $('mvFast').onclick = () => planFor(b, 'fast'); $('mvEmpty').onclick = () => planFor(b, 'empty'); }
    if ($('mvClear')) $('mvClear').onclick = () => LW.showMoves(null);
    $('card').querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); const t = LW.B.find(x => x.id === a.dataset.go); if (t) LW.onSelect(t, true); });
    // street level needs a true 3D scene, so it switches to the Photoreal 3D view first
    $('street').onclick = async () => { $('plateBox').style.display = 'none'; if (!LW.view.canStreet) await LW.switchView('g3d'); if (LW.view.canStreet) LW.view.street(b); };
    $('fix').onclick = () => { const f = $('fixForm'); f.style.display = f.style.display === 'none' ? 'block' : 'none'; };
    $('fSave').onclick = () => {
      const before = b.score, o = { ...b.overrides }, changed = [];
      const put = (k, v, cur, same) => { if (v === null) return; if (!same(v, cur)) { o[k] = v; changed.push(k); } };
      try {
        const r = $('fRep').value.trim(), y = $('fYear').value.trim(), f = $('fF2f').value.trim(), cs = $('fCore').value.trim();
        if (r !== '') put('rep', LW.parseMeasurement(b, 'rep', r), rep, (a, c2) => c2 != null && Math.abs(a - c2) < 0.005);
        if (y !== '') { const yy = Math.round(+y); if (!(yy >= 1850 && yy <= 2026)) throw new Error('year must be 1850-2026'); put('year', yy, year, (a, c2) => a === c2); }
        if (f !== '') put('f2f', LW.parseMeasurement(b, 'f2f', f), f2f, (a, c2) => a === c2);
        if (cs !== '') put('core', LW.parseMeasurement(b, 'core', cs), c, (a, c2) => a.every((v, i) => Math.abs(v - c2[i]) < 0.5));
      } catch (e) { $('fErr').textContent = e.message; return; }
      if (!changed.length) { $('fErr').textContent = 'Nothing changed.'; return; }
      b.overrides = o; LW.analyze(b); LW.refresh();
      LW.log('You', `Corrected ${b.id}: ${changed.map(k => ({ rep: 'leased', year: 'year built', f2f: 'floor-to-floor', core: 'core size' })[k]).join(', ')}. Score ${before} → ${b.score}.${LW.reviewed ? ' Re-run the agent to review the change.' : ''}`);
    };
    $('fReset').onclick = () => { b.overrides = {}; LW.analyze(b); LW.refresh(); };
  }

  // ---------- evidence drawer ----------
  const kv = rows => `<table class="kv">${rows.filter(r => r[1] != null && r[1] !== '').map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const FIELD = { rent: 'Rent check', sprinklers: 'Sprinklers', vacant: 'Empty floors', floors: 'Floors and height', plate: 'Floor plate', core: 'Core', f2f: 'Floor-to-floor height', rep: 'Percent leased', year: 'Year built', obs: 'Parking occupancy', fire: 'Preliminary fire screen', texas: 'Texas conversion fast-track', daylight: 'Daylight from neighbours', '': 'Calculated value' };
  const SRC_TXT = {
    OSM: 'From the OpenStreetMap building record (footprint, height or levels tags).',
    ESTIMATE: 'Estimated by Lightwell from other values; not measured.',
    ASSUMED: 'Assumed by Lightwell because no measurement is loaded.',
    COSTAR: 'From the CoStar data kit (property, tenancy, listing and sale records), imported with backend/costar_kit.py. Derived values say how below.', VEXCEL: 'From imported Vexcel aerial captures (car counts per capture).',
    MATTERPORT: 'From the imported Matterport scan record.',
    SIMULATED: 'Demo stand-in from a seeded random generator. Not real data; never shown next to a real building name.',
    MISSING: 'No value in any loaded data layer.', YOU: 'Corrected by you in this session.',
  };
  LW.evidence = function (b, k) {
    const s = k && k !== 'fire' && k !== 'texas' && k !== 'rent' ? LW.srcOf(b, k) : null, p = b.plan, sf = p.safety, parts = [];
    if (s) parts.push(`<p><span class="tag ${LW.SRC_CLASS[s]}">${s}</span> ${SRC_TXT[s] || ''}</p>`);
    if (s === 'YOU') parts.push(kv([['Your value', JSON.stringify(b.overrides[k])], ['Original', JSON.stringify(b[k])], ['Original source', (b.src || {})[k]]]));
    if (k === 'rep' || k === 'year') {
      if (b.ev.costar) parts.push('<h4>CoStar record</h4>' + kv([['CoStar id', b.ev.costar.costar_id], ['Address', b.ev.costar.address], ['Owner', b.ev.costar.owner],
        ['Leased', b.ev.costar.leased != null ? pct(b.ev.costar.leased) : 'not in record'], ['Year built', b.ev.costar.year ?? 'not in record'],
        ['RBA (sq ft)', b.ev.costar.rba_sqft ? fmt(b.ev.costar.rba_sqft) : null], ['Renovated', b.ev.costar.renovated], ['Matched to footprint', b.ev.costar.match]]));
      const c = b.ev.costar || {};
      if (k === 'rep' && c.leased_method) parts.push('<h4>How the CoStar records give this</h4>' + kv([['Method', c.leased_method],
        ['Space on the market (all)', c.available_sqft != null ? fmt(c.available_sqft) + ' sq ft' : null],
        ['Vacant direct space now', c.vacant_now_sqft != null ? fmt(c.vacant_now_sqft) + ' sq ft' : null],
        ['Current tenancies', c.tenants_current != null ? `${c.tenants_current} (${c.tenants_with_lease_end || 0} with a lease end on record)` : null],
        ['Occupied by current tenancies', c.leased_tenancy != null ? `${c.leased_tenancy}% of RBA (tenancy records can be incomplete)` : null],
        ['Share leased at its latest sale', c.sale_leased != null ? `${c.sale_leased}% (${c.sale_date})` : null]]));
      const sc = b.ev.scout;
      if (k === 'rep' && sc && LW.srcOf(b, 'rep') === 'ESTIMATE') parts.push(`<h4>How the data scout estimated this</h4><p>No CoStar record for this tower. The scout took the ${sc.neighbours.length} most similar CoStar towers
        (closest, and closest in floor count), weighted them, and pulled the result toward the downtown average (${pct(LW.SCOUT.prior)} leased; ${esc(LW.SCOUT.priorSrc)}).
        Range ${pct(sc.lo)}–${pct(sc.hi)}, <b>${sc.confidence} confidence</b> (${sc.near} comparable towers within ${LW.SCOUT.nearM} m). Still counts as missing for “Require real: CoStar”.</p>`
        + kv(sc.neighbours.map(x => { const t = LW.B.find(y => y.id === x.id); return [t ? t.label : x.id, `${pct(x.leased)} leased · ${fmt(x.dist_m)} m away`]; })));
      if (k === 'year' && LW.eff(b, 'year') == null) parts.push(`<p>Engine assumption: costs use ${LW.A.unknownYear} (abatement and sprinkler retrofit included), age fit neutral.</p>`);
      if (k === 'rep' && LW.eff(b, 'rep') == null) parts.push(`<p>Engine assumption: vacancy from ${b.vacBasis}${b.vacBasis === 'assumed' ? ` (${pct(LW.A.unknownVacancy)}, Houston average)` : ''}.</p>`);
    }
    if (k === 'rent') {
      const r = LW.rentCheck(b), m = b.rentMarket, A = LW.A;
      parts.push(`<p><span class="tag ${m ? 't-cs' : 't-miss'}">${m ? 'COSTAR' : 'MISSING'}</span> ${m ? 'Asking rents from residential listings and multifamily records in the CoStar data kit (backend/rent_comps.py).' : 'No CoStar rents loaded: run backend/rent_comps.py, then backend/import_data.py.'}</p>
        <p><b>Rent this conversion needs</b> = (cost per home × ${Math.round(A.yieldOnCost * 1000) / 10}% target yield + ${usd(A.opexPerHomeYr)} operating cost a year) ÷ 12 ÷ ${pct(1 - A.rentVacancy)} occupied
        = <b>${usd(r && r.required)}/month</b>. Yield, operating cost and vacancy are estimates (Assumptions panel).</p>`);
      if (r && m && r.verdict !== 'no_data') {
        parts.push('<h4>Market rent for this layout</h4>' + kv(r.types.map(x => [`${x.homes} × ${LW.RENT_TYPES[x.t]} (~${x.area} sq ft)`, `${usd(x.rent)}/month · ${x.basis}`]))
          + kv([['Average across the mix', usd(r.market) + '/month'], ['Rent needed', usd(r.required) + '/month'], ['Gap', (r.gap >= 0 ? '+' : '−') + usd(Math.abs(r.gap))],
            ['Cost per home the market supports', usd(r.supports_cost_per_home)], ['Income to afford it (30% rule)', `${usd(r.income_needed)}/yr, ${pct(r.income_share)} of Houston's median (${usd(A.medianIncome)}, US Census ACS)`],
            ['Listings used', `${m.n} within ${fmt(m.radius)} m${m.psf ? `; median $${m.psf}/sq ft from ${m.psfN}` : ''}`]]));
        parts.push('<h4>Nearest listings</h4>' + kv(m.nearest.map(x => [`${fmt(x.dist_m)} m away`, `${usd(x.rent)}/month${x.beds != null ? ` · ${x.beds ? x.beds + '-bed' : 'studio'}` : ''}${x.sqft ? ` · ${fmt(x.sqft)} sq ft` : ''}`])));
      }
      parts.push('<p>A screen, not an appraisal: asking rents, not signed leases; new conversions often rent above older stock.</p>');
    }
    if (k === 'texas') {
      const ft = LW.fastTrack(b);
      parts.push(`<p><b>Texas SB 840 and SB 2477</b> (in force 1 September 2025) apply to cities over 150,000 people in counties over 300,000, which includes Houston.
        An office building at least 5 years old can be converted to homes without rezoning, a traffic study or extra parking, if at least 65% of the building and of each occupied floor becomes residential.</p>
        <p>Lightwell's screen: the ground floor stays lobby or retail; every other floor counts as residential only when it is fully empty (whole-floor conversion). Floors still leased stay offices until a tenant moves or a lease ends.
        This is a screening rule, not legal advice: confirm with a land-use lawyer and the City of Houston.</p>`
        + (Array.isArray(b.tenants) ? `<p><b>Tenants:</b> ${b.tenants.length} current CoStar tenancies on office floors, ${b.tenants.filter(t => t.lease_end != null).length} with a lease end on record. A floor shared by several tenants counts as freed only when all of them move; a lease with no end on record assumes ${LW.A.unknownLeaseYrs} more years of concessions.</p>` : '')
        + kv([['Floors', ft.floors], ['Residential floors needed (65%)', ft.need], ['Floors empty now', ft.free ?? 'unknown'], ['Floors to free', ft.short ?? 'unknown'],
          ['Building age', ft.ageKnown ? ft.age + ' years' : 'unknown'], ['Status', LW.FT_LABEL[ft.status]]])
        + `<p class="note">Sources: <a href="https://www.foley.com/insights/publications/2025/11/client-briefing-texas-senate-bill-840-and-texas-senate-bill-2477-89th-legislatu/" target="_blank" rel="noopener">Foley briefing on SB 840 / SB 2477</a> · <a href="https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=SB840" target="_blank" rel="noopener">Texas Legislature: SB 840</a></p>`);
    }
    if (k === 'vacant') {
      if (b.ev.costar && b.ev.costar.vacant_floors) parts.push('<h4>CoStar available space</h4>' + kv([['CoStar id', b.ev.costar.costar_id], ['Floors with available space', b.ev.costar.vacant_floors.join(', ')]]));
      else if (LW.srcOf(b, 'vacant') === 'SIMULATED') parts.push('<p>Simulated from the (simulated) leased share: empty space placed in blocks of whole floors.</p>');
      if (LW.srcOf(b, 'vacant') === 'COSTAR' && b.ev.costar && b.ev.costar.leased_method) parts.push(`<p>From CoStar's listings: a floor counts as empty when vacant direct space on the market now covers 80% or more of the typical floor${b.ev.costar.typical_sqft ? ` (${fmt(b.ev.costar.typical_sqft)} sq ft)` : ''}, or a full-floor space is vacant. A tower with no tenant and no listing that sold at 0% leased counts as empty on every floor.</p>`);
      parts.push('<p>Phase one = the biggest block of consecutive empty floors, converted first while the rest stays leased.</p>');
    }
    if (k === 'obs') {
      const m = b.obsMeta;
      if (m) parts.push('<h4>Vexcel captures</h4><table class="kv grid"><tr><td>Date</td><td>Cars / spaces</td><td>Full</td><td>Confidence</td><td>Source</td></tr>'
        + m.map(x => `<tr><td>${esc(x.date)}</td><td>${x.cars ?? '–'} / ${x.spaces ?? '–'}</td><td>${pct(x.pct)}</td><td>${esc(x.confidence || '–')}</td><td>${esc(x.source || '')}</td></tr>`
          + (x.notes || x.image ? `<tr><td></td><td colspan="4"><small>${esc(x.notes || '')}${x.image ? ' · image ' + esc(x.image) : ''}</small></td></tr>` : '')).join('') + '</table>');
      else if ((b.obs || []).length) parts.push(kv(b.obs.map((x, i) => [`Capture ${i + 1}`, pct(x) + ' full'])));
      parts.push(`<p>${LW.S.useParking ? 'Parking is a weak occupancy signal downtown (garages, transit): a discrepancy is something to investigate, never proof.' : 'The brief ignores parking evidence.'}</p>`);
    }
    if (k === 'plate' || k === 'core' || k === 'f2f' || k === 'floors') {
      if (b.ev.matterport) { const I = b.ev.matterport; parts.push('<h4>Matterport record</h4>' + kv([['Model id', I.model_id], ['Scanned', I.scanned ? 'yes' : 'no'],
        ['Plate', I.W && I.D ? `${I.W} × ${I.D} ft` : null], ['Floor-to-floor', I.f2f ? I.f2f + ' ft' : null], ['Core', I.core ? I.core.map(Math.round).join(', ') + ' (x0, y0, x1, y1 ft)' : null]])); }
      const c = b.ev.costar;
      if (c) parts.push('<h4>CoStar property record</h4>' + kv([['CoStar id', c.costar_id], ['Storeys', c.floors], ['Class / rating', c.class ? `${c.class}${c.rating ? ', ' + c.rating + '-star' : ''}` : null],
        ['Typical floor', c.typical_sqft ? fmt(c.typical_sqft) + ' sq ft' : null], ['Height used', c.height_m ? `${c.height_m} m (${c.height_src === 'COSTAR' ? "CoStar's height" : 'CoStar storeys x 13 ft, an estimate'}): OpenStreetMap's height did not fit the storey count` : null],
        ['Floor-to-floor check', c.f2f_note]]));
      parts.push('<h4>OpenStreetMap</h4>' + kv([['OSM way', b.osmId], ['Height', b.heightM + ' m'], ['Footprint', fmt(b.footprint) + ' sq ft'], ['Simplified plate', `${b.W} × ${b.D} ft (minimum rectangle)`]]));
      if (k === 'f2f' && LW.srcOf(b, 'f2f') === 'ESTIMATE') parts.push(`<p>Estimate: height ÷ ${LW.srcOf(b, 'floors') === 'ESTIMATE' ? 'a floor count that was itself estimated from height (3.9 m a floor), so this is close to an assumption' : 'floor count'}. A scan or section drawing replaces it.</p>`);
      if (k === 'core' && LW.srcOf(b, 'core') === 'ASSUMED') parts.push('<p>Assumed: a central core about 26% of the plate width and 20% of its depth (at least 40 × 30 ft). The real core can be larger in older towers.</p>');
    }
    if (k === 'daylight') {
      const d = p.day;
      parts.push(`<p><b>A screening check, not a daylight study.</b> A home counts as seeing the sky when the obstruction angle at eye height on its floor is at most ${d ? d.lim : LW.S.dayLim}° (after UK BRE daylight guidance).
        Every window wall is checked floor by floor against the neighbouring buildings (a fan of rays every ~20 ft, up to 300 ft); a lightwell court is checked against the tower itself across the court.
        Neighbour heights come from OpenStreetMap; buildings without a height are drawn at 8 m (ESTIMATE). Glazing, reflections and trees are not modelled.</p>`);
      if (!d) parts.push(`<p>${LW.S.neighbours === false ? 'Switched off in the brief: daylight uses the window-distance test only.' : 'No neighbour data for this tower (run backend/daylight.py).'}</p>`);
      else {
        parts.push(`<p>${fmt(d.dim)} of ${fmt(d.open + d.dim)} homes face a nearby building${d.strict ? ' and are not counted (strict daylight).' : ': they still count as homes but not as daylit, which lowers the score.'}</p>`);
        const W = Object.entries(d.walls).sort((x, y) => y[1].homes - x[1].homes);
        if (W.length) parts.push('<table class="kv grid"><tr><td>Wall</td><td>Dim floors</td><td>Dim homes</td><td>Blocked by</td><td>Height source</td></tr>'
          + W.map(([w, x]) => { const blk = w === 'court' ? null : b.day.blk[w];
            return `<tr><td>${w === 'court' ? 'lightwell court' : LW.compass(b.day.face[w]) + '-facing'}${w !== 'court' && b.day.edge[w] ? ' (faces the edge of our data)' : ''}</td><td>${x.from}–${x.to}</td><td>${fmt(x.homes)}</td>`
              + `<td>${w === 'court' ? 'the tower itself across the court' : blkLabel(blk)}</td><td>${blk ? `<span class="tag ${LW.SRC_CLASS[blk.src] || 't-est'}">${esc(blk.src)}</span>` : '–'}</td></tr>`; }).join('') + '</table>'
          + '<p class="note">Blocked by: the building that blocks most of the wall\'s sight lines at the lowest home floor. Taller buildings further away can dim higher floors.</p>');
        const open = ['n', 's', 'e', 'w'].filter(w => !d.walls[w] && p.L.units.some(un => !un.court && un.win === w));
        if (open.length) parts.push(`<p>Open to the sky at ${d.lim}° on every floor: ${open.map(w => wallName(b, w) + (b.day.edge[w] ? ' (faces the edge of our data, so this may be optimistic)' : '')).join('; ')}.</p>`);
      }
    }
    if (k === 'sprinklers') parts.push(`<p>CoStar's property record ${b.sprinklers ? 'says the building has sprinklers, so no sprinkler retrofit is priced in' : `has no sprinklers for this building, so a full sprinkler retrofit ($${LW.A.sprinklerPerSqft}/sq ft) is priced in and noted on the fire screen`}. Without a CoStar record, towers built before 1975 are assumed to need one.</p>`
      + (b.ev.costar ? kv([['CoStar id', b.ev.costar.costar_id]]) : ''));
    if (k === 'fire') parts.push(`<p><b>${LW.SAFE_LABEL[sf.status]}.</b> This is an estimate from the plate and the core rectangle. Stair locations and corridors are not known.</p>`
      + '<h4>Measured</h4><ul>' + sf.measured.map(x => `<li>${esc(x)} (${esc(LW.srcOf(b, 'plate'))})</li>`).join('') + '</ul>'
      + '<h4>Assumed</h4><ul>' + sf.assumed.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>'
      + '<h4>Estimated</h4>' + kv([['Farthest home to a stair', `~${Math.round(sf.travel)} ft (limit ~${LW.A.maxTravelFt} ft)`], ['Stair separation', `~${Math.round(sf.sep)} ft (needs ~${Math.round(sf.req)} ft)`], ['Sprinkler retrofit', sf.retrofit ? 'assumed needed' : 'not assumed']])
      + '<h4>Not verified</h4><ul>' + sf.unverified.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>');
    if (!k) parts.push('<p>Calculated by the Lightwell engine from the values above and the editable assumptions.</p>' + (b.assumed.length ? '<ul>' + b.assumed.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : ''));
    $('evTitle').textContent = `${b.label} · ${FIELD[k] || k}`; $('evBody').innerHTML = parts.join(''); $('evidence').style.display = 'block';
  };
  $('evClose').onclick = () => $('evidence').style.display = 'none';

  // ---------- inspection checklist: from the evidence gaps, plus what the consulted business asked for ----------
  LW.checklist = function (b) {
    const p = b.plan, out = [], src = k => LW.srcOf(b, k), C = window.LIGHTWELL_CONSULT || {}, year = LW.eff(b, 'year');
    const who = C.person ? `${C.person}${C.role ? ', ' + C.role : ''}${C.business ? ' (' + C.business + ')' : ''}` : '';
    for (const it of (C.items || [])) if (it && it.text && (!it.when || (it.when === 'lightwell' ? p.lw : it.when === 'flag' ? b.phantom : true))) out.push({ text: it.text, from: who ? 'asked by ' + who : '' });
    if (['ASSUMED', 'MISSING'].includes(src('core')) || ['ESTIMATE', 'OSM'].includes(src('plate'))) out.push({ text: 'As-built floor plans or a Matterport scan of a typical floor: confirm plate depth and core position and size.' });
    if (src('f2f') === 'ESTIMATE') out.push({ text: 'Section drawing or scan: measured slab-to-slab height (currently estimated from building height).' });
    if (['SIMULATED', 'MISSING'].includes(src('rep'))) out.push({ text: 'Current rent roll and lease expiry schedule (no CoStar leasing loaded for this tower).' });
    if (b.phantom) out.push({ text: '12 months of garage counts or badge-access data to check the occupancy discrepancy before drawing any conclusion.' });
    if (year == null || year < 1980) out.push({ text: `Hazardous-materials survey (asbestos, lead)${year == null ? ': year built unknown' : ': built ' + year}.` });
    if (p.safety.retrofit || p.safety.status !== 'verify') out.push({ text: `Fire engineer review: exit stairs, travel distances, sprinklers (preliminary screen: ${LW.SAFE_LABEL[p.safety.status].toLowerCase()}).` });
    else out.push({ text: 'Fire engineer review to confirm exit stairs and travel distances (the screen is preliminary).' });
    if (p.lw) out.push({ text: 'Structural drawings: slab, beam and column layout where the lightwell would be cut; new stair locations.' });
    out.push({ text: 'Confirm the permitting path for residential use with the City of Houston (deed restrictions, building code change of occupancy).' });
    return out;
  };
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
      g.fillStyle = '#e9edf5'; g.font = 'bold 14px system-ui'; g.textAlign = 'center'; const lab = L.coreBasis === 'assumed' ? 'CORE (ASSUMED)' : L.coreBasis === 'lightwell' ? 'NEW STAIRS' : 'CORE'; g.font = `bold ${(c[2] - c[0]) * sc < 110 ? 11 : 14}px system-ui`;
      g.fillText(lab, X((c[0] + c[2]) / 2), Y((c[1] + c[3]) / 2) + 5); }
    const tc = ['rgba(60,198,180,.25)', 'rgba(127,184,255,.22)', 'rgba(186,140,255,.25)'];
    for (const un of L.units) { const r = un.r; g.fillStyle = tc[un.t]; g.fillRect(X(r[0]), Y(r[1]), (r[2] - r[0]) * sc, (r[3] - r[1]) * sc);
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.strokeRect(X(r[0]) + 1, Y(r[1]) + 1, (r[2] - r[0]) * sc - 2, (r[3] - r[1]) * sc - 2); }
    // Daylight X-ray: a dark band along each window wall that faces a nearby building, labelled with its compass side and dim floors
    if (p.day) {
      const T = 20, x0 = X(0), y0 = Y(0), w = b.W * sc, h = b.D * sc;
      g.font = 'bold 14px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [k, wl] of Object.entries(p.day.walls)) {
        if (k === 'court') continue;
        const band = { n: [x0, y0, w, T], s: [x0, y0 + h - T, w, T], w: [x0, y0, T, h], e: [x0 + w - T, y0, T, h] }[k]; if (!band) continue;
        g.fillStyle = 'rgba(10,14,24,.75)'; g.fillRect(...band);
        g.save(); g.translate(band[0] + band[2] / 2, band[1] + band[3] / 2); if (k === 'w') g.rotate(-Math.PI / 2); if (k === 'e') g.rotate(Math.PI / 2);
        g.fillStyle = '#ffb3bd'; g.fillText(`${LW.compass(b.day.face[k])} · dim on floors ${wl.from}–${wl.to}`, 0, 1); g.restore();
      }
      const cw = p.day.walls.court;
      if (cw && L.court) { const r = L.court; g.strokeStyle = 'rgba(10,14,24,.9)'; g.lineWidth = 8; g.strokeRect(X(r[0]) + 4, Y(r[1]) + 4, (r[2] - r[0]) * sc - 8, (r[3] - r[1]) * sc - 8);
        g.fillStyle = '#ffb3bd'; g.fillText(`court dim on floors ${cw.from}–${cw.to}`, X((r[0] + r[2]) / 2), Y((r[1] + r[3]) / 2) + 30); }
      g.textBaseline = 'alphabetic';
    }
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
        g.fillStyle = colr; g.font = 'bold 15px system-ui'; g.textAlign = 'left'; g.fillText(`~${Math.round(s.travel)} ft to stair (est.)`, X(far.r[0]) + 6, Y(far.r[1]) - 6 < 14 ? Y(far.r[3]) + 18 : Y(far.r[1]) - 6);
      }
    }
    g.strokeStyle = '#e9edf5'; g.lineWidth = 3; g.strokeRect(ox, oy, b.W * sc, b.D * sc);
    g.fillStyle = '#8f9ab0'; g.fillRect(ox, oy + b.D * sc + 18, 50 * sc, 4); g.font = '16px system-ui'; g.textAlign = 'left'; g.fillText('50 ft', ox + 50 * sc + 8, oy + b.D * sc + 25);
    const a = b.alt;
    $('plateStats').innerHTML = `<b>${pct(p.daylitFrac)}</b> daylit · <b>${p.perFloor}</b> homes per floor · <b>${fmt(p.homes)}</b> homes · <b>${money(p.cpu)}</b> per home · fire screen (preliminary) <b class="st-${s.status}">${LW.SAFE_LABEL[s.status].toLowerCase()}</b>` +
      (p.day ? ` · <b>${fmt(p.day.dim)}</b> homes face a neighbour` : '') +
      (a ? ` &nbsp;|&nbsp; ${a.lw ? 'With' : 'Without'} lightwell: ${fmt(a.homes)} homes at ${money(a.cpu)}` : '');
  }
  LW.openPlate = openPlate;
  $('cut').onclick = () => { const b = LW.selected; if (!b) return; b.forceLW = !b.plan.lw; LW.analyze(b); LW.refresh(); openPlate(b);
    if (LW.reviewed) LW.log('Planner', `You switched ${b.id} to ${b.plan.lw ? 'a lightwell cut' : 'no lightwell'}: the agent's review no longer matches. Re-run the agent to review this scenario.`); };
  $('closePlate').onclick = () => $('plateBox').style.display = 'none';
  $('showRoute').onchange = () => LW.selected && openPlate(LW.selected);

  // ---------- memos + exports ----------
  // A memo is "reviewed" only if the agent reviewed this tower and nothing has changed since (brief, assumptions, corrections, lightwell choice).
  LW.reviewFresh = b => !!(LW.reviewed && LW.reviewed.top === b.id && LW.reviewed.key === LW.inputsKey());
  let memoText = '', memoName = 'memo';
  function openMemo(b) {
    const fresh = LW.reviewFresh(b), stale = LW.reviewed && LW.reviewed.top === b.id && !fresh;
    const sm = fresh ? LW.reviewed.summary : LW.summary(b), p = b.plan, sf = p.safety, R = LW.reviewed;
    const tagOf = k => LW.srcOf(b, k).toLowerCase(), obs = b.obs || [];
    const anySim = ['rep', 'year', 'obs'].some(k => LW.srcOf(b, k) === 'SIMULATED'), anyGap = ['rep', 'year', 'obs', 'core', 'f2f'].some(k => ['SIMULATED', 'MISSING', 'ASSUMED', 'ESTIMATE'].includes(LW.srcOf(b, k)));
    memoName = b.id + '-conversion-memo';
    const status = fresh ? `Reviewed by ${R.by} at ${R.at.toLocaleTimeString()}; numbers below are the ones the agent checked.`
      : stale ? 'NOT REVIEWED: the brief, assumptions, corrections or lightwell choice changed after the agent reviewed this tower. Re-run the agent before sending.'
      : 'Draft: not reviewed by the agent. Run the agent to review it.';
    const cl = LW.checklist(b);
    memoText = `# Conversion screen: ${b.label}, downtown Houston
${b.owner ? `\nTo: ${b.owner}\n` : ''}
_${status}_

**${fmt(sm.homes)} homes could fit in this tower** at about ${money(sm.cost_per_home)} each.${anySim ? ' (Demo memo: some figures are simulated, as marked.)' : ''}
${fresh && R.rationale ? `\n> ${R.rationale.replace(/\n/g, ' ')}\n` : ''}
## Brief
${LW.briefText(LW.S)}

## What we found (source of each value in brackets)
- **Building:** ${b.heightM} m [${tagOf('floors')}], ${LW.eff(b, 'floors')} floors, plate ${b.W} x ${b.D} ft [${tagOf('plate')}], ${LW.eff(b, 'f2f')} ft floor-to-floor [${tagOf('f2f')}], core [${tagOf('core')}].
- **Market:** ${LW.eff(b, 'rep') == null ? 'leased share unknown' : pct(LW.eff(b, 'rep')) + ' leased'} [${tagOf('rep')}], ${LW.eff(b, 'year') == null ? 'year built unknown' : 'built ' + LW.eff(b, 'year')} [${tagOf('year')}].
- **Aerial:** ${obs.length ? `parking ${obs.map(pct).join(', ')} full across ${obs.length} captures${b.obsDates ? ' (' + b.obsDates.join(', ') + ')' : ''}` : 'no parking counts'} [${tagOf('obs')}]${LW.S.useParking ? '' : '; ignored by the brief'}.
- **Daylight test:** ${sm.daylit_pct}% of the usable floor is homes within ${LW.S.u} ft of a window${sm.dim_homes != null ? ' that sees the sky' : ''}.${sm.lightwell ? ' A lightwell cut brings light to the core.' : ''}
- **Preliminary fire screen (${LW.SAFE_LABEL[sm.fire_screen].toLowerCase()}):** farthest home about ${sm.farthest_home_ft} ft from a stair; stairs about ${sm.stair_sep_ft} ft apart (estimates; ${sf.assumed[0].toLowerCase()}).${sm.fire_notes.length ? ' ' + sm.fire_notes.join('. ') + '.' : ''}
- **Daylight from neighbours (screening):** ${sm.dim_homes == null ? 'not checked' : `${fmt(sm.dim_homes)} homes face a nearby building at the ${sm.daylight_rule_deg}° limit${sm.daylight_strict ? ' (not counted: strict)' : ' (they lower the daylight score)'}`}.
${sm.hidden_vacancy_flag ? '- **Observation to investigate:** reported occupancy and observed parking disagree on every capture. This is not a finding; check the rent roll.\n' : ''}${sm.assumed && sm.assumed.length ? sm.assumed.map(a => `- **Assumption:** ${a}.`).join('\n') + '\n' : ''}${fresh && R.review && R.review.length ? '\n## Agent review\n' + R.review.map(x => '- ' + x.replace(/<[^>]+>/g, '')).join('\n') + '\n' : ''}
## Proposal
- ${fmt(sm.homes)} homes: ${sm.mix.studio} studios, ${sm.mix.one_bed} one-beds, ${sm.mix.two_bed} two-beds (${sm.homes_per_floor} per floor; ground floor kept as lobby and retail).
${LW.phaseOne(b) ? `- **Phase one:** floors ${LW.phaseOne(b).from}-${LW.phaseOne(b).to} are already empty [${tagOf('vacant')}]: ${fmt(LW.phaseOne(b).homes)} homes can start now; convert the rest as leases end.\n` : ''}${LW.fastTrack ? `- **Texas fast-track (SB 840 / 2477):** ${LW.FT_LABEL[LW.fastTrack(b).status].toLowerCase()}${LW.movePlan && LW.movePlan.tower === b.id && LW.movePlan.moves.length ? `; plan: move ${LW.movePlan.moves.length} tenants into ${LW.movePlan.receivers.join(', ')} for about ${LW.bigMoney(LW.movePlan.cost)} (estimate${LW.movePlan.moves.some(m => m.src !== 'COSTAR') ? ', simulated tenants' : ''})${LW.moveChallenge ? `; red team: ${LW.VERDICT[LW.moveChallenge.verdict].toLowerCase()}` : ''}` : ''}. Screening, not legal advice.\n` : ''}- Estimated ${money(sm.cost_per_home)} per home, against roughly ${money(LW.A.newBuildPerHome)} for new construction.
- About ${fmt(sm.carbon_t)} t CO2e of embodied carbon avoided.

## Before a site visit
${cl.map((x, i) => `${i + 1}. ${x.text}${x.from ? ` (${x.from})` : ''}`).join('\n')}

_Screening estimates generated by Lightwell; not a design, fire or cost review.${anyGap ? ' Replace estimated, assumed or simulated values with measured data before any decision.' : ''}_
`;
    showMemo(fresh ? 'Owner memo · reviewed by the agent' : stale ? 'Owner memo · NOT reviewed (inputs changed)' : 'Owner memo · draft');
  }
  LW.openMemo = openMemo;
  function portfolioMemo() {
    const top = [...LW.B].filter(b => b.pass).sort((a, b) => b.score - a.score).slice(0, 5);
    memoName = 'lightwell-portfolio-memo';
    memoText = `# Downtown Houston: office-to-home shortlist

Screened ${LW.B.length} real towers (OpenStreetMap footprints). Brief: ${LW.briefText(LW.S)}. Data: ${LW.dataMode === 'demo' ? 'demo fill-in (simulated values on towers without real records)' : 'real data only'}.

| Tower | Score | Homes | Cost per home | Lightwell | Fire screen (prelim.) | Dim homes | Flag | Unmeasured values |
|---|---|---|---|---|---|---|---|---|
${top.map(b => `| ${b.label} | ${b.score} | ${fmt(b.plan.homes)} | ${money(b.plan.cpu)} | ${b.plan.lw ? 'yes' : 'no'} | ${b.plan.safety.status} | ${b.plan.day ? b.plan.day.dim : '–'} | ${b.phantom ? 'investigate' : ''} | ${['rep', 'year', 'obs', 'f2f', 'core'].filter(k => ['SIMULATED', 'MISSING', 'ASSUMED', 'ESTIMATE'].includes(LW.srcOf(b, k))).join(', ')} |`).join('\n')}

**Total:** ${fmt(LW.B.filter(b => b.pass).reduce((s, b) => s + b.plan.homes, 0))} homes across ${LW.B.filter(b => b.pass).length} passing towers; about ${fmt(LW.B.filter(b => b.pass).reduce((s, b) => s + b.plan.carbon, 0))} t CO2e avoided.

_Screening estimates. Verify with an architect, fire engineer and cost consultant._
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
    const F = ['plate', 'core', 'f2f', 'rep', 'year', 'obs', 'vacant', 'daylight'];
    const rows = [['tower', 'address', 'costar_id', 'score', 'passes', 'why_not', 'homes', 'cost_per_home', 'lightwell', 'daylit_pct', 'fire_screen_prelim', 'farthest_home_ft_est',
      'dim_homes', 'daylight_rule_deg', 'height_m', 'floors', 'empty_floors', 'phase_one_floors', 'phase_one_homes', 'plate_w_ft', 'plate_d_ft', 'f2f_ft', 'leased_pct', 'year_built', 'parking_pct', 'occupancy_discrepancy', ...F.map(k => 'src_' + k), 'agent_reviewed']];
    for (const b of [...LW.B].sort((a, c) => c.score - a.score)) rows.push([b.id, b.real.market ? b.name : '', b.costarId || '', b.score, b.pass, b.why.join('; '), b.plan.homes,
      isFinite(b.plan.cpu) ? Math.round(b.plan.cpu) : '', b.plan.lw, Math.round(b.plan.daylitFrac * 100), b.plan.safety.status, Math.round(b.plan.safety.travel),
      b.plan.day ? b.plan.day.dim : '', b.plan.day ? b.plan.day.lim : '', b.heightM, LW.eff(b, 'floors'),
      LW.srcOf(b, 'vacant') === 'MISSING' ? '' : b.vacantFloors.length, LW.phaseOne(b) ? LW.phaseOne(b).from + '-' + LW.phaseOne(b).to : '', LW.phaseOne(b) ? LW.phaseOne(b).homes : '', b.W, b.D,
      LW.eff(b, 'f2f'), LW.eff(b, 'rep') == null ? '' : Math.round(LW.eff(b, 'rep') * 100), LW.eff(b, 'year') ?? '', (b.obs || []).map(x => Math.round(x * 100)).join('/'), b.phantom,
      ...F.map(k => LW.srcOf(b, k)), LW.reviewFresh(b)]);
    download('lightwell-houston-ranking.csv', rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
  };
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
  function toast(t) { $('toast').textContent = t; $('toast').style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => $('toast').style.display = 'none', 1800); }
  LW.toast = toast;

  // ---------- the brief (live constraints) ----------
  LW.setBrief = function (S) {
    LW.S = { ...LW.S, ...S, require: [...((S && S.require) || [])] };
    $('dist').value = LW.S.u; $('cap').value = Math.round(LW.S.cap / 1000); $('lw').checked = LW.S.allowLW;
    $('minHomes').value = LW.S.minHomes; $('useParking').checked = LW.S.useParking;
    $('dayOn').checked = LW.S.neighbours !== false; $('dayLim').value = LW.S.dayLim; $('dayL').textContent = LW.S.dayLim + '°'; $('dayStrict').checked = !!LW.S.dayStrict;
    document.querySelectorAll('#require input').forEach(x => x.checked = LW.S.require.includes(x.value));
    $('dL').textContent = LW.S.u + ' ft'; $('cL').textContent = money(LW.S.cap); $('briefText').textContent = LW.briefText(LW.S);
  };
  function readBrief() {
    LW.setBrief({ u: +$('dist').value, cap: +$('cap').value * 1000, allowLW: $('lw').checked, minHomes: Math.max(1, Math.round(+$('minHomes').value || 1)),
      useParking: $('useParking').checked, require: [...document.querySelectorAll('#require input:checked')].map(x => x.value),
      neighbours: $('dayOn').checked, dayLim: +$('dayLim').value, dayStrict: $('dayStrict').checked });
  }
  function recompute() { readBrief(); if (LW.scored) LW.analyzeAll(); }
  ['dist', 'cap', 'minHomes'].forEach(id => $(id).oninput = recompute);
  ['lw', 'useParking'].forEach(id => $(id).onchange = recompute);
  $('dayLim').oninput = recompute;
  ['dayOn', 'dayStrict'].forEach(id => $(id).onchange = recompute);
  document.querySelectorAll('#require input').forEach(x => x.onchange = recompute);

  const AS = [['costPerSqft', 'Conversion cost ($/sq ft)', 1], ['lightwellPerSqft', 'Lightwell cut ($/sq ft removed)', 1], ['sprinklerPerSqft', 'Sprinkler retrofit ($/sq ft)', 1],
    ['newBuildPerHome', 'New-build cost per home ($)', 1], ['carbonKgPerM2', 'New-build carbon (kg CO₂e/m²)', 1], ['reuseSaving', 'Carbon avoided by reuse (%)', 100],
    ['maxTravelFt', 'Max travel to a stair (ft)', 1], ['f2fHard', 'Lowest usable floor-to-floor (ft)', 1],
    ['moveCostSqft', 'Tenant move allowance ($/sq ft)', 1], ['buyoutSqftYr', 'Early lease exit ($/sq ft/yr left)', 1],
    ['unknownLeaseYrs', 'Lease end not on record: years left', 1],
    ['yieldOnCost', 'Rent check: target yield on cost (%)', 100], ['opexPerHomeYr', 'Operating cost per home ($/yr)', 1],
    ['rentVacancy', 'Rental vacancy (%)', 100], ['medianIncome', 'Houston median household income ($)', 1]];
  function buildAssumptions() {
    $('assume').innerHTML = AS.map(([k, label, m]) => `<label class="row">${label}<input data-k="${k}" data-m="${m}" type="number" step="${k === 'f2fHard' ? 0.5 : 1}" value="${+(LW.A[k] * m).toFixed(1)}"></label>`).join('');
    $('assume').querySelectorAll('input').forEach(inp => inp.oninput = () => { const v = +inp.value; if (!isFinite(v) || v <= 0) return;
      LW.A[inp.dataset.k] = v / +inp.dataset.m; if (LW.scored) LW.analyzeAll(); });
  }

  // ---------- view switch ----------
  async function switchView(name) {
    if (LW.view === LW.views[name]) return;
    document.querySelectorAll('#views button[data-v]').forEach(x => x.classList.toggle('on', x.dataset.v === name));
    const prev = LW.view, next = LW.views[name];
    $('viewNote').style.display = 'none';
    if (name === 'g3d') {
      $('viewNote').style.display = 'block'; $('viewNote').textContent = 'Loading 3D…';
      try { await next.init(); }
      catch (e) { $('viewNote').textContent = e.message; document.querySelectorAll('#views button[data-v]').forEach(x => x.classList.toggle('on', x.dataset.v === 'map')); return; }
      $('viewNote').textContent = next.mode === 'google' ? 'Google Photorealistic 3D Tiles · coloured towers are Lightwell results'
        : (next.error || 'No Google key in config.js: showing OpenStreetMap buildings in 3D. Add a key for the photoreal city.');
    }
    prev.show(false); next.show(true); LW.view = next;
    prev.stopOrbit(); prev.select(null, LW.selected); LW.refresh(); next.select(LW.selected, null);
    next.setFloors(LW.floorsOn); next.setDaylight(LW.dayViewOn); if (next.setMoves) next.setMoves(LW.movePlan);
    if (LW.selected) next.fly(LW.selected);
    $('sunBar').style.display = name === 'g3d' ? 'flex' : 'none'; placeLegends(); placeSun();
  }
  // The view legends sit just under the view note (shown in Photoreal 3D) instead of behind it.
  function placeLegends() { const n = $('viewNote'), top = n.style.display === 'block' ? Math.round(n.getBoundingClientRect().bottom + 6) + 'px' : '';
    $('floorsLegend').style.top = top; $('dayLegend').style.top = top; }
  document.querySelectorAll('#views button[data-v]').forEach(x => x.onclick = () => switchView(x.dataset.v));
  LW.switchView = switchView;

  // ---------- sun and shadows (Photoreal 3D): shadows start off, for speed ----------
  const clock = h => `${(Math.floor(h) + 11) % 12 + 1}:${String(Math.round((h % 1) * 60)).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  function sun() { $('sunL').textContent = clock(+$('sunHour').value); LW.views.g3d.setSun($('sunOn').checked, +$('sunDay').value, +$('sunHour').value); }
  $('sunOn').onchange = sun; $('sunDay').onchange = sun; $('sunHour').oninput = sun; $('sunL').textContent = clock(+$('sunHour').value);
  // the sun bar and the floor plate share the bottom centre: lift the bar above the plate while it is open
  function placeSun() { const p = $('plateBox'); $('sunBar').style.bottom = p.style.display === 'block' ? Math.round(innerHeight - p.getBoundingClientRect().top + 8) + 'px' : ''; }
  new MutationObserver(placeSun).observe($('plateBox'), { attributes: true, attributeFilter: ['style'] });
  addEventListener('resize', placeSun);

  // ---------- empty floors toggle ----------
  LW.floorsOn = false;
  $('floorsBtn').onclick = () => {
    if (!LW.floorsOn && LW.dayViewOn) $('dayBtn').onclick();   // Empty floors and Daylight are exclusive
    LW.floorsOn = !LW.floorsOn;
    $('floorsBtn').classList.toggle('on', LW.floorsOn);
    $('floorsLegend').style.display = LW.floorsOn ? 'flex' : 'none';
    const known = LW.B.filter(b => LW.srcOf(b, 'vacant') !== 'MISSING');
    const empty = known.reduce((s, b) => s + b.vacantFloors.length, 0), all = known.reduce((s, b) => s + b.floors - 1, 0);
    const real = LW.B.filter(b => b.real.floors).length;
    $('floorsSum').textContent = known.length ? `${fmt(empty)} of ${fmt(all)} office floors empty across ${known.length} towers · ${real ? real + ' from CoStar' : 'simulated until CoStar data'}${known.length < LW.B.length ? ` · ${LW.B.length - known.length} unknown` : ''}`
      : 'No empty-floor data: import CoStar available-space floors';
    LW.view.setFloors(LW.floorsOn);
  };

  // ---------- Matterport 3D tour: CoStar's scans of the building ----------
  // A plain embed with no SDK key in the address: with a key, Matterport waits for an SDK connection the page never makes.
  LW.tour = function (b) {
    const ms = b.models || []; if (!ms.length) return;
    const show = id => { const m = encodeURIComponent(id);
      $('mpFrame').src = `https://my.matterport.com/show/?m=${m}&play=1&qs=1`; $('mpOpen').href = `https://my.matterport.com/show/?m=${m}`; };
    $('mpTitle').textContent = `${b.label} · 3D tour`;
    $('mpNote').textContent = `${ms.length} Matterport scan${ms.length > 1 ? 's' : ''} from the CoStar data kit · may show a suite or the lobby, not a whole floor · the first load can take up to a minute`;
    $('mpModel').innerHTML = ms.map((m, i) => `<option value="${esc(m)}">Scan ${i + 1} of ${ms.length}</option>`).join('');
    $('mpModel').onchange = () => show($('mpModel').value);
    show(ms[0]); $('mpBox').style.display = 'flex';
  };
  $('mpClose').onclick = () => { $('mpBox').style.display = 'none'; $('mpFrame').src = 'about:blank'; };

  // ---------- Daylight X-ray view toggle ----------
  LW.dayViewOn = false;
  function daySum() {
    LW.B.forEach(b => { if (!b.plan) LW.analyze(b); });
    const ds = LW.B.map(b => b.plan.day).filter(Boolean), dim = ds.reduce((s, d) => s + d.dim, 0), all = ds.reduce((s, d) => s + d.open + d.dim, 0);
    $('daySum').textContent = LW.S.neighbours === false ? 'Daylight check is switched off in the brief'
      : ds.length ? `${fmt(dim)} of ${fmt(all)} homes face a nearby building · limit ${ds[0].lim}°${LW.S.dayStrict ? ' · strict' : ''}`
      : 'No neighbour data (run backend/daylight.py)';
  }
  $('dayBtn').onclick = () => {
    if (!LW.dayViewOn && LW.floorsOn) $('floorsBtn').onclick();   // exclusive with Empty floors
    LW.dayViewOn = !LW.dayViewOn;
    $('dayBtn').classList.toggle('on', LW.dayViewOn);
    $('dayLegend').style.display = LW.dayViewOn ? 'flex' : 'none';
    if (LW.dayViewOn) daySum();
    LW.view.setDaylight(LW.dayViewOn);
  };
})();
