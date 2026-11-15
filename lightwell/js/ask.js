// Ask Lightwell: a chat about the results, in the dashboard.
// With an Anthropic key on the backend, Claude answers through deepagents with the same tools as the run
// (POST /api/ask, streamed). Without one, the browser answers the common questions itself from the same engine:
// a tower, why it passes or fails, comparisons, what-ifs on the brief, the Texas fast-track, tenant moves, and the
// data scout (estimate gaps, which towers to request from CoStar). Tower ids in answers are links to the map.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id), esc = LW.esc;
  const pct = x => Math.round(x * 100) + '%', history = [];
  const passing = () => LW.B.filter(b => b.pass).sort((a, c) => c.score - a.score);
  const ranked = () => [...LW.B].sort((a, c) => (c.pass - a.pass) || c.score - a.score);
  const rankOf = b => ranked().indexOf(b) + 1;
  const link = b => `<a href="#" data-t="${b.id}">${esc(b.label)}</a>`;
  const linkify = txt => esc(txt).replace(/\bHOU-\d{2,3}\b/g, id => LW.B.find(b => b.id === id) ? `<a href="#" data-t="${id}">${id}</a>` : id)
    .replace(/\n/g, '<br>');

  function msg(role, html) {
    const d = document.createElement('div'); d.className = 'cm ' + role; d.innerHTML = html;
    $('chat').appendChild(d); d.scrollIntoView({ block: 'nearest' }); return d;
  }
  function towersIn(q) {
    const out = [];
    for (const m of q.matchAll(/\bHOU[-\s]?(\d{1,3})\b/gi)) { const b = LW.B.find(x => x.id === 'HOU-' + String(+m[1]).padStart(2, '0')); if (b && !out.includes(b)) out.push(b); }
    const lq = q.toLowerCase();
    for (const b of LW.B) if (b.label !== b.id && b.label.length > 5 && lq.includes(b.label.toLowerCase()) && !out.includes(b)) out.push(b);
    if (/\b(top|first|best|leading) (two|2)\b/i.test(q)) for (const b of passing().slice(0, 2)) if (!out.includes(b)) out.push(b);
    if (!out.length && /\b(top pick|leader|number one|#1|the winner|top tower)\b/i.test(q) && passing()[0]) out.push(passing()[0]);
    if (!out.length && /\b(this|it|selected|that tower|this tower)\b/i.test(q) && LW.selected) out.push(LW.selected);
    return out;
  }
  async function ensureScored() { if (!LW.scored) await LW.agent.reveal(); }

  // ---------------- offline answers (same engine as the run) ----------------
  function explain(b) {
    const p = b.plan, ft = LW.fastTrack(b), sc = b.ev.scout && LW.srcOf(b, 'rep') === 'ESTIMATE' ? b.ev.scout : null;
    const srcs = ['rep', 'year', 'f2f', 'plate', 'core', 'vacant'].map(k => `${({ rep: 'leased', year: 'year built', f2f: 'floor-to-floor', plate: 'plate', core: 'core', vacant: 'empty floors' })[k]} <span class="tag ${LW.SRC_CLASS[LW.srcOf(b, k)] || 't-est'}">${LW.srcOf(b, k)}</span>`).join(' · ');
    return `<b>${link(b)}</b> ranks #${rankOf(b)} of ${LW.B.length} with a score of ${b.score}/100. `
      + (b.pass ? `It <b>passes</b> the brief: ${LW.fmt(p.homes)} homes at ${LW.money(p.cpu)} each, ${Math.round(p.daylitFrac * 100)}% daylit${p.lw ? ', with a lightwell' : ''}.`
        : `It <b>doesn't pass</b>: ${esc(b.why.join(', '))}. It would give ${LW.fmt(p.homes)} homes at ${LW.money(p.cpu)} each (cap ${LW.money(LW.S.cap)}).`)
      + ` Fire screen: ${LW.SAFE_LABEL[p.safety.status].toLowerCase()} (preliminary). Texas fast-track: ${LW.FT_LABEL[ft.status].toLowerCase()}${ft.status === 'shuffle' ? `, ${ft.short} more empty floors needed` : ''}.`
      + (sc ? ` Occupancy is a <b>scout estimate</b>: ${pct(sc.value)} (${pct(sc.lo)}–${pct(sc.hi)}, ${sc.confidence} confidence).` : '')
      + (() => { const r = LW.rentCheck(b); return !r ? '' : r.verdict === 'no_data' ? ` Needs about ${LW.usd(r.required)}/month rent per home (no CoStar rents loaded).`
        : ` Rent check: ${LW.RENT_LABEL[r.verdict].toLowerCase()} (needs ${LW.usd(r.required)}, market ${LW.usd(r.market)}).`; })()
      + (b.assumed.length ? `<br><i>Assumed:</i> ${esc(b.assumed.join('; '))}.` : '')
      + `<br><span class="srcs">${srcs}</span>`;
  }
  function compare(bs) {
    const rows = [['Rank', b => '#' + rankOf(b)], ['Score', b => b.score], ['Passes', b => b.pass ? 'yes' : 'no: ' + esc(b.why.join(', '))],
      ['Homes', b => LW.fmt(b.plan.homes)], ['Cost / home', b => LW.money(b.plan.cpu)], ['Daylit', b => Math.round(b.plan.daylitFrac * 100) + '%'],
      ['Fire screen', b => b.plan.safety.status], ['Fast-track', b => LW.FT_LABEL[LW.fastTrack(b).status]], ['Leased', b => (LW.eff(b, 'rep') == null ? '?' : pct(LW.eff(b, 'rep'))) + ' ' + LW.srcOf(b, 'rep')]];
    const best = bs.reduce((a, c) => ((c.pass - a.pass) || (c.score - a.score)) > 0 ? c : a);
    return `<table class="cmp"><tr><th></th>${bs.map(b => `<th>${link(b)}</th>`).join('')}</tr>`
      + rows.map(([k, f]) => `<tr><td>${k}</td>${bs.map(b => `<td>${f(b)}</td>`).join('')}</tr>`).join('') + '</table>'
      + `<b>${link(best)}</b> comes out ahead${best.pass ? '' : ', though it still fails the brief'}.`;
  }
  function whatIf(q) {
    const { S, got } = LW.parseBrief(q, LW.S); if (!got.length) return null;
    const S0 = LW.S, now = new Set(passing().map(b => b.id));
    LW.S = S; const alt = LW.B.map(b => LW.analyze({ ...b, overrides: { ...b.overrides } })); LW.S = S0;
    const then = alt.filter(b => b.pass), ids = new Set(then.map(b => b.id)), lead = then.sort((a, c) => c.score - a.score)[0];
    const add = [...ids].filter(id => !now.has(id)), drop = [...now].filter(id => !ids.has(id));
    const L = id => link(LW.B.find(b => b.id === id));
    LW.pendingBrief = S;
    return `With ${esc(got.join('; '))}: <b>${then.length}</b> towers would pass (now ${now.size}).`
      + (add.length ? ` Newly passing: ${add.slice(0, 6).map(L).join(', ')}${add.length > 6 ? ` +${add.length - 6}` : ''}.` : '')
      + (drop.length ? ` No longer passing: ${drop.slice(0, 6).map(L).join(', ')}.` : '')
      + (lead ? ` Leader would be ${L(lead.id)}${passing()[0] && passing()[0].id !== lead.id ? ` (now ${L(passing()[0].id)})` : ''}.` : '')
      + ` Nothing has changed yet. <button class="mini" data-apply="1">Apply to the brief</button>`;
  }
  function scout() {
    const est = LW.scoutGaps(LW.B);
    if (!est.length) {
      const sim = LW.B.filter(b => LW.srcOf(b, 'rep') === 'SIMULATED').length, done = LW.B.filter(b => b.ev.scout).length;
      return done ? `Already estimated ${done} towers; their cards show the range and sources.`
        : sim ? `Demo fill-in is on, so the ${sim} towers without CoStar records use simulated values. Switch to <b>Real data only</b> and I'll estimate their occupancy from the CoStar towers instead.`
          : 'Every tower already has a leasing record: nothing to estimate.';
    }
    const before = passing()[0];
    LW.applyEstimates(est); LW.analyzeAll(); LW.refresh();
    const ref = new Set(est.flatMap(e => e.neighbours.map(x => x.id))).size, med = est.filter(e => e.confidence === 'medium').length;
    const top = est.map(e => LW.B.find(b => b.id === e.id)).sort((a, c) => c.score - a.score).slice(0, 3), after = passing()[0];
    return `Estimated percent leased for <b>${est.length}</b> towers with no CoStar record, from ${ref} comparable CoStar towers (nearby, similar height), pulled toward the downtown average: ${med} medium, ${est.length - med} low confidence.`
      + ` Highest-scoring now: ${top.map(b => `${link(b)} (${pct(LW.eff(b, 'rep'))} leased est.)`).join(', ')}.`
      + (after && before && after !== before ? ` The leader changed: ${link(after)} (was ${link(before)}).` : '')
      + ' They\'re tagged ESTIMATE on each card and still don\'t count as real CoStar data.';
  }
  function requests() {
    const pri = LW.dataPriority(LW.B, 5); LW.dataRequests = pri;
    if (!pri.length) return 'No missing value would change a decision right now, so there is nothing urgent to request from CoStar.';
    return `The towers most worth asking CoStar about next, where the missing data would change the decision:<ol>`
      + pri.map(p => { const b = LW.B.find(x => x.id === p.id); return `<li>${link(b)}: ${esc(p.reasons.join('; '))}. Need: ${esc(p.need.join(', '))}.</li>`; }).join('') + '</ol>';
  }
  function moves(b) {
    const plan = LW.planMoves(b, LW.B, 'fast'); if (!plan) return `${link(b)} has no floor-by-floor data, so I can't plan tenant moves.`;
    if (!plan.moves.length) return `${link(b)} already has enough empty floors for the Texas 65% fast-track: no tenant moves needed.`;
    const ch = LW.challengePlan(b, plan, LW.B); LW.showMoves(plan, ch, true);
    const top = ch.risks.filter(r => r.level !== 'low');
    return `To reach 65% homes at ${link(b)}: move ${plan.moves.length} tenants (${plan.freed_floors} floors) into ${plan.receivers.map(id => link(LW.B.find(x => x.id === id))).join(', ')}, `
      + `about ${LW.bigMoney(plan.cost)} in incentives${plan.cost_per_home_gained ? ` (${LW.money(plan.cost_per_home_gained)} per home unlocked)` : ''}. `
      + `Red team: <b>${LW.VERDICT[ch.verdict].toLowerCase()}</b>.${top.length ? ' ' + esc(top[0].text) : ''} The arcs are on the map.`;
  }
  function rentAnswer(b) {
    const r = LW.rentCheck(b); if (!r) return `${link(b)} has no homes under this brief, so there is no rent to check.`;
    if (r.verdict === 'no_data') return `${link(b)} needs about <b>${LW.usd(r.required)}/month</b> per home to pay back its conversion (${LW.money(b.plan.cpu)} per home at a ${Math.round(LW.A.yieldOnCost * 1000) / 10}% yield). No CoStar rents are loaded to compare: run <code>backend/rent_comps.py</code> on the CoStar kit.`;
    return `${link(b)}: <b>${LW.RENT_LABEL[r.verdict]}.</b> It needs ${LW.usd(r.required)}/month per home; ${r.n} CoStar listings within ${LW.fmt(r.radius_m)} m ask about <b>${LW.usd(r.market)}</b> `
      + `(${r.types.map(x => `${LW.RENT_TYPES[x.t]} ${LW.usd(x.rent)}`).join(', ')}). The market supports up to ${LW.money(r.supports_cost_per_home)} per home. `
      + `A household needs about ${LW.money(r.income_needed)}/yr to afford it, ${pct(r.income_share)} of Houston's median income.`;
  }
  function localAnswer(q) {
    const ts = towersIn(q);
    if (/\b(estimate|fill|guess|infer)\b/i.test(q) || /\bscout\b/i.test(q)) return { html: scout(), ids: [] };
    if (/\b(which|what|where)\b.*\b(costar|data|request|missing|gaps?)\b|\bdata (gaps?|requests?)\b|\bpriorit/i.test(q)) return { html: requests(), ids: (LW.dataRequests || []).map(x => x.id) };
    if (/what if|what happens if|\bif (the )?(cap|we)\b|\bwould\b.*\b(cap|pass)\b/i.test(q)) { const h = whatIf(q); if (h) return { html: h, ids: [] }; }
    if (/\b(rents?|afford\w*|income|pay back|market rent)\b/i.test(q)) {
      const bs = ts.length ? ts.slice(0, 3) : passing().slice(0, 3);
      if (!bs.length) return { html: 'Nothing passes the brief, so there is no tower to check rents for.', ids: [] };
      return { html: bs.map(rentAnswer).join('<hr>'), ids: bs.map(b => b.id) };
    }
    if (ts.length >= 2 && /compar|\bvs\.?\b|versus|better|differ/i.test(q)) return { html: compare(ts.slice(0, 4)), ids: ts.map(b => b.id) };
    if (ts.length && /tenant|move|shuffle|unlock/i.test(q)) return { html: moves(ts[0]), ids: [ts[0].id] };
    if (ts.length && /fast.?track|65|sb ?840|texas|law/i.test(q)) {
      const b = ts[0], ft = LW.fastTrack(b);
      return { html: `${link(b)}: <b>${LW.FT_LABEL[ft.status]}</b>. ${ft.floors} floors, ${ft.need} must be homes for 65%; ${ft.free ?? '?'} are empty now${ft.short ? `, so ${ft.short} more must be freed` : ''}. Age: ${ft.ageKnown ? ft.age + ' years' : 'unknown (needs 5+)'}. A screen, not legal advice.`, ids: [b.id] };
    }
    if (ts.length) return { html: ts.slice(0, 2).map(explain).join('<hr>'), ids: ts.map(b => b.id) };
    if (/\b(best|top|recommend|which tower|where should|pick)\b/i.test(q)) {
      const P = passing().slice(0, 3);
      return P.length ? { html: `Top towers under your brief:<ol>${P.map(b => `<li>${link(b)}: ${LW.fmt(b.plan.homes)} homes at ${LW.money(b.plan.cpu)}, score ${b.score}, fast-track ${LW.FT_LABEL[LW.fastTrack(b).status].toLowerCase()}.</li>`).join('')}</ol>`, ids: P.map(b => b.id) }
        : { html: 'Nothing passes the brief right now. Try a what-if, e.g. "what if the cap were $350k?"', ids: [] };
    }
    if (/how many|homes|carbon|co2|total/i.test(q)) {
      const P = passing(), h = P.reduce((s, b) => s + b.plan.homes, 0), c = P.reduce((s, b) => s + b.plan.carbon, 0);
      return { html: `${P.length} of ${LW.B.length} towers pass the brief: <b>${LW.fmt(h)} homes</b> and about <b>${LW.fmt(c)} t CO₂e</b> of embodied carbon avoided versus building new.`, ids: P.map(b => b.id) };
    }
    return { html: `I can answer, offline: <b>a tower</b> ("tell me about HOU-07", "why does HOU-12 fail?"), <b>compare</b> ("compare HOU-03 and HOU-17"), <b>what-ifs</b> ("what if the cap were $350k?"),
      <b>Texas fast-track</b>, <b>tenant moves</b> and <b>rent / affordability</b> for a tower, and the <b>data scout</b> ("which towers need CoStar data?", "estimate the missing data"). With an Anthropic key on the backend, Claude answers any question with the same tools.`, ids: [] };
  }

  // ---------------- Claude through the backend ----------------
  async function backendAnswer(q, pending) {
    const A = LW.agent, url = A.backendUrl();
    const r = await fetch(url + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...A.payload(), question: q, history: history.slice(-6) }) });
    if (!r.ok || !r.body) throw new Error('backend returned ' + r.status);
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', ans = null;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data:')); buf = buf.slice(i + 2); if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'step') pending.insertAdjacentHTML('beforeend', `<div class="cstep"><b>${esc(ev.who)}</b> ${ev.text}</div>`);
        else if (ev.type === 'estimates') { LW.applyEstimates(ev.items); LW.analyzeAll(); LW.refresh(); }
        else if (ev.type === 'moves') LW.showMoves(ev.plan, null);
        else if (ev.type === 'brief') { LW.setBrief(ev.brief); LW.analyzeAll(); LW.refresh(); }
        else if (ev.type === 'answer') ans = ev;
        else if (ev.type === 'error') throw new Error(ev.message);
      }
    }
    if (!ans) throw new Error('no answer');
    if (ans.challenge && ans.moves) LW.showMoves(ans.moves, ans.challenge, true);
    return { html: linkify(ans.text) + `<div class="cby">${esc(ans.by)} via deepagents</div>`, ids: ans.ids || [], text: ans.text };
  }

  async function ask(q) {
    q = q.trim(); if (!q || ask.busy || !LW.B) return; ask.busy = true;
    msg('user', esc(q)); history.push({ role: 'user', text: q });
    const pending = msg('bot pending', '<span class="dots">Thinking</span>');
    let out;
    try {
      await ensureScored();
      const llm = LW.agent.backend && LW.agent.backend.llm;
      if (llm) { try { out = await backendAnswer(q, pending); } catch (e) { out = localAnswer(q); out.html += `<div class="cby">Claude was unavailable (${esc(e.message)}); answered offline.</div>`; } }
      else out = localAnswer(q);
    } catch (e) { out = { html: 'Something went wrong: ' + esc(e.message), ids: [] }; }
    pending.classList.remove('pending'); pending.innerHTML = out.html;
    history.push({ role: 'assistant', text: out.text || pending.textContent.slice(0, 1500) });
    const b = out.ids.length ? LW.B.find(x => x.id === out.ids[0]) : null; if (b) LW.onSelect(b, true);
    pending.scrollIntoView({ block: 'nearest' }); ask.busy = false;
  }
  LW.ask = ask;

  $('askForm').onsubmit = e => { e.preventDefault(); const v = $('askQ').value; $('askQ').value = ''; ask(v); };
  $('chat').addEventListener('click', e => {
    const t = e.target.closest('[data-t]');
    if (t) { e.preventDefault(); const b = LW.B.find(x => x.id === t.dataset.t); if (b) LW.onSelect(b, true); return; }
    if (e.target.dataset.apply && LW.pendingBrief) { LW.setBrief(LW.pendingBrief); LW.analyzeAll(); LW.refresh(); e.target.disabled = true; e.target.textContent = 'Applied'; LW.pendingBrief = null; }
  });
  const CHIPS = ['Which towers need CoStar data?', 'Estimate the missing data', 'Why is the top pick #1?', 'Compare the top two', 'Can people afford the top pick?', 'What if the cap were $350k?'];
  $('askChips').innerHTML = CHIPS.map(c => `<button type="button">${esc(c)}</button>`).join('');
  $('askChips').onclick = e => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); };
  // say who answers, once the backend check is done
  const mode = () => { const be = LW.agent.backend;
    $('askMode').textContent = be && be.llm ? `Answers from ${be.model} via deepagents, using the agent's tools.` : 'Answers offline in the browser from the same engine. With an Anthropic key, Claude answers any question.'; };
  mode(); setInterval(mode, 5000);
})();
