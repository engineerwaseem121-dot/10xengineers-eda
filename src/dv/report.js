'use strict';
/*
 * Standalone HTML dashboard: runs/<run-id>/report/index.html
 *   - all links relative (works from disk, in a browser and inside the VS Code webview)
 *   - data embedded; sim/build logs and triage notes embedded (capped) so they can be read in-page
 *   - no external resources (works offline; system fonts, hand-drawn SVG charts)
 * In VS Code, ext.js intercepts <a href> clicks to open files in the editor, so in-page navigation uses buttons only.
 */
const fs = require('fs');
const path = require('path');

const LOG_CAP = 24 * 1024;         // per embedded file
const LOG_BUDGET = 4 * 1024 * 1024; // all embedded files together

function readCapped(file, max) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    if (st.size <= max) return fs.readFileSync(file, 'utf8');
    const half = Math.floor(max / 2);
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(half), tail = Buffer.alloc(half);
    fs.readSync(fd, head, 0, half, 0);
    fs.readSync(fd, tail, 0, half, st.size - half);
    fs.closeSync(fd);
    return head.toString('utf8') + `\n… ${st.size - 2 * half} bytes omitted — open the full log …\n` + tail.toString('utf8');
  } catch (e) { return null; }
}

function embedLogs(runDir, res) {
  const logs = {};
  let used = 0;
  const add = rel => {
    if (!rel || logs[rel] !== undefined || used >= LOG_BUDGET) return;
    const txt = readCapped(path.join(runDir, rel), LOG_CAP);
    if (txt == null) return;
    logs[rel] = txt;
    used += txt.length;
  };
  // failures first (most useful), then builds, then passing runs
  (res.runs || []).filter(r => r.failureDir).forEach(r => { add(r.failureDir + '/triage.md'); add(r.dir && r.dir + '/sim.log'); });
  (res.builds || []).forEach(b => add(b.log));
  (res.runs || []).forEach(r => add(r.dir && r.dir + '/sim.log'));
  return logs;
}

const WAVE_CAP = 512 * 1024;         // per embedded VCD
const WAVE_BUDGET = 6 * 1024 * 1024; // all VCDs together

/** waveforms for the in-page viewer: failing runs first, each VCD up to WAVE_CAP */
function embedWaves(runDir, res) {
  const waves = {};
  let used = 0;
  const runs = (res.runs || []).filter(r => r.waves && r.dir);
  runs.sort((a, b) => (a.status === 'PASS') - (b.status === 'PASS'));
  for (const r of runs) {
    const rel = r.dir + '/waves.vcd';
    try {
      const st = fs.statSync(path.join(runDir, rel));
      if (st.size > WAVE_CAP || used + st.size > WAVE_BUDGET) { waves[rel] = null; continue; }   // null = too large to embed
      waves[rel] = fs.readFileSync(path.join(runDir, rel), 'utf8');
      used += st.size;
    } catch (e) { /* no dump */ }
  }
  return waves;
}

const isoOfId = id => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/.exec(id); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null; };
const secs = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return isFinite(x) && isFinite(y) ? (y - x) / 1000 : null; };

/** compact summary of the newest runs in runs/ (DV regressions and UVM runs) for the History / Compare views */
function history(root, cur) {
  const dir = path.join(root, 'runs');
  let ids = [];
  try { ids = fs.readdirSync(dir).filter(n => /^\d{8}-\d{6}/.test(n)).sort(); } catch (e) { /* none */ }
  ids = ids.slice(-40);
  if (!ids.includes(cur.meta.runId)) ids.push(cur.meta.runId);
  return ids.map(id => {
    const rd = path.join(dir, id);
    try {
      if (id === cur.meta.runId || fs.existsSync(path.join(rd, 'results.json'))) {
        const r = id === cur.meta.runId ? cur : JSON.parse(fs.readFileSync(path.join(rd, 'results.json'), 'utf8'));
        const t = r.totals || {};
        const fail = (t.fail || 0) + (t.timeout || 0);
        const kind = r.meta.kind || 'dv';
        return {
          id, kind, uvm: kind === 'uvm', cocotb: kind === 'cocotb', started: r.meta.started || isoOfId(id), sim: r.meta.simLabel, simId: r.meta.simulator, container: /container/.test(r.meta.simSource || ''),
          suite: r.meta.suite, runs: t.runs || 0, pass: t.pass || 0, fail, other: Math.max(0, (t.runs || 0) - (t.pass || 0) - fail),
          fpct: r.coverage && r.coverage.functional ? r.coverage.functional.pct : null, wall: secs(r.meta.started, r.meta.finished),
          report: id === cur.meta.runId || fs.existsSync(path.join(rd, 'report', 'index.html')),
          matrix: Object.fromEntries((r.runs || []).map(x => [`${x.test}#${x.seed}@${x.config}`, [x.status, x.time || 0]])),
          bins: Object.fromEntries((r.bins || []).map(b => [b.id, b.hits || 0]))
        };
      }
      if (fs.existsSync(path.join(rd, 'uvm_results.json'))) {
        const u = JSON.parse(fs.readFileSync(path.join(rd, 'uvm_results.json'), 'utf8'));
        const fail = u.results.filter(x => x.status === 'FAIL' || x.status === 'TIMEOUT').length;
        return {
          id, kind: 'uvm', started: isoOfId(id), sim: u.simLabel, simId: u.sim, container: /container|docker/i.test(JSON.stringify(u.results.slice(0, 1))) || u.sim === 'verilator',
          suite: 'UVM', runs: u.totals.runs, pass: u.totals.pass, fail, other: Math.max(0, u.totals.runs - u.totals.pass - fail), fpct: null, wall: null,
          report: false, uvm: true, codePct: u.coverage && u.coverage.code ? u.coverage.code.pct : null,
          matrix: Object.fromEntries(u.results.map(x => [`${x.test}#${x.seed}`, [x.status, (x.ms || 0) / 1000]])), bins: {}
        };
      }
    } catch (e) { /* unreadable run */ }
    return null;
  }).filter(Boolean);
}

/** newest sign-off result in runs/ (summary for the Overview "Sign-off" panel) */
function latestSignoff(root) {
  try {
    const ids = fs.readdirSync(path.join(root, 'runs')).filter(n => /-signoff$/.test(n) && fs.existsSync(path.join(root, 'runs', n, 'signoff.json'))).sort();
    if (!ids.length) return null;
    const id = ids[ids.length - 1];
    const s = JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'signoff.json'), 'utf8'));
    const r = s.results || {};
    const facts = {};
    if (r.lint) facts.lint = r.lint.state === 'unavailable' ? 'not run' : `${r.lint.errors} errors · ${r.lint.warnings} warnings`;
    if (r.synth) facts.synth = r.synth.state === 'done' ? `${r.synth.cells} cells · ${r.synth.flipflops} FFs · ${r.synth.latches} latches · depth ${r.synth.logicDepth}` : (r.synth.message || r.synth.state);
    if (r.lec) facts.lec = r.lec.state || r.lec.message;
    if (r.gls) facts.gls = r.gls.runs != null ? `${r.gls.pass}/${r.gls.runs} on the netlist` : (r.gls.message || '');
    if (r.formal) facts.formal = r.formal.prove ? `prove ${r.formal.prove.status}${r.formal.prove.failed ? ' (' + r.formal.prove.failed.signal + ')' : ''} · ${r.formal.cover.reached} bins reachable${r.formal.cover.unreached ? ', ' + r.formal.cover.unreached + ' not' : ''}` : (r.formal.message || '');
    return { id, verdict: s.verdict, steps: Object.keys(r).map(k => ({ k, verdict: r[k].verdict, fact: facts[k] || '' })), link: '../../' + id + '/signoff.html' };
  } catch (e) { return null; }
}

/** newest mutation-testing result in runs/ (summary for the Overview "Testbench quality" panel) */
function latestMutation(root) {
  try {
    const ids = fs.readdirSync(path.join(root, 'runs')).filter(n => /-mutation$/.test(n) && fs.existsSync(path.join(root, 'runs', n, 'mutation.json'))).sort();
    if (!ids.length) return null;
    const id = ids[ids.length - 1];
    const m = JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'mutation.json'), 'utf8'));
    const src = f => (m.files || []).find(x => path.basename(x) === path.basename(f)) || f;
    return { id, score: m.score, killed: m.killed, survived: m.survived, equivalent: m.equivalent || 0, invalid: m.invalid, ran: m.ran, simulator: m.simulator, link: '../../' + id + '/mutation.html',
      survivors: (m.mutants || []).filter(x => x.status === 'survived').slice(0, 8).map(x => ({ file: path.basename(x.file), src: src(x.file), line: x.line, rule: x.rule })) };
  } catch (e) { return null; }
}

function write(root, res) {
  const runDir = path.join(root, 'runs', res.meta.runId);
  const out = path.join(runDir, 'report');
  fs.mkdirSync(out, { recursive: true });
  const toRoot = path.relative(out, root).replace(/\\/g, '/') || '.';
  const data = { ...res, links: { toRun: '..', toRoot, testplan: toRoot + '/testplan.yaml', sources: [] }, logs: embedLogs(runDir, res), waves: embedWaves(runDir, res), history: history(root, res), mutation: latestMutation(root), signoff: latestSignoff(root) };
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'));
    data.links.sources = (cfg.dut.files || []).map(f => ({ name: f, href: toRoot + '/' + f.replace(/\\/g, '/') }));
  } catch (e) { /* ignore */ }
  fs.writeFileSync(path.join(out, 'index.html'), html(data));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(res, null, 2));
  return path.join(out, 'index.html');
}

const escHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html(d) {
  const json = JSON.stringify(d).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DV report — ${escHtml(d.meta.dut)} — ${escHtml(d.meta.runId)}</title>
<style>${CSS}</style></head><body>
<header class="top">
  <div class="top-in">
    <div class="id">
      <div class="eyebrow">10xEngineers EDA · DV run</div>
      <h1 id="title"></h1>
      <div class="sub" id="sub"></div>
    </div>
    <div class="verdict" id="verdict"></div>
    <div class="actions">
      <div class="seg" id="theme" role="group" aria-label="Theme">
        <button data-theme-set="light" title="Light">Light</button><button data-theme-set="system" title="Follow system / VS Code">Auto</button><button data-theme-set="dark" title="Dark">Dark</button>
      </div>
      <button class="btn" id="pal-btn" title="Search runs, bins, scenarios, requirements (Ctrl+K)">Search <kbd>Ctrl K</kbd></button>
      <span id="host-actions"></span>
    </div>
  </div>
  <nav class="tabs" id="tabs" role="tablist"></nav>
</header>
<main id="main"></main>
<aside class="drawer" id="drawer" aria-hidden="true"><div class="drawer-in" id="drawer-in"></div></aside>
<div class="scrim" id="scrim"></div>
<div class="toast" id="toast" role="status"></div>
<script id="data" type="application/json">${json}</script>
<script>${CLIENT}</script>
</body></html>`;
}

/* ====================================================================== styles */
const CSS = String.raw`
:root{
  --bg:#f3f5f8;--surface:#ffffff;--surface-2:#eef1f5;--fg:#16202b;--muted:#5a6776;--border:#d9dfe6;
  --accent:#2457d6;--pass:#16834a;--fail:#c9303e;--warn:#b06800;--block:#7748c2;--mute:#8793a0;
  --c1:#2457d6;--c2:#d47a1f;--c3:#0f8f82;--c4:#b2408e;--c5:#5f7a12;--c6:#6c4fd2;
  --shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);
  --font:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
  --mono:"Cascadia Code","Cascadia Mono",Consolas,"SF Mono",ui-monospace,monospace;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0d1217;--surface:#141b22;--surface-2:#1b242d;--fg:#e3e9ef;--muted:#94a2b0;--border:#26313c;
  --accent:#6f9dff;--pass:#40c07c;--fail:#ff6b75;--warn:#f0a43a;--block:#b48df2;--mute:#6f7d8a;
  --c1:#6f9dff;--c2:#f0a050;--c3:#3cc4b4;--c4:#e57ac0;--c5:#a6c94a;--c6:#a58cff;
  --shadow:0 1px 2px rgba(0,0,0,.4);color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0d1217;--surface:#141b22;--surface-2:#1b242d;--fg:#e3e9ef;--muted:#94a2b0;--border:#26313c;
  --accent:#6f9dff;--pass:#40c07c;--fail:#ff6b75;--warn:#f0a43a;--block:#b48df2;--mute:#6f7d8a;
  --c1:#6f9dff;--c2:#f0a050;--c3:#3cc4b4;--c4:#e57ac0;--c5:#a6c94a;--c6:#a58cff;
  --shadow:0 1px 2px rgba(0,0,0,.4);color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--font)}
button{font:inherit;color:inherit}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code,.mono{font-family:var(--mono);font-size:.86em}
.muted{color:var(--muted)}
h1,h2,h3{margin:0;line-height:1.25;text-wrap:balance}
h2{font-size:15px;font-weight:600}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

/* header */
.top{position:sticky;top:0;z-index:20;background:var(--surface);border-bottom:1px solid var(--border);box-shadow:var(--shadow)}
.top-in{max-width:1440px;margin:0 auto;padding:14px 24px 10px;display:flex;flex-wrap:wrap;align-items:center;gap:14px 24px}
.id{flex:1 1 360px;min-width:0}
.eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font-size:20px;font-weight:650;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
h1 .run{font-family:var(--mono);font-size:13px;font-weight:400;color:var(--muted)}
.sub{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:2px}
.sub b{color:var(--fg);font-weight:600}
.verdict{display:flex;align-items:center;gap:12px;padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2)}
.verdict .big{font-size:15px;font-weight:700;letter-spacing:.01em}
.verdict .small{font-size:12px;color:var(--muted)}
.verdict .dot{width:12px;height:12px;border-radius:50%;flex:none}
.v-pass .dot{background:var(--pass);box-shadow:0 0 0 4px color-mix(in srgb,var(--pass) 22%,transparent)}.v-pass .big{color:var(--pass)}
.v-fail .dot{background:var(--fail);box-shadow:0 0 0 4px color-mix(in srgb,var(--fail) 22%,transparent)}.v-fail .big{color:var(--fail)}
.v-warn .dot{background:var(--warn);box-shadow:0 0 0 4px color-mix(in srgb,var(--warn) 22%,transparent)}.v-warn .big{color:var(--warn)}
.actions{display:flex;gap:10px;align-items:center}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden}
.seg button{background:transparent;border:0;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--muted)}
.seg button+button{border-left:1px solid var(--border)}
.seg button.on{background:var(--accent);color:#fff}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:5px 11px;font-size:12.5px;cursor:pointer;color:var(--fg);white-space:nowrap}
.btn:hover{border-color:var(--accent);color:var(--accent);text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
#host-actions:empty{display:none}
.tabs{max-width:1440px;margin:0 auto;padding:0 18px;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none}
.tab{background:none;border:0;border-bottom:2px solid transparent;padding:9px 12px 10px;font-size:13.5px;font-weight:500;color:var(--muted);cursor:pointer;white-space:nowrap;display:inline-flex;gap:7px;align-items:center}
.tab:hover{color:var(--fg)}
.tab.on{color:var(--accent);border-bottom-color:var(--accent)}
.tab .cnt{font-size:11px;font-weight:600;padding:0 7px;border-radius:9px;background:var(--surface-2);color:var(--muted)}
.tab .cnt.bad{background:color-mix(in srgb,var(--fail) 16%,transparent);color:var(--fail)}
.tab kbd{font-family:var(--mono);font-size:10px;color:var(--mute);border:1px solid var(--border);border-radius:3px;padding:0 4px}

main{max-width:1440px;margin:0 auto;padding:22px 24px 60px;display:grid;gap:22px}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);min-width:0}
.panel-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:14px 16px;border-bottom:1px solid var(--border)}
.panel-h h2{flex:1 1 auto}
.panel-h .hint{font-size:12px;color:var(--muted)}
.panel-b{padding:16px}
.grid2{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:22px}
.stack{display:grid;gap:22px;align-content:start;min-width:0}

/* KPI */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
.kpi{display:flex;gap:14px;align-items:center;padding:14px 16px}
.kpi .k{font-size:12px;color:var(--muted);font-weight:500}
.kpi .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.15}
.kpi .d{font-size:12px;color:var(--muted)}
.ring{width:58px;height:58px;flex:none}
.ring-bg{fill:none;stroke:var(--surface-2);stroke-width:7}
.ring-fg{fill:none;stroke-width:7;stroke-linecap:round;transition:stroke-dasharray .6s ease}
.ring text{font:700 13px var(--font);fill:var(--fg)}
.ring .s-pass{stroke:var(--pass)}.ring .s-fail{stroke:var(--fail)}.ring .s-warn{stroke:var(--warn)}.ring .s-accent{stroke:var(--accent)}
.splitbar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--surface-2);width:100%;margin-top:6px}
.splitbar i{display:block;height:100%}

/* status pills */
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:1px 9px 1px 7px;border-radius:999px;white-space:nowrap;line-height:20px}
.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.t-pass{color:var(--pass);background:color-mix(in srgb,var(--pass) 13%,transparent)}
.t-fail{color:var(--fail);background:color-mix(in srgb,var(--fail) 13%,transparent)}
.t-warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent)}
.t-block{color:var(--block);background:color-mix(in srgb,var(--block) 14%,transparent)}
.t-mute{color:var(--mute);background:color-mix(in srgb,var(--mute) 14%,transparent)}

/* matrix */
.mx-wrap{overflow-x:auto}
.matrix{display:grid;grid-template-columns:minmax(120px,max-content) repeat(var(--cols),minmax(30px,46px));gap:5px;align-items:center}
.mx-h{font-size:11px;color:var(--muted);text-align:center;font-family:var(--mono)}
.mx-h.lbl{text-align:left;font-family:var(--font);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.mx-r{font-size:13px;font-weight:500;padding-right:8px;white-space:nowrap}
.mx-c{height:30px;border-radius:6px;border:0;cursor:pointer;display:grid;place-items:center;font-size:12px;font-weight:700;transition:transform .12s ease,box-shadow .12s ease}
.mx-c:hover{transform:translateY(-1px);box-shadow:0 0 0 2px currentColor}
.mx-c.t-pass{background:color-mix(in srgb,var(--pass) 82%,transparent);color:#fff}
.mx-c.t-fail{background:var(--fail);color:#fff}
.mx-c.t-warn{background:var(--warn);color:#fff}
.mx-c.t-block{background:var(--block);color:#fff}
.mx-c.t-mute{background:var(--mute);color:#fff}
.mx-c.empty{background:var(--surface-2);cursor:default}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:3px;display:inline-block}

/* lists */
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;font-size:13px}
.kv dt{color:var(--muted)}.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.rows{display:grid}
.row{display:flex;align-items:center;gap:12px;padding:10px 16px;border-top:1px solid var(--border);min-width:0}
.row:first-child{border-top:0}
.row .grow{flex:1;min-width:0}
.bar{height:8px;border-radius:4px;background:var(--surface-2);overflow:hidden;flex:none}
.bar i{display:block;height:100%;border-radius:4px;background:var(--pass)}
.bar.acc i{background:var(--accent)}
.delta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.delta>div{background:var(--surface-2);border-radius:8px;padding:10px 12px}
.delta .n{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.delta .l{font-size:12px;color:var(--muted)}

/* toolbar */
.toolbar{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)}
.search{position:relative;flex:1 1 220px;max-width:340px}
.search input{width:100%;padding:6px 10px 6px 30px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--fg);font:inherit;font-size:13px}
.search svg{position:absolute;left:9px;top:50%;transform:translateY(-50%);width:14px;height:14px;fill:none;stroke:var(--muted);stroke-width:2}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:3px 11px;font-size:12px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.chip b{font-weight:600;font-variant-numeric:tabular-nums}
.chip.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
select{padding:5px 8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--fg);font:inherit;font-size:13px}
.spacer{flex:1}

/* tables */
.tbl{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:9px 12px;text-align:left;border-top:1px solid var(--border);vertical-align:middle}
thead th{border-top:0;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;background:var(--surface-2);position:sticky;top:0;white-space:nowrap}
th.sort{cursor:pointer;user-select:none}th.sort:hover{color:var(--fg)}
th.sort[data-dir]::after{content:" ▲";font-size:9px}th.sort[data-dir="-1"]::after{content:" ▼"}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tbody tr.click{cursor:pointer}
tbody tr.click:hover{background:color-mix(in srgb,var(--accent) 6%,transparent)}
tbody tr.sel{background:color-mix(in srgb,var(--accent) 10%,transparent)}
td .err{color:var(--fail);font-family:var(--mono);font-size:12px;display:block;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.links{display:inline-flex;gap:10px;white-space:nowrap}
.empty-state{padding:36px 16px;text-align:center;color:var(--muted)}
.empty-state b{display:block;color:var(--fg);font-size:15px;margin-bottom:4px}

/* coverage */
.cov-types{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.ctype{padding:14px 16px;display:grid;gap:8px}
.ctype .h{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.ctype .h .pill{flex:none}
.ctype .t{font-weight:600;font-size:13.5px}
.ctype .p{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.ctype .note{font-size:12px;color:var(--muted)}
.metrics{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:4px 10px;align-items:center;font-size:12px}
.metrics .mn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.unc summary{cursor:pointer;font-size:12.5px}
.unc-l{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin-top:8px;font-size:12px;max-height:240px;overflow:auto}
.unc-l .muted{overflow-wrap:anywhere}
.mq{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.mq .k{display:flex;gap:18px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.mq .k b{display:block;font-size:20px;color:var(--fg);font-variant-numeric:tabular-nums}
.stack-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--surface-2);min-width:140px}
.stack-bar i{display:block;height:100%}
.hits{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.hits .bar{width:90px}
.heat{display:grid;gap:3px;font-size:12px}
.heat .hc{height:30px;border-radius:5px;display:grid;place-items:center;font-variant-numeric:tabular-nums;font-weight:600}
.heat .hh{font-size:11px;color:var(--muted);text-align:center;padding-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.heat .hr{font-family:var(--mono);font-size:11.5px;padding-right:10px;white-space:nowrap}
tr.detail td{background:var(--surface-2);font-size:12.5px}
.contrib{display:flex;flex-wrap:wrap;gap:6px}
.contrib span{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1px 8px;font-family:var(--mono);font-size:11.5px}
.sugg{border-left:3px solid var(--warn);padding:6px 10px;background:var(--surface)}

/* trace */
.req{border-top:1px solid var(--border)}
.req:first-child{border-top:0}
.req-h{width:100%;display:grid;grid-template-columns:20px 120px minmax(0,1fr) auto 150px;gap:14px;align-items:center;padding:12px 16px;background:none;border:0;text-align:left;cursor:pointer}
.req-h:hover{background:color-mix(in srgb,var(--accent) 5%,transparent)}
.req-h .car{transition:transform .15s ease;color:var(--muted)}
.req.open .req-h .car{transform:rotate(90deg)}
.req-b{display:none;padding:0 16px 14px 50px}
.req.open .req-b{display:block}
.scen{display:grid;grid-template-columns:110px minmax(0,1fr) auto auto;gap:6px 14px;align-items:start;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-top:8px;background:var(--surface)}
.scen .meta{grid-column:2 / -1;font-size:12px;color:var(--muted);display:grid;gap:2px}
.scen .runs{grid-column:2 / -1;display:flex;flex-wrap:wrap;gap:5px}
.rchip{border:0;border-radius:6px;padding:1px 8px;font-family:var(--mono);font-size:11.5px;cursor:pointer}

/* failures */
.sig{padding:14px 16px;border-top:1px solid var(--border);display:grid;gap:10px}
.sig:first-child{border-top:0}
.sig .first{font-family:var(--mono);font-size:12.5px;color:var(--fail);overflow-wrap:anywhere}
.md{font-size:13px;line-height:1.55}
.md h3,.md h4,.md h5,.md h6{font-size:13.5px;margin:12px 0 4px}
.md p{margin:4px 0}.md ul{margin:4px 0;padding-left:20px}
.md pre{background:var(--surface-2);border-radius:6px;padding:8px 10px;overflow-x:auto;font-family:var(--mono);font-size:12px}
.md code{background:var(--surface-2);padding:0 4px;border-radius:3px}

/* caps */
.caps{display:flex;flex-wrap:wrap;gap:8px}
.cmd{display:flex;gap:8px;align-items:flex-start;background:var(--surface-2);border-radius:7px;padding:8px 10px;margin-top:6px}
.cmd code{flex:1;min-width:0;overflow-wrap:anywhere;font-size:12px}

/* drawer */
.scrim{position:fixed;inset:0;background:rgba(10,15,20,.35);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:30}
.scrim.on{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(780px,100%);background:var(--surface);border-left:1px solid var(--border);box-shadow:-8px 0 24px rgba(0,0,0,.15);transform:translateX(102%);transition:transform .22s ease;z-index:40;display:flex}
.drawer.on{transform:none}
.drawer-in{flex:1;overflow-y:auto;min-width:0}
.dr-h{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--border);padding:14px 18px;display:flex;gap:12px;align-items:center;z-index:2}
.dr-h h2{font-size:16px;flex:1;min-width:0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dr-nav{display:flex;gap:4px}
.dr-sec{padding:14px 18px;border-bottom:1px solid var(--border);display:grid;gap:10px}
.dr-sec h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:10px}
.dr-sec h3 .spacer{flex:1}
.dr-sec h3 .btn,.dr-sec h3 input,.dr-sec h3 label{text-transform:none;letter-spacing:0}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.facts div{background:var(--surface-2);border-radius:8px;padding:8px 10px}
.facts .l{font-size:11.5px;color:var(--muted)}.facts .v{font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.log{font-family:var(--mono);font-size:12px;line-height:1.55;background:var(--bg);border:1px solid var(--border);border-radius:8px;max-height:460px;overflow:auto;padding:6px 0}
.ln{display:grid;grid-template-columns:46px 1fr;white-space:pre-wrap;word-break:break-word}
.ln .no{color:var(--mute);text-align:right;padding-right:10px;user-select:none}
.ln.bad{background:color-mix(in srgb,var(--fail) 12%,transparent);color:var(--fail)}
.ln.warn{background:color-mix(in srgb,var(--warn) 10%,transparent)}
.ln.good{color:var(--pass)}
.ln.hit .tx{background:color-mix(in srgb,var(--accent) 22%,transparent)}
.log.only .ln:not(.bad):not(.warn){display:none}
.switch{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:500;cursor:pointer}
.mini-in{padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);font:inherit;font-size:12px;width:160px}

.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--fg);color:var(--bg);padding:8px 16px;border-radius:8px;font-size:13px;opacity:0;pointer-events:none;transition:all .2s ease;z-index:50}
.toast.on{opacity:1;transform:translateX(-50%)}

/* history trend */
.trend{width:100%;min-width:640px;height:auto;display:block}
.trend .grid{stroke:var(--border);stroke-width:1}
.trend .ax{font:11px var(--font);fill:var(--muted)}
.trend .ln-pass{fill:none;stroke:var(--pass);stroke-width:2.2}
.trend .ln-cov{fill:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:6 4}
.trend .pt{stroke:var(--surface);stroke-width:2;cursor:pointer}
.trend .pt-pass{fill:var(--pass)}.trend .pt-fail{fill:var(--fail)}.trend .pt-warn{fill:var(--warn)}
.trend .pt-uvm{stroke:var(--accent);stroke-width:2.5}
.trend .pt-cur{stroke:var(--fg);stroke-width:2.5}
.trend .pt-cov{fill:var(--accent)}
.trend .pt-none{stroke:var(--mute);stroke-width:2.2;fill:none;cursor:default}
.trend a:hover .pt{stroke:var(--fg)}
.chip-s{font-size:11px;padding:0 7px;border-radius:8px;border:1px solid var(--border);color:var(--muted)}
kbd{font-family:var(--mono);font-size:10.5px;border:1px solid var(--border);border-radius:4px;padding:0 5px;color:var(--muted)}
/* waveform viewer */
.wv{display:grid;grid-template-columns:190px minmax(0,1fr);border:1px solid var(--border);border-radius:8px;background:var(--bg);max-height:420px;overflow:auto}
.wv-names{border-right:1px solid var(--border);font-size:12px}
.wv-nh{height:22px;line-height:22px;padding:0 8px;color:var(--muted);font-size:11px;border-bottom:1px solid var(--border)}
.wv-n{height:24px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 8px;cursor:pointer;white-space:nowrap}
.wv-n span{overflow:hidden;text-overflow:ellipsis}
.wv-n b{color:var(--accent);font-weight:600}
.wv-n:hover{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.wv-plot{position:relative;cursor:crosshair;min-width:0}
.wv-svg{display:block}
.wv-grid{stroke:var(--border);stroke-width:1}
.wv-ax{font:10px var(--mono);fill:var(--muted)}
.wv-bit{fill:none;stroke:var(--pass);stroke-width:1.5}
.wv-x{fill:color-mix(in srgb,var(--fail) 25%,transparent)}
.wv-bus{fill:color-mix(in srgb,var(--accent) 12%,transparent);stroke:var(--accent);stroke-width:1.2}
.wv-busx{fill:color-mix(in srgb,var(--fail) 18%,transparent);stroke:var(--fail)}
.wv-val{font:10.5px var(--mono);fill:var(--fg)}
.wv-cur{stroke:var(--warn);stroke-width:1.5}
.wv-curt{font:10.5px var(--mono);fill:var(--warn)}
a.tj{color:var(--accent);text-decoration:underline dotted;cursor:pointer}
/* quick search */
.pal-wrap{position:fixed;inset:0;background:rgba(10,15,20,.4);z-index:60;display:flex;justify-content:center;align-items:flex-start;padding-top:12vh}
.pal{width:min(680px,92vw);background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden}
.pal input{width:100%;border:0;border-bottom:1px solid var(--border);padding:14px 16px;font:inherit;font-size:15px;background:transparent;color:var(--fg);outline:none}
.pal-list{max-height:50vh;overflow:auto}
.pal-i{display:grid;grid-template-columns:92px minmax(0,auto) minmax(0,1fr);gap:10px;align-items:center;padding:8px 16px;cursor:pointer;font-size:13px}
.pal-i.on{background:color-mix(in srgb,var(--accent) 14%,transparent)}
.pal-k{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.pal-l{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pal-s{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pal-f{padding:8px 16px;font-size:11.5px;border-top:1px solid var(--border)}
@media (max-width:980px){.grid2{grid-template-columns:1fr}}
@media (max-width:640px){
  .top-in,main{padding-left:14px;padding-right:14px}
  .req-h{grid-template-columns:16px 1fr auto}.req-h .rt,.req-h .rc{display:none}
  .req-b{padding-left:16px}
  .scen{grid-template-columns:1fr}.scen .meta,.scen .runs{grid-column:1}
  .tab kbd{display:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/* ====================================================================== client (no backticks / no dollar-brace in here) */
const CLIENT = String.raw`
(function(){
'use strict';
var D = JSON.parse(document.getElementById('data').textContent);
var LOGS = D.logs || {};
var m = D.meta, T = D.totals;
function $(s, r){ return (r || document).querySelector(s); }
function $$(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function runPath(p){ return D.links.toRun + '/' + p; }
var TONE = {PASS:'pass',passed:'pass',hit:'pass',covered:'pass',reported:'pass',yes:'pass',
  FAIL:'fail',failed:'fail',unhit:'fail','not covered':'fail',
  TIMEOUT:'fail',ERROR:'warn',INCOMPLETE:'warn',partial:'warn',
  BLOCKED:'block',LICENSE:'block',blocked:'block'};
function tone(s){ return TONE[s] || 'mute'; }
function pill(s, label){ return '<span class="pill t-' + tone(s) + '"><i></i>' + esc(label == null ? s : label) + '</span>'; }
function glyph(s){ return {PASS:'✓',FAIL:'✕',TIMEOUT:'⏱',ERROR:'!',INCOMPLETE:'…',BLOCKED:'⊘',LICENSE:'⊘',CANCELLED:'–'}[s] || '·'; }
function fmtTime(s){ if (s == null) return '–'; return s < 1 ? s.toFixed(2) + ' s' : s < 60 ? s.toFixed(1) + ' s' : Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's'; }
function sum(a, f){ return a.reduce(function(x, y){ return x + (f(y) || 0); }, 0); }
function uniq(a){ var o = []; a.forEach(function(x){ if (o.indexOf(x) < 0) o.push(x); }); return o; }

var RUNS = D.runs.map(function(r, i){ var o = {}; for (var k in r) o[k] = r[k]; o._i = i; return o; });
var TESTS = uniq(RUNS.map(function(r){ return r.test; }));
var SEEDS = uniq(RUNS.map(function(r){ return r.seed; }));
var CONFS = uniq(RUNS.map(function(r){ return r.config; }));
var MULTI = CONFS.length > 1;
function testColor(t){ var i = TESTS.indexOf(t); return 'var(--c' + ((i < 0 ? 0 : i) % 6 + 1) + ')'; }
function runLabel(r){ return r.test + ' #' + r.seed + (MULTI ? ' @' + r.config : ''); }
var BAD = RUNS.filter(function(r){ return r.status !== 'PASS'; });
var MAXT = Math.max.apply(null, RUNS.map(function(r){ return r.time || 0; }).concat([0.001]));
var H = D.history || [];
var WAVES = D.waves || {};
var IN_VSCODE = function(){ return !!window.__dvVs; };
var started = Date.parse(m.started), finished = Date.parse(m.finished);
var wall = isFinite(started) && isFinite(finished) ? (finished - started) / 1000 : null;

/* ------------------------------------------------------------ theme */
var root = document.documentElement;
function readPref(){ try { return localStorage.getItem('dvdash-theme') || 'system'; } catch (e) { return 'system'; } }
function setTheme(v){
  try { localStorage.setItem('dvdash-theme', v); } catch (e) {}
  var eff = v;
  if (v === 'system') { var b = document.body.classList; eff = b.contains('vscode-dark') || b.contains('vscode-high-contrast') ? 'dark' : b.contains('vscode-light') ? 'light' : null; }
  if (eff) root.setAttribute('data-theme', eff); else root.removeAttribute('data-theme');
  $$('#theme button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-theme-set') === v); });
}
setTheme(readPref());

/* ------------------------------------------------------------ header */
$('#title').innerHTML = esc(m.dut) + ' <span class="run">' + esc(m.runId) + '</span>' + (m.kind && m.kind !== 'dv' ? ' <span class="pill t-mute" style="font-size:11.5px"><i></i>' + esc(m.testbench || m.kind) + '</span>' : '');
document.querySelector('.eyebrow').textContent = '10xEngineers EDA · ' + (m.kind === 'uvm' ? 'UVM run' : m.kind === 'cocotb' ? 'cocotb run' : 'DV run');
$('#sub').innerHTML = [
  '<span><b>' + esc(m.simLabel) + '</b> ' + esc((m.simVersion || '').replace(/^.*?version\s*/i, '').split(' ')[0]) + '</span>',
  '<span>template <b>' + esc(m.template) + '</b></span>',
  '<span>suite <b>' + esc(m.suite) + '</b></span>',
  '<span>' + TESTS.length + ' tests × ' + SEEDS.length + ' seeds' + (MULTI ? ' × ' + CONFS.length + ' configs' : '') + '</span>',
  '<span>' + esc(isFinite(started) ? new Date(started).toLocaleString() : m.started) + '</span>'
].join('');
(function(){
  var cls, big, small;
  if (!T.runs) { cls = 'v-warn'; big = 'No runs'; small = m.simAvailable === false ? 'simulator unavailable' : 'nothing executed'; }
  else if (T.pass === T.runs) { cls = 'v-pass'; big = 'All ' + T.runs + ' passed'; small = 'functional coverage ' + (D.coverage.functional.pct == null ? 'n/a' : D.coverage.functional.pct + '%'); }
  else if (T.fail + T.timeout) { cls = 'v-fail'; big = (T.fail + T.timeout) + ' failing'; small = T.pass + ' of ' + T.runs + ' passed'; }
  else { cls = 'v-warn'; big = (T.runs - T.pass) + ' not passed'; small = (T.blocked ? T.blocked + ' blocked · ' : '') + (T.error ? T.error + ' error' : ''); }
  var v = $('#verdict'); v.className = 'verdict ' + cls;
  v.innerHTML = '<span class="dot"></span><div><div class="big">' + esc(big) + '</div><div class="small">' + esc(small) + '</div></div>';
})();

/* ------------------------------------------------------------ tabs */
var TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs', cnt: RUNS.length },
  { id: 'coverage', label: 'Coverage', cnt: D.coverage.functional.pct == null ? null : D.coverage.functional.pct + '%' },
  { id: 'trace', label: 'Traceability', cnt: D.requirements.length },
  { id: 'failures', label: 'Failures', cnt: BAD.length, bad: BAD.length > 0 },
  { id: 'history', label: 'History', cnt: H.length },
  { id: 'info', label: 'Run info' }
];
$('#tabs').innerHTML = TABS.map(function(t, i){ return '<button class="tab" role="tab" data-tab="' + t.id + '">' + esc(t.label) + (t.cnt != null ? ' <span class="cnt' + (t.bad ? ' bad' : '') + '">' + esc(t.cnt) + '</span>' : '') + ' <kbd>' + (i + 1) + '</kbd></button>'; }).join('');
var current = null;
function show(id){
  var rm = /^run-(\d+)$/.exec(id || '');
  if (rm) { if (current !== 'runs') show('runs'); openRun(+rm[1]); return; }
  var cm = /^cmp-(.+)$/.exec(id || '');
  if (cm) { HS.cmp = cm[1]; show('history'); setTimeout(function(){ var p = $('#cmp-panel'); if (p) p.scrollIntoView({ block: 'start' }); }, 30); return; }
  if (!TABS.some(function(t){ return t.id === id; })) id = 'overview';
  current = id;
  $$('.tab').forEach(function(b){ var on = b.getAttribute('data-tab') === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#main').innerHTML = VIEWS[id]();
  if (AFTER[id]) AFTER[id]();
  try { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); } catch (e) {}
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ widgets */
function ring(pct, cls){
  var C = 2 * Math.PI * 25, v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return '<svg class="ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="25" class="ring-bg"/>' +
    (v > 0 ? '<circle cx="32" cy="32" r="25" class="ring-fg ' + cls + '" stroke-dasharray="' + (C * v / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 32 32)"/>' : '') +
    '<text x="32" y="37" text-anchor="middle">' + (pct == null ? 'n/a' : Math.round(pct) + '%') + '</text></svg>';
}
function bar(pct, w, cls){ return '<span class="bar ' + (cls || '') + '" style="width:' + (w || 90) + 'px"><i style="width:' + Math.max(0, Math.min(100, pct || 0)) + '%"></i></span>'; }
function searchBox(id, ph){ return '<label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="' + id + '" type="search" placeholder="' + esc(ph) + '" autocomplete="off"></label>'; }
function toast(msg){ var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove('on'); }, 1600); }
function copy(text){
  function fallback(){ var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed — select the text manually'); } ta.remove(); }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ toast('Copied'); }, fallback); else fallback();
}
var COPY = [];
function copyBtn(text, label){ COPY.push(text); return '<button class="btn" data-copy="' + (COPY.length - 1) + '">' + esc(label || 'Copy') + '</button>'; }

/* ------------------------------------------------------------ overview */
function matrix(){
  var rows = [];
  CONFS.forEach(function(c){ TESTS.forEach(function(t){ if (RUNS.some(function(r){ return r.test === t && r.config === c; })) rows.push({ c: c, t: t }); }); });
  var h = '<div class="mx-wrap"><div class="matrix" style="--cols:' + SEEDS.length + '"><div class="mx-h lbl">test ↓ / seed →</div>' + SEEDS.map(function(s){ return '<div class="mx-h">' + esc(s) + '</div>'; }).join('');
  rows.forEach(function(x){
    h += '<div class="mx-r"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:7px;background:' + testColor(x.t) + '"></span>' + esc(x.t) + (MULTI ? ' <span class="muted">@' + esc(x.c) + '</span>' : '') + '</div>';
    SEEDS.forEach(function(s){
      var r = RUNS.find(function(z){ return z.test === x.t && z.config === x.c && z.seed === s; });
      h += r ? '<button class="mx-c t-' + tone(r.status) + '" data-run="' + r._i + '" title="' + esc(runLabel(r) + ': ' + r.status + ' · ' + (r.checks || 0) + ' checks · ' + fmtTime(r.time)) + '" aria-label="' + esc(runLabel(r) + ' ' + r.status) + '">' + glyph(r.status) + '</button>' : '<div class="mx-c empty"></div>';
    });
  });
  return h + '</div></div>';
}
function overview(){
  var fp = D.coverage.functional.pct;
  var passPct = T.runs ? 100 * T.pass / T.runs : null;
  var scenPass = D.scenarios.filter(function(s){ return s.execution === 'passed'; }).length;
  var reqPass = D.requirements.filter(function(q){ return q.execution === 'passed'; }).length;
  var checks = sum(RUNS, function(r){ return r.checks; });
  var simT = sum(RUNS, function(r){ return r.time; });
  var seg = function(n, v){ return n ? '<i style="width:' + (100 * n / T.runs) + '%;background:var(--' + v + ')"></i>' : ''; };
  var k = '<div class="kpis">' +
    '<div class="panel kpi">' + ring(passPct, passPct === 100 ? 's-pass' : (T.fail + T.timeout) ? 's-fail' : 's-warn') + '<div><div class="k">Pass rate</div><div class="v">' + T.pass + '<span class="muted" style="font-size:15px;font-weight:500"> / ' + T.runs + '</span></div><div class="d">runs passed</div></div></div>' +
    '<div class="panel kpi">' + ring(fp, fp === 100 ? 's-pass' : 's-accent') + '<div><div class="k">Functional coverage</div><div class="v">' + (fp == null ? 'n/a' : fp + '%') + '</div><div class="d">' + D.bins.filter(function(b){ return b.state === 'hit'; }).length + ' of ' + D.bins.length + ' bins hit</div></div></div>' +
    '<div class="panel kpi" style="display:block"><div class="k">Run outcome</div><div class="v">' + T.runs + ' <span class="muted" style="font-size:13px;font-weight:500">runs</span></div><div class="splitbar">' + seg(T.pass, 'pass') + seg(T.fail + T.timeout, 'fail') + seg(T.error + T.incomplete, 'warn') + seg(T.blocked, 'block') + '</div><div class="d" style="margin-top:6px">' + T.pass + ' pass · ' + (T.fail + T.timeout) + ' fail · ' + (T.error + T.incomplete) + ' error · ' + T.blocked + ' blocked</div></div>' +
    '<div class="panel kpi" style="display:block"><div class="k">Scenarios · requirements</div><div class="v">' + scenPass + '/' + D.scenarios.length + ' <span class="muted" style="font-size:13px;font-weight:500">·</span> ' + reqPass + '/' + D.requirements.length + '</div><div class="d">passed / planned</div></div>' +
    '<div class="panel kpi" style="display:block"><div class="k">Checks executed</div><div class="v">' + checks.toLocaleString() + '</div><div class="d">' + sum(RUNS, function(r){ return r.errors; }) + ' check errors</div></div>' +
    '<div class="panel kpi" style="display:block"><div class="k">Time</div><div class="v">' + fmtTime(wall) + '</div><div class="d">wall clock · ' + fmtTime(simT) + ' total sim</div></div>' +
    '</div>';
  var mx = '<div class="panel"><div class="panel-h"><h2>Test × seed status</h2><span class="hint">Click a cell to open that run</span></div><div class="panel-b" style="display:grid;gap:12px">' + matrix() +
    '<div class="legend"><span><i style="background:var(--pass)"></i>pass</span><span><i style="background:var(--fail)"></i>fail / timeout</span><span><i style="background:var(--warn)"></i>error / incomplete</span><span><i style="background:var(--block)"></i>blocked / license</span></div></div></div>';
  var cmp = '';
  if (D.comparison) {
    var c = D.comparison;
    cmp = '<div class="panel"><div class="panel-h"><h2>Since previous run</h2><span class="hint mono">' + esc(c.previousRunId) + '</span></div><div class="panel-b" style="display:grid;gap:10px"><div class="delta">' +
      '<div><div class="n" style="color:' + (c.newFailures.length ? 'var(--fail)' : 'inherit') + '">' + c.newFailures.length + '</div><div class="l">new failures</div></div>' +
      '<div><div class="n" style="color:' + (c.fixed.length ? 'var(--pass)' : 'inherit') + '">' + c.fixed.length + '</div><div class="l">fixed</div></div>' +
      '<div><div class="n">' + (c.coverageDelta == null ? 'n/a' : (c.coverageDelta > 0 ? '+' : '') + c.coverageDelta) + '</div><div class="l">coverage pts</div></div></div>' +
      (c.newFailures.length ? '<div><span class="muted">New:</span> ' + c.newFailures.map(esc).join(', ') + '</div>' : '') +
      (c.stillFailing.length ? '<div><span class="muted">Still failing:</span> ' + c.stillFailing.map(esc).join(', ') + '</div>' : '') +
      (c.lost.length ? '<div><span class="muted">Coverage lost:</span> ' + c.lost.map(esc).join(', ') + '</div>' : '') +
      '</div></div>';
  } else cmp = '<div class="panel"><div class="panel-h"><h2>Since previous run</h2></div><div class="empty-state">First run in this project — nothing to compare yet.</div></div>';
  var cov = '<div class="panel"><div class="panel-h"><h2>Coverage by type</h2><button class="btn" data-go="coverage">Details</button></div><div class="rows">' + D.coverage.types.map(function(x){
    var st = x.state === 'reported' ? (x.pct === 100 ? 'covered' : 'partial') : x.state;
    return '<div class="row"><div class="grow"><div style="font-weight:500">' + esc(x.type) + '</div><div class="muted" style="font-size:12px">' + esc(x.note || '') + '</div></div>' + (x.pct == null ? pill(st, x.state) : bar(x.pct, 80) + '<b style="font-variant-numeric:tabular-nums;width:44px;text-align:right">' + x.pct + '%</b>') + '</div>';
  }).join('') + '</div></div>';
  var tests = '<div class="panel"><div class="panel-h"><h2>Per test</h2></div><div class="rows">' + TESTS.map(function(t){
    var rs = RUNS.filter(function(r){ return r.test === t; }), p = rs.filter(function(r){ return r.status === 'PASS'; }).length;
    return '<div class="row"><span style="width:10px;height:10px;border-radius:3px;background:' + testColor(t) + ';flex:none"></span><div class="grow"><b style="font-weight:600">' + esc(t) + '</b> <span class="muted" style="font-size:12px">' + sum(rs, function(r){ return r.checks; }) + ' checks</span></div>' + bar(100 * p / rs.length, 70) + '<span class="mono" style="width:44px;text-align:right">' + p + '/' + rs.length + '</span></div>';
  }).join('') + '</div></div>';
  var mq = '';
  if (D.mutation) {
    var mu = D.mutation, sc = mu.score;
    mq = '<div class="panel"><div class="panel-h"><h2>Testbench quality</h2><span class="hint">mutation testing · ' + esc(mu.id.replace(/-mutation$/, '')) + '</span>' + (mu.link ? '<a class="btn" href="' + esc(mu.link) + '">Open report</a>' : '') + '</div><div class="panel-b mq">' +
      ring(sc, sc == null ? 's-accent' : sc >= 90 ? 's-pass' : sc >= 70 ? 's-accent' : 's-fail') +
      '<div style="display:grid;gap:6px;min-width:0"><div style="font-size:13px">Share of planted bugs the tests caught</div><div class="k"><span><b style="color:var(--pass)">' + mu.killed + '</b>killed</span><span><b style="color:var(--fail)">' + mu.survived + '</b>survived</span><span><b>' + (mu.equivalent || 0) + '</b>equivalent</span><span><b>' + mu.invalid + '</b>invalid</span></div>' +
      (mu.survivors && mu.survivors.length ? '<div style="font-size:12.5px"><span class="muted">Missed:</span> ' + mu.survivors.map(function(s){ return '<a href="' + esc(D.links.toRoot + '/' + s.src + '#L' + s.line) + '" class="mono">' + esc(s.file + ':' + s.line) + '</a> <span class="muted">' + esc(s.rule) + '</span>'; }).join(' · ') + '</div>' : '<div style="font-size:12.5px;color:var(--pass)">Every non-equivalent mutant was caught.</div>') + '</div></div></div>';
  }
  var so = '';
  if (D.signoff) {
    var S = D.signoff, VT = { pass: ['PASS', 'pass'], warn: ['ERROR', 'review'], fail: ['FAIL', 'fail'], skipped: ['x', 'skipped'] };
    var NM = { lint: 'Lint', synth: 'Synthesis', lec: 'Equivalence', gls: 'Gate-level sim', formal: 'Formal' };
    so = '<div class="panel"><div class="panel-h"><h2>Sign-off</h2>' + pill((VT[S.verdict] || VT.skipped)[0], S.verdict === 'pass' ? 'ready' : (VT[S.verdict] || VT.skipped)[1]) + '<span class="hint">' + esc(S.id.replace(/-signoff$/, '')) + '</span><a class="btn" href="' + esc(S.link) + '">Open report</a></div><div class="rows">' +
      S.steps.map(function(x){ return '<div class="row"><div class="grow"><div style="font-weight:500">' + esc(NM[x.k] || x.k) + '</div><div class="muted" style="font-size:12px">' + esc(x.fact) + '</div></div>' + pill((VT[x.verdict] || VT.skipped)[0], (VT[x.verdict] || VT.skipped)[1]) + '</div>'; }).join('') + '</div></div>';
  }
  return k + '<div class="grid2"><div class="stack">' + mx + tests + '</div><div class="stack">' + so + mq + cmp + cov + '</div></div>';
}

/* ------------------------------------------------------------ runs */
var RS = { q: '', status: 'all', test: 'all', sort: null, dir: 1 };
function runsView(){
  var statuses = uniq(RUNS.map(function(r){ return r.status; }));
  return '<div class="panel"><div class="toolbar">' + searchBox('q-runs', 'Search test, seed, error…  ( / )') +
    '<div class="chips" id="st-chips">' + ['all'].concat(statuses).map(function(s){ var n = s === 'all' ? RUNS.length : RUNS.filter(function(r){ return r.status === s; }).length; return '<button class="chip" data-st="' + esc(s) + '">' + (s === 'all' ? 'All' : pill(s)) + ' <b>' + n + '</b></button>'; }).join('') + '</div>' +
    '<select id="test-sel" aria-label="Test"><option value="all">All tests</option>' + TESTS.map(function(t){ return '<option>' + esc(t) + '</option>'; }).join('') + '</select>' +
    '<span class="spacer"></span><button class="btn" id="csv">Copy CSV</button></div><div class="tbl" id="runs-tbl"></div></div>';
}
var COLS = [
  { k: 'status', l: 'Result' }, { k: 'test', l: 'Test' }, { k: 'seed', l: 'Seed', n: 1 },
  { k: 'config', l: 'Config', multi: 1 }, { k: 'checks', l: 'Checks', n: 1 }, { k: 'errors', l: 'Errors', n: 1 },
  { k: 'time', l: 'Time', n: 1 }, { k: 'firstError', l: 'First error' }, { k: null, l: 'Evidence' }
].filter(function(c){ return !c.multi || MULTI; });
function filteredRuns(){
  var q = RS.q.toLowerCase();
  var rs = RUNS.filter(function(r){
    if (RS.status !== 'all' && r.status !== RS.status) return false;
    if (RS.test !== 'all' && r.test !== RS.test) return false;
    if (q && [r.test, r.seed, r.config, r.status, r.firstError, r.classification].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  if (RS.sort) rs.sort(function(a, b){ var x = a[RS.sort], y = b[RS.sort]; if (x == null) x = ''; if (y == null) y = ''; return (x > y ? 1 : x < y ? -1 : 0) * RS.dir; });
  return rs;
}
function evidence(r){
  var l = [];
  if (r.dir) l.push('<a href="' + esc(runPath(r.dir + '/sim.log')) + '">log</a>');
  if (r.waves && r.dir) l.push('<a href="' + esc(runPath(r.dir + '/waves.vcd')) + '">waves</a>');
  if (r.failureDir) l.push('<a href="' + esc(runPath(r.failureDir + '/triage.md')) + '">triage</a>');
  return '<span class="links">' + l.join('') + '</span>';
}
function renderRuns(){
  var rs = filteredRuns();
  $$('#st-chips .chip').forEach(function(c){ c.classList.toggle('on', c.getAttribute('data-st') === RS.status); });
  var h = '<table><thead><tr>' + COLS.map(function(c){ return '<th class="' + (c.n ? 'n ' : '') + (c.k ? 'sort' : '') + '"' + (c.k ? ' data-sort="' + c.k + '"' : '') + (RS.sort === c.k && c.k ? ' data-dir="' + RS.dir + '"' : '') + '>' + c.l + '</th>'; }).join('') + '</tr></thead><tbody>';
  h += rs.map(function(r){
    return '<tr class="click" data-run="' + r._i + '">' + COLS.map(function(c){
      switch (c.k) {
        case 'status': return '<td>' + pill(r.status) + '</td>';
        case 'test': return '<td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:7px;background:' + testColor(r.test) + '"></span><b style="font-weight:600">' + esc(r.test) + '</b></td>';
        case 'seed': return '<td class="n mono">' + esc(r.seed) + '</td>';
        case 'config': return '<td>' + esc(r.config) + '</td>';
        case 'checks': return '<td class="n">' + (r.checks || 0) + '</td>';
        case 'errors': return '<td class="n"' + (r.errors ? ' style="color:var(--fail);font-weight:700"' : '') + '>' + (r.errors || 0) + '</td>';
        case 'time': return '<td class="n"><div class="hits">' + bar(100 * (r.time || 0) / MAXT, 46, 'acc') + '<span>' + fmtTime(r.time) + '</span></div></td>';
        case 'firstError': return '<td>' + (r.firstError ? '<span class="err" title="' + esc(r.firstError) + '">' + esc(r.firstError) + '</span>' : '<span class="muted">–</span>') + (r.stage ? '<div class="muted" style="font-size:12px">stage: ' + esc(r.stage) + '</div>' : '') + '</td>';
        default: return '<td>' + evidence(r) + '</td>';
      }
    }).join('') + '</tr>';
  }).join('');
  if (!rs.length) h += '<tr><td colspan="' + COLS.length + '"><div class="empty-state"><b>No runs match</b>Clear the search or pick another status.</div></td></tr>';
  $('#runs-tbl').innerHTML = h + '</tbody></table>';
}
function afterRuns(){
  var q = $('#q-runs'); q.value = RS.q; q.addEventListener('input', function(){ RS.q = q.value; renderRuns(); });
  var ts = $('#test-sel'); ts.value = RS.test; ts.addEventListener('change', function(){ RS.test = ts.value; renderRuns(); });
  $('#csv').addEventListener('click', function(){
    var hdr = ['status', 'test', 'seed', 'config', 'checks', 'errors', 'time_s', 'first_error', 'log'];
    var lines = [hdr.join(',')].concat(filteredRuns().map(function(r){ return [r.status, r.test, r.seed, r.config, r.checks || 0, r.errors || 0, r.time || 0, r.firstError || '', r.dir ? r.dir + '/sim.log' : ''].map(function(v){ v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }));
    copy(lines.join('\n'));
  });
  renderRuns();
}

/* ------------------------------------------------------------ run drawer */
function lineCls(l){
  if (/\b(errors?|fails?|mismatch(es)?)\s*[:=]\s*0\b/i.test(l) || /DVFLOW_RESULT\s+PASS/.test(l)) return 'good';
  if (/\bUVM_(ERROR|FATAL)\s*:\s*0\b/.test(l)) return '';
  if (/\*\* (Error|Fatal)|%Error|\bERROR\b|\bFAIL(ED)?\b|MISMATCH|UVM_(ERROR|FATAL)|\berror:|Fatal:|License Issue/i.test(l)) return 'bad';
  if (/\bwarn(ing)?\b/i.test(l)) return 'warn';
  if (/\bPASS(ED)?\b/.test(l)) return 'good';
  return '';
}
function logView(id, text){
  var lines = String(text).replace(/\s+$/, '').split(/\r?\n/);
  var nBad = 0;
  // times in the log (t=125 ns, @ 175000, time 40ns) become links that move the waveform cursor
  var TIME_RE = /(@\s*|\bt\s*=\s*|\btime\s*[=:]?\s*|\bat\s+)(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms)?\b/gi;
  var body = lines.map(function(l, n){
    var c = lineCls(l); if (c === 'bad') nBad++;
    var tx = esc(l).replace(TIME_RE, function(all, pre, v, u){ return pre + '<a class="tj" data-jump="' + v + '" data-unit="' + (u || '').toLowerCase() + '" title="Show this time in the waveform">' + v + (u ? ' ' + u : '') + '</a>'; });
    return '<div class="ln ' + c + '"><span class="no">' + (n + 1) + '</span><span class="tx">' + tx + '</span></div>';
  }).join('');
  return { nBad: nBad, html: '<div class="log" id="' + id + '">' + body + '</div>' };
}
function md(s){
  var out = [], code = false, list = false;
  function inl(t){ return esc(t).replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
  function endList(){ if (list) { out.push('</ul>'); list = false; } }
  String(s).split(/\r?\n/).forEach(function(l){
    if (/^\x60\x60\x60/.test(l)) { endList(); out.push(code ? '</pre>' : '<pre>'); code = !code; return; }
    if (code) { out.push(esc(l) + '\n'); return; }
    var h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) { endList(); var n = h[1].length + 2; out.push('<h' + n + '>' + inl(h[2]) + '</h' + n + '>'); return; }
    var li = /^\s*(?:[-*]|\d+\.)\s+(.*)/.exec(l);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inl(li[1]) + '</li>'); return; }
    endList();
    if (l.trim()) out.push('<p>' + inl(l) + '</p>');
  });
  endList(); if (code) out.push('</pre>');
  return '<div class="md">' + out.join('') + '</div>';
}
var drawerRun = null;
function openRun(i){
  var r = RUNS[i]; if (!r) return;
  drawerRun = i;
  var list = filteredRunsForNav(), pos = list.indexOf(i);
  var scen = Object.keys(r.scenarios || {}).filter(function(k){ return r.scenarios[k].ran; });
  var binsHit = Object.keys(r.bins || {}).filter(function(k){ return r.bins[k] > 0; });
  var logRel = r.dir ? r.dir + '/sim.log' : null;
  var triRel = r.failureDir ? r.failureDir + '/triage.md' : null;
  var h = '<div class="dr-h"><h2>' + pill(r.status) + '<span>' + esc(runLabel(r)) + '</span></h2><div class="dr-nav">' +
    '<button class="btn" data-nav="-1" ' + (pos <= 0 ? 'disabled' : '') + ' title="Previous run (k)">↑</button><button class="btn" data-nav="1" ' + (pos < 0 || pos >= list.length - 1 ? 'disabled' : '') + ' title="Next run (j)">↓</button>' +
    '<button class="btn" data-close title="Close (Esc)">✕</button></div></div>';
  h += '<div class="dr-sec"><div class="facts">' +
    '<div><div class="l">Checks</div><div class="v">' + (r.checks || 0) + '</div></div>' +
    '<div><div class="l">Errors</div><div class="v"' + (r.errors ? ' style="color:var(--fail)"' : '') + '>' + (r.errors || 0) + '</div></div>' +
    '<div><div class="l">Sim time</div><div class="v">' + fmtTime(r.time) + '</div></div>' +
    '<div><div class="l">Seed</div><div class="v mono">' + esc(r.seed) + '</div></div>' +
    '<div><div class="l">Config</div><div class="v">' + esc(r.config) + (r.params && Object.keys(r.params).length ? ' <span class="muted mono">' + esc(JSON.stringify(r.params)) + '</span>' : '') + '</div></div>' +
    '<div><div class="l">Exit code</div><div class="v mono">' + esc(r.code == null ? '–' : r.code) + '</div></div>' +
    '</div>' +
    (r.firstError ? '<div class="sugg" style="border-left-color:var(--fail)"><b>First error</b><div class="mono" style="font-size:12px;color:var(--fail);overflow-wrap:anywhere">' + esc(r.firstError) + '</div>' + (r.classification ? '<div class="muted" style="font-size:12px">classification: ' + esc(r.classification) + '</div>' : '') + (r.nextAction ? '<div style="font-size:12.5px;margin-top:4px"><b>Next:</b> ' + esc(r.nextAction) + '</div>' : '') + '</div>' : '') +
    '<div class="links" style="gap:8px;flex-wrap:wrap"><button class="btn primary" data-rerun="' + i + '" title="Same simulator, test, seed and configuration, with waveforms">' + (IN_VSCODE() ? '↻ Rerun with waves' : '↻ Copy rerun command') + '</button>' + (logRel ? '<a class="btn" href="' + esc(runPath(logRel)) + '">Open log</a>' : '') + (r.waves && r.dir ? '<a class="btn" href="' + esc(runPath(r.dir + '/waves.vcd')) + '">Open waveform</a>' : '') + (triRel ? '<a class="btn" href="' + esc(runPath(triRel)) + '">Open triage</a><a class="btn" href="' + esc(runPath(r.failureDir)) + '/">Failure folder</a>' : '') + '</div></div>';
  if (r.command) h += '<div class="dr-sec"><h3>Command</h3><div class="cmd"><code>' + esc(r.command) + '</code>' + copyBtn(r.command) + '</div></div>';
  if (triRel && LOGS[triRel]) h += '<div class="dr-sec"><h3>Triage</h3>' + md(LOGS[triRel]) + '</div>';
  h += '<div class="dr-sec"><h3>Scenarios exercised <span class="muted" style="text-transform:none;letter-spacing:0">' + scen.length + '</span></h3>' + (scen.length ? '<div class="tbl"><table><thead><tr><th>Scenario</th><th>Title</th><th class="n">Checks</th><th class="n">Fails</th></tr></thead><tbody>' + scen.map(function(k){ var s = D.scenarios.find(function(x){ return x.id === k; }) || {}; var v = r.scenarios[k]; return '<tr><td class="mono">' + esc(k) + '</td><td>' + esc(s.title || '') + '</td><td class="n">' + v.checks + '</td><td class="n"' + (v.fails ? ' style="color:var(--fail);font-weight:700"' : '') + '>' + v.fails + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<span class="muted">No scenario data recorded for this run.</span>') + '</div>';
  h += '<div class="dr-sec"><h3>Coverage bins hit <span class="muted" style="text-transform:none;letter-spacing:0">' + binsHit.length + ' of ' + Object.keys(r.bins || {}).length + '</span></h3><div class="contrib">' + (Object.keys(r.bins || {}).map(function(k){ var n = r.bins[k]; return '<span style="' + (n ? '' : 'opacity:.5') + '">' + esc(k.replace(/^BIN-/, '')) + ' ×' + n + '</span>'; }).join('') || '<span class="muted">none</span>') + '</div></div>';
  if (logRel) {
    if (LOGS[logRel] != null) {
      var lv = logView('dr-log', LOGS[logRel]);
      h += '<div class="dr-sec"><h3>Simulation log <span class="spacer"></span><input class="mini-in" id="log-q" type="search" placeholder="Find in log"><label class="switch"><input type="checkbox" id="log-only"' + (lv.nBad ? '' : ' disabled') + '> errors only (' + lv.nBad + ')</label>' + copyBtn(LOGS[logRel], 'Copy log') + '</h3>' + lv.html + '</div>';
    } else h += '<div class="dr-sec"><h3>Simulation log</h3><span class="muted">Not embedded (size budget). Use “Open log” above.</span></div>';
  }
  var waveRel = r.dir ? r.dir + '/waves.vcd' : null;
  if (waveRel) h += waveSection(waveRel);
  $('#drawer-in').innerHTML = h;
  if (waveRel && WAVES[waveRel]) setTimeout(function(){ initWave(waveRel); }, 30); else WV = null;
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on');
  $$('tr[data-run]').forEach(function(tr){ tr.classList.toggle('sel', +tr.getAttribute('data-run') === i); });
  var only = $('#log-only'); if (only) only.addEventListener('change', function(){ $('#dr-log').classList.toggle('only', only.checked); });
  var lq = $('#log-q'); if (lq) lq.addEventListener('input', function(){ var v = lq.value.toLowerCase(), first = null; $$('#dr-log .ln').forEach(function(ln){ var hit = !!v && ln.textContent.toLowerCase().indexOf(v) >= 0; ln.classList.toggle('hit', hit); if (hit && !first) first = ln; }); if (first) first.scrollIntoView({ block: 'center' }); });
  $('#drawer-in').scrollTop = 0;
  try { history.replaceState(null, '', '#run-' + i); } catch (e) {}
  var firstBad = $('#dr-log .ln.bad'); if (firstBad && r.status !== 'PASS') setTimeout(function(){ firstBad.scrollIntoView({ block: 'center' }); }, 260);
}
function filteredRunsForNav(){ return (current === 'runs' ? filteredRuns() : RUNS).map(function(r){ return r._i; }); }
function closeDrawer(){ drawerRun = null; try { history.replaceState(null, '', '#' + current); } catch (e) {}$('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on'); $$('tr.sel').forEach(function(t){ t.classList.remove('sel'); }); }
function navRun(d){ if (drawerRun == null) return; var l = filteredRunsForNav(), p = l.indexOf(drawerRun) + d; if (p >= 0 && p < l.length) openRun(l[p]); }

/* ------------------------------------------------------------ coverage */
var CS = { q: '', state: 'all', open: {} };
function coverageView(){
  var types = '<div class="cov-types">' + D.coverage.types.map(function(x){
    var st = x.state === 'reported' ? (x.pct === 100 ? 'covered' : 'partial') : x.state;
    return '<div class="panel ctype"><div class="h"><span class="t">' + esc(x.type) + '</span>' + pill(st, x.state) + '</div>' +
      (x.pct == null ? '<div class="p muted">–</div>' : '<div class="h"><span class="p">' + x.pct + '%</span>' + (x.total != null ? '<span class="muted mono">' + x.hit + ' / ' + x.total + '</span>' : '') + '</div><span class="bar" style="width:100%"><i style="width:' + x.pct + '%"></i></span>') +
      ((x.metrics || []).length ? '<div class="metrics">' + x.metrics.map(function(k){ return '<span class="mn">' + esc(k.metric) + '</span>' + bar(k.pct, 60) + '<span class="mono">' + k.pct + '%</span><span class="muted mono">' + k.hits + '/' + k.bins + '</span>'; }).join('') + '</div>' : '') +
      ((x.groups || []).length ? '<div class="metrics">' + x.groups.map(function(g){ return '<span class="mn mono" title="' + esc(g.name) + '">' + esc(g.name.split('/').pop()) + '</span>' + bar(g.pct, 60) + '<span class="mono">' + g.pct + '%</span><span></span>'; }).join('') + '</div>' : '') +
      '<div class="note">' + esc(x.note || '') + '</div>' +
      ((x.uncovered || []).length ? '<details class="unc"><summary><b>' + x.uncovered.length + ' uncovered DUT line' + (x.uncovered.length > 1 ? 's' : '') + '</b> <span class="muted">— click a line to open it</span></summary><div class="unc-l">' + x.uncovered.map(function(u){ return '<a href="' + esc(D.links.toRoot + '/' + u.src + '#L' + u.line) + '"><span class="mono">' + esc(u.file + ':' + u.line) + '</span></a><span class="muted">' + esc(u.what.join(' · ')) + '</span>'; }).join('') + '</div></details>' : (x.state === 'reported' && x.metrics && x.metrics.length && x.pct === 100 ? '<div class="note" style="color:var(--pass)">Every coverage point in the DUT was hit.</div>' : '')) +
      (x.files ? '<div class="links" style="gap:8px;flex-wrap:wrap">' + (x.files.html ? '<a class="btn" href="' + esc(runPath(x.files.html)) + '">HTML report</a>' : '') + (x.files.summary ? '<a class="btn" href="' + esc(runPath(x.files.summary)) + '">summary.txt</a>' : '') + (x.files.details && !/annotated$/.test(x.files.details) ? '<a class="btn" href="' + esc(runPath(x.files.details)) + '">details.txt</a>' : '') + (x.files.details && /annotated$/.test(x.files.details) ? '<a class="btn" href="' + esc(runPath(x.files.details)) + '/">annotated sources</a>' : '') + (x.files.lcov ? '<a class="btn" href="' + esc(runPath(x.files.lcov)) + '" title="LCOV: open with Open Coverage Report to highlight the editor">LCOV</a>' : '') + '</div>' : '') +
      '</div>';
  }).join('') + '</div>';
  var states = ['all'].concat(uniq(D.bins.map(function(b){ return b.state; })));
  var tbl = '<div class="panel"><div class="panel-h"><h2>Coverage bins</h2><span class="hint">Click a bin for contributors and suggestions</span></div><div class="toolbar">' + searchBox('q-bins', 'Search bin, condition, scenario…  ( / )') +
    '<div class="chips" id="bin-chips">' + states.map(function(s){ var n = s === 'all' ? D.bins.length : D.bins.filter(function(b){ return b.state === s; }).length; return '<button class="chip" data-bst="' + esc(s) + '">' + (s === 'all' ? 'All' : pill(s)) + ' <b>' + n + '</b></button>'; }).join('') + '</div>' +
    '<span class="spacer"></span><div class="legend">' + TESTS.map(function(t){ return '<span><i style="background:' + testColor(t) + '"></i>' + esc(t) + '</span>'; }).join('') + '</div></div><div class="tbl" id="bins-tbl"></div></div>';
  return types + tbl + heatmap();
}
function heatmap(){
  if (!D.bins.length || !TESTS.length) return '';
  var val = function(b, t){ return sum(b.contributors.filter(function(c){ return c.test === t; }), function(c){ return c.hits; }); };
  var max = 0; D.bins.forEach(function(b){ TESTS.forEach(function(t){ max = Math.max(max, val(b, t)); }); });
  var h = '<div class="heat" style="grid-template-columns:minmax(160px,max-content) repeat(' + TESTS.length + ',minmax(64px,1fr))"><div></div>' + TESTS.map(function(t){ return '<div class="hh" title="' + esc(t) + '">' + esc(t) + '</div>'; }).join('');
  D.bins.forEach(function(b){
    h += '<div class="hr" title="' + esc(b.desc) + '">' + esc(b.id.replace(/^BIN-/, '')) + '</div>';
    TESTS.forEach(function(t){ var v = val(b, t); var p = max ? Math.round(18 + 72 * Math.sqrt(v / max)) : 0; h += '<div class="hc" title="' + esc(b.id + ' · ' + t + ': ' + v + ' hits') + '" style="background:' + (v ? 'color-mix(in srgb,var(--accent) ' + p + '%,var(--surface))' : 'var(--surface-2)') + ';color:' + (p > 55 ? '#fff' : 'var(--fg)') + '">' + (v || '<span class="muted">·</span>') + '</div>'; });
  });
  return '<div class="panel"><div class="panel-h"><h2>Which test hits which bin</h2><span class="hint">hits summed over seeds · darker = more hits</span></div><div class="panel-b"><div class="mx-wrap">' + h + '</div></div></div>';
}
function renderBins(){
  var q = CS.q.toLowerCase();
  $$('#bin-chips .chip').forEach(function(c){ c.classList.toggle('on', c.getAttribute('data-bst') === CS.state); });
  var bs = D.bins.filter(function(b){ return (CS.state === 'all' || b.state === CS.state) && (!q || [b.id, b.desc, b.cond, b.scenario, b.scenarioTitle].join(' ').toLowerCase().indexOf(q) >= 0); });
  var max = Math.max.apply(null, D.bins.map(function(b){ return b.hits || 0; }).concat([1]));
  var h = '<table><thead><tr><th>Bin</th><th>Condition</th><th>Scenario</th><th>State</th><th>Hit by test</th><th class="n">Hits</th></tr></thead><tbody>';
  bs.forEach(function(b){
    var byTest = TESTS.map(function(t){ return { t: t, n: sum(b.contributors.filter(function(c){ return c.test === t; }), function(c){ return c.hits; }) }; }).filter(function(x){ return x.n; });
    var tot = sum(byTest, function(x){ return x.n; }) || 1;
    h += '<tr class="click" data-bin="' + esc(b.id) + '"><td class="mono"><b>' + esc(b.id.replace(/^BIN-/, '')) + '</b></td><td><div>' + esc(b.desc) + '</div><code class="muted">' + esc(b.cond) + '</code></td><td><span class="mono">' + esc(b.scenario) + '</span><div class="muted" style="font-size:12px">' + esc(b.scenarioTitle || '') + '</div></td><td>' + pill(b.state) + '</td>' +
      '<td><div class="stack-bar" title="' + esc(byTest.map(function(x){ return x.t + ': ' + x.n; }).join(' · ')) + '">' + byTest.map(function(x){ return '<i style="width:' + (100 * x.n / tot) + '%;background:' + testColor(x.t) + '"></i>'; }).join('') + '</div></td>' +
      '<td class="n"><div class="hits">' + bar(100 * (b.hits || 0) / max, 70, 'acc') + '<b>' + (b.hits || 0) + '</b></div></td></tr>';
    if (CS.open[b.id]) h += '<tr class="detail"><td colspan="6"><div style="display:grid;gap:8px"><div><b>Contributing runs</b> <span class="muted">(' + esc(b.attribution || '') + ')</span></div><div class="contrib">' + (b.contributors.length ? b.contributors.map(function(c){ return '<span>' + esc(c.test + ' #' + c.seed + (MULTI ? ' @' + c.config : '')) + ' ×' + c.hits + '</span>'; }).join('') : '<span class="muted">none</span>') + '</div>' +
      (b.stimulus ? '<div><b>Stimulus:</b> <code>' + esc(b.stimulus) + '</code></div>' : '') +
      (b.waiver ? '<div class="sugg"><b>Waived</b> by ' + esc(b.waiver.reviewer) + ': ' + esc(b.waiver.rationale) + (b.waiver.expires ? ' (expires ' + esc(b.waiver.expires) + (b.waiver.expired ? ', EXPIRED' : '') + ')' : '') + '</div>' : '') +
      (b.suggestion ? '<div class="sugg"><b>' + esc(b.suggestion.kind) + ':</b> ' + esc(b.suggestion.reason) + '<br>Suggested stimulus: <code>' + esc(b.suggestion.stimulus) + '</code></div>' : '') + '</div></td></tr>';
  });
  if (!bs.length) h += '<tr><td colspan="6"><div class="empty-state"><b>No bins match</b>Clear the search or pick another state.</div></td></tr>';
  $('#bins-tbl').innerHTML = h + '</tbody></table>';
}
function afterCoverage(){ var q = $('#q-bins'); q.value = CS.q; q.addEventListener('input', function(){ CS.q = q.value; renderBins(); }); renderBins(); }

/* ------------------------------------------------------------ traceability */
var TR = { open: null };
function traceView(){
  if (TR.open == null) { TR.open = {}; D.requirements.forEach(function(q){ if (q.execution !== 'passed') TR.open[q.id] = true; }); }
  var h = '<div class="panel"><div class="panel-h"><h2>Requirement → scenario → run</h2><button class="btn" id="tr-all">Expand all</button><button class="btn" id="tr-none">Collapse all</button></div>';
  h += D.requirements.map(function(q){
    var sc = q.scenarios.map(function(id){ return D.scenarios.find(function(s){ return s.id === id; }); }).filter(Boolean);
    return '<div class="req' + (TR.open[q.id] ? ' open' : '') + '" data-req="' + esc(q.id) + '"><button class="req-h" data-toggle-req="' + esc(q.id) + '"><span class="car">▶</span><span class="mono" style="font-weight:600">' + esc(q.id) + '</span><span class="rt">' + esc(q.text) + '</span>' + pill(q.execution) + '<span class="rc" style="display:flex;gap:8px;align-items:center;justify-content:flex-end">' + (q.coveragePct == null ? '<span class="muted">–</span>' : bar(q.coveragePct, 80) + '<span class="mono">' + q.coveragePct + '%</span>') + '</span></button>' +
      '<div class="req-b">' + (sc.length ? '' : '<div class="sugg" style="margin-top:8px">No scenario is mapped to this requirement, so no test verifies it and it stays <b>not run</b>. Map a scenario to <span class="mono">' + esc(q.id) + '</span> in testplan.yaml (or the template) to close the gap.</div>') + sc.map(function(s){
        return '<div class="scen"><span class="mono" style="font-weight:600">' + esc(s.id) + '</span><div><b style="font-weight:600">' + esc(s.title) + '</b> <span class="muted">· test ' + esc(s.test || 'planned') + '</span></div>' + pill(s.execution) + pill(s.coverage === 'n/a' ? 'na' : s.coverage, s.coverage) +
          '<div class="meta"><span><b>Stimulus</b> ' + esc(s.stimulus) + '</span><span><b>Expected</b> ' + esc(s.expected) + '</span></div>' +
          '<div class="runs">' + (s.runs.length ? s.runs.map(function(r){ var ri = RUNS.findIndex(function(z){ return z.test === r.test && z.seed === r.seed && z.config === r.config; }); return '<button class="rchip t-' + tone(r.status) + '" data-run="' + ri + '" title="' + esc(r.checks + ' checks, ' + r.fails + ' fails') + '">' + esc(r.test + ' #' + r.seed) + '</button>'; }).join('') : '<span class="muted" style="font-size:12px">not run</span>') + '</div></div>';
      }).join('') + '</div></div>';
  }).join('');
  return h + '</div>';
}

/* ------------------------------------------------------------ failures */
function failuresView(){
  if (!BAD.length) return '<div class="panel"><div class="empty-state" style="padding:56px 16px"><b>No failures</b>All ' + T.runs + ' runs passed' + (D.coverage.functional.pct != null ? ' with ' + D.coverage.functional.pct + '% functional coverage' : '') + '.</div></div>';
  var h = '';
  if (D.signatures.length) h += '<div class="panel"><div class="panel-h"><h2>Failure signatures</h2><span class="hint">Repeated failures grouped by first error</span></div>' + D.signatures.map(function(s){
    var tri = s.runs[0] && s.runs[0].failureDir ? LOGS[s.runs[0].failureDir + '/triage.md'] : null;
    return '<div class="sig"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + pill('FAIL', s.kind) + '<b>' + s.runs.length + ' run' + (s.runs.length > 1 ? 's' : '') + '</b><span class="spacer"></span>' + s.runs.map(function(r){ var ri = RUNS.findIndex(function(z){ return z.test === r.test && z.seed === r.seed && z.config === r.config; }); return '<button class="rchip t-fail" data-run="' + ri + '">' + esc(r.test + ' #' + r.seed) + '</button>'; }).join(' ') + '</div><div class="first">' + esc(s.first) + '</div>' + (tri ? '<details><summary class="muted" style="cursor:pointer">Triage notes for ' + esc(s.runs[0].test + ' #' + s.runs[0].seed) + '</summary>' + md(tri) + '</details>' : '') + '</div>';
  }).join('') + '</div>';
  h += '<div class="panel"><div class="panel-h"><h2>Runs that did not pass</h2></div><div class="tbl"><table><thead><tr><th>Result</th><th>Run</th><th>Stage</th><th>First error</th><th>Next action</th><th>Evidence</th></tr></thead><tbody>' + BAD.map(function(r){ return '<tr class="click" data-run="' + r._i + '"><td>' + pill(r.status) + '</td><td class="mono">' + esc(runLabel(r)) + '</td><td>' + esc(r.stage || '–') + '</td><td><span class="err" title="' + esc(r.firstError || '') + '">' + esc(r.firstError || '–') + '</span></td><td style="font-size:12.5px">' + esc(r.nextAction || '') + '</td><td>' + evidence(r) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  return h;
}

/* ------------------------------------------------------------ run info */
function infoView(){
  var kv = function(rows){ return '<dl class="kv">' + rows.filter(function(r){ return r[1] != null && r[1] !== ''; }).map(function(r){ return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; };
  var cov = m.coverage || {};
  var left = '<div class="panel"><div class="panel-h"><h2>Run</h2></div><div class="panel-b">' + kv([
    ['DUT', '<b>' + esc(m.dut) + '</b>'], ['Template', esc(m.template)], ['Language', esc(m.language)], ['Run ID', '<span class="mono">' + esc(m.runId) + '</span>'],
    ['Started', esc(m.started)], ['Finished', esc(m.finished)], ['Wall clock', fmtTime(wall)], ['Host', esc(m.host)], ['Revision', esc(m.rev)],
    ['Suite', esc(m.suite)], ['Tests', esc(m.tests.join(', '))], ['Seeds', '<span class="mono">' + esc(m.seeds.join(', ')) + '</span>'], ['Configs', esc(m.configs.join(', '))],
    ['Waveforms', m.waves ? 'dumped' : 'off'], ['Coverage', ['code', 'functional', 'assertions'].filter(function(k){ return cov[k]; }).join(', ') || 'none']
  ]) + '</div></div>';
  var simp = '<div class="panel"><div class="panel-h"><h2>Simulator</h2>' + pill(m.simAvailable === false ? 'BLOCKED' : 'PASS', m.simAvailable === false ? 'unavailable' : 'available') + '</div><div class="panel-b" style="display:grid;gap:14px">' + kv([
    ['Simulator', '<b>' + esc(m.simLabel) + '</b>'], ['Version', '<span class="mono" style="font-size:12px">' + esc(m.simVersion) + '</span>'], ['Resolved from', esc(m.simSource)], ['Reason', m.simReason ? esc(m.simReason) : null]
  ]) + '<div><div class="muted" style="font-size:12px;margin-bottom:6px">Capabilities</div><div class="caps">' + Object.keys(m.capabilities || {}).map(function(k){ var v = String(m.capabilities[k]); return '<span class="pill t-' + (/^yes|^tb/.test(v) ? 'pass' : /^unsupported/.test(v) ? 'mute' : 'warn') + '" title="' + esc(v) + '"><i></i>' + esc(k.replace(/_/g, ' ')) + '</span>'; }).join('') + '</div></div></div></div>';
  var builds = '<div class="panel"><div class="panel-h"><h2>Builds</h2></div>' + D.builds.map(function(b){
    var lg = b.log && LOGS[b.log];
    return '<div class="dr-sec" style="border-bottom:0;border-top:1px solid var(--border)"><h3>' + pill(b.failed ? 'FAIL' : b.blocked ? 'BLOCKED' : 'PASS', b.failed ? 'failed' : b.blocked ? 'blocked' : 'ok') + ' <span style="text-transform:none;letter-spacing:0;color:var(--fg)">config ' + esc(b.config) + '</span><span class="spacer"></span>' + (b.log ? '<a class="btn" href="' + esc(runPath(b.log)) + '">Open build log</a>' : '') + '</h3>' +
      (b.commands || []).map(function(c){ return '<div class="cmd"><code>' + esc(c) + '</code>' + copyBtn(c) + '</div>'; }).join('') +
      ((b.errors || []).length ? '<div class="tbl"><table><thead><tr><th>File</th><th class="n">Line</th><th>Message</th></tr></thead><tbody>' + b.errors.map(function(e){ return '<tr><td class="mono">' + esc(e.file || '') + '</td><td class="n">' + esc(e.line || '') + '</td><td style="color:var(--' + (e.severity === 'warning' ? 'warn' : 'fail') + ')">' + esc(e.message) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      (lg ? '<details><summary class="muted" style="cursor:pointer">Build log</summary>' + logView('bl-' + esc(b.config), lg).html + '</details>' : '') + '</div>';
  }).join('') + '</div>';
  var files = '<div class="panel"><div class="panel-h"><h2>Files</h2></div><div class="panel-b" style="display:flex;flex-wrap:wrap;gap:8px">' +
    '<a class="btn" href="' + esc(D.links.testplan) + '">testplan.yaml</a><a class="btn" href="' + esc(runPath('results.json')) + '">results.json</a><a class="btn" href="' + esc(runPath('junit.xml')) + '">junit.xml</a>' +
    D.links.sources.map(function(s){ return '<a class="btn" href="' + esc(s.href) + '">' + esc(s.name) + '</a>'; }).join('') + '</div></div>';
  var waiv = (D.waivers || []).length ? '<div class="panel"><div class="panel-h"><h2>Waivers</h2></div><div class="tbl"><table><thead><tr><th>Item</th><th>Reviewer</th><th>Rationale</th><th>Expires</th></tr></thead><tbody>' + D.waivers.map(function(w){ return '<tr><td class="mono">' + esc(w.id || w.item || '') + '</td><td>' + esc(w.reviewer || '') + '</td><td>' + esc(w.rationale || '') + '</td><td>' + esc(w.expires || '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
  return '<div class="grid2"><div class="stack">' + left + files + '</div><div class="stack">' + simp + waiv + '</div></div>' + builds;
}

/* ------------------------------------------------------------ history + compare */
var HS = { cmp: null, changedOnly: true, sim: 'all', kind: 'all', fullOnly: false };
/** pass rate over the runs that executed (pass + fail); null when nothing ran (e.g. licence-blocked) */
function passRate(h){ var ex = h.pass + h.fail; return ex ? 100 * h.pass / ex : null; }
function histFiltered(){ return H.filter(function(h){ return (HS.sim === 'all' || h.sim === HS.sim) && (HS.kind === 'all' || HS.kind === (h.kind || 'dv')) &&(!HS.fullOnly || h.uvm || h.suite === 'full' || h.id === m.runId); }); }
function histLink(h){ return h.report ? '../../' + h.id + '/report/index.html' : h.uvm ? '../../' + h.id + '/uvm_results.json' : null; }
function shortWhen(h){ var d = new Date(h.started || 0); return isFinite(d) ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : h.id; }
function trendChart(H){
  var W = 1000, Hh = 250, L = 44, R = 16, T = 16, B = 40, n = H.length;
  if (!n) return '<div class="empty-state">No runs match the filters.</div>';
  var x = function(i){ return n === 1 ? (L + W - R) / 2 : L + (W - L - R) * i / (n - 1); }, y = function(v){ return T + (Hh - T - B) * (1 - v / 100); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" class="trend" role="img" aria-label="Pass rate and functional coverage per run">';
  [0, 25, 50, 75, 100].forEach(function(v){ s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="ax">' + v + '%</text>'; });
  var step = Math.max(1, Math.ceil(n / 8)), lastLab = -99;
  H.forEach(function(h, i){ if ((i % step === 0 && i - lastLab >= step) || (i === n - 1 && i - lastLab >= Math.ceil(step / 2) + 1)) { lastLab = i; s += '<text x="' + x(i) + '" y="' + (Hh - 14) + '" text-anchor="middle" class="ax">' + esc(shortWhen(h)) + '</text>'; } });
  // lines connect only the runs that have a value (a licence-blocked run breaks nothing)
  var line = function(get, cls){ var pts = H.map(function(h, i){ var v = get(h); return v == null ? null : x(i) + ',' + y(v); }).filter(Boolean); return pts.length > 1 ? '<polyline points="' + pts.join(' ') + '" class="' + cls + '"/>' : ''; };
  s += line(passRate, 'ln-pass') + line(function(h){ return h.fpct; }, 'ln-cov');
  H.forEach(function(h, i){
    var pr = passRate(h), cur = h.id === m.runId, link = histLink(h), notRun = pr == null;
    var tip = h.id + (cur ? ' (this run)' : '') + '\n' + h.sim + (h.container ? ' · container' : '') + ' · ' + h.suite + '\n' + (notRun ? 'nothing executed (' + h.other + ' blocked / not run)' : h.pass + '/' + (h.pass + h.fail) + ' passed' + (h.other ? ', ' + h.other + ' not run' : '')) + (h.fpct != null ? ' · coverage ' + h.fpct + '%' : '') + (link && !cur ? '\nclick to open' : '');
    var dot = notRun
      ? '<path d="M' + (x(i) - 5) + ' ' + (y(0) - 5) + ' l10 10 m0 -10 l-10 10" class="pt-none"><title>' + esc(tip) + '</title></path>'
      : '<circle cx="' + x(i) + '" cy="' + y(pr) + '" r="' + (cur ? 7 : 5) + '" class="pt ' + (h.fail ? 'pt-fail' : 'pt-pass') + (cur ? ' pt-cur' : '') + (h.uvm ? ' pt-uvm' : '') + '"><title>' + esc(tip) + '</title></circle>';
    s += link && !cur ? '<a href="' + esc(link) + '">' + dot + '</a>' : dot;
    if (h.fpct != null) s += '<rect x="' + (x(i) - 3.5) + '" y="' + (y(h.fpct) - 3.5) + '" width="7" height="7" class="pt-cov"><title>' + esc(h.id + ' · functional coverage ' + h.fpct + '%') + '</title></rect>';
  });
  return s + '</svg>';
}
function historyView(){
  if (H.length < 2) return '<div class="panel"><div class="empty-state" style="padding:56px 16px"><b>This is the first run</b>Trends and run comparison appear once there is a second run in runs/.</div></div>';
  var FH = histFiltered();
  var sims = uniq(H.map(function(x){ return x.sim; }).filter(Boolean));
  var chip = function(attr, v, label, on){ return '<button class="chip' + (on ? ' on' : '') + '" ' + attr + '="' + esc(v) + '">' + esc(label) + '</button>'; };
  var filters = '<div class="toolbar"><div class="chips">' + chip('data-hsim', 'all', 'All simulators', HS.sim === 'all') + sims.map(function(sv){ return chip('data-hsim', sv, sv, HS.sim === sv); }).join('') + '</div>' +
    '<div class="chips">' + chip('data-hkind', 'all', 'All testbenches', HS.kind === 'all') + chip('data-hkind', 'dv', 'Simple TB', HS.kind === 'dv') + chip('data-hkind', 'uvm', 'UVM', HS.kind === 'uvm') + (H.some(function(x){ return x.cocotb; }) ? chip('data-hkind', 'cocotb', 'cocotb', HS.kind === 'cocotb') : '') + '</div>' +
    '<label class="switch" style="text-transform:none"><input type="checkbox" id="h-full"' + (HS.fullOnly ? ' checked' : '') + '> full suites only</label><span class="spacer"></span><span class="hint">' + FH.length + ' of ' + H.length + ' runs</span></div>';
  var h = '<div class="panel"><div class="panel-h"><h2>Pass rate and coverage over time</h2><div class="legend"><span><i style="background:var(--pass)"></i>pass rate (of executed runs)</span><span><i style="background:var(--accent)"></i>functional coverage</span><span><i style="background:var(--fail)"></i>run with failures</span><span><b class="muted">✕</b> nothing executed</span><span class="muted">ringed = UVM · large = this run · click to open</span></div></div>' + filters + '<div class="panel-b"><div class="mx-wrap">' + trendChart(FH) + '</div></div></div>';
  h += '<div class="panel"><div class="panel-h"><h2>Runs</h2><span class="hint">' + FH.length + ' shown · newest first</span></div><div class="tbl"><table><thead><tr><th>Run</th><th>When</th><th>Simulator</th><th>Suite</th><th>Result</th><th class="n">Coverage</th><th class="n">Wall</th><th></th></tr></thead><tbody>';
  FH.slice().reverse().forEach(function(x){
    var cur = x.id === m.runId, link = histLink(x), same = x.kind === (m.kind || 'dv') && x.report && !cur;
    h += '<tr' + (cur ? ' class="sel"' : '') + '><td class="mono">' + (link && !cur ? '<a href="' + esc(link) + '">' + esc(x.id) + '</a>' : esc(x.id)) + (cur ? ' <span class="pill t-mute"><i></i>this run</span>' : '') + '</td><td>' + esc(shortWhen(x)) + '</td><td>' + esc(x.sim || '') + (x.container ? ' <span class="chip-s">container</span>' : '') + '</td><td>' + esc(x.suite || '') + '</td>' +
      '<td><div style="display:flex;gap:8px;align-items:center">' + bar(x.runs ? 100 * x.pass / x.runs : 0, 70) + '<span class="mono">' + x.pass + '/' + x.runs + '</span>' + (x.fail ? pill('FAIL', x.fail + ' fail') : x.other ? pill('BLOCKED', x.other + ' not run') : '') + '</div></td>' +
      '<td class="n">' + (x.fpct == null ? (x.codePct != null ? 'code ' + x.codePct + '%' : '–') : x.fpct + '%') + '</td><td class="n">' + fmtTime(x.wall) + '</td>' +
      '<td>' + (same ? '<button class="btn' + (HS.cmp === x.id ? ' primary' : '') + '" data-cmp="' + esc(x.id) + '">' + (HS.cmp === x.id ? 'Comparing' : 'Compare') + '</button>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div></div>';
  if (HS.cmp) h += compareView(HS.cmp);
  return h;
}
function compareView(id){
  var A = H.find(function(x){ return x.id === m.runId; }), B = H.find(function(x){ return x.id === id; });
  if (!A || !B) return '';
  var keys = uniq(Object.keys(A.matrix).concat(Object.keys(B.matrix))).sort();
  var rows = keys.map(function(k){
    var a = A.matrix[k], b = B.matrix[k], sa = a && a[0], sb = b && b[0], ch;
    if (!b) ch = 'added'; else if (!a) ch = 'removed'; else if (sa === 'PASS' && sb !== 'PASS') ch = 'fixed'; else if (sa !== 'PASS' && sb === 'PASS') ch = 'regressed'; else if (sa !== sb) ch = 'changed'; else ch = 'same';
    return { k: k, a: a, b: b, ch: ch, dt: a && b ? a[1] - b[1] : null };
  });
  var cnt = function(c){ return rows.filter(function(r){ return r.ch === c; }).length; };
  var CH = { regressed: ['fail', 'newly failing'], fixed: ['pass', 'fixed'], changed: ['warn', 'status changed'], added: ['mute', 'only in this run'], removed: ['mute', 'only in ' + id], same: ['mute', 'unchanged'] };
  var shown = HS.changedOnly && rows.some(function(r){ return r.ch !== 'same'; }) ? rows.filter(function(r){ return r.ch !== 'same'; }) : rows;
  var bins = uniq(Object.keys(A.bins).concat(Object.keys(B.bins))).map(function(b){ var x = A.bins[b] || 0, y = B.bins[b] || 0; return { b: b, a: x, c: y, lost: !x && y, gained: x && !y }; });
  var dcov = A.fpct != null && B.fpct != null ? Math.round((A.fpct - B.fpct) * 100) / 100 : null;
  var h = '<div class="panel" id="cmp-panel"><div class="panel-h"><h2>This run vs ' + esc(id) + '</h2><label class="switch" style="text-transform:none"><input type="checkbox" id="cmp-changed"' + (HS.changedOnly ? ' checked' : '') + '> changed only</label><button class="btn" data-cmp="">Close</button></div>';
  h += '<div class="panel-b" style="display:grid;gap:14px"><div class="delta" style="grid-template-columns:repeat(5,minmax(0,1fr))">' +
    '<div><div class="n" style="color:' + (cnt('regressed') ? 'var(--fail)' : 'inherit') + '">' + cnt('regressed') + '</div><div class="l">newly failing</div></div>' +
    '<div><div class="n" style="color:' + (cnt('fixed') ? 'var(--pass)' : 'inherit') + '">' + cnt('fixed') + '</div><div class="l">fixed</div></div>' +
    '<div><div class="n">' + cnt('same') + '</div><div class="l">unchanged</div></div>' +
    '<div><div class="n">' + (cnt('added') + cnt('removed')) + '</div><div class="l">only in one run</div></div>' +
    '<div><div class="n">' + (dcov == null ? 'n/a' : (dcov > 0 ? '+' : '') + dcov) + '</div><div class="l">coverage pts</div></div></div>';
  h += '<div class="tbl"><table><thead><tr><th>Test # seed @ config</th><th>This run</th><th>' + esc(id) + '</th><th>Change</th><th class="n">Time Δ</th></tr></thead><tbody>' + shown.map(function(r){
    var ri = RUNS.findIndex(function(z){ return z.test + '#' + z.seed + '@' + z.config === r.k; });
    return '<tr' + (ri >= 0 ? ' class="click" data-run="' + ri + '"' : '') + '><td class="mono">' + esc(r.k) + '</td><td>' + (r.a ? pill(r.a[0]) : '–') + '</td><td>' + (r.b ? pill(r.b[0]) : '–') + '</td><td>' + pill(CH[r.ch][0] === 'fail' ? 'FAIL' : CH[r.ch][0] === 'pass' ? 'PASS' : CH[r.ch][0] === 'warn' ? 'ERROR' : 'x', CH[r.ch][1]) + '</td><td class="n mono"' + (r.dt != null && Math.abs(r.dt) > 0.05 ? ' style="color:' + (r.dt > 0 ? 'var(--warn)' : 'var(--pass)') + '"' : '') + '>' + (r.dt == null ? '–' : (r.dt > 0 ? '+' : '') + r.dt.toFixed(2) + ' s') + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  if (bins.length) h += '<div class="tbl"><table><thead><tr><th>Coverage bin</th><th class="n">Hits, this run</th><th class="n">Hits, ' + esc(id) + '</th><th></th></tr></thead><tbody>' + bins.filter(function(x){ return !HS.changedOnly || x.lost || x.gained || x.a !== x.c; }).map(function(x){ return '<tr><td class="mono">' + esc(x.b.replace(/^BIN-/, '')) + '</td><td class="n">' + x.a + '</td><td class="n">' + x.c + '</td><td>' + (x.lost ? pill('FAIL', 'lost') : x.gained ? pill('PASS', 'newly hit') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  return h + '</div></div>';
}

/* ------------------------------------------------------------ waveform viewer (VCD) */
var FS = { fs: 1, ps: 1e3, ns: 1e6, us: 1e9, ms: 1e12, s: 1e15 };
function parseVcd(txt){
  var tk = txt.split(/\s+/), i = 0, scope = [], vars = {}, sigs = [], t = 0, tmax = 0, ts = 1, unit = 'ns';
  var skip = function(){ while (i < tk.length && tk[i] !== '$end') i++; i++; };
  while (i < tk.length) {
    var w = tk[i++]; if (!w) continue;
    var c = w.charAt(0);
    if (c === '#') { t = +w.slice(1); if (t > tmax) tmax = t; continue; }
    if (c === 'b' || c === 'B' || c === 'r' || c === 'R') { var id = tk[i++]; if (vars[id]) vars[id].ch.push([t, w.slice(1)]); continue; }
    if (c !== '$') { if (w.length > 1 && vars[w.slice(1)]) vars[w.slice(1)].ch.push([t, c]); continue; }
    if (w === '$timescale') { var s = ''; while (i < tk.length && tk[i] !== '$end') s += tk[i++]; i++; var mm = /(\d+)\s*([munpf]?s)/.exec(s); if (mm) { ts = +mm[1]; unit = mm[2]; } }
    else if (w === '$scope') { i++; scope.push(tk[i++]); skip(); }
    else if (w === '$upscope') { scope.pop(); skip(); }
    else if (w === '$var') {
      var type = tk[i++], width = +tk[i++], vid = tk[i++], name = tk[i++], rng = tk[i] !== '$end' ? tk[i] : ''; skip();
      if (!vars[vid]) vars[vid] = { width: width, ch: [] };
      sigs.push({ name: name + (rng && width > 1 && !/\[/.test(name) ? rng : ''), path: scope.concat([name]).join('.'), depth: scope.length, width: width, v: vars[vid], type: type });
    }
    else if (w === '$dumpvars' || w === '$dumpall' || w === '$dumpon' || w === '$dumpoff' || w === '$end') { /* value section markers */ }
    else skip();
  }
  return { sigs: sigs, tmax: tmax, tickFs: ts * (FS[unit] || 1e6), unit: unit, ts: ts };
}
function valAt(ch, T){ var lo = 0, hi = ch.length - 1, k = -1; while (lo <= hi) { var mid = (lo + hi) >> 1; if (ch[mid][0] <= T) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k < 0 ? null : ch[k][1]; }
function fmtVal(v, width){
  if (v == null) return '–';
  if (width <= 1) return v;
  if (/[xXzZ]/.test(v)) return v.length <= 8 ? v : 'x';
  var b = v.replace(/^0+(?=.)/, ''); if (b.length > 52) return 'h…';
  var n = parseInt(b, 2); return width <= 4 ? n.toString(10) : "'h" + n.toString(16);
}
function fmtT(ticks, w){ if (!ticks) return '0'; var fs = ticks * w.tickFs, u = fs >= 1e9 ? 'us' : fs >= 1e6 ? 'ns' : fs >= 1e3 ? 'ps' : 'fs'; var v = fs / FS[u]; return (Math.round(v * 100) / 100) + ' ' + u; }
var WV = null;
function waveSection(rel){
  if (!(rel in WAVES)) return '';
  if (WAVES[rel] == null) return '<div class="dr-sec"><h3>Waveform</h3><span class="muted">Too large to embed in the report — use “Open waveform”.</span></div>';
  return '<div class="dr-sec"><h3>Waveform <span class="spacer"></span><input class="mini-in" id="wv-q" type="search" placeholder="Filter signals"><button class="btn" id="wv-in" title="Zoom in">+</button><button class="btn" id="wv-out" title="Zoom out">−</button><button class="btn" id="wv-fit">Fit</button></h3><div class="wv" id="wv"><div class="wv-names" id="wv-names"></div><div class="wv-plot" id="wv-plot"></div></div><div class="muted" style="font-size:12px">Click to place the cursor · wheel to zoom · drag to pan · click a signal name to hide it · times in the log jump here</div></div>';
}
function initWave(rel){
  if (!WAVES[rel]) { WV = null; return; }
  var w = parseVcd(WAVES[rel]);
  var seen = {};
  var all = w.sigs.filter(function(s){ var k = s.path; if (seen[k]) return false; seen[k] = 1; return s.v.ch.length; });
  // signals first (clock on top), constants / parameters last
  var isParam = function(s){ return s.type === 'parameter' || /^[A-Z0-9_]+(\[|$)/.test(s.name); };
  all.sort(function(a, b){ return isParam(a) - isParam(b) || a.depth - b.depth || (/clk/i.test(b.name) - /clk/i.test(a.name)); });
  WV = { w: w, all: all, hidden: {}, q: '', t0: 0, t1: Math.max(1, w.tmax), cur: null, drag: null };
  render();
  function list(){ var q = WV.q.toLowerCase(); return WV.all.filter(function(s){ return !WV.hidden[s.path] && (!q || s.path.toLowerCase().indexOf(q) >= 0); }).slice(0, 40); }
  function render(){
    var plot = $('#wv-plot'), names = $('#wv-names'); if (!plot) return;
    var Wd = Math.max(200, plot.clientWidth || 500), LH = 24, sigs = list(), Ht = 22 + sigs.length * LH;
    var t0 = WV.t0, t1 = WV.t1, X = function(t){ return (t - t0) / (t1 - t0) * Wd; };
    var s = '<svg width="' + Wd + '" height="' + Ht + '" class="wv-svg">';
    var span = t1 - t0, raw = span / 8, p = Math.pow(10, Math.floor(Math.log10(raw))), stp = [1, 2, 5, 10].map(function(f){ return f * p; }).find(function(v){ return v >= raw; }) || p * 10;
    for (var tt = Math.ceil(t0 / stp) * stp; tt <= t1; tt += stp) s += '<line x1="' + X(tt) + '" x2="' + X(tt) + '" y1="16" y2="' + Ht + '" class="wv-grid"/><text x="' + (X(tt) + 3) + '" y="12" class="wv-ax">' + esc(fmtT(tt, WV.w)) + '</text>';
    sigs.forEach(function(sg, k){
      var y0 = 22 + k * LH + 4, y1 = y0 + LH - 8, ch = sg.v.ch;
      var st = 0; while (st < ch.length - 1 && ch[st + 1][0] <= t0) st++;
      if (sg.width <= 1) {
        var d = '', last = null;
        for (var j = st; j < ch.length && ch[j][0] <= t1; j++) {
          var xa = Math.max(0, X(ch[j][0])), xb = j + 1 < ch.length ? Math.min(Wd, X(ch[j + 1][0])) : Wd, v = ch[j][1];
          var yy = v === '1' ? y0 : v === '0' ? y1 : (y0 + y1) / 2;
          d += (last == null ? 'M' + xa + ' ' + yy : ' L' + xa + ' ' + yy) + ' L' + xb + ' ' + yy; last = yy;
          if (/[xXzZ]/.test(v)) s += '<rect x="' + xa + '" y="' + y0 + '" width="' + Math.max(1, xb - xa) + '" height="' + (y1 - y0) + '" class="wv-x"/>';
        }
        s += '<path d="' + d + '" class="wv-bit"/>';
      } else {
        for (var j2 = st; j2 < ch.length && ch[j2][0] <= t1; j2++) {
          var a = Math.max(0, X(ch[j2][0])), b2 = j2 + 1 < ch.length ? Math.min(Wd, X(ch[j2 + 1][0])) : Wd, e = Math.min(3, (b2 - a) / 2), ym = (y0 + y1) / 2, vv = fmtVal(ch[j2][1], sg.width), bad = /x|z/i.test(ch[j2][1]);
          s += '<path d="M' + a + ' ' + ym + ' L' + (a + e) + ' ' + y0 + ' L' + (b2 - e) + ' ' + y0 + ' L' + b2 + ' ' + ym + ' L' + (b2 - e) + ' ' + y1 + ' L' + (a + e) + ' ' + y1 + ' Z" class="wv-bus' + (bad ? ' wv-busx' : '') + '"/>';
          if (b2 - a > vv.length * 6.5 + 8) s += '<text x="' + (a + 6) + '" y="' + (ym + 4) + '" class="wv-val">' + esc(vv) + '</text>';
        }
      }
    });
    if (WV.cur != null && WV.cur >= t0 && WV.cur <= t1) s += '<line x1="' + X(WV.cur) + '" x2="' + X(WV.cur) + '" y1="0" y2="' + Ht + '" class="wv-cur"/><text x="' + (X(WV.cur) + 4) + '" y="' + (Ht - 4) + '" class="wv-curt">' + esc(fmtT(WV.cur, WV.w)) + '</text>';
    plot.innerHTML = s + '</svg>';
    names.innerHTML = '<div class="wv-nh">' + sigs.length + ' / ' + WV.all.length + ' signals</div>' + sigs.map(function(sg){ var v = WV.cur == null ? '' : fmtVal(valAt(sg.v.ch, WV.cur), sg.width); return '<div class="wv-n" data-hide="' + esc(sg.path) + '" title="' + esc(sg.path + ' (' + sg.width + ' bit) — click to hide') + '"><span>' + esc(sg.name) + '</span><b class="mono">' + esc(v) + '</b></div>'; }).join('') +
      (Object.keys(WV.hidden).length ? '<div class="wv-n" data-unhide="1"><span class="muted">show ' + Object.keys(WV.hidden).length + ' hidden</span></div>' : '');
  }
  WV.render = render;
  var plot = $('#wv-plot');
  var tAt = function(ev){ var r = plot.getBoundingClientRect(); return WV.t0 + (ev.clientX - r.left) / r.width * (WV.t1 - WV.t0); };
  var zoom = function(f, at){ var c = at == null ? (WV.t0 + WV.t1) / 2 : at, span = Math.max(2, (WV.t1 - WV.t0) * f); WV.t0 = Math.max(0, c - (c - WV.t0) * f); WV.t1 = WV.t0 + span; if (WV.t1 > WV.w.tmax * 1.05 + 1) { WV.t1 = WV.w.tmax * 1.05 + 1; WV.t0 = Math.max(0, WV.t1 - span); } render(); };
  plot.addEventListener('wheel', function(e){ e.preventDefault(); zoom(e.deltaY < 0 ? 0.8 : 1.25, tAt(e)); }, { passive: false });
  plot.addEventListener('mousedown', function(e){ WV.drag = { x: e.clientX, t0: WV.t0, t1: WV.t1, moved: false }; });
  window.addEventListener('mousemove', function(e){ if (!WV || !WV.drag) return; var r = plot.getBoundingClientRect(), dt = (e.clientX - WV.drag.x) / r.width * (WV.drag.t1 - WV.drag.t0); if (Math.abs(e.clientX - WV.drag.x) > 3) WV.drag.moved = true; WV.t0 = Math.max(0, WV.drag.t0 - dt); WV.t1 = WV.t0 + (WV.drag.t1 - WV.drag.t0); render(); });
  window.addEventListener('mouseup', function(e){ if (!WV || !WV.drag) return; var mv = WV.drag.moved; WV.drag = null; if (!mv && e.target.closest && e.target.closest('#wv-plot')) { WV.cur = Math.round(tAt(e)); render(); } });
  $('#wv-in').addEventListener('click', function(){ zoom(0.6); });
  $('#wv-out').addEventListener('click', function(){ zoom(1.6); });
  $('#wv-fit').addEventListener('click', function(){ WV.t0 = 0; WV.t1 = Math.max(1, WV.w.tmax); render(); });
  $('#wv-q').addEventListener('input', function(e){ WV.q = e.target.value; render(); });
  $('#wv-names').addEventListener('click', function(e){ var a = e.target.closest('[data-hide]'); if (a) { WV.hidden[a.getAttribute('data-hide')] = 1; render(); } if (e.target.closest('[data-unhide]')) { WV.hidden = {}; render(); } });
}
/** jump the waveform cursor to a time printed in the log (value + optional unit; plain numbers are VCD ticks) */
function jumpWave(val, unit){
  if (!WV) { toast('No waveform embedded for this run'); return; }
  var ticks = unit ? val * FS[unit] / WV.w.tickFs : val;
  WV.cur = Math.round(ticks);
  var span = Math.max(20, (WV.t1 - WV.t0));
  if (WV.cur < WV.t0 || WV.cur > WV.t1) { WV.t0 = Math.max(0, WV.cur - span / 2); WV.t1 = WV.t0 + span; }
  WV.render();
  var el2 = $('#wv'); if (el2) el2.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ------------------------------------------------------------ Ctrl+K quick search */
function paletteItems(){
  var it = [];
  TABS.forEach(function(t){ it.push({ k: 'tab', label: 'Go to ' + t.label, sub: 'tab', go: function(){ show(t.id); } }); });
  RUNS.forEach(function(r){ it.push({ k: 'run', label: runLabel(r), sub: r.status + (r.firstError ? ' — ' + r.firstError : ''), go: function(){ if (current !== 'runs') show('runs'); openRun(r._i); } }); });
  D.bins.forEach(function(b){ it.push({ k: 'bin', label: b.id, sub: b.state + ' · ' + b.desc, go: function(){ CS.q = b.id; CS.state = 'all'; CS.open[b.id] = true; show('coverage'); } }); });
  D.scenarios.forEach(function(s){ it.push({ k: 'scenario', label: s.id + ' ' + s.title, sub: s.execution + ' · test ' + (s.test || '-'), go: function(){ TR.open = TR.open || {}; TR.open[s.req] = true; show('trace'); } }); });
  D.requirements.forEach(function(q){ it.push({ k: 'requirement', label: q.id, sub: q.execution + ' · ' + q.text, go: function(){ TR.open = TR.open || {}; TR.open[q.id] = true; show('trace'); } }); });
  H.forEach(function(h){ if (h.id === m.runId) return; var link = histLink(h); it.push({ k: 'history', label: 'Run ' + h.id, sub: h.sim + ' · ' + h.pass + '/' + h.runs + ' passed', go: function(){ if (h.kind === 'dv') { HS.cmp = h.id; show('history'); } else if (link) { var a = document.createElement('a'); a.href = link; document.body.appendChild(a); a.click(); a.remove(); } } }); });
  return it;
}
var PAL = null;
function openPalette(){
  if (PAL) return;
  var items = paletteItems(), sel = 0;
  PAL = document.createElement('div'); PAL.className = 'pal-wrap';
  PAL.innerHTML = '<div class="pal" role="dialog" aria-label="Quick search"><input id="pal-q" placeholder="Search runs, bins, scenarios, requirements, tabs…" autocomplete="off"><div class="pal-list" id="pal-list"></div><div class="pal-f muted">↑↓ to move · Enter to open · Esc to close</div></div>';
  document.body.appendChild(PAL);
  var q = $('#pal-q'), list = $('#pal-list'), hits = [];
  function draw(){
    var t = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    hits = items.filter(function(x){ var s = (x.k + ' ' + x.label + ' ' + x.sub).toLowerCase(); return t.every(function(w){ return s.indexOf(w) >= 0; }); }).slice(0, 60);
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    list.innerHTML = hits.map(function(x, i){ return '<div class="pal-i' + (i === sel ? ' on' : '') + '" data-pi="' + i + '"><span class="pal-k">' + esc(x.k) + '</span><span class="pal-l">' + esc(x.label) + '</span><span class="pal-s">' + esc(x.sub) + '</span></div>'; }).join('') || '<div class="pal-i muted">No matches</div>';
    var on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function pick(i){ var x = hits[i]; closePalette(); if (x) x.go(); }
  q.addEventListener('input', function(){ sel = 0; draw(); });
  q.addEventListener('keydown', function(e){
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(hits.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  list.addEventListener('click', function(e){ var a = e.target.closest('[data-pi]'); if (a) pick(+a.getAttribute('data-pi')); });
  PAL.addEventListener('mousedown', function(e){ if (e.target === PAL) closePalette(); });
  draw(); q.focus();
}
function closePalette(){ if (PAL) { PAL.remove(); PAL = null; } }

var VIEWS = { overview: overview, runs: runsView, coverage: coverageView, trace: traceView, failures: failuresView, history: historyView, info: infoView };
var AFTER = {
  history: function(){ var f = $('#h-full'); if (f) f.addEventListener('change', function(){ HS.fullOnly = f.checked; show('history'); }); var c = $('#cmp-changed'); if (c) c.addEventListener('change', function(){ HS.changedOnly = c.checked; show('history'); setTimeout(function(){ var p = $('#cmp-panel'); if (p) p.scrollIntoView({ block: 'start' }); }, 20); }); },
  runs: afterRuns,
  coverage: afterCoverage,
  trace: function(){
    $('#tr-all').addEventListener('click', function(){ D.requirements.forEach(function(q){ TR.open[q.id] = true; }); $$('.req').forEach(function(e){ e.classList.add('open'); }); });
    $('#tr-none').addEventListener('click', function(){ TR.open = {}; $$('.req').forEach(function(e){ e.classList.remove('open'); }); });
  }
};

/* ------------------------------------------------------------ events */
document.addEventListener('click', function(e){
  var t = e.target;
  var el;
  if ((el = t.closest('[data-theme-set]'))) return setTheme(el.getAttribute('data-theme-set'));
  if ((el = t.closest('[data-tab]'))) return show(el.getAttribute('data-tab'));
  if ((el = t.closest('[data-go]'))) return show(el.getAttribute('data-go'));
  if ((el = t.closest('[data-copy]'))) return copy(COPY[+el.getAttribute('data-copy')]);
  if ((el = t.closest('[data-jump]'))) return jumpWave(+el.getAttribute('data-jump'), el.getAttribute('data-unit') || null);
  if ((el = t.closest('[data-rerun]'))) return rerun(+el.getAttribute('data-rerun'));
  if (t.closest('#pal-btn')) return openPalette();
  if ((el = t.closest('[data-hsim]'))) { HS.sim = el.getAttribute('data-hsim'); return show('history'); }
  if ((el = t.closest('[data-hkind]'))) { HS.kind = el.getAttribute('data-hkind'); return show('history'); }
  if ((el = t.closest('[data-cmp]'))) { HS.cmp = el.getAttribute('data-cmp') || null; show('history'); if (HS.cmp) setTimeout(function(){ var p = $('#cmp-panel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); return; }
  if ((el = t.closest('[data-close]')) || t.id === 'scrim') return closeDrawer();
  if ((el = t.closest('[data-nav]'))) return navRun(+el.getAttribute('data-nav'));
  if ((el = t.closest('[data-st]'))) { RS.status = el.getAttribute('data-st'); return renderRuns(); }
  if ((el = t.closest('[data-bst]'))) { CS.state = el.getAttribute('data-bst'); return renderBins(); }
  if ((el = t.closest('[data-sort]'))) { var k = el.getAttribute('data-sort'); if (RS.sort === k) RS.dir = -RS.dir; else { RS.sort = k; RS.dir = 1; } return renderRuns(); }
  if ((el = t.closest('[data-toggle-req]'))) { var id = el.getAttribute('data-toggle-req'); TR.open[id] = !TR.open[id]; el.parentNode.classList.toggle('open', !!TR.open[id]); return; }
  if (t.closest('a[href]')) return;
  if ((el = t.closest('[data-bin]'))) { var b = el.getAttribute('data-bin'); CS.open[b] = !CS.open[b]; return renderBins(); }
  if ((el = t.closest('[data-run]'))) { var i = +el.getAttribute('data-run'); if (i >= 0) openRun(i); return; }
});
function rerun(i){
  var r = RUNS[i]; if (!r) return;
  var kind = m.kind || 'dv';
  if (window.__dvVs) { window.__dvVs.postMessage({ type: 'rerun', kind: kind, test: r.test, seed: r.seed, config: r.config, sim: m.simulator }); toast('Rerun started in VS Code — its dashboard opens when it finishes'); }
  else copy(kind === 'uvm' ? 'dvflow uvm --sim ' + m.simulator + ' --tests ' + r.test + ' --seed ' + r.seed : kind === 'cocotb' ? 'dvflow cocotb --sim ' + m.simulator + ' --tests ' + r.test + ' --seed ' + r.seed : 'dvflow run --sim ' + m.simulator + ' --test ' + r.test + ' --seed ' + r.seed + ' --config ' + r.config + ' --waves 1');
}
document.addEventListener('keydown', function(e){
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (PAL) closePalette(); else openPalette(); return; }
  if (PAL) return;
  var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
  if (e.key === 'Escape') { if (typing) { e.target.blur(); return; } if (drawerRun != null) closeDrawer(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { var s = $('main input[type=search]'); if (s) { e.preventDefault(); s.focus(); } return; }
  if (drawerRun != null && (e.key === 'j' || e.key === 'ArrowDown')) { e.preventDefault(); return navRun(1); }
  if (drawerRun != null && (e.key === 'k' || e.key === 'ArrowUp')) { e.preventDefault(); return navRun(-1); }
  var n = +e.key; if (n >= 1 && n <= TABS.length) show(TABS[n - 1].id);
});
window.addEventListener('hashchange', function(){ var h = (location.hash || '').slice(1); if (h && h !== current) show(h); });

show((location.hash || '').slice(1) || 'overview');
})();
`;

module.exports = { write };
