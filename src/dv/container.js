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
/*
 * Managed image: <repository>:<version> from container/image.json (shipped with the extension). Newer tags with the
 * same major version ("compat") are used only after they were downloaded AND passed the image's smoke test
 * (recorded in ~/.dvflow/toolchain-active.json). A user setting / DVFLOW_IMAGE overrides all of this.
 */
const SPEC = (() => {
  for (const f of [process.env.DVFLOW_IMAGE_SPEC, path.join(__dirname, '..', '..', 'container', 'image.json')]) {
    try { if (f) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* next */ }
  }
  return { repository: 'ghcr.io/engineerwaseem121-dot/eda-tools', version: '1.0.0', compat: '1' };
})();
const DEFAULT_IMAGE = `${SPEC.repository}:${SPEC.version}`;
const LEGACY_IMAGE = '10xengineers/eda-tools:1';          // locally built image of extension versions before 0.16
const DVDIR = path.join(os.homedir(), '.dvflow');
const USER_FILE = path.join(DVDIR, 'simulators.json');
const CACHE_FILE = path.join(DVDIR, 'toolchain-cache.json');
const ACTIVE_FILE = path.join(DVDIR, 'toolchain-active.json');     // last image that passed the smoke test
const UPDATE_FILE = path.join(DVDIR, 'toolchain-update.json');     // last update check
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
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const writeJson = (f, o) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) { /* read-only home */ } };

/* ---------------------------------------------------------------- versions */
const semver = s => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s || '')); return m ? [+m[1], +m[2], +m[3]] : null; };
const cmpVer = (a, b) => { const x = semver(a), y = semver(b); if (!x || !y) return 0; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const tagOf = img => { const m = /:([^:/@]+)$/.exec(String(img)); return m ? m[1] : 'latest'; };
const repoOf = img => String(img).replace(/@.*$/, '').replace(/:([^:/]+)$/, '');
/** is this tag a compatible update of the managed image (same major version)? */
const compatible = tag => { const v = semver(tag); return !!v && String(v[0]) === String(SPEC.compat || semver(SPEC.version)[0]); };

/** the managed image to use: the newer of the shipped version and the last smoke-tested update */
function managedImage() {
  const a = readJson(ACTIVE_FILE);
  if (a && a.image && repoOf(a.image) === SPEC.repository && compatible(tagOf(a.image)) && cmpVer(tagOf(a.image), SPEC.version) > 0) return a.image;
  return DEFAULT_IMAGE;
}
/** an image setting means "managed" when empty or still the old built-locally default */
const isManaged = v => !v || v === LEGACY_IMAGE || v === 'managed';
let runtimeImage = null;    // set when the managed image could not be fetched and an older local image is used instead
function config() {
  const u = readUser();
  const pick = (k, env, d) => explicit[k] || process.env[env] || u[k] || d;
  const set = explicit.image || process.env.DVFLOW_IMAGE || u.image || '';
  const managed = isManaged(set);
  return { mode: pick('mode', 'DVFLOW_TOOLCHAIN', 'auto'), image: managed ? (runtimeImage || managedImage()) : set, managed, engine: pick('engine', 'DVFLOW_ENGINE', 'auto'), distro: pick('distro', 'DVFLOW_WSL_DISTRO', ''), mounts: explicit.mounts || u.mounts || [], autoUpdate: explicit.autoUpdate !== false };
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
/**
 * Rewrite the Windows absolute path(s) in one argument / one file-list line (+incdir+C:\x, -Mdir=C:\x, C:\a b\c.sv).
 * A single path runs to the end of the argument, so folder names with spaces survive; quoted paths are mapped inside
 * their quotes; several paths in one argument fall back to whitespace-separated matching.
 */
function mapArg(s) {
  s = String(s);
  if (!IS_WIN) return s;
  if (/"[A-Za-z]:[\\/]/.test(s)) return s.replace(/"([A-Za-z]:[\\/][^"]*)"/g, (m, p) => '"' + toCtr(p) + '"');
  const i = s.search(/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/);
  if (i < 0) return s;
  const at = /^[A-Za-z]:/.test(s.slice(i)) ? i : i + 1;
  const rest = s.slice(at);
  if (/[^A-Za-z0-9][A-Za-z]:[\\/]/.test(rest.slice(2))) return s.replace(/\b([A-Za-z]):[\\/][^\s"'<>|;,]*/g, m => toCtr(m));
  return s.slice(0, at) + toCtr(rest);
}
/** every line of a text (file lists, env values) */
function mapText(s) { return IS_WIN ? String(s).split(/(\r?\n)/).map(x => (/\r?\n/.test(x) ? x : mapArg(x))).join('') : String(s); }
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
      let tools = {}, version = '';
      try { const j = JSON.parse(t.out); tools = j.tools || {}; version = j.image_version || ''; } catch (e) { /* older image */ }
      cache = { id: r.out, image: c.image, tools, version };
      writeJson(CACHE_FILE, cache);
    }
    return { present: true, image: c.image, id: r.out, tools: cache.tools || {}, version: cache.version || tagOf(c.image) };
  });
}

/** Is the container toolchain usable?  { ok, reason, engine, image } */
function available() {
  const c = config();
  if (c.mode === 'local') return { ok: false, reason: 'toolchain mode is "local"' };
  const e = engine();
  if (e.error) return { ok: false, reason: e.error };
  const im = imageInfo();
  if (!im.present) return { ok: false, reason: `image ${c.image} is not on this machine yet — it is downloaded automatically on the first run that needs it (or run "10xEngineers EDA: Update Simulation Tools")`, engine: e };
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
    if (r.code !== 0) {
      // another window / terminal created the same container a moment ago: use theirs
      if (/Conflict|already in use/i.test(r.err + r.out)) {
        for (let i = 0; i < 20; i++) {
          const s = run(['inspect', '-f', '{{.State.Running}}', n], { timeout: 30000 });
          if (s.code === 0 && s.out === 'true') return n;
          if (s.code === 0) run(['start', n], { timeout: 60000 });
          cp.spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
        }
      }
      throw new Error(`could not start the toolchain container: ${(r.err || r.error || r.out).split('\n')[0]}`);
    }
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

/* ================================================================ first-run download, updates, smoke test */

const present = img => run(['image', 'inspect', img, '--format', '{{.Id}}'], { timeout: 30000 }).code === 0;

/** turn `docker pull` failures into something a user can act on */
function pullError(img, text) {
  const t = String(text || '');
  const reg = repoOf(img).split('/')[0];
  if (/denied|unauthorized|authentication required/i.test(t)) return `${img}: access denied by ${reg}. The image is private or not published yet — the publisher must make the package public (GitHub → Packages → eda-tools → Package settings → Change visibility), or you can run "docker login ${reg}" first.`;
  if (/manifest unknown|not found: manifest|manifest .* not found|no such manifest/i.test(t)) return `${img} does not exist on ${reg} (tag not published yet). The publisher needs to publish it, or set tenxDebug.toolchain.image to a published tag. Until then: "Set Up Open-Source Toolchain" → Build the image on this machine.`;
  if (/dial tcp|no such host|temporary failure in name resolution|i\/o timeout|network is unreachable|tls handshake|connection refused|EAI_AGAIN|ENOTFOUND/i.test(t)) return `could not reach ${reg} to download ${img} (offline, proxy or firewall?): ${t.split('\n').find(l => /dial tcp|no such host|timeout|unreachable|refused|tls/i.test(l)) || t.split('\n')[0]}`;
  if (/no space left/i.test(t)) return `not enough disk space to download ${img} (~1.2 GB): free space in Docker's storage and try again.`;
  return `docker pull ${img} failed: ${t.trim().split('\n').slice(-2).join(' ')}`;
}

/** async process with streamed output; resolves { code, out } and is killed when the token is cancelled */
function spawnStream(args, onLine, token, timeoutMs) {
  return new Promise(resolve => {
    const e = engine(); if (e.error) return resolve({ code: -1, out: e.error });
    let out = '', buf = '', done = false;
    const p = cp.spawn(e.cmd, [...e.pre, ...args], { windowsHide: true });
    const line = d => { out += d; buf += d; const parts = buf.split(/\r?\n|\r/); buf = parts.pop(); parts.forEach(l => l.trim() && onLine && onLine(l.trim())); };
    p.stdout.on('data', d => line(String(d))); p.stderr.on('data', d => line(String(d)));
    const stop = why => { if (done) return; try { p.kill(); } catch (x) { /* gone */ } out += `\n${why}`; };
    const cancelTimer = token ? setInterval(() => { if (token.isCancellationRequested || token.cancelled) stop('cancelled'); }, 300) : null;
    const t = timeoutMs ? setTimeout(() => stop('timed out'), timeoutMs) : null;
    p.on('error', err => { out += err.message; });
    p.on('close', code => { done = true; if (cancelTimer) clearInterval(cancelTimer); if (t) clearTimeout(t); if (buf.trim() && onLine) onLine(buf.trim()); resolve({ code: code == null ? -1 : code, out }); });
  });
}

/** cross-process lock (extension windows + CLI share Docker): one download per image at a time */
function lockPath(img) { return path.join(DVDIR, 'locks', 'pull-' + crypto.createHash('sha1').update(img).digest('hex').slice(0, 12) + '.lock'); }
async function withLock(img, log, token, fn) {
  const f = lockPath(img);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let told = false;
  for (;;) {
    try { const fd = fs.openSync(f, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, image: img, at: Date.now() })); fs.closeSync(fd); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const o = readJson(f) || {};
      let alive = false; try { process.kill(o.pid, 0); alive = true; } catch (x) { alive = false; }
      if (!alive || Date.now() - (o.at || 0) > 45 * 60000) { try { fs.unlinkSync(f); } catch (x) { /* raced */ } continue; }   // stale lock
      if (!told) { told = true; log(`[toolchain] another window / terminal is already downloading ${img}; waiting for it …`); }
      if (token && (token.isCancellationRequested || token.cancelled)) throw new Error('cancelled while waiting for the image download');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  try { return await fn(); } finally { try { fs.unlinkSync(f); } catch (x) { /* gone */ } }
}

/** docker pull with a readable progress line in the log: layers done / total, elapsed time */
async function pullImage(img, log, token) {
  const layers = new Map(), t0 = Date.now();
  let last = '', lastAt = 0;
  // one progress line at most every 3 s (and the final one), so a slow download does not flood the output
  const report = force => {
    const total = layers.size, done = [...layers.values()].filter(s => /complete|already exists/i.test(s)).length;
    const dl = [...layers.values()].filter(s => /download/i.test(s) && !/complete/i.test(s)).length;
    const msg = total ? `[toolchain] downloading ${img}: ${done}/${total} layers ready${dl ? `, ${dl} downloading` : ''} (${Math.round((Date.now() - t0) / 1000)} s)` : '';
    if (!msg || msg === last) return;
    if (force || Date.now() - lastAt >= 3000) { last = msg; lastAt = Date.now(); log(msg); }
  };
  const tick = setInterval(() => report(false), 3000);
  log(`[toolchain] downloading ${img} (first run only, about 1.2 GB; later runs reuse it) …`);
  const r = await spawnStream(['pull', img], l => {
    const m = /^([0-9a-f]{12}): (.*)$/.exec(l);
    if (m) { const s = m[2]; if (!/^(Waiting|Verifying Checksum)/.test(s)) { const prev = layers.get(m[1]) || ''; if (!/complete|already exists/i.test(prev)) layers.set(m[1], s); report(false); } }
    else if (/^(Digest|Status):/.test(l)) log(`[toolchain] ${l}`);
  }, token, 60 * 60000);
  clearInterval(tick);
  report(true);
  invalidate();
  return r;
}

/** run the image's smoke test; images without tenx-smoke (built before 1.0.0) only need their version record */
async function smoke(img, log, token) {
  log(`[toolchain] smoke test of ${img} …`);
  let r = await spawnStream(['run', '--rm', img, 'tenx-smoke'], l => { if (/^(PASS|FAIL) /.test(l)) log('[toolchain]   ' + l); }, token, 10 * 60000);
  if (r.code !== 0 && /executable file not found|no such file|not found in \$PATH/i.test(r.out)) {
    r = await spawnStream(['run', '--rm', img, 'cat', '/etc/tenx-eda-tools.json'], null, token, 120000);
    return { ok: r.code === 0, out: r.out };
  }
  return { ok: r.code === 0 && /SMOKE PASS/.test(r.out), out: r.out };
}
function activate(img, tools) { writeJson(ACTIVE_FILE, { image: img, version: tagOf(img), smoke: 'pass', at: new Date().toISOString(), tools: tools || undefined }); runtimeImage = null; invalidate(); }

let inflight = null;    // { image, promise } — concurrent runs in this process share one download
/**
 * Make sure the toolchain image exists locally: download it (once, with progress), smoke-test it, remember it as working.
 * On failure, fall back to the newest image already on this machine (the last working one) and say so.
 * resolves { image, pulled, fallback } — throws with an actionable message when no usable image exists.
 */
async function ensureImage(o) {
  o = o || {};
  const log = o.log || (() => {});
  const e = engine(); if (e.error) throw new Error(e.error);
  const c = config();
  if (present(c.image)) return { image: c.image, pulled: false };
  if (inflight && inflight.image === c.image) return inflight.promise;
  const img = c.image;
  const promise = withLock(img, log, o.token, async () => {
    if (present(img)) return { image: img, pulled: false };       // another process finished the download meanwhile
    const r = await pullImage(img, log, o.token);
    if (r.code === 0 && present(img)) {
      const s = await smoke(img, log, o.token);
      if (s.ok) { if (c.managed) activate(img); log(`[toolchain] ${img} ready (smoke test passed)`); return { image: img, pulled: true }; }
      log(`[toolchain] ${img} failed its smoke test — not used`);
      if (c.managed) run(['image', 'rm', img], { timeout: 60000 });
      return fallback(img, `the downloaded image failed its smoke test`, log);
    }
    if (/cancelled/.test(r.out)) throw new Error('image download cancelled');
    return fallback(img, pullError(img, r.out), log);
  }).finally(() => { if (inflight && inflight.image === img) inflight = null; });
  inflight = { image: img, promise };
  return promise;
}
/** newest compatible image already present: the last smoke-tested one, the shipped version, then the old local build */
function fallback(wanted, why, log) {
  const a = readJson(ACTIVE_FILE);
  const cands = [a && a.image, DEFAULT_IMAGE, LEGACY_IMAGE].filter((x, i, s) => x && x !== wanted && s.indexOf(x) === i);
  const ok = config().managed ? cands.find(present) : null;
  if (ok) {
    log(`[toolchain] ${why}`);
    log(`[toolchain] keeping the last working image ${ok}`);
    runtimeImage = ok; invalidate();
    return { image: ok, pulled: false, fallback: true, reason: why };
  }
  throw new Error(why);
}

/**
 * Before a run: download the image if this run needs the container (mode "container", or "auto" with the local tool missing).
 *   sims: simulator ids (icarus / verilator / ghdl);  tools: other image tools (yosys, sby, make, python…)
 * Never throws in auto mode when the engine is missing — the simulator detection reports what to install.
 */
async function prepare(o) {
  o = o || {};
  const log = o.log || (() => {});
  const c = config();
  if (c.mode === 'local') return { used: false };
  let needed = c.mode === 'container' || !!o.need;
  if (!needed) {
    const sim = require('./sim');
    needed = (o.sims || []).some(id => SUPPORTED.includes(id) && sim.resolveLocal(sim.ADAPTERS[id], (o.override || {})[id]).missing.length)
      || (o.tools || []).some(t => !onPath(t));
  }
  if (!needed) return { used: false };
  invalidate();
  const e = engine();
  if (e.error) {
    if (c.mode === 'container') throw new Error(`Docker is needed (tenxDebug.toolchain.mode = container): ${e.error}`);
    log(`[toolchain] ${e.error}`);
    return { used: false, error: e.error };
  }
  const r = await ensureImage(o);
  log(`[toolchain] ${describe()}`);
  return Object.assign({ used: true }, r);
}

/** one line for run logs: active image, its version and the main tool versions */
function describe() {
  const im = imageInfo();
  if (!im.present) return `image ${config().image} (not present)`;
  const t = im.tools || {};
  const short = s => String(s || '').replace(/^Icarus Verilog runtime version /, 'Icarus ').replace(/^Verilator (\S+).*/, 'Verilator $1').replace(/^Yosys (\S+).*/, 'Yosys $1').replace(/ \(stable\).*/, '');
  return `image ${im.image}${im.version ? ` (version ${im.version})` : ''} · ${[short(t.vvp), short(t.verilator), t.uvm, short(t.yosys), t.cocotb].filter(Boolean).join(' · ')}`;
}

/* ---------------------------------------------------------------- registry (Docker Registry HTTP API v2) */
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? require('http') : require('https');
    const req = mod.get(url, { headers: Object.assign({ 'User-Agent': 'dvflow-toolchain', Accept: 'application/json' }, headers || {}), timeout: 20000 }, res => {
      let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
/** tags of a repository (anonymous pull token where the registry asks for one) */
async function listTags(repository) {
  const slash = repository.indexOf('/');
  let host = repository.slice(0, slash), name = repository.slice(slash + 1);
  if (!/[.:]/.test(host) && host !== 'localhost') { host = 'registry-1.docker.io'; name = repository.includes('/') ? repository : 'library/' + repository; }
  const base = (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http://' : 'https://') + host;
  let r = await httpGet(`${base}/v2/${name}/tags/list`);
  if (r.status === 401) {
    const h = String(r.headers['www-authenticate'] || '');
    const kv = {}; h.replace(/(\w+)="([^"]*)"/g, (m, k, v) => { kv[k] = v; });
    if (kv.realm) {
      const t = await httpGet(`${kv.realm}?service=${encodeURIComponent(kv.service || '')}&scope=${encodeURIComponent(kv.scope || `repository:${name}:pull`)}`);
      const tok = (JSON.parse(t.body || '{}').token || JSON.parse(t.body || '{}').access_token);
      if (tok) r = await httpGet(`${base}/v2/${name}/tags/list`, { Authorization: `Bearer ${tok}` });
    }
  }
  if (r.status !== 200) throw new Error(`${host} answered ${r.status} for ${name}${r.status === 401 || r.status === 403 ? ' (package private?)' : r.status === 404 ? ' (not published yet?)' : ''}`);
  return (JSON.parse(r.body || '{}').tags || []);
}
/**
 * Newest compatible tag on the registry.  { current, latest, update, error }
 * Throttled to once a day unless o.force; offline or private registries are reported, never fatal.
 */
async function checkForUpdate(o) {
  o = o || {};
  const c = config();
  const current = c.managed ? tagOf(c.image) : null;
  if (!c.managed) return { current: tagOf(c.image), update: false, skipped: 'tenxDebug.toolchain.image is set explicitly' };
  const st = readJson(UPDATE_FILE) || {};
  if (!o.force && st.at && Date.now() - st.at < 24 * 3600 * 1000) return Object.assign({ current, cached: true }, st.result || {}, { update: !!(st.result && st.result.latest && cmpVer(st.result.latest, current) > 0) });
  let result;
  try {
    const tags = (await listTags(SPEC.repository)).filter(compatible).sort(cmpVer);
    const latest = tags.length ? tags[tags.length - 1] : null;
    result = { latest, tags: tags.slice(-5) };
  } catch (err) { result = { error: `registry unreachable: ${err.message || (err.errors && err.errors.map(x => x.message).join("; ")) || err.code || "no answer"}` }; }
  writeJson(UPDATE_FILE, { at: Date.now(), result });
  return Object.assign({ current }, result, { update: !!(result.latest && cmpVer(result.latest, current) > 0) });
}
/**
 * Download a newer compatible image, smoke-test it, then switch to it. The image in use stays active if any step fails.
 * resolves { updated, image, from, reason }
 */
async function update(o) {
  o = o || {};
  const log = o.log || (() => {});
  const e = engine(); if (e.error) throw new Error(e.error);
  const chk = await checkForUpdate({ force: true });
  const from = config().image;
  if (chk.skipped) return { updated: false, image: from, reason: chk.skipped };
  if (chk.error) { log(`[toolchain] update check failed: ${chk.error} — keeping ${from}`); return { updated: false, image: from, reason: chk.error }; }
  if (!chk.update) {
    log(`[toolchain] ${from} is the newest compatible image${chk.latest ? '' : ' (no published tags found)'}`);
    if (!present(from)) await ensureImage(o);
    return { updated: false, image: config().image, reason: 'up to date' };
  }
  const img = `${SPEC.repository}:${chk.latest}`;
  log(`[toolchain] update available: ${from} → ${img}`);
  return withLock(img, log, o.token, async () => {
    if (!present(img)) {
      const r = await pullImage(img, log, o.token);
      if (r.code !== 0 || !present(img)) { const why = /cancelled/.test(r.out) ? 'download cancelled' : pullError(img, r.out); log(`[toolchain] update not applied: ${why}`); log(`[toolchain] keeping ${from}`); return { updated: false, image: from, reason: why }; }
    }
    const s = await smoke(img, log, o.token);
    if (!s.ok) { log(`[toolchain] ${img} failed its smoke test — not used; keeping ${from}`); run(['image', 'rm', img], { timeout: 60000 }); return { updated: false, image: from, reason: 'smoke test failed' }; }
    activate(img);
    stopAll();   // containers of the old image; the next run starts one from the new image
    log(`[toolchain] switched to ${img} (smoke test passed). ${from} stays on disk as a fallback until you remove it.`);
    return { updated: true, image: img, from };
  });
}

module.exports = { configure, config, engine, available, shouldUse, ensure, wrap, execSync, execAsync, canRun, probeAsync, toCtr, mapText, mounted, mountList, imageInfo, toolVersion, shellCommand, build, pull, status, stopAll, name, invalidate,
  ensureImage, prepare, smoke, checkForUpdate, update, describe, listTags, pullError, managedImage, semver, cmpVer, compatible, mapArg, SPEC, SUPPORTED, CTR_NAME, DEFAULT_IMAGE, LEGACY_IMAGE };
