// node dashtabs.js <report index.html>... — opens each dashboard in headless Edge, visits every tab, the run drawer,
// the compare view and both themes; prints per-page JS exceptions / console errors and per-tab content size.
const cp = require('child_process'), path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const port = 9500 + Math.floor(Math.random() * 400);
  const ed = cp.spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(__dirname, 'prof-dash')}`, '--allow-file-access-from-files', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = l.find(p => p.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch (e) { /* not up */ } await sleep(300); }
  if (ws.readyState !== 1) await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; let errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else if (d.method === 'Runtime.exceptionThrown') errs.push('EXCEPTION ' + (d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).split('\n')[0]); else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error ' + d.params.args.map(a => a.value || a.description).join(' ').slice(0, 200)); else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errs.push('log ' + d.params.entry.text.slice(0, 200)); };
  const call = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : r; };
await call("Runtime.enable"); await call("Log.enable")
  for (const file of process.argv.slice(2)) {
    errs = [];
    await call('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
    await sleep(2500);
    const tabs = await ev(`[...document.querySelectorAll('.tab')].map(b => b.getAttribute('data-tab'))`);
    const out = [];
    for (const t of tabs || []) {
      await ev(`document.querySelector('.tab[data-tab="${t}"]').click()`); await sleep(500);
      out.push(`${t}:${await ev(`(document.getElementById('main')||{}).innerText.length`)}`);
    }
    // run drawer, compare, search, themes
    await ev(`location.hash = '#run-0'`); await sleep(700);
    const drawer = await ev(`(document.querySelector('.drawer, #drawer, [class*=drawer]')||{}).innerText ? 'drawer:' + document.querySelector('.drawer, #drawer, [class*=drawer]').innerText.length : 'drawer:none'`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))`);
    for (const th of ['Light', 'Dark', 'Auto']) await ev(`[...document.querySelectorAll('button')].filter(b => b.innerText.trim() === '${th}').forEach(b => b.click())`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true}))`); await sleep(300);
    const title = await ev('document.title');
    console.log(`\n# ${path.basename(path.dirname(path.dirname(file)))}  (${title})\n  tabs  ${out.join('  ')}\n  ${drawer}\n  errors: ${errs.length ? '\n    ' + [...new Set(errs)].join('\n    ') : 'none'}`);
  }
  ws.close(); ed.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
