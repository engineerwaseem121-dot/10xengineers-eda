'use strict';
/*
 * Container toolchain: run the open-source tools (Icarus, Verilator, GHDL, Yosys, SymbiYosys, Python/cocotb, make)
 * from the 10xEngineers EDA Docker image instead of local installs.
 *
 * Engines:  docker (Docker Desktop / Linux / macOS) · docker inside WSL (Windows, no Docker Desktop) · podman
 * Mode:     auto      (default) local tool when installed, container otherwise
 *           container always the container for open-source tools
 *           local     never the container
 * Config precedence: configure() from the extension > env (DVFLOW_TOOLCHAIN, DVFLOW_IMAGE, DVFLOW_ENGINE, DVFLOW_WSL_DISTRO)
 *                    > ~/.dvflow/simulators.json "toolchain" > defaults
 *
 * One long-running container per mount set ("tenx-eda-<hash>"); tools run with `docker exec`.
 * Mounted: the project roots, the temp folder and ~/.dvflow, at the same path in Linux form
 * (C:\Users\me\proj -> /mnt/c/Users/me/proj), so paths in arguments and file lists are rewritten, never copied.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const DEFAULT_IMAGE = '10xengineers/eda-tools:1';
const USER_FILE = path.join(os.homedir(), '.dvflow', 'simulators.json');
const CACHE_FILE = path.join(os.homedir(), '.dvflow', 'toolchain-cache.json');
/** simulator adapters the image provides, and the image tool for each adapter tool name */
const SUPPORTED = ['icarus', 'verilator', 'ghdl'];
const CTR_NAME = { verilator_bin: 'verilator' };
const VERSION_KEY = { icarus: 'vvp', verilator: 'verilator', ghdl: 'ghdl' };

let explicit = {};
let roots = [];
const memo = {};
const cached = (k, ms, f) => { const m = memo[k]; if (m && Date.now() - m.t < ms) return m.v; const v = f(); memo[k] = { t: Date.now(), v }; return v; };
const invalidate = () => { for (const k of Object.keys(memo)) delete memo[k]; };

function readUser() { try { return JSON.parse(fs.readFileSync(USER_FILE, 'utf8').replace(/^\uFEFF/, '')).toolchain || {}; } catch (e) { return {}; } }
function config() {
  const u = readUser();
  const pick = (k, env, d) => explicit[k] || process.env[env] || u[k] || d;
  return { mode: pick('mode', 'DVFLOW_TOOLCHAIN', 'auto'), image: pick('image', 'DVFLOW_IMAGE', DEFAULT_IMAGE), engine: pick('engine', 'DVFLOW_ENGINE', 'auto'), distro: pick('distro', 'DVFLOW_WSL_DISTRO', ''), mounts: explicit.mounts || u.mounts || [] };
}
/** called by the extension (settings) and the CLI (project root) */
function configure(o) { explicit = Object.assign({}, explicit, o || {}); if (o && o.roots) roots = o.roots.filter(Boolean); invalidate(); }

function sh(cmd, args, opts) {
  try {
    const r = cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 }, opts || {}));
    return { code: r.error ? -1 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), error: r.error ? r.error.message : null };
  } catch (e) { return { code: -1, out: '', err: '', error: e.message }; }
}
const onPath = n => (process.env.PATH || '').split(path.delimiter).some(d => d && fs.existsSync(path.join(d, IS_WIN ? n + '.exe' : n)));

/* ---------------------------------------------------------------- engine */
/** { kind: 'docker'|'wsl'|'podman', cmd, pre:[], paths: 'win'|'wsl'|'posix', label } or { error } */
function engine() {
  return cached('engine', 30000, () => {
    const c = config();
    const tryDocker = (bin, kind) => {
      if (!onPath(bin)) return null;
      const r = sh(bin, ['version', '--format', '{{.Server.Version}}'], { timeout: 20000 });
      return r.code === 0 && r.out ? { kind, cmd: bin, pre: [], paths: IS_WIN ? 'win' : 'posix', label: `${bin} ${r.out}` } : { error: `${bin} is installed but its engine is not running (${(r.err || r.error || '').split('\n')[0]})` };
    };
    const tryWsl = () => {
      if (!IS_WIN || !onPath('wsl')) return null;
      const pre = c.distro ? ['-d', c.distro, '--exec'] : ['--exec'];
      const r = sh('wsl.exe', [...pre, 'docker', 'version', '--format', '{{.Server.Version}}'], { timeout: 60000 });
      if (r.code === 0 && r.out) return { kind: 'wsl', cmd: 'wsl.exe', pre: [...pre, 'docker'], paths: 'wsl', label: `docker ${r.out} in WSL${c.distro ? ' (' + c.distro + ')' : ''}` };
      const txt = (r.out + ' ' + r.err).toLowerCase();
      if (/permission denied/.test(txt)) return { error: 'Docker in WSL needs your user in the "docker" group: run  wsl -u root usermod -aG docker <you>  then  wsl --shutdown' };
      if (/cannot connect|is the docker daemon running/.test(txt)) return { error: 'Docker is installed in WSL but not running: run  wsl -u root systemctl start docker' };
      return null;
    };
    const order = c.engine === 'docker' ? [() => tryDocker('docker', 'docker')] : c.engine === 'podman' ? [() => tryDocker('podman', 'podman')] : c.engine === 'wsl' ? [tryWsl]
      : [() => tryDocker('docker', 'docker'), tryWsl, () => tryDocker('podman', 'podman')];
    let firstErr = null;
    for (const f of order) { const e = f(); if (e && !e.error) return e; if (e && e.error && !firstErr) firstErr = e; }
    return firstErr || { error: IS_WIN ? 'No container engine found: install Docker Desktop, or Docker Engine inside WSL ("10xEngineers EDA: Set Up Open-Source Toolchain" explains both).' : 'No container engine found: install Docker or Podman.' };
  });
}
function run(args, opts) { const e = engine(); if (e.error) return { code: -1, out: '', err: e.error, error: e.error }; return sh(e.cmd, [...e.pre, ...args], opts); }

/* ---------------------------------------------------------------- paths */
/** host path -> path inside the container (same path, Linux form) */
function toCtr(p) {
  if (!p) return p;
  const s = String(p);
  if (IS_WIN) { const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(s); return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/') : s.replace(/\\/g, '/'); }
  return s;
}
/** rewrite every Windows absolute path embedded in a string (e.g. +incdir+C:\x, -Mdir=C:\x, file-list lines) */
function mapText(s) { return IS_WIN ? String(s).replace(/\b([A-Za-z]):[\\/][^\s"'<>|;,]*/g, m => toCtr(m)) : String(s); }
/** the engine's view of a host path for -v (Docker Desktop takes Windows paths, WSL docker takes /mnt/x paths) */
function hostForEngine(p, e) { return e.paths === 'wsl' ? toCtr(p) : p; }

function mountList() {
  const c = config();
  const list = [...roots, ...(c.mounts || []), os.tmpdir(), path.join(os.homedir(), '.dvflow')].filter(Boolean).map(p => path.resolve(p));
  const norm = p => (IS_WIN ? p.toLowerCase() : p).replace(/[\\/]+$/, '');
  const uniq = [...new Map(list.map(p => [norm(p), p])).values()].sort((a, b) => a.length - b.length);
  return uniq.filter((p, i) => !uniq.slice(0, i).some(q => norm(p).startsWith(norm(q) + path.sep) || norm(p).startsWith(norm(q) + '/')));
}
function mounted(p) {
  const n = s => (IS_WIN ? s.toLowerCase() : s).replace(/[\\/]+/g, '/');
  return mountList().some(m => n(path.resolve(p)) === n(m) || n(path.resolve(p)).startsWith(n(m) + '/'));
}

/* ---------------------------------------------------------------- image */
function imageInfo() {
  return cached('image', 60000, () => {
    const c = config();
    const r = run(['image', 'inspect', c.image, '--format', '{{.Id}}'], { timeout: 30000 });
    if (r.code !== 0 || !r.out) return { present: false, image: c.image };
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { /* none */ }
    if (cache.id !== r.out) {
      const t = run(['run', '--rm', c.image, 'cat', '/etc/tenx-eda-tools.json'], { timeout: 120000 });
      let tools = {};
      try { tools = JSON.parse(t.out).tools || {}; } catch (e) { /* older image */ }
      cache = { id: r.out, image: c.image, tools };
      try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch (e) { /* read-only home */ }
    }
    return { present: true, image: c.image, id: r.out, tools: cache.tools || {} };
  });
}

/** Is the container toolchain usable?  { ok, reason, engine, image } */
function available() {
  const c = config();
  if (c.mode === 'local') return { ok: false, reason: 'toolchain mode is "local"' };
  const e = engine();
  if (e.error) return { ok: false, reason: e.error };
  const im = imageInfo();
  if (!im.present) return { ok: false, reason: `image ${c.image} is not built yet — run "10xEngineers EDA: Set Up Open-Source Toolchain"`, engine: e };
  return { ok: true, engine: e, image: im };
}
/** Should this simulator run in the container?  localMissing: the local tools were not found */
function shouldUse(simId, localMissing, explicitLocal) {
  if (!SUPPORTED.includes(simId)) return false;
  const m = config().mode;
  if (m === 'local') return false;
  if (m === 'auto' && (!localMissing || explicitLocal)) return false;
  return true;
}

/* ---------------------------------------------------------------- container lifecycle */
/*
 * WSL stops an idle distribution a few seconds after the last process started from Windows ends, which also stops
 * dockerd and the toolchain container. While the toolchain is in use, keep one cheap process running in the distro.
 */
let keeper = null;
function keepAlive(e) {
  if (!e || e.kind !== 'wsl') return;
  if (keeper && keeper.exitCode === null && !keeper.killed) return;
  const c = config();
  try {
    keeper = cp.spawn('wsl.exe', [...(c.distro ? ['-d', c.distro] : []), '--exec', 'sleep', '3600'], { windowsHide: true, stdio: 'ignore' });
    keeper.unref();
    keeper.on('error', () => { keeper = null; });
    if (!keepAlive.hooked) { keepAlive.hooked = true; process.on('exit', () => { try { if (keeper) keeper.kill(); } catch (x) { /* gone */ } }); }
  } catch (x) { keeper = null; }
}

function name() { const c = config(); return 'tenx-eda-' + crypto.createHash('sha1').update(c.image + '|' + mountList().join('|')).digest('hex').slice(0, 10); }
function ensure() {
  const e0 = engine();
  if (!e0.error) keepAlive(e0);
  return cached('ensure:' + name(), 20000, () => {
    const e = engine(); if (e.error) throw new Error(e.error);
    const c = config(), n = name();
    const st = run(['inspect', '-f', '{{.State.Running}}', n], { timeout: 30000 });
    if (st.code === 0 && st.out === 'true') return n;
    if (st.code === 0) { const s = run(['start', n], { timeout: 60000 }); if (s.code === 0) return n; run(['rm', '-f', n]); }
    const args = ['run', '-d', '--name', n, '--label', 'com.10xengineers.eda=toolchain', '--init', '--restart', 'unless-stopped'];
    for (const m of mountList()) args.push('-v', `${hostForEngine(m, e)}:${toCtr(m)}`);
    if (!IS_WIN && process.getuid) args.push('-u', `${process.getuid()}:${process.getgid()}`);
    args.push(c.image, 'sleep', 'infinity');
    const r = run(args, { timeout: 120000 });
    if (r.code !== 0) throw new Error(`could not start the toolchain container: ${(r.err || r.error || r.out).split('\n')[0]}`);
    return n;
  });
}
function stopAll() {
  const r = run(['ps', '-aq', '--filter', 'label=com.10xengineers.eda=toolchain']);
  const ids = r.out.split(/\s+/).filter(Boolean);
  if (ids.length) run(['rm', '-f', ...ids], { timeout: 60000 });
  invalidate();
  return ids.length;
}

/* ---------------------------------------------------------------- command translation */
/**
 * {cmd, args, cwd} -> the engine command that runs it inside the container.
 *   cmd 'ctr:<tool>'  a tool from the image;  c.container  a host path to a Linux binary built in the project (e.g. Verilator's obj_dir/sim)
 * The returned object carries onKill() so a cancelled / timed-out run also stops the process inside the container.
 */
function wrap(c) {
  const e = engine(); if (e.error) throw new Error(e.error);
  const n = ensure();
  let tool = String(c.cmd);
  if (tool.startsWith('ctr:')) tool = tool.slice(4);
  else { tool = toCtr(tool); if (IS_WIN) tool = tool.replace(/\.exe$/i, ''); }
  const args = [];
  const list = c.args || [];
  for (let i = 0; i < list.length; i++) {
    const a = String(list[i]);
    if ((list[i - 1] === '-f' || list[i - 1] === '-F') && /\.(f|vc)$/i.test(a) && fs.existsSync(path.resolve(c.cwd || '.', a))) {
      // file lists contain host paths too: translate into a sibling copy
      const src = path.resolve(c.cwd || '.', a);
      try {
        const txt = fs.readFileSync(src, 'utf8'), mapped = mapText(txt);
        if (mapped === txt) { args.push(mapText(a)); continue; }      // relative paths only: use it as is
        const dst = src.replace(/(\.[^.]+)$/, '.ctr$1');
        fs.writeFileSync(dst, mapped); args.push(toCtr(dst)); continue;
      } catch (err) { /* fall through */ }
    }
    args.push(mapText(a));
  }
  const cwd = c.cwd ? toCtr(path.resolve(c.cwd)) : '/tmp';
  const job = crypto.randomBytes(6).toString('hex');
  const envFlags = [];
  for (const [k, v] of Object.entries(c.ctrEnv || {})) envFlags.push('-e', `${k}=${mapText(v)}`);
  // setsid + pid file: the whole process group can be killed from outside
  const script = 'echo $$ > /tmp/tenx-job-' + job + '.pid; exec "$@"';
  // setsid -w: wait for the child (setsid forks when the caller already leads a group) and return its exit status
  const out = { stage: c.stage, cmd: e.cmd, args: [...e.pre, 'exec', '-i', '-w', cwd, ...envFlags, n, 'setsid', '-w', 'sh', '-c', script, 'sh', tool, ...args], cwd: os.tmpdir(), container: false, inContainer: true, display: [tool, ...args].join(' ') };
  out.onKill = () => run(['exec', n, 'sh', '-c', `kill -TERM -$(cat /tmp/tenx-job-${job}.pid) 2>/dev/null; sleep 1; kill -KILL -$(cat /tmp/tenx-job-${job}.pid) 2>/dev/null; rm -f /tmp/tenx-job-${job}.pid`], { timeout: 15000 });
  return out;
}
/** synchronous helper used for version probes and small utilities */
function execSync(tool, args, opts) { const w = wrap({ cmd: 'ctr:' + tool, args: args || [], cwd: (opts && opts.cwd) || os.tmpdir() }); return sh(w.cmd, w.args, Object.assign({ timeout: 120000 }, opts || {}, { cwd: os.tmpdir() })); }

/** can a non-simulator tool (lint, yosys, sby, python…) fall back to the container for these host paths? */
function canRun(paths) {
  if (config().mode === 'local') return false;
  if (!available().ok) return false;
  return (paths || []).every(p => !p || mounted(p));
}
/** async run of an image tool; resolves { code, out, err } */
function execAsync(tool, args, cwd, timeoutMs) {
  return new Promise(resolve => {
    let w;
    try { w = wrap({ cmd: 'ctr:' + tool, args, cwd }); } catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    const p = cp.execFile(w.cmd, w.args, { cwd: w.cwd, timeout: timeoutMs || 180000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, so, se) => {
      if (err && err.killed && w.onKill) w.onKill();
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: String(so || ''), err: String(se || '') });
    });
    return p;
  });
}

/** tools reported by the image for an adapter (no exec needed) */
function toolVersion(simId) { const im = imageInfo(); return (im.tools || {})[VERSION_KEY[simId]] || ''; }

/** shell command for an interactive terminal in the container */
function shellCommand(cwd) {
  const e = engine(); if (e.error) throw new Error(e.error);
  const n = ensure();
  return { cmd: e.cmd, args: [...e.pre, 'exec', '-it', '-w', toCtr(cwd || os.homedir()), n, 'bash'] };
}

/** build the image from the bundled Dockerfile, streaming output; returns a child process */
function build(contextDir, onData) {
  const e = engine(); if (e.error) throw new Error(e.error);
  const c = config();
  const p = cp.spawn(e.cmd, [...e.pre, 'build', '-t', c.image, hostForEngine(contextDir, e)], { windowsHide: true });
  p.stdout.on('data', d => onData(String(d)));
  p.stderr.on('data', d => onData(String(d)));
  p.on('close', () => invalidate());
  return p;
}
function pull(onData) {
  const e = engine(); if (e.error) throw new Error(e.error);
  const p = cp.spawn(e.cmd, [...e.pre, 'pull', config().image], { windowsHide: true });
  p.stdout.on('data', d => onData(String(d)));
  p.stderr.on('data', d => onData(String(d)));
  p.on('close', () => invalidate());
  return p;
}

/** non-blocking probe for UI start-up: { engine: bool, image: bool, error } (never blocks the extension host) */
function probeAsync() {
  const c = config();
  const ex = (cmd, args) => new Promise(res => cp.execFile(cmd, args, { windowsHide: true, timeout: 60000 }, (err, so) => res({ ok: !err, out: String(so || '').trim() })));
  const tries = [];
  if (onPath('docker')) tries.push({ cmd: 'docker', pre: [] });
  if (IS_WIN && onPath('wsl')) tries.push({ cmd: 'wsl.exe', pre: [...(c.distro ? ['-d', c.distro] : []), '--exec', 'docker'] });
  if (onPath('podman')) tries.push({ cmd: 'podman', pre: [] });
  return tries.reduce((p, t) => p.then(async r => {
    if (r.engine) return r;
    const v = await ex(t.cmd, [...t.pre, 'version', '--format', '{{.Server.Version}}']);
    if (!v.ok || !v.out) return r;
    const im = await ex(t.cmd, [...t.pre, 'image', 'inspect', c.image, '--format', '{{.Id}}']);
    return { engine: true, image: im.ok && !!im.out, label: `${t.cmd === 'wsl.exe' ? 'docker in WSL' : t.cmd} ${v.out}` };
  }), Promise.resolve({ engine: false, image: false }));
}

/** everything the status view shows */
function status() {
  const c = config();
  const e = engine();
  const im = e.error ? { present: false, image: c.image } : imageInfo();
  let running = false;
  if (!e.error && im.present) { const r = run(['inspect', '-f', '{{.State.Running}}', name()], { timeout: 20000 }); running = r.out === 'true'; }
  return { mode: c.mode, image: c.image, engine: e, imageInfo: im, container: name(), running, mounts: mountList(), supported: SUPPORTED };
}

module.exports = { configure, config, engine, available, shouldUse, ensure, wrap, execSync, execAsync, canRun, probeAsync, toCtr, mapText, mounted, mountList, imageInfo, toolVersion, shellCommand, build, pull, status, stopAll, name, invalidate, SUPPORTED, CTR_NAME, DEFAULT_IMAGE };
