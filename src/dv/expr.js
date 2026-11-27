'use strict';
/*
 * Expected-value expressions: the small SystemVerilog expression language used in dvflow.json → behavior.checks
 * ("sum_real": "a_real + b_real") and by the expression-based templates (ALU, mux, comparator, ...).
 *
 *   parse(text)                         -> AST (throws ExprError with a column)
 *   check(text, scope)                  -> { ok, errors[], warnings[], width, ast }   names, widths, syntax
 *   toSV(ast, scope)                    -> SystemVerilog for the testbench (input ports -> in_<port>, parameters -> values)
 *   toPy(ast, scope)                    -> Python for cocotb (inputs -> v["port"]; SV widths emulated with masks)
 *   evaluate(ast, scope, values)        -> BigInt | null (null = X, e.g. divide by zero) — previews and tests
 *
 * scope = { inputs: {name: width}, vars: {name: width}, params: {name: value}, funcs: {name: width}, outWidth }
 * Supported: numbers (12, 8'hFF, 'b1010, '0, '1, 4'd3), identifiers, ( ), ?:, || && | ^ ~^ & == != === !== < <= > >=,
 * << >> <<< >>>, + - * / %, unary ! ~ - + and reductions & | ^ ~& ~| ~^, [i] [h:l], {a, b}, {n{a}}, $signed, $unsigned,
 * $countones, and functions provided by a template (e.g. crc).
 * Widths follow SV rules: context-determined operands are evaluated at the widest width in the expression
 * (including the output), so (a + b) >> 1 loses the carry exactly like the RTL would.
 */

class ExprError extends Error { constructor(msg, pos) { super(msg); this.pos = pos; } }

/* ---------------------------------------------------------------- lexer */
const OPS = ['<<<', '>>>', '===', '!==', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '~&', '~|', '~^', '^~', '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '?', ':', '(', ')', '[', ']', '{', '}', ','];
function lex(s) {
  const t = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (s.startsWith('//', i)) break;
    if (s.startsWith('/*', i)) { const e = s.indexOf('*/', i + 2); if (e < 0) throw new ExprError('unclosed comment', i); i = e + 2; continue; }
    // numbers: 12  8'hFF  'b1010  '0  4'sd3
    let m = /^(\d[\d_]*)?'(s?)([bodhBODH])([0-9a-fA-FxXzZ_?]+)/.exec(s.slice(i)) || /^'([01xXzZ])(?![\w])/.exec(s.slice(i)) || /^\d[\d_]*/.exec(s.slice(i));
    if (m) {
      const txt = m[0];
      let width = null, value, xz = false;
      if (/^'[01xXzZ]$/.test(txt)) { value = txt[1] === '1' ? 'fill1' : 0n; xz = /[xXzZ]/.test(txt); width = 'fill'; }
      else if (txt.includes("'")) {
        width = m[1] ? Number(m[1].replace(/_/g, '')) : 32;
        const base = { b: 2, o: 8, d: 10, h: 16 }[m[3].toLowerCase()];
        const digits = m[4].replace(/_/g, '');
        if (/[xXzZ?]/.test(digits)) { xz = true; value = 0n; }
        else value = BigInt(base === 10 ? digits : (base === 16 ? '0x' : base === 8 ? '0o' : '0b') + digits);
        if (width <= 0) throw new ExprError(`bad size in ${txt}`, i);
        value &= (1n << BigInt(width)) - 1n;
      } else { value = BigInt(txt.replace(/_/g, '')); width = null; }
      t.push({ k: 'num', v: value, w: width, xz, s: txt, p: i });
      i += txt.length; continue;
    }
    m = /^\$?[A-Za-z_][A-Za-z0-9_$]*/.exec(s.slice(i));
    if (m) { t.push({ k: 'id', v: m[0], p: i }); i += m[0].length; continue; }
    const op = OPS.find(o => s.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected character '${c}'`, i);
    t.push({ k: 'op', v: op === '^~' ? '~^' : op, p: i }); i += op.length;
  }
  t.push({ k: 'end', p: s.length });
  return t;
}

/* ---------------------------------------------------------------- parser */
const BIN = [['||'], ['&&'], ['|'], ['^', '~^'], ['&'], ['==', '!=', '===', '!=='], ['<', '<=', '>', '>='], ['<<', '>>', '<<<', '>>>'], ['+', '-'], ['*', '/', '%']];
function parse(text) {
  const t = lex(String(text));
  let k = 0;
  const peek = () => t[k];
  const is = v => t[k].k === 'op' && t[k].v === v;
  const eat = v => { if (!is(v)) throw new ExprError(`expected '${v}'${t[k].k === 'end' ? ' before the end' : ` at '${t[k].v}'`}`, t[k].p); return t[k++]; };
  function expr() {
    const c = bin(0);
    if (is('?')) { const p = t[k].p; k++; const a = expr(); eat(':'); const b = expr(); return { t: 'cond', c, a, b, p }; }
    return c;
  }
  function bin(lv) {
    if (lv >= BIN.length) return unary();
    let l = bin(lv + 1);
    while (t[k].k === 'op' && BIN[lv].includes(t[k].v)) { const op = t[k].v, p = t[k].p; k++; l = { t: 'bin', op, l, r: bin(lv + 1), p }; }
    return l;
  }
  function unary() {
    if (t[k].k === 'op' && ['!', '~', '-', '+', '&', '|', '^', '~&', '~|', '~^'].includes(t[k].v)) { const op = t[k].v, p = t[k].p; k++; return { t: 'un', op, x: unary(), p }; }
    return postfix();
  }
  function postfix() {
    let n = primary();
    while (is('[')) {
      const p = t[k].p; k++;
      const h = expr();
      if (is(':')) { k++; const l = expr(); eat(']'); n = { t: 'part', x: n, h, l, p }; }
      else { eat(']'); n = { t: 'bit', x: n, i: h, p }; }
    }
    return n;
  }
  function primary() {
    const c = peek();
    if (c.k === 'num') { k++; return { t: 'num', v: c.v, w: c.w, xz: c.xz, s: c.s, p: c.p }; }
    if (c.k === 'id') {
      k++;
      if (is('(')) { k++; const args = []; if (!is(')')) { args.push(expr()); while (is(',')) { k++; args.push(expr()); } } eat(')'); return { t: 'call', f: c.v, args, p: c.p }; }
      if (c.v.startsWith('$')) throw new ExprError(`${c.v} needs ( )`, c.p);
      return { t: 'id', v: c.v, p: c.p };
    }
    if (is('(')) { k++; const e = expr(); eat(')'); return e; }
    if (is('{')) {
      const p = c.p; k++;
      const first = expr();
      if (is('{')) { k++; const items = [expr()]; while (is(',')) { k++; items.push(expr()); } eat('}'); eat('}'); return { t: 'rep', n: first, items, p }; }
      const items = [first];
      while (is(',')) { k++; items.push(expr()); }
      eat('}');
      return { t: 'cat', items, p };
    }
    throw new ExprError(c.k === 'end' ? 'expression ends too early' : `unexpected '${c.v}'`, c.p);
  }
  const e = expr();
  if (t[k].k !== 'end') throw new ExprError(`unexpected '${t[k].v}' after the expression`, t[k].p);
  return e;
}

/* ---------------------------------------------------------------- names and constants */
const BUILTIN = { $signed: 'same', $unsigned: 'same', $countones: 32, $clog2: 32 };
function resolveName(n, scope) {
  const v = n.v;
  const bare = v.startsWith('in_') && scope.inputs && scope.inputs[v.slice(3)] != null && scope.inputs[v] == null ? v.slice(3) : v;   // in_a and a both mean input a
  if (scope.inputs && scope.inputs[bare] != null) return { kind: 'in', name: bare, w: scope.inputs[bare] };
  if (scope.vars && scope.vars[v] != null) return { kind: 'var', name: v, w: scope.vars[v] };
  if (scope.params && scope.params[v] != null) return { kind: 'param', name: v, value: BigInt(scope.params[v]), w: 32 };
  return null;
}
function constValue(n, scope) {
  if (n.t === 'num' && !n.xz && n.w !== 'fill') return n.v;
  if (n.t === 'id') { const r = resolveName(n, scope); if (r && r.kind === 'param') return r.value; return null; }
  if (n.t === 'bin' && ['+', '-', '*'].includes(n.op)) { const a = constValue(n.l, scope), b = constValue(n.r, scope); if (a == null || b == null) return null; return n.op === '+' ? a + b : n.op === '-' ? a - b : a * b; }
  if (n.t === 'call' && n.f === '$clog2') { const a = constValue(n.args[0], scope); if (a == null) return null; let r = 0n; while ((1n << r) < a) r++; return r; }
  return null;
}

/* ---------------------------------------------------------------- widths (IEEE 1800 §11.6) */
const CTX_BIN = ['+', '-', '*', '/', '%', '&', '|', '^', '~^'];
const CMP = ['==', '!=', '===', '!==', '<', '<=', '>', '>='];
function selfW(n, scope) {
  switch (n.t) {
    case 'num': return n.w === 'fill' ? 1 : n.w || 32;
    case 'id': { const r = resolveName(n, scope); return r ? r.w : 1; }
    case 'bit': return 1;
    case 'part': { const h = constValue(n.h, scope), l = constValue(n.l, scope); return h != null && l != null ? Number(h - l) + 1 : 1; }
    case 'cat': return n.items.reduce((s, x) => s + selfW(x, scope), 0);
    case 'rep': { const c = constValue(n.n, scope); return Number(c || 1n) * n.items.reduce((s, x) => s + selfW(x, scope), 0); }
    case 'cond': return Math.max(selfW(n.a, scope), selfW(n.b, scope));
    case 'un': return ['!', '&', '|', '^', '~&', '~|', '~^'].includes(n.op) ? 1 : selfW(n.x, scope);
    case 'bin': if (CMP.includes(n.op) || n.op === '&&' || n.op === '||') return 1; if (['<<', '>>', '<<<', '>>>'].includes(n.op)) return selfW(n.l, scope); return Math.max(selfW(n.l, scope), selfW(n.r, scope));
    case 'call': if (n.f === '$signed' || n.f === '$unsigned') return selfW(n.args[0], scope); if (n.f === '$countones' || n.f === '$clog2') return 32; return (scope.funcs && scope.funcs[n.f]) || 32;
  }
  return 32;
}
/** annotate n.w (evaluation width) top-down: context-determined operands take the widest width */
function size(n, ctx, scope) {
  switch (n.t) {
    case 'num': n.w2 = n.w === 'fill' ? ctx : Math.max(selfW(n, scope), ctx); break;
    case 'id': n.w2 = Math.max(selfW(n, scope), ctx); break;
    case 'bit': size(n.x, selfW(n.x, scope), scope); size(n.i, selfW(n.i, scope), scope); n.w2 = Math.max(1, ctx); break;
    case 'part': size(n.x, selfW(n.x, scope), scope); n.w2 = Math.max(selfW(n, scope), ctx); break;
    case 'cat': n.items.forEach(x => size(x, selfW(x, scope), scope)); n.w2 = Math.max(selfW(n, scope), ctx); break;
    case 'rep': n.items.forEach(x => size(x, selfW(x, scope), scope)); n.w2 = Math.max(selfW(n, scope), ctx); break;
    case 'cond': size(n.c, selfW(n.c, scope), scope); n.w2 = Math.max(selfW(n, scope), ctx); size(n.a, n.w2, scope); size(n.b, n.w2, scope); break;
    case 'un':
      if (['!', '&', '|', '^', '~&', '~|', '~^'].includes(n.op)) { size(n.x, selfW(n.x, scope), scope); n.w2 = Math.max(1, ctx); }
      else { n.w2 = Math.max(selfW(n, scope), ctx); size(n.x, n.w2, scope); }
      break;
    case 'bin':
      if (CMP.includes(n.op)) { const w = Math.max(selfW(n.l, scope), selfW(n.r, scope)); size(n.l, w, scope); size(n.r, w, scope); n.w2 = Math.max(1, ctx); }
      else if (n.op === '&&' || n.op === '||') { size(n.l, selfW(n.l, scope), scope); size(n.r, selfW(n.r, scope), scope); n.w2 = Math.max(1, ctx); }
      else if (['<<', '>>', '<<<', '>>>'].includes(n.op)) { n.w2 = Math.max(selfW(n.l, scope), ctx); size(n.l, n.w2, scope); size(n.r, selfW(n.r, scope), scope); }
      else {
        n.w2 = Math.max(selfW(n, scope), ctx); size(n.l, n.w2, scope); size(n.r, n.w2, scope);
        // SV: an arithmetic/bitwise expression is signed only when both operands are signed; then $signed operands sign-extend
        const both = isSigned(n.l) && isSigned(n.r);
        if (isSigned(n.l)) n.l.sext = both;
        if (isSigned(n.r)) n.r.sext = both;
      }
      break;
    case 'call':
      if (n.f === '$signed' || n.f === '$unsigned') { n.w2 = Math.max(selfW(n, scope), ctx); size(n.args[0], selfW(n.args[0], scope), scope); }
      else { n.args.forEach(a => size(a, selfW(a, scope), scope)); n.w2 = Math.max(selfW(n, scope), ctx); }
      break;
  }
  return n;
}
const isSigned = n => n.t === 'call' && n.f === '$signed';

/* ---------------------------------------------------------------- check */
function walk(n, f) { f(n); for (const k of ['c', 'a', 'b', 'l', 'r', 'x', 'h', 'i', 'n']) if (n[k] && typeof n[k] === 'object' && n[k].t) walk(n[k], f); for (const k of ['items', 'args']) if (n[k]) n[k].forEach(x => walk(x, f)); }
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function check(text, scope) {
  const errors = [], warnings = [];
  let ast = null;
  if (!String(text || '').trim()) return { ok: false, errors: ['empty: write the expected value'], warnings, ast };
  try { ast = parse(text); } catch (e) { return { ok: false, errors: [`${e.message}${e.pos != null ? ` (column ${e.pos + 1})` : ''}`], warnings, ast: null }; }
  const known = [...Object.keys(scope.inputs || {}), ...Object.keys(scope.vars || {}), ...Object.keys(scope.params || {})];
  walk(ast, n => {
    if (n.t === 'id' && !resolveName(n, scope)) {
      const best = known.map(k => [k, lev(n.v.toLowerCase(), k.toLowerCase())]).sort((a, b) => a[1] - b[1])[0];
      const isOut = scope.outputs && scope.outputs[n.v] != null;
      errors.push(isOut ? `'${n.v}' is an output: the expected value can only use inputs${Object.keys(scope.vars || {}).length ? ', model variables' : ''} and parameters`
        : `unknown name '${n.v}'${best && best[1] <= 3 ? ` (did you mean '${best[0]}'?)` : ''}. Inputs: ${Object.keys(scope.inputs || {}).join(', ') || 'none'}`);
    }
    if (n.t === 'call' && !BUILTIN[n.f] && !(scope.funcs && scope.funcs[n.f])) errors.push(`unknown function '${n.f}'`);
    if (n.t === 'part' && (constValue(n.h, scope) == null || constValue(n.l, scope) == null)) errors.push('a part select [h:l] needs constant bounds');
    if (n.t === 'rep' && constValue(n.n, scope) == null) errors.push('a replication {n{...}} needs a constant count');
    if (n.t === 'num' && n.xz) warnings.push(`${n.s} contains x/z: compared with !== it only matches x/z outputs`);
  });
  const w = errors.length ? null : selfW(ast, scope);
  if (!errors.length && scope.outWidth && w > scope.outWidth) {
    const hasAdd = (() => { let a = false; walk(ast, n => { if (n.t === 'bin' && ['+', '*', '<<'].includes(n.op)) a = true; }); return a; })();
    if (!hasAdd) warnings.push(`the expression is ${w} bits wide and the output ${scope.outWidth}: the upper bits are dropped`);
  }
  return { ok: !errors.length, errors, warnings, width: w, ast };
}

/* ---------------------------------------------------------------- SystemVerilog */
function toSV(ast, scope) {
  const P = n => {
    switch (n.t) {
      case 'num': return n.s;
      case 'id': { const r = resolveName(n, scope); if (!r) return n.v; return r.kind === 'in' ? 'in_' + r.name : r.kind === 'param' ? `32'd${r.value}` : r.name; }
      case 'bit': return `${P(n.x)}[${P(n.i)}]`;
      case 'part': return `${P(n.x)}[${P(n.h)}:${P(n.l)}]`;
      case 'cat': return `{${n.items.map(P).join(', ')}}`;
      case 'rep': return `{${P(n.n)}{${n.items.map(P).join(', ')}}}`;
      case 'cond': return `(${P(n.c)} ? ${P(n.a)} : ${P(n.b)})`;
      case 'un': return `(${n.op}${P(n.x)})`;
      case 'bin': return `(${P(n.l)} ${n.op} ${P(n.r)})`;
      case 'call': return `${n.f}(${n.args.map(P).join(', ')})`;
    }
    return '';
  };
  return P(ast);
}

/* ---------------------------------------------------------------- Python (cocotb) */
/** helper functions the generated Python uses */
const PY_HELPERS = `
def _m(x, w):
    return x & ((1 << w) - 1)


def _s(x, w):
    x = _m(x, w)
    return x - (1 << w) if (x >> (w - 1)) & 1 else x


def _div(a, b):
    return None if b == 0 else a // b


def _mod(a, b):
    return None if b == 0 else a % b


def _x(*vals):
    return any(v is None for v in vals)
`;
function toPy(ast, scope, outW) {
  size(ast, outW || selfW(ast, scope), scope);
  const P = n => {
    const w = n.w2;
    switch (n.t) {
      case 'num': return n.w === 'fill' ? (n.v === 'fill1' ? `${(1n << BigInt(w)) - 1n}` : '0') : String(n.v);
      case 'id': { const r = resolveName(n, scope); if (!r) return '0'; return r.kind === 'in' ? `v[${JSON.stringify(r.name)}]` : r.kind === 'param' ? String(r.value) : `m[${JSON.stringify(r.name)}]`; }
      case 'bit': return `((${P(n.x)} >> ${P(n.i)}) & 1)`;
      case 'part': return `((${P(n.x)} >> ${P(n.l)}) & ${(1n << BigInt(selfW(n, scope))) - 1n})`;
      case 'cat': { let off = 0; const parts = []; for (let i = n.items.length - 1; i >= 0; i--) { const it = n.items[i]; const iw = selfW(it, scope); parts.push(off ? `(_m(${P(it)}, ${iw}) << ${off})` : `_m(${P(it)}, ${iw})`); off += iw; } return `(${parts.join(' | ')})`; }
      case 'rep': { const c = Number(constValue(n.n, scope)); const inner = { t: 'cat', items: n.items }; const iw = selfW(inner, scope); size(inner, iw, scope); const x = P(inner); return `(${Array.from({ length: c }, (_, j) => j ? `(${x} << ${j * iw})` : x).join(' | ')})`; }
      case 'cond': return `(${P(n.a)} if ${P(n.c)} else ${P(n.b)})`;
      case 'un': {
        const x = P(n.x), xw = n.x.w2;
        switch (n.op) {
          case '!': return `int(${x} == 0)`;
          case '~': return `_m(~${x}, ${w})`;
          case '-': return `_m(-${x}, ${w})`;
          case '+': return x;
          case '&': return `int(_m(${x}, ${xw}) == ${(1n << BigInt(xw)) - 1n})`;
          case '|': return `int(${x} != 0)`;
          case '^': return `(bin(_m(${x}, ${xw})).count("1") & 1)`;
          case '~&': return `int(_m(${x}, ${xw}) != ${(1n << BigInt(xw)) - 1n})`;
          case '~|': return `int(${x} == 0)`;
          case '~^': return `(1 - (bin(_m(${x}, ${xw})).count("1") & 1))`;
        }
        break;
      }
      case 'bin': {
        const l = P(n.l), r = P(n.r);
        if (CMP.includes(n.op)) {
          const sw = n.l.w2, sg = isSigned(n.l) && isSigned(n.r);
          const L = sg ? `_s(${l}, ${sw})` : `_m(${l}, ${sw})`, R = sg ? `_s(${r}, ${sw})` : `_m(${r}, ${sw})`;
          const op = n.op === '===' ? '==' : n.op === '!==' ? '!=' : n.op;
          return `int(${L} ${op} ${R})`;
        }
        if (n.op === '&&') return `int(${l} != 0 and ${r} != 0)`;
        if (n.op === '||') return `int(${l} != 0 or ${r} != 0)`;
        if (n.op === '<<' || n.op === '<<<') return `_m(${l} << ${r}, ${w})`;
        if (n.op === '>>') return `(_m(${l}, ${w}) >> ${r})`;
        if (n.op === '>>>') return isSigned(n.l) ? `_m(_s(${l}, ${w}) >> ${r}, ${w})` : `(_m(${l}, ${w}) >> ${r})`;
        if (n.op === '/') return `_m(_div(_m(${l}, ${w}), _m(${r}, ${w})), ${w})`;
        if (n.op === '%') return `_m(_mod(_m(${l}, ${w}), _m(${r}, ${w})), ${w})`;
        if (n.op === '~^') return `_m(~(${l} ^ ${r}), ${w})`;
        return `_m(${l} ${n.op} ${r}, ${w})`;
      }
      case 'call':
        if (n.f === '$signed' && n.sext && w > n.args[0].w2) return `_m(_s(${P(n.args[0])}, ${n.args[0].w2}), ${w})`;
        if (n.f === '$signed' || n.f === '$unsigned') return P(n.args[0]);
        if (n.f === '$countones') return `bin(_m(${P(n.args[0])}, ${n.args[0].w2})).count("1")`;
        if (n.f === '$clog2') return `max(0, (${P(n.args[0])} - 1).bit_length())`;
        return `${n.f}(${n.args.map(P).join(', ')})`;
    }
    return '0';
  };
  let s = P(ast);
  // division by zero gives x in SV: the whole expected value is then unknown (not checked)
  let hasDiv = false; walk(ast, n => { if (n.t === 'bin' && (n.op === '/' || n.op === '%')) hasDiv = true; });
  s = s.replace(/_m\(_div\(/g, '_m0(_div(').replace(/_m\(_mod\(/g, '_m0(_mod(');
  return hasDiv ? `_none_on_x(lambda: ${s})` : s;
}
const PY_HELPERS_X = `

def _m0(x, w):
    if x is None:
        raise ZeroDivisionError
    return _m(x, w)


def _none_on_x(f):
    try:
        return f()
    except ZeroDivisionError:
        return None
`;

/* ---------------------------------------------------------------- evaluate (BigInt; preview + tests) */
function evaluate(ast, scope, values, outW) {
  size(ast, outW || selfW(ast, scope), scope);
  const M = (x, w) => x & ((1n << BigInt(w)) - 1n);
  const S = (x, w) => { x = M(x, w); return (x >> BigInt(w - 1)) & 1n ? x - (1n << BigInt(w)) : x; };
  const pop = x => { let c = 0n; while (x > 0n) { c += x & 1n; x >>= 1n; } return c; };
  const X = Symbol('x');
  const E = n => {
    const w = n.w2;
    switch (n.t) {
      case 'num': return n.w === 'fill' ? (n.v === 'fill1' ? (1n << BigInt(w)) - 1n : 0n) : n.v;
      case 'id': { const r = resolveName(n, scope); if (!r) throw new ExprError(`unknown name '${n.v}'`, n.p); if (r.kind === 'param') return r.value; const v = values[r.name]; if (v == null) throw new ExprError(`no value for '${r.name}'`, n.p); return M(BigInt(v), r.w); }
      case 'bit': { const x = E(n.x), i = E(n.i); if (x === X || i === X) return X; return (x >> i) & 1n; }
      case 'part': { const x = E(n.x); if (x === X) return X; return M(x >> constValue(n.l, scope), selfW(n, scope)); }
      case 'cat': { let r = 0n; for (const it of n.items) { const v = E(it); if (v === X) return X; const iw = selfW(it, scope); r = (r << BigInt(iw)) | M(v, iw); } return r; }
      case 'rep': { const c = Number(constValue(n.n, scope)); const inner = { t: 'cat', items: n.items }; const iw = selfW(inner, scope); size(inner, iw, scope); const v = E(inner); if (v === X) return X; let r = 0n; for (let j = 0; j < c; j++) r = (r << BigInt(iw)) | v; return r; }
      case 'cond': { const c = E(n.c); if (c === X) return X; return c !== 0n ? E(n.a) : E(n.b); }
      case 'un': {
        const x = E(n.x); if (x === X) return X; const xw = n.x.w2;
        switch (n.op) {
          case '!': return x === 0n ? 1n : 0n;
          case '~': return M(~x, w);
          case '-': return M(-x, w);
          case '+': return x;
          case '&': return M(x, xw) === (1n << BigInt(xw)) - 1n ? 1n : 0n;
          case '|': return x !== 0n ? 1n : 0n;
          case '^': return pop(M(x, xw)) & 1n;
          case '~&': return M(x, xw) === (1n << BigInt(xw)) - 1n ? 0n : 1n;
          case '~|': return x === 0n ? 1n : 0n;
          case '~^': return 1n - (pop(M(x, xw)) & 1n);
        }
        break;
      }
      case 'bin': {
        const l = E(n.l), r = E(n.r);
        if (l === X || r === X) return X;
        if (CMP.includes(n.op)) {
          const sw = n.l.w2, sg = isSigned(n.l) && isSigned(n.r);
          const L = sg ? S(l, sw) : M(l, sw), R = sg ? S(r, sw) : M(r, sw);
          const res = { '==': L === R, '===': L === R, '!=': L !== R, '!==': L !== R, '<': L < R, '<=': L <= R, '>': L > R, '>=': L >= R }[n.op];
          return res ? 1n : 0n;
        }
        if (n.op === '&&') return l !== 0n && r !== 0n ? 1n : 0n;
        if (n.op === '||') return l !== 0n || r !== 0n ? 1n : 0n;
        if (n.op === '<<' || n.op === '<<<') return M(l << r, w);
        if (n.op === '>>') return M(l, w) >> r;
        if (n.op === '>>>') return isSigned(n.l) ? M(S(l, w) >> r, w) : M(l, w) >> r;
        if (n.op === '/' || n.op === '%') { const b = M(r, w); if (b === 0n) return X; return M(n.op === '/' ? M(l, w) / b : M(l, w) % b, w); }
        if (n.op === '~^') return M(~(l ^ r), w);
        const v = { '+': l + r, '-': l - r, '*': l * r, '&': l & r, '|': l | r, '^': l ^ r }[n.op];
        return M(v, w);
      }
      case 'call': {
        if (n.f === '$signed' && n.sext && w > n.args[0].w2) { const x = E(n.args[0]); return x === X ? X : M(S(x, n.args[0].w2), w); }
        if (n.f === '$signed' || n.f === '$unsigned') return E(n.args[0]);
        if (n.f === '$countones') { const x = E(n.args[0]); return x === X ? X : pop(M(x, n.args[0].w2)); }
        if (n.f === '$clog2') { const x = E(n.args[0]); if (x === X) return X; let r = 0n; while ((1n << r) < x) r++; return r; }
        const f = scope.jsFuncs && scope.jsFuncs[n.f];
        if (!f) throw new ExprError(`no evaluator for ${n.f}()`, n.p);
        const a = n.args.map(E); if (a.includes(X)) return X;
        return f(...a);
      }
    }
    return 0n;
  };
  const v = E(ast);
  return v === X ? null : (outW ? M(v, outW) : v);
}

module.exports = { ExprError, parse, check, toSV, toPy, evaluate, selfW, PY_HELPERS: PY_HELPERS + PY_HELPERS_X };
