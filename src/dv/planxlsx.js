'use strict';
/* testplan.xlsx — the test plan with the latest results and the reason for every non-pass. Rewritten after each run. */
const fs = require('fs');
const path = require('path');
const xlsx = require('../xlsx');
const plan = require('./testplan');

function write(root, res) {
  const tpText = fs.existsSync(path.join(root, 'testplan.yaml')) ? fs.readFileSync(path.join(root, 'testplan.yaml'), 'utf8') : '';
  const authored = plan.parsePlan(tpText);
  const runDir = path.join(root, 'runs', res.meta.runId);
  const abs = p => path.join(runDir, p);
  const ok = s => (s === 'PASS' ? 'PASS' : s);
  const byScenario = id => res.runs.filter(r => r.scenarios && r.scenarios[id] && r.scenarios[id].ran);

  // why a scenario is not "passed + covered"
  const why = s => {
    const reasons = [];
    const rr = byScenario(s.id);
    if (s.execution === 'failed') rr.filter(r => r.status !== 'PASS' || (r.scenarios[s.id] && r.scenarios[s.id].fails)).forEach(r => reasons.push(`${r.test} seed ${r.seed}${res.meta.configs.length > 1 ? ' (' + r.config + ')' : ''}: ${r.firstError || r.status}`));
    if (s.execution === 'not run') reasons.push(res.runs.every(r => r.test !== s.test) ? `test '${s.test}' was not in this run (tests: ${res.meta.tests.join(', ')})` : 'scenario did not execute');
    if (s.execution === 'blocked') reasons.push((res.runs.find(r => r.firstError) || {}).firstError || 'simulator / build blocked');
    if (s.execution === 'skipped') { const a = (authored.scenarios || []).find(x => x.id === s.id); reasons.push('skipped by the engineer' + (a && a.notes ? ': ' + a.notes : '')); }
    const unhit = res.bins.filter(b => b.scenario === s.id && b.state === 'unhit');
    if (unhit.length) reasons.push('coverage holes: ' + unhit.map(b => `${b.id} (${b.suggestion ? b.suggestion.kind + ' — ' + b.suggestion.stimulus : ''})`).join('; '));
    return reasons.join('\n');
  };

  const t = res.totals;
  const sheets = [
    {
      name: 'Summary', title: `Test plan results — ${res.meta.dut}`, subtitle: `run ${res.meta.runId} · ${res.meta.simLabel} ${res.meta.simVersion} · ${res.meta.finished}`,
      columns: [{ header: 'Item', width: 28 }, { header: 'Value', width: 100 }],
      rows: [
        ['Result', t.pass === t.runs && t.runs ? 'PASS' : 'FAIL'],
        ['Runs passed', `${t.pass} / ${t.runs}`],
        ['Failed / timeout / license / error / blocked', `${t.fail} / ${t.timeout} / ${t.license || 0} / ${t.error + t.incomplete} / ${t.blocked}`],
        ['Functional coverage', res.coverage.functional.pct == null ? 'n/a' : res.coverage.functional.pct + '%'],
        ['Scenarios passed', `${res.scenarios.filter(s => s.execution === 'passed').length} / ${res.scenarios.length}`],
        ['Simulator', `${res.meta.simLabel} ${res.meta.simVersion}`],
        ['Tests / seeds / configs', `${res.meta.tests.join(', ')} / ${res.meta.seeds.join(', ')} / ${res.meta.configs.join(', ')}`],
        ['Project folder', root],
        ['Run folder', runDir],
        ['HTML dashboard', abs('report/index.html')],
        ['Test plan (YAML)', path.join(root, 'testplan.yaml')],
        ['Results (JSON)', abs('results.json')],
        ['JUnit', abs('junit.xml')],
        ...(res.runs.some(r => r.failureDir) ? [['Failure folders', abs('failures')]] : [])
      ], statusCol: 1
    },
    {
      name: 'Requirements', columns: [{ header: 'ID', width: 14 }, { header: 'Requirement', width: 70 }, { header: 'Scenarios', width: 30 }, { header: 'Execution' }, { header: 'Coverage %', type: 'pct' }, { header: 'Notes (engineer)', width: 40 }],
      rows: res.requirements.map(q => { const a = (authored.requirements || []).find(x => x.id === q.id) || {}; return [q.id, q.text, q.scenarios.join(', '), q.execution === 'passed' ? 'PASS' : q.execution === 'failed' ? 'FAIL' : q.execution.toUpperCase(), q.coveragePct == null ? '' : q.coveragePct, a.notes || '']; }),
      statusCol: 3
    },
    {
      name: 'Scenarios', columns: [{ header: 'ID', width: 13 }, { header: 'Req', width: 12 }, { header: 'Title', width: 26 }, { header: 'Stimulus', width: 40 }, { header: 'Expected', width: 34 }, { header: 'Test' }, { header: 'Plan status' }, { header: 'Execution' }, { header: 'Coverage' }, { header: 'Runs (pass/total)' }, { header: 'Why (failure / not run / holes)', width: 80 }],
      rows: res.scenarios.map(s => {
        const a = (authored.scenarios || []).find(x => x.id === s.id) || {};
        const rr = s.runs;
        return [s.id, s.req, s.title, s.stimulus, s.expected, s.test, a.status || 'planned', s.execution === 'passed' ? 'PASS' : s.execution === 'failed' ? 'FAIL' : s.execution.toUpperCase(), s.coverage === 'covered' ? 'COVERED' : s.coverage === 'partial' ? 'PARTIAL' : s.coverage.toUpperCase(), `${rr.filter(r => r.status === 'PASS' && !r.fails).length} / ${rr.length}`, why(s)];
      }),
      statusCol: 7
    },
    {
      name: 'Runs', columns: [{ header: 'Config' }, { header: 'Test' }, { header: 'Seed', type: 'num' }, { header: 'Status' }, { header: 'Stage' }, { header: 'Time (s)', type: 'num' }, { header: 'Checks', type: 'num' }, { header: 'Errors', type: 'num' }, { header: 'Why', width: 60 }, { header: 'Next action', width: 60 }, { header: 'Run folder', width: 70 }, { header: 'Failure folder', width: 70 }],
      rows: res.runs.map(r => [r.config, r.test, r.seed, ok(r.status), r.stage || '', r.time || 0, r.checks || 0, r.errors || 0, r.firstError || '', r.nextAction || '', abs(r.dir), r.failureDir ? abs(r.failureDir) : '']),
      statusCol: 3
    },
    {
      name: 'Coverage bins', columns: [{ header: 'Bin', width: 24 }, { header: 'Scenario', width: 13 }, { header: 'Definition', width: 50 }, { header: 'Hits', type: 'num' }, { header: 'State' }, { header: 'Hit by (test#seed)', width: 40 }, { header: 'Suggestion when unhit', width: 70 }],
      rows: res.bins.map(b => [b.id, b.scenario, `${b.desc}  [${b.cond}]`, b.hits, b.state === 'hit' ? 'HIT' : b.state === 'unhit' ? 'HOLE' : b.state.toUpperCase(), b.contributors.map(c => `${c.test}#${c.seed}`).join(', '), b.suggestion ? `${b.suggestion.kind}: ${b.suggestion.reason} Stimulus: ${b.suggestion.stimulus}` : '']),
      statusCol: 4
    }
  ];
  const fails = res.runs.filter(r => r.failureDir);
  if (fails.length) sheets.push({
    name: 'Failures', columns: [{ header: 'Test' }, { header: 'Seed', type: 'num' }, { header: 'Config' }, { header: 'Classification', width: 26 }, { header: 'First error', width: 60 }, { header: 'triage.md', width: 80 }, { header: 'Rerun', width: 70 }],
    rows: fails.map(r => [r.test, r.seed, r.config, (r.classification || {}).label || r.status, r.firstError || '', abs(path.join(r.failureDir, 'triage.md')), abs(path.join(r.failureDir, process.platform === 'win32' ? 'rerun.cmd' : 'rerun.sh'))])
  });
  const out = path.join(root, 'testplan.xlsx');
  try { fs.writeFileSync(out, xlsx.build(sheets, { goal: 100, title: 'Test plan ' + res.meta.dut })); }
  catch (e) { fs.writeFileSync(path.join(runDir, 'testplan.xlsx'), xlsx.build(sheets, { goal: 100 })); return path.join(runDir, 'testplan.xlsx'); }   // workbook open in Excel: write a copy in the run folder
  return out;
}

/** latest run results of a project, or null */
function latestResults(root) {
  try {
    const id = fs.readFileSync(path.join(root, 'runs', 'latest.txt'), 'utf8').trim();
    return JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'results.json'), 'utf8'));
  } catch (e) { return null; }
}

/**
 * testplan.xlsx written straight from testplan.yaml, so the Excel plan exists as soon as the plan is generated.
 * If the project already has runs and they cover every scenario, the full results workbook is written instead;
 * otherwise each scenario shows the latest result where there is one, and NOT RUN elsewhere.
 */
function writePlan(root) {
  const tpPath = path.join(root, 'testplan.yaml');
  if (!fs.existsSync(tpPath)) return null;
  const p = plan.parsePlan(fs.readFileSync(tpPath, 'utf8'));
  const reqs = p.requirements || [], scs = p.scenarios || [], chks = p.checkers || [], bins = p.coverage_bins || [], tests = p.tests || [];
  const res = latestResults(root);
  if (res && scs.length && scs.every(s => (res.scenarios || []).some(x => x.id === s.id))) return write(root, res);
  const arr = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).join(', ');
  const exec = id => { const s = res && (res.scenarios || []).find(x => x.id === id); return !s ? 'NOT RUN' : s.execution === 'passed' ? 'PASS' : s.execution === 'failed' ? 'FAIL' : String(s.execution).toUpperCase(); };
  const binState = id => { const b = res && (res.bins || []).find(x => x.id === id); return !b ? 'NOT RUN' : b.state === 'hit' ? 'HIT' : b.state === 'unhit' ? 'HOLE' : String(b.state).toUpperCase(); };
  const reqExec = r => { const mine = scs.filter(s => s.requirement === r.id).map(s => exec(s.id)); return !mine.length ? 'NO SCENARIO' : mine.includes('FAIL') ? 'FAIL' : mine.every(x => x === 'PASS') ? 'PASS' : 'NOT RUN'; };
  const sheets = [
    {
      name: 'Summary', title: `Test plan — ${p.dut || path.basename(root)}`, subtitle: `${res ? 'latest run ' + res.meta.runId + ' (does not cover every scenario yet)' : 'not run yet'} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      columns: [{ header: 'Item', width: 28 }, { header: 'Value', width: 100 }],
      rows: [
        ['DUT', p.dut || ''],
        ['Template', p.template || ''],
        ['Requirements', String(reqs.length)],
        ['Scenarios', `${scs.length} (${scs.filter(s => (s.status || 'planned') === 'planned').length} planned, ${scs.filter(s => s.status === 'skipped').length} skipped, ${scs.filter(s => s.status === 'blocked').length} blocked)`],
        ['Checkers', String(chks.length)],
        ['Coverage bins', String(bins.length)],
        ['Tests', tests.map(t => t.name || t.id).join(', ')],
        ['Status', res ? 'partly run: run a regression to fill in every result' : 'NOT RUN: run a regression; this workbook is then rewritten with results, coverage and failure reasons'],
        ['Project folder', root],
        ['Test plan (YAML)', tpPath]
      ], statusCol: 1
    },
    {
      name: 'Requirements', columns: [{ header: 'ID', width: 14 }, { header: 'Requirement', width: 70 }, { header: 'Scenarios', width: 30 }, { header: 'Execution' }, { header: 'Notes (engineer)', width: 40 }],
      rows: reqs.map(r => [r.id, r.text || '', scs.filter(s => s.requirement === r.id).map(s => s.id).join(', '), reqExec(r), r.notes || '']),
      statusCol: 3
    },
    {
      name: 'Scenarios', columns: [{ header: 'ID', width: 13 }, { header: 'Req', width: 12 }, { header: 'Title', width: 26 }, { header: 'Description', width: 40 }, { header: 'Stimulus', width: 40 }, { header: 'Expected', width: 34 }, { header: 'Tests', width: 18 }, { header: 'Checkers', width: 20 }, { header: 'Coverage bins', width: 40 }, { header: 'Plan status' }, { header: 'Execution' }, { header: 'Notes (engineer)', width: 40 }],
      rows: scs.map(s => [s.id, s.requirement || '', s.title || '', s.description || '', s.stimulus || '', s.expected || '', arr(s.tests), arr(s.checkers), arr(s.coverage_bins), s.status || 'planned', exec(s.id), s.notes || '']),
      statusCol: 10
    },
    {
      name: 'Coverage bins', columns: [{ header: 'Bin', width: 26 }, { header: 'Scenario', width: 13 }, { header: 'Definition', width: 60 }, { header: 'Stimulus hint', width: 50 }, { header: 'State' }],
      rows: bins.map(b => [b.id, b.scenario || '', b.definition || '', b.stimulus_hint || '', binState(b.id)]),
      statusCol: 4
    },
    {
      name: 'Checkers', columns: [{ header: 'ID', width: 16 }, { header: 'Kind', width: 14 }, { header: 'Description', width: 80 }],
      rows: chks.map(c => [c.id, c.kind || '', c.description || ''])
    },
    {
      name: 'Tests', columns: [{ header: 'ID', width: 18 }, { header: 'Name', width: 16 }, { header: 'Scenarios', width: 60 }],
      rows: tests.map(t => [t.id, t.name || '', arr(t.scenarios)])
    }
  ];
  const out = path.join(root, 'testplan.xlsx');
  try { fs.writeFileSync(out, xlsx.build(sheets, { goal: 100, title: 'Test plan ' + (p.dut || '') })); return out; }
  catch (e) {
    // open in Excel (file locked): leave it and write next to it
    const alt = path.join(root, 'testplan.new.xlsx');
    fs.writeFileSync(alt, xlsx.build(sheets, { goal: 100 }));
    return alt;
  }
}

module.exports = { write, writePlan, latestResults };
