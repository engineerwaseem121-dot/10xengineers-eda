'use strict';
/*
 * Coverage report parsers -> one unified model used by the dashboard.
 *
 * Supported inputs
 *   - Questa / ModelSim text reports  (vcover report -details [-cvg] [-codeAll] [-assert] [-directive])
 *   - LCOV .info                        (verilator_coverage --write-info, other tools)
 *   - Verilator coverage.dat            (raw verilator --coverage output)
 *   - 10xEngineers EDA JSON                    (same shape as the model below; for custom flows / other simulators)
 *
 * Model
 * {
 *   tool, source, generated,
 *   total: number|null,                                  // overall % if the report states one
 *   metrics: [{name, bins, hits, pct}],                  // design-wide code/functional summary
 *   instances: [{name, metrics:[...]}],                  // per-instance summary (code coverage)
 *   covergroups: [{name, kind:'type'|'instance', pct, goal, coverpoints:[
 *        {name, kind:'coverpoint'|'cross', pct, goal, bins:[{name, hits, atLeast, type:'bin'|'illegal'|'ignore'|'default'}]}]}],
 *   code: { [file]: { [line]: {hits, kind} } },          // per-line statement/branch hits
 *   assertions: [{name, file, line, failures, passes, status}],
 *   directives: [{name, file, line, count, status}]
 * }
 */

const fs = require('fs');
const path = require('path');

function emptyModel(tool, source) {
  return { tool, source, generated: new Date().toISOString(), total: null, metrics: [], instances: [], covergroups: [], code: {}, assertions: [], directives: [] };
}

const pctOf = (hits, bins) => (bins ? Math.round(hits * 10000 / bins) / 100 : 100);

/* ------------------------------------------------------------------ Questa text */
const METRIC_NAMES = [
  'Assertions', 'Branches', 'Conditions', 'Covergroups', 'Coverpoints/Crosses', 'Covergroup Bins', 'Directives',
  'Cover Directives', 'Expressions', 'FEC Conditions', 'FEC Expressions', 'FSM States', 'FSM Transitions', 'FSMs',
  'Statements', 'Toggles', 'Toggle Bins', 'UDP Conditions', 'UDP Expressions', 'Bins', 'Lines'
];
const metricRe = new RegExp('^\\s*(' + METRIC_NAMES.map(n => n.replace(/[/]/g, '\\/')).join('|') + ')\\s+(\\d+|na)\\s+(\\d+|na)\\s+(\\d+|na)\\s+([\\d.]+%|na)', 'i');

function parseQuesta(text, source) {
  const m = emptyModel('Questa', source);
  const lines = text.split(/\r?\n/);
  let inst = null, cg = null, cp = null, section = '', file = null, pendingName = null;
  const instMap = new Map();
  const getInst = name => { if (!instMap.has(name)) { const o = { name, metrics: [] }; instMap.set(name, o); m.instances.push(o); } return instMap.get(name); };
  const addMetric = (arr, name, bins, hits) => {
    const ex = arr.find(x => x.name === name);
    if (ex) { ex.bins += bins; ex.hits += hits; ex.pct = pctOf(ex.hits, ex.bins); }
    else arr.push({ name, bins, hits, pct: pctOf(hits, bins) });
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let r;

    if ((r = /^\s*=+\s*Instance:\s*(\S+)/i.exec(ln)) || (r = /^\s*Coverage Report.*?(?:for|by) (?:instance|design unit)\s+(\S+)/i.exec(ln))) {
      inst = r[1]; cg = null; cp = null; continue;
    }
    if ((r = /Total Coverage(?: By (?:Instance|Design Unit))?(?: \([^)]*\))?\s*:\s*([\d.]+)%/i.exec(ln))) { m.total = +r[1]; continue; }

    // section headers
    if (/^\s*Covergroup Coverage:/i.test(ln)) { section = 'cvg'; continue; }
    if (/^\s*(Statement|Branch|Condition|Expression|Toggle|FSM) Coverage(?: for| Details| ?:)/i.test(ln)) {
      section = /^\s*Statement/i.test(ln) ? 'stmt' : /^\s*Branch/i.test(ln) ? 'branch' : 'code';
      const fr = /File:?\s+(\S+)/.exec(ln); if (fr) file = fr[1];
      const ir = /instance\s+(\S+)/i.exec(ln); if (ir) inst = ir[1];
      continue;
    }
    if (/^\s*(Assertion Coverage|ASSERTION RESULTS)/i.test(ln)) { section = 'assert'; continue; }
    if (/^\s*(Directive Coverage|DIRECTIVE COVERAGE|Cover Directives)/i.test(ln)) { section = 'directive'; continue; }

    // summary metric tables (anywhere)
    if ((r = metricRe.exec(ln))) {
      const name = r[1];
      const bins = r[2] === 'na' ? 0 : +r[2];
      let hits = r[3] === 'na' ? null : +r[3];
      const pctTxt = r[5];
      if (hits === null) hits = pctTxt === 'na' ? 0 : Math.round(parseFloat(pctTxt) * bins / 100);
      if (/^(Covergroups|Coverpoints\/Crosses|Covergroup Bins)$/i.test(name) && r[2] !== 'na' && r[3] === 'na') continue;
      if (inst) addMetric(getInst(inst).metrics, name, bins, hits);
      else addMetric(m.metrics, name, bins, hits);
      continue;
    }

    // functional coverage detail
    if ((r = /^\s*TYPE\s+(\S+)\s+([\d.]+)%\s+(\d+)?/.exec(ln))) {
      cg = { name: r[1], kind: 'type', pct: +r[2], goal: r[3] ? +r[3] : 100, coverpoints: [] };
      m.covergroups.push(cg); cp = null; section = 'cvg'; continue;
    }
    if ((r = /^\s*(?:Covergroup instance|INSTANCE)\s+(\S+)\s+([\d.]+)%\s+(\d+)?/i.exec(ln))) {
      cg = { name: r[1], kind: 'instance', pct: +r[2], goal: r[3] ? +r[3] : 100, coverpoints: [] };
      m.covergroups.push(cg); cp = null; section = 'cvg'; continue;
    }
    if (cg && (r = /^\s*(Coverpoint|Cross)\s+(.+?)\s+([\d.]+)%\s+(\d+)?/i.exec(ln))) {
      cp = { name: r[2].trim(), kind: r[1].toLowerCase() === 'cross' ? 'cross' : 'coverpoint', pct: +r[3], goal: r[4] ? +r[4] : 100, bins: [] };
      cg.coverpoints.push(cp); continue;
    }
    if (cp && (r = /^\s*(illegal_bin|ignore_bin|default bin|default|bin)\s+(.+?)\s{2,}(\d+)\s+(\d+|-)(?:\s+-)?(?:\s+(\w+))?/i.exec(ln))) {
      const t = r[1].toLowerCase();
      cp.bins.push({
        name: r[2].trim(), hits: +r[3], atLeast: r[4] === '-' ? 1 : +r[4],
        type: t.startsWith('illegal') ? 'illegal' : t.startsWith('ignore') ? 'ignore' : t.startsWith('default') ? 'default' : 'bin',
        status: r[5] || ''
      });
      continue;
    }

    // code coverage line detail
    if ((r = /^\s*File:?\s+(\S+\.(?:s?vh?|svh|vhdl?|vl|svi))\s*$/i.exec(ln))) { file = r[1]; continue; }
    if ((section === 'stmt' || section === 'branch') && file && (r = /^\s*(\d+)\s+(\d+)\s+(\*\*\*0\*\*\*|\d+)(?:\s|$)/.exec(ln))) {
      const line = +r[1], hits = r[3].startsWith('*') ? 0 : +r[3];
      const f = (m.code[file] = m.code[file] || {});
      const ex = f[line];
      if (!ex) f[line] = { hits, kind: section };
      else ex.hits = Math.min(ex.hits, hits) === 0 ? 0 : Math.max(ex.hits, hits);
      continue;
    }

    // assertions:  /tb/dut/a_x   ../rtl/x.sv(23)   0   12      (name may be on its own line)
    if (section === 'assert') {
      if ((r = /^\s*(\/\S+)\s*$/.exec(ln))) { pendingName = r[1]; continue; }
      const single = /^\s*(\/\S+)\s+(\S+?)\((\d+)\)\s+(\d+)\s+(\d+)/.exec(ln);
      const cont = !single && pendingName ? /^\s+(\S+?)\((\d+)\)\s+(\d+)\s+(\d+)/.exec(ln) : null;
      if (single || cont) {
        const [name, file, line, f, p] = single ? single.slice(1) : [pendingName, ...cont.slice(1)];
        pendingName = null;
        const failures = +f, passes = +p;
        m.assertions.push({ name, file, line: +line, failures, passes, status: failures ? 'failed' : passes ? 'passed' : 'not-exercised' });
        continue;
      }
    }
    // directives:  /tb/c_x   <design unit> <unit type>  SVA  ../rtl/x.sv(10)  5  Covered
    if ((section === 'directive' || section === 'assert') && (r = /^\s*(\/\S+)\s+.*?\b(?:SVA|PSL)\s+(\S+?)\((\d+)\)\s+(\d+)\s*(\w+)?/.exec(ln))) {
      const count = +r[4];
      m.directives.push({ name: r[1], file: r[2], line: +r[3], count, status: count ? 'covered' : 'uncovered' });
      continue;
    }
  }
  finalize(m);
  return m;
}

/* ------------------------------------------------------------------ LCOV */
function parseLcov(text, source) {
  const m = emptyModel('LCOV', source);
  let file = null;
  let lf = 0, lh = 0, bf = 0, bh = 0, fnf = 0, fnh = 0;
  for (const ln of text.split(/\r?\n/)) {
    let r;
    if ((r = /^SF:(.*)$/.exec(ln))) { file = r[1].trim(); m.code[file] = m.code[file] || {}; }
    else if (file && (r = /^DA:(\d+),(\d+)/.exec(ln))) {
      const line = +r[1], hits = +r[2];
      const f = m.code[file];
      f[line] = { hits: f[line] ? Math.max(f[line].hits, hits) : hits, kind: 'stmt' };
    } else if (file && (r = /^BRDA:(\d+),[^,]*,[^,]*,(\d+|-)/.exec(ln))) {
      const line = +r[1], hits = r[2] === '-' ? 0 : +r[2];
      bf++; if (hits) bh++;
      const f = m.code[file];
      if (!f[line]) f[line] = { hits, kind: 'branch' };
      else if (hits === 0) f[line].partial = true;
    } else if ((r = /^LF:(\d+)/.exec(ln))) lf += +r[1];
    else if ((r = /^LH:(\d+)/.exec(ln))) lh += +r[1];
    else if ((r = /^FNF:(\d+)/.exec(ln))) fnf += +r[1];
    else if ((r = /^FNH:(\d+)/.exec(ln))) fnh += +r[1];
    else if (/^end_of_record/.test(ln)) file = null;
  }
  if (!lf) { for (const f of Object.values(m.code)) for (const l of Object.values(f)) { lf++; if (l.hits) lh++; } }
  m.metrics.push({ name: 'Lines', bins: lf, hits: lh, pct: pctOf(lh, lf) });
  if (bf) m.metrics.push({ name: 'Branches', bins: bf, hits: bh, pct: pctOf(bh, bf) });
  if (fnf) m.metrics.push({ name: 'Functions', bins: fnf, hits: fnh, pct: pctOf(fnh, fnf) });
  finalize(m);
  return m;
}

/* ------------------------------------------------------------------ Verilator coverage.dat */
function parseVerilatorDat(text, source) {
  const m = emptyModel('Verilator', source);
  const agg = {};
  const user = new Map();
  const re = /^C '([^']*)'\s+(\d+)/gm;
  let r;
  while ((r = re.exec(text))) {
    const kv = {};
    r[1].split('\x01').forEach(p => { const k = p.indexOf('\x02'); if (k > 0) kv[p.slice(0, k)] = p.slice(k + 1); });
    const hits = +r[2];
    const page = kv.page || '';
    const kind = /^v_toggle/.test(page) ? 'Toggles' : /^v_branch/.test(page) ? 'Branches' : /^v_line/.test(page) ? 'Lines' : /^v_expr/.test(page) ? 'Expressions' : 'User';
    const a = (agg[kind] = agg[kind] || { bins: 0, hits: 0 });
    a.bins++; if (hits) a.hits++;
    if ((kind === 'Lines' || kind === 'Branches') && kv.f && kv.l) {
      const f = (m.code[kv.f] = m.code[kv.f] || {});
      const line = +kv.l;
      if (!f[line]) f[line] = { hits, kind: kind === 'Lines' ? 'stmt' : 'branch' };
      else f[line].hits = hits === 0 ? 0 : Math.max(f[line].hits, hits);
    }
    if (kind === 'User') {
      const grp = (kv.h || 'TOP') + (kv.page ? ' (' + kv.page.replace(/^v_user\/?/, '') + ')' : '');
      if (!user.has(grp)) user.set(grp, []);
      user.get(grp).push({ name: (kv.o || 'cover') + (kv.l ? ' @' + path.basename(kv.f || '') + ':' + kv.l : ''), hits, atLeast: 1, type: 'bin' });
    }
  }
  for (const [k, a] of Object.entries(agg)) m.metrics.push({ name: k === 'User' ? 'User Cover Points' : k, bins: a.bins, hits: a.hits, pct: pctOf(a.hits, a.bins) });
  if (user.size) {
    const cg = { name: 'Verilator user coverage', kind: 'type', pct: 0, goal: 100, coverpoints: [] };
    user.forEach((bins, name) => cg.coverpoints.push({ name, kind: 'coverpoint', pct: 0, goal: 100, bins }));
    m.covergroups.push(cg);
  }
  finalize(m, true);
  return m;
}

/* ------------------------------------------------------------------ common */
function finalize(m, recomputePct) {
  for (const cg of m.covergroups) {
    for (const cp of cg.coverpoints) {
      const real = cp.bins.filter(b => b.type === 'bin');
      if (real.length && (recomputePct || cp.pct == null || isNaN(cp.pct))) cp.pct = pctOf(real.filter(b => b.hits >= b.atLeast).length, real.length);
    }
    if (cg.coverpoints.length && (recomputePct || cg.pct == null || isNaN(cg.pct))) cg.pct = Math.round(cg.coverpoints.reduce((s, c) => s + c.pct, 0) / cg.coverpoints.length * 100) / 100;
  }
  // derive functional metrics if the report had no summary table
  const types = m.covergroups.filter(c => c.kind === 'type');
  const cgs = types.length ? types : m.covergroups;
  if (cgs.length && !m.metrics.some(x => /^Covergroup Bins$/i.test(x.name))) {
    let bins = 0, hits = 0;
    cgs.forEach(cg => cg.coverpoints.forEach(cp => cp.bins.forEach(b => { if (b.type === 'bin') { bins++; if (b.hits >= b.atLeast) hits++; } })));
    if (bins) m.metrics.push({ name: 'Covergroup Bins', bins, hits, pct: pctOf(hits, bins) });
  }
  if (m.assertions.length && !m.metrics.some(x => x.name === 'Assertions')) {
    const ok = m.assertions.filter(a => a.status === 'passed').length;
    m.metrics.push({ name: 'Assertions', bins: m.assertions.length, hits: ok, pct: pctOf(ok, m.assertions.length) });
  }
  if (m.directives.length && !m.metrics.some(x => /Directives/.test(x.name))) {
    const ok = m.directives.filter(a => a.count > 0).length;
    m.metrics.push({ name: 'Cover Directives', bins: m.directives.length, hits: ok, pct: pctOf(ok, m.directives.length) });
  }
  // design-wide metrics from instances when no global table was present
  if (!m.metrics.some(x => /Statements|Branches|Toggles|Lines/.test(x.name)) && m.instances.length) {
    const sum = {};
    m.instances.forEach(i => i.metrics.forEach(x => { const s = (sum[x.name] = sum[x.name] || { bins: 0, hits: 0 }); s.bins += x.bins; s.hits += x.hits; }));
    Object.entries(sum).forEach(([name, s]) => { if (!m.metrics.some(x => x.name === name)) m.metrics.push({ name, bins: s.bins, hits: s.hits, pct: pctOf(s.hits, s.bins) }); });
  }
  if (m.total == null) {
    const ms = m.metrics.filter(x => x.bins > 0 && !/^(Covergroups|Coverpoints\/Crosses)$/i.test(x.name));
    if (ms.length) m.total = Math.round(ms.reduce((s, x) => s + x.pct, 0) / ms.length * 100) / 100;
  }
  return m;
}

function detect(text, file) {
  const ext = path.extname(file || '').toLowerCase();
  if (ext === '.json' || /^\s*\{/.test(text)) {
    const j = JSON.parse(text);
    const m = Object.assign(emptyModel(j.tool || 'JSON', file), j);
    return finalize(m);
  }
  if (/^(TN|SF):/m.test(text) && /^end_of_record/m.test(text)) return parseLcov(text, file);
  if (/^C '\x01/m.test(text) || (ext === '.dat' && /^C '/m.test(text))) return parseVerilatorDat(text, file);
  return parseQuesta(text, file);
}

function parseFile(file) {
  return detect(fs.readFileSync(file, 'utf8'), file);
}

/* ------------------------------------------------------------------ Excel (.xlsx) workbooks */
function binRows(m) {
  const rows = [];
  const types = m.covergroups.filter(c => c.kind === 'type');
  (types.length ? types : m.covergroups).forEach(cg => cg.coverpoints.forEach(cp => cp.bins.forEach(b => {
    const st = b.type === 'illegal' ? (b.hits > 0 ? 'ILLEGAL HIT' : 'illegal') : b.type !== 'bin' ? b.type : b.hits >= b.atLeast ? 'HIT' : b.hits > 0 ? 'PARTIAL' : 'HOLE';
    rows.push({ cg: cg.name.split('/').pop(), cgPath: cg.name, cp: cp.name, kind: cp.kind, bin: b.name, type: b.type, hits: b.hits, atLeast: b.atLeast, cpPct: cp.pct, st });
  })));
  return rows;
}

function summarySheet(m, opts) {
  const rows = [['TOTAL', '', '', '', m.total == null ? '' : m.total, m.total == null ? '' : m.total >= opts.goal ? 'MET' : 'NOT MET']];
  m.metrics.forEach(x => rows.push([x.name, x.bins, x.hits, x.bins - x.hits, x.pct, x.pct >= opts.goal ? 'MET' : x.pct >= opts.goal * 0.75 ? 'CLOSE' : 'LOW']));
  return {
    name: 'Summary', title: 'Coverage summary', subtitle: `${m.source || ''} · ${m.tool} · goal ${opts.goal}% · exported ${new Date().toLocaleString()}`,
    columns: [{ header: 'Metric', width: 26 }, { header: 'Bins', type: 'num' }, { header: 'Hits', type: 'num' }, { header: 'Misses', type: 'num' }, { header: 'Coverage %', type: 'pct' }, { header: 'Status' }],
    rows, statusCol: 5
  };
}

const binCols = [{ header: 'Covergroup' }, { header: 'Coverpoint / Cross' }, { header: 'Kind' }, { header: 'Bin' }, { header: 'Hits', type: 'num' }, { header: 'At least', type: 'num' }, { header: 'Coverpoint %', type: 'pct' }, { header: 'Status' }];
const binRow = b => [b.cg, b.cp, b.kind, b.bin, b.hits, b.atLeast, b.cpPct, b.st];

function planSheet(planEval, opts) {
  return {
    name: 'Verification Plan', title: 'Verification plan status', subtitle: `${planEval.filter(f => f.status === 'COVERED').length}/${planEval.length} features covered`,
    columns: [{ header: 'ID', width: 10 }, { header: 'Feature', width: 28 }, { header: 'Description', width: 50 }, { header: 'Priority' }, { header: 'Owner' }, { header: 'Goal %', type: 'num' }, { header: 'Coverage %', type: 'pct' }, { header: 'Status' }, { header: 'Hit items', width: 50 }, { header: 'Unhit items (remaining)', width: 50 }, { header: 'Unmatched patterns', width: 30 }],
    rows: planEval.map(f => [f.id, f.feature, f.description, f.priority, f.owner, f.goal, f.pct == null ? '' : f.pct, f.status,
      f.hit.map(h => h.label).join('\n'), f.unhit.map(h => h.label + (h.detail ? ` (${h.detail})` : '')).join('\n'), f.missingPatterns.join('\n')]),
    statusCol: 7
  };
}

function planItemSheet(planEval, which) {
  const rows = [];
  planEval.forEach(f => (which === 'hit' ? f.hit : f.unhit).forEach(h => rows.push([f.id, f.feature, h.label, h.kind, h.hits == null ? '' : h.hits, h.pct, which === 'hit' ? 'HIT' : (h.pct > 0 ? 'PARTIAL' : 'HOLE')])));
  return {
    name: which === 'hit' ? 'Plan - Hit items' : 'Plan - Remaining items',
    columns: [{ header: 'ID' }, { header: 'Feature' }, { header: 'Coverage item' }, { header: 'Kind' }, { header: 'Hits', type: 'num' }, { header: 'Coverage %', type: 'pct' }, { header: 'Status' }],
    rows, statusCol: 6
  };
}

function regressionSheet(reg) {
  return {
    name: 'Regression', title: `Regression: ${reg.name || ''}`, subtitle: `${reg.runs.filter(r => r.status === 'PASS').length}/${reg.runs.length} runs passed · ${reg.started || ''}`,
    columns: [{ header: 'Job' }, { header: 'Test' }, { header: 'Seed' }, { header: 'Status' }, { header: 'UVM errors', type: 'num' }, { header: 'UVM fatals', type: 'num' }, { header: 'UVM warnings', type: 'num' }, { header: 'Time (s)', type: 'num' }, { header: 'Run directory', width: 60 }],
    rows: reg.runs.map(r => [r.job, r.test, String(r.seed), r.status, r.errors, r.fatals, r.warnings, r.time, r.dir]), statusCol: 3
  };
}

/** kind: 'full' | 'hits' | 'holes' */
function workbookSheets(m, kind, opts) {
  opts = Object.assign({ goal: 90 }, opts);
  const bins = binRows(m);
  const sheets = [summarySheet(m, opts)];
  const plan = opts.planEval;
  if (kind === 'full' || kind === 'hits') {
    sheets.push({ name: 'Hit bins', title: 'Hit bins', subtitle: `${bins.filter(b => b.st === 'HIT').length} bins hit`, columns: binCols, rows: bins.filter(b => b.st === 'HIT').map(binRow), statusCol: 7 });
    if (plan) sheets.push(planItemSheet(plan, 'hit'));
  }
  if (kind === 'full' || kind === 'holes') {
    const holes = bins.filter(b => b.st === 'HOLE' || b.st === 'PARTIAL' || b.st === 'ILLEGAL HIT');
    sheets.push({ name: 'Unhit bins (holes)', title: 'Coverage holes', subtitle: `${holes.length} bins not yet hit`, columns: binCols, rows: holes.map(binRow), statusCol: 7 });
    if (plan) sheets.push(planItemSheet(plan, 'unhit'));
    const unc = [];
    Object.entries(m.code).forEach(([f, ls]) => Object.entries(ls).forEach(([l, v]) => { if (!v.hits) unc.push([f, +l, v.kind, 0, 'UNCOVERED']); }));
    sheets.push({ name: 'Uncovered code', columns: [{ header: 'File', width: 50 }, { header: 'Line', type: 'num' }, { header: 'Kind' }, { header: 'Hits', type: 'num' }, { header: 'Status' }], rows: unc, statusCol: 4 });
  }
  if (kind === 'full') {
    if (plan) sheets.splice(1, 0, planSheet(plan, opts));
    if (opts.regression && opts.regression.runs) sheets.splice(plan ? 2 : 1, 0, regressionSheet(opts.regression));
    sheets.push({
      name: 'Coverpoints', columns: [{ header: 'Covergroup' }, { header: 'Coverpoint / Cross' }, { header: 'Kind' }, { header: 'Coverage %', type: 'pct' }, { header: 'Goal', type: 'num' }, { header: 'Bins', type: 'num' }, { header: 'Hit', type: 'num' }, { header: 'Holes', type: 'num' }, { header: 'Status' }],
      rows: [].concat(...(m.covergroups.filter(c => c.kind === 'type').length ? m.covergroups.filter(c => c.kind === 'type') : m.covergroups).map(cg => cg.coverpoints.map(cp => {
        const real = cp.bins.filter(b => b.type === 'bin'); const hit = real.filter(b => b.hits >= b.atLeast).length;
        return [cg.name.split('/').pop(), cp.name, cp.kind, cp.pct, cp.goal, real.length, hit, real.length - hit, cp.pct >= (cp.goal || 100) ? 'COVERED' : cp.pct > 0 ? 'PARTIAL' : 'HOLE'];
      }))), statusCol: 8
    });
    sheets.push({ name: 'All bins', columns: binCols, rows: bins.map(binRow), statusCol: 7 });
    sheets.push({ name: 'Instances', columns: [{ header: 'Instance', width: 40 }, { header: 'Metric' }, { header: 'Bins', type: 'num' }, { header: 'Hits', type: 'num' }, { header: 'Coverage %', type: 'pct' }], rows: [].concat(...m.instances.map(i => i.metrics.map(x => [i.name, x.name, x.bins, x.hits, x.pct]))) });
    sheets.push({ name: 'Assertions', columns: [{ header: 'Name', width: 50 }, { header: 'File' }, { header: 'Line', type: 'num' }, { header: 'Failures', type: 'num' }, { header: 'Passes', type: 'num' }, { header: 'Status' }], rows: m.assertions.map(a => [a.name, a.file, a.line, a.failures, a.passes, a.status === 'passed' ? 'PASS' : a.status === 'failed' ? 'FAIL' : 'NOT EXERCISED']), statusCol: 5 });
    sheets.push({ name: 'Cover directives', columns: [{ header: 'Name', width: 50 }, { header: 'File' }, { header: 'Line', type: 'num' }, { header: 'Count', type: 'num' }, { header: 'Status' }], rows: m.directives.map(d => [d.name, d.file, d.line, d.count, d.count ? 'COVERED' : 'UNCOVERED']), statusCol: 4 });
  }
  return sheets;
}

function toXlsx(m, kind, opts) {
  return require('./xlsx').build(workbookSheets(m, kind, opts), { goal: (opts && opts.goal) || 90, title: 'Coverage ' + kind });
}

module.exports = { parseFile, detect, parseQuesta, parseLcov, parseVerilatorDat, toXlsx, workbookSheets };
