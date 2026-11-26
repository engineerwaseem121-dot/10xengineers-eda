'use strict';
/*
 * Mutation testing: "would my testbench notice a bug?"
 * Small, realistic bugs (mutants) are planted in copies of the DUT, the regression is run against each, and every
 * mutant is classified:
 *   killed    a test failed or timed out           -> the testbench caught the bug
 *   survived  every test still passed              -> a verification hole (missing check, stimulus or scenario)
 *   invalid   the mutant did not compile           -> excluded from the score
 * Score = killed / (killed + survived).  Results: runs/<id>-mutation/{mutation.json, mutation.html}.
 */
const fs = require('fs');
const path = require('path');
const runner = require('./runner');

/** operator rules: [label, regex on comment-free text, replacement] — every match position becomes one mutant */
const RULES = [
  ['& → |', /(?<![&|^~])&(?![&=])/g, '|'],
  ['| → &', /(?<![&|^~])\|(?![|=])/g, '&'],
  ['^ → |', /(?<![~])\^(?![~=])/g, '|'],
  ['&& → ||', /&&/g, '||'],
  ['|| → &&', /\|\|/g, '&&'],
  ['+ → -', /(?<![+\[:])\+(?![+=:])/g, '-'],
  ['- → +', /(?<![-\[:])-(?![-=>:\d])/g, '+'],
  ['== → !=', /==(?!=)/g, '!='],
  ['!= → ==', /!=(?!=)/g, '=='],
  ['< → >', /(?<![<=])<(?![<=])/g, '>'],
  ['> → <', /(?<![>=\-])>(?![>=])/g, '<'],
  ['posedge → negedge', /\bposedge\b/g, 'negedge'],
  ["1'b0 → 1'b1", /1'b0/g, "1'b1"],
  ["1'b1 → 1'b0", /1'b1/g, "1'b0"],
  ['drop ~', /~(?=[\w(])/g, ''],
  ['drop !', /!(?=[\w(])/g, '']
];
/** lines where an operator is not part of logic: declarations, ports, parameters, preprocessor, module headers */
const SKIP_LINE = /^\s*(input|output|inout|logic|wire|reg|bit|int|integer|parameter|localparam|typedef|genvar|module|endmodule|`|\/\/|\$)|^\s*for\s*\(/;

/** blank comments and strings, keeping offsets */
function blank(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"/g, m => m.replace(/[^\n]/g, ' '));
}

/** all mutants of one source text: [{rule, line, col, before, after, text}] */
function mutantsOf(text) {
  const clean = blank(text);
  const lines = clean.split('\n');
  const starts = []; let off = 0; for (const l of lines) { starts.push(off); off += l.length + 1; }
  const lineAt = pos => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const out = [];
  for (const [label, re, rep] of RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean))) {
      const ln = lineAt(m.index);
      const lineText = lines[ln];
      if (SKIP_LINE.test(lineText)) continue;
      const col = m.index - starts[ln];
      // the nonblocking assignment "x <= y" and port arrows are not comparisons
      if ((label.startsWith('<') || label.startsWith('>')) && /<=|=>|->/.test(lineText.slice(Math.max(0, col - 1), col + 2))) continue;
      // inside a bit range [a:b] or a replication {n{..}} '-' / '+' are index arithmetic: still a real bug, keep it
      const mutated = text.slice(0, m.index) + rep + text.slice(m.index + m[0].length);
      const orig = text.split('\n')[ln];
      const newLine = mutated.split('\n')[ln];
      out.push({ rule: label, line: ln + 1, col: col + 1, before: orig.trim(), after: newLine.trim(), text: mutated });
    }
  }
  // one mutant per (line, rule, column) — stable order: by line, then rule
  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

/**
 * Formal equivalence of the original DUT and a survivor (Yosys equiv_*): a survivor that is logically identical to
 * the original is not a testbench hole and must not count against the score.
 * returns 'equivalent' | 'different' | 'unknown' (no yosys / unsupported construct)
 */
function equivalence(root, cfg, mutFile, mutPath, log) {
  const cp = require('child_process');
  const ct = require('./container');
  const top = cfg.dut.top;
  const read = files => files.map(f => `read_verilog -sv -defer "${String(f).replace(/\\/g, '/')}"`).join('; ');
  const gold = cfg.dut.files.map(f => path.resolve(root, f));
  const gate = cfg.dut.files.map(f => (f === mutFile ? mutPath : path.resolve(root, f)));
  const script = [
    read(gold), `hierarchy -top ${top}`, `proc; flatten; opt_clean`, `rename ${top} gold`, 'design -stash gold',
    read(gate), `hierarchy -top ${top}`, `proc; flatten; opt_clean`, `rename ${top} gate`, 'design -stash gate',
    'design -copy-from gold -as gold gold', 'design -copy-from gate -as gate gate',
    'equiv_make gold gate equiv', 'hierarchy -top equiv', 'equiv_simple -seq 5', 'equiv_induct -seq 5', 'equiv_status -assert'
  ].join('; ');
  let r;
  const local = (() => { try { return cp.spawnSync('yosys', ['-V'], { windowsHide: true, timeout: 10000 }).status === 0; } catch (e) { return false; } })();
  if (local) r = cp.spawnSync('yosys', ['-q', '-p', script], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  else if (ct.canRun([root])) { const w = ct.wrap({ cmd: 'ctr:yosys', args: ['-q', '-p', ct.mapText(script)], cwd: root }); r = cp.spawnSync(w.cmd, w.args, { cwd: w.cwd, encoding: 'utf8', windowsHide: true, timeout: 180000 }); }
  else return 'unknown';
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) return 'equivalent';
  if (/Found \d+ unproven|unproven \$equiv/i.test(out)) return 'different';
  if (log) log(`   (equivalence check inconclusive: ${(out.split('\n').find(l => /ERROR/.test(l)) || 'exit ' + r.status).trim()})`);
  return 'unknown';
}

/** spread a limited budget evenly over the candidates (keeps every part of the DUT represented) */
function sample(list, max) {
  if (list.length <= max) return list;
  const step = list.length / max;
  return Array.from({ length: max }, (_, i) => list[Math.floor(i * step)]);
}

/**
 * o: { sim, max (default 40), tests, seeds, log, token, override, settings, timeoutS }
 * returns { id, dir, score, killed, survived, invalid, mutants: [...], report }
 */
async function run(root, o) {
  o = o || {};
  const log = o.log || (() => {});
  const cfg = runner.loadConfig(root);
  const id = `${runner.nowId()}-mutation`;
  const dir = path.join(root, 'runs', id);
  fs.mkdirSync(dir, { recursive: true });
  const max = Math.max(1, Number(o.max) || 40);
  const all = [];
  for (const f of cfg.dut.files) {
    const abs = path.resolve(root, f);
    if (!/\.s?v$/i.test(f) || !fs.existsSync(abs)) continue;
    mutantsOf(fs.readFileSync(abs, 'utf8').replace(/^﻿/, '')).forEach(m => all.push(Object.assign({ file: f }, m)));
  }
  const chosen = sample(all, max);
  log(`== mutation testing ${id}: ${all.length} possible mutant(s) in ${cfg.dut.files.join(', ')}; running ${chosen.length} on ${o.sim || cfg.simulator}`);
  const seeds = o.seeds && o.seeds.length ? o.seeds : [cfg.seeds[0] || 1];
  const results = [];
  const t0 = Date.now();
  for (let k = 0; k < chosen.length; k++) {
    if (o.token && o.token.isCancellationRequested) break;
    const mu = chosen[k];
    const mid = 'm' + String(k + 1).padStart(3, '0');
    const mdir = path.join(dir, 'mutants', mid);
    fs.mkdirSync(mdir, { recursive: true });
    // the mutated file replaces the original; the other DUT files stay as they are
    const mfile = path.join(mdir, path.basename(mu.file));
    fs.writeFileSync(mfile, mu.text);
    const files = cfg.dut.files.map(f => (f === mu.file ? path.relative(root, mfile).replace(/\\/g, '/') : f));
    let res, status, by = [], why = '';
    try {
      res = await runner.regress(root, { sim: o.sim, tests: o.tests, seeds, suite: 'mutation', dutFiles: files, mutant: true, runId: `${id}/runs/${mid}`, log: () => {}, token: o.token, override: o.override, settings: o.settings, timeoutS: o.timeoutS || 60 });
      const failed = res.runs.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT');
      if (res.builds.some(b => b.failed)) { status = 'invalid'; why = ((res.builds.find(b => b.failed).errors || [])[0] || {}).message || 'did not compile'; }
      else if (failed.length) { status = 'killed'; by = [...new Set(failed.map(r => r.test))]; why = failed[0].firstError || failed[0].status; }
      else if (res.runs.every(r => r.status === 'PASS')) status = 'survived';
      else { status = 'invalid'; why = (res.runs.find(r => r.status !== 'PASS') || {}).status || 'not run'; }
    } catch (e) { status = 'invalid'; why = e.message; }
    // a survivor may simply be the same logic written differently: prove it before calling it a hole
    if (status === 'survived' && o.equiv !== false) {
      const eq = equivalence(root, cfg, mu.file, mfile, log);
      if (eq === 'equivalent') { status = 'equivalent'; why = 'formally equivalent to the original (Yosys equiv_*): no test can tell them apart'; }
      else if (eq === 'different') why = 'formally different from the original (Yosys), yet every test passed';
    }
    const { text, ...meta } = mu;
    results.push(Object.assign(meta, { id: mid, status, killedBy: by, why: String(why).slice(0, 300), mutantFile: path.relative(dir, mfile).replace(/\\/g, '/') }));
    log(`[${status.toUpperCase().padEnd(8)}] ${mid} ${mu.file}:${mu.line}  ${mu.rule.padEnd(18)} ${mu.after}${by.length ? '   ← caught by ' + by.join(', ') : ''}`);
  }
  const killed = results.filter(r => r.status === 'killed').length, survived = results.filter(r => r.status === 'survived').length, invalid = results.filter(r => r.status === 'invalid').length, equivalent = results.filter(r => r.status === 'equivalent').length;
  const score = killed + survived ? Math.round(killed * 1000 / (killed + survived)) / 10 : null;
  const out = { id, dir, started: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 100) / 10, simulator: o.sim || cfg.simulator, dut: cfg.dut.top, files: cfg.dut.files, possible: all.length, ran: results.length, killed, survived, invalid, equivalent, score, mutants: results };
  fs.writeFileSync(path.join(dir, 'mutation.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(dir, 'mutation.html'), html(out));
  out.report = path.join(dir, 'mutation.html');
  log(`== mutation score ${score == null ? 'n/a' : score + '%'}: ${killed} killed, ${survived} survived, ${equivalent} equivalent, ${invalid} invalid of ${results.length} (${out.seconds}s) · report: ${path.relative(root, out.report)}`);
  if (survived) log('   Survivors are bugs the testbench would miss: add a check or stimulus that tells the mutated line apart.');
  return out;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function html(r) {
  const tone = s => (s === 'killed' ? 'pass' : s === 'survived' ? 'fail' : 'mute');
  const rows = r.mutants.map(m => `<tr class="st-${m.status}"><td class="mono">${m.id}</td><td><span class="pill t-${tone(m.status)}">${m.status}</span></td><td class="mono"><a href="../../${esc(r.files.find(f => path.basename(f) === path.basename(m.file)) || m.file)}#L${m.line}">${esc(path.basename(m.file))}:${m.line}</a></td><td>${esc(m.rule)}</td><td class="mono code"><div class="b">${esc(m.before)}</div><div class="a">${esc(m.after)}</div></td><td>${m.killedBy.length ? esc(m.killedBy.join(', ')) : ''}<div class="muted small">${esc(m.status === 'survived' ? (m.why || 'every test passed with this bug') : m.why)}</div></td></tr>`).join('');
  const C = 2 * Math.PI * 34, v = r.score || 0;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mutation testing — ${esc(r.dut)}</title><style>
:root{--bg:#f3f5f8;--surface:#fff;--fg:#16202b;--muted:#5a6776;--border:#d9dfe6;--pass:#16834a;--fail:#c9303e;--mute:#8793a0;--accent:#2457d6;--font:"Segoe UI",system-ui,sans-serif;--mono:"Cascadia Code",Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0d1217;--surface:#141b22;--fg:#e3e9ef;--muted:#94a2b0;--border:#26313c;--pass:#40c07c;--fail:#ff6b75;--mute:#6f7d8a;--accent:#6f9dff;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--font)}main{max-width:1200px;margin:0 auto;padding:24px;display:grid;gap:20px}
h1{font-size:20px;margin:0}.muted{color:var(--muted)}.small{font-size:12px}.mono{font-family:var(--mono);font-size:12.5px}
.top{display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px}
.ring{width:96px;height:96px}.ring circle{fill:none;stroke-width:9}.ring text{font:700 20px var(--font);fill:var(--fg)}
.k{display:grid;grid-template-columns:repeat(4,auto);gap:4px 28px}.k b{font-size:22px;display:block}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 12px;border-top:1px solid var(--border);text-align:left;vertical-align:top}thead th{border-top:0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.pill{font-size:12px;font-weight:600;padding:1px 9px;border-radius:999px}.t-pass{color:var(--pass);background:color-mix(in srgb,var(--pass) 13%,transparent)}.t-fail{color:var(--fail);background:color-mix(in srgb,var(--fail) 13%,transparent)}.t-mute{color:var(--mute);background:color-mix(in srgb,var(--mute) 14%,transparent)}
.code .b{color:var(--muted);text-decoration:line-through}.code .a{color:var(--fg)}tr.st-survived{background:color-mix(in srgb,var(--fail) 6%,transparent)}a{color:var(--accent)}
.chips button{border:1px solid var(--border);background:var(--surface);color:var(--fg);border-radius:999px;padding:3px 12px;cursor:pointer;margin-right:6px}.chips button.on{background:var(--fg);color:var(--bg)}
</style></head><body><main>
<div><h1>Mutation testing — ${esc(r.dut)}</h1><div class="muted">${esc(r.id)} · ${esc(r.simulator)} · ${r.ran} of ${r.possible} possible mutants · ${r.seconds}s</div></div>
<div class="top"><svg class="ring" viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" style="stroke:var(--border)"/><circle cx="40" cy="40" r="34" style="stroke:var(--${v >= 90 ? 'pass' : v >= 70 ? 'accent' : 'fail'})" stroke-dasharray="${(C * v / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)" stroke-linecap="round"/><text x="40" y="47" text-anchor="middle">${r.score == null ? 'n/a' : Math.round(r.score) + '%'}</text></svg>
<div><div style="font-weight:600;margin-bottom:6px">Mutation score: the share of planted bugs the testbench caught</div><div class="k" style="grid-template-columns:repeat(5,auto)"><span><b style="color:var(--pass)">${r.killed}</b>killed</span><span><b style="color:var(--fail)">${r.survived}</b>survived</span><span><b>${r.equivalent || 0}</b>equivalent</span><span><b>${r.invalid}</b>did not compile</span><span><b>${r.ran}</b>mutants run</span></div>
<p class="muted small" style="max-width:76ch;margin:10px 0 0">A <b>survived</b> mutant is a bug the tests would miss: add a check on the output it changes, or stimulus that makes the original and mutated code behave differently. <b>Equivalent</b> mutants were proven logically identical to the original with Yosys, so no test could catch them; they don't count against the score.</p></div></div>
<div class="chips"><button class="on" data-f="all">All</button><button data-f="survived">Survived</button><button data-f="killed">Killed</button><button data-f="equivalent">Equivalent</button><button data-f="invalid">Did not compile</button></div>
<div class="panel"><table><thead><tr><th>#</th><th>Result</th><th>Where</th><th>Mutation</th><th>Original → mutated line</th><th>Caught by</th></tr></thead><tbody id="rows">${rows}</tbody></table></div>
</main><script>document.querySelector('.chips').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;document.querySelectorAll('.chips button').forEach(function(x){x.classList.toggle('on',x===b)});var f=b.getAttribute('data-f');document.querySelectorAll('#rows tr').forEach(function(tr){tr.style.display=f==='all'||tr.classList.contains('st-'+f)?'':'none'})});</script></body></html>`;
}

module.exports = { run, mutantsOf, blank, sample, equivalence, RULES };
