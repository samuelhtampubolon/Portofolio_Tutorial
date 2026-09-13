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
import { existsSync, readFileSync } from 'node:fs';
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
  ['subpath', 'The site served from a subdirectory, as GitHub Pages serves it'],
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

/**
 * Each suite has its own watchdog, so this is the second line of defence: it
 * covers a child that wedges before the watchdog is armed, or that ignores it.
 * Generous on purpose — it is here to bound the worst case, not to police
 * how long a suite takes.
 */
const SUITE_TIMEOUT_MS = 600_000;

const run = (name) => new Promise((resolve) => {
  const file = join(here, `${name}.mjs`);
  if (!existsSync(file)) return resolve({ code: 1, out: `missing: ${file}` });
  const child = spawn(process.execPath, [file], { cwd: join(here, '..', '..') });
  let out = '';
  let settled = false;
  const done = (code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, out }); } };

  const timer = setTimeout(() => {
    out += `\nFAIL the suite ran past ${SUITE_TIMEOUT_MS / 1000}s and was killed\n`;
    child.kill('SIGTERM');
    // A wedged Chromium ignores SIGTERM often enough to be worth following up.
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    done(1);
  }, SUITE_TIMEOUT_MS);

  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('error', err => { out += `\nFAIL could not start the suite: ${err.message}\n`; done(1); });
  child.on('close', done);
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

/*
 * The documents quote this total, and only a full run can produce it.
 *
 * tools/tests/docs.mjs holds the headless count and the security count to what
 * the suites actually report, but it cannot check this one: counting browser
 * checks means starting a browser, which is the thing `npm test` exists to
 * avoid. So the browser half of that promise is kept here, where the number is
 * already in hand.
 *
 * Checked only on a full run. `node tools/browser/run.mjs app ui` legitimately
 * produces a smaller number, and failing on that would be nonsense.
 *
 * Between them the two checks close the loop on the "tests passing" badge,
 * which is the headless total plus this one plus the desktop shell's, and which
 * was wrong by twenty-seven before this was written.
 */
if (!failed && selected.length === SUITES.length) {
  const root = join(here, '../..');
  const stale = [];
  // "382 across 10 browser suites", "Ten suites, 382 checks", "382 in 10 browser suites"
  const CLAIM = /(\d{2,5})\s*(?:checks?\s*)?(?:across|in)?\s*(?:\d+|[a-z]+)\s*browser suites|(?:[a-z]+|\d+) suites, (\d{2,5}) checks/gi;
  for (const doc of ['README.md', 'COMPARISON.md', 'ARCHITECTURE.md', 'PROVENANCE.md']) {
    const path = join(root, doc);
    if (!existsSync(path)) continue;
    const body = readFileSync(path, 'utf8');
    for (const m of body.matchAll(CLAIM)) {
      const claimed = Number(m[1] ?? m[2]);
      if (claimed !== checks) stale.push(`${doc}: claims ${claimed}, actual ${checks}`);
    }
    const badge = /badge\/tests-(\d+)%20passing/.exec(body);
    if (badge) {
      const headless = /(\d{3,5}) headless/.exec(readFileSync(join(root, 'COMPARISON.md'), 'utf8'));
      const desktop = /(\d+) in the real desktop shell/.exec(readFileSync(join(root, 'COMPARISON.md'), 'utf8'));
      if (headless && desktop) {
        const want = Number(headless[1]) + checks + Number(desktop[1]);
        if (Number(badge[1]) !== want) {
          stale.push(`${doc}: badge says ${badge[1]}, ${headless[1]} + ${checks} + ${desktop[1]} = ${want}`);
        }
      }
    }
  }
  if (stale.length) {
    console.log(`\nFAIL the documented browser check count is stale\n       ${stale.join('\n       ')}`);
    process.exit(1);
  }
  console.log('ok   every document that quotes this total agrees with it');
}

process.exit(failed ? 1 : 0);
