'use strict';
/* 10xEngineers EDA — RTL-aware waveform helpers (extension host, no VS Code dependency):
 *  - a light Verilog/SystemVerilog structure index: modules, declarations, drivers (assign / procedural), instances + port maps
 *  - X-trace through the RTL: from a signal that is X at time t, walk backwards through its drivers to the signal where the X starts
 *  - declaration lookup for a waveform signal path (cross-probe)
 * This is a structural approximation (no elaboration): generate blocks, functions and macros are not expanded. */

const KW = new Set(('module endmodule input output inout wire reg logic bit byte int integer var signed unsigned assign always always_ff always_comb always_latch ' +
  'initial begin end if else case casez casex endcase default for while posedge negedge or and not parameter localparam generate endgenerate genvar ' +
  'function endfunction task endtask return typedef enum struct packed interface endinterface modport automatic unique priority').split(' '));

function stripComments(text) {
  // keep line structure so line numbers survive
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '').replace(/"(?:[^"\\\n]|\\.)*"/g, m => ' '.repeat(m.length));
}
const idsIn = s => [...new Set((s.replace(/\d+'[sS]?[bBoOdDhH][0-9a-fA-F_xXzZ?]+/g, ' ').match(/[A-Za-z_][\w$]*/g) || []).filter(x => !KW.has(x) && !/^\$/.test(x)))];
const lineOf = (text, idx) => { let n = 0; for (let i = text.indexOf('\n'); i >= 0 && i < idx; i = text.indexOf('\n', i + 1)) n++; return n; };

/** index one HDL source file: { modules: { name: {file, line, decls:{n:{line,dir}}, drivers:{n:[{line, inputs, text, xLiteral}]}, instances:[{type, name, line, ports:{p: expr}}]} } } */
function indexFile(text, file) {
  const src = stripComments(text);
  const modules = {};
  const modRe = /\b(module|interface)\s+(?:automatic\s+)?([A-Za-z_]\w*)([\s\S]*?)\bend(?:module|interface)\b/g;
  let mm;
  while ((mm = modRe.exec(src))) {
    const base = mm.index + mm[0].indexOf(mm[3]);
    const body = mm[3];
    const mod = { name: mm[2], file, line: lineOf(src, mm.index), decls: {}, drivers: {}, instances: [] };
    modules[mod.name] = mod;
    const L = off => lineOf(src, base + off);
    // declarations (ANSI ports and body)
    const declRe = /\b(input|output|inout)?\s*(?:wire|reg|logic|bit|var|integer|int|byte|tri)?\s*(?:signed|unsigned)?\s*((?:\[[^\]]*\]\s*)*)([A-Za-z_]\w*(?:\s*(?:\[[^\]]*\])*\s*(?:=[^,;)]*)?\s*,\s*(?!input|output|inout|wire|reg|logic)[A-Za-z_]\w*)*)\s*(?=[;,)=\[])/g;
    let dm;
    const declKw = /\b(input|output|inout|wire|reg|logic|bit|var|integer|int|byte|tri|genvar)\b/g;
    let k;
    while ((k = declKw.exec(body))) {
      declRe.lastIndex = k.index;
      dm = declRe.exec(body);
      if (!dm || dm.index !== k.index) continue;
      const dir = dm[1] || (mod.lastDir && /^(wire|reg|logic)$/.test(k[1]) && body.slice(Math.max(0, k.index - 12), k.index).match(/(input|output|inout)\s*$/) ? mod.lastDir : null);
      if (dm[1]) mod.lastDir = dm[1];
      for (const nm of dm[3].replace(/\[[^\]]*\]/g, ' ').replace(/=[^,]*/g, ' ').split(',').map(s => s.trim()).filter(s => /^[A-Za-z_]\w*$/.test(s))) {
        if (KW.has(nm)) continue;
        if (!mod.decls[nm]) mod.decls[nm] = { line: L(dm.index + dm[0].indexOf(nm)), dir: dir || (mod.decls[nm] && mod.decls[nm].dir) || null };
      }
      declKw.lastIndex = dm.index + Math.max(1, dm[0].length);
    }
    delete mod.lastDir;
    const add = (lhs, rhs, off, text, ctl, blk) => {
      const base0 = lhs.replace(/\[.*$/, '').replace(/\..*$/, '').trim();
      const names = /^\{/.test(lhs) ? idsIn(lhs) : [base0];
      const inputs = [...new Set(idsIn(rhs).concat(ctl || []).concat(/\[/.test(lhs) ? idsIn(lhs.replace(/^[^\[]*/, '')) : []))];
      for (const n of names) {
        if (!n || KW.has(n)) continue;
        (mod.drivers[n] = mod.drivers[n] || []).push({ line: L(off), inputs: inputs.filter(x => x !== n || /<=/.test(text)), text: text.trim().replace(/\s+/g, ' ').slice(0, 160), blk: blk || 'assign', xLiteral: /'[bhdo]?[xX]|'x\b|\bx\b(?=\s*[;,)])/i.test(rhs) });
      }
    };
    // continuous assignments
    const asRe = /\bassign\s+([^=;]+?)\s*=\s*([^;]+);/g;
    let a;
    while ((a = asRe.exec(body))) add(a[1], a[2], a.index, a[0]);
    // procedural blocks: collect if/case conditions inside each always/initial block as control inputs
    const blkRe = /\b(always(?:_ff|_comb|_latch)?|initial)\b/g;
    const starts = [];
    let b;
    while ((b = blkRe.exec(body))) starts.push(b.index);
    starts.push(body.length);
    for (let i = 0; i < starts.length - 1; i++) {
      let blk = body.slice(starts[i], starts[i + 1]);
      const stop = blk.search(/\b(assign|endmodule|module)\b|\n\s*(?:[A-Za-z_]\w*\s*(?:#\s*\([\s\S]*?\))?\s+[A-Za-z_]\w*\s*\()/);
      if (stop > 0) blk = blk.slice(0, stop);
      const ctl = [];
      const cRe = /\b(?:if|case[zx]?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
      let c;
      while ((c = cRe.exec(blk))) ctl.push(...idsIn(c[1]));
      const sens = /@\s*\(([^)]*)\)/.exec(blk);
      const resetish = sens ? idsIn(sens[1]).filter(x => !/clk|clock/i.test(x)) : [];
      const pRe = /(?:^|[;\s)])\s*((?:\{[^}]*\})|[A-Za-z_][\w$]*(?:\s*\[[^\]]*\])*(?:\.[A-Za-z_]\w*)?)\s*(<=|=)(?!=)\s*([^;]+);/g;
      let p;
      while ((p = pRe.exec(blk))) {
        if (/^(if|for|while|case)$/.test(p[1])) continue;
        add(p[1], p[3], starts[i] + p.index + p[0].indexOf(p[1]), p[1] + ' ' + p[2] + ' ' + p[3] + ';', [...new Set(ctl.concat(resetish))], /^initial/.test(blk) ? 'initial' : 'always');
      }
    }
    // instances: Type [#(...)] name ( .port(expr), ... );
    const instRe = /(?<![\w$.])([A-Za-z_]\w*)(?:\s*#\s*\((?:[^()]|\([^()]*\))*\))?\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?\(\s*((?:[^;]|\n)*?)\)\s*;/g;
    let im;
    while ((im = instRe.exec(body))) {
      if (KW.has(im[1]) || KW.has(im[2]) || /^(if|for|while|case|assert|assume|cover|return)$/.test(im[1])) continue;
      if (!/^\s*\./.test(im[3]) && !/^\s*$/.test(im[3]) && !/^[\w\s,\[\]:'{}]+$/.test(im[3])) continue;
      const ports = {};
      const prt = /\.([A-Za-z_]\w*)\s*(?:\(([^()]*(?:\([^()]*\)[^()]*)*)\))?/g;
      let q;
      while ((q = prt.exec(im[3]))) ports[q[1]] = q[2] == null ? q[1] : q[2].trim();
      if (/\.\*/.test(im[3])) ports['.*'] = true;
      mod.instances.push({ type: im[1], name: im[2], line: L(im.index), ports, ordered: Object.keys(ports).length ? null : im[3].split(',').map(s => s.trim()) });
    }
  }
  return modules;
}

/** merge file indexes */
function buildIndex(files) {
  const mods = {};
  for (const f of files) {
    try { Object.assign(mods, indexFile(f.text, f.file)); } catch (e) { /* skip unparsable file */ }
  }
  return mods;
}

/** map every dump scope path to a module definition by walking instance names from the tops */
function scopeModules(index, scopePaths) {
  const out = {};
  const instOf = {};
  for (const m of Object.values(index)) for (const i of m.instances) if (index[i.type]) (instOf[m.name] = instOf[m.name] || {})[i.name] = i;
  for (const sp of scopePaths) {
    const parts = sp.split('.');
    let mod = index[parts[0]] ? parts[0] : null;
    let k = 1;
    if (!mod) { // simulator wrapper scopes (e.g. "TOP", "$root"): start where a known module name appears
      for (; k < parts.length; k++) if (index[parts[k - 1]] || index[parts[k]]) { mod = index[parts[k - 1]] ? parts[k - 1] : parts[k]; if (!index[parts[k - 1]]) k++; break; }
    }
    if (!mod) continue;
    let ok = true;
    for (; k < parts.length; k++) {
      const inst = instOf[mod] && instOf[mod][parts[k]];
      if (!inst) { ok = false; break; }
      mod = inst.type;
    }
    if (ok) out[sp] = mod;
  }
  return out;
}

const isKnown = v => v != null && !/[^01]/.test(v);
function idxAt(d, t) {
  const a = d.t;
  if (!a.length || a[0] > t) return -1;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= t) lo = m; else hi = m - 1; }
  return lo;
}
/** start of the unknown interval containing t, or null if the value at t is known (a missing value counts as unknown from 0) */
function xSince(d, t) {
  const k = idxAt(d, t);
  if (k < 0) return 0;
  if (isKnown(d.v[k])) return null;
  let s = k;
  while (s > 0 && !isKnown(d.v[s - 1])) s--;
  return d.t[s];
}

/**
 * Walk an X backwards through the RTL.
 * parsed: {meta, data} from parseVcd; vars: [{path, id, scope, name}]; index: buildIndex(); start: {path, t}
 * returns { steps:[{path, scope, module, since, value, file, line, driver, why}], root:{…, reason}, notes:[] }
 */
function traceX(parsed, vars, index, start, opts) {
  opts = opts || {};
  const byPath = new Map();
  const byScope = new Map();
  for (const v of vars) {
    const leaf = v.name.replace(/\s*\[.*$/, '');
    const scope = v.scope;
    byPath.set(scope ? scope + '.' + leaf : leaf, v);
    byPath.set(v.path, v);
    if (!byScope.has(scope)) byScope.set(scope, new Map());
    byScope.get(scope).set(leaf, v);
  }
  const smap = scopeModules(index, [...byScope.keys()]);
  const notes = [];
  const steps = [];
  const seen = new Set();
  const startVar = byPath.get(start.path) || byPath.get(start.path.replace(/\s*\[.*$/, ''));
  if (!startVar) return { error: `Signal ${start.path} is not in the dump.` };
  const d0 = parsed.data[startVar.id];
  const s0 = d0 ? xSince(d0, start.t) : null;
  if (s0 == null) return { known: true, value: d0 ? d0.v[Math.max(0, idxAt(d0, start.t))] : null };

  let cur = { v: startVar, since: s0 };
  for (let depth = 0; depth < (opts.maxDepth || 40); depth++) {
    const scope = cur.v.scope, leaf = cur.v.name.replace(/\s*\[.*$/, '');
    const key = scope + '.' + leaf;
    const modName = smap[scope];
    const mod = modName && index[modName];
    const d = parsed.data[cur.v.id];
    const value = d ? d.v[Math.max(0, idxAt(d, cur.since))] : null;
    const step = { path: key, scope, module: modName || null, since: cur.since, value, file: mod ? mod.file : null, line: mod && mod.decls[leaf] ? mod.decls[leaf].line : null };
    steps.push(step);
    if (seen.has(key)) { step.why = 'loop'; return { steps, root: Object.assign({}, step, { reason: 'The trace came back to a signal it already visited: a feedback loop (e.g. a register that holds its own X because it was never reset).' }), notes }; }
    seen.add(key);
    if (!mod) {
      notes.push(`Scope ${scope || '(top)'} could not be matched to a module in the workspace sources, so the trace stops here.`);
      return { steps, root: Object.assign({}, step, { reason: 'No RTL for this scope in the workspace (testbench or vendor model?).' }), notes };
    }
    const drivers = mod.drivers[leaf] || [];
    // candidate inputs: driver inputs that exist in this scope of the dump and are unknown at (or just before) the time the X appeared
    const cands = [];
    const consider = (names, via) => {
      for (const n of names) {
        const v = byScope.get(scope) && byScope.get(scope).get(n);
        if (!v || v === cur.v) continue;
        const dd = parsed.data[v.id];
        if (!dd) continue;
        // a register samples its inputs before the edge: look just before `since` as well as at it
        const s = xSince(dd, cur.since) != null ? xSince(dd, cur.since) : (cur.since > 0 ? xSince(dd, cur.since - 1) : null);
        if (s != null && s <= cur.since) cands.push({ v, since: s, via });
      }
    };
    drivers.forEach(dr => consider(dr.inputs, dr));
    if (!drivers.length) {
      const decl = mod.decls[leaf];
      if (decl && decl.dir === 'input') {
        // step up to the parent and follow the port connection
        const parentScope = scope.split('.').slice(0, -1).join('.');
        const instName = scope.split('.').pop();
        const pmod = index[smap[parentScope]];
        const inst = pmod && pmod.instances.find(i => i.name === instName);
        const expr = inst && (inst.ports[leaf] != null ? inst.ports[leaf] : inst.ports['.*'] ? leaf : null);
        step.driver = inst ? { line: inst.line, file: pmod.file, text: `${inst.type} ${inst.name} (.${leaf}(${expr == null ? '?' : expr}))` } : null;
        if (expr != null && expr !== true) {
          const names = idsIn(String(expr));
          const pv = names.map(n => byScope.get(parentScope) && byScope.get(parentScope).get(n)).filter(Boolean);
          const xs = pv.map(v => ({ v, since: xSince(parsed.data[v.id] || { t: [], v: [] }, cur.since) })).filter(x => x.since != null).sort((a, b) => a.since - b.since);
          if (xs.length) { step.why = `input port, connected to ${expr} in ${parentScope}`; cur = xs[0]; continue; }
          if (!names.length) return { steps, root: Object.assign({}, step, { reason: `Input port tied to the constant ${expr} in ${parentScope}.` }), notes };
        }
        return { steps, root: Object.assign({}, step, { reason: inst ? `Input port ${leaf}: the parent connects it to ${expr == null ? 'nothing (unconnected port → Z/X)' : expr}, which is not unknown in the dump at this time.` : 'Top-level input port: the testbench drives it to X (or does not drive it).' }), notes };
      }
      const sub = mod.instances.find(i => Object.entries(i.ports).some(([, e]) => typeof e === 'string' && idsIn(e).includes(leaf)));
      if (sub) {
        // driven by a child instance output
        const port = Object.keys(sub.ports).find(p => typeof sub.ports[p] === 'string' && idsIn(sub.ports[p]).includes(leaf));
        const cs = scope ? scope + '.' + sub.name : sub.name;
        const v = byScope.get(cs) && byScope.get(cs).get(port);
        step.driver = { line: sub.line, file: mod.file, text: `${sub.type} ${sub.name} (.${port}(${sub.ports[port]}))` };
        if (v && parsed.data[v.id] && xSince(parsed.data[v.id], cur.since) != null) { step.why = `driven by output ${port} of instance ${sub.name}`; cur = { v, since: xSince(parsed.data[v.id], cur.since) }; continue; }
        return { steps, root: Object.assign({}, step, { reason: `Driven by output ${port} of ${sub.name} (${sub.type}); that port is not in the dump or is not X here.` }), notes };
      }
      return { steps, root: Object.assign({}, step, { reason: decl ? 'Declared but never assigned in this module: an undriven net (Z/X) or a register with no assignment.' : 'No declaration or driver found for this name in the module.' }), notes };
    }
    step.driver = drivers.length === 1 ? drivers[0] : drivers.slice().sort((a, b) => a.line - b.line)[0];
    step.drivers = drivers.map(x => ({ line: x.line, text: x.text }));
    if (cands.length) {
      cands.sort((a, b) => a.since - b.since);
      const c = cands[0];
      step.driver = c.via;
      step.why = `${c.v.name.replace(/\s*\[.*$/, '')} is unknown since ${c.since}`;
      cur = { v: c.v, since: c.since };
      continue;
    }
    const xl = drivers.find(dr => dr.xLiteral);
    if (xl) { step.driver = xl; return { steps, root: Object.assign({}, step, { reason: `The RTL assigns an explicit X here (line ${xl.line + 1}): ${xl.text}` }), notes }; }
    if (drivers.every(dr => dr.blk === 'initial')) {
      const first = drivers.slice().sort((a, b) => a.line - b.line)[0];
      step.driver = first;
      return { steps, root: Object.assign({}, step, { reason: `Only assigned in initial blocks (first at line ${first.line + 1}): it is X until that assignment runs. Give it a value at time 0 (e.g. "${leaf} = '0;" before the first delay).` }), notes };
    }
    const proc = drivers.some(dr => /<=/.test(dr.text));
    return {
      steps, root: Object.assign({}, step, {
        reason: proc
          ? 'All inputs of this register are known when the X appears, so the X starts here: the register has no reset value (or reset was not asserted before the first clock), or the clock/enable was X at the edge.'
          : 'All driver inputs are known at this time, so the X starts here: check for an out-of-range index, a width mismatch, multiple drivers, or a division by zero.'
      }), notes
    };
  }
  notes.push('Stopped after the maximum depth.');
  return { steps, root: steps[steps.length - 1], notes };
}

/** declaration of a dump path: {file, line} or null. Uses the instance tree first, then any module that declares the leaf name. */
function findDeclaration(index, scope, leaf) {
  const smap = scopeModules(index, [scope]);
  const mod = smap[scope] && index[smap[scope]];
  if (mod && mod.decls[leaf]) return { file: mod.file, line: mod.decls[leaf].line, module: mod.name, exact: true };
  const all = Object.values(index).filter(m => m.decls[leaf]);
  if (all.length === 1) return { file: all[0].file, line: all[0].decls[leaf].line, module: all[0].name, exact: false };
  if (all.length > 1) return { ambiguous: all.map(m => ({ file: m.file, line: m.decls[leaf].line, module: m.name })) };
  return null;
}

module.exports = { indexFile, buildIndex, scopeModules, traceX, findDeclaration, xSince, stripComments };
