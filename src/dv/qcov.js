'use strict';
/*
 * Questa coverage post-processing: merge per-run UCDBs, write text + HTML reports, extract percentages.
 *   - code metrics (statement/branch/condition/expression/toggle/FSM) are summed over the DUT design units only,
 *     so testbench / UVM code does not inflate the numbers
 *   - covergroup coverage is taken from every design unit (covergroups live in the testbench)
 * Parsing is best effort over the `vcover report -summary` layouts of Questa 10.x–2023; the raw reports are
 * always kept next to the merged UCDB so nothing depends on the parser alone.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const sim = require('./sim');

const CODE = ['Statements', 'Branches', 'Conditions', 'Expressions', 'Toggles', 'FSM States', 'FSM Transitions'];
const CG = ['Covergroups', 'Covergroup Bins', 'Coverpoints/Crosses'];
const ALL = CODE.concat(CG, ['Assertions', 'Directives', 'Cover Directives']);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROW = new RegExp('^\\s*(' + ALL.map(esc).join('|') + ')\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+([\\d.]+)%', 'i');

/**
 * Parse `vcover report -summary` text.
 * returns { units: [{ name, metrics: {Statements: {bins, hits}}}], covergroups: [{ name, pct }] }
 */
function parseSummary(text) {
  const units = [];
  let cur = null;
  const covergroups = [];
  for (const line of String(text).split(/\r?\n/)) {
    const h = /^===\s*(?:Design Unit|Instance|File):\s*(\S+)/i.exec(line);
    if (h) { cur = { name: h[1], metrics: {} }; units.push(cur); continue; }
    if (/^\s*(Total Coverage|Coverage Report Totals|TOTAL)/i.test(line)) { cur = null; }
    const m = ROW.exec(line);
    if (m) {
      if (!cur) { cur = { name: '(totals)', metrics: {}, totals: true }; units.push(cur); }
      const k = CODE.concat(CG, ['Assertions', 'Directives', 'Cover Directives']).find(x => x.toLowerCase() === m[1].toLowerCase());
      if (!cur.metrics[k]) cur.metrics[k] = { bins: +m[2], hits: +m[3] };
      continue;
    }
    const g = /^\s*TYPE\s+(\S+)\s+([\d.]+)%/.exec(line);
    if (g) covergroups.push({ name: g[1], pct: +g[2] });
  }
  return { units, covergroups };
}

/** Sum metrics over the selected units. */
function sumMetrics(units, keys) {
  const out = {};
  for (const u of units) for (const k of keys) {
    const v = u.metrics[k];
    if (!v) continue;
    out[k] = out[k] || { bins: 0, hits: 0 };
    out[k].bins += v.bins; out[k].hits += v.hits;
  }
  return Object.entries(out).filter(([, v]) => v.bins > 0).map(([metric, v]) => ({ metric, bins: v.bins, hits: v.hits, pct: Math.round(v.hits * 10000 / v.bins) / 100 }));
}
const pctOf = ms => { const b = ms.reduce((s, x) => s + x.bins, 0); return b ? Math.round(ms.reduce((s, x) => s + x.hits, 0) * 10000 / b) / 100 : null; };

/** Is this design unit / file one of the DUT's? */
function isDut(unitName, dutModules, dutFiles) {
  const n = unitName.replace(/^work\./i, '').replace(/\(.*$/, '');
  const base = n.split(/[./\\]/).pop();
  if (dutModules.includes(n) || dutModules.includes(base)) return true;
  const low = unitName.replace(/\\/g, '/').toLowerCase();
  return dutFiles.some(f => low.endsWith(f.replace(/\\/g, '/').toLowerCase()) || low.endsWith('/' + path.basename(f).toLowerCase()));
}

function run(cmd, args, cwd, env, logFile) {
  const r = cp.spawnSync(cmd, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (logFile) fs.appendFileSync(logFile, sim.redact(`$ ${[cmd, ...args].join(' ')}\n${out}\n`, 'questa'));
  return { code: r.error ? -1 : r.status, out, error: r.error ? r.error.message : null };
}

/**
 * Merge + report.  o: { tools (detect().tools), ucdbs: [abs], outDir, env, dutModules: [], dutFiles: [], log }
 * returns { state: 'reported'|'license'|'error'|'none', code: {pct, metrics}, covergroups: {pct, metrics, groups}, files: {...}, message }
 */
function collect(o) {
  const log = o.log || (() => {});
  const ucdbs = (o.ucdbs || []).filter(f => fs.existsSync(f));
  if (!ucdbs.length) return { state: 'none', message: 'no UCDB was written (simulation did not finish)' };
  const vcover = o.tools.vcover;
  if (!vcover) return { state: 'error', message: 'vcover not found next to vsim' };
  fs.mkdirSync(o.outDir, { recursive: true });
  const logFile = path.join(o.outDir, 'vcover.log');
  const merged = path.join(o.outDir, 'merged.ucdb');
  let src = ucdbs[0];
  if (ucdbs.length > 1) {
    const m = run(vcover, ['merge', '-out', merged, ...ucdbs], o.outDir, o.env, logFile);
    const d = sim.diagnose(m.out);
    if (d && d.kind === 'license') return { state: 'license', message: d.lines[0] };
    if (m.code !== 0 || !fs.existsSync(merged)) return { state: 'error', message: 'vcover merge failed: ' + ((d && d.lines[0]) || m.error || 'exit ' + m.code) };
    src = merged;
  } else fs.copyFileSync(src, merged);
  const summaryFile = path.join(o.outDir, 'summary.txt');
  // -bydu keeps one section per design unit (needed to filter DUT vs testbench); fall back for older/newer syntaxes
  let s = run(vcover, ['report', '-summary', '-bydu', '-output', summaryFile, merged], o.outDir, o.env, logFile);
  if (s.code !== 0 || !fs.existsSync(summaryFile)) s = run(vcover, ['report', '-summary', '-output', summaryFile, merged], o.outDir, o.env, logFile);
  const d = sim.diagnose(s.out);
  if (d && d.kind === 'license') return { state: 'license', message: d.lines[0] };
  if (!fs.existsSync(summaryFile)) return { state: 'error', message: 'vcover report failed: ' + ((d && d.lines[0]) || s.error || 'exit ' + s.code) };
  run(vcover, ['report', '-details', '-output', path.join(o.outDir, 'details.txt'), merged], o.outDir, o.env, logFile);
  run(vcover, ['report', '-html', '-htmldir', path.join(o.outDir, 'html'), merged], o.outDir, o.env, logFile);
  const parsed = parseSummary(fs.readFileSync(summaryFile, 'utf8'));
  const dutUnits = parsed.units.filter(u => isDut(u.name, o.dutModules || [], o.dutFiles || []));
  const totals = parsed.units.filter(u => u.totals);
  const codeUnits = dutUnits.length ? dutUnits : totals;
  const code = sumMetrics(codeUnits, CODE);
  const cgm = sumMetrics(parsed.units.filter(u => !u.totals).length ? parsed.units.filter(u => !u.totals) : totals, ['Covergroups', 'Covergroup Bins']);
  const cgPct = parsed.covergroups.length ? Math.round(parsed.covergroups.reduce((a, g) => a + g.pct, 0) * 100 / parsed.covergroups.length) / 100 : (cgm.find(x => x.metric === 'Covergroups') || {}).pct ?? null;
  const html = path.join(o.outDir, 'html', 'index.html');
  const res = {
    state: 'reported',
    scope: dutUnits.length ? `DUT design units: ${[...new Set(dutUnits.map(u => u.name))].join(', ')}` : 'all design units (DUT sections not found in the report)',
    code: { pct: pctOf(code), metrics: code },
    covergroups: { pct: cgPct, metrics: cgm, groups: parsed.covergroups },
    files: { merged, summary: summaryFile, details: path.join(o.outDir, 'details.txt'), html: fs.existsSync(html) ? html : null, log: logFile },
    runs: ucdbs.length
  };
  log(`[coverage] merged ${ucdbs.length} UCDB(s) · code ${res.code.pct == null ? 'n/a' : res.code.pct + '%'} (${res.scope}) · covergroups ${res.covergroups.pct == null ? 'n/a' : res.covergroups.pct + '%'}`);
  code.forEach(x => log(`           ${x.metric.padEnd(16)} ${String(x.hits).padStart(6)}/${String(x.bins).padEnd(6)} ${x.pct}%`));
  return res;
}

module.exports = { collect, parseSummary, sumMetrics, isDut, CODE };
