/* 10xEngineers EDA - FSM diagram renderer (SVG, draggable nodes, pan/zoom). Shared by FSM panel and waveform viewer. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_H = 36;

  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const nodeW = name => Math.max(64, name.length * 8 + 26);

  function autoLayout(fsm) {
    const names = fsm.states.map(s => s.name);
    const adj = {};
    names.forEach(n => { adj[n] = []; });
    fsm.transitions.forEach(t => { if (adj[t.from] && adj[t.to] && t.from !== t.to) adj[t.from].push(t.to); });
    const start = fsm.reset && adj[fsm.reset] ? fsm.reset : names[0];
    const layer = {};
    if (start !== undefined) {
      layer[start] = 0;
      const q = [start];
      while (q.length) {
        const n = q.shift();
        for (const m of adj[n]) if (layer[m] === undefined) { layer[m] = layer[n] + 1; q.push(m); }
      }
    }
    const maxL = Math.max(0, ...Object.values(layer));
    names.forEach(n => { if (layer[n] === undefined) layer[n] = maxL + 1; });
    const cols = {};
    names.forEach(n => (cols[layer[n]] = cols[layer[n]] || []).push(n));
    const keys = Object.keys(cols).map(Number).sort((a, b) => a - b);
    const maxRows = Math.max(1, ...keys.map(k => cols[k].length));
    const pos = {};
    // long, thin chains (typical cyclic FSMs) read better on a circle
    if (keys.length > 3 && keys.length >= maxRows * 2 && names.length <= 16) {
      const order = [];
      keys.forEach(k => cols[k].forEach(n => order.push(n)));
      const R = Math.max(150, order.length * 34);
      order.forEach((n, i) => {
        const a = Math.PI + (2 * Math.PI * i) / order.length;
        pos[n] = { x: R + 120 + R * Math.cos(a), y: R + 80 + R * Math.sin(a) * 0.8 };
      });
      return pos;
    }
    let x = 70;
    keys.forEach(k => {
      const c = cols[k];
      const w = Math.max(...c.map(nodeW));
      c.forEach((n, i) => { pos[n] = { x: x + w / 2, y: 60 + (i + (maxRows - c.length) / 2) * 100 }; });
      x += w + 110;
    });
    return pos;
  }

  function clipRect(cx, cy, w, h, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx ? (w / 2 + 3) / Math.abs(dx) : Infinity;
    const sy = dy ? (h / 2 + 3) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function distToSeg(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const l2 = vx * vx + vy * vy || 1;
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
  }

  const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

  /**
   * opts: { positions, highlight, coverage: {visited:Set, taken:Set, illegal:[{from,to}]}, onNodeClick(name), onEdgeClick(t), onMove(pos) }
   */
  function render(svg, fsm, opts) {
    opts = opts || {};
    let pos = Object.assign(autoLayout(fsm), opts.positions || {});
    let vb = null;
    let state = { highlight: opts.highlight || null, coverage: opts.coverage || null };

    svg.innerHTML = '';
    svg.classList.add('fsm-svg');
    const defs = el('defs', {}, svg);
    [['arrow', 'var(--fsm-edge)'], ['arrowHot', 'var(--fsm-hot)'], ['arrowOk', 'var(--fsm-ok)'], ['arrowBad', 'var(--fsm-bad)'], ['arrowDim', 'var(--fsm-dim)']].forEach(([id, c]) => {
      const mk = el('marker', { id: 'fsm-' + id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', fill: c }, mk);
    });
    const gEdges = el('g', {}, svg);
    const gNodes = el('g', {}, svg);

    function edgeStyle(t, illegal) {
      const cov = state.coverage;
      if (illegal) return { cls: 'bad', marker: 'arrowBad' };
      if (state.highlight && t.from === state.highlight && t.to !== t.from) return { cls: 'hot', marker: 'arrowHot' };
      if (cov) {
        if (t.from === t.to) return { cls: 'dim', marker: 'arrowDim' };
        return cov.taken.has(t.from + '->' + t.to) ? { cls: 'ok', marker: 'arrowOk' } : { cls: 'uncov', marker: 'arrowDim' };
      }
      return { cls: '', marker: 'arrow' };
    }

    function draw() {
      gEdges.innerHTML = '';
      gNodes.innerHTML = '';
      const edges = fsm.transitions.map(t => ({ t, illegal: false }));
      if (state.coverage && state.coverage.illegal) state.coverage.illegal.forEach(t => edges.push({ t: { from: t.from, to: t.to, cond: 'not in RTL' }, illegal: true }));
      const pairs = new Set(edges.map(e => e.t.from + '->' + e.t.to));

      for (const { t, illegal } of edges) {
        const a = pos[t.from], b = pos[t.to];
        if (!a || !b) continue;
        const st = edgeStyle(t, illegal);
        const g = el('g', { class: 'fsm-edge ' + st.cls }, gEdges);
        let d, lx, ly;
        if (t.from === t.to) {
          const top = a.y - NODE_H / 2;
          d = `M${a.x - 12},${top} C${a.x - 34},${top - 46} ${a.x + 34},${top - 46} ${a.x + 12},${top}`;
          lx = a.x; ly = top - 40;
        } else {
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          let off = 0;
          if (pairs.has(t.to + '->' + t.from)) off = 26;
          for (const k in pos) {
            if (k === t.from || k === t.to) continue;
            if (distToSeg(pos[k], a, b) < 34) { off = Math.max(off, 60); }
          }
          const c = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
          const p0 = clipRect(a.x, a.y, nodeW(t.from), NODE_H, c.x, c.y);
          const p2 = clipRect(b.x, b.y, nodeW(t.to), NODE_H, c.x, c.y);
          d = `M${p0.x},${p0.y} Q${c.x},${c.y} ${p2.x},${p2.y}`;
          lx = 0.25 * p0.x + 0.5 * c.x + 0.25 * p2.x;
          ly = 0.25 * p0.y + 0.5 * c.y + 0.25 * p2.y;
        }
        el('path', { d, class: 'hit' }, g);
        el('path', { d, class: 'line', 'marker-end': `url(#fsm-${st.marker})` }, g);
        if (t.cond) el('text', { x: lx, y: ly - 4, class: 'elabel', 'text-anchor': 'middle' }, g, short(t.cond, 30));
        el('title', {}, g, `${t.from} → ${t.to}${t.cond ? '\nwhen ' + t.cond : ''}${illegal ? '\n(observed in simulation but not in RTL)' : ''}`);
        if (opts.onEdgeClick && !illegal) g.addEventListener('click', ev => { ev.stopPropagation(); opts.onEdgeClick(t); });
      }

      for (const s of fsm.states) {
        const p = pos[s.name];
        if (!p) continue;
        const w = nodeW(s.name);
        const cov = state.coverage;
        let cls = 'fsm-node';
        if (s.name === state.highlight) cls += ' hot';
        if (cov) cls += cov.visited.has(s.name) ? ' visited' : ' unvisited';
        const g = el('g', { class: cls, transform: `translate(${p.x},${p.y})` }, gNodes);
        if (s.name === fsm.reset) {
          el('rect', { x: -w / 2 - 4, y: -NODE_H / 2 - 4, width: w + 8, height: NODE_H + 8, rx: 20, class: 'ring' }, g);
          el('path', { d: `M${-w / 2 - 34},0 L${-w / 2 - 6},0`, class: 'resetArrow', 'marker-end': 'url(#fsm-arrow)' }, g);
        }
        el('rect', { x: -w / 2, y: -NODE_H / 2, width: w, height: NODE_H, rx: 17, class: 'box' }, g);
        el('text', { x: 0, y: 5, 'text-anchor': 'middle', class: 'nlabel' }, g, s.name);
        el('title', {}, g, `${s.name}${s.value != null ? ' = ' + s.value : ''}${s.name === fsm.reset ? ' (reset)' : ''}`);
        attachDrag(g, s.name);
      }
    }

    function svgPoint(ev) {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    function attachDrag(g, name) {
      g.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        const start = svgPoint(ev), orig = { ...pos[name] };
        let moved = false;
        const mm = e => {
          const p = svgPoint(e);
          if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 3) moved = true;
          pos[name] = { x: orig.x + p.x - start.x, y: orig.y + p.y - start.y };
          draw();
        };
        const mu = () => {
          window.removeEventListener('mousemove', mm);
          window.removeEventListener('mouseup', mu);
          if (moved) { if (opts.onMove) opts.onMove(pos); }
          else if (opts.onNodeClick) opts.onNodeClick(name);
        };
        window.addEventListener('mousemove', mm);
        window.addEventListener('mouseup', mu);
      });
    }

    function setVB(v) { vb = v; svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); }
    function fit() {
      const xs = [], ys = [];
      fsm.states.forEach(s => { const p = pos[s.name]; if (p) { xs.push(p.x - nodeW(s.name) / 2 - 50, p.x + nodeW(s.name) / 2 + 20); ys.push(p.y - 80, p.y + 40); } });
      if (!xs.length) { setVB({ x: 0, y: 0, w: 400, h: 300 }); return; }
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      setVB({ x: x0, y: y0, w: Math.max(200, x1 - x0), h: Math.max(150, y1 - y0) });
    }

    // pan & zoom
    svg.onwheel = ev => {
      ev.preventDefault();
      const p = svgPoint(ev);
      const k = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
      setVB({ x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w: vb.w * k, h: vb.h * k });
    };
    svg.onmousedown = ev => {
      if (ev.button !== 0) return;
      const sx = ev.clientX, sy = ev.clientY, o = { ...vb };
      const r = svg.getBoundingClientRect();
      const scale = Math.max(o.w / r.width, o.h / r.height);
      const mm = e => setVB({ x: o.x - (e.clientX - sx) * scale, y: o.y - (e.clientY - sy) * scale, w: o.w, h: o.h });
      const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    };

    draw();
    fit();

    return {
      update(o) { if ('highlight' in o) state.highlight = o.highlight; if ('coverage' in o) state.coverage = o.coverage; draw(); },
      fit,
      relayout() { pos = autoLayout(fsm); draw(); fit(); if (opts.onMove) opts.onMove(null); },
      svgString() {
        const cs = getComputedStyle(document.body);
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', NS);
        const style = document.createElementNS(NS, 'style');
        style.textContent = FSM_EXPORT_CSS;
        clone.insertBefore(style, clone.firstChild);
        const bg = document.createElementNS(NS, 'rect');
        ['x', 'y'].forEach(k => bg.setAttribute(k, vb[k]));
        bg.setAttribute('width', vb.w); bg.setAttribute('height', vb.h); bg.setAttribute('fill', 'var(--fsm-bg)');
        clone.insertBefore(bg, style.nextSibling);
        return new XMLSerializer().serializeToString(clone).replace(/var\((--[\w-]+)\)/g, (m, v) => (cs.getPropertyValue(v) || '#888').trim());
      }
    };
  }

  const FSM_EXPORT_CSS = `
    .fsm-node .box{fill:var(--fsm-node);stroke:var(--fsm-border);stroke-width:1.5}
    .fsm-node .ring{fill:none;stroke:var(--fsm-border);stroke-width:1.2}
    .fsm-node .nlabel{fill:var(--fsm-fg);font:600 13px sans-serif}
    .fsm-node.hot .box{fill:var(--fsm-hot);stroke:var(--fsm-hot)}
    .fsm-node.hot .nlabel{fill:#111}
    .fsm-node.visited .box{stroke:var(--fsm-ok);stroke-width:2.5}
    .fsm-node.unvisited .box{stroke:var(--fsm-dim);stroke-dasharray:4 3}
    .fsm-node .resetArrow{stroke:var(--fsm-edge);stroke-width:1.5}
    .fsm-edge .line{fill:none;stroke:var(--fsm-edge);stroke-width:1.5}
    .fsm-edge .hit{fill:none;stroke:transparent;stroke-width:12}
    .fsm-edge .elabel{fill:var(--fsm-label);font:11px sans-serif}
    .fsm-edge.hot .line{stroke:var(--fsm-hot);stroke-width:2.5}
    .fsm-edge.ok .line{stroke:var(--fsm-ok);stroke-width:2}
    .fsm-edge.uncov .line{stroke:var(--fsm-dim);stroke-dasharray:5 4}
    .fsm-edge.dim .line{stroke:var(--fsm-dim)}
    .fsm-edge.bad .line{stroke:var(--fsm-bad);stroke-width:2.5;stroke-dasharray:6 3}
    .fsm-edge.bad .elabel{fill:var(--fsm-bad)}`;

  const st = document.createElement('style');
  st.textContent = FSM_EXPORT_CSS + `
    .fsm-svg{cursor:grab;user-select:none}
    .fsm-node{cursor:move}
    .fsm-edge{cursor:pointer}
    .fsm-edge:hover .line{stroke-width:3}`;
  document.head.appendChild(st);

  window.FsmRender = { render, css: FSM_EXPORT_CSS };
})();
