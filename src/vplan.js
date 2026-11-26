'use strict';
/*
 * Verification plan (vPlan) support.
 *
 * CSV columns (header names are matched case-insensitively; extra columns are kept):
 *   ID, Feature, Description, Priority, Owner, Coverage Items, Goal
 *
 * "Coverage Items" is a ';'-separated list of patterns ('*' wildcard, case-insensitive):
 *   alu8_cg                      covergroup (by name or full path)
 *   alu8_cg::cp_op               coverpoint / cross
 *   alu8_cg::cp_op::add          single bin
 *   assert:a_no_overflow         SVA assertion must pass (non-vacuously)
 *   cover:c_full                 cover directive must be hit
 *   test:alu8_closure_test       regression test must pass
 *   code:Statements              code-coverage metric (design-wide)
 */

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

function parsePlan(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return [];
  const hdr = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => hdr.findIndex(h => names.some(n => h === n || h.replace(/[\s_]/g, '') === n.replace(/[\s_]/g, '')));
  const ci = {
    id: col('id', 'req', 'requirement'), feature: col('feature', 'name', 'title'), desc: col('description', 'desc'),
    prio: col('priority', 'prio'), owner: col('owner'), items: col('coverage items', 'coverage', 'items', 'cover items'),
    goal: col('goal', 'target')
  };
  return rows.slice(1).filter(r => r.some(x => x.trim())).map((r, k) => ({
    id: ci.id >= 0 ? r[ci.id].trim() : 'F' + (k + 1),
    feature: ci.feature >= 0 ? (r[ci.feature] || '').trim() : '',
    description: ci.desc >= 0 ? (r[ci.desc] || '').trim() : '',
    priority: ci.prio >= 0 ? (r[ci.prio] || '').trim() : '',
    owner: ci.owner >= 0 ? (r[ci.owner] || '').trim() : '',
    items: ci.items >= 0 ? (r[ci.items] || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean) : [],
    goal: ci.goal >= 0 && parseFloat(r[ci.goal]) ? parseFloat(r[ci.goal]) : 100
  }));
}

const short = p => String(p).split('/').pop();

function indexItems(model, regression) {
  const items = [];
  const groups = model.covergroups.filter(c => c.kind === 'type').length ? model.covergroups.filter(c => c.kind === 'type') : model.covergroups;
  for (const cg of groups) {
    const cgs = short(cg.name);
    items.push({ level: 1, keys: [cg.name, cgs], label: cgs, pct: cg.pct, kind: 'covergroup' });
    for (const cp of cg.coverpoints) {
      items.push({ level: 2, keys: [cg.name + '::' + cp.name, cgs + '::' + cp.name], label: cgs + '::' + cp.name, pct: cp.pct, kind: cp.kind });
      for (const b of cp.bins) {
        if (b.type !== 'bin') continue;
        items.push({ level: 3, keys: [cg.name + '::' + cp.name + '::' + b.name, cgs + '::' + cp.name + '::' + b.name], label: cgs + '::' + cp.name + '::' + b.name, pct: b.hits >= b.atLeast ? 100 : 0, kind: 'bin', hits: b.hits });
      }
    }
  }
  for (const a of model.assertions) items.push({ level: 'assert', keys: [a.name, short(a.name)], label: 'assert:' + short(a.name), pct: a.status === 'passed' ? 100 : 0, kind: 'assertion', detail: a.status });
  for (const d of model.directives) items.push({ level: 'cover', keys: [d.name, short(d.name)], label: 'cover:' + short(d.name), pct: d.count > 0 ? 100 : 0, kind: 'directive', hits: d.count });
  for (const m of model.metrics) items.push({ level: 'code', keys: [m.name], label: 'code:' + m.name, pct: m.pct, kind: 'metric' });
  if (regression && regression.runs) {
    const byTest = new Map();
    regression.runs.forEach(r => { const t = byTest.get(r.test) || { pass: 0, total: 0 }; t.total++; if (r.status === 'PASS') t.pass++; byTest.set(r.test, t); });
    byTest.forEach((t, name) => items.push({ level: 'test', keys: [name], label: 'test:' + name, pct: t.total ? (t.pass === t.total ? 100 : 0) : 0, kind: 'test', detail: `${t.pass}/${t.total} runs passed` }));
  }
  return items;
}

function globRe(p) {
  return new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

function evaluate(plan, model, regression) {
  const items = indexItems(model, regression);
  return plan.map(f => {
    const matched = [];
    const missingPatterns = [];
    for (const pat of f.items) {
      let level, p = pat;
      const m = /^(assert|cover|test|code):(.*)$/i.exec(pat);
      if (m) { level = m[1].toLowerCase(); p = m[2].trim(); }
      else level = (p.match(/::/g) || []).length + 1;
      const re = globRe(p);
      const hits = items.filter(it => it.level === level && it.keys.some(k => re.test(k)));
      if (!hits.length) missingPatterns.push(pat);
      hits.forEach(h => { if (!matched.includes(h)) matched.push(h); });
    }
    const pct = matched.length ? Math.round(matched.reduce((s, it) => s + (it.pct || 0), 0) / matched.length * 100) / 100 : null;
    let status;
    if (!f.items.length || !matched.length) status = 'UNMAPPED';
    else if (pct >= f.goal && !missingPatterns.length) status = 'COVERED';
    else if (pct > 0) status = 'PARTIAL';
    else status = 'NOT COVERED';
    return {
      ...f, pct, status, missingPatterns,
      hit: matched.filter(it => it.pct >= 100 || (it.kind !== 'bin' && it.kind !== 'test' && it.kind !== 'assertion' && it.kind !== 'directive' && it.pct >= f.goal)).map(it => ({ label: it.label, pct: it.pct, kind: it.kind, detail: it.detail, hits: it.hits })),
      unhit: matched.filter(it => !(it.pct >= 100 || (it.kind !== 'bin' && it.kind !== 'test' && it.kind !== 'assertion' && it.kind !== 'directive' && it.pct >= f.goal))).map(it => ({ label: it.label, pct: it.pct, kind: it.kind, detail: it.detail, hits: it.hits }))
    };
  });
}

/* ------------------------------------------------------------------ minimal YAML (block style subset) */
function yamlScalar(s) {
  s = s.trim();
  if (!s.length) return null;
  if (/^".*"$/.test(s)) return JSON.parse(s.replace(/\\'/g, "'"));
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map(x => yamlScalar(x)).filter(x => x !== null);
  if (/^(true|yes)$/i.test(s)) return true;
  if (/^(false|no)$/i.test(s)) return false;
  if (/^(null|~)$/i.test(s)) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseYaml(text) {
  const lines = text.replace(/\t/g, '  ').split(/\r?\n/).map(l => {
    let out = '', q = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '#' && (i === 0 || /\s/.test(l[i - 1]))) break;
      out += c;
    }
    return out.replace(/\s+$/, '');
  });
  let i = 0;
  const ind = l => l.length - l.trimStart().length;
  const skip = () => { while (i < lines.length && !lines[i].trim()) i++; };

  function block(level) {
    skip();
    if (i >= lines.length) return null;
    const first = lines[i];
    if (ind(first) < level) return null;
    const base = ind(first);
    if (first.trim().startsWith('- ') || first.trim() === '-') {
      const arr = [];
      while (i < lines.length) {
        skip();
        if (i >= lines.length) break;
        const l = lines[i];
        if (ind(l) !== base || !(l.trim().startsWith('- ') || l.trim() === '-')) break;
        const rest = l.trim().slice(1).trimStart();
        if (!rest) { i++; arr.push(block(base + 1)); continue; }
        if (/^[^"'\[][^:]*:(\s|$)/.test(rest)) {
          // inline mapping start: rewrite this line as a mapping line at deeper indent
          lines[i] = ' '.repeat(base + 2) + rest;
          arr.push(block(base + 2));
        } else { i++; arr.push(yamlScalar(rest)); }
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (ind(l) !== base) { if (ind(l) < base) break; i++; continue; }
      const m = /^([^:]+?):(?:\s+(.*))?$/.exec(l.trim());
      if (!m) { i++; continue; }
      const key = m[1].trim().replace(/^["']|["']$/g, '');
      const val = m[2] == null ? '' : m[2];
      i++;
      if (val === '|' || val === '>' || val === '|-' || val === '>-') {
        const parts = [];
        while (i < lines.length && (!lines[i].trim() || ind(lines[i]) > base)) { parts.push(lines[i].trim()); i++; }
        obj[key] = parts.join(val.startsWith('|') ? '\n' : ' ').trim();
      } else if (val.trim() === '') obj[key] = block(base + 1);
      else obj[key] = yamlScalar(val);
    }
    return obj;
  }
  return block(0) || {};
}

/**
 * .testplan (YAML):
 *   name: alu8
 *   goal: 100
 *   features:            (alias: testpoints / goals)
 *     - id: ALU-ADD
 *       name: Addition
 *       description: ...
 *       priority: high
 *       owner: dv
 *       goal: 100
 *       coverage: [alu8_cg::cp_op::add, assert:a_add_result]
 *       tests: [alu8_directed_test]
 */
function parseTestplan(text) {
  const y = parseYaml(text);
  const list = y.features || y.testpoints || y.goals || y.items || (Array.isArray(y) ? y : []);
  const defGoal = typeof y.goal === 'number' ? y.goal : 100;
  const asArr = v => v == null ? [] : Array.isArray(v) ? v : String(v).split(/[;,]/).map(s => s.trim()).filter(Boolean);
  return (list || []).filter(Boolean).map((f, k) => ({
    id: String(f.id || f.name || 'F' + (k + 1)),
    feature: String(f.name || f.feature || f.title || ''),
    description: String(f.description || f.desc || ''),
    priority: String(f.priority || ''),
    owner: String(f.owner || ''),
    items: [...asArr(f.coverage || f.cover || f.items), ...asArr(f.assertions).map(a => /^assert:/.test(a) ? a : 'assert:' + a), ...asArr(f.tests).map(t => /^test:/.test(t) ? t : 'test:' + t)],
    goal: typeof f.goal === 'number' ? f.goal : defGoal,
    tests: asArr(f.tests)
  }));
}

function loadPlanText(text, file) {
  return /\.(ya?ml|testplan)$/i.test(file || '') ? parseTestplan(text) : parsePlan(text);
}

function toTestplanYaml(name, features) {
  const q = s => /^[\w./:-]+$/.test(s) ? s : JSON.stringify(s);
  const out = [`# Testplan generated by 10xEngineers EDA`, `name: ${q(name)}`, 'goal: 100', 'features:'];
  for (const f of features) {
    out.push(`  - id: ${q(f.id)}`, `    name: ${q(f.feature || f.name || f.id)}`);
    if (f.description) out.push(`    description: ${JSON.stringify(f.description)}`);
    out.push(`    priority: ${q(f.priority || 'medium')}`);
    if (f.items && f.items.filter(i => !/^(test|assert):/.test(i)).length) out.push('    coverage:', ...f.items.filter(i => !/^(test|assert):/.test(i)).map(i => `      - ${q(i)}`));
    const as = (f.items || []).filter(i => /^assert:/.test(i));
    if (as.length) out.push('    assertions:', ...as.map(i => `      - ${q(i.slice(7))}`));
    const ts = (f.items || []).filter(i => /^test:/.test(i)).map(i => i.slice(5)).concat(f.tests || []);
    if (ts.length) out.push('    tests:', ...[...new Set(ts)].map(t => `      - ${q(t)}`));
  }
  return out.join('\n') + '\n';
}

/* ------------------------------------------------------------------ spec -> features (heuristic) */
function extractFromSpec(text) {
  const feats = [];
  let section = '';
  let n = 0;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const l = raw.trim();
    const h = /^(#{1,6})\s+(.*)$/.exec(l) || /^(\d+(?:\.\d+)*)\s+([A-Z].{2,80})$/.exec(l);
    if (h) { section = h[2].trim(); continue; }
    const sentences = l.split(/(?<=[.;])\s+/);
    for (const s of sentences) {
      if (!/\b(shall|must|should|will|is required to|needs to)\b/i.test(s)) continue;
      if (s.length < 12) continue;
      n++;
      const id = (section ? section.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 16).toUpperCase() : 'REQ') + '-' + String(n).padStart(2, '0');
      const prio = /\b(shall|must)\b/i.test(s) ? 'high' : /\bshould\b/i.test(s) ? 'medium' : 'low';
      feats.push({ id, feature: (section || 'Requirement') + ': ' + s.replace(/^[-*•\d.)\s]+/, '').slice(0, 60), description: s.replace(/^[-*•\d.)\s]+/, ''), priority: prio, items: [] });
    }
  }
  return feats;
}

module.exports = { parsePlan, evaluate, parseCsv, parseYaml, parseTestplan, loadPlanText, toTestplanYaml, extractFromSpec };
