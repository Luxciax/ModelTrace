// Offline regression against real previously collected references, not new monitoring accuracy.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadArtifacts } from './modeltrace-guard/scripts/guard.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rows = (await readFile(path.join(repo, 'data', 'gpt_reference.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
const { bank, analyzeGlobalOutputs } = await loadArtifacts();
const models = bank.models.filter((model) => model.family === 'gpt').map((model) => model.id);
assert.ok(models.length > 0, 'Packaged bank has no GPT models');
const references = new Map();
for (const row of rows) if (row.strict_valid) {
  const list = references.get(row.model_id) || [];
  if (list.length < 3) list.push(row);
  references.set(row.model_id, list);
}
const verifiedModels = models.filter((model) => (references.get(model)?.length || 0) >= 3);
const skippedModels = models.filter((model) => !verifiedModels.includes(model));
assert.ok(verifiedModels.length > 0, 'No packaged GPT models have enough saved references for parity verification');
const cases = verifiedModels.flatMap((model) => [1, 3].map((k) => ({
  model, outputs: references.get(model).slice(0, k).map((row) => ({ text: row.text, expected_count: row.requested_count })),
})));
const pythonCandidates = process.env.MODELTRACE_PYTHON
  ? [[process.env.MODELTRACE_PYTHON, []]]
  : process.platform === 'win32' ? [['python', []], ['py', ['-3']], ['python3', []]] : [['python3', []], ['python', []]];
let pythonRuntime = null;
for (const [command, prefix] of pythonCandidates) {
  const check = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8', timeout: 5000 });
  if (check.status === 0) { pythonRuntime = { command, prefix }; break; }
}
assert.ok(pythonRuntime, 'Python 3 runtime not found; set MODELTRACE_PYTHON to an absolute executable path');
const python = spawnSync(pythonRuntime.command, [...pythonRuntime.prefix, '-c',
  'import json,sys; from fingerprint import analyze_global_outputs; bank=json.load(open("data/unified_bank.json",encoding="utf-8")); print(json.dumps([analyze_global_outputs(case["outputs"],bank) for case in json.load(sys.stdin)]))',
], { cwd: repo, input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
assert.equal(python.status, 0, python.stderr);
const expected = JSON.parse(python.stdout);
let largestError = 0;
for (const [index, item] of cases.entries()) {
  const actual = analyzeGlobalOutputs(item.outputs, bank);
  assert.equal(actual.prediction, expected[index].prediction);
  for (const result of actual.results) {
    const reference = expected[index].results.find((candidate) => candidate.model === result.model);
    const error = Math.abs(reference.probability - result.probability);
    largestError = Math.max(largestError, error);
    assert.ok(error < 1e-10, `${item.model}: ${error}`);
  }
}
process.stdout.write(JSON.stringify({ cases: cases.length, pythonRuntime: [pythonRuntime.command, ...pythonRuntime.prefix].join(' '), verifiedModels, skippedModels, passed: true, largestProbabilityDifference: largestError, note: 'Saved-reference scorer parity only. Models added by merged banks without legacy references are reported as skipped, not treated as parity failures; this is not same-context or multilingual detection calibration.' }) + '\n');
