'use strict';
/* Questa / ModelSim discovery and helpers. Cross-platform (Windows, Linux incl. Ubuntu/WSL). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const IS_WIN = process.platform === 'win32';
const exe = n => (IS_WIN ? n + '.exe' : n);

function isBinDir(d) {
  try { return fs.statSync(path.join(d, exe('vsim'))).isFile(); } catch (e) { return false; }
}

/** Accepts a vsim executable, a bin dir, or an install root; returns the bin dir or null. */
function normalize(p) {
  if (!p) return null;
  p = p.replace(/^~(?=$|[\\/])/, os.homedir()).trim();
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return isBinDir(path.dirname(p)) ? path.dirname(p) : null;
  } catch (e) { return null; }
  for (const sub of ['', 'bin', 'win64', 'win32', 'linux_x86_64', 'linux', 'win64pe', 'questa_fse/bin', 'questa_fse/win64', 'questa_fse/linux_x86_64']) {
    const d = path.join(p, sub);
    if (isBinDir(d)) return d;
  }
  return null;
}

function listDirs(dir, re) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && re.test(e.name)).map(e => path.join(dir, e.name)); }
  catch (e) { return []; }
}

/** Finds Questa/ModelSim installations: PATH first, then the usual install locations. */
function detect() {
  const found = new Set();
  (process.env.PATH || '').split(path.delimiter).forEach(d => { if (d && isBinDir(d)) found.add(d); });
  ['QUESTA_HOME', 'MTI_HOME', 'MODEL_TECH', 'QUESTASIM_HOME'].forEach(v => { const n = normalize(process.env[v]); if (n) found.add(n); });
  const roots = [];
  const home = os.homedir();
  if (IS_WIN) {
    const drives = ['C:\\', 'D:\\', 'E:\\'];
    for (const dr of drives) {
      roots.push(...listDirs(dr, /^(questasim|questa|modeltech|modelsim)/i));
      for (const intel of listDirs(dr, /^intelFPGA/i)) roots.push(...listDirs(intel, /^\d/).map(v => path.join(v, 'questa_fse')), ...listDirs(intel, /^\d/).map(v => path.join(v, 'modelsim_ase')));
      for (const vendor of [path.join(dr, 'Program Files'), path.join(dr, 'MentorGraphics'), path.join(dr, 'Mentor'), path.join(dr, 'Siemens'), path.join(dr, 'altera')]) {
        roots.push(...listDirs(vendor, /(questa|modelsim|modeltech)/i));
        for (const v of listDirs(vendor, /^\d/)) roots.push(path.join(v, 'questa_fse'), path.join(v, 'modelsim_ase'));
      }
    }
  } else {
    for (const base of ['/opt', '/tools', '/eda', '/usr/local', home, path.join(home, 'tools'), '/opt/mentor', '/opt/siemens', '/opt/Siemens', '/opt/intelFPGA', '/opt/altera']) {
      roots.push(...listDirs(base, /(questa|modelsim|modeltech|mentor|siemens)/i));
      for (const intel of listDirs(base, /^intelFPGA/i)) for (const v of listDirs(intel, /^\d/)) roots.push(path.join(v, 'questa_fse'), path.join(v, 'modelsim_ase'));
    }
    // one more level (e.g. /opt/mentor/questasim_2023.4, /opt/siemens/questa/2024.1)
    roots.slice().forEach(r => roots.push(...listDirs(r, /(questa|modelsim|\d{4})/i)));
  }
  roots.forEach(r => { const n = normalize(r); if (n) found.add(n); });
  return [...found];
}

function binPath(binDir, tool) {
  return binDir ? path.join(binDir, exe(tool)) : exe(tool);
}

function version(binDir) {
  return new Promise(res => cp.execFile(binPath(binDir, 'vsim'), ['-version'], { timeout: 15000, windowsHide: true }, (e, so, se) => res(((so || '') + (se || '')).trim().split(/\r?\n/)[0] || (e ? '' : 'vsim'))));
}

function run(binDir, tool, args, cwd, timeout = 300000) {
  return new Promise(res => cp.execFile(binPath(binDir, tool), args, { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, so, se) => res({ err, out: (so || '') + (se || '') })));
}

module.exports = { detect, normalize, binPath, version, run, IS_WIN };
