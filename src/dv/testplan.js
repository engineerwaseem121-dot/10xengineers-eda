'use strict';
/*
 * Version-controlled YAML test plan.
 *  - Authored part (requirements, scenarios, checkers, coverage_bins, tests): written once, then only
 *    *appended to* on regeneration (new IDs) — engineer edits, mappings, status and notes are preserved.
 *  - Results block between the markers is rewritten after every run.
 */
const { parseYaml } = require('../vplan');

const BEGIN = '# >>> DVFLOW RESULTS (generated after every run - do not edit inside this block) >>>';
const END = '# <<< DVFLOW RESULTS <<<';
const Q = s => JSON.stringify(String(s == null ? '' : s));
const list = a => '[' + (a || []).join(', ') + ']';
const SECTIONS = ['requirements', 'scenarios', 'checkers', 'coverage_bins', 'tests'];

function entries(cfg, model) {
  const testsOf = {};
  model.scenarios.forEach(s => (testsOf[s.test] = testsOf[s.test] || []).push(s.id));
  const checkerIds = model.checkers.map(c => c.id).concat(cfg.options.assertions ? ['CHK-SVA'] : []);
  return {
    requirements: model.requirements.map(r => ({ id: r.id, text: `  - id: ${r.id}\n    text: ${Q(r.text)}\n    notes: ""` })),
    scenarios: model.scenarios.map(s => ({ id: s.id, text: `  - id: ${s.id}\n    requirement: ${s.req}\n    title: ${Q(s.title)}\n    description: ${Q(s.desc)}\n    stimulus: ${Q(s.stimulus)}\n    expected: ${Q(s.expected)}\n    tests: [TEST-${s.test}]\n    checkers: ${list(checkerIds)}\n    coverage_bins: ${list(model.bins.filter(b => b.scenario === s.id).map(b => b.id))}\n    status: planned        # planned | skipped | blocked  (results are recorded separately below)\n    notes: ""` })),
    checkers: model.checkers.map(c => ({ id: c.id, text: `  - id: ${c.id}\n    kind: ${c.kind}\n    description: ${Q(c.desc)}` })).concat(cfg.options.assertions ? [{ id: 'CHK-SVA', text: `  - id: CHK-SVA\n    kind: assertion\n    description: "concurrent SVA checker sva_${cfg.dut.top} (Questa/VCS only)"\n    requires: assertions` }] : []),
    coverage_bins: model.bins.map(b => ({ id: b.id, text: `  - id: ${b.id}\n    scenario: ${b.scenario}\n    definition: ${Q(b.desc + '   [' + b.cond + ']')}\n    stimulus_hint: ${Q(b.stimulus)}` })),
    tests: Object.entries(testsOf).map(([t, ids]) => ({ id: 'TEST-' + t, text: `  - id: TEST-${t}\n    name: ${t}\n    scenarios: ${list(ids)}` }))
  };
}

function fresh(cfg, model) {
  const e = entries(cfg, model);
  return `# Test plan - ${cfg.dut.top} (template: ${cfg.template})
# Engineer-owned. Edit requirements, scenarios, mappings, status (planned | skipped | blocked) and notes freely.
# Regenerating keeps your edits and only appends new IDs. Only the RESULTS block at the end is rewritten after a run.
plan_version: 1
dut: ${cfg.dut.top}
template: ${cfg.template}
behavior_spec: dvflow.json

requirements:
${e.requirements.map(x => x.text).join('\n')}

scenarios:
${e.scenarios.map(x => x.text).join('\n')}

checkers:
${e.checkers.map(x => x.text).join('\n')}

coverage_bins:
${e.coverage_bins.map(x => x.text).join('\n')}

tests:
${e.tests.map(x => x.text).join('\n')}

${BEGIN}
results:
  status: "no runs yet"
${END}
`;
}

function mergePlan(existing, cfg, model) {
  if (!existing) return fresh(cfg, model);
  const e = entries(cfg, model);
  const present = new Set([...existing.matchAll(/^\s*-\s*id:\s*([\w.@-]+)/gm)].map(m => m[1]));
  let lines = existing.split(/\r?\n/);
  const stamp = new Date().toISOString().slice(0, 10);
  for (const sec of SECTIONS) {
    const add = e[sec].filter(x => !present.has(x.id));
    if (!add.length) continue;
    const block = [`  # added by regeneration ${stamp}`, ...add.map(x => x.text).join('\n').split('\n')];
    let i = lines.findIndex(l => new RegExp('^' + sec + ':\\s*$').test(l));
    if (i < 0) {
      const b = lines.findIndex(l => l.startsWith('# >>> DVFLOW RESULTS'));
      const at = b >= 0 ? b : lines.length;
      lines.splice(at, 0, `${sec}:`, ...block, '');
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !/^[A-Za-z#]/.test(lines[j])) j++;
    let k = j;
    while (k > i + 1 && lines[k - 1].trim() === '') k--;
    lines.splice(k, 0, ...block);
  }
  let out = lines.join('\n');
  if (!out.includes(BEGIN)) out = out.replace(/\s*$/, '\n\n') + `${BEGIN}\nresults:\n  status: "no runs yet"\n${END}\n`;
  return out;
}

function parsePlan(text) {
  if (!text) return {};
  const authored = text.split(BEGIN)[0];
  try { return parseYaml(authored) || {}; } catch (e) { return {}; }
}

function updateResults(text, res, runRel) {
  const t = res.totals;
  const block = [
    BEGIN,
    'results:',
    `  run_id: ${res.meta.runId}`,
    `  date: ${Q(res.meta.finished)}`,
    `  simulator: ${Q(res.meta.simLabel + ' ' + res.meta.simVersion)}`,
    `  source_revision: ${Q(res.meta.rev)}`,
    `  suite: ${res.meta.suite}`,
    `  tests: ${list(res.meta.tests)}`,
    `  seeds: ${list(res.meta.seeds)}`,
    `  configs: ${list(res.meta.configs)}`,
    '  totals:',
    ...Object.entries(t).map(([k, v]) => `    ${k}: ${v}`),
    `  functional_coverage_pct: ${res.coverage.functional.pct == null ? 'null' : res.coverage.functional.pct}`,
    '  coverage_types:',
    ...res.coverage.types.map(x => `    - type: ${Q(x.type)}\n      state: ${Q(x.state)}${x.pct != null ? `\n      pct: ${x.pct}` : ''}`),
    `  report: ${runRel}/report/index.html`,
    '  scenarios:',
    ...res.scenarios.map(s => [
      `    - id: ${s.id}`,
      `      execution: ${Q(s.execution)}      # passed | failed | not run | blocked | skipped | planned`,
      `      coverage: ${Q(s.coverage)}        # covered | partial | not covered | n/a (tracked separately from execution)`,
      ...(s.runs.length ? ['      runs:', ...s.runs.map(r => `        - test: ${r.test}\n          seed: ${r.seed}\n          config: ${r.config}\n          result: ${r.status}\n          checks: ${r.checks}\n          fails: ${r.fails}\n          evidence: ${runRel}/${r.evidence}`)] : [])
    ].join('\n')),
    '  requirements:',
    ...res.requirements.map(q => `    - id: ${q.id}\n      execution: ${Q(q.execution)}\n      coverage_pct: ${q.coveragePct == null ? 'null' : q.coveragePct}`),
    '  failures:',
    ...(res.runs.filter(r => r.failureDir).map(r => `    - test: ${r.test}\n      seed: ${r.seed}\n      config: ${r.config}\n      status: ${r.status}\n      classification: ${Q(r.classification ? r.classification.label : '')}\n      first_error: ${Q(r.firstError)}\n      triage: ${runRel}/${r.failureDir}/triage.md`)),
    END
  ].join('\n');
  if (text.includes(BEGIN) && text.includes(END)) return text.slice(0, text.indexOf(BEGIN)) + block + text.slice(text.indexOf(END) + END.length);
  return text.replace(/\s*$/, '\n\n') + block + '\n';
}

module.exports = { mergePlan, parsePlan, updateResults, BEGIN, END };
