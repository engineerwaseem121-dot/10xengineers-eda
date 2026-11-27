// node wavecheck.js <wave.html> — exercises the real waveform viewer in headless Edge and reports JS errors per action
const cp = require('child_process'), path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const port = 9900 + Math.floor(Math.random() * 90);
  const ed = cp.spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(__dirname, 'prof')}`, '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = l.find(p => p.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch (e) { /* not up */ } if (!ws) await sleep(300); }
  if (ws.readyState !== 1) await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; let errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; errs.push('EXCEPTION ' + ((x.exception && x.exception.description) || x.text).split('\n').slice(0, 2).join(' | ')); } else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error ' + d.params.args.map(a => a.value || a.description).join(' ').slice(0, 200)); };
  const call = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return 'EVAL-ERR ' + (r.result.exceptionDetails.exception || {}).description; return r.result && r.result.result ? r.result.result.value : null; };
  await call('Runtime.enable');
  await call('Page.navigate', { url: 'file:///' + process.argv[2].replace(/\\/g, '/') });
  await sleep(2500);
  console.log('load errors: ' + (errs.length ? errs.join(' || ') : 'none'));
  const step = async (name, js, wait = 500) => { const before = errs.length; const v = await ev(js); await sleep(wait); console.log(`${errs.length > before ? 'ERROR' : 'ok   '} ${name.padEnd(34)} ${v == null ? '' : String(v).slice(0, 90)}${errs.length > before ? '\n      ' + errs.slice(before).join('\n      ') : ''}`); };
  const click = sel => `(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'missing ${sel}'; e.click(); return 'clicked';})()`;
  const key = (k, extra = '') => `(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true${extra}})); return 'key ${k}';})()`;
  await step('load: signal tree', `document.querySelectorAll('#tree *').length + ' tree nodes'`);
  await step('add all signals (dblclick leaves)', `(()=>{const l=[...document.querySelectorAll('#tree [data-id], #tree .leaf, #tree li')].slice(0,12); l.forEach(e=>e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))); return l.length+' items';})()`, 900);
  await step('rows shown', `document.querySelectorAll('#names > *').length + ' rows'`);
  for (const b of ['#bFit', '#bZoomIn', '#bZoomOut', '#bZoomCur', '#bMarker', '#bNext', '#bPrev', '#bSidebar', '#bSidebar', '#bTools'])
    await step('button ' + b, click(b));
  for (const t of ['#tab-search', '#tab-markers', '#tab-tx', '#tab-activity', '#tab-log', '#tab-xtrace']) await step('tools tab ' + t, click(t), 600);
  await step('decoder list', `(()=>{const s=[...document.querySelectorAll('#toolBody select')]; return s.length? s.map(x=>x.options.length+' options').join(',') : 'no select';})()`);
  await step('decoder: try each option', `(()=>{const s=document.querySelector('#toolBody select'); if(!s) return 'none'; let n=0; for (const o of s.options){ s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); n++; } return n+' decoders selected';})()`, 900);
  await step('filter signals', `(()=>{const f=document.querySelector('#filter'); if(!f) return 'no filter'; f.value='sum'; f.dispatchEvent(new Event('input',{bubbles:true})); return document.querySelectorAll('#tree *').length+' after filter';})()`);
  await step('FSM pane', click('#bFsm'), 800);
  for (const k of ['f', '+', '-', 'ArrowRight', 'ArrowLeft', 'm', 'Home', 'End']) await step('key ' + k, key(k));
  await step('wheel zoom on waves', `(()=>{const w=document.querySelector('#waves')||document.querySelector('#wave'); if(!w) return 'none'; w.dispatchEvent(new WheelEvent('wheel',{deltaY:-200,ctrlKey:true,bubbles:true})); return 'wheel';})()`);
  await step('click on waveform (cursor)', `(()=>{const w=document.querySelector('#svg')||document.querySelector('#waves'); if(!w) return 'none'; const r=w.getBoundingClientRect(); w.dispatchEvent(new MouseEvent('mousedown',{clientX:r.left+r.width/2,clientY:r.top+20,bubbles:true})); w.dispatchEvent(new MouseEvent('mouseup',{clientX:r.left+r.width/2,clientY:r.top+20,bubbles:true})); return document.querySelector('#readout') ? document.querySelector('#readout').innerText.slice(0,60) : 'clicked';})()`);
  await step('context menu on a row', `(()=>{const r=document.querySelector('#names > *'); if(!r) return 'no row'; r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:50,clientY:120})); const m=document.querySelector('#ctxmenu'); return m ? m.innerText.split('\\n').filter(Boolean).slice(0,8).join(' / ') : 'no menu';})()`);
  await step('clear', click('#bClear'));
  console.log(`\nTOTAL JS errors: ${errs.length}`);
  ws.close(); ed.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
