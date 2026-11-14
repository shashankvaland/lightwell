// The agent. If backend/app.py is running it streams real agent steps (Claude + deepagents, or the backend's
// deterministic plan when no Anthropic key is set). Otherwise it runs the same plan in the browser.
// Both paths: parse the request into a brief → screen → review evidence → ask the user for the one measurement that
// would change the decision → re-rank → draft the memo from the reviewed result.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id);
  const WHO = { Planner: '#f5b942', Map: '#57c3bd', CoStar: '#b48ae0', Vexcel: '#57c3bd', Matterport: '#8fb0ff',
    Feasibility: '#e0b35a', Safety: '#ff9f6b', Forensics: '#ef8796', Review: '#c7cdda', Agent: '#f5b942', Tool: '#8f9ab0', You: '#5fd38a' };
  LW.log = function (who, text) {
    const d = document.createElement('div'); d.className = 'step';
    d.innerHTML = `<span class="who" style="background:${WHO[who] || '#8f9ab0'}">${who.toUpperCase()}</span><span>${text}</span>`;
    $('log').appendChild(d); d.scrollIntoView({ block: 'nearest' }); return d;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // The backend defaults to localhost:8000; set BACKEND_URL: "" in config.js to force the offline agent.
  const backendUrl = () => { const c = window.LIGHTWELL_CONFIG || {}; return (c.BACKEND_URL != null ? c.BACKEND_URL : 'http://localhost:8000').replace(/\/$/, ''); };
  const agent = LW.agent = { backend: null };

  function setMode(kind, text) { $('mode').textContent = text; $('mode').className = 'mode ' + kind; }
  agent.checkBackend = async function () {
    const url = backendUrl(); let info = null;
    if (url) try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(url + '/api/health', { signal: ctl.signal }); clearTimeout(t);
      if (r.ok) info = await r.json();
    } catch (e) { /* backend not running */ }
    agent.backend = info;
    if (!info) setMode('off', url ? `Offline agent in the browser (no backend at ${url})` : 'Offline agent in the browser (backend disabled in config.js)');
    else setMode(info.llm ? 'live' : 'half', info.llm ? `Backend agent: ${info.model} via deepagents` : 'Backend running without an Anthropic key: fixed plan, same tools');
    $('run').disabled = false; $('run').textContent = 'Run agent';
  };

  // ---------------- the brief: request → validated constraints ----------------
  const LAYERS = { market: 'CoStar', aerial: 'Vexcel', interior: 'Matterport' };
  LW.parseBrief = function (txt, base) {
    const S = { ...base, require: [...(base.require || [])] }, got = [];
    let m = txt.match(/\$\s?(\d{2,3})\s?k\b/i) || txt.match(/\$\s?(\d{3}),?000\b/) || txt.match(/(?:under|below|less than|max(?:imum)?)\s+(\d{3})\s?k\b/i);
    if (m) { const v = Math.max(150, Math.min(450, +m[1])) * 1000; S.cap = v; got.push(`cost cap ${LW.money(v)}/home${+m[1] * 1000 !== v ? ' (limited to the 150-450k range)' : ''}`); }
    m = txt.match(/(\d{2})\s?(?:ft|feet|foot|')\s*(?:of|from)?\s*(?:a|the)?\s*window/i) || txt.match(/(?:within|under)\s+(\d{2})\s?(?:ft|feet)/i);
    if (m && +m[1] >= 25 && +m[1] <= 40) { S.u = +m[1]; got.push(`homes within ${S.u} ft of a window`); }
    m = txt.match(/(?:at least|minimum(?: of)?|min\.?|over|more than|no fewer than)\s+(\d{1,4})\s+(?:homes|units|apartments)/i) || txt.match(/(\d{1,4})\s?\+\s*(?:homes|units|apartments)/i);
    if (m) { S.minHomes = Math.max(1, Math.min(5000, +m[1])); got.push(`at least ${S.minHomes} homes`); }
    if (/\bno lightwells?\b|without (?:a )?lightwells?|don'?t cut|no (?:courtyard|cuts?)\b/i.test(txt)) { S.allowLW = false; got.push('no lightwell cuts'); }
    if (/(?:ignore|without|exclude|don'?t use|skip|no)\s+(?:the\s+)?(?:parking|aerial|car)/i.test(txt)) { S.useParking = false; got.push('parking evidence ignored'); }
    if (/\b(?:only|must|require[sd]?|with)\b[^.]*\b(?:real|verified|measured)\b|real data only/i.test(txt)) {
      const want = [];
      if (/costar|leas|market|real data|verified/i.test(txt)) want.push('market');
      if (/matterport|scan|interior|measured/i.test(txt)) want.push('interior');
      if (/vexcel|aerial count|car count/i.test(txt) && S.useParking) want.push('aerial');
      S.require = [...new Set([...S.require, ...(want.length ? want : ['market'])])];
      got.push('real ' + S.require.map(k => LAYERS[k]).join(' + ') + ' data required');
    }
    return { S, got };
  };
  LW.briefText = S => `≤ ${LW.money(S.cap)}/home · ${S.u} ft window rule · ${S.minHomes}+ homes · ${S.allowLW ? 'lightwells allowed' : 'no lightwells'}`
    + `${S.useParking ? '' : ' · parking ignored'}${S.require.length ? ' · real ' + S.require.map(k => LAYERS[k]).join(' + ') + ' required' : ''}`;

  // Fingerprint of everything that changes a result. A memo is only "reviewed" while this matches.
  LW.inputsKey = () => JSON.stringify({ S: LW.S, A: LW.A, mode: LW.dataMode,
    o: LW.B.filter(b => Object.keys(b.overrides).length || b.forceLW != null).map(b => [b.id, b.overrides, b.forceLW]) });

  function reset() {
    $('log').innerHTML = ''; LW.scored = false; LW.flagsShown = false; LW.reviewed = null;
    LW.B.forEach(b => { b.score = null; b.plan = null; }); LW.B.forEach(b => LW.view.paint(b)); LW.view.setFlags([]);
  }
  async function reveal() {
    LW.B.forEach(LW.analyze); LW.scored = true;
    for (const b of [...LW.B].sort((a, c) => a.score - c.score)) { LW.view.paint(b); await sleep(20); }
    LW.refresh();
  }
  const passing = () => LW.B.filter(b => b.pass).sort((a, c) => c.score - a.score);

  // ---------------- asking the user for a measurement ----------------
  // Renders a small form in the agent log; resolves with the raw answer, or null if skipped.
  LW.askUser = function (q) {
    return new Promise(resolve => {
      const d = LW.log('Planner', `<b>Measurement needed: ${q.tower}, ${q.label}.</b> ${q.why}<br>Current value: ${q.current} (${q.source || 'estimate'}).
        <div class="ask"><input type="text" placeholder="${q.placeholder || ''}"><button class="primary">Use measurement</button><button>Skip</button></div><div class="askErr"></div>`);
      d.classList.add('asking');
      const inp = d.querySelector('input'), [use, skip] = d.querySelectorAll('button'), err = d.querySelector('.askErr');
      const b = LW.B.find(x => x.id === q.tower); if (b) LW.onSelect(b, true);
      const done = v => { d.querySelector('.ask').remove(); err.remove(); d.classList.remove('asking');
        LW.log('You', v == null ? 'Skipped: keep the estimate.' : `Measured ${q.label}: ${v}${q.unit === '%' ? '%' : q.field === 'f2f' ? ' ft' : ''}`); resolve(v); };
      use.onclick = () => { const v = inp.value.trim(); if (!v) return;
        try { if (b) LW.parseMeasurement(b, q.field, v); done(v); } catch (e) { err.textContent = e.message; } };
      inp.onkeydown = e => { if (e.key === 'Enter') use.click(); };
      skip.onclick = () => done(null); setTimeout(() => inp.focus(), 50);
    });
  };

  // ---------------- in-browser plan ----------------
  async function runLocal() {
    const S = LW.S, B = LW.B;
    LW.log('Planner', `Brief: ${LW.briefText(S)}. Plan: map → market → aerial → interiors → feasibility → fire screen → occupancy → review evidence → memo.`); await sleep(600);
    LW.log('Map', `Loaded ${LW.fmt(LW.geo.features.length)} real building footprints. Kept ${B.length} towers 40 m+ with usable floor plates.`);
    LW.view.overview(); await sleep(900);
    const n = k => B.filter(b => b.real[k]).length, sim = k => n(k) ? `${n(k)} imported real, ${B.length - n(k)} <i>${LW.dataMode === 'demo' ? 'simulated' : 'missing'}</i>`
      : `<i>${LW.dataMode === 'demo' ? 'Simulated' : 'Missing'}</i> for all towers`;
    LW.log('CoStar', `Leasing and age records: ${sim('market')}.`); await sleep(500);
    LW.log('Vexcel', `Parking counts from aerial captures: ${sim('aerial')}.${S.useParking ? '' : ' The brief ignores parking.'}`); await sleep(500);
    LW.log('Matterport', n('interior') ? `Floor plates from ${n('interior')} real scans; the rest use their real footprint and an assumed core.`
      : 'No scans loaded: plates from real footprints, cores assumed.'); await sleep(500);
    await reveal();
    const costOK = B.filter(b => b.plan.cpu <= S.cap && b.plan.homes >= S.minHomes);
    LW.log('Feasibility', `Ran the ${S.u} ft daylight test on every floor plate. ${costOK.length} towers fit under the cap with ${S.minHomes}+ homes; lightwells rescue ${costOK.filter(b => b.plan.lw).length}.`); await sleep(700);
    const fails = costOK.filter(b => b.plan.safety.status === 'fail'), checks = B.filter(b => b.pass && b.plan.safety.status === 'check');
    LW.log('Safety', `Preliminary fire screen (estimates, not a code review): ${fails.length} likely blockers among cost-passing towers; ${checks.length} need design work.`); await sleep(700);
    LW.flagsShown = true; LW.refresh();
    const fl = B.filter(b => b.phantom), flReal = fl.filter(b => b.real.market && b.real.aerial).length;
    LW.log('Forensics', S.useParking ? `${fl.length} occupancy discrepancies to investigate (red dots), ${flReal ? flReal + ' on real data' : 'all on simulated data'}.` : 'Parking ignored by the brief: no occupancy comparison.'); await sleep(700);
    const review = [];
    let top = passing().slice(0, 3);
    if (top.length) {
      const gaps = LW.reviewGaps(B, top.map(b => b.id)), rel = gaps.filter(g => g.relevant);
      const msg = rel.length ? `${rel[0].id}'s ${rel[0].label} is ${rel[0].current}, ${rel[0].basis}. At ${rel[0].what_if}, ${rel[0].id} ${rel[0].decision}.`
        : 'No missing value would change the shortlist; remaining estimates are noted in the memo.';
      review.push(msg); LW.log('Review', msg); await sleep(500);
      const g = rel.find(x => x.id === top[0].id);
      if (g) {
        const raw = await LW.askUser({ tower: g.id, field: g.field, label: g.label, unit: g.unit, current: g.current, source: g.source,
          why: `At ${g.what_if}, ${g.id} ${g.decision}.`, placeholder: LW.WHATIF[g.field].ph });
        if (raw != null) {
          const b = B.find(x => x.id === g.id), before = passing()[0], old = b.score;
          b.overrides[g.field] = LW.parseMeasurement(b, g.field, raw);
          B.forEach(LW.analyze); LW.refresh();
          const now = passing()[0];
          const change = `${b.id}: score ${old} → ${b.score}${b.pass ? '' : ', now fails: ' + b.why.join(', ')}. New leader: ${now ? now.label : 'none'}${now && before && now !== before ? ` (was ${before.label})` : ''}`;
          review.push(`You measured ${b.id}'s ${g.label} at ${raw}. ${change}.`);
          LW.log('Review', `Re-ranked with your measurement. ${change}.`);
        } else review.push(`${g.id}'s ${g.label} is still an estimate.`);
      }
    }
    const best = passing()[0];
    LW.log('Review', `Kept ${passing().length} towers.${fails.length ? ` Dropped ${fails.map(b => b.id).join(', ')} as likely fire-safety blockers.` : ''} Ranking checked against the brief.`); await sleep(500);
    if (best) LW.reviewed = { top: best.id, summary: LW.summary(best), rationale: '', review, key: LW.inputsKey(), at: new Date(), by: 'the in-browser agent' };
    return best;
  }

  // ---------------- backend plan (SSE over fetch) ----------------
  function payload() {
    const f = ['rep', 'year', 'obs', 'f2f', 'core', 'plate', 'floors'];
    return { prompt: $('prompt').value, constraints: { ...LW.S }, assumptions: { ...LW.A }, key: LW.inputsKey(),
      buildings: LW.B.map(b => ({ id: b.id, W: b.W, D: b.D, heightM: b.heightM, floors: LW.eff(b, 'floors'), f2f: LW.eff(b, 'f2f'),
        year: LW.eff(b, 'year'), rep: LW.eff(b, 'rep'), obs: b.obs || [], scanned: b.scanned, core: LW.eff(b, 'core'),
        forceLW: b.forceLW, real: b.real, src: Object.fromEntries(f.map(k => [k, LW.srcOf(b, k)])) })) };
  }
  async function runBackend() {
    const url = backendUrl();
    const r = await fetch(url + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
    if (!r.ok || !r.body) throw new Error('Backend returned ' + r.status);
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', result = null;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'step') {
          LW.log(ev.who || 'Agent', ev.text);
          if (ev.stage === 'scored' && !LW.scored) await reveal();
          if (ev.stage === 'flags') { LW.flagsShown = true; LW.refresh(); }
          const b = ev.ids && ev.ids.length ? LW.B.find(x => x.id === ev.ids[0]) : null; if (b) LW.onSelect(b, true);
        } else if (ev.type === 'brief') { LW.setBrief(ev.brief); if (LW.scored) LW.analyzeAll(); }
        else if (ev.type === 'ask') {
          // don't block the stream reader: answer in the background
          LW.askUser({ ...ev, tower: ev.tower, source: (LW.B.find(x => x.id === ev.tower) && LW.srcOf(LW.B.find(x => x.id === ev.tower), ev.field)) })
            .then(v => fetch(url + '/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session: ev.session, ask_id: ev.ask_id, value: v }) }).catch(() => {}));
        } else if (ev.type === 'done') result = ev;
        else if (ev.type === 'error') throw new Error(ev.message);
      }
    }
    if (!result) throw new Error('stream ended without a result');
    // Apply what the agent changed, so the page shows exactly what the agent reviewed.
    LW.setBrief(result.brief);
    for (const [id, fields] of Object.entries(result.corrections || {})) {
      const b = LW.B.find(x => x.id === id); if (b) Object.assign(b.overrides, fields);
    }
    if (!LW.scored) await reveal(); else LW.B.forEach(LW.analyze);
    LW.flagsShown = true; LW.refresh();
    const diff = LW.B.filter(b => { const r = result.results[b.id]; return r && (r.score !== b.score || r.homes !== b.plan.homes || r.passes !== b.pass); });
    if (diff.length) LW.log('Review', `Warning: browser and backend disagree on ${diff.length} towers (${diff.slice(0, 3).map(b => b.id).join(', ')}). Re-run the agent.`);
    const best = result.top ? LW.B.find(b => b.id === result.top) : null;
    if (best) LW.reviewed = { top: best.id, summary: result.reviewed, rationale: result.memo || '', review: result.review || [], key: LW.inputsKey(), at: new Date(),
      by: agent.backend && agent.backend.llm ? `${agent.backend.model} via deepagents` : 'the backend agent' };
    return best;
  }

  agent.run = async function () {
    if (agent.running || !LW.B) return; agent.running = true; $('run').disabled = true;
    const { S, got } = LW.parseBrief($('prompt').value, LW.S); LW.setBrief(S);
    reset();
    LW.log('Planner', got.length ? `Read your request as: ${got.join('; ')}.` : 'No constraints found in the request; using the brief panel as set.');
    let best = null;
    try {
      if (agent.backend) best = await runBackend();
      else best = await runLocal();
    } catch (e) {
      reset(); agent.backend = null;
      setMode('off', `Backend failed (${e.message}): running the offline agent in the browser`);
      LW.log('Planner', `Backend failed (${e.message}). Switched to the in-browser plan.`);
      best = await runLocal();
    }
    if (best) {
      LW.log('Planner', `Top pick: ${best.label}, ${LW.fmt(best.plan.homes)} homes at ${LW.money(best.plan.cpu)} each (fire screen: ${LW.SAFE_LABEL[best.plan.safety.status].toLowerCase()}). Memo is ready for your approval.`);
      LW.onSelect(best, true); LW.openPlate(best);
    } else LW.log('Planner', 'Nothing passes the brief. Raise the cost cap, lower the minimum home count, widen the window rule or allow lightwell cuts.');
    agent.running = false; $('run').disabled = false; LW.refresh();
  };
  $('run').onclick = agent.run;
})();
