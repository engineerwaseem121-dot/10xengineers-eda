/* 10xEngineers EDA - FSM diagram panel */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let cur = null, api = null;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type !== 'fsm') return;
    cur = m;
    const sel = $('sel');
    sel.innerHTML = m.list.map(x => `<option value="${esc(x.id)}"${m.fsm && x.id === m.fsm.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
    sel.style.display = m.list.length > 1 ? '' : 'none';
    const svg = $('diagram');
    if (!m.fsm) {
      svg.innerHTML = '';
      $('stats').textContent = '';
      $('tlist').innerHTML = '';
      $('issues').innerHTML = `<div class="empty">No FSM detected in ${esc(m.fileName)}.<br><br>10xEngineers EDA looks for state constants (typedef enum / localparam) used as items of a <code>case (state)</code> statement.</div>`;
      api = null;
      return;
    }
    const f = m.fsm;
    $('stats').textContent = `${f.states.length} states · ${f.transitions.length} transitions · reset ${f.reset}${f.width ? ' · ' + f.width + '-bit ' + f.encoding : ''}`;
    api = FsmRender.render(svg, f, {
      positions: m.positions,
      onNodeClick: name => { const s = f.states.find(x => x.name === name); if (s) vscode.postMessage({ type: 'openLine', line: s.line }); },
      onEdgeClick: t => vscode.postMessage({ type: 'openLine', line: t.line }),
      onMove: pos => vscode.postMessage({ type: 'positions', id: f.id, pos })
    });
    $('tlist').innerHTML = f.transitions.map((t, i) =>
      `<div class="tr" data-i="${i}"><code>${esc(t.from)} → ${esc(t.to)}</code>${t.cond ? `<span class="cond">${esc(t.cond)}</span>` : ''}</div>`).join('') || '<div class="empty">No transitions found.</div>';
    $('issues').innerHTML = m.issues.length
      ? m.issues.map(is => `<div class="issue ${is.severity}" data-line="${is.line}">${esc(is.message.replace(/^FSM '[^']*': /, ''))}</div>`).join('')
      : '<div class="ok">✓ No FSM issues found</div>';
  });

  $('tlist').addEventListener('click', e => {
    const d = e.target.closest('.tr');
    if (d && cur && cur.fsm) vscode.postMessage({ type: 'openLine', line: cur.fsm.transitions[+d.dataset.i].line });
  });
  $('issues').addEventListener('click', e => {
    const d = e.target.closest('.issue');
    if (d) vscode.postMessage({ type: 'openLine', line: +d.dataset.line });
  });
  $('sel').addEventListener('change', e => vscode.postMessage({ type: 'select', id: e.target.value }));
  $('fit').addEventListener('click', () => api && api.fit());
  $('relayout').addEventListener('click', () => api && api.relayout());
  $('svg').addEventListener('click', () => api && vscode.postMessage({ type: 'exportSvg', svg: api.svgString(), name: 'fsm_' + cur.fsm.name }));
  $('mermaid').addEventListener('click', () => cur && vscode.postMessage({ type: 'copy', text: cur.mermaid, what: 'Mermaid diagram' }));
  $('dot').addEventListener('click', () => cur && vscode.postMessage({ type: 'copy', text: cur.dot, what: 'Graphviz DOT' }));
  window.addEventListener('resize', () => api && api.fit());

  vscode.postMessage({ type: 'ready' });
})();
