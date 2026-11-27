'use strict';
/*
 * Language intelligence for Verilog / SystemVerilog / UVM / RISC-V:
 * workspace index, formatter, inlay hints, completion, hovers, references, design + UVM hierarchy views,
 * clickable simulator logs, instance repair, drivers/loads, UVM lint + quick fixes, class graph, UVM tools.
 */
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { stripComments, lineIndex } = require('./fsm');
const hdl = require('./hdlparse');
const uvm = require('./uvm');
const riscv = require('./riscv');

const HDL_GLOB = '**/*.{v,vh,vl,sv,svh,svi}';
const EXCL = '**/{node_modules,.git,out,build,obj_dir,work,regression_runs}/**';
const SEL = [{ language: 'verilog' }, { language: 'systemverilog' }];
const isHdl = d => d && (d.languageId === 'verilog' || d.languageId === 'systemverilog');

const UVM_MACRO_DOC = {
  uvm_component_utils: 'Registers a component with the factory: typedef uvm_component_registry#(T,"T") type_id; static get_type(); virtual get_object_type(); const static string type_name; virtual get_type_name().',
  uvm_object_utils: 'Registers an object with the factory: typedef uvm_object_registry#(T,"T") type_id; get_type(); get_object_type(); create(); get_type_name().',
  uvm_component_param_utils: 'Factory registration for a parameterized component (no type name string; lookup by type only).',
  uvm_object_param_utils: 'Factory registration for a parameterized object (lookup by type only).',
  uvm_object_utils_begin: 'Factory registration + opens field-automation block; follow with `uvm_field_* and close with `uvm_object_utils_end.',
  uvm_component_utils_begin: 'Factory registration + opens field-automation block for a component.',
  uvm_field_int: 'Field automation for an integral member: copy/compare/print/pack/record per flag (UVM_ALL_ON, UVM_NOCOMPARE …).',
  uvm_info: 'if (uvm_report_enabled(VERBOSITY, UVM_INFO, ID)) uvm_report_info(ID, MSG, VERBOSITY, `uvm_file, `uvm_line);',
  uvm_warning: 'if (uvm_report_enabled(UVM_NONE, UVM_WARNING, ID)) uvm_report_warning(ID, MSG, UVM_NONE, `uvm_file, `uvm_line);',
  uvm_error: 'if (uvm_report_enabled(UVM_NONE, UVM_ERROR, ID)) uvm_report_error(ID, MSG, UVM_NONE, `uvm_file, `uvm_line);',
  uvm_fatal: 'if (uvm_report_enabled(UVM_NONE, UVM_FATAL, ID)) uvm_report_fatal(ID, MSG, UVM_NONE, `uvm_file, `uvm_line);',
  uvm_do: 'Creates, randomizes and sends a sequence item / sequence: `uvm_create(SEQ_OR_ITEM); randomize; start_item/finish_item.',
  uvm_do_with: 'Like `uvm_do with inline randomize() with {CONSTRAINTS}.',
  uvm_analysis_imp_decl: 'Declares uvm_analysis_imp_SFX so one component can have several write_SFX() implementations.'
};

function register(context, h) {
  const { cfg, revealLine } = h;
  const sub = d => context.subscriptions.push(d);
  const out = vscode.window.createOutputChannel('10xEngineers EDA UVM');
  sub(out);

  /* ================================================================ workspace index */
  const files = new Map(); // uri -> {text, mods, defines, decls}
  let uvmIdx = null, ready = null;
  function indexText(uri, text) {
    let mods = [];
    try { mods = hdl.parseModules(text); } catch (e) { mods = []; }
    const defines = [];
    const dre = /^[ \t]*`define\s+([A-Za-z_]\w*)(\([^)]*\))?[ \t]*((?:[^\n\\]|\\\r?\n|\\)*)/gm;
    let m;
    while ((m = dre.exec(text))) defines.push({ name: m[1], args: m[2] || '', body: m[3].replace(/\\\r?\n/g, '\n').trim(), line: text.slice(0, m.index).split('\n').length - 1 });
    files.set(uri, { text, mods, defines });
    uvmIdx = null;
  }
  async function ensureIndex() {
    if (!ready) ready = (async () => {
      const found = await vscode.workspace.findFiles(HDL_GLOB, EXCL, 5000);
      await Promise.all(found.map(async u => { try { indexText(u.toString(), Buffer.from(await vscode.workspace.fs.readFile(u)).toString('utf8')); } catch (e) { /* skip */ } }));
    })();
    await ready;
    vscode.workspace.textDocuments.filter(isHdl).forEach(d => indexText(d.uri.toString(), d.getText()));
  }
  function modules() { const m = new Map(); files.forEach((f, u) => f.mods.forEach(x => m.set(x.name, { ...x, uri: u }))); return m; }
  function getUvm() { if (!uvmIdx) uvmIdx = uvm.buildIndex([...files].map(([uri, f]) => ({ uri, text: f.text }))); return uvmIdx; }
  const reindex = d => { if (isHdl(d)) { indexText(d.uri.toString(), d.getText()); refreshViews(); } };
  sub(vscode.workspace.onDidSaveTextDocument(reindex));
  sub(vscode.workspace.onDidOpenTextDocument(reindex));
  let editT;
  sub(vscode.workspace.onDidChangeTextDocument(e => { if (!isHdl(e.document)) return; clearTimeout(editT); editT = setTimeout(() => { indexText(e.document.uri.toString(), e.document.getText()); lintDoc(e.document); }, 500); }));

  /* ================================================================ instantiations */
  function findInstances(text, mods) {
    const clean = stripComments(text);
    const res = [];
    const re = /(^|[;\s)])([A-Za-z_]\w*)\s*(#\s*\()?/g;
    let m;
    while ((m = re.exec(clean))) {
      const type = m[2];
      if (!mods.has(type)) continue;
      let i = re.lastIndex;
      let paramText = null;
      if (m[3]) {
        let d = 1, j = i;
        for (; j < clean.length && d; j++) { if (clean[j] === '(') d++; else if (clean[j] === ')') d--; }
        paramText = clean.slice(i, j - 1);
        i = j;
      }
      const nm = /^\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*\(/.exec(clean.slice(i, i + 200));
      if (!nm) continue;
      const open = i + nm[0].length - 1;
      let d = 0, j = open;
      for (; j < clean.length; j++) { if (clean[j] === '(') d++; else if (clean[j] === ')') { d--; if (!d) break; } }
      res.push({ type, name: nm[1], start: m.index + m[1].length, open, close: j, paramText, connText: clean.slice(open + 1, j), mod: mods.get(type) });
      re.lastIndex = j;
    }
    return res;
  }
  function splitArgs(s) {
    const outA = []; let d = 0, cur = '', start = 0;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
      if (c === ',' && !d) { outA.push({ text: cur, start }); cur = ''; start = k + 1; } else cur += c;
    }
    if (cur.trim()) outA.push({ text: cur, start });
    return outA;
  }

  /* ================================================================ formatter (whitespace only) */
  function formatText(text, opts, range) {
    const unit = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t';
    const lines = text.split(/\r?\n/);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let level = 0, inBlock = false, inDefine = false, inProtected = false, pendingOne = 0, parenDepth = 0;
    const OPEN = /\b(begin|fork|case|casez|casex|randcase|module|macromodule|interface|program|package|class|function|task|covergroup|property|sequence|clocking|generate|config|specify|primitive|checker)\b|`uvm_\w+_begin\b/g;
    const CLOSE = /\b(end|join|join_any|join_none|endcase|endmodule|endinterface|endprogram|endpackage|endclass|endfunction|endtask|endgroup|endproperty|endsequence|endclocking|endgenerate|endconfig|endspecify|endprimitive|endchecker)\b|`uvm_\w+_end\b/g;
    const outL = [];
    for (let i = 0; i < lines.length; i++) {
      const orig = lines[i];
      const t = orig.trim();
      const inRange = !range || (i >= range.start.line && i <= range.end.line);
      if (inProtected || inDefine || inBlock) {
        outL.push(inRange ? orig.replace(/[ \t]+$/, '') : orig);
        if (inBlock && t.includes('*/')) inBlock = false;
        if (inDefine && !/\\$/.test(orig)) inDefine = false;
        if (/`pragma\s+protect\s+end/.test(t) || /`endprotect/.test(t)) inProtected = false;
        continue;
      }
      if (/`pragma\s+protect\s+begin|`protect\b/.test(t)) inProtected = true;
      let code = t.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      const startsBlock = /\/\*/.test(code) && !/\*\//.test(code.slice(code.indexOf('/*')));
      if (startsBlock) code = code.slice(0, code.indexOf('/*'));
      // ignore prototypes / forward declarations / one-line definitions
      code = code.replace(/\b(extern|pure\s+virtual|import\s+"DPI(-C)?"|export\s+"DPI(-C)?")\b[^;]*;/g, '').replace(/\btypedef\s+class\b[^;]*;/g, '').replace(/\bvirtual\s+interface\b/g, '')
        .replace(/\bwait\s+fork\b|\bdisable\s+fork\b/g, '').replace(/\binterface\s+class\b/g, 'class').replace(/\b(assert|assume|cover|restrict|expect)\s+(property|sequence)\b/g, '$1');
      const opens = (code.match(OPEN) || []).length;
      const closes = (code.match(CLOSE) || []).length;
      const leadClose = /^(end|endcase|endmodule|endinterface|endprogram|endpackage|endclass|endfunction|endtask|endgroup|endproperty|endsequence|endclocking|endgenerate|endconfig|endspecify|endprimitive|endchecker|join|join_any|join_none)\b/.test(code) || /^`uvm_\w+_end\b/.test(code);
      let ind = level;
      if (leadClose) ind = Math.max(0, level - 1);
      if (pendingOne && !/^begin\b/.test(code) && t) ind += pendingOne;
      let newLine;
      if (!t) newLine = '';
      else if (!inRange || parenDepth > 0) newLine = orig.replace(/[ \t]+$/, ''); // continuation lines keep hand alignment
      else newLine = unit.repeat(Math.max(0, ind)) + t;
      outL.push(newLine);
      level = Math.max(0, level + opens - closes);
      parenDepth = Math.max(0, parenDepth + (code.match(/\(/g) || []).length - (code.match(/\)/g) || []).length);
      if (t) pendingOne = 0;
      if (parenDepth === 0 && (/^(if|else\s+if|for|foreach|while|repeat|always(_ff|_comb|_latch)?)\b.*\)\s*$/.test(code) || /^(else|forever|initial|final|always_comb|always_latch)\s*$/.test(code) || /\belse\s*$/.test(code))) pendingOne = 1;
      if (/^`define\b/.test(t) && /\\$/.test(orig)) inDefine = true;
      if (startsBlock) inBlock = true;
    }
    let res = outL.join(eol);
    if (cfg().get('format.collapseBlankLines', false)) res = res.replace(new RegExp(`(${eol}[ \\t]*){3,}`, 'g'), eol + eol);
    // safety: whitespace-only change
    if (res.replace(/\s+/g, '') !== text.replace(/\s+/g, '')) return null;
    return res;
  }
  const fmtProvider = {
    provideDocumentFormattingEdits(doc, opts) {
      const t = formatText(doc.getText(), opts);
      if (t == null || t === doc.getText()) return [];
      return [vscode.TextEdit.replace(new vscode.Range(0, 0, doc.lineCount, 0), t + (doc.getText().endsWith('\n') && !t.endsWith('\n') ? '\n' : ''))];
    },
    provideDocumentRangeFormattingEdits(doc, range, opts) {
      const t = formatText(doc.getText(), opts, range);
      if (t == null) return [];
      const nl = t.split(/\r?\n/);
      const edits = [];
      for (let i = range.start.line; i <= Math.min(range.end.line, doc.lineCount - 1); i++) if (nl[i] !== doc.lineAt(i).text) edits.push(vscode.TextEdit.replace(doc.lineAt(i).range, nl[i]));
      return edits;
    }
  };
  sub(vscode.languages.registerDocumentFormattingEditProvider(SEL, fmtProvider));
  sub(vscode.languages.registerDocumentRangeFormattingEditProvider(SEL, fmtProvider));

  /* ================================================================ inlay hints (positional ports / params) */
  if (vscode.languages.registerInlayHintsProvider) {
    sub(vscode.languages.registerInlayHintsProvider(SEL, {
      async provideInlayHints(doc, range) {
        if (!cfg().get('inlayHints.enable', true)) return [];
        await ensureIndex();
        const mods = modules();
        const hints = [];
        for (const inst of findInstances(doc.getText(), mods)) {
          const args = splitArgs(inst.connText);
          if (args.length && !args.some(a => a.text.trim().startsWith('.'))) {
            args.forEach((a, k) => {
              const p = inst.mod.ports[k];
              if (!p) return;
              const lead = a.text.length - a.text.trimStart().length;
              const pos = doc.positionAt(inst.open + 1 + a.start + lead);
              if (range.contains(pos)) { const hh = new vscode.InlayHint(pos, `.${p.name}:`, vscode.InlayHintKind.Parameter); hh.paddingRight = true; hh.tooltip = `${p.dir} ${p.range || ''} ${p.name}`; hints.push(hh); }
            });
          }
          if (inst.paramText != null) {
            const pa = splitArgs(inst.paramText);
            if (pa.length && !pa.some(a => a.text.trim().startsWith('.'))) {
              const pOpen = doc.getText().indexOf('(', inst.start + inst.type.length);
              pa.forEach((a, k) => { const pr = inst.mod.params[k]; if (!pr) return; const lead = a.text.length - a.text.trimStart().length; const hh = new vscode.InlayHint(doc.positionAt(pOpen + 1 + a.start + lead), `${pr.name}:`, vscode.InlayHintKind.Parameter); hh.paddingRight = true; hints.push(hh); });
            }
          }
        }
        return hints;
      }
    }));
  }

  /* ================================================================ completion */
  const UVM_MACROS = Object.keys(UVM_MACRO_DOC).concat(['uvm_field_string', 'uvm_field_enum', 'uvm_field_object', 'uvm_field_array_int', 'uvm_object_utils_end', 'uvm_component_utils_end', 'uvm_create', 'uvm_send', 'uvm_rand_send', 'uvm_declare_p_sequencer']);
  sub(vscode.languages.registerCompletionItemProvider(SEL, {
    async provideCompletionItems(doc, pos) {
      await ensureIndex();
      const line = doc.lineAt(pos.line).text.slice(0, pos.character);
      const items = [];
      // macros after `
      if (/`\w*$/.test(line)) {
        const seen = new Set();
        files.forEach(f => f.defines.forEach(d => { if (seen.has(d.name)) return; seen.add(d.name); const it = new vscode.CompletionItem(d.name, vscode.CompletionItemKind.Constant); it.detail = '`define ' + d.name + d.args; it.documentation = new vscode.MarkdownString('```systemverilog\n' + d.body + '\n```'); items.push(it); }));
        UVM_MACROS.forEach(n => { if (seen.has(n)) return; const it = new vscode.CompletionItem(n, vscode.CompletionItemKind.Snippet); it.detail = 'UVM macro'; it.documentation = UVM_MACRO_DOC[n] || ''; items.push(it); });
        return items;
      }
      // package / class scope items after ::
      const sc = /([A-Za-z_]\w*)\s*::\s*\w*$/.exec(line);
      if (sc) {
        const ux = getUvm();
        const c = ux.classes.get(sc[1]);
        if (c) {
          [sc[1], ...uvm.ancestors(ux, sc[1])].forEach(n => { const k = ux.classes.get(n); if (k) k.methods.forEach(mm => items.push(new vscode.CompletionItem(mm.name, vscode.CompletionItemKind.Method))); });
          ['type_id', 'get_type'].forEach(n => items.push(new vscode.CompletionItem(n, vscode.CompletionItemKind.Property)));
          return items;
        }
        for (const [, f] of files) {
          const re = new RegExp('\\bpackage\\s+' + sc[1] + '\\b([\\s\\S]*?)\\bendpackage');
          const pm = re.exec(stripComments(f.text));
          if (!pm) continue;
          const body = pm[1];
          let r;
          const declRe = /\b(?:parameter|localparam)\s+(?:\w+\s+)?(?:\[[^\]]*\]\s*)?([A-Za-z_]\w*)\s*=|\btypedef\b[^;]*?\b([A-Za-z_]\w*)\s*;|\b(?:function|task)\s+(?:automatic\s+)?(?:[\w\[\]:]+\s+)?([A-Za-z_]\w*)\s*\(|\bclass\s+([A-Za-z_]\w*)/g;
          while ((r = declRe.exec(body))) { const n = r[1] || r[2] || r[3] || r[4]; items.push(new vscode.CompletionItem(n, r[1] ? vscode.CompletionItemKind.Constant : r[2] ? vscode.CompletionItemKind.TypeParameter : r[3] ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Class)); }
          return items;
        }
      }
      // members after var.
      const mem = /([A-Za-z_]\w*)\s*\.\s*\w*$/.exec(line);
      if (mem) {
        const ux = getUvm();
        const text = doc.getText();
        const dm = new RegExp('\\b([A-Za-z_]\\w*)(?:\\s*#\\s*\\([^;]*?\\))?\\s+' + mem[1] + '\\s*[;=,\\[]').exec(stripComments(text));
        const type = dm && dm[1];
        if (type && ux.classes.has(type)) {
          const seen = new Set();
          [type, ...uvm.ancestors(ux, type)].forEach(n => {
            const k = ux.classes.get(n); if (!k) return;
            Object.entries(k.vars).forEach(([v, t]) => { if (seen.has(v)) return; seen.add(v); const it = new vscode.CompletionItem(v, vscode.CompletionItemKind.Field); it.detail = t + ' — ' + n; items.push(it); });
            k.methods.forEach(mm => { if (seen.has(mm.name)) return; seen.add(mm.name); const it = new vscode.CompletionItem(mm.name, vscode.CompletionItemKind.Method); it.detail = mm.kind + ' — ' + n; items.push(it); });
          });
          return items;
        }
        // interface / module instance signals
        const mods = modules();
        const im = new RegExp('\\b([A-Za-z_]\\w*)\\s+(?:#\\s*\\([^)]*\\)\\s*)?' + mem[1] + '\\b').exec(stripComments(text));
        if (im && mods.has(im[1])) { mods.get(im[1]).ports.forEach(p => items.push(new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Field))); return items; }
        const ifm = new RegExp('\\b(?:virtual\\s+)?([A-Za-z_]\\w*)\\s+' + mem[1] + '\\s*[;,(]').exec(stripComments(text));
        if (ifm) {
          for (const [, f] of files) {
            const r = new RegExp('\\binterface\\s+' + ifm[1] + '\\b([\\s\\S]*?)\\bendinterface').exec(stripComments(f.text));
            if (!r) continue;
            const re = /\b(?:logic|wire|reg|bit|int)\b(?:\s*\[[^\]]*\])?\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*;|\b(?:clocking|modport)\s+([A-Za-z_]\w*)|\binput\s+logic\s+([A-Za-z_]\w*)/g;
            let x;
            while ((x = re.exec(r[1]))) (x[1] || x[2] || x[3]).split(',').forEach(n => items.push(new vscode.CompletionItem(n.trim(), x[2] ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Field)));
            return items;
          }
        }
        return undefined;
      }
      // module instantiation in one step
      if (/^\s*[A-Za-z_]\w*$/.test(line)) {
        modules().forEach(m => {
          const it = new vscode.CompletionItem({ label: m.name, description: 'instantiate module' }, vscode.CompletionItemKind.Module);
          const w = Math.max(4, ...m.ports.map(p => p.name.length));
          const params = m.params.length ? ' #(\n' + m.params.map((p, k) => `  .${p.name.padEnd(w)} (\${${k + 1}:${p.value.replace(/[$}]/g, '\\$&')}})`).join(',\n') + '\n)' : '';
          const base = m.params.length + 1;
          it.insertText = new vscode.SnippetString(`${m.name}${params} \${${base}:u_${m.name}} (\n` + m.ports.filter(p => p.dir !== 'interface' || true).map((p, k) => `  .${p.name.padEnd(w)} (\${${base + 1 + k}:${p.name}})`).join(',\n') + '\n);\n');
          it.detail = `${m.ports.length} ports, ${m.params.length} params`;
          it.documentation = new vscode.MarkdownString('```systemverilog\n' + m.ports.map(p => `${p.dir} ${p.range || ''} ${p.name}`.replace(/\s+/g, ' ')).join('\n') + '\n```');
          it.sortText = '0' + m.name;
          items.push(it);
        });
        return items;
      }
      return undefined;
    }
  }, '`', '.', ':'));

  /* ================================================================ hovers: macros, config_db, overrides, signals */
  sub(vscode.languages.registerHoverProvider(SEL, {
    async provideHover(doc, pos) {
      await ensureIndex();
      const lineText = doc.lineAt(pos.line).text;
      const mr = doc.getWordRangeAtPosition(pos, /`[A-Za-z_]\w*/);
      if (mr) {
        const name = doc.getText(mr).slice(1);
        for (const [, f] of files) { const d = f.defines.find(x => x.name === name); if (d) return new vscode.Hover(new vscode.MarkdownString(`**\`define ${name}${d.args}**\n\n\`\`\`systemverilog\n${d.body || '(empty)'}\n\`\`\``), mr); }
        if (UVM_MACRO_DOC[name]) return new vscode.Hover(new vscode.MarkdownString(`**\`${name}** (UVM)\n\n${UVM_MACRO_DOC[name]}`), mr);
      }
      const ux = getUvm();
      if (/uvm_config_db\s*#/.test(lineText)) {
        const mc = uvm.matchConfig(ux);
        const here = (/::\s*get\s*\(/.test(lineText) ? ux.gets : ux.sets).find(x => x.uri === doc.uri.toString() && x.line === pos.line);
        if (here) {
          const isGet = ux.gets.includes(here);
          const list = isGet ? mc.setsForGet(here) : mc.getsForSet(here);
          const md = new vscode.MarkdownString(`**uvm_config_db ${isGet ? 'get' : 'set'}** \`"${here.field}"\` · type \`${here.type}\`\n\n` +
            (list.length ? `${isGet ? 'Provided by' : 'Reaches'} ${list.length} ${isGet ? 'set' : 'get'} call(s):\n\n` + list.map(x => `- [${path.basename(vscode.Uri.parse(x.uri).fsPath)}:${x.line + 1}](${vscode.Uri.parse(x.uri).with({ fragment: 'L' + (x.line + 1) })}) — scope \`${x.cntxt}\` / \`"${x.inst}"\``).join('\n')
              : `⚠ No matching ${isGet ? 'set' : 'get'} found in the workspace (field and type must match).`));
          md.isTrusted = true;
          return new vscode.Hover(md);
        }
      }
      const ov = ux.overrides.find(o => o.uri === doc.uri.toString() && o.line === pos.line);
      if (ov) {
        const affected = [];
        for (const t of uvm.tests(ux)) {
          const walk = n => { if (n.overridden && n.override === ov) affected.push(`${t}: ${n.path} (${n.origType} → ${n.type})`); n.children.forEach(walk); };
          walk(uvm.buildTopology(ux, t));
        }
        return new vscode.Hover(new vscode.MarkdownString(`**Factory ${ov.kind} override** \`${ov.orig}\` → \`${ov.override}\`${ov.kind === 'inst' ? ` at \`${ov.path}\`` : ''}\n\n` + (affected.length ? 'Changes these components in the modeled build:\n\n' + affected.map(a => '- ' + a).join('\n') : `No component of type \`${ov.orig}\` is created in the modeled build of the tests that declare it (objects such as sequences/items are overridden when created).`)));
      }
      return undefined;
    }
  }));

  /* ================================================================ references */
  sub(vscode.languages.registerReferenceProvider(SEL, {
    async provideReferences(doc, pos) {
      const r = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
      if (!r) return [];
      await ensureIndex();
      const word = doc.getText(r);
      const re = new RegExp('\\b' + word + '\\b', 'g');
      const locs = [];
      files.forEach((f, u) => {
        const clean = stripComments(f.text);
        const lineOf = lineIndex(clean);
        let m;
        while ((m = re.exec(clean))) { const l = lineOf(m.index); const col = m.index - clean.lastIndexOf('\n', m.index - 1) - 1; locs.push(new vscode.Location(vscode.Uri.parse(u), new vscode.Range(l, col, l, col + word.length))); }
      });
      return locs;
    }
  }));

  /* ================================================================ drivers / loads / assertion+coverage users */
  async function signalUses(kind) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const r = ed.document.getWordRangeAtPosition(ed.selection.active, /[A-Za-z_]\w*/);
    if (!r) return;
    await ensureIndex();
    const sig = ed.document.getText(r);
    const mods = modules();
    const locs = [];
    const add = (u, clean, idx, len) => { const lineOf = lineIndex(clean); const l = lineOf(idx); const col = idx - clean.lastIndexOf('\n', idx - 1) - 1; locs.push(new vscode.Location(vscode.Uri.parse(u), new vscode.Range(l, col, l, col + len))); };
    files.forEach((f, u) => {
      const clean = stripComments(f.text);
      if (!new RegExp('\\b' + sig + '\\b').test(clean)) return;
      if (kind === 'drivers') {
        let m;
        const asg = new RegExp('(\\bassign\\s+|\\bforce\\s+|^|[;\\s(])(' + sig + ')\\b\\s*(?:\\[[^\\]]*\\])?\\s*(<=|=)(?!=)', 'gm');
        while ((m = asg.exec(clean))) add(u, clean, m.index + m[1].length, sig.length);
        for (const inst of findInstances(f.text, mods)) {
          splitArgs(inst.connText).forEach(a => { const nm = /^\s*\.(\w+)\s*\(\s*([^)]*)\)/.exec(a.text); if (nm && new RegExp('\\b' + sig + '\\b').test(nm[2])) { const p = inst.mod.ports.find(x => x.name === nm[1]); if (p && (p.dir === 'output' || p.dir === 'inout')) add(u, clean, inst.open + 1 + a.start + a.text.indexOf(sig), sig.length); } });
        }
      } else if (kind === 'loads') {
        const re = new RegExp('\\b' + sig + '\\b', 'g');
        let m;
        while ((m = re.exec(clean))) {
          const after = clean.slice(m.index + sig.length, m.index + sig.length + 40);
          const lineStart = clean.lastIndexOf('\n', m.index) + 1;
          const before = clean.slice(lineStart, m.index);
          if (/^\s*(?:\[[^\]]*\])?\s*(<=|=)(?!=)/.test(after) && !/[=<>!]\s*$/.test(before) && !/\(\s*$/.test(before)) continue; // lhs
          if (/\b(input|output|inout|logic|wire|reg|bit)\b[^;]*$/.test(before) && /^\s*[,;)=\[]/.test(after)) continue; // declaration
          add(u, clean, m.index, sig.length);
        }
      } else {
        const re = /\b(assert|assume|cover|restrict)\s+property\b[\s\S]*?;|\bproperty\s+\w+[\s\S]*?\bendproperty\b|\bsequence\s+\w+[\s\S]*?\bendsequence\b|\bcoverpoint\b[^;{]*|\bcovergroup\b[^;]*;|\.sample\s*\([^)]*\)/g;
        let m;
        while ((m = re.exec(clean))) { const k = m[0].search(new RegExp('\\b' + sig + '\\b')); if (k >= 0) add(u, clean, m.index + k, sig.length); }
      }
    });
    if (!locs.length) { vscode.window.showInformationMessage(`No ${kind === 'drivers' ? 'drivers' : kind === 'loads' ? 'loads' : 'assertions / covers / coverpoints'} of '${sig}' found.`); return; }
    vscode.commands.executeCommand('editor.action.showReferences', ed.document.uri, ed.selection.active, locs);
  }

  /* ================================================================ instance repair code actions */
  sub(vscode.languages.registerCodeActionsProvider(SEL, {
    async provideCodeActions(doc, range, ctx) {
      const actions = [];
      // UVM lint fixes
      for (const d of ctx.diagnostics.filter(x => x.source === '10x UVM lint' && x._fix)) {
        const f = d._fix;
        const a = new vscode.CodeAction(f.title, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [d]; a.isPreferred = true;
        a.edit = new vscode.WorkspaceEdit();
        if (f.insertLine != null) a.edit.insert(doc.uri, new vscode.Position(Math.min(f.insertLine, doc.lineCount), 0), f.text);
        else if (f.whole) a.edit.replace(doc.uri, doc.lineAt(f.replaceLine).range, f.replace);
        else { const lt = doc.lineAt(f.replaceLine).text; const k = lt.indexOf(f.find); if (k >= 0) a.edit.replace(doc.uri, new vscode.Range(f.replaceLine, k, f.replaceLine, k + f.find.length), f.replace); }
        actions.push(a);
        const w = new vscode.CodeAction(`Waive ${d.code} on this line`, vscode.CodeActionKind.QuickFix);
        w.diagnostics = [d];
        w.edit = new vscode.WorkspaceEdit();
        w.edit.insert(doc.uri, doc.lineAt(d.range.start.line).range.end, ` // 10x-waive ${d.code}`);
        actions.push(w);
      }
      // instance repair
      await ensureIndex();
      const off = doc.offsetAt(range.start);
      const inst = findInstances(doc.getText(), modules()).find(x => x.start <= off && off <= x.close + 1);
      if (!inst) return actions;
      const args = splitArgs(inst.connText);
      const named = args.filter(a => /^\s*\./.test(a.text));
      const ports = inst.mod.ports.filter(p => p.dir !== 'interface' || true);
      const indent = (doc.lineAt(doc.positionAt(inst.start).line).text.match(/^\s*/) || [''])[0] + '  ';
      const w = Math.max(4, ...ports.map(p => p.name.length));
      const connRange = new vscode.Range(doc.positionAt(inst.open + 1), doc.positionAt(inst.close));
      const mk = (title, text) => { const a = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorRewrite); a.edit = new vscode.WorkspaceEdit(); a.edit.replace(doc.uri, connRange, text); actions.push(a); };
      if (args.length && !named.length) {
        mk(`Convert ${args.length} ordered connection(s) to named`, '\n' + args.map((a, k) => `${indent}.${(ports[k] ? ports[k].name : 'UNKNOWN_' + k).padEnd(w)} (${a.text.trim()})`).join(',\n') + '\n' + indent.slice(2));
      }
      if (named.length || !args.length) {
        const conn = new Map();
        let star = false;
        named.forEach(a => { const m = /^\s*\.(\w+)\s*(?:\(([\s\S]*)\))?\s*$/.exec(a.text); if (m) conn.set(m[1], m[2] == null ? m[1] : m[2].trim()); });
        args.forEach(a => { if (/^\s*\.\*\s*$/.test(a.text)) star = true; });
        const missing = ports.filter(p => !conn.has(p.name));
        const dup = named.map(a => (/^\s*\.(\w+)/.exec(a.text) || [])[1]).filter((n, k, arr) => n && arr.indexOf(n) !== k);
        const unknown = [...conn.keys()].filter(n => !ports.some(p => p.name === n));
        if (missing.length && !star) mk(`Connect ${missing.length} missing port(s) of ${inst.type}`, '\n' + [...ports.filter(p => conn.has(p.name)).map(p => `${indent}.${p.name.padEnd(w)} (${conn.get(p.name)})`), ...missing.map(p => `${indent}.${p.name.padEnd(w)} (${p.name})`)].join(',\n') + '\n' + indent.slice(2));
        if (star) mk('Expand .* into named connections', '\n' + ports.map(p => `${indent}.${p.name.padEnd(w)} (${conn.has(p.name) ? conn.get(p.name) : p.name})`).join(',\n') + '\n' + indent.slice(2));
        if (dup.length || unknown.length) {
          const a = new vscode.CodeAction(`⚠ ${dup.length ? 'Connected twice: ' + dup.join(', ') + ' ' : ''}${unknown.length ? 'Not a port of ' + inst.type + ': ' + unknown.join(', ') : ''}`, vscode.CodeActionKind.Empty);
          actions.push(a);
        }
      }
      return actions;
    }
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] }));

  /* ================================================================ UVM lint diagnostics */
  const lintColl = vscode.languages.createDiagnosticCollection('10x-uvm-lint');
  sub(lintColl);
  async function lintDoc(doc) {
    if (!isHdl(doc) || !cfg().get('uvmLint.enable', true)) { lintColl.delete(doc.uri); return; }
    const text = doc.getText();
    if (!/\buvm_|\bextends\b/.test(text)) { lintColl.delete(doc.uri); return; }
    await ensureIndex();
    let issues = [];
    try { issues = uvm.lint(text, getUvm()); } catch (e) { issues = []; }
    const lines = text.split('\n');
    lintColl.set(doc.uri, issues.filter(i => i.line >= 0 && !new RegExp('10x-waive\\s+' + i.rule).test(lines[i.line] || '')).map(i => {
      const d = new vscode.Diagnostic(new vscode.Range(i.line, i.col, i.line, Math.max(i.col + 1, i.endCol)), i.message,
        i.severity === 'error' ? vscode.DiagnosticSeverity.Error : i.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      d.source = '10x UVM lint'; d.code = i.rule; d._fix = i.fix;
      return d;
    }));
  }
  sub(vscode.workspace.onDidOpenTextDocument(lintDoc));
  sub(vscode.workspace.onDidSaveTextDocument(lintDoc));
  vscode.workspace.textDocuments.forEach(lintDoc);

  /* ================================================================ design hierarchy view */
  class DesignTree {
    constructor() { this._em = new vscode.EventEmitter(); this.onDidChangeTreeData = this._em.event; this.filter = ''; }
    refresh() { this._em.fire(); }
    getTreeItem(e) { return e; }
    async getChildren(el) {
      await ensureIndex();
      const mods = modules();
      const instOf = new Map();
      mods.forEach((m) => { const f = files.get(m.uri); instOf.set(m.name, f ? findInstances(f.text, mods).filter(i => { const c = stripComments(f.text); const ms = c.lastIndexOf('module ' + m.name, i.start); return ms >= 0 && c.indexOf('endmodule', ms) > i.start; }) : []); });
      const mk = (label, modName, inst, depth, pathStr) => {
        const m = mods.get(modName);
        const kids = instOf.get(modName) || [];
        const it = new vscode.TreeItem(label, kids.length && depth < 30 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        it.description = inst ? modName + (inst.paramText ? ' #(' + inst.paramText.replace(/\s+/g, ' ').trim() + ')' : '') : 'top';
        it.iconPath = new vscode.ThemeIcon(inst ? 'symbol-module' : 'circuit-board');
        it.tooltip = `${pathStr}\n${m ? m.ports.length + ' ports · params: ' + (m.params.map(p => p.name + '=' + p.value).join(', ') || '—') : ''}`;
        if (m) it.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.parse(m.uri), { selection: new vscode.Range(0, 0, 0, 0) }] };
        it._mod = modName; it._depth = depth; it._path = pathStr;
        return it;
      };
      if (!el) {
        const instantiated = new Set();
        instOf.forEach(list => list.forEach(i => instantiated.add(i.type)));
        let tops = [...mods.keys()].filter(n => !instantiated.has(n)).sort();
        if (this.filter) tops = [...mods.keys()].filter(n => n.toLowerCase().includes(this.filter.toLowerCase()));
        return tops.map(t => mk(t, t, null, 0, t));
      }
      return (instOf.get(el._mod) || []).map(i => mk(i.name, i.type, i, el._depth + 1, el._path + '.' + i.name));
    }
  }
  const designTree = new DesignTree();
  sub(vscode.window.registerTreeDataProvider('tenxDebug.designHierarchy', designTree));

  /* ================================================================ UVM hierarchy view */
  class UvmTree {
    constructor() { this._em = new vscode.EventEmitter(); this.onDidChangeTreeData = this._em.event; this.filter = ''; }
    refresh() { this._em.fire(); }
    getTreeItem(e) { return e; }
    async getChildren(el) {
      await ensureIndex();
      const ux = getUvm();
      const T = vscode.TreeItemCollapsibleState;
      const open = (uri, line) => ({ command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.parse(uri), { selection: new vscode.Range(line, 0, line, 0) }] });
      const node = n => {
        const kids = n.children.length + (n.connects.length ? 1 : 0) + (n.ports.length ? 1 : 0);
        const it = new vscode.TreeItem(n.inst, kids ? T.Collapsed : T.None);
        it.description = n.type + (n.overridden ? `  (override of ${n.origType})` : '');
        it.iconPath = new vscode.ThemeIcon(n.kind === 'test' ? 'beaker' : n.overridden ? 'replace' : 'symbol-class', n.overridden ? new vscode.ThemeColor('charts.orange') : undefined);
        it.tooltip = n.path;
        if (n.cls) it.command = open(n.cls.uri, n.cls.line);
        it._node = n;
        return it;
      };
      if (!el) {
        const roots = [];
        const ts = uvm.tests(ux).filter(t => !this.filter || t.toLowerCase().includes(this.filter.toLowerCase()));
        ts.forEach(t => { const it = node(uvm.buildTopology(ux, t)); it.label = t; it.collapsibleState = T.Collapsed; it.contextValue = 'uvmTest'; it._test = t; roots.push(it); });
        const s = (label, k, icon, n) => { const it = new vscode.TreeItem(label, T.Collapsed); it._sec = k; it.iconPath = new vscode.ThemeIcon(icon); it.description = String(n); return it; };
        roots.push(s('uvm_config_db', 'cfg', 'settings-gear', new Set([...ux.sets, ...ux.gets].map(x => x.field)).size + ' fields'));
        roots.push(s('Factory overrides', 'ovr', 'replace-all', ux.overrides.length));
        roots.push(s('Classes', 'cls', 'symbol-class', ux.classes.size));
        if (!ts.length) { const it = new vscode.TreeItem('No uvm_test classes found'); it.iconPath = new vscode.ThemeIcon('info'); roots.unshift(it); }
        return roots;
      }
      if (el._node) {
        const n = el._node;
        const kids = n.children.map(node);
        if (n.ports.length) { const p = new vscode.TreeItem('ports', T.Collapsed); p._ports = n; p.iconPath = new vscode.ThemeIcon('plug'); kids.push(p); }
        if (n.connects.length) { const c = new vscode.TreeItem('connections', T.Collapsed); c._conns = n; c.iconPath = new vscode.ThemeIcon('link'); kids.push(c); }
        return kids;
      }
      if (el._ports) return el._ports.ports.map(p => { const it = new vscode.TreeItem(p.name); const conn = el._ports.connects.concat(...(el._ports.children || []).map(c => c.connects || [])).filter(c => c.from.endsWith(p.name) || c.to.endsWith(p.name)); it.description = p.type + (conn.length ? '  ⇄ ' + conn.map(c => c.from.endsWith(p.name) ? c.to : c.from).join(', ') : ''); it.iconPath = new vscode.ThemeIcon('debug-disconnect'); return it; });
      if (el._conns) return el._conns.connects.map(c => { const it = new vscode.TreeItem(`${c.from} → ${c.to}`); it.iconPath = new vscode.ThemeIcon('arrow-right'); const cls = el._conns.cls; if (cls) it.command = open(cls.uri, c.line); return it; });
      if (el._sec === 'cfg') {
        const fields = [...new Set([...ux.sets, ...ux.gets].map(x => x.field))].sort();
        return fields.map(f => { const it = new vscode.TreeItem(f, T.Collapsed); const ns = ux.sets.filter(x => x.field === f).length, ng = ux.gets.filter(x => x.field === f).length; it.description = `${ns} set · ${ng} get${!ns ? '  ⚠ no set' : !ng ? '  (unused)' : ''}`; it.iconPath = new vscode.ThemeIcon(!ns ? 'warning' : 'symbol-field'); it._field = f; return it; });
      }
      if (el._field) return [...ux.sets.filter(x => x.field === el._field).map(x => ({ ...x, k: 'set' })), ...ux.gets.filter(x => x.field === el._field).map(x => ({ ...x, k: 'get' }))].map(x => { const it = new vscode.TreeItem(`${x.k}  #(${x.type})`); it.description = `${path.basename(vscode.Uri.parse(x.uri).fsPath)}:${x.line + 1}  ${x.cntxt}, "${x.inst}"`; it.iconPath = new vscode.ThemeIcon(x.k === 'set' ? 'arrow-down' : 'arrow-up'); it.command = open(x.uri, x.line); return it; });
      if (el._sec === 'ovr') return ux.overrides.map(o => { const it = new vscode.TreeItem(`${o.orig} → ${o.override}`); it.description = `${o.kind}${o.kind === 'inst' ? ' @ ' + o.path : ''} · in ${o.cls || '?'}`; it.iconPath = new vscode.ThemeIcon('replace'); it.command = open(o.uri, o.line); return it; });
      if (el._sec === 'cls') {
        const groups = {};
        ux.classes.forEach(c => { const k = uvm.kindOf(ux, c.name); (groups[k] = groups[k] || []).push(c); });
        return Object.entries(groups).map(([k, list]) => { const it = new vscode.TreeItem(k, T.Collapsed); it.description = String(list.length); it._clsList = list; return it; });
      }
      if (el._clsList) return el._clsList.sort((a, b) => a.name.localeCompare(b.name)).map(c => { const it = new vscode.TreeItem(c.name); it.description = c.base ? 'extends ' + c.base : ''; it.iconPath = new vscode.ThemeIcon('symbol-class'); it.command = open(c.uri, c.line); return it; });
      return [];
    }
  }
  const uvmTree = new UvmTree();
  sub(vscode.window.registerTreeDataProvider('tenxDebug.uvmHierarchy', uvmTree));
  let viewT;
  function refreshViews() { clearTimeout(viewT); viewT = setTimeout(() => { designTree.refresh(); uvmTree.refresh(); }, 600); }

  /* ================================================================ class graph */
  async function classGraph() {
    await ensureIndex();
    const ux = getUvm();
    const states = [], trans = [];
    const add = n => { if (!states.some(s => s.name === n)) states.push({ name: n, value: null, line: (ux.classes.get(n) || {}).line || 0 }); };
    ux.classes.forEach(c => { add(c.name); if (c.base) { add(c.base); trans.push({ from: c.name, to: c.base, cond: '', line: c.line }); } });
    if (!states.length) { vscode.window.showInformationMessage('No classes found in the workspace.'); return; }
    const roots = states.filter(s => !ux.classes.has(s.name) || !ux.classes.get(s.name).base);
    const fsm = { id: 'classes', name: 'UVM class graph', states, transitions: trans, reset: roots.length ? roots[0].name : states[0].name, encoding: 'classes' };
    const panel = vscode.window.createWebviewPanel('tenxDebug.classGraph', 'UVM Class Graph', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    const n = h.nonce();
    const u = f => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', f));
    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${h.csp(panel.webview, n)}"><link rel="stylesheet" href="${u('fsm.css')}"></head>
<body><div id="bar"><b>UVM class graph</b><span class="grow"></span><span id="stats">${ux.classes.size} classes · arrows point to the base class · click a class to open it</span><button id="fit">Fit</button></div>
<div id="body"><svg id="diagram"></svg></div><script nonce="${n}" src="${u('fsmRender.js')}"></script>
<script nonce="${n}">const vs=acquireVsCodeApi();const f=${JSON.stringify(fsm)};const api=FsmRender.render(document.getElementById('diagram'),f,{onNodeClick:n=>vs.postMessage({n})});document.getElementById('fit').onclick=()=>api.fit();</script></body></html>`;
    panel.webview.onDidReceiveMessage(m => { const c = ux.classes.get(m.n); if (c) revealLine(c.uri, c.line); });
  }

  /* ================================================================ clickable simulator logs (documents + terminals) */
  const LOC_RE = /((?:[A-Za-z]:)?[\w./\\-]+\.(?:sv|svh|svi|v|vh|vhd|vhdl|vl|c|cpp|h|py|s|S|do|tcl|f))(?:\((\d+)\)|:(\d+)(?::(\d+))?|,\s*(\d+))/g;
  const UVM_PATH_RE = /\buvm_test_top(?:\.[A-Za-z_][\w\[\]]*)*/g;
  async function resolvePath(p) {
    const cands = [p];
    (vscode.workspace.workspaceFolders || []).forEach(w => cands.push(path.resolve(w.uri.fsPath, p)));
    for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch (e) { /* next */ } }
    const parts = p.replace(/\\/g, '/').split('/').filter(x => x && x !== '..' && x !== '.');
    const found = await vscode.workspace.findFiles('**/' + parts[parts.length - 1], EXCL, 20);
    found.sort((a, b) => { const s = u => { const fp = u.fsPath.replace(/\\/g, '/'); let k = 0; for (let i = parts.length - 1; i >= 0 && fp.includes('/' + parts.slice(i).join('/')); i--) k++; return k; }; return s(b) - s(a); });
    return found.length ? found[0].fsPath : null;
  }
  async function openLoc(p, line, col) {
    const f = await resolvePath(p);
    if (!f) { vscode.window.showWarningMessage('Not found in workspace: ' + p); return; }
    const pos = new vscode.Position(Math.max(0, (line || 1) - 1), Math.max(0, (col || 1) - 1));
    await vscode.window.showTextDocument(vscode.Uri.file(f), { selection: new vscode.Range(pos, pos) });
  }
  async function openUvmPath(p) {
    await ensureIndex();
    const ux = getUvm();
    for (const t of uvm.tests(ux)) {
      let hit = null;
      const walk = n => { if (n.path === p) hit = n; n.children.forEach(walk); };
      walk(uvm.buildTopology(ux, t));
      if (hit && hit.cls) { revealLine(hit.cls.uri, hit.cls.line); vscode.window.setStatusBarMessage(`${p} → ${hit.type} (test ${t})`, 4000); return; }
    }
    vscode.window.showInformationMessage('Component not found in the modeled UVM hierarchy: ' + p);
  }
  if (cfg().get('logs.links', true)) {
    sub(vscode.languages.registerDocumentLinkProvider([{ pattern: '**/*.log' }, { pattern: '**/transcript' }, { pattern: '**/*.rpt' }, { language: 'log' }], {
      provideDocumentLinks(doc) {
        if (doc.getText().length > cfg().get('logs.maxFileSizeMB', 50) * 1e6) return [];
        const links = [];
        const text = doc.getText();
        let m;
        LOC_RE.lastIndex = 0;
        while ((m = LOC_RE.exec(text))) {
          const line = +(m[2] || m[3] || m[5]); const col = m[4] ? +m[4] : 1;
          const args = encodeURIComponent(JSON.stringify([m[1], line, col]));
          const l = new vscode.DocumentLink(new vscode.Range(doc.positionAt(m.index), doc.positionAt(m.index + m[0].length)), vscode.Uri.parse(`command:tenxDebug.openLoc?${args}`));
          l.tooltip = `Open ${m[1]}:${line}`;
          links.push(l);
        }
        UVM_PATH_RE.lastIndex = 0;
        while ((m = UVM_PATH_RE.exec(text))) {
          const l = new vscode.DocumentLink(new vscode.Range(doc.positionAt(m.index), doc.positionAt(m.index + m[0].length)), vscode.Uri.parse(`command:tenxDebug.openUvmPath?${encodeURIComponent(JSON.stringify([m[0]]))}`));
          l.tooltip = 'Open the class of this UVM component';
          links.push(l);
        }
        return links;
      }
    }));
    if (vscode.window.registerTerminalLinkProvider) sub(vscode.window.registerTerminalLinkProvider({
      provideTerminalLinks(ctx) {
        const links = [];
        let m;
        LOC_RE.lastIndex = 0;
        while ((m = LOC_RE.exec(ctx.line))) links.push({ startIndex: m.index, length: m[0].length, tooltip: 'Open source', data: [m[1], +(m[2] || m[3] || m[5]), m[4] ? +m[4] : 1] });
        UVM_PATH_RE.lastIndex = 0;
        while ((m = UVM_PATH_RE.exec(ctx.line))) links.push({ startIndex: m.index, length: m[0].length, tooltip: 'Open UVM component class', data: ['uvm', m[0]] });
        const VCD_RE = /((?:[A-Za-z]:)?[\w./\\-]+\.vcd)\b/g;   // SymbiYosys 'Writing trace to VCD file: engine_0/trace.vcd', simulator dumps
        while ((m = VCD_RE.exec(ctx.line))) links.push({ startIndex: m.index, length: m[0].length, tooltip: 'Open trace in the 10xEngineers EDA waveform viewer', data: ['vcd', m[1]] });
        return links;
      },
      async handleTerminalLink(l) {
        if (l.data[0] === 'uvm') return openUvmPath(l.data[1]);
        if (l.data[0] === 'vcd') { const f = await resolvePath(l.data[1]); if (f) return vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(f), 'tenxDebug.waveform', vscode.ViewColumn.Beside); return vscode.window.showWarningMessage('Trace not found on this machine: ' + l.data[1]); }
        return openLoc(...l.data);
      }
    }));
  }

  /* ================================================================ RISC-V completion + hover */
  const RV = [{ language: 'riscv' }];
  sub(vscode.languages.registerCompletionItemProvider(RV, {
    provideCompletionItems(doc, pos) {
      const line = doc.lineAt(pos.line).text.slice(0, pos.character);
      const items = [];
      if (/(^|\s)\.\w*$/.test(line)) {
        riscv.DIRECTIVES.forEach(([d, desc]) => { const it = new vscode.CompletionItem(d, vscode.CompletionItemKind.Keyword); it.detail = desc; it.insertText = d.slice(1); items.push(it); });
        return items;
      }
      const isOperand = /^\s*(?:[\w.$]+:\s*)?[a-z][\w.]*\s+/.test(line);
      if (!isOperand) {
        riscv.INSTRUCTIONS.forEach(([m, ops, desc, ext]) => {
          const it = new vscode.CompletionItem({ label: m, description: ext }, vscode.CompletionItemKind.Function);
          it.detail = `${m} ${ops}`; it.documentation = new vscode.MarkdownString(`**${m}** ${ops}\n\n${desc}\n\n*Extension: ${ext}*`);
          const parts = ops ? ops.split(/,\s*/) : [];
          it.insertText = new vscode.SnippetString(m + (parts.length ? ' ' + parts.map((p, k) => `\${${k + 1}:${p.replace(/[$}]/g, '\\$&')}}`).join(', ') : ''));
          items.push(it);
        });
        return items;
      }
      Object.entries(riscv.ABI).forEach(([r, d]) => { const it = new vscode.CompletionItem(r, vscode.CompletionItemKind.Variable); it.detail = d; items.push(it); });
      for (let i = 0; i < 32; i++) { items.push(new vscode.CompletionItem('x' + i, vscode.CompletionItemKind.Variable)); items.push(new vscode.CompletionItem('f' + i, vscode.CompletionItemKind.Variable)); }
      riscv.CSRS.forEach(c => { const it = new vscode.CompletionItem(c, vscode.CompletionItemKind.Constant); it.detail = 'CSR'; items.push(it); });
      const labels = new Set();
      doc.getText().replace(/^\s*([A-Za-z_.$][\w.$]*):/gm, (m0, l) => { labels.add(l); return m0; });
      labels.forEach(l => { const it = new vscode.CompletionItem(l, vscode.CompletionItemKind.Reference); it.detail = 'label'; items.push(it); });
      ['%hi', '%lo', '%pcrel_hi', '%pcrel_lo'].forEach(r => items.push(new vscode.CompletionItem(r, vscode.CompletionItemKind.Function)));
      return items;
    }
  }, '.', ' ', ','));
  sub(vscode.languages.registerHoverProvider(RV, {
    provideHover(doc, pos) {
      const r = doc.getWordRangeAtPosition(pos, /[.%]?[A-Za-z_][\w.]*/);
      if (!r) return;
      const w = doc.getText(r);
      const ins = riscv.BY_NAME.get(w.toLowerCase());
      if (ins) return new vscode.Hover(new vscode.MarkdownString(`**${ins[0]}** \`${ins[1]}\`\n\n${ins[2]}\n\n*${ins[3]}*`), r);
      const d = riscv.DIRECTIVES.find(x => x[0] === w);
      if (d) return new vscode.Hover(`**${d[0]}** — ${d[1]}`, r);
      if (riscv.ABI[w]) return new vscode.Hover(`**${w}** — ${riscv.ABI[w]}`, r);
      if (/^x([12]?\d|3[01])$/.test(w)) { const abi = Object.entries(riscv.ABI).find(([, v]) => v.startsWith(w + ' ')); return new vscode.Hover(`**${w}**${abi ? ' — ABI name `' + abi[0] + '`: ' + abi[1] : ''}`, r); }
      if (riscv.CSRS.includes(w)) return new vscode.Hover(`**${w}** — control and status register`, r);
      return undefined;
    }
  }));

  /* ================================================================ UVM tools: validate, source list, item/sequence generators */
  async function pickTbDir(uri) {
    if (uri instanceof vscode.Uri) return fs.statSync(uri.fsPath).isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
    const lists = await vscode.workspace.findFiles('**/{files.f,src_files.list}', EXCL, 50);
    const dirs = [...new Set(lists.map(u => path.dirname(u.fsPath)))];
    if (dirs.length === 1) return dirs[0];
    const p = await vscode.window.showQuickPick([...dirs.map(d => ({ label: vscode.workspace.asRelativePath(d), d })), { label: '$(folder) Browse…', b: true }], { placeHolder: 'Testbench folder' });
    if (!p) return null;
    if (p.b) { const f = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false }); return f ? f[0].fsPath : null; }
    return p.d;
  }

  async function validateTb(uri) {
    const dir = await pickTbDir(uri);
    if (!dir) return;
    // every SV file of the environment, sub-folders included (tb/, agent/, sequences/, env/, tests/); paths relative to dir
    const walkSv = (d, rel, depth) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
      if (e.isDirectory()) return depth < 3 && !/^(work|obj_dir|_old_flat_layout|node_modules|\..*)$/.test(e.name) ? walkSv(path.join(d, e.name), rel + e.name + '/', depth + 1) : [];
      return /\.(sv|svh|v)$/i.test(e.name) ? [rel + e.name] : [];
    });
    const svs = walkSv(dir, '', 0);
    const texts = Object.fromEntries(svs.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
    const listFile = ['files.f', 'src_files.list'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
    const incdirs = ['.'].concat(listFile ? [...fs.readFileSync(listFile, 'utf8').matchAll(/^\s*\+incdir\+(\S+)/gm)].map(m => m[1]) : []);
    const findInc = f => incdirs.map(d => path.resolve(dir, d, f)).find(p => fs.existsSync(p));
    const results = [];
    const ok = (m) => results.push(['PASS', m]); const bad = (m) => results.push(['FAIL', m]); const warn = (m) => results.push(['WARN', m]);
    const list = ['files.f', 'src_files.list'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
    list ? ok('Source list found: ' + path.basename(list)) : bad('No files.f / src_files.list');
    if (list) {
      const lt = fs.readFileSync(list, 'utf8').split(/\r?\n/).map(l => l.replace(/\/\/.*|#.*/, '').trim()).filter(l => l && !/^[+-]/.test(l));
      const missing = lt.filter(l => !fs.existsSync(path.resolve(dir, l)));
      missing.length ? bad('Source list entries not found: ' + missing.join(', ')) : ok(`All ${lt.length} source-list entries exist`);
      if (!lt.some(l => /tb_top|top/i.test(l))) warn('tb_top is not in the source list');
    }
    const pkg = svs.find(f => /\bpackage\s+\w+/.test(texts[f]));
    pkg ? ok('Package: ' + pkg) : bad('No package file (…_pkg.sv)');
    if (pkg) {
      const inc = [...texts[pkg].matchAll(/`include\s+"([^"]+)"/g)].map(m => m[1]).filter(f => f !== 'uvm_macros.svh');
      const miss = inc.filter(f => !findInc(f));
      miss.length ? bad('Package includes missing files: ' + miss.join(', ')) : ok(`Package includes ${inc.length} files`);
      /import\s+uvm_pkg::\*/.test(texts[pkg]) ? ok('Package imports uvm_pkg') : bad('Package does not import uvm_pkg::*');
      const incBase = new Set(inc.map(f => path.basename(f)));
      const classFiles = svs.filter(f => /\bclass\s+\w+/.test(texts[f]) && f !== pkg && !incBase.has(path.basename(f)));
      if (classFiles.length) warn('Class files not included by the package: ' + classFiles.join(', '));
    }
    const all = Object.entries(texts).map(([f, text]) => ({ uri: vscode.Uri.file(path.join(dir, f)).toString(), text }));
    const ux = uvm.buildIndex(all);
    const need = { uvm_driver: 'driver', uvm_monitor: 'monitor', uvm_agent: 'agent', uvm_env: 'environment', uvm_test: 'test', uvm_sequence_item: 'sequence item', uvm_sequence: 'sequence', uvm_scoreboard: 'scoreboard', uvm_subscriber: 'coverage subscriber' };
    for (const [base, label] of Object.entries(need)) {
      const found = [...ux.classes.values()].filter(c => uvm.isA(ux, c.name, base));
      found.length ? ok(`${label}: ${found.map(c => c.name).join(', ')}`) : (['uvm_scoreboard', 'uvm_subscriber'].includes(base) ? warn : bad)(`No ${label} (extends ${base})`);
    }
    const hasSqr = /uvm_sequencer/.test(Object.values(texts).join('\n'));
    hasSqr ? ok('sequencer declared') : bad('No uvm_sequencer');
    const iface = svs.find(f => /\binterface\s+\w+/.test(texts[f]));
    iface ? ok('Interface: ' + iface) : bad('No interface');
    const top = svs.find(f => /\bmodule\s+\w*top\w*/i.test(texts[f]) || /run_test\s*\(/.test(texts[f]));
    if (top) {
      ok('Top: ' + top);
      /run_test\s*\(/.test(texts[top]) ? ok('tb_top calls run_test()') : bad('tb_top does not call run_test()');
      /uvm_config_db\s*#\s*\(\s*virtual/.test(texts[top]) ? ok('tb_top publishes the virtual interface') : bad('tb_top does not set the virtual interface in uvm_config_db');
      const mods = modules();
      const dutInst = findInstances(texts[top], mods).filter(i => !/_if$/.test(i.type));
      dutInst.length ? ok('DUT instantiated: ' + dutInst.map(i => i.type + ' ' + i.name).join(', ')) : warn('No DUT instance found in tb_top (or DUT source not in workspace)');
    } else bad('No tb_top module');
    const ph = Object.entries(texts).filter(([, t]) => /\{\{|\}\}|<DUT>|DUT_NAME|__NAME__|<design>/i.test(t)).map(([f]) => f);
    ph.length ? bad('Unresolved placeholders in: ' + ph.join(', ')) : ok('No unresolved design-name placeholders');
    let lintErr = 0;
    for (const [f, t] of Object.entries(texts)) { const is = uvm.lint(t, ux).filter(i => i.severity === 'error'); lintErr += is.length; is.forEach(i => warn(`${f}:${i.line + 1} ${i.rule} ${i.message}`)); }
    lintErr ? warn(`${lintErr} UVM lint error(s)`) : ok('UVM lint: no errors');
    const fails = results.filter(r => r[0] === 'FAIL').length;
    out.clear();
    out.appendLine(`10xEngineers EDA — Validate Testbench: ${dir}\n`);
    results.forEach(([s, m]) => out.appendLine(`${s === 'PASS' ? '✓' : s === 'WARN' ? '▲' : '✕'} ${s.padEnd(4)}  ${m}`));
    out.appendLine(`\nValidation ${fails ? 'FAILED (' + fails + ' problem(s))' : 'PASSED'}`);
    out.show(true);
    (fails ? vscode.window.showErrorMessage : vscode.window.showInformationMessage)(`Validation ${fails ? 'FAILED — ' + fails + ' problem(s), see output' : 'PASSED'}`);
  }

  async function updateSourceList(uri) {
    const dir = await pickTbDir(uri);
    if (!dir) return;
    const listPath = fs.existsSync(path.join(dir, 'src_files.list')) ? path.join(dir, 'src_files.list') : path.join(dir, 'files.f');
    const old = fs.existsSync(listPath) ? fs.readFileSync(listPath, 'utf8').split(/\r?\n/) : [];
    const keepOpts = old.filter(l => /^\s*[+-]/.test(l) && !/^\s*\+incdir\+\.\s*$/.test(l));
    const svs = fs.readdirSync(dir).filter(f => /\.(sv|v)$/i.test(f));
    const texts = Object.fromEntries(svs.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
    const included = new Set(Object.values(texts).flatMap(t => [...t.matchAll(/`include\s+"([^"]+)"/g)].map(m => m[1])));
    const tbFiles = svs.filter(f => !included.has(f));
    const rank = f => /\binterface\s+\w+/.test(texts[f]) ? 1 : /\bpackage\s+\w+/.test(texts[f]) ? 2 : /\bbind\b|_assertions/.test(f) ? 3 : /tb_top|run_test/.test(f + texts[f]) ? 5 : 4;
    tbFiles.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    // RTL: keep existing external entries that still exist, plus DUT modules instantiated in tb_top found in the workspace
    const rtlOld = old.map(l => l.trim()).filter(l => l && !/^(\/\/|#|[+-])/.test(l) && !tbFiles.includes(l) && !svs.includes(l));
    await ensureIndex();
    const mods = modules();
    const top = tbFiles.find(f => rank(f) === 5);
    const rtl = new Set(rtlOld.filter(l => fs.existsSync(path.resolve(dir, l))));
    const addMod = (name, seen) => {
      const m = mods.get(name);
      if (!m || seen.has(name)) return;
      seen.add(name);
      const fp = vscode.Uri.parse(m.uri).fsPath;
      if (path.dirname(fp) !== dir) rtl.add(path.relative(dir, fp).replace(/\\/g, '/'));
      const f = files.get(m.uri);
      if (f) findInstances(f.text, mods).forEach(i => addMod(i.type, seen));
    };
    if (top) findInstances(texts[top], mods).forEach(i => addMod(i.type, new Set()));
    const incdirs = [...new Set([...rtl].map(r => path.posix.dirname(r)).filter(d => d !== '.'))].map(d => '+incdir+' + d);
    const content = ['// source list — updated by 10xEngineers EDA ' + new Date().toISOString().slice(0, 10), '+incdir+.', ...new Set([...incdirs, ...keepOpts]), '// ---- RTL', ...rtl, '// ---- verification', ...tbFiles, ''].join('\n');
    fs.writeFileSync(listPath, content, 'utf8');
    await vscode.window.showTextDocument(vscode.Uri.file(listPath));
    vscode.window.showInformationMessage(`${path.basename(listPath)} updated: ${rtl.size} RTL + ${tbFiles.length} testbench file(s).`);
  }

  async function genSeqItem(uri) {
    const dir = uri instanceof vscode.Uri ? (fs.statSync(uri.fsPath).isDirectory() ? uri.fsPath : path.dirname(uri.fsPath)) : (vscode.window.activeTextEditor ? path.dirname(vscode.window.activeTextEditor.document.fileName) : (vscode.workspace.workspaceFolders || [{ uri: { fsPath: '.' } }])[0].uri.fsPath);
    const name = await vscode.window.showInputBox({ prompt: 'Sequence item class name', value: 'my_item', validateInput: v => /^[A-Za-z_]\w*$/.test(v) ? null : 'identifier' });
    if (!name) return;
    const spec = await vscode.window.showInputBox({ prompt: 'Fields: name:width or name:type, comma separated. Prefix "!" for non-random (e.g. addr:32, data:32, write:1, burst:enum{SINGLE,INCR}, !resp:2)', value: 'addr:32, data:32, write:1' });
    if (!spec) return;
    const fields = spec.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const nr = s.startsWith('!'); const [n, t = '1'] = s.replace(/^!/, '').split(':').map(x => x.trim());
      let decl, macro = 'uvm_field_int', typedef = '';
      if (/^\d+$/.test(t)) decl = +t === 1 ? 'bit' : `bit [${+t - 1}:0]`;
      else if (/^enum\{/.test(t)) { const tn = n + '_e'; typedef = `  typedef enum {${t.slice(5, -1)}} ${tn};\n`; decl = tn; macro = `uvm_field_enum(${tn}, `; }
      else { decl = t; if (t === 'string') macro = 'uvm_field_string'; }
      return { n, decl, rand: !nr, macro, typedef };
    });
    const body = `class ${name} extends uvm_sequence_item;
${fields.map(f => f.typedef).join('')}${fields.map(f => `  ${f.rand ? 'rand ' : '     '}${f.decl.padEnd(14)} ${f.n};`).join('\n')}

  \`uvm_object_utils_begin(${name})
${fields.map(f => f.macro.endsWith(', ') ? `    \`${f.macro}${f.n}, UVM_ALL_ON)` : `    \`${f.macro}(${f.n}, UVM_ALL_ON${f.rand ? '' : ' | UVM_NOCOMPARE'})`).join('\n')}
  \`uvm_object_utils_end

  function new(string name = "${name}");
    super.new(name);
  endfunction

  virtual function string convert2string();
    return $sformatf("${fields.map(f => f.n + '=%0p').join(' ')}", ${fields.map(f => f.n).join(', ')});
  endfunction
endclass
`;
    const p = path.join(dir, name + '.sv');
    if (fs.existsSync(p)) { vscode.window.showErrorMessage(p + ' exists'); return; }
    fs.writeFileSync(p, body, 'utf8');
    vscode.window.showTextDocument(vscode.Uri.file(p));
  }

  async function genBasicSequence(uri) {
    await ensureIndex();
    const ux = getUvm();
    const itemsList = [...ux.classes.values()].filter(c => uvm.isA(ux, c.name, 'uvm_sequence_item')).map(c => c.name);
    const item = itemsList.length ? await vscode.window.showQuickPick(itemsList, { placeHolder: 'Sequence item type' }) : await vscode.window.showInputBox({ prompt: 'Sequence item type' });
    if (!item) return;
    const name = await vscode.window.showInputBox({ prompt: 'Sequence class name', value: item.replace(/_(seq_)?item$/, '') + '_basic_seq' });
    if (!name) return;
    const dir = uri instanceof vscode.Uri ? (fs.statSync(uri.fsPath).isDirectory() ? uri.fsPath : path.dirname(uri.fsPath)) : (ux.classes.get(item) ? path.dirname(vscode.Uri.parse(ux.classes.get(item).uri).fsPath) : (vscode.workspace.workspaceFolders || [{ uri: { fsPath: '.' } }])[0].uri.fsPath);
    const body = `class ${name} extends uvm_sequence #(${item});
  \`uvm_object_utils(${name})
  rand int unsigned num_items = 10;
  constraint c_num { num_items inside {[1:100]}; }

  function new(string name = "${name}");
    super.new(name);
  endfunction

  virtual task body();
    repeat (num_items) begin
      req = ${item}::type_id::create("req");
      start_item(req);
      if (!req.randomize()) \`uvm_error(get_type_name(), "randomize failed")
      finish_item(req);
    end
  endtask
endclass
`;
    const p = path.join(dir, name + '.sv');
    if (fs.existsSync(p)) { vscode.window.showErrorMessage(p + ' exists'); return; }
    fs.writeFileSync(p, body, 'utf8');
    vscode.window.showTextDocument(vscode.Uri.file(p));
    vscode.window.showInformationMessage(`Created ${name}.sv — add \`include "${name}.sv" to your package and run "Update Source List".`);
  }

  /* ================================================================ commands */
  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, fn));
  reg('tenxDebug.showDrivers', () => signalUses('drivers'));
  reg('tenxDebug.showLoads', () => signalUses('loads'));
  reg('tenxDebug.showAssertCover', () => signalUses('asserts'));
  reg('tenxDebug.classGraph', classGraph);
  reg('tenxDebug.uvmArchitecture', async item => { await ensureIndex(); require('./uvmarch').show(context, h, getUvm(), uvm, item && item._test); });
  reg('tenxDebug.openLoc', (p, l, c) => openLoc(p, l, c));
  reg('tenxDebug.openUvmPath', p => openUvmPath(p));
  reg('tenxDebug.refreshHierarchy', async () => { ready = null; files.clear(); await ensureIndex(); uvmIdx = null; refreshViews(); });
  reg('tenxDebug.filterHierarchy', async () => { const f = await vscode.window.showInputBox({ prompt: 'Filter design / UVM hierarchy by name (empty = show all)', value: designTree.filter }); if (f === undefined) return; designTree.filter = f; uvmTree.filter = f; refreshViews(); });
  reg('tenxDebug.validateTestbench', u => validateTb(u));
  reg('tenxDebug.updateSourceList', u => updateSourceList(u));
  reg('tenxDebug.genSeqItem', u => genSeqItem(u));
  reg('tenxDebug.genBasicSequence', u => genBasicSequence(u));
  ensureIndex().then(refreshViews);

  return { ensureIndex, modules, getUvm, files };
}

module.exports = { register };
