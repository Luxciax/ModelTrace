// Reproducible packaging: reuse the existing reference bank; never recollect data.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const plugin = path.join(here, 'modeltrace-guard');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const parts = (value) => value.match(/.{1,8}/g);
const sourceFiles = await Promise.all([
  readFile(path.join(repo, 'data', 'unified_bank.json')),
  readFile(path.join(repo, 'static', 'fingerprint-core.js')),
  readFile(path.join(repo, 'LICENSE')),
  readFile(path.join(repo, 'static', 'styles.css')),
]);
// Canonical line endings avoid checkout-dependent hashes without touching source files.
const [bank, scorer, license, sharedStyles] = sourceFiles.map((data) => Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
await mkdir(path.join(plugin, 'assets'), { recursive: true });
await Promise.all([
  writeFile(path.join(plugin, 'assets', 'unified_bank.json'), bank),
  cp(path.join(repo, 'data', 'lm-detector-LICENSE'), path.join(plugin, 'assets', 'lm-detector-LICENSE')),
  writeFile(path.join(plugin, 'scripts', 'fingerprint-core.mjs'), scorer),
  writeFile(path.join(plugin, 'LICENSE'), license),
  writeFile(path.join(plugin, 'web', 'modeltrace.css'), sharedStyles),
  writeFile(path.join(plugin, 'assets', 'provenance.json'), JSON.stringify({
    source: 'Ikaleio/lm-detector reference bank; ModelTrace legacy robust scorer',
    sourceCommitParts: parts('175355e8939c2ee7aaeeac2b22186fa5940412c3'),
    sourceUrl: 'https://github.com/Ikaleio/lm-detector',
    scorerCompatibility: 'Uses unified_bank.robust and calibration; not shared_detector.bin or its evaluation results',
    normalization: 'UTF-8 with LF line endings',
    bankPath: 'data/unified_bank.json', scorerPath: 'static/fingerprint-core.js',
    bankSha256Parts: parts(hash(bank)), scorerSha256Parts: parts(hash(scorer)), bankBuiltAt: JSON.parse(bank).built_at,
    modelCount: JSON.parse(bank).models.length, sameContextCalibrated: false, multilingualCalibrated: false,
    sharedStylesPath: 'static/styles.css', sharedStylesSha256Parts: parts(hash(sharedStyles)),
  }, null, 2) + '\n'),
]);
if (process.argv.includes('--deploy-personal')) {
  const target = path.join(homedir(), 'plugins', 'modeltrace-guard');
  // Refuse to overwrite an unrelated directory. Marketplace creation is handled by Codex's scaffold helper.
  let existing;
  try { existing = JSON.parse(await readFile(path.join(target, '.codex-plugin', 'plugin.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!existing || existing.name !== 'modeltrace-guard') throw new Error('First create a personal modeltrace-guard scaffold/marketplace, then deploy');
  await cp(plugin, target, { recursive: true, force: true });
  process.stdout.write(`Deployed personal source: ${target}\n`);
}
process.stdout.write(`Built ${plugin}; bank SHA-256 ${hash(bank)}\n`);
