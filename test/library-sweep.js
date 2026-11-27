#!/usr/bin/env node
'use strict';
/*
 * Library sweep: every design in examples/library through the extension's own flow.
 *   node test/library-sweep.js [--only <substring>] [--sim icarus] [--no-run] [--out <dir>]
 * For each design: identify it (vs meta.json expected_template), then — when a template exists for it —
 * create a project in a scratch copy (dvflow init), run the regression and record the result.
 * Writes <out>/library-report.md and library-report.json. Uses DVFLOW_TOOLCHAIN from the environment (e.g. container).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const hp = require(path.join(ROOT, 'src', 'hdlparse'));
const { identify } = require(path.join(ROOT, 'src', 'dv', 'identify'));
const { TEMPLATES } = require(path.join(ROOT, 'src', 'dv', 'templates'));

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const only = arg('only', null), sim = arg('sim', 'icarus'), noRun = !!arg('no-run', false);
const out = path.resolve(arg('out', path.join(os.tmpdir(), 'tenx-library-sweep')));
fs.mkdirSync(out, { recursive: true });

const lib = path.join(ROOT, 'examples', 'library');
const designs = [];
for (const cat of fs.readdirSync(lib)) {
  const cd = path.join(lib, cat);
  if (!fs.statSync(cd).isDirectory()) continue;
  for (const name of fs.readdirSync(cd)) {
    const dir = path.join(cd, name), meta = path.join(dir, 'meta.json');
    if (fs.existsSync(meta) && (!only || name.includes(only))) designs.push({ cat, name, dir, meta: JSON.parse(fs.readFileSync(meta, 'utf8')) });
  }
}
const cli = path.join(ROOT, 'src', 'dv', 'cli.js');
const runCli = (args, timeoutMs) => cp.spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: timeoutMs || 600000, env: process.env, maxBuffer: 1 << 26 });
const rows = [];
for (const d of designs) {
  const rtl = path.join(d.dir, d.name + '.sv');
  const text = fs.readFileSync(rtl, 'utf8');
  const mods = hp.parseModules(text);
  const mod = mods.find(m => m.name === d.name) || mods[mods.length - 1];
  const id = identify(mod, text);
  const exp = d.meta.expected_template;
  const r = { name: d.name, category: d.cat, expected: exp, identified: id.template, confidence: id.confidence, protocol: d.meta.protocol || null, protocolFound: id.protocol, idOk: id.template === exp, reasons: id.reasons.join('; '), run: 'not run', detail: '' };
  if (!noRun) {
    // the same path as "DV: New Design from Library": dvflow new --design <name>
    const proj = path.join(out, d.name);
    fs.rmSync(proj, { recursive: true, force: true });
    const init = runCli(['new', '--design', d.name, '--root', proj], 120000);
    const cfgf = path.join(proj, 'dvflow.json');
    const pcfg = fs.existsSync(cfgf) ? JSON.parse(fs.readFileSync(cfgf, 'utf8')) : null;
    const written = pcfg && pcfg.behavior && pcfg.behavior.checks && Object.values(pcfg.behavior.checks).length && !Object.values(pcfg.behavior.checks).some(v => /\/\*\s*expected/.test(String(v)));
    r.template = pcfg ? pcfg.template : null;
    if (init.status !== 0 || !pcfg) { r.run = 'INIT ERROR'; r.detail = (init.stdout + init.stderr).split('\n').filter(l => /error|cannot|needs/i.test(l)).slice(0, 2).join(' ').slice(0, 220); }
    else if (pcfg.template === 'custom' && !written) {
      r.run = 'needs behaviour';
      r.detail = (pcfg.note || (d.meta.sequential ? 'clocked custom design: expected behaviour (model_step) not written yet; its self-check is in tb/selfcheck/' : 'expected behaviour not written yet')).slice(0, 200);
    } else {
      const t0 = Date.now();
      const reg = runCli(['regress', '--sim', sim, '--seeds', '1:2', '--root', proj], 900000);
      const txt = reg.stdout + reg.stderr;
      const m = /== (\d+)\/(\d+) passed[^\n]*?functional coverage ([^ ]+)/.exec(txt);
      r.run = m ? (m[1] === m[2] ? 'PASS' : 'FAIL') : 'ERROR';
      r.passed = m ? `${m[1]}/${m[2]}` : '';
      r.coverage = m ? m[3] : '';
      r.seconds = Math.round((Date.now() - t0) / 1000);
      if (r.run !== 'PASS') r.detail = (txt.match(/first mismatch:[^\n]*|STAGE [^\n]*|\bERROR\b[^\n]*/g) || []).slice(0, 2).join(' | ').slice(0, 240);
    }
  }
  rows.push(r);
  console.log(`${r.idOk ? 'ok  ' : 'MISS'} ${d.name.padEnd(24)} expected ${String(exp).padEnd(16)} identified ${String(id.template).padEnd(16)} ${id.protocol ? '[' + id.protocol + '] ' : ''}${r.run}${r.passed ? ' ' + r.passed : ''}${r.detail ? '  ' + r.detail : ''}`);
}
const n = rows.length, idOk = rows.filter(r => r.idOk).length;
const ran = rows.filter(r => ['PASS', 'FAIL', 'ERROR', 'INIT ERROR'].includes(r.run)), pass = ran.filter(r => r.run === 'PASS').length;
const protoRows = rows.filter(r => r.protocol), protoOk = protoRows.filter(r => r.protocol === r.protocolFound).length;
const md = [`# Library sweep (${new Date().toISOString().slice(0, 10)}, ${sim})`, '',
  `- Designs: **${n}**`,
  `- Identified as expected: **${idOk}/${n}** (${Math.round(100 * idOk / Math.max(1, n))}%)`,
  protoRows.length ? `- Protocol recognised: **${protoOk}/${protoRows.length}**` : '',
  `- Regression with the identified template: **${pass}/${ran.length} pass**` + (rows.length - ran.length ? ` (${rows.length - ran.length} have no automatic template yet: custom / FSM / protocol, written via behavior.checks)` : ''), '',
  '| Design | Category | Expected | Identified | Conf. | Protocol | Regression | Detail |', '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.name} | ${r.category} | ${r.expected} | ${r.idOk ? '' : '**'}${r.identified}${r.idOk ? '' : '**'} | ${r.confidence} | ${r.protocol ? (r.protocol === r.protocolFound ? r.protocol : `**${r.protocolFound || 'none'}** (exp ${r.protocol})`) : ''} | ${r.run}${r.passed ? ' ' + r.passed : ''} | ${(r.detail || '').replace(/\|/g, '/')} |`)].filter(x => x !== '').join('\n');
fs.writeFileSync(path.join(out, 'library-report.md'), md + '\n');
fs.writeFileSync(path.join(out, 'library-report.json'), JSON.stringify(rows, null, 2));
console.log(`\nidentified ${idOk}/${n} · regression ${pass}/${ran.length} pass · report: ${path.join(out, 'library-report.md')}`);
