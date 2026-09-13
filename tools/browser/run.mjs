/**
 * Every browser suite, one process each.
 *
 * Separate processes for the same reason the headless runner uses them: a
 * suite that crashes should not take the others with it, and each one wants
 * its own browser, its own server and its own viewport. A phone suite and a
 * desktop suite cannot share a context.
 *
 * These are deliberately not part of `npm test`. That suite runs in under four
 * seconds and downloads nothing, which is what makes it something a
 * contributor runs constantly; these need a 150 MB browser and take a couple
 * of minutes. Both are worth having, and conflating them would cost the first
 * one its value.
 *
 *   npm run test:browser
 *   node tools/browser/run.mjs app ui        # just these two
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Ordered cheapest-first, so a broken application fails in seconds rather
 * than after two minutes of suites that were never going to pass.
 */
const SUITES = [
  ['csp', 'The Content-Security-Policy, probed with real injection attempts'],
  ['app', 'The application end to end: build, edit, export, undo'],
  ['ui', 'Every command runs, and the interface fits'],
  ['workers', 'The boolean worker pool, under load'],
  ['offline', 'Offline install and ownership'],
  ['dialogs', 'Dialogs, drafting and merge conflict resolution'],
  ['studio', 'Standards, macros and the why-tutor'],
  ['analyse', 'The engineering layer through the interface'],
  ['touch', 'A phone: touch targets, gestures, no zoom on focus'],
  ['responsive', 'Phone, tablet and desktop tiers, and overflow at every width'],
];

const requested = process.argv.slice(2);
const selected = requested.length
  ? SUITES.filter(([name]) => requested.includes(name))
  : SUITES;

if (requested.length && selected.length !== requested.length) {
  const known = SUITES.map(([n]) => n).join(', ');
  console.error(`Unknown suite. Available: ${known}`);
  process.exit(2);
}

const run = (name) => new Promise((resolve) => {
  const file = join(here, `${name}.mjs`);
  if (!existsSync(file)) return resolve({ code: 1, out: `missing: ${file}` });
  const child = spawn(process.execPath, [file], { cwd: join(here, '..', '..') });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => resolve({ code, out }));
});

let failed = 0;
let checks = 0;
const started = Date.now();

for (const [name, description] of selected) {
  const t0 = Date.now();
  const { code, out } = await run(name);
  // Suites print either "ok  "/"FAIL" lines or "PASS"/"FAIL" ones.
  const counted = (out.match(/^(ok {2}|PASS|FAIL)/gm) || []).length;
  checks += counted;
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  if (code === 0) {
    console.log(`ok   ${name.padEnd(11)} ${String(counted).padStart(3)} checks  ${seconds}s   ${description}`);
  } else {
    failed++;
    console.log(`FAIL ${name.padEnd(11)} ${String(counted).padStart(3)} checks  ${seconds}s   ${description}`);
    for (const line of out.split('\n')) {
      if (/^FAIL|CONSOLE ERRORS|PAGEERROR|^ {2}- /.test(line)) console.log(`       ${line}`);
    }
  }
}

const total = ((Date.now() - started) / 1000).toFixed(0);
console.log(
  `\n${checks} checks across ${selected.length} browser suites in ${total}s, ` +
  `${failed} suite${failed === 1 ? '' : 's'} failed`,
);
process.exit(failed ? 1 : 0);
