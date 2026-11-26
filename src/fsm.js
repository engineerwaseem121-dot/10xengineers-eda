'use strict';
/*
 * FSM extraction for Verilog / SystemVerilog.
 * Heuristic, dependency-free. Detects:
 *   - states from `typedef enum {..}`, `enum {..} var;`, `localparam/parameter A = .., B = ..`
 *   - state registers from `case (state)` whose items are state constants
 *   - transitions from assignments to the state / next-state variables inside case items
 *     (if / else if / else conditions and ternaries become edge labels)
 *   - reset state from `if (!rst_n) state <= IDLE;`
 */

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"/g, m => m.replace(/[^\n]/g, ' '));
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return off => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
}

function parseNumber(s) {
  if (s == null) return null;
  s = String(s).replace(/_/g, '').trim();
  let m = /^(\d+)?\s*'\s*[sS]?\s*([bBoOdDhH])\s*([0-9a-fA-FxXzZ?]+)$/.exec(s);
  if (m) {
    if (/[xXzZ?]/.test(m[3])) return null;
    const base = { b: 2, o: 8, d: 10, h: 16 }[m[2].toLowerCase()];
    const v = parseInt(m[3], base);
    return isNaN(v) ? null : v;
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  m = /^'([01])$/.exec(s);
  if (m) return +m[1];
  return null;
}

function rangeWidth(s) {
  const m = /\[\s*(\d+)\s*:\s*(\d+)\s*\]/.exec(s || '');
  return m ? Math.abs(+m[1] - +m[2]) + 1 : null;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function findScopes(clean) {
  const scopes = [];
  const re = /\b(module|macromodule|interface|program)\s+(?:(?:automatic|static)\s+)?([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(clean))) {
    const pre = clean.slice(Math.max(0, m.index - 24), m.index);
    if (/\b(virtual|typedef)\s*$/.test(pre)) continue;
    if (m[1] === 'interface' && m[2] === 'class') continue;
    const endKw = m[1] === 'macromodule' ? 'endmodule' : 'end' + m[1];
    const endRe = new RegExp('\\b' + endKw + '\\b', 'g');
    endRe.lastIndex = re.lastIndex;
    const e = endRe.exec(clean);
    const end = e ? e.index + e[0].length : clean.length;
    scopes.push({ kind: m[1], name: m[2], start: m.index, end });
    re.lastIndex = end;
  }
  if (!scopes.length) scopes.push({ kind: 'file', name: '', start: 0, end: clean.length });
  return scopes;
}

function collectGroups(clean, s, e) {
  const text = clean.slice(s, e);
  const groups = [];
  let m;

  const enumRe = /\b(typedef\s+)?enum\b([^{;]*)\{([^}]*)\}\s*([^;]*);/g;
  while ((m = enumRe.exec(text))) {
    const g = { kind: 'enum', members: [], width: rangeWidth(m[2]), typeName: null, vars: [], offset: s + m.index };
    const body = m[3];
    const bodyOff = s + m.index + m[0].indexOf('{') + 1;
    let next = 0, known = true, pos = 0;
    for (const part of body.split(',')) {
      const mm = /^\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:=\s*([\s\S]+?))?\s*$/.exec(part);
      if (mm) {
        let v;
        if (mm[2] !== undefined) { v = parseNumber(mm[2]); known = v !== null; }
        else v = known ? next : null;
        next = v === null ? 0 : v + 1;
        g.members.push({ name: mm[1], value: v, offset: bodyOff + pos + part.indexOf(mm[1]) });
      }
      pos += part.length + 1;
    }
    const tail = m[4].trim();
    if (m[1]) g.typeName = tail.replace(/\[.*$/, '').trim();
    else g.vars = tail.split(',').map(x => x.replace(/=.*$/, '').replace(/\[.*$/, '').trim()).filter(Boolean);
    if (g.members.length) groups.push(g);
  }

  const parRe = /\b(localparam|parameter)\b([^;]*?)(?=;|\)\s*\(|\)\s*;)/g;
  while ((m = parRe.exec(text))) {
    const g = { kind: 'param', members: [], width: rangeWidth(m[2]), typeName: null, vars: [], offset: s + m.index };
    const stmt = m[2];
    const stmtOff = s + m.index + m[1].length;
    const aRe = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=\s*([^,]+)/g;
    let a;
    while ((a = aRe.exec(stmt))) {
      if (/^(logic|reg|bit|int|integer|type|unsigned|signed)$/.test(a[1])) continue;
      g.members.push({ name: a[1], value: parseNumber(a[2]), offset: stmtOff + a.index });
    }
    if (g.members.length) groups.push(g);
  }

  for (const g of groups) {
    if (!g.typeName) continue;
    const vRe = new RegExp('\\b' + escapeRe(g.typeName) + '\\s+([^;=]+)[;=]', 'g');
    let v;
    while ((v = vRe.exec(text))) {
      v[1].split(',').forEach(x => {
        const n = x.trim().replace(/\[.*$/, '').trim();
        if (/^[A-Za-z_]\w*$/.test(n)) g.vars.push(n);
      });
    }
  }
  return groups;
}

function findEndcase(text, from) {
  const re = /\b(case|casez|casex|randcase|endcase)\b/g;
  re.lastIndex = from;
  let d = 1, m;
  while ((m = re.exec(text))) {
    if (m[1] === 'endcase') { if (--d === 0) return m.index; } else d++;
  }
  return text.length;
}

function prevSignificant(text, idx) {
  let i = idx - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return i;
}

function findLabels(body, isConst) {
  const labels = [];
  let depth = 0, m;
  const re = /\b(begin|end|case|casez|casex|endcase|fork|join_any|join_none|join)\b|\b(default|[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:(?![:=])/g;
  while ((m = re.exec(body))) {
    if (m[1]) {
      const k = m[1];
      if (k === 'begin' || k === 'fork' || k.startsWith('case')) depth++; else depth--;
      if (k === 'begin') { // skip optional block label  begin : name
        const lm = /^\s*:\s*[A-Za-z_]\w*/.exec(body.slice(re.lastIndex, re.lastIndex + 80));
        if (lm) re.lastIndex += lm[0].length;
      }
      continue;
    }
    if (depth !== 0) continue;
    const p = prevSignificant(body, m.index);
    const ok = p < 0 || body[p] === ';' || /\b(end|endcase|join\w*)$/.test(body.slice(Math.max(0, p - 10), p + 1));
    if (!ok) continue;
    const names = m[2].split(',').map(x => x.trim());
    if (!names.every(n => n === 'default' || isConst(n))) continue;
    labels.push({ names, start: m.index, end: m.index + m[0].length });
  }
  return labels;
}

function condFromPrefix(prefix) {
  let p = prefix.replace(/\s+$/, '');
  p = p.replace(/\bbegin(\s*:\s*\w+)?$/, '').replace(/\s+$/, '');
  if (/\belse$/.test(p)) return 'else';
  if (p.endsWith(')')) {
    let d = 0, i = p.length - 1;
    for (; i >= 0; i--) {
      if (p[i] === ')') d++;
      else if (p[i] === '(') { d--; if (d === 0) break; }
    }
    if (i >= 0 && /\bif$/.test(p.slice(0, i).replace(/\s+$/, ''))) {
      return p.slice(i + 1, p.length - 1).replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

// returns [{expr, cond}] for (possibly nested) ternaries
function splitTernary(rhs, cond) {
  const s = rhs.trim();
  // A type cast around the whole value, e.g. state_t'(din ? S_1 : S_IDLE) or pkg::state_t'(S_IDLE)
  const cast = /^[A-Za-z_][\w:]*\s*'\s*\(([\s\S]*)\)$/.exec(s);
  if (cast) {
    let d = 0, ok = true;
    for (const ch of cast[1]) { if (ch === '(') d++; else if (ch === ')' && --d < 0) { ok = false; break; } }
    if (ok && d === 0) return splitTernary(cast[1], cond);
  }
  let depth = 0, q = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === '?' && depth === 0) { q = i; break; }
  }
  if (q < 0) {
    const inner = /^\(([\s\S]*)\)$/.exec(s);
    if (inner && inner[1].includes('?')) return splitTernary(inner[1], cond);
    return [{ expr: s, cond }];
  }
  let nest = 0, colon = -1; depth = 0;
  for (let i = q + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (depth === 0 && c === '?') nest++;
    else if (depth === 0 && c === ':') { if (nest === 0) { colon = i; break; } nest--; }
  }
  if (colon < 0) return [{ expr: s, cond }];
  const c = s.slice(0, q).trim().replace(/^\((.*)\)$/, '$1');
  const and = (a, b) => [a, b].filter(Boolean).join(' && ');
  return splitTernary(s.slice(q + 1, colon), and(cond, c))
    .concat(splitTernary(s.slice(colon + 1), and(cond, '!(' + c + ')')));
}

function extractFsms(text) {
  const clean = stripComments(text);
  const lineOf = lineIndex(clean);
  const result = [];

  for (const scope of findScopes(clean)) {
    const groups = collectGroups(clean, scope.start, scope.end);
    if (!groups.length) continue;
    const constGroup = new Map();
    groups.forEach((g, gi) => g.members.forEach(mb => { if (!constGroup.has(mb.name)) constGroup.set(mb.name, gi); }));
    const isConst = n => constGroup.has(n);
    const stext = clean.slice(scope.start, scope.end);
    const fsmByKey = new Map();

    const caseRe = /\b(case|casez|casex)\s*\(\s*([^)]*?)\s*\)/g;
    let cm;
    while ((cm = caseRe.exec(stext))) {
      const expr = cm[2];
      if (!/^[A-Za-z_][\w.]*(\s*\[[^\]]*\])?$/.test(expr)) continue;
      const caseVar = expr.replace(/\s*\[.*$/, '');
      const bodyStart = caseRe.lastIndex;
      const bodyEnd = findEndcase(stext, bodyStart);
      const body = stext.slice(bodyStart, bodyEnd);
      const labels = findLabels(body, isConst);
      const counts = new Map();
      for (const l of labels) for (const n of l.names) if (n !== 'default') {
        const gi = constGroup.get(n);
        counts.set(gi, (counts.get(gi) || 0) + 1);
      }
      let best = -1, bestN = 0;
      counts.forEach((n, gi) => { if (n > bestN) { best = gi; bestN = n; } });
      if (best < 0 || bestN < 2) continue;
      const g = groups[best];
      const inGroup = n => constGroup.get(n) === best;

      const key = caseVar + '#' + best;
      let fsm = fsmByKey.get(key);
      if (!fsm) {
        // state-ish variables: case var, enum vars, X in `caseVar <= X;`, lhs receiving group constants
        const vars = new Set([caseVar, ...g.vars]);
        let a;
        const nRe = new RegExp('\\b' + escapeRe(caseVar) + '\\s*<?=\\s*([A-Za-z_]\\w*)\\s*;', 'g');
        while ((a = nRe.exec(stext))) if (!isConst(a[1])) vars.add(a[1]);
        const lRe = /\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*<?=\s*([A-Za-z_]\w*)\s*;/g;
        while ((a = lRe.exec(stext))) if (inGroup(a[2])) vars.add(a[1]);
        vars.delete('default');

        let reset = null;
        const rRe = /\bif\s*\(\s*[!~]?\s*([A-Za-z_]\w*)\s*(?:==\s*[^)]*)?\)\s*(?:begin\b(?:\s*:\s*\w+)?)?\s*([A-Za-z_]\w*)\s*<?=\s*([A-Za-z_]\w*)\s*;/g;
        while ((a = rRe.exec(stext))) {
          if (/rst|reset|clr|clear|init/i.test(a[1]) && vars.has(a[2]) && inGroup(a[3])) { reset = a[3]; break; }
        }
        if (!reset) {
          const zero = g.members.find(mb => mb.value === 0);
          reset = (zero || g.members[0]).name;
        }

        fsm = {
          id: (scope.name ? scope.name + '.' : '') + caseVar,
          name: caseVar,
          module: scope.name,
          line: lineOf(scope.start + cm.index),
          width: g.width,
          encoding: g.kind,
          reset,
          resetGuessed: false,
          stateVars: [...vars],
          states: g.members.map(mb => ({ name: mb.name, value: mb.value, declLine: lineOf(mb.offset), line: null })),
          transitions: [],
          hasDefault: false,
          caseLines: []
        };
        fsmByKey.set(key, fsm);
      }
      fsm.caseLines.push(lineOf(scope.start + cm.index));

      const stateVarRe = new RegExp('\\b(' + fsm.stateVars.map(escapeRe).join('|') + ')\\s*(?:\\[[^\\]]*\\])?\\s*(<=|=)(?!=)', 'g');
      const tmap = new Map(fsm.transitions.map(t => [t.from + '->' + t.to, t]));

      for (let li = 0; li < labels.length; li++) {
        const lab = labels[li];
        if (lab.names.includes('default')) fsm.hasDefault = true;
        const froms = lab.names.filter(n => n !== 'default' && inGroup(n));
        if (!froms.length) continue;
        const absLabel = scope.start + bodyStart + lab.start;
        for (const f of froms) {
          const st = fsm.states.find(x => x.name === f);
          if (st && st.line == null) st.line = lineOf(absLabel);
        }
        const itemStart = lab.end;
        const itemEnd = li + 1 < labels.length ? labels[li + 1].start : body.length;
        const item = body.slice(itemStart, itemEnd);

        let segStart = 0;
        const segs = item.split(';');
        for (const seg of segs) {
          stateVarRe.lastIndex = 0;
          const am = stateVarRe.exec(seg);
          if (am) {
            const rhs = seg.slice(am.index + am[0].length);
            const prefix = item.slice(0, segStart + am.index);
            const cond = condFromPrefix(prefix);
            const absOff = scope.start + bodyStart + itemStart + segStart + am.index;
            for (const part of splitTernary(rhs, cond)) {
              const ids = part.expr.match(/[A-Za-z_]\w*/g) || [];
              let targets = ids.filter(inGroup);
              if (!targets.length && ids.length === 1 && fsm.stateVars.includes(ids[0])) targets = ['@self'];
              if (targets.length !== 1) continue;
              for (const f of froms) {
                const to = targets[0] === '@self' ? f : targets[0];
                const k = f + '->' + to;
                const ex = tmap.get(k);
                if (ex) {
                  if (part.cond && ex.cond && !ex.cond.split(' || ').includes(part.cond)) ex.cond += ' || ' + part.cond;
                  else if (!part.cond) ex.cond = ex.cond || '';
                } else {
                  const t = { from: f, to, cond: part.cond, line: lineOf(absOff) };
                  tmap.set(k, t);
                  fsm.transitions.push(t);
                }
              }
            }
          }
          segStart += seg.length + 1;
        }
      }
      caseRe.lastIndex = bodyStart; // allow nested cases to be examined too
    }

    for (const f of fsmByKey.values()) {
      f.states.forEach(s => { if (s.line == null) s.line = s.declLine; });
      result.push(f);
    }
  }
  return result;
}

function lintFsm(fsm) {
  const issues = [];
  const names = fsm.states.map(s => s.name);
  const handled = new Set();
  fsm.states.forEach(s => { if (s.line !== s.declLine) handled.add(s.name); });
  const out = {};
  names.forEach(n => { out[n] = []; });
  fsm.transitions.forEach(t => { if (out[t.from] && t.from !== t.to) out[t.from].push(t.to); });

  if (fsm.transitions.length) {
    const seen = new Set([fsm.reset]);
    const q = [fsm.reset];
    while (q.length) { const n = q.shift(); (out[n] || []).forEach(m => { if (!seen.has(m)) { seen.add(m); q.push(m); } }); }
    fsm.states.forEach(s => {
      if (!seen.has(s.name)) issues.push({ severity: 'warning', line: s.line, message: `FSM '${fsm.name}': state ${s.name} is unreachable from reset state ${fsm.reset}.` });
    });
    fsm.states.forEach(s => {
      if (handled.has(s.name) && out[s.name].length === 0 && seen.has(s.name)) {
        issues.push({ severity: 'info', line: s.line, message: `FSM '${fsm.name}': state ${s.name} has no exit transition (dead-end / terminal state).` });
      }
    });
  }
  if (!fsm.hasDefault) {
    fsm.states.forEach(s => {
      if (!handled.has(s.name)) issues.push({ severity: 'warning', line: s.declLine, message: `FSM '${fsm.name}': state ${s.name} has no case item and there is no default branch.` });
    });
    const full = fsm.width && Math.pow(2, fsm.width) === fsm.states.length;
    if (!full) issues.push({ severity: 'info', line: fsm.line, message: `FSM '${fsm.name}': case statement has no default branch; illegal encodings are not recovered.` });
  }
  const byVal = new Map();
  fsm.states.forEach(s => {
    if (s.value == null) return;
    if (byVal.has(s.value)) issues.push({ severity: 'error', line: s.declLine, message: `FSM '${fsm.name}': state ${s.name} has the same encoding (${s.value}) as ${byVal.get(s.value)}.` });
    else byVal.set(s.value, s.name);
  });
  return issues;
}

function toMermaid(f) {
  const clean = s => s.replace(/[:;]/g, ' ').replace(/\s+/g, ' ').trim();
  const lines = ['stateDiagram-v2'];
  if (f.reset) lines.push(`    [*] --> ${f.reset}`);
  f.transitions.forEach(t => lines.push(`    ${t.from} --> ${t.to}${t.cond ? ' : ' + clean(t.cond) : ''}`));
  return lines.join('\n');
}

function toDot(f) {
  const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
  const lines = [`digraph ${q(f.id)} {`, '  rankdir=LR;', '  node [shape=box, style=rounded];'];
  if (f.reset) lines.push('  __reset [shape=point];', `  __reset -> ${q(f.reset)};`);
  f.states.forEach(s => lines.push(`  ${q(s.name)}${s.name === f.reset ? ' [peripheries=2]' : ''};`));
  f.transitions.forEach(t => lines.push(`  ${q(t.from)} -> ${q(t.to)}${t.cond ? ' [label=' + q(t.cond) + ']' : ''};`));
  lines.push('}');
  return lines.join('\n');
}

module.exports = { extractFsms, lintFsm, toMermaid, toDot, stripComments, lineIndex, parseNumber };
