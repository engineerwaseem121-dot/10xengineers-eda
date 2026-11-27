// node deccheck.js <wave.html> — the Transactions (protocol decoder) panel of the real waveform viewer
const cp = require('child_process'), path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const port = 9990 + Math.floor(Math.random() * 9);
  const ed = cp.spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(__dirname, 'prof2')}`, '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = l.find(p => p.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch (e) { /* not up */ } if (!ws) await sleep(300); }
  if (ws.readyState !== 1) await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; errs.push(((x.exception && x.exception.description) || x.text).split('\n')[0]); } };
  const call = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
  await call('Runtime.enable');
  await call('Page.navigate', { url: 'file:///' + process.argv[2].replace(/\\/g, '/') });
  await sleep(2500);
  await ev(`document.querySelector('#bTools').click()`); await sleep(400);
  for (const k of await ev(`[...document.querySelectorAll('#toolTabs button[data-tab]')].map(b => b.dataset.tab)`)) { await ev(`document.querySelector('#toolTabs button[data-tab="${k}"]').click()`); await sleep(500); console.log('tab', k.padEnd(9), (await ev(`[...document.querySelectorAll('#toolBody .tab')].filter(t => !t.classList.contains('hidden')).map(t => t.id + ': ' + t.innerText.replace(/\s+/g, ' ').slice(0, 110)).join(' ')`))); }
  await ev(`document.querySelector('#toolTabs button[data-tab="tx"]').click()`); await sleep(600);
  console.log('panel:', await ev(`document.querySelector('#toolBody').innerText.replace(/\\s+/g, ' ').slice(0, 400)`));
  console.log('controls:', await ev(`[...document.querySelectorAll('#toolBody select, #toolBody button')].map(e => e.tagName + ':' + (e.id || e.innerText || '').slice(0, 24) + (e.options ? '(' + e.options.length + ': ' + [...e.options].map(o => o.text).slice(0, 12).join(', ') + ')' : '')).join(' | ')`));
  const n = await ev(`(() => { const s = document.querySelector('#toolBody select'); if (!s) return 0; let k = 0; for (const o of [...s.options]) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); const b = [...document.querySelectorAll('#toolBody button')].find(x => /decode|run|apply/i.test(x.innerText)); if (b) b.click(); k++; } return k; })()`);
  await sleep(800);
  console.log('decoders exercised:', n, '| table rows now:', await ev(`document.querySelectorAll('#toolBody table tr').length`));
  console.log('JS errors:', errs.length ? errs.join(' || ') : 'none');
  ws.close(); ed.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
