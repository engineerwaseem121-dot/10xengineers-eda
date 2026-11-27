'use strict';
/*
 * Design library (examples/library): list the designs and start a new project from one of them.
 *   list(extRoot)                          -> [{ name, category, title, meta, dir }]
 *   createProject(extRoot, design, target, o) -> { root, cfg, files }   (design/ + SPEC.md + dvflow.json + testbenches)
 * Every library design was proven against its SPEC.md with its own self-check testbench (<name>_check.sv), which is
 * copied to tb/selfcheck/ as an extra, independent reference.
 */
const fs = require('fs');
const path = require('path');

function list(extRoot) {
  const lib = path.join(extRoot, 'examples', 'library');
  const out = [];
  if (!fs.existsSync(lib)) return out;
  for (const category of fs.readdirSync(lib).sort()) {
    const cd = path.join(lib, category);
    if (!fs.statSync(cd).isDirectory()) continue;
    for (const name of fs.readdirSync(cd).sort()) {
      const dir = path.join(cd, name), mf = path.join(dir, 'meta.json');
      if (!fs.existsSync(mf)) continue;
      let meta = {}; try { meta = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { continue; }
      const spec = path.join(dir, 'SPEC.md');
      const title = fs.existsSync(spec) ? ((/^#\s*(.+)$/m.exec(fs.readFileSync(spec, 'utf8')) || [])[1] || '').replace(/^[\w-]+\s*[:—-]\s*/, '') : meta.summary || '';
      out.push({ name, category, title: title || meta.summary || name, meta, dir });
    }
  }
  return out;
}

function createProject(extRoot, d, target, o) {
  o = o || {};
  const root = path.resolve(target);
  if (fs.existsSync(path.join(root, 'dvflow.json')) && !o.overwrite) throw new Error(`${root} already has a DV project (dvflow.json)`);
  fs.mkdirSync(path.join(root, 'design'), { recursive: true });
  fs.copyFileSync(path.join(d.dir, d.name + '.sv'), path.join(root, 'design', d.name + '.sv'));
  if (fs.existsSync(path.join(d.dir, 'SPEC.md'))) fs.copyFileSync(path.join(d.dir, 'SPEC.md'), path.join(root, 'SPEC.md'));
  const chk = path.join(d.dir, d.name + '_check.sv');
  if (fs.existsSync(chk)) { fs.mkdirSync(path.join(root, 'tb', 'selfcheck'), { recursive: true }); fs.copyFileSync(chk, path.join(root, 'tb', 'selfcheck', path.basename(chk))); }
  const { TEMPLATES } = require('./templates');
  // expected behaviour written from SPEC.md (meta.json → behavior.checks) makes a combinational "custom" design runnable at once
  const written = d.meta.behavior && d.meta.behavior.checks && Object.keys(d.meta.behavior.checks).length;
  const tpl = written ? 'custom' : TEMPLATES[d.meta.expected_template] ? d.meta.expected_template : undefined;
  const extra = d.meta.behavior ? Object.fromEntries(Object.entries(d.meta.behavior).filter(([k]) => k !== 'checks' && k !== 'source')) : {};
  const behavior = written ? Object.assign({ checks: d.meta.behavior.checks, sequential: false, spec: `Expected values written from SPEC.md (${d.name}).` }, extra) : (Object.keys(extra).length ? extra : undefined);
  const r = require('./demo').init(root, path.join('design', d.name + '.sv'), Object.assign({ top: d.name, mode: o.mode || 'all', template: tpl, behavior }, o.initOpts || {}));
  return { root, cfg: r.cfg, files: r.files, template: r.cfg.template, runnable: r.cfg.template !== 'custom' || !!written, note: r.cfg.note || null };
}

module.exports = { list, createProject };
