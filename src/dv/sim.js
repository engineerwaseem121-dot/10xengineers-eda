'use strict';
/*
 * Simulator adapters + shared simulator configuration.
 *
 * Configuration precedence (identical for the extension, the CLI and make):
 *   1. explicit override   (--questa-bin / make QUESTA_BIN=..., extension "DV: Configure Simulators")
 *   2. environment         (QUESTA_BIN, VERILATOR_BIN, GHDL_BIN, ICARUS_BIN, VCS_BIN)
 *   3. per-user file       ~/.dvflow/simulators.json   (never inside the project, never committed)
 *   4. PATH / well-known install folders
 * A path may be the installation directory or the directory that contains the binaries.
 *
 * Licenses: the existing environment is inherited. A per-user override (license file or server)
 * can be stored in ~/.dvflow/simulators.json; it is only placed in the environment of the spawned
 * simulator and is redacted from every log, report and message (see redact()).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

/** path relative to the compile directory when it is inside it (keeps spaces above the project out of tool arguments) */
// Verilator obj_dir. Its generated Makefile refuses any absolute path with a space (make -C cwd), so in the container
// such projects compile on the container filesystem (/tmp/tenx-obj/<hash>) and the binary runs there.
const vobj = (root, dir, container) => {
  if (container && /s/.test(path.resolve(dir))) return { ctr: true, dir: '/tmp/tenx-obj/' + require('crypto').createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 12) };
  return { ctr: false, dir: relRoot(root, path.join(dir, 'obj_dir')) };
};
const relRoot = (root, p) => { const r = path.relative(root, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p; };
const IS_WIN = process.platform === 'win32';
const exe = n => (IS_WIN ? n + '.exe' : n);
const USER_FILE = path.join(os.homedir(), '.dvflow', 'simulators.json');
const LICENSE_VARS = ['MGLS_LICENSE_FILE', 'LM_LICENSE_FILE', 'SALT_LICENSE_SERVER', 'SNPSLMD_LICENSE_FILE', 'CDS_LIC_FILE'];

/* ------------------------------------------------------------------ user config */
function loadUser() {
  try { return JSON.parse(fs.readFileSync(USER_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return {}; }
}
function saveUser(cfg) {
  fs.mkdirSync(path.dirname(USER_FILE), { recursive: true });
  fs.writeFileSync(USER_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(USER_FILE, 0o600); } catch (e) { /* windows */ }
}

/* ------------------------------------------------------------------ licence environment + redaction */
function licenseEnv(simId, overrides) {
  const env = Object.assign({}, process.env);
  const u = (loadUser()[simId] || {}).license || {};
  for (const [k, v] of Object.entries(u)) if (v) env[k] = String(v);
  for (const [k, v] of Object.entries((overrides && overrides.license) || {})) if (v) env[k] = String(v);
  for (const k of LICENSE_VARS) if (env[k]) env[k] = env[k].replace(/^"(.*)"$/, '$1');   // quoted values break FlexLM
  return env;
}
function licenseSecrets(simId) {
  const env = licenseEnv(simId);
  const out = new Set();
  for (const k of LICENSE_VARS) (env[k] || '').split(/[;:,](?![\\/])/).map(s => s.trim()).filter(s => s.length > 3).forEach(s => out.add(s));
  return [...out].sort((a, b) => b.length - a.length);
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function redact(text, simId) {
  if (!text) return text;
  let t = String(text);
  for (const sim of [simId, 'questa', 'vcs', 'verilator', 'ghdl', 'icarus'].filter(Boolean)) for (const s of licenseSecrets(sim)) t = t.replace(new RegExp(esc(s), 'gi'), '<license-redacted>');
  t = t.replace(/\b\d{2,5}@[A-Za-z0-9_.-]+/g, '<license-redacted>');                                    // port@host
  t = t.replace(/[A-Za-z]:[\\/][^\s'"()]*?(licen[cs]e|\.lic\b|\.dat\b)[^\s'"()]*/gi, '<license-redacted>'); // windows license paths
  t = t.replace(/\/[^\s'"()]*?(licen[cs]e|\.lic\b)[^\s'"()]*/gi, '<license-redacted>');                    // unix license paths
  t = t.replace(/\b(MGLS_LICENSE_FILE|LM_LICENSE_FILE|SALT_LICENSE_SERVER|SNPSLMD_LICENSE_FILE)\s*=\s*\S+/g, '$1=<license-redacted>');
  return t;
}

/* ------------------------------------------------------------------ tool resolution */
const SUBDIRS = ['', 'bin', 'win64', 'win32', 'linux_x86_64', 'linux', 'win64pe', 'questa_fse/bin', 'questa_fse/win64', 'questa_fse/linux_x86_64'];
function findIn(dir, name) {
  for (const s of SUBDIRS) { const p = path.join(dir, s, exe(name)); try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* next */ } }
  return null;
}
function onPath(name, extra) {
  for (const d of (process.env.PATH || '').split(path.delimiter).concat(extra || [])) {
    if (!d) continue;
    const p = path.join(d, exe(name));
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* next */ }
  }
  return null;
}

/**
 * Resolve the binaries of an adapter.
 * returns { source, dir, tools: {name: path|null}, missing: [names], configured }
 */
function resolveTools(adapter, ov) {
  const local = resolveLocal(adapter, ov);
  // open-source simulators can come from the 10xEngineers EDA container image instead of a local install
  try {
    const ct = require('./container');
    if (ct.shouldUse(adapter.id, local.missing.length > 0, local.configured)) {
      const av = ct.available();
      if (av.ok) {
        const tools = {};
        for (const t of adapter.tools.concat(adapter.optionalTools || [])) tools[t] = 'ctr:' + (ct.CTR_NAME[t] || t);
        return { source: `container ${av.image.image} (${av.engine.label})`, spec: '', dir: null, tools, missing: [], configured: true, container: true };
      }
      if (ct.config().mode === 'container') return Object.assign({}, local, { missing: adapter.tools.slice(), source: 'container', containerReason: av.reason });
      if (local.missing.length) local.containerReason = av.reason;
    }
  } catch (e) { local.containerReason = e.message; }
  return local;
}
function resolveLocal(adapter, ov) {
  const envKey = adapter.envBin;
  const user = loadUser()[adapter.id] || {};
  const spec = (ov && ov.bin) || process.env[envKey] || user.bin || '';
  const source = (ov && ov.bin) ? 'override' : process.env[envKey] ? `environment ${envKey}` : user.bin ? `per-user file ${USER_FILE}` : 'PATH';
  const tools = {};
  let dir = null;
  if (spec) {
    const primary = findIn(spec, adapter.tools[0]);
    dir = primary ? path.dirname(primary) : null;
    for (const t of adapter.tools.concat(adapter.optionalTools || [])) tools[t] = dir ? (findIn(dir, t) || findIn(spec, t)) : findIn(spec, t);
  } else {
    for (const t of adapter.tools.concat(adapter.optionalTools || [])) tools[t] = onPath(t, adapter.defaultDirs ? adapter.defaultDirs() : []);
    dir = tools[adapter.tools[0]] ? path.dirname(tools[adapter.tools[0]]) : null;
  }
  return { source, spec, dir, tools, missing: adapter.tools.filter(t => !tools[t]), configured: !!spec };
}

function run(cmd, args, opts) {
  try {
    if (String(cmd).startsWith('ctr:') || (opts && opts.container)) {
      const w = require('./container').wrap({ cmd, args, cwd: (opts && opts.cwd) || os.tmpdir(), container: true });
      cmd = w.cmd; args = w.args; opts = Object.assign({}, opts, { cwd: w.cwd, env: process.env });
      delete opts.container;
    }
    const r = cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), error: r.error ? r.error.message : null };
  } catch (e) { return { code: -1, out: '', error: e.message }; }
}
const firstLine = s => (s || '').split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';

/* ------------------------------------------------------------------ adapters */
const ICARUS = {
  id: 'icarus', label: 'Icarus Verilog', envBin: 'ICARUS_BIN', languages: ['sv'],
  tools: ['iverilog', 'vvp'],
  defaultDirs: () => (IS_WIN ? ['C:\\iverilog\\bin', 'C:\\Program Files\\iverilog\\bin'] : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']),
  version: t => firstLine(run(t.vvp, ['-V']).out),
  caps: () => ({ lightweight: 'yes', vhdl: 'unsupported', uvm: 'unsupported', code_coverage: 'unsupported', functional_coverage: 'tb', simulator_covergroups: 'unsupported', assertions: 'unsupported', waveforms: 'yes' }),
  build(ctx) { return [{ stage: 'compile', cmd: ctx.t.iverilog, args: ['-g2012', '-Wall', '-Wno-timescale', '-o', path.join(ctx.outDir, 'sim.vvp'), '-s', ctx.tbTop, '-f', ctx.fileList], cwd: ctx.root }]; },
  run(ctx) { return { stage: 'simulate', cmd: ctx.t.vvp, args: ['-n', path.join(ctx.buildDir, 'sim.vvp'), ...ctx.plusargs], cwd: ctx.runDir }; },
  smoke(dir) {
    fs.writeFileSync(path.join(dir, 'doctor.sv'), 'module dvflow_doctor; initial begin $display("DVFLOW_DOCTOR_OK"); $finish; end endmodule\n');
    return [{ stage: 'compile', args: t => [t.iverilog, ['-g2012', '-o', path.join(dir, 'd.vvp'), path.join(dir, 'doctor.sv')]] }, { stage: 'simulate', args: t => [t.vvp, ['-n', path.join(dir, 'd.vvp')]], expect: /DVFLOW_DOCTOR_OK/ }];
  }
};

const QUESTA = {
  id: 'questa', label: 'QuestaSim', envBin: 'QUESTA_BIN', languages: ['sv', 'vhdl'],
  tools: ['vsim', 'vlib', 'vlog', 'vopt'], optionalTools: ['vcom', 'vcover', 'vmap'],
  defaultDirs: () => { const d = []; if (process.env.QUESTA_HOME) d.push(path.join(process.env.QUESTA_HOME, 'bin'), path.join(process.env.QUESTA_HOME, IS_WIN ? 'win64' : 'linux_x86_64')); if (IS_WIN) { try { fs.readdirSync('C:\\').filter(n => /^questasim|^modeltech/i.test(n)).forEach(n => d.push(path.join('C:\\', n, 'win64'))); } catch (e) { /* ignore */ } } else d.push('/opt/questasim/bin', '/opt/questasim/linux_x86_64'); return d; },
  version: t => firstLine(run(t.vsim, ['-version']).out),
  caps: () => ({ lightweight: 'yes', vhdl: 'yes', uvm: 'yes', code_coverage: 'yes', functional_coverage: 'yes', simulator_covergroups: 'yes', assertions: 'yes', waveforms: 'yes' }),
  build(ctx) {
    const lib = path.join(ctx.outDir, 'work');
    const cov = ctx.cov ? ['+cover=bcesft'] : [];
    const steps = [{ stage: 'compile', cmd: ctx.t.vlib, args: [lib], cwd: ctx.root }];
    if (ctx.vhdl) steps.push({ stage: 'compile', cmd: ctx.t.vcom, args: ['-2008', '-work', lib, ...(ctx.cov ? ['+cover=bcesft'] : []), ...ctx.files], cwd: ctx.root, tool: 'vcom' });
    else steps.push({ stage: 'compile', cmd: ctx.t.vlog, args: ['-sv', '-work', lib, '+acc', ...cov, ...(ctx.assertions ? ['+define+DVFLOW_SVA'] : []), '-f', ctx.fileList], cwd: ctx.root });
    if (!ctx.vhdl) steps.push({ stage: 'elaborate', cmd: ctx.t.vopt, args: ['-work', lib, '+acc', ...(ctx.cov ? ['+cover=bcesft'] : []), ctx.tbTop, '-o', 'tb_opt'], cwd: ctx.root });
    return steps;
  },
  run(ctx) {
    const doCmd = (ctx.cov ? 'coverage save -onexit cov.ucdb; ' : '') + 'run -all; quit -f';
    return { stage: 'simulate', cmd: ctx.t.vsim, args: ['-c', '-lib', path.join(ctx.buildDir, 'work'), ...(ctx.cov ? ['-coverage'] : []), ctx.vhdl ? ctx.test : 'tb_opt', ...(ctx.vhdl ? [] : ctx.plusargs), '-do', doCmd], cwd: ctx.runDir };
  },
  smoke(dir, what) {
    const sv = what === 'uvm'
      ? '`include "uvm_macros.svh"\nmodule dvflow_doctor; import uvm_pkg::*;\n class doctor_test extends uvm_test; `uvm_component_utils(doctor_test)\n  function new(string name, uvm_component parent); super.new(name, parent); endfunction\n  task run_phase(uvm_phase phase); `uvm_info("DVFLOW", "DVFLOW_DOCTOR_OK", UVM_NONE) endtask\n endclass\n initial run_test("doctor_test");\nendmodule\n'
      : 'module dvflow_doctor; logic [3:0] c = 0; initial begin repeat (3) #1 c++; $display("DVFLOW_DOCTOR_OK c=%0d", c); $finish; end endmodule\n';
    fs.writeFileSync(path.join(dir, 'doctor.sv'), sv);
    const lib = path.join(dir, 'work');
    const cov = what === 'coverage';
    const steps = [
      { stage: 'compile', args: t => [t.vlib, [lib]] },
      { stage: 'compile', args: t => [t.vlog, ['-sv', '-work', lib, ...(cov ? ['+cover=bcesft'] : []), path.join(dir, 'doctor.sv')]] },
      { stage: 'elaborate', args: t => [t.vopt, ['-work', lib, '+acc', ...(cov ? ['+cover=bcesft'] : []), 'dvflow_doctor', '-o', 'doc_opt']] },
      { stage: 'simulate', args: t => [t.vsim, ['-c', '-lib', lib, ...(cov ? ['-coverage'] : []), 'doc_opt', '-do', (cov ? `coverage save -onexit ${path.join(dir, 'doctor.ucdb').replace(/\\/g, '/')}; ` : '') + 'run -all; quit -f']], expect: /DVFLOW_DOCTOR_OK/ }
    ];
    if (cov) steps.push({ stage: 'coverage report', args: t => [t.vcover, ['report', '-summary', path.join(dir, 'doctor.ucdb')]], needs: 'vcover', expect: /Statements|Toggle|Branch|Coverage/i });
    return steps;
  }
};

const VERILATOR = {
  id: 'verilator', label: 'Verilator', envBin: 'VERILATOR_BIN', languages: ['sv'],
  tools: [IS_WIN ? 'verilator_bin' : 'verilator'], optionalTools: ['verilator_coverage'],
  defaultDirs: () => (process.env.VERILATOR_ROOT ? [path.join(process.env.VERILATOR_ROOT, 'bin')] : []).concat(IS_WIN ? ['C:\\msys64\\ucrt64\\bin', 'C:\\msys64\\mingw64\\bin'] : ['/usr/bin', '/usr/local/bin']),
  version: t => firstLine(run(t[IS_WIN ? 'verilator_bin' : 'verilator'], ['--version']).out),
  caps: v => {
    const m = /Verilator\s+(\d+)\.(\d+)/.exec(v || '');
    const major = m ? +m[1] : 0;
    const timing = major >= 5;
    if (!m) return { lightweight: 'unknown until installed (needs Verilator >= 5)', vhdl: 'unsupported', uvm: 'unsupported', code_coverage: 'unknown until installed', functional_coverage: 'tb', simulator_covergroups: 'unsupported', assertions: 'unknown until installed', waveforms: 'unknown until installed' };
    const uvmOk = major > 5 || (major === 5 && +m[2] >= 36);   // UVM runs on Verilator >= 5.036 (UVM runner, experimental)
    return { lightweight: timing ? 'yes' : 'unsupported (needs Verilator >= 5 for --timing)', vhdl: 'unsupported', uvm: uvmOk ? 'experimental (Verilator ≥ 5.036 with the UVM runner)' : 'unsupported (needs Verilator ≥ 5.036)', code_coverage: 'yes', functional_coverage: 'tb', simulator_covergroups: 'unsupported', assertions: 'partial (immediate assertions; limited concurrent SVA)', waveforms: 'yes' };
  },
  build(ctx) {
    const v = ctx.t[IS_WIN ? 'verilator_bin' : 'verilator'];
    const obj = vobj(ctx.root, ctx.outDir, ctx.container);
    return [...(obj.ctr ? [{ stage: 'compile', cmd: 'ctr:mkdir', args: ['-p', obj.dir], cwd: ctx.root }] : []), { stage: 'compile', cmd: v, args: ['--binary', '--timing', '-j', '0', '-Wno-fatal', '-Wno-lint', '-Wno-style', '--trace', ...(ctx.cov ? ['--coverage'] : []), '--top-module', ctx.tbTop, '-Mdir', obj.dir, '-o', 'sim', '-f', ctx.fileList], cwd: ctx.root }];   // relative -Mdir: Verilator's generated Makefile cannot handle spaces in the obj_dir path
  },
  run(ctx) { const obj = vobj(ctx.root, ctx.buildDir, ctx.container); return { stage: 'simulate', cmd: obj.ctr ? obj.dir + '/sim' : path.join(ctx.buildDir, 'obj_dir', exe('sim')), args: ctx.plusargs, cwd: ctx.runDir }; },
  smoke(dir) {
    fs.writeFileSync(path.join(dir, 'doctor.sv'), 'module dvflow_doctor; initial begin #1; $display("DVFLOW_DOCTOR_OK"); $finish; end endmodule\n');
    const v = t => t[IS_WIN ? 'verilator_bin' : 'verilator'];
    return [{ stage: 'compile', args: t => [v(t), ['--binary', '--timing', '-Mdir', path.join(dir, 'obj_dir'), '-o', 'doc', path.join(dir, 'doctor.sv')]] }, { stage: 'simulate', args: () => [path.join(dir, 'obj_dir', exe('doc')), []], expect: /DVFLOW_DOCTOR_OK/ }];
  }
};

const GHDL = {
  id: 'ghdl', label: 'GHDL', envBin: 'GHDL_BIN', languages: ['vhdl'],
  tools: ['ghdl'],
  defaultDirs: () => (IS_WIN ? [path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')].flatMap(d => { try { return fs.readdirSync(d).filter(n => /^ghdl/i.test(n)).map(n => path.join(d, n, 'bin')); } catch (e) { return []; } }) : ['/usr/bin', '/usr/local/bin']),
  version: t => firstLine(run(t.ghdl, ['--version']).out),
  caps: () => ({ lightweight: 'vhdl testbenches', vhdl: 'yes', uvm: 'unsupported', code_coverage: 'unsupported (mcode backend)', functional_coverage: 'tb', simulator_covergroups: 'unsupported', assertions: 'yes (VHDL assert)', waveforms: 'yes (VCD/GHW)' }),
  build(ctx) {
    const wd = path.join(ctx.outDir, 'ghdl');
    fs.mkdirSync(wd, { recursive: true });
    return [
      { stage: 'compile', cmd: ctx.t.ghdl, args: ['-a', `--std=${ctx.vhdlStd || '08'}`, `--workdir=${wd}`, ...ctx.files], cwd: ctx.root },
      ...ctx.tests.map(tb => ({ stage: 'elaborate', cmd: ctx.t.ghdl, args: ['-e', `--std=${ctx.vhdlStd || '08'}`, `--workdir=${wd}`, tb], cwd: ctx.root }))
    ];
  },
  run(ctx) { return { stage: 'simulate', cmd: ctx.t.ghdl, args: ['-r', `--std=${ctx.vhdlStd || '08'}`, `--workdir=${path.join(ctx.buildDir, 'ghdl')}`, ctx.test, ...(ctx.waves ? ['--vcd=waves.vcd'] : []), `--stop-time=${ctx.stopTime || '10ms'}`], cwd: ctx.runDir, cwdIsBuild: false }; },
  smoke(dir) {
    fs.writeFileSync(path.join(dir, 'doctor.vhd'), 'entity dvflow_doctor is end entity;\narchitecture sim of dvflow_doctor is begin\n  process begin report "DVFLOW_DOCTOR_OK"; wait; end process;\nend architecture;\n');
    return [{ stage: 'compile', args: t => [t.ghdl, ['-a', '--std=08', `--workdir=${dir}`, path.join(dir, 'doctor.vhd')]] }, { stage: 'elaborate', args: t => [t.ghdl, ['-e', '--std=08', `--workdir=${dir}`, 'dvflow_doctor']] }, { stage: 'simulate', args: t => [t.ghdl, ['-r', '--std=08', `--workdir=${dir}`, 'dvflow_doctor']], expect: /DVFLOW_DOCTOR_OK/ }];
  }
};

const VCS = {
  id: 'vcs', label: 'Synopsys VCS', envBin: 'VCS_BIN', languages: ['sv', 'vhdl'],
  tools: ['vcs'], optionalTools: ['urg'],
  defaultDirs: () => (process.env.VCS_HOME ? [path.join(process.env.VCS_HOME, 'bin')] : []),
  version: t => firstLine(run(t.vcs, ['-ID']).out),
  caps: () => ({ lightweight: 'unvalidated', vhdl: 'unvalidated', uvm: 'unvalidated', code_coverage: 'unvalidated', functional_coverage: 'unvalidated', simulator_covergroups: 'unvalidated', assertions: 'unvalidated', waveforms: 'unvalidated' }),
  build(ctx) { const cov = ctx.cov ? ['-cm', 'line+cond+fsm+tgl+branch+assert'] : []; return [{ stage: 'compile', cmd: ctx.t.vcs, args: ['-full64', '-sverilog', '-timescale=1ns/1ps', ...cov, ...(ctx.assertions ? ['+define+DVFLOW_SVA'] : []), '-top', ctx.tbTop, '-f', ctx.fileList, '-o', path.join(ctx.outDir, 'simv')], cwd: ctx.root }]; },
  run(ctx) { return { stage: 'simulate', cmd: path.join(ctx.buildDir, 'simv'), args: [...ctx.plusargs, ...(ctx.cov ? ['-cm', 'line+cond+fsm+tgl+branch+assert'] : [])], cwd: ctx.runDir }; },
  smoke(dir) {
    fs.writeFileSync(path.join(dir, 'doctor.sv'), 'module dvflow_doctor; initial begin $display("DVFLOW_DOCTOR_OK"); $finish; end endmodule\n');
    return [{ stage: 'compile', args: t => [t.vcs, ['-full64', '-sverilog', path.join(dir, 'doctor.sv'), '-o', path.join(dir, 'simv')]] }, { stage: 'simulate', args: () => [path.join(dir, 'simv'), []], expect: /DVFLOW_DOCTOR_OK/ }];
  }
};

const ADAPTERS = { questa: QUESTA, verilator: VERILATOR, icarus: ICARUS, ghdl: GHDL, vcs: VCS };

/* ------------------------------------------------------------------ log diagnosis (license vs compile vs test) */
const LICENSE_RE = /licen[cs]e|checkout|FLEXlm|lmgrd|Invalid host|Cannot connect to license server|no such feature|feature .* (not|has) .*expired|qhsimvl|msimhdlsim|SNPSLMD/i;
const LICENSE_FAIL_RE = /(licen[cs]e|checkout).*(fail|error|unable|invalid|denied|expired|cannot|not found)|Unable to checkout|Invalid host|Cannot find license file|Cannot connect to license server|License Issue/i;
function diagnose(text) {
  const lines = String(text || '').split(/\r?\n/);
  const lic = lines.map((l, i) => ({ l, i })).filter(x => LICENSE_FAIL_RE.test(x.l));
  if (lic.length) return { kind: 'license', line: lic[0].i + 1, lines: lic.slice(0, 6).map(x => x.l.trim()) };
  const err = lines.map((l, i) => ({ l, i })).find(x => /^\*\* (Error|Fatal)|^%Error|\berror\b:|syntax error|Error-\[/.test(x.l) && !LICENSE_RE.test(x.l));
  if (err) return { kind: 'error', line: err.i + 1, lines: [err.l.trim()] };
  return null;
}

function compileErrors(log) {
  const out = [];
  let m;
  const res = [
    [/^(.+?):(\d+):(?:\d+:)?\s*(error|syntax error|warning|sorry):\s*(.*)$/gim, (m) => ({ file: m[1].trim(), line: +m[2], severity: /warn/i.test(m[3]) ? 'warning' : 'error', message: m[4] })],
    [/\*\* (Error|Warning)[^:]*:\s*(?:\([^)]*\)\s*)?(\S.*?)\((\d+)\):\s*(.*)$/gm, (m) => ({ file: m[2].trim(), line: +m[3], severity: m[1].toLowerCase(), message: m[4] })],
    [/^%(Error|Warning)(?:-[A-Z0-9_]+)?:\s*(.+?):(\d+):(?:\d+:)?\s*(.*)$/gm, (m) => ({ file: m[2].trim(), line: +m[3], severity: m[1].toLowerCase(), message: m[4] })],
    [/^(.+?\.vhdl?):(\d+):(\d+):\s*(.*)$/gim, (m) => ({ file: m[1].trim(), line: +m[2], severity: /warning/i.test(m[4]) ? 'warning' : 'error', message: m[4] })]
  ];
  for (const [re, f] of res) { re.lastIndex = 0; while ((m = re.exec(log))) { if (/^\$|^#/.test(m[0])) continue; if (/^(I give up|\d+ error)/i.test(m[1] || '')) continue; out.push(f(m)); } }
  return out;
}

/* ------------------------------------------------------------------ detection */
function detect(simId, ov) {
  const a = ADAPTERS[simId];
  if (!a) return { available: false, reason: `unknown simulator '${simId}'` };
  const r = resolveTools(a, ov);
  if (r.missing.length) {
    return { available: false, adapter: a, tools: r.tools, missing: r.missing, source: r.source, spec: r.spec,
      reason: `${r.missing.join(', ')} not found ${r.spec ? `in ${r.spec} (from ${r.source})` : 'on PATH'}${r.containerReason ? `; container toolchain: ${r.containerReason}` : ''}` };
  }
  const version = (r.container && require('./container').toolVersion(simId)) || a.version(r.tools) || '';
  return { available: true, adapter: a, tools: r.tools, dir: r.dir, source: r.source, spec: r.spec, version, caps: a.caps(version), container: !!r.container };
}

function fixHint(simId) {
  const a = ADAPTERS[simId];
  const v = a ? a.envBin : 'SIM_BIN';
  return `Set the ${a ? a.label : simId} location: make ... SIM=${simId} ${v}=<install-or-bin-dir>, or "${v}" in the environment, or "DV: Configure Simulators" in the extension (writes ${USER_FILE}).`;
}

function capabilities(ov) {
  return Object.values(ADAPTERS).map(a => {
    const d = detect(a.id, ov && ov[a.id]);
    return { id: a.id, label: a.label, available: d.available, version: d.version || '', reason: d.reason || '', bin: d.dir || '', source: d.source || '', caps: d.caps || a.caps(''), languages: a.languages };
  });
}

/** Simulators (other than simId) that are available and support a feature. */
function alternatives(feature, simId, ov) {
  return capabilities(ov).filter(c => c.id !== simId && c.available && /^yes/.test(String(c.caps[feature] || ''))).map(c => c.label + ` (SIM=${c.id})`);
}

/* ------------------------------------------------------------------ doctor */
function doctor(simId, opts) {
  opts = opts || {};
  const L = [];
  const stages = [];
  const add = (stage, ok, detail, next) => { stages.push({ stage, ok, detail, next }); };
  const a = ADAPTERS[simId];
  if (!a) { add('select', false, `unknown simulator '${simId}'`, `Use one of: ${Object.keys(ADAPTERS).join(', ')}`); return { simId, stages, ok: false }; }
  const r = resolveTools(a, opts.override);
  const allTools = a.tools.concat(a.optionalTools || []);
  const toolLines = allTools.map(t => `${t.padEnd(18)} ${r.tools[t] ? r.tools[t] : (a.tools.includes(t) ? 'MISSING' : 'not found (optional)')}`);
  if (r.missing.length) {
    add('installation', false, `resolved from ${r.source}${r.spec ? ` (${r.spec})` : ''}\n${toolLines.join('\n')}`, `Missing ${r.missing.join(', ')}. ${fixHint(simId)}`);
    return { simId, stages, ok: false, source: r.source };
  }
  const version = a.version(r.tools);
  add('installation', true, `resolved from ${r.source}${r.spec ? ` (${r.spec})` : ''}\nversion: ${version}\n${toolLines.join('\n')}`);
  const lic = LICENSE_VARS.filter(k => licenseEnv(simId)[k]);
  const caps = a.caps(version);
  const checks = [['smoke', 'batch smoke simulation (exercises the simulation license)']];
  if (opts.uvm) checks.push(['uvm', 'UVM compile + run_test']);
  if (opts.coverage) checks.push(['coverage', 'coverage collection + report']);
  for (const [what, title] of checks) {
    if (what === 'uvm' && /^experimental/.test(caps.uvm)) { add(title, true, `UVM is ${caps.uvm}. Validate with the project's own UVM testbench: dvflow uvm --sim ${simId} --test <test>`); continue; }
    if (what === 'uvm' && !/^yes/.test(caps.uvm)) { add(title, false, `UVM is ${caps.uvm} on ${a.label}`, `Use a simulator with UVM: ${alternatives('uvm', simId).join(', ') || 'none configured (QuestaSim or VCS)'}`); continue; }
    if (what === 'coverage' && !/^yes/.test(caps.code_coverage)) { add(title, false, `code coverage is ${caps.code_coverage} on ${a.label}`, `Use: ${alternatives('code_coverage', simId).join(', ') || 'QuestaSim, VCS or Verilator'}`); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvflow-doctor-'));
    const steps = a.smoke(dir, what);
    let ok = true, detail = '', next = '';
    for (const s of steps) {
      if (s.needs && !r.tools[s.needs]) { ok = false; detail = `${s.needs} not found`; next = `${s.needs} is required for ${title}. ${fixHint(simId)}`; break; }
      const [cmd, args] = s.args(r.tools);
      const res = run(cmd, args, { cwd: dir, env: licenseEnv(simId, opts.override), timeout: 180000, container: !!r.container });
      const text = redact(res.out + (res.error ? '\n' + res.error : ''), simId);
      const dg = diagnose(text);
      if (dg && dg.kind === 'license') { ok = false; detail = `stage: ${s.stage}\n` + dg.lines.join('\n'); next = `License checkout failed (${lic.length ? 'license set via ' + lic.join(', ') : 'no license variable set'}). Fix the per-user license setting ("DV: Configure Simulators" or ~/.dvflow/simulators.json "license") or contact your license administrator, then run: make check-tools SIM=${simId}`; break; }
      if (res.code !== 0 || (s.expect && !s.expect.test(res.out))) { ok = false; detail = `stage: ${s.stage} (exit ${res.code})\n` + text.split(/\r?\n/).filter(Boolean).slice(-8).join('\n'); next = `The ${s.stage} step of the smoke test failed; see the output above.`; break; }
      detail += `${s.stage}: ok\n`;
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* keep */ }
    add(title, ok, detail.trim(), next);
  }
  return { simId, label: a.label, version, stages, ok: stages.every(s => s.ok), source: r.source, licenseVars: lic, caps };
}

module.exports = { ADAPTERS, detect, capabilities, alternatives, doctor, resolveTools, resolveLocal, licenseEnv, redact, diagnose, compileErrors, fixHint, loadUser, saveUser, USER_FILE, IS_WIN, LICENSE_VARS };
