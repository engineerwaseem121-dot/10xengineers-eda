#!/usr/bin/env node
'use strict';
/*
 * 10xEngineers EDA MCP server (stdio, JSON-RPC 2.0, newline-delimited) for AI agents.
 * Run with any Node, or with the editor's runtime: ELECTRON_RUN_AS_NODE=1 <Code|Cursor executable> mcp-server.js
 */
const fs = require('fs');
const path = require('path');
const coverage = require('./coverage');
const vplan = require('./vplan');
const fsmLib = require('./fsm');
const hdl = require('./hdlparse');
const uvm = require('./uvm');
const uvmgen = require('./uvmgen');

const VERSION = '0.2.0';
const read = f => fs.readFileSync(path.resolve(f), 'utf8');
const listSv = dir => {
  const out = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(node_modules|\.git|work|regression_runs)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(sv|svh|v|vh)$/i.test(e.name)) out.push(p); } };
  walk(path.resolve(dir));
  return out;
};

const TOOLS = [
  {
    name: 'coverage_summary', description: 'Parse a coverage report (Questa vcover text, LCOV .info, Verilator coverage.dat or 10x JSON) and return total + per-metric coverage and per-covergroup percentages.',
    inputSchema: { type: 'object', properties: { report: { type: 'string', description: 'Path to the coverage report' } }, required: ['report'] },
    run: a => { const m = coverage.parseFile(a.report); return { tool: m.tool, total: m.total, metrics: m.metrics, covergroups: m.covergroups.map(c => ({ name: c.name, kind: c.kind, pct: c.pct, coverpoints: c.coverpoints.map(p => ({ name: p.name, kind: p.kind, pct: p.pct })) })), assertions: m.assertions.length, directives: m.directives.length }; }
  },
  {
    name: 'coverage_holes', description: 'List uncovered bins (holes), failed/vacuous assertions, uncovered cover directives and uncovered code lines from a coverage report.',
    inputSchema: { type: 'object', properties: { report: { type: 'string' }, limit: { type: 'number', description: 'Max items per category (default 200)' } }, required: ['report'] },
    run: a => {
      const m = coverage.parseFile(a.report); const lim = a.limit || 200; const holes = [];
      m.covergroups.forEach(cg => cg.coverpoints.forEach(cp => cp.bins.forEach(b => { if (b.type === 'bin' && b.hits < b.atLeast) holes.push({ covergroup: cg.name, coverpoint: cp.name, bin: b.name, hits: b.hits }); if (b.type === 'illegal' && b.hits) holes.push({ covergroup: cg.name, coverpoint: cp.name, bin: b.name, illegal_hit: b.hits }); })));
      const code = []; Object.entries(m.code).forEach(([f, ls]) => Object.entries(ls).forEach(([l, v]) => { if (!v.hits) code.push(`${f}:${l}`); }));
      return { bins: holes.slice(0, lim), bin_holes_total: holes.length, assertions: m.assertions.filter(x => x.status !== 'passed').slice(0, lim), directives: m.directives.filter(d => !d.count).slice(0, lim), uncovered_lines: code.slice(0, lim), uncovered_lines_total: code.length };
    }
  },
  {
    name: 'testplan_status', description: 'Evaluate a testplan (.testplan YAML or vplan CSV) against a coverage report (and optional regression results.json): per feature hit / remaining items and status.',
    inputSchema: { type: 'object', properties: { testplan: { type: 'string' }, report: { type: 'string' }, regression: { type: 'string', description: 'Optional regression results.json' } }, required: ['testplan', 'report'] },
    run: a => { const plan = vplan.loadPlanText(read(a.testplan), a.testplan); const m = coverage.parseFile(a.report); const reg = a.regression ? JSON.parse(read(a.regression)) : null; return vplan.evaluate(plan, m, reg).map(f => ({ id: f.id, feature: f.feature, status: f.status, pct: f.pct, hit: f.hit.map(x => x.label), remaining: f.unhit.map(x => x.label).concat(f.missingPatterns) })); }
  },
  {
    name: 'extract_testplan_from_spec', description: 'Heuristically extract requirement sentences (shall/must/should) from a text or markdown specification into testplan features.',
    inputSchema: { type: 'object', properties: { spec: { type: 'string' } }, required: ['spec'] },
    run: a => vplan.extractFromSpec(read(a.spec))
  },
  {
    name: 'extract_fsms', description: 'Extract state machines (states, encodings, transitions with conditions, reset state, lint issues) from a Verilog/SystemVerilog file.',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] },
    run: a => fsmLib.extractFsms(read(a.file)).map(f => ({ ...f, issues: fsmLib.lintFsm(f), mermaid: fsmLib.toMermaid(f) }))
  },
  {
    name: 'module_ports', description: 'Parse modules of a Verilog/SystemVerilog file: parameters and ports (direction, width), with detected clock/reset.',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] },
    run: a => hdl.parseModules(read(a.file)).map(m => { const c = hdl.classify(m.ports); return { name: m.name, params: m.params, ports: m.ports, clock: c.clk && c.clk.name, reset: c.rst && c.rst.name, reset_active_low: c.activeLow }; })
  },
  {
    name: 'uvm_structure', description: 'Analyze UVM sources under a directory: classes and bases, tests, component topology per test (with factory overrides), config_db set/get, connect() calls.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' }, test: { type: 'string', description: 'Optional test to build the topology for' } }, required: ['dir'] },
    run: a => {
      const idx = uvm.buildIndex(listSv(a.dir).map(f => ({ uri: f, text: read(f) })));
      const strip = n => ({ inst: n.inst, type: n.type, overridden_from: n.origType || undefined, connects: n.connects.map(c => `${c.from} -> ${c.to}`), children: n.children.map(strip) });
      const ts = uvm.tests(idx);
      return { classes: [...idx.classes.values()].map(c => ({ name: c.name, base: c.base, kind: uvm.kindOf(idx, c.name), file: c.uri, line: c.line + 1 })), tests: ts,
        topology: (a.test ? [a.test] : ts).map(t => ({ test: t, tree: strip(uvm.buildTopology(idx, t)) })), config_db: { sets: idx.sets, gets: idx.gets }, overrides: idx.overrides };
    }
  },
  {
    name: 'uvm_lint', description: 'Run the 10x UVM lint rules on a SystemVerilog file (factory registration, constructors, super.build_phase, objections, unchecked randomize()/config_db get, new() vs create).',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] },
    run: a => uvm.lint(read(a.file), uvm.buildIndex(listSv(path.dirname(path.resolve(a.file))).map(f => ({ uri: f, text: read(f) })))).map(i => ({ rule: i.rule, severity: i.severity, line: i.line + 1, message: i.message }))
  },
  {
    name: 'generate_uvm_env', description: 'Generate a complete UVM environment (interface, cfg, item, sequences, driver, monitor, coverage, scoreboard, SVA, tests, tb_top, files.f, Questa scripts) for a DUT module.',
    inputSchema: { type: 'object', properties: { dut_file: { type: 'string' }, module: { type: 'string' }, name: { type: 'string', description: 'Prefix for generated classes' }, out_dir: { type: 'string' }, passive: { type: 'boolean' } }, required: ['dut_file', 'name', 'out_dir'] },
    run: a => {
      const mods = hdl.parseModules(read(a.dut_file));
      const dut = a.module ? mods.find(m => m.name === a.module) : mods[0];
      if (!dut) throw new Error('module not found');
      const out = path.resolve(a.out_dir);
      const r = uvmgen.generate({ name: a.name, dut, active: !a.passive, features: { coverage: true, scoreboard: true, assertions: true, questa: true }, rtlFiles: [path.relative(out, path.resolve(a.dut_file)).replace(/\\/g, '/')] });
      fs.mkdirSync(out, { recursive: true });
      const written = [];
      for (const [f, c] of Object.entries(r.files)) { const p = path.join(out, f); fs.mkdirSync(path.dirname(p), { recursive: true }); if (!fs.existsSync(p)) { fs.writeFileSync(p, c); written.push(f); } }
      return { out_dir: out, written, warnings: r.warnings, summary: r.summary };
    }
  }
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function handle(req) {
  const { id, method, params } = req;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: '10xengineer-eda', version: VERSION } } });
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } });
  if (method === 'tools/call') {
    const t = TOOLS.find(x => x.name === params.name);
    if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool ' + params.name } });
    try {
      const res = t.run(params.arguments || {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(e && e.message || e) }] } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let k;
  while ((k = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, k).trim();
    buf = buf.slice(k + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch (e) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  }
});
