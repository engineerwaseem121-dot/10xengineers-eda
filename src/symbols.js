'use strict';
/* Regex-based outline for Verilog / SystemVerilog / UVM sources. */
const { stripComments, lineIndex } = require('./fsm');

const OPEN = {
  module: 'endmodule', macromodule: 'endmodule', interface: 'endinterface', program: 'endprogram',
  package: 'endpackage', class: 'endclass', covergroup: 'endgroup', function: 'endfunction',
  task: 'endtask', checker: 'endchecker'
};
const CLOSE = new Set(Object.values(OPEN));

function stmtEnd(text, from) {
  let d = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '(') d++;
    else if (c === '}' || c === ')') d--;
    else if (c === ';' && d <= 0) return i;
  }
  return text.length;
}

function documentSymbols(text) {
  const clean = stripComments(text);
  const lineOf = lineIndex(clean);
  const root = { children: [] };
  const stack = [root];
  const re = /\b(module|macromodule|interface|program|package|class|covergroup|function|task|checker|typedef|endmodule|endinterface|endprogram|endpackage|endclass|endgroup|endfunction|endtask|endchecker)\b/g;
  let m;
  while ((m = re.exec(clean))) {
    const kw = m[1];
    if (CLOSE.has(kw)) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (OPEN[stack[k].kw] === kw) { stack[k].endLine = lineOf(m.index); stack.length = k; break; }
      }
      continue;
    }
    const semi = clean.lastIndexOf(';', m.index);
    const prefix = clean.slice(Math.max(semi + 1, m.index - 200), m.index);
    const after = clean.slice(re.lastIndex, re.lastIndex + 400);
    const parent = stack[stack.length - 1];

    if (kw === 'typedef') {
      const e = stmtEnd(clean, re.lastIndex);
      const body = clean.slice(re.lastIndex, e);
      const nm = /([A-Za-z_]\w*)\s*(\[[^\]]*\]\s*)*$/.exec(body.trim());
      if (nm) {
        const kind = /^\s*enum\b/.test(body) ? 'enum' : /^\s*(struct|union)\b/.test(body) ? 'struct' : /^\s*class\b/.test(body) ? 'classfwd' : 'typedef';
        if (kind !== 'classfwd') parent.children.push({ name: nm[1], kind, line: lineOf(m.index), endLine: lineOf(e), children: [], detail: kind });
      }
      re.lastIndex = e;
      continue;
    }
    if (kw === 'interface' && (/\bvirtual\s*$/.test(prefix) || /^\s*class\b/.test(after))) continue;
    if (kw === 'class' && /\btypedef\s*$/.test(prefix)) continue;

    let name = null, detail = '', leaf = false;
    if (kw === 'function' || kw === 'task') {
      const stop = after.search(/[(;]/);
      const header = stop >= 0 ? after.slice(0, stop) : after;
      const nm = /([A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)*)\s*$/.exec(header);
      if (!nm) continue;
      name = nm[1].replace(/\s+/g, '');
      leaf = /\b(extern|pure|import|export)\b/.test(prefix) || /\bmodport\b/.test(prefix);
      if (/\bvirtual\b/.test(prefix)) detail = 'virtual';
    } else {
      const nm = /^\s*(?:(?:automatic|static|virtual)\s+)?([A-Za-z_]\w*)/.exec(after);
      if (!nm) continue;
      name = nm[1];
      if (kw === 'class') {
        const ext = /^[^;]*?\bextends\s+([A-Za-z_][\w:]*)/.exec(after);
        if (ext) detail = 'extends ' + ext[1];
      }
    }
    const sym = { name, kind: kw === 'macromodule' ? 'module' : kw, kw, line: lineOf(m.index), endLine: lineOf(m.index), children: [], detail };
    parent.children.push(sym);
    if (leaf) {
      sym.endLine = lineOf(stmtEnd(clean, re.lastIndex));
    } else {
      stack.push(sym);
    }
  }
  // close anything unterminated at EOF
  const last = lineOf(clean.length);
  for (let k = stack.length - 1; k > 0; k--) if (stack[k].endLine === stack[k].line) stack[k].endLine = last;
  return root.children;
}

function flatDecls(text) {
  const out = [];
  const walk = (syms, container) => syms.forEach(s => {
    out.push({ name: s.name, kind: s.kind, line: s.line, container });
    if (s.name.includes('::')) out.push({ name: s.name.split('::').pop(), kind: s.kind, line: s.line, container: s.name.split('::')[0] });
    walk(s.children, s.name);
  });
  walk(documentSymbols(text), '');
  return out;
}

module.exports = { documentSymbols, flatDecls };
