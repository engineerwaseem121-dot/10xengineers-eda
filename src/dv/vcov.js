'use strict';
/*
 * Verilator code coverage: merge each run's coverage.dat, report line / branch / toggle coverage of the DUT files,
 * list the uncovered DUT lines, and write LCOV (merged.info) for the editor's coverage highlighting.
 * coverage.dat records:  C '<\x01key\x02value ...>' <count>   (f = file, l = line, page = v_line/v_branch/v_toggle/...)
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const TYPES = [['v_line', 'Lines'], ['v_branch', 'Branches'], ['v_expr', 'Expressions'], ['v_toggle', 'Toggles'], ['v_user', 'User cover points']];

function runTool(cmd, args, cwd, container) {
  let c = cmd, a = args, w = cwd;
  if (String(cmd).startsWith('ctr:') || container) {
    const x = require('./container').wrap({ cmd, args, cwd, container: true });
    c = x.cmd; a = x.args; w = x.cwd;
  }
  const r = cp.spawnSync(c, a, { cwd: w, encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.error ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''), error: r.error ? r.error.message : null };
}

/** parse a coverage.dat into points [{file, line, page, comment, hier, count}] */
function parseDat(text) {
  const pts = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^C '(.*)' (\d+)\s*$/.exec(line);
    if (!m) continue;
    const kv = {};
    for (const part of m[1].split('\x01')) { const i = part.indexOf('\x02'); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
    pts.push({ file: kv.f || '', line: +(kv.l || 0), page: (kv.page || '').split('/')[0], comment: kv.o || '', hier: kv.h || '', count: +m[2] });
  }
  return pts;
}

const isDutFile = (f, dutFiles) => { const b = path.basename(String(f).replace(/\\/g, '/')).toLowerCase(); return dutFiles.some(d => path.basename(String(d).replace(/\\/g, '/')).toLowerCase() === b); };

/**
 * o: { tool: path or 'ctr:verilator_coverage', container, dats: [abs], outDir, dutFiles: [paths], root, log }
 * returns the same shape as qcov.collect: { state, code: {pct, metrics}, covergroups, uncovered, files, runs, scope }
 */
function collect(o) {
  const log = o.log || (() => {});
  const dats = (o.dats || []).filter(f => fs.existsSync(f));
  if (!dats.length) return { state: 'none', message: 'no coverage.dat was written (the runs did not finish, or the build had no --coverage)' };
  if (!o.tool) return { state: 'error', message: 'verilator_coverage not found next to verilator' };
  fs.mkdirSync(o.outDir, { recursive: true });
  const merged = path.join(o.outDir, 'merged.dat'), info = path.join(o.outDir, 'merged.info');
  const m = runTool(o.tool, ['--write', merged, '--write-info', info, ...dats], o.outDir, o.container);
  fs.writeFileSync(path.join(o.outDir, 'verilator_coverage.log'), m.out || m.error || '');
  if (m.code !== 0 || !fs.existsSync(merged)) return { state: 'error', message: 'verilator_coverage failed: ' + ((m.out || m.error || '').split('\n').find(Boolean) || 'exit ' + m.code) };
  const annotate = path.join(o.outDir, 'annotated');
  runTool(o.tool, ['--annotate', annotate, '--annotate-min', '1', merged], o.outDir, o.container);
  const pts = parseDat(fs.readFileSync(merged, 'utf8')).filter(p => isDutFile(p.file, o.dutFiles || []));
  if (!pts.length) return { state: 'error', message: 'the merged coverage has no points in the DUT files' };
  const metrics = TYPES.map(([page, label]) => {
    const ps = pts.filter(p => p.page === page);
    const hits = ps.filter(p => p.count > 0).length;
    return { metric: label, bins: ps.length, hits, pct: ps.length ? Math.round(hits * 10000 / ps.length) / 100 : null };
  }).filter(x => x.bins);
  const bins = metrics.reduce((s, x) => s + x.bins, 0), hits = metrics.reduce((s, x) => s + x.hits, 0);
  // uncovered DUT lines (one entry per file:line, listing what was missed there)
  const miss = new Map();
  for (const p of pts.filter(q => q.count === 0)) {
    const k = path.basename(p.file) + ':' + p.line;
    const e = miss.get(k) || { file: path.basename(p.file), line: p.line, what: [] };
    const label = (TYPES.find(t => t[0] === p.page) || [0, p.page])[1].replace(/s$/, '').toLowerCase();
    const w = label + (p.comment && p.page !== 'v_line' ? ' ' + p.comment : '');
    if (!e.what.includes(w) && e.what.length < 4) e.what.push(w);
    miss.set(k, e);
  }
  const uncovered = [...miss.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).slice(0, 60);
  // the DUT file path relative to the project, so the dashboard can link straight to the line
  const rels = (o.dutFiles || []).map(f => String(f).replace(/\\/g, '/'));
  uncovered.forEach(u => { u.src = rels.find(r => path.basename(r).toLowerCase() === u.file.toLowerCase()) || u.file; });
  const summary = [`Verilator code coverage — DUT files: ${[...new Set(pts.map(p => path.basename(p.file)))].join(', ')}`, `merged ${dats.length} run(s)`, '']
    .concat(metrics.map(x => `${x.metric.padEnd(18)} ${String(x.hits).padStart(6)} / ${String(x.bins).padEnd(6)} ${x.pct}%`))
    .concat(['', `Total              ${hits} / ${bins}  ${Math.round(hits * 10000 / bins) / 100}%`, '', 'Uncovered DUT lines:'])
    .concat(uncovered.map(u => `  ${u.file}:${u.line}  ${u.what.join('; ')}`));
  fs.writeFileSync(path.join(o.outDir, 'summary.txt'), summary.join('\n') + '\n');
  const res = {
    state: 'reported', scope: 'DUT files: ' + [...new Set(pts.map(p => path.basename(p.file)))].join(', '),
    code: { pct: Math.round(hits * 10000 / bins) / 100, metrics }, covergroups: { pct: null, metrics: [], groups: [] }, uncovered,
    files: { summary: path.join(o.outDir, 'summary.txt'), details: fs.existsSync(annotate) ? annotate : null, lcov: fs.existsSync(info) ? info : null, merged, html: null },
    runs: dats.length
  };
  log(`[coverage] Verilator: merged ${dats.length} run(s) · code ${res.code.pct}% (${res.scope}) · ${uncovered.length} uncovered DUT line(s)`);
  metrics.forEach(x => log(`           ${x.metric.padEnd(18)} ${String(x.hits).padStart(5)}/${String(x.bins).padEnd(5)} ${x.pct}%`));
  return res;
}

module.exports = { collect, parseDat };
