'use strict';
/*
 * UVM-aware source analysis (regex based, works on unsaved text).
 * analyzeFile(text) -> { classes:[...] , sets:[...], gets:[...], overrides:[...] }
 * buildTopology(index, testName) -> tree of {inst, type, origType, overridden, cls, children}
 * lint(text) -> [{rule, severity, line, col, endCol, message, fix?}]
 */
const { lineIndex } = require('./fsm');
// remove comments but keep string literals (instance names / config_db fields live in strings)
const stripComments = text => text.replace(/"(?:\\.|[^"\\\n])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => (m[0] === '"' ? m : m.replace(/[^\n]/g, ' ')));

const UVM_COMPONENT_BASES = new Set(['uvm_component', 'uvm_env', 'uvm_test', 'uvm_agent', 'uvm_driver', 'uvm_monitor', 'uvm_sequencer', 'uvm_scoreboard', 'uvm_subscriber', 'uvm_push_driver', 'uvm_random_stimulus', 'uvm_reg_predictor', 'uvm_reg_adapter_comp']);
const UVM_OBJECT_BASES = new Set(['uvm_object', 'uvm_sequence_item', 'uvm_sequence', 'uvm_sequence_base', 'uvm_reg', 'uvm_reg_block', 'uvm_reg_sequence', 'uvm_reg_adapter', 'uvm_transaction', 'uvm_reg_field']);

function baseName(t) { return String(t || '').replace(/\s*#\s*\(.*$/, '').trim(); }

function analyzeFile(text) {
  const clean = stripComments(text);
  const lineOf = lineIndex(clean);
  const res = { classes: [], sets: [], gets: [], overrides: [] };
  const cre = /\b(?:virtual\s+)?class\s+([A-Za-z_]\w*)\s*(?:#\s*\(([^;]*?)\))?\s*(?:extends\s+([A-Za-z_][\w:]*)\s*(?:#\s*\(([^;]*?)\))?)?\s*;/g;
  let m;
  while ((m = cre.exec(clean))) {
    const start = m.index;
    const endRe = /\bendclass\b/g;
    endRe.lastIndex = cre.lastIndex;
    const e = endRe.exec(clean);
    const end = e ? e.index : clean.length;
    const body = clean.slice(cre.lastIndex, end);
    const bodyOff = cre.lastIndex;
    const cls = {
      name: m[1], base: m[3] ? baseName(m[3]) : null, baseParams: m[4] || '', line: lineOf(start), endLine: lineOf(end),
      utils: null, creates: [], connects: [], vars: {}, methods: [], ports: []
    };
    let u = /`(uvm_component_utils|uvm_object_utils|uvm_component_param_utils|uvm_object_param_utils)(?:_begin)?\s*\(\s*([A-Za-z_][\w:]*)/.exec(body);
    if (u) cls.utils = { macro: u[1], name: u[2], line: lineOf(bodyOff + u.index) };
    // member declarations: Type name;
    const vre = /^\s*(?:rand\s+|local\s+|protected\s+)*([A-Za-z_][\w:]*(?:\s*#\s*\([^;]*?\))?)\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*;/gm;
    let v;
    while ((v = vre.exec(body))) {
      const t = baseName(v[1]);
      if (/^(return|function|task|end|begin|import|typedef|constraint|virtual|extern|bit|logic|int|string|byte)$/.test(t)) continue;
      v[2].split(',').forEach(n => { cls.vars[n.trim()] = t; });
      if (/^uvm_(analysis|seq_item|blocking|nonblocking|tlm)\w*(port|export|imp)/.test(t)) v[2].split(',').forEach(n => cls.ports.push({ name: n.trim(), type: t + (v[1].includes('#') ? v[1].slice(v[1].indexOf('#')) : ''), line: lineOf(bodyOff + v.index) }));
    }
    // methods
    const mre = /\b(function|task)\s+(?:(?:virtual|static|automatic|local|protected)\s+)*(?:[\w:\[\]\s]*?\s)?([A-Za-z_]\w*)\s*\(/g;
    let mm;
    while ((mm = mre.exec(body))) {
      const pre = body.slice(Math.max(0, mm.index - 30), mm.index);
      cls.methods.push({ kind: mm[1], name: mm[2], line: lineOf(bodyOff + mm.index), pure: /\bpure\s+virtual\s*$/.test(pre), extern: /\bextern\s+(virtual\s+)?$/.test(pre) });
    }
    // create calls
    const crRe = /([A-Za-z_]\w*(?:\[[^\]]*\])?)\s*=\s*([A-Za-z_]\w*)(?:\s*#\s*\([^)]*\))?\s*::\s*type_id\s*::\s*create\s*\(\s*(?:"([^"]*)"|([^,)]+))\s*(?:,\s*([^)]+))?\)/g;
    let c;
    while ((c = crRe.exec(body))) cls.creates.push({ var: c[1].replace(/\[.*$/, ''), type: c[2], inst: c[3] != null ? c[3] : c[4].trim(), parent: (c[5] || '').trim(), line: lineOf(bodyOff + c.index) });
    // connect calls  a.b.connect(c.d)
    const coRe = /([A-Za-z_][\w.\[\]]*)\s*\.\s*connect\s*\(\s*([A-Za-z_][\w.\[\]]*)\s*\)/g;
    while ((c = coRe.exec(body))) cls.connects.push({ from: c[1], to: c[2], line: lineOf(bodyOff + c.index) });
    // sequence starts  seq.start(env.agt.sqr)
    cls.starts = [];
    const stRe = /([A-Za-z_]\w*)\s*\.\s*start\s*\(\s*([A-Za-z_][\w.\[\]]*)\s*[,)]/g;
    while ((c = stRe.exec(body))) cls.starts.push({ var: c[1], target: c[2], line: lineOf(bodyOff + c.index) });
    res.classes.push(cls);
    cre.lastIndex = end;
  }
  let s;
  const setRe = /uvm_config_db\s*#\s*\(\s*([^;]*?)\s*\)\s*::\s*set\s*\(\s*([^,]+?)\s*,\s*(?:"([^"]*)"|([^,]+?))\s*,\s*"([^"]*)"\s*,/g;
  while ((s = setRe.exec(clean))) res.sets.push({ type: s[1].replace(/\s+/g, ' '), cntxt: s[2].trim(), inst: s[3] != null ? s[3] : s[4].trim(), field: s[5], line: lineOf(s.index) });
  const getRe = /uvm_config_db\s*#\s*\(\s*([^;]*?)\s*\)\s*::\s*get\s*\(\s*([^,]+?)\s*,\s*(?:"([^"]*)"|([^,]+?))\s*,\s*"([^"]*)"\s*,\s*([^)]+?)\s*\)/g;
  while ((s = getRe.exec(clean))) res.gets.push({ type: s[1].replace(/\s+/g, ' '), cntxt: s[2].trim(), inst: s[3] != null ? s[3] : s[4].trim(), field: s[5], target: s[6], line: lineOf(s.index) });
  const ov = [
    [/set_type_override_by_type\s*\(\s*([A-Za-z_]\w*)\s*::\s*get_type\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*::\s*get_type/g, 'type', 1, 2, 0],
    [/([A-Za-z_]\w*)\s*::\s*type_id\s*::\s*set_type_override\s*\(\s*([A-Za-z_]\w*)\s*::\s*get_type/g, 'type', 1, 2, 0],
    [/set_inst_override_by_type\s*\(\s*"([^"]*)"\s*,\s*([A-Za-z_]\w*)\s*::\s*get_type\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*::\s*get_type/g, 'inst', 2, 3, 1],
    [/([A-Za-z_]\w*)\s*::\s*type_id\s*::\s*set_inst_override\s*\(\s*([A-Za-z_]\w*)\s*::\s*get_type\s*\(\s*\)\s*,\s*"([^"]*)"/g, 'inst', 1, 2, 3],
    [/set_type_override_by_name\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"/g, 'type', 1, 2, 0],
    [/set_inst_override_by_name\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/g, 'inst', 1, 2, 3]
  ];
  for (const [re, kind, a, b, p] of ov) {
    let o;
    while ((o = re.exec(clean))) res.overrides.push({ kind, orig: o[a], override: o[b], path: p ? o[p] : '*', line: lineOf(o.index), cls: classAt(res.classes, lineOf(o.index)) });
  }
  return res;
}

function classAt(classes, line) {
  const c = classes.find(k => k.line <= line && line <= k.endLine);
  return c ? c.name : null;
}

/* ---------------------------------------------------------------- index across files */
function buildIndex(files) { // files: [{uri, text}]
  const idx = { classes: new Map(), sets: [], gets: [], overrides: [] };
  for (const f of files) {
    let a;
    try { a = analyzeFile(f.text); } catch (e) { continue; }
    a.classes.forEach(c => { c.uri = f.uri; idx.classes.set(c.name, c); });
    a.sets.forEach(x => idx.sets.push({ ...x, uri: f.uri }));
    a.gets.forEach(x => idx.gets.push({ ...x, uri: f.uri }));
    a.overrides.forEach(x => idx.overrides.push({ ...x, uri: f.uri }));
  }
  return idx;
}

function ancestors(idx, name) {
  const out = [];
  let c = idx.classes.get(name);
  const seen = new Set();
  while (c && c.base && !seen.has(c.base)) { seen.add(c.base); out.push(c.base); c = idx.classes.get(c.base); }
  return out;
}

function isA(idx, name, base) { return name === base || ancestors(idx, name).includes(base); }
function kindOf(idx, name) {
  const anc = [name, ...ancestors(idx, name)];
  if (anc.includes('uvm_test')) return 'test';
  if (anc.some(a => UVM_COMPONENT_BASES.has(a))) return 'component';
  if (anc.some(a => UVM_OBJECT_BASES.has(a))) return 'object';
  return 'class';
}

function tests(idx) { return [...idx.classes.values()].filter(c => kindOf(idx, c.name) === 'test').map(c => c.name); }

function globMatch(pat, s) {
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return re.test(s);
}

/** Component topology for a test, applying factory overrides declared in the test (and its bases). */
function buildTopology(idx, testName) {
  const chain = [testName, ...ancestors(idx, testName)];
  const ovs = idx.overrides.filter(o => !o.cls || chain.includes(o.cls) || !idx.classes.has(o.cls));
  const resolve = (type, path) => {
    for (const o of ovs.filter(x => x.kind === 'inst')) if (o.orig === type && (globMatch(o.path, path) || globMatch('uvm_test_top.' + o.path, path))) return { type: o.override, by: o };
    for (const o of ovs.filter(x => x.kind === 'type')) if (o.orig === type) return { type: o.override, by: o };
    return { type, by: null };
  };
  const createsOf = name => {
    const out = [];
    [name, ...ancestors(idx, name)].reverse().forEach(n => { const c = idx.classes.get(n); if (c) c.creates.forEach(cr => { const k = out.findIndex(x => x.var === cr.var); if (k >= 0) out.splice(k, 1); out.push(cr); }); });
    return out;
  };
  const connectsOf = name => [name, ...ancestors(idx, name)].flatMap(n => (idx.classes.get(n) || { connects: [] }).connects);
  let guard = 0;
  const node = (inst, type, path, origType, by) => {
    const n = { inst, type, origType, overridden: !!by, override: by, path, cls: idx.classes.get(type) || null, kind: kindOf(idx, type), children: [], connects: connectsOf(type), ports: [] };
    [type, ...ancestors(idx, type)].forEach(t => { const c = idx.classes.get(t); if (c) n.ports.push(...c.ports); });
    if (++guard > 2000 || path.split('.').length > 25) return n;
    for (const cr of createsOf(type)) {
      if (cr.parent && cr.parent !== 'this') continue;
      if (kindOf(idx, cr.type) === 'object') continue;
      const p = path + '.' + cr.inst;
      const r = resolve(cr.type, p);
      n.children.push(node(cr.inst, r.type, p, r.by ? cr.type : null, r.by));
    }
    return n;
  };
  return node('uvm_test_top', testName, 'uvm_test_top', null, null);
}

/** config_db cross reference: for a get, the sets that can provide it (field + type match; scope by glob when possible). */
function matchConfig(idx) {
  const norm = t => t.replace(/\s+/g, '');
  return {
    setsForGet: g => idx.sets.filter(s => (s.field === g.field || globMatch(s.field, g.field)) && norm(s.type) === norm(g.type)),
    getsForSet: s => idx.gets.filter(g => (s.field === g.field || globMatch(s.field, g.field)) && norm(s.type) === norm(g.type))
  };
}

/* ---------------------------------------------------------------- lint */
function lint(text, idx) {
  const clean = stripComments(text);
  const lines = clean.split('\n');
  const raw = text.split('\n');
  const a = analyzeFile(text);
  const out = [];
  const add = (rule, severity, line, message, fix) => {
    const l = raw[line] || '';
    const col = l.length - l.trimStart().length;
    out.push({ rule, severity, line, col, endCol: l.length, message, fix });
  };
  const kind = n => idx ? kindOf(idx, n) : (UVM_COMPONENT_BASES.has(n) ? 'component' : UVM_OBJECT_BASES.has(n) ? 'object' : 'class');
  for (const c of a.classes) {
    if (!c.base) continue;
    const k = idx && idx.classes.has(c.name) ? kindOf(idx, c.name) : (UVM_COMPONENT_BASES.has(c.base) || c.base === 'uvm_test' ? 'component' : UVM_OBJECT_BASES.has(c.base) ? 'object' : kind(c.base));
    if (k === 'class') continue;
    const isComp = k === 'component' || k === 'test';
    const macro = c.baseParams || /#/.test(raw[c.line] || '') && /class\s+\w+\s*#/.test(raw[c.line]) ? (isComp ? 'uvm_component_param_utils' : 'uvm_object_param_utils') : (isComp ? 'uvm_component_utils' : 'uvm_object_utils');
    if (!c.utils) {
      const indent = '  ';
      add('UVM001', 'warning', c.line, `${c.name} is not registered with the factory (missing \`${macro}).`, { title: `Add \`${macro}(${c.name})`, insertLine: c.line + 1, text: `${indent}\`${macro}(${c.name})\n` });
    } else if (c.utils.name !== c.name) {
      const l = c.utils.line;
      add('UVM002', 'error', l, `\`${c.utils.macro} registers '${c.utils.name}' inside class '${c.name}'.`, { title: `Register ${c.name}`, replaceLine: l, find: c.utils.name, replace: c.name });
    } else if ((isComp && /object/.test(c.utils.macro)) || (!isComp && /component/.test(c.utils.macro))) {
      add('UVM003', 'error', c.utils.line, `${c.name} is a ${isComp ? 'component' : 'object'} but uses \`${c.utils.macro}.`, { title: `Use \`${isComp ? 'uvm_component_utils' : 'uvm_object_utils'}`, replaceLine: c.utils.line, find: c.utils.macro, replace: c.utils.macro.replace(isComp ? 'object' : 'component', isComp ? 'component' : 'object') });
    }
    // constructor shape
    const body = lines.slice(c.line, c.endLine + 1).join('\n');
    const ctor = /function\s+new\s*\(([^)]*)\)/.exec(body);
    if (isComp && ctor && !/uvm_component\s+\w+/.test(ctor[1])) add('UVM004', 'error', c.line + body.slice(0, ctor.index).split('\n').length - 1, `Component constructor must be new(string name, uvm_component parent) for the factory to call it.`);
    if (!isComp && ctor && /,/.test(ctor[1])) add('UVM005', 'warning', c.line + body.slice(0, ctor.index).split('\n').length - 1, `Object constructor should take only (string name = "...") — the factory calls new(name).`);
    // super.<phase>
    for (const ph of ['build_phase', 'connect_phase']) {
      const r = new RegExp('function\\s+void\\s+' + ph + '\\s*\\([^)]*\\)\\s*;([\\s\\S]*?)endfunction').exec(body);
      if (r && !new RegExp('super\\s*\\.\\s*' + ph).test(r[1]) && ph === 'build_phase') {
        const ln = c.line + body.slice(0, r.index).split('\n').length - 1;
        add('UVM006', 'warning', ln, `${c.name}.build_phase does not call super.build_phase(phase); field automation / config of the base class is skipped.`, { title: 'Insert super.build_phase(phase)', insertLine: ln + 1, text: '    super.build_phase(phase);\n' });
      }
    }
    // objections balanced
    const raise = (body.match(/raise_objection\s*\(/g) || []).length, drop = (body.match(/drop_objection\s*\(/g) || []).length;
    if (raise > drop) add('UVM007', 'warning', c.line, `${c.name}: ${raise} raise_objection but ${drop} drop_objection — the phase may never end.`);
  }
  lines.forEach((l, i) => {
    // randomize() result thrown away
    const r = /^\s*([A-Za-z_][\w.\[\]]*\.)?randomize\s*\(([^;]*)\)\s*(with\b[^;]*)?;/.exec(l);
    if (r && !/\b(if|assert|void\s*'|=)\s*\(?/.test(l.slice(0, l.indexOf('randomize')))) {
      const obj = r[1] || '';
      add('UVM010', 'warning', i, `Result of ${obj}randomize() is ignored — a failed randomization goes unnoticed.`,
        { title: 'Check the randomize() result', replaceLine: i, whole: true, replace: (raw[i].match(/^\s*/)[0]) + `if (!${raw[i].trim().replace(/;\s*$/, '')}) \`uvm_error(get_type_name(), "randomize failed")` });
    }
    // config_db get unchecked
    const g = /^\s*uvm_config_db\s*#.*::\s*get\s*\(.*\)\s*;\s*$/.exec(l);
    if (g) add('UVM011', 'warning', i, 'uvm_config_db::get result is not checked — a missing set() leaves the handle null.',
      { title: 'Check the get() and `uvm_fatal', replaceLine: i, whole: true, replace: (raw[i].match(/^\s*/)[0]) + `if (!${raw[i].trim().replace(/;\s*$/, '')}) \`uvm_fatal("CFG", "config_db get failed")` });
    // component built with new()
    const nw = /^\s*([A-Za-z_]\w*)\s*=\s*new\s*\(\s*"([^"]*)"\s*,\s*this\s*\)\s*;/.exec(l);
    if (nw) {
      const owner = a.classes.find(c => c.line <= i && i <= c.endLine);
      const t = owner && owner.vars[nw[1]];
      if (t && !/^uvm_(analysis|seq_item|blocking|nonblocking|tlm|put|get)/.test(t) && !/_(port|export|imp|fifo)$/.test(t)) {
        add('UVM012', 'warning', i, `'${nw[1]}' is built with new(); use ${t}::type_id::create so factory overrides apply.`,
          { title: `Use ${t}::type_id::create`, replaceLine: i, whole: true, replace: (raw[i].match(/^\s*/)[0]) + `${nw[1]} = ${t}::type_id::create("${nw[2]}", this);` });
      }
    }
  });
  // macros used without include in a package/file that defines classes
  if (/`uvm_/.test(clean) && /\bpackage\b|\bmodule\b/.test(clean) && !/`include\s+"uvm_macros\.svh"/.test(text)) {
    const ln = lines.findIndex(l => /\bpackage\b|\bmodule\b/.test(l));
    add('UVM013', 'error', ln, 'UVM macros are used but "uvm_macros.svh" is not included.', { title: 'Add `include "uvm_macros.svh"', insertLine: ln + 1, text: '  `include "uvm_macros.svh"\n' });
  }
  // config_db get without any matching set in workspace
  if (idx) {
    const mc = matchConfig(idx);
    a.gets.forEach(g => { if (!mc.setsForGet(g).length) add('UVM020', 'info', g.line, `No uvm_config_db set() in the workspace provides "${g.field}" of type ${g.type}.`); });
  }
  return out;
}

module.exports = { analyzeFile, buildIndex, buildTopology, tests, matchConfig, ancestors, kindOf, lint, isA };
