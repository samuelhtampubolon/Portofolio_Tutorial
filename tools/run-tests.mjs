/**
 * The whole headless test run: the core unit suite, then one suite per
 * engineering module.
 *
 * They are separate processes on purpose. Each module suite seeds its own
 * browser shims and, in the drawing suite's case, spends a second doing real
 * hidden-line removal; running them in one process would make a failure in one
 * hide the rest, and running them in one file would make that file 2,000 lines
 * of unrelated arithmetic.
 *
 *   npm test
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['security', 'tests/security.mjs'],
  ['architecture', 'tests/architecture.mjs'],
  ['desktop', 'tests/desktop.mjs'],
  ['bindings', 'tests/bindings.mjs'],
  ['core', 'test.mjs'],
  ['entity', 'tests/entity.mjs'],
  ['history', 'tests/history.mjs'],
  ['parallel', 'tests/parallel.mjs'],
  ['grammar', 'tests/speak.mjs'],
  ['fasteners', 'tests/fasteners.mjs'],
  ['hygiene', 'tests/hygiene.mjs'],
  ['drawing', 'tests/drawing.mjs'],
  ['tolerance', 'tests/tolerance.mjs'],
  ['merge', 'tests/merge.mjs'],
  ['design as code', 'tests/spec.mjs'],
  ['deviation', 'tests/deviation.mjs'],
];

const run = (file) => new Promise((resolve) => {
  const child = spawn(process.execPath, [join(here, file)], { cwd: join(here, '..') });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

let failed = 0;
let checks = 0;
const lines = [];

for (const [label, file] of SUITES) {
  const started = Date.now();
  const { code, out } = await run(file);
  const ran = (out.match(/^ok\b/gm) || []).length + (out.match(/^ok  /gm) || []).length;
  const n = (out.match(/^(ok|PASS|FAIL) /gm) || []).length || ran;
  checks += n;
  if (code !== 0) {
    failed++;
    lines.push(`FAIL ${label} (${file})`);
    lines.push(out.split('\n').filter(l => /^FAIL/.test(l)).map(l => `       ${l}`).join('\n'));
  } else {
    lines.push(`ok   ${label.padEnd(14)} ${String(n).padStart(3)} checks  ${Date.now() - started} ms`);
  }
}

console.log(lines.join('\n'));
console.log(`\n${checks} checks across ${SUITES.length} suites, ${failed} suite${failed === 1 ? '' : 's'} failed`);
process.exit(failed ? 1 : 0);
