/* 10xEngineers EDA — coverage dashboard */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let M = null, history = [], goal = 90, tab = 'overview', plan = null, planFile = null, regression = null;
  const ui = { q: '', onlyOpen: false, kind: 'type', sort: {}, open: new Set() };
  const prev = vscode.getState();
  if (prev && prev.tab) tab = prev.tab;

  /* ---------------------------------------------------------------- status helpers */
  function status(p, g) {
    g = g || goal;
    if (p == null) return { cls: '', icon: '', label: 'n/a' };
    if (p >= g) return { cls: 'good', icon: '✓', label: 'Met' };
    if (p >= g * 0.75) return { cls: 'warning', icon: '▲', label: 'Close' };
    if (p >= g * 0.4) return { cls: 'serious', icon: '◆', label: 'Low' };
    return { cls: 'critical', icon: '✕', label: 'Critical' };
  }
  const colorVar = cls => cls ? `var(--${cls})` : 'var(--muted)';
  const fmtPct = p => (p == null || isNaN(p) ? '—' : (Math.round(p * 100) / 100).toFixed(p >= 99.995 || p === Math.round(p) ? 0 : 2) + '%');
  const badge = (p, g) => { const s = status(p, g); return s.cls ? `<span class="status ${s.cls}">${s.icon} ${s.label}</span>` : ''; };
  const meter = (p, g, cls) => { const s = status(p, g); return `<span class="meter ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, p || 0))}%;background:${colorVar(s.cls)}"></i></span>`; };

  /* ---------------------------------------------------------------- derived data */
  function cgs() { const t = M.covergroups.filter(c => c.kind === ui.kind); return t.length ? t : M.covergroups; }
  function allBins() {
    const out = [];
    cgs().forEach(cg => cg.coverpoints.forEach(cp => cp.bins.forEach(b => {
      const st = b.type === 'illegal' ? (b.hits > 0 ? 'ILLEGAL HIT' : 'illegal') : b.type === 'ignore' ? 'ignored' : b.type === 'default' ? 'default' : b.hits >= b.atLeast ? 'HIT' : b.hits > 0 ? 'PARTIAL' : 'HOLE';
      out.push({ cg: cg.name, cp: cp.name, cpKind: cp.kind, cpPct: cp.pct, bin: b.name, type: b.type, hits: b.hits, atLeast: b.atLeast, st });
    })));
    return out;
  }
  function codeFiles() {
    return Object.entries(M.code).map(([file, lines]) => {
      const ls = Object.entries(lines);
      const unc = ls.filter(([, v]) => !v.hits).map(([l]) => +l).sort((a, b) => a - b);
      return { file, total: ls.length, uncovered: unc, pct: ls.length ? (ls.length - unc.length) * 100 / ls.length : 100 };
    }).sort((a, b) => b.uncovered.length - a.uncovered.length);
  }
  function holeValue(bin) {
    const m = /^auto\[(.+)\]$/.exec(bin) || /^\[?(-?\d+)\]?$/.exec(bin);
    return m ? m[1] : null;
  }
  function sigOf(cp) { return cp.replace(/^(cp_|cvp_|c_)/, '').replace(/^.*::/, ''); }

  /* ---------------------------------------------------------------- tooltip */
  const tip = document.createElement('div');
  tip.className = 'tip hidden';
  document.body.appendChild(tip);
  document.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.classList.add('hidden'); return; }
    tip.innerHTML = t.getAttribute('data-tip');
    tip.classList.remove('hidden');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px';
    tip.style.top = Math.min(e.clientY + 14, innerHeight - h - 8) + 'px';
  });

  /* ---------------------------------------------------------------- charts (SVG) */
  function barChart(items) {
    // horizontal bars, worst first; single series -> no legend; status colour + icon in label
    if (!items.length) return '<div class="empty">No covergroups in this report.</div>';
    const rowH = 22, labelW = 210, W = 620, plotW = W - labelW - 60;
    const H = items.length * rowH + 26;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Covergroup coverage">`;
    [0, 25, 50, 75, 100].forEach(v => { const x = labelW + v / 100 * plotW; s += `<line class="grid" x1="${x}" x2="${x}" y1="0" y2="${H - 20}"/><text class="muted" x="${x}" y="${H - 6}" text-anchor="middle">${v}%</text>`; });
    const gx = labelW + goal / 100 * plotW;
    s += `<line x1="${gx}" x2="${gx}" y1="0" y2="${H - 20}" stroke="var(--fg)" stroke-dasharray="3 3" opacity=".6"/><text x="${gx + 3}" y="10" class="muted">goal ${goal}%</text>`;
    items.forEach((it, i) => {
      const y = i * rowH + 4, st = status(it.pct, it.goal);
      const w = Math.max(2, it.pct / 100 * plotW);
      const nm = it.name.length > 30 ? '…' + it.name.slice(-29) : it.name;
      const t = `<b>${esc(it.name)}</b><br>${fmtPct(it.pct)} (goal ${it.goal}%) · ${st.icon} ${st.label}<br>${it.holes} hole(s) in ${it.cps} coverpoint(s)`;
      s += `<g data-tip="${esc(t)}" data-cg="${esc(it.name)}" style="cursor:pointer"><rect x="0" y="${y - 2}" width="${W}" height="${rowH}" fill="transparent"/>`;
      s += `<text x="${labelW - 8}" y="${y + 11}" text-anchor="end">${esc(nm)}</text>`;
      s += `<rect x="${labelW}" y="${y + 3}" width="${plotW}" height="12" rx="4" fill="var(--track)"/>`;
      s += `<rect x="${labelW}" y="${y + 3}" width="${w}" height="12" rx="4" fill="${colorVar(st.cls)}"/>`;
      s += `<text x="${labelW + plotW + 6}" y="${y + 13}">${st.icon} ${fmtPct(it.pct)}</text></g>`;
    });
    return s + '</svg>';
  }

  function trendChart(pts) {
    if (pts.length < 2) return '<div class="empty">Open more reports of this testbench to see a trend (each report you open is recorded).</div>';
    const W = 620, H = 200, L = 40, R = 14, T = 12, B = 28;
    const xs = i => L + i * (W - L - R) / (pts.length - 1);
    const ys = v => T + (100 - v) / 100 * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Total coverage trend" id="trendSvg">`;
    [0, 25, 50, 75, 100].forEach(v => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}"/><text class="muted" x="${L - 6}" y="${ys(v) + 4}" text-anchor="end">${v}%</text>`; });
    s += `<line x1="${L}" x2="${W - R}" y1="${ys(goal)}" y2="${ys(goal)}" stroke="var(--fg)" stroke-dasharray="3 3" opacity=".5"/>`;
    s += `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.map((p, i) => xs(i) + ',' + ys(p.total)).join(' ')}"/>`;
    pts.forEach((p, i) => {
      s += `<circle cx="${xs(i)}" cy="${ys(p.total)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
      s += `<rect x="${xs(i) - 12}" y="${T}" width="24" height="${H - T - B}" fill="transparent" data-tip="${esc(`<b>${fmtPct(p.total)}</b><br>${new Date(p.date).toLocaleString()}<br>${p.name}`)}"/>`;
    });
    s += `<text class="muted" x="${L}" y="${H - 8}">${esc(new Date(pts[0].date).toLocaleDateString())}</text><text class="muted" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(new Date(pts[pts.length - 1].date).toLocaleDateString())}</text>`;
    return s + '</svg>';
  }

  /* ---------------------------------------------------------------- sheets */
  function overview() {
    const tot = M.total;
    const st = status(tot);
    const fun = M.metrics.find(m => /^Covergroup Bins$/i.test(m.name));
    const holes = allBins().filter(b => b.st === 'HOLE' || b.st === 'PARTIAL').length;
    const unc = codeFiles().reduce((s, f) => s + f.uncovered.length, 0);
    let h = `<div class="hero">
      <div><div class="lbl">Total coverage</div><div class="big" style="color:${colorVar(st.cls)}">${fmtPct(tot)}</div></div>
      <div>${badge(tot)}<div class="lbl" style="margin-top:6px">goal ${goal}% · ${esc(M.tool)}</div></div>
      <div><div class="lbl">Functional (bins)</div><div style="font-size:22px;font-weight:600">${fun ? fmtPct(fun.pct) : '—'}</div></div>
      <div><div class="lbl">Coverage holes</div><div style="font-size:22px;font-weight:600">${holes}</div></div>
      <div><div class="lbl">Uncovered code lines</div><div style="font-size:22px;font-weight:600">${unc}</div></div>
    </div>`;
    h += '<div class="tiles">' + (M.metrics.length ? M.metrics.filter(m => m.bins > 0).map(m => `<div class="tile">
        <div class="name">${esc(m.name)}</div>
        <div class="val">${fmtPct(m.pct)} ${badge(m.pct)}</div>
        ${meter(m.pct)}
        <div class="sub">${m.hits} of ${m.bins} covered · ${m.bins - m.hits} missing</div></div>`).join('') : '<div class="empty">No summary metrics in this report.</div>') + '</div>';
    const items = cgs().map(cg => ({
      name: cg.name, pct: cg.pct, goal: cg.goal || 100, cps: cg.coverpoints.length,
      holes: cg.coverpoints.reduce((s, cp) => s + cp.bins.filter(b => b.type === 'bin' && b.hits < b.atLeast).length, 0)
    })).sort((a, b) => a.pct - b.pct);
    h += `<div class="grid2"><div class="panel"><h2 style="margin-top:0">Covergroups <span class="hint">worst first · click to drill in</span></h2>${barChart(items)}</div>
      <div class="panel"><h2 style="margin-top:0">Total coverage trend <span class="hint">${history.length} run(s)</span></h2>${trendChart(history)}</div></div>`;
    return h;
  }

  function functional() {
    const q = ui.q.toLowerCase();
    let h = `<div class="toolbar"><input type="text" id="q" placeholder="Search covergroup / coverpoint / bin…" value="${esc(ui.q)}" style="width:280px">
      <label><input type="checkbox" id="onlyOpen" ${ui.onlyOpen ? 'checked' : ''}> only below goal</label>
      <label>View <select id="kind"><option value="type"${ui.kind === 'type' ? ' selected' : ''}>Covergroup types</option><option value="instance"${ui.kind === 'instance' ? ' selected' : ''}>Instances</option></select></label>
      <span class="grow"></span><button data-csv="coverpoints">Export CSV</button></div>`;
    const rows = [];
    for (const cg of cgs()) {
      const cps = cg.coverpoints.filter(cp => (!ui.onlyOpen || cp.pct < (cp.goal || 100)) &&
        (!q || cg.name.toLowerCase().includes(q) || cp.name.toLowerCase().includes(q) || cp.bins.some(b => b.name.toLowerCase().includes(q))));
      if (!cps.length && (ui.onlyOpen || q)) continue;
      const open = ui.open.has(cg.name) || !!q;
      const holes = cg.coverpoints.reduce((s, cp) => s + cp.bins.filter(b => b.type === 'bin' && b.hits < b.atLeast).length, 0);
      rows.push(`<tr class="tree-row" data-toggle="${esc(cg.name)}"><td><span class="tw">${open ? '▾' : '▸'}</span><b>${esc(cg.name)}</b> <span class="pill">${cg.kind}</span></td><td>${meter(cg.pct, cg.goal, 'sm')}</td><td class="num">${fmtPct(cg.pct)}</td><td>${badge(cg.pct, cg.goal)}</td><td class="num">${cg.coverpoints.length} cp</td><td class="num">${holes}</td></tr>`);
      if (!open) continue;
      for (const cp of cps) {
        const key = cg.name + '::' + cp.name;
        const o2 = ui.open.has(key) || !!q;
        const real = cp.bins.filter(b => b.type === 'bin');
        const hit = real.filter(b => b.hits >= b.atLeast).length;
        rows.push(`<tr class="tree-row lvl1" data-toggle="${esc(key)}"><td><span class="tw">${o2 ? '▾' : '▸'}</span><span class="mono">${esc(cp.name)}</span> <span class="pill">${cp.kind}</span></td><td>${meter(cp.pct, cp.goal, 'sm')}</td><td class="num">${fmtPct(cp.pct)}</td><td>${badge(cp.pct, cp.goal)}</td><td class="num">${hit}/${real.length} bins</td><td class="num">${real.length - hit}</td></tr>`);
        if (o2) {
          const chips = cp.bins.map(b => {
            const cls = b.type === 'illegal' ? (b.hits ? 'ill' : 'ign') : b.type !== 'bin' ? 'ign' : b.hits >= b.atLeast ? 'hit' : b.hits ? 'partial' : 'hole';
            return `<span class="chip ${cls}" data-tip="${esc(`<b>${esc(b.name)}</b> (${b.type})<br>hits ${b.hits} / at_least ${b.atLeast}`)}">${esc(b.name)} · ${b.hits}</span>`;
          }).join('');
          rows.push(`<tr class="lvl2"><td colspan="6"><div class="chips">${chips || '<span class="pill">no bin detail in report</span>'}</div></td></tr>`);
        }
      }
    }
    h += `<table><thead><tr><th>Covergroup / coverpoint</th><th>Coverage</th><th class="num">%</th><th>Status</th><th class="num">Size</th><th class="num">Holes</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="6" class="empty">No functional coverage (covergroups) in this report.</td></tr>'}</tbody></table>`;
    return h;
  }

  function binSheet(kind) {
    const q = ui.q.toLowerCase();
    let bins = allBins();
    if (kind === 'hits') bins = bins.filter(b => b.st === 'HIT');
    else bins = bins.filter(b => b.st === 'HOLE' || b.st === 'PARTIAL' || b.st === 'ILLEGAL HIT');
    if (q) bins = bins.filter(b => (b.cg + ' ' + b.cp + ' ' + b.bin).toLowerCase().includes(q));
    if (kind === 'holes') bins.forEach(b => { b.prio = b.st === 'ILLEGAL HIT' ? 0 : b.cpPct >= 75 ? 1 : b.cpPct >= 40 ? 2 : 3; });
    const s = ui.sort[kind] || (kind === 'holes' ? { k: 'prio', d: 1 } : { k: 'hits', d: -1 });
    bins.sort((a, b) => (a[s.k] > b[s.k] ? 1 : a[s.k] < b[s.k] ? -1 : 0) * s.d);
    const prioLbl = ['✕ Illegal bin hit', '▲ Quick win', '◆ Medium', '● Needs stimulus'];
    const cols = kind === 'holes'
      ? [['prio', 'Priority'], ['cg', 'Covergroup'], ['cp', 'Coverpoint'], ['bin', 'Bin'], ['hits', 'Hits', 1], ['atLeast', 'At least', 1], ['cpPct', 'Coverpoint %', 1], ['st', 'Status']]
      : [['cg', 'Covergroup'], ['cp', 'Coverpoint'], ['bin', 'Bin'], ['hits', 'Hits', 1], ['atLeast', 'At least', 1], ['cpPct', 'Coverpoint %', 1]];
    let h = `<div class="toolbar"><input type="text" id="q" placeholder="Search…" value="${esc(ui.q)}" style="width:280px">
      <span class="pill">${bins.length} ${kind === 'hits' ? 'hit bins' : 'holes'}</span><span class="grow"></span><button data-csv="${kind}">Export CSV</button></div>`;
    h += `<table><thead><tr>${cols.map(c => `<th class="${c[2] ? 'num' : ''}" data-sort="${kind}:${c[0]}">${c[1]}${s.k === c[0] ? (s.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>`;
    h += bins.slice(0, 5000).map(b => `<tr>${cols.map(c => {
      const v = b[c[0]];
      if (c[0] === 'prio') return `<td><span class="status ${['critical', 'good', 'warning', 'serious'][v]}">${prioLbl[v]}</span></td>`;
      if (c[0] === 'cpPct') return `<td class="num">${fmtPct(v)}</td>`;
      if (c[0] === 'bin' || c[0] === 'cp') return `<td class="mono">${esc(v)}</td>`;
      return `<td class="${c[2] ? 'num' : ''}">${esc(v)}</td>`;
    }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">${kind === 'hits' ? 'No hit bins.' : '🎉 No coverage holes.'}</td></tr>`;
    return h + '</tbody></table>';
  }

  function codeSheet() {
    const metricsCols = ['Statements', 'Branches', 'Conditions', 'Expressions', 'Toggles', 'FSM States', 'FSM Transitions', 'Lines'];
    const present = metricsCols.filter(c => M.instances.some(i => i.metrics.some(m => m.name === c)));
    let h = '';
    if (M.instances.length) {
      h += `<h2 style="margin-top:0">Code coverage by instance <span class="hint">${M.instances.length} instance(s)</span></h2><table><thead><tr><th>Instance</th>${present.map(c => `<th class="num">${c}</th>`).join('')}</tr></thead><tbody>`;
      h += M.instances.map(i => `<tr><td class="mono">${esc(i.name)}</td>${present.map(c => { const m = i.metrics.find(x => x.name === c); if (!m) return '<td class="num">—</td>'; const s = status(m.pct); return `<td class="num" data-tip="${esc(`${m.hits}/${m.bins} ${c}`)}"><span style="color:${colorVar(s.cls)}">${s.icon}</span> ${fmtPct(m.pct)}</td>`; }).join('')}</tr>`).join('');
      h += '</tbody></table>';
    }
    const files = codeFiles();
    h += `<h2>Source files <span class="hint">click a line number to open it · "Highlight" shows hits in the editor gutter</span></h2>`;
    if (!files.length) return h + '<div class="empty">No per-line code coverage in this report. For Questa, generate it with <span class="mono">vcover report -details -code s ...</span>; for Verilator use <span class="mono">verilator_coverage --write-info cov.info</span>.</div>';
    h += `<div class="toolbar"><button class="primary" id="highlight">Highlight coverage in editor</button><span class="grow"></span><button data-csv="code">Export CSV</button></div>`;
    h += `<table><thead><tr><th>File</th><th>Coverage</th><th class="num">%</th><th class="num">Lines</th><th class="num">Uncovered</th><th>Uncovered lines</th></tr></thead><tbody>`;
    h += files.map(f => `<tr><td class="mono link" data-open="${esc(f.file)}" data-line="${f.uncovered[0] || 1}">${esc(f.file)}</td><td>${meter(f.pct, null, 'sm')}</td><td class="num">${fmtPct(f.pct)}</td><td class="num">${f.total}</td><td class="num">${f.uncovered.length}</td><td class="wrap">${f.uncovered.slice(0, 60).map(l => `<span class="link mono" data-open="${esc(f.file)}" data-line="${l}">${l}</span>`).join(', ')}${f.uncovered.length > 60 ? ' …' : ''}</td></tr>`).join('');
    return h + '</tbody></table>';
  }

  function assertSheet() {
    let h = '';
    if (M.assertions.length) {
      h += `<h2 style="margin-top:0">Assertions <span class="hint">${M.assertions.length}</span></h2><table><thead><tr><th>Name</th><th>Location</th><th class="num">Failures</th><th class="num">Passes</th><th>Status</th></tr></thead><tbody>`;
      h += M.assertions.map(a => `<tr><td class="mono">${esc(a.name)}</td><td class="mono link" data-open="${esc(a.file)}" data-line="${a.line}">${esc(a.file)}:${a.line}</td><td class="num">${a.failures}</td><td class="num">${a.passes}</td><td>${a.status === 'failed' ? '<span class="status critical">✕ Failed</span>' : a.status === 'passed' ? '<span class="status good">✓ Passed</span>' : '<span class="status warning">▲ Not exercised</span>'}</td></tr>`).join('');
      h += '</tbody></table>';
    }
    if (M.directives.length) {
      h += `<h2>Cover directives <span class="hint">${M.directives.length}</span></h2><table><thead><tr><th>Name</th><th>Location</th><th class="num">Count</th><th>Status</th></tr></thead><tbody>`;
      h += M.directives.map(d => `<tr><td class="mono">${esc(d.name)}</td><td class="mono link" data-open="${esc(d.file)}" data-line="${d.line}">${esc(d.file)}:${d.line}</td><td class="num">${d.count}</td><td>${d.count ? '<span class="status good">✓ Covered</span>' : '<span class="status critical">✕ Uncovered</span>'}</td></tr>`).join('');
      h += '</tbody></table>';
    }
    return h || '<div class="empty">No assertion or cover-directive data. For Questa add <span class="mono">-assert -directive</span> to vcover report (or simulate with <span class="mono">-assertdebug</span>).</div>';
  }

  function analysis() {
    const ins = [];
    const add = (sev, icon, title, text, code) => ins.push({ sev, icon, title, text, code });
    const tot = M.total;
    if (tot != null) {
      if (tot >= goal) add('good', '✓', `Coverage goal met: ${fmtPct(tot)} ≥ ${goal}%`, 'Close remaining holes in the Holes sheet, or set exclusions for unreachable code to lock in sign-off.');
      else add(status(tot).cls, status(tot).icon, `Total coverage ${fmtPct(tot)} is ${(goal - tot).toFixed(1)} points below the ${goal}% goal`, 'The items below are ordered by impact. Quick wins (coverpoints that are already above 75%) give the fastest gain.');
    }
    const ms = M.metrics.filter(m => m.bins > 0).sort((a, b) => a.pct - b.pct);
    if (ms.length) {
      const w = ms[0];
      const tips = {
        Toggles: 'Low toggle coverage usually means data buses never see all 0→1→0 transitions. Add a walking-ones / walking-zeros sequence and random data with full-range constraints.',
        Branches: 'Missed branches point at untested if/else and case arms. Check the uncovered lines in the Code sheet and add directed tests for error, stall and reset-mid-operation paths.',
        Conditions: 'Condition (FEC) holes mean a sub-term of an if-expression never independently controlled the result. Write stimulus that flips one input at a time.',
        Expressions: 'Expression holes mean a sub-term of an assignment never independently controlled the result. Write stimulus that flips one input at a time.',
        Statements: 'Uncovered statements are dead or untested code. Review the Code sheet; exclude genuinely unreachable code (e.g. default arms of full cases).',
        'FSM States': 'Some FSM states were never entered. Open the FSM diagram (◆) for the design to see which transitions are needed.',
        'FSM Transitions': 'Some FSM arcs were never taken. Use the 10xEngineers EDA waveform FSM panel to see the exercised arcs and target the missing ones.',
        'Covergroup Bins': 'Functional holes remain. See the Holes sheet; the constraint suggestions below give a starting point.'
      };
      add(status(w.pct).cls || 'info', status(w.pct).icon || 'ℹ', `Weakest metric: ${w.name} at ${fmtPct(w.pct)} (${w.bins - w.hits} missing)`, tips[w.name] || 'Focus closure effort here first.');
    }
    const bins = allBins();
    const illegal = bins.filter(b => b.st === 'ILLEGAL HIT');
    if (illegal.length) add('critical', '✕', `${illegal.length} illegal bin(s) were hit`, 'Illegal bins report DUT or stimulus bugs: ' + illegal.slice(0, 6).map(b => `<span class="mono">${esc(b.cp)}.${esc(b.bin)}</span>`).join(', ') + '. Debug these before closing coverage.');
    const zeroCg = cgs().filter(cg => cg.pct === 0);
    if (zeroCg.length) add('critical', '✕', `${zeroCg.length} covergroup(s) at 0%`, 'A covergroup at exactly 0% usually means it is never sampled: the monitor is not connected to the coverage subscriber, <span class="mono">sample()</span> is never called, or the instance is never constructed. Affected: ' + zeroCg.slice(0, 6).map(c => `<span class="mono">${esc(c.name)}</span>`).join(', '));
    const cps = [];
    cgs().forEach(cg => cg.coverpoints.forEach(cp => { const real = cp.bins.filter(b => b.type === 'bin'); cps.push({ cg: cg.name, cp, holes: real.filter(b => b.hits < b.atLeast), real }); }));
    const quick = cps.filter(c => c.holes.length && c.holes.length <= 2 && c.cp.pct >= 75);
    if (quick.length) add('warning', '▲', `${quick.length} quick win(s): coverpoints missing only 1–2 bins`, quick.slice(0, 10).map(c => `<span class="mono">${esc(c.cp.name)}</span> → ${c.holes.map(b => `<span class="mono">${esc(b.name)}</span>`).join(', ')}`).join('<br>'));
    const worst = cps.filter(c => c.holes.length).sort((a, b) => a.cp.pct - b.cp.pct).slice(0, 6);
    if (worst.length) add('serious', '◆', 'Lowest coverpoints', worst.map(c => `<span class="mono">${esc(c.cg)}::${esc(c.cp.name)}</span>: ${fmtPct(c.cp.pct)}, ${c.holes.length}/${c.real.length} bins missing`).join('<br>'));
    const crosses = cps.filter(c => c.cp.kind === 'cross' && c.holes.length > 4);
    if (crosses.length) add('info', 'ℹ', `${crosses.length} cross(es) with many holes`, 'Large cross holes are often combinations that are impossible by design. Add <span class="mono">ignore_bins</span> or <span class="mono">illegal_bins</span> with <span class="mono">binsof()</span> for those, then target the rest with a constrained-random sequence that weights the rare values. ' + crosses.slice(0, 4).map(c => `<span class="mono">${esc(c.cp.name)}</span> (${c.holes.length} holes)`).join(', '));
    // constraint suggestions for auto bins with concrete values
    const sugg = [];
    cps.forEach(c => {
      if (c.cp.kind !== 'coverpoint') return;
      const vals = c.holes.map(b => holeValue(b.name)).filter(v => v != null);
      if (vals.length) sugg.push(`// ${c.cg}::${c.cp.name} — ${vals.length} missing value(s)\nconstraint c_close_${sigOf(c.cp.name).replace(/\W/g, '_')} {\n  ${sigOf(c.cp.name)} dist { ${vals.slice(0, 16).map(v => `${v} := 10`).join(', ')}${vals.length > 16 ? ', /* … */' : ''}, [0:$] :/ 1 };\n}`);
    });
    if (sugg.length) add('info', '✎', 'Constraint suggestions for missing auto bins', 'Add these to a closure sequence or test (rename the signal if your transaction field is named differently):', sugg.slice(0, 8).join('\n\n'));
    const fa = M.assertions.filter(a => a.status === 'failed');
    if (fa.length) add('critical', '✕', `${fa.length} assertion(s) failed`, fa.slice(0, 8).map(a => `<span class="mono link" data-open="${esc(a.file)}" data-line="${a.line}">${esc(a.name)}</span> (${a.failures}×)`).join('<br>'));
    const ne = M.assertions.filter(a => a.status === 'not-exercised');
    if (ne.length) add('warning', '▲', `${ne.length} assertion(s) never exercised (vacuous)`, 'Their antecedents never matched, so they did not check anything. Add stimulus that reaches those conditions.');
    const ud = M.directives.filter(d => !d.count);
    if (ud.length) add('serious', '◆', `${ud.length} cover directive(s) never hit`, ud.slice(0, 8).map(d => `<span class="mono">${esc(d.name)}</span>`).join(', '));
    const files = codeFiles().filter(f => f.uncovered.length);
    if (files.length) add('info', 'ℹ', 'Files with the most uncovered lines', files.slice(0, 6).map(f => `<span class="mono link" data-open="${esc(f.file)}" data-line="${f.uncovered[0]}">${esc(f.file)}</span>: ${f.uncovered.length} line(s)`).join('<br>'));
    if (history.length >= 2) {
      const a = history[history.length - 2].total, b = history[history.length - 1].total;
      const d = b - a;
      add(d >= 0 ? 'good' : 'serious', d >= 0 ? '↗' : '↘', `Since the previous run: ${d >= 0 ? '+' : ''}${d.toFixed(2)} points`, d < 0 ? 'Coverage dropped. Check whether a test was removed, a seed changed, or new code was added without tests.' : 'Progress is going the right way. Keep running the closure tests with new seeds.');
    }
    if (!ins.length) add('info', 'ℹ', 'Nothing to analyse', 'This report has no coverage metrics.');
    return ins.map(i => `<div class="insight ${i.sev}"><div class="ic">${i.icon}</div><div class="body"><div class="ttl">${i.title}</div><div class="txt">${i.text}</div>${i.code ? `<pre>${esc(i.code)}</pre><button data-copy="${esc(i.code)}" style="margin-top:6px">Copy</button>` : ''}</div></div>`).join('');
  }

  /* ---------------------------------------------------------------- testplan + regression */
  function planStatus(f) {
    const map = { COVERED: ['good', '✓ Covered'], PARTIAL: ['warning', '▲ Partial'], 'NOT COVERED': ['critical', '✕ Not covered'], UNMAPPED: ['', '? Unmapped'] };
    const [c, l] = map[f.status] || ['', f.status];
    return `<span class="status ${c}" style="${c ? '' : 'color:var(--muted)'}">${l}</span>`;
  }
  function planTab() {
    if (!plan) return `<div class="empty">No testplan loaded. A testplan maps each spec feature to covergroups, coverpoints, bins, assertions and tests, then shows here which features are <b>hit</b> and which are still <b>remaining</b>.<br><br>
      Load a <span class="mono">.testplan</span> (YAML) or <span class="mono">vplan.csv</span> with <b>Testplan…</b> above. Files next to the report are picked up automatically. To create one from a spec, run <span class="mono">10xEngineers EDA: Extract Testplan from Spec</span>.</div>`;
    const q = ui.q.toLowerCase();
    const n = s => plan.filter(f => f.status === s).length;
    const covered = n('COVERED');
    const pct = plan.length ? covered * 100 / plan.length : 0;
    let h = `<div class="hero">
      <div><div class="lbl">Features covered</div><div class="big" style="color:${colorVar(status(pct, 100).cls)}">${covered}/${plan.length}</div></div>
      <div><span class="status good">✓ ${covered} covered</span> <span class="status warning">▲ ${n('PARTIAL')} partial</span> <span class="status critical">✕ ${n('NOT COVERED')} not covered</span> <span class="status" style="color:var(--muted)">? ${n('UNMAPPED')} unmapped</span>
      <div class="lbl" style="margin-top:6px">${esc(planFile || '')}</div></div></div>`;
    h += `<div class="toolbar"><input type="text" id="q" placeholder="Search features / items…" value="${esc(ui.q)}" style="width:280px"><span class="grow"></span><button data-csv="plan">Export CSV</button></div>`;
    h += `<table><thead><tr><th>ID</th><th>Feature</th><th>Priority</th><th>Coverage</th><th class="num">%</th><th>Status</th><th>Hit</th><th>Remaining</th></tr></thead><tbody>`;
    for (const f of plan) {
      if (q && !(f.id + ' ' + f.feature + ' ' + f.description + ' ' + f.items.join(' ')).toLowerCase().includes(q)) continue;
      const open = ui.open.has('plan:' + f.id) || !!q;
      h += `<tr class="tree-row" data-toggle="plan:${esc(f.id)}"><td class="mono"><span class="tw">${open ? '▾' : '▸'}</span>${esc(f.id)}</td><td class="wrap" data-tip="${esc(f.description)}">${esc(f.feature)}</td><td>${esc(f.priority)}</td><td>${f.pct == null ? '' : meter(f.pct, f.goal, 'sm')}</td><td class="num">${f.pct == null ? '—' : fmtPct(f.pct)}</td><td>${planStatus(f)}</td><td class="num">${f.hit.length}</td><td class="num">${f.unhit.length + f.missingPatterns.length}</td></tr>`;
      if (open) {
        const chips = [...f.hit.map(x => `<span class="chip hit" data-tip="${esc(x.kind + (x.detail ? ' · ' + x.detail : ''))}">✓ ${esc(x.label)}</span>`),
          ...f.unhit.map(x => `<span class="chip hole" data-tip="${esc(x.kind + ' · ' + fmtPct(x.pct) + (x.detail ? ' · ' + x.detail : ''))}">✕ ${esc(x.label)}</span>`),
          ...f.missingPatterns.map(p => `<span class="chip ign" data-tip="pattern matched nothing in this coverage database">? ${esc(p)}</span>`)].join('');
        h += `<tr class="lvl2"><td colspan="8">${f.description ? `<div class="txt" style="color:var(--muted);margin:2px 0 4px">${esc(f.description)}</div>` : ''}<div class="chips">${chips || '<span class="pill">no coverage items mapped</span>'}</div></td></tr>`;
      }
    }
    return h + '</tbody></table>';
  }
  function regressionTab() {
    if (!regression) return '<div class="empty">No regression results yet. Run <span class="mono">10xEngineers EDA: Run Regression</span> on a <span class="mono">regression.json</span>. Each test and seed runs in its own directory, coverage is merged, and the results appear here.</div>';
    const runs = regression.runs;
    const pass = runs.filter(r => r.status === 'PASS').length;
    const byTest = {};
    runs.forEach(r => { const k = r.job + '/' + r.test; (byTest[k] = byTest[k] || { pass: 0, n: 0 }); byTest[k].n++; if (r.status === 'PASS') byTest[k].pass++; });
    let h = `<div class="hero"><div><div class="lbl">Runs passed</div><div class="big" style="color:${colorVar(status(pass * 100 / Math.max(1, runs.length), 100).cls)}">${pass}/${runs.length}</div></div>
      <div><div class="lbl">Started</div><div>${esc(new Date(regression.started).toLocaleString())}</div><div class="lbl" style="margin-top:6px">Output</div><div class="mono link" data-dir="${esc(regression.outRoot)}">${esc(regression.outRoot)}</div></div></div>`;
    h += `<h2>Per test</h2><div class="tiles">${Object.entries(byTest).map(([k, v]) => `<div class="tile"><div class="name">${esc(k)}</div><div class="val">${v.pass}/${v.n} ${v.pass === v.n ? '<span class="status good">✓ Pass</span>' : '<span class="status critical">✕ Fail</span>'}</div>${meter(v.pass * 100 / v.n, 100)}</div>`).join('')}</div>`;
    h += `<h2>All runs <span class="hint">click a row to open its transcript; every run has its own directory</span></h2><table><thead><tr><th>Job</th><th>Test</th><th class="num">Seed</th><th>Status</th><th class="num">Errors</th><th class="num">Fatals</th><th class="num">Warnings</th><th class="num">Time (s)</th><th>Directory</th></tr></thead><tbody>`;
    h += runs.map(r => `<tr><td>${esc(r.job)}</td><td class="mono link" data-log="${esc(r.log)}">${esc(r.test)}</td><td class="num">${r.seed}</td><td>${r.status === 'PASS' ? '<span class="status good">✓ PASS</span>' : `<span class="status critical">✕ ${esc(r.status)}</span>`}</td><td class="num">${r.errors}</td><td class="num">${r.fatals}</td><td class="num">${r.warnings}</td><td class="num">${r.time}</td><td class="mono link" data-dir="${esc(r.dir)}">${esc(r.dir.split(/[\\/]/).slice(-3).join('/'))}</td></tr>`).join('');
    return h + '</tbody></table>';
  }

  /* ---------------------------------------------------------------- CSV */
  function csv(kind) {
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    let rows;
    if (kind === 'coverpoints') rows = [['covergroup', 'kind', 'coverpoint', 'type', 'pct', 'goal', 'bins', 'hit', 'holes']].concat(...cgs().map(cg => cg.coverpoints.map(cp => { const r = cp.bins.filter(b => b.type === 'bin'); const h = r.filter(b => b.hits >= b.atLeast).length; return [cg.name, cg.kind, cp.name, cp.kind, cp.pct, cp.goal, r.length, h, r.length - h]; })));
    else if (kind === 'plan') rows = [['id', 'feature', 'priority', 'goal', 'pct', 'status', 'hit_items', 'remaining_items']].concat(plan.map(f => [f.id, f.feature, f.priority, f.goal, f.pct, f.status, f.hit.map(x => x.label).join('; '), f.unhit.map(x => x.label).concat(f.missingPatterns).join('; ')]));
    else if (kind === 'code') rows = [['file', 'line', 'hits']].concat(...Object.entries(M.code).map(([f, ls]) => Object.entries(ls).map(([l, v]) => [f, l, v.hits])));
    else {
      const b = allBins().filter(x => kind === 'hits' ? x.st === 'HIT' : (x.st === 'HOLE' || x.st === 'PARTIAL' || x.st === 'ILLEGAL HIT'));
      rows = [['covergroup', 'coverpoint', 'bin', 'type', 'hits', 'at_least', 'coverpoint_pct', 'status']].concat(b.map(x => [x.cg, x.cp, x.bin, x.type, x.hits, x.atLeast, x.cpPct, x.st]));
    }
    vscode.postMessage({ type: 'saveCsv', name: kind, text: rows.map(r => r.map(q).join(',')).join('\n') });
  }

  /* ---------------------------------------------------------------- render + events */
  function counts() {
    const b = allBins();
    return { hits: b.filter(x => x.st === 'HIT').length, holes: b.filter(x => x.st === 'HOLE' || x.st === 'PARTIAL' || x.st === 'ILLEGAL HIT').length, cg: cgs().length, files: Object.keys(M.code).length, as: M.assertions.length + M.directives.length };
  }
  function render() {
    if (!M) return;
    vscode.setState({ tab });
    const c = counts();
    const tabs = [['overview', 'Overview', ''], ['plan', 'Testplan', plan ? `${plan.filter(f => f.status === 'COVERED').length}/${plan.length}` : ''], ['regression', 'Regression', regression ? regression.runs.length : ''],
      ['functional', 'Functional', c.cg], ['hits', 'Hit bins', c.hits], ['holes', 'Unhit (holes)', c.holes], ['code', 'Code', c.files], ['asserts', 'Assertions', c.as], ['analysis', 'Analysis', '']];
    $('tabs').innerHTML = tabs.map(t => `<button data-tab="${t[0]}" class="${tab === t[0] ? 'on' : ''}">${t[1]}${t[2] !== '' ? `<span class="count">${t[2]}</span>` : ''}</button>`).join('');
    $('src').textContent = M.source || '';
    $('src').title = M.source || '';
    const body = { overview, plan: planTab, regression: regressionTab, functional, hits: () => binSheet('hits'), holes: () => binSheet('holes'), code: codeSheet, asserts: assertSheet, analysis }[tab]();
    const focus = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : null;
    $('sheet').innerHTML = body;
    if (focus != null && $('q')) { $('q').focus(); $('q').setSelectionRange(focus, focus); }
  }

  document.addEventListener('click', e => {
    const t = e.target;
    const tb = t.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; ui.q = ''; render(); return; }
    const tg = t.closest('[data-toggle]');
    if (tg) { const k = tg.dataset.toggle; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); render(); return; }
    const cg = t.closest('[data-cg]');
    if (cg) { tab = 'functional'; ui.open.add(cg.dataset.cg); render(); return; }
    const so = t.closest('[data-sort]');
    if (so) { const [kind, k] = so.dataset.sort.split(':'); const cur = ui.sort[kind]; ui.sort[kind] = { k, d: cur && cur.k === k ? -cur.d : 1 }; render(); return; }
    const lg = t.closest('[data-log]');
    if (lg) { vscode.postMessage({ type: 'openLog', file: lg.dataset.log }); return; }
    const dr = t.closest('[data-dir]');
    if (dr) { vscode.postMessage({ type: 'openDir', dir: dr.dataset.dir }); return; }
    const op = t.closest('[data-open]');
    if (op) { vscode.postMessage({ type: 'open', file: op.dataset.open, line: +op.dataset.line }); return; }
    const cv = t.closest('[data-csv]');
    if (cv) { csv(cv.dataset.csv); return; }
    const cp = t.closest('[data-copy]');
    if (cp) { vscode.postMessage({ type: 'copy', text: cp.dataset.copy }); return; }
    if (t.id === 'highlight') vscode.postMessage({ type: 'highlight' });
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') { ui.q = e.target.value; render(); } });
  document.addEventListener('change', e => {
    if (e.target.id === 'onlyOpen') { ui.onlyOpen = e.target.checked; render(); }
    if (e.target.id === 'kind') { ui.kind = e.target.value; render(); }
  });
  $('bReload').onclick = () => vscode.postMessage({ type: 'reload' });
  $('bOpen').onclick = () => vscode.postMessage({ type: 'openOther' });
  $('bExcel').onclick = () => vscode.postMessage({ type: 'excel', kind: 'full' });
  $('bHits').onclick = () => vscode.postMessage({ type: 'excel', kind: 'hits' });
  $('bHoles').onclick = () => vscode.postMessage({ type: 'excel', kind: 'holes' });
  $('bPlan').onclick = () => vscode.postMessage({ type: 'loadPlan' });
  $('goal').onchange = e => { goal = Math.max(1, Math.min(100, +e.target.value || 90)); vscode.postMessage({ type: 'goal', goal }); render(); };

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'model') {
      M = m.model; history = m.history || []; goal = m.goal || 90;
      plan = m.plan || null; planFile = m.planFile || null; regression = m.regression || null;
      $('goal').value = goal;
      if (!M.covergroups.some(c => c.kind === ui.kind)) ui.kind = M.covergroups.some(c => c.kind === 'type') ? 'type' : 'instance';
      render();
    } else if (m.type === 'error') {
      $('sheet').innerHTML = `<div class="insight critical"><div class="ic">✕</div><div class="body"><div class="ttl">Could not load coverage</div><div class="txt">${esc(m.message)}</div></div></div>`;
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
