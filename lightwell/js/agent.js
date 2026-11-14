// The agent. If backend/app.py is running it streams real agent steps (Claude + deepagents, or the backend's
// deterministic plan when no Anthropic key is set). Otherwise it runs the same plan in the browser.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id);
  const WHO = { Planner: '#f5b942', Map: '#57c3bd', CoStar: '#b48ae0', Vexcel: '#57c3bd', Matterport: '#8fb0ff',
    Feasibility: '#e0b35a', Safety: '#ff9f6b', Forensics: '#ef8796', Review: '#c7cdda', Agent: '#f5b942', Tool: '#8f9ab0' };
  LW.log = function (who, text) {
    const d = document.createElement('div'); d.className = 'step';
    d.innerHTML = `<span class="who" style="background:${WHO[who] || '#8f9ab0'}">${who.toUpperCase()}</span><span>${text}</span>`;
    $('log').appendChild(d); d.scrollIntoView({ block: 'nearest' });
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const backendUrl = () => ((window.LIGHTWELL_CONFIG || {}).BACKEND_URL || '').replace(/\/$/, '');
  const agent = LW.agent = { backend: null };

  agent.checkBackend = async function () {
    const url = backendUrl(); let info = null;
    if (url) try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(url + '/api/health', { signal: ctl.signal }); clearTimeout(t);
      if (r.ok) info = await r.json();
    } catch (e) { /* backend not running */ }
    agent.backend = info;
    $('mode').textContent = !info ? 'Offline demo agent (start backend/app.py for the real agent)'
      : info.llm ? `Backend agent: ${info.model} via deepagents` : 'Backend running without an Anthropic key: deterministic plan';
    $('mode').className = 'mode ' + (info ? (info.llm ? 'live' : 'half') : 'off');
    $('run').disabled = false; $('run').textContent = 'Run agent';
  };

  function parsePrompt(txt) {
    const m = txt.match(/\$\s?(\d{2,3})\s?k/i); if (m) $('cap').value = m[1];
    const f = txt.match(/(\d{2})\s?(ft|feet)/i); if (f && +f[1] >= 25 && +f[1] <= 40) $('dist').value = f[1];
    if (/no lightwell|without (a )?lightwell/i.test(txt)) $('lw').checked = false;
    LW.labels();
  }
  function reset() {
    $('log').innerHTML = ''; LW.scored = false; LW.flagsShown = false;
    LW.B.forEach(b => { b.score = null; b.plan = null; }); LW.B.forEach(b => LW.view.paint(b)); LW.view.setFlags([]);
  }
  async function reveal() {
    LW.B.forEach(LW.analyze); LW.scored = true;
    for (const b of [...LW.B].sort((a, c) => a.score - c.score)) { LW.view.paint(b); await sleep(20); }
    LW.refresh();
  }

  // ---------------- in-browser plan ----------------
  async function runLocal() {
    const S = LW.S, B = LW.B;
    LW.log('Planner', `Goal: downtown offices that can become homes for under ${LW.money(S.cap)} each. Plan: map → market → aerial → interiors → feasibility → fire safety → forensics → review → memo.`); await sleep(700);
    LW.log('Map', `Loaded ${LW.fmt(LW.geo.features.length)} real building footprints. Kept ${B.length} towers 40 m+ with usable floor plates.`);
    LW.view.overview(); await sleep(1100);
    const n = k => B.filter(b => b.real[k]).length, sim = k => n(k) ? `${n(k)} real, ${B.length - n(k)} <i>simulated</i>` : '<i>Simulated</i> for all towers';
    LW.log('CoStar', `Occupancy, lease and age records: ${sim('market')}.`); await sleep(600);
    LW.log('Vexcel', `Car counts from aerial captures: ${sim('aerial')}.`); await sleep(600);
    LW.log('Matterport', n('interior') ? `Floor plates from ${n('interior')} real scans; the rest use their real footprint.`
      : `<i>Simulated:</i> ${B.filter(b => b.scanned).length} towers have scans; the rest use their real footprint.`); await sleep(600);
    await reveal();
    const costOK = B.filter(b => b.plan.cpu <= S.cap && b.plan.homes >= 20);
    LW.log('Feasibility', `Ran the ${S.u} ft daylight test on every real floor plate. ${costOK.length} towers fit under the cap; lightwells rescue ${costOK.filter(b => b.plan.lw).length}.`); await sleep(800);
    const fails = costOK.filter(b => b.plan.safety.status === 'fail'), checks = B.filter(b => b.pass && b.plan.safety.status === 'check');
    LW.log('Safety', `Checked stair distances and sprinklers. ${fails.length} cost-passing towers fail the fire screen; ${checks.length} need design work.`); await sleep(800);
    LW.flagsShown = true; LW.refresh();
    const fl = B.filter(b => b.phantom), flReal = fl.filter(b => b.real.market && b.real.aerial).length;
    LW.log('Forensics', `${fl.length} hidden-vacancy signals (red dots) to verify, ${flReal ? flReal + ' on real data' : 'all on simulated data'}.`); await sleep(800);
    const pass = B.filter(b => b.pass), best = [...pass].sort((a, c) => c.score - a.score)[0];
    if (best) LW.log('Planner', `Leading candidate: ${best.label}.`);
    LW.log('Review', `Kept ${pass.length} towers.${fails.length ? ` Dropped ${fails.map(b => b.id).join(', ')} for fire safety.` : ''} Ranking checked against the cost cap.`); await sleep(700);
    return best;
  }

  // ---------------- backend plan (SSE over fetch) ----------------
  async function runBackend() {
    const payload = { prompt: $('prompt').value, constraints: { ...LW.S }, assumptions: { ...LW.A },
      buildings: LW.B.map(b => ({ id: b.id, W: b.W, D: b.D, heightM: b.heightM, floors: LW.eff(b, 'floors'), f2f: LW.eff(b, 'f2f'),
        year: LW.eff(b, 'year'), rep: LW.eff(b, 'rep'), obs: b.obs, scanned: b.scanned, core: b.core, real: b.real })) };
    const r = await fetch(backendUrl() + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
        } else if (ev.type === 'done') result = ev;
        else if (ev.type === 'error') throw new Error(ev.message);
      }
    }
    if (!LW.scored) await reveal();
    LW.flagsShown = true; LW.refresh();
    return result && result.top ? LW.B.find(b => b.id === result.top) : null;
  }

  agent.run = async function () {
    if (agent.running || !LW.B) return; agent.running = true; $('run').disabled = true;
    parsePrompt($('prompt').value); reset();
    let best = null;
    try {
      if (agent.backend) best = await runBackend();
      else best = await runLocal();
    } catch (e) {
      reset(); agent.backend = null;
      LW.log('Planner', `Backend failed (${e.message}). Switched to the in-browser plan.`);
      best = await runLocal();
    }
    if (best) {
      LW.log('Planner', `Top pick: ${best.label}, ${LW.fmt(best.plan.homes)} homes at ${LW.money(best.plan.cpu)} each (fire screen: ${best.plan.safety.status}). Memo is ready for your approval.`);
      LW.onSelect(best, true); LW.openPlate(best);
    } else LW.log('Planner', 'Nothing passes. Raise the cost cap, widen the window rule or allow lightwell cuts.');
    agent.running = false; $('run').disabled = false;
  };
  $('run').onclick = agent.run;
})();
