/**
 * The numbers in the documentation are the numbers the suites produce.
 *
 * Every document in this repository quotes counts — how many checks run, how
 * many suites there are, how many security checks attack rather than assert.
 * Those numbers were corrected by hand five times while this project was being
 * written, and were wrong in at least three documents on three separate
 * occasions, because a number in prose has nothing holding it to the thing it
 * describes.
 *
 * That matters more here than it would elsewhere. The whole argument this
 * repository makes is that its claims are checkable; a README that overstates
 * its own test count by forty is a small lie that costs the large claim its
 * credibility. So the counts are derived by running the suites and compared
 * against what the documents say.
 *
 * Deliberately tolerant in one direction and strict in another: a document may
 * quote a *rounded* figure ("about four seconds"), but an exact integer that
 * claims to be a check count has to be one. The tolerance below is zero for
 * counts; time is not checked at all, because it is a property of the machine.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
};

/* ------------------------------------------------- what is actually true */

/** Run one suite and count its `ok` lines. Cheap: these are all sub-second. */
function countChecks(suite) {
  try {
    const out = execFileSync(process.execPath, [join(root, 'tools/tests', suite)], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return (out.match(/^ok {2}/gm) || []).length;
  } catch (err) {
    // A failing suite still prints its lines; count them rather than reporting
    // zero, which would look like a documentation error instead of a test one.
    return ((err.stdout || '').match(/^ok {2}/gm) || []).length;
  }
}

const securityChecks = countChecks('security.mjs');

// The headless total comes from the runner itself, which is the same number a
// contributor sees, rather than from re-adding the suites here.
let headlessTotal = 0;
let headlessSuites = 0;
try {
  const out = execFileSync(process.execPath, [join(root, 'tools/run-tests.mjs')], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const m = /(\d+) checks across (\d+) suites/.exec(out);
  if (m) { headlessTotal = Number(m[1]); headlessSuites = Number(m[2]); }
} catch (err) {
  const m = /(\d+) checks across (\d+) suites/.exec(err.stdout || '');
  if (m) { headlessTotal = Number(m[1]); headlessSuites = Number(m[2]); }
}

ok('the headless runner reports a total at all', headlessTotal > 0, String(headlessTotal));
ok('and the security suite reports its own', securityChecks > 0, String(securityChecks));
console.log(`     headless: ${headlessTotal} checks / ${headlessSuites} suites · security: ${securityChecks}`);

/* ------------------------------------------ what the documents claim it is */

const DOCS = ['README.md', 'SECURITY.md', 'ARCHITECTURE.md', 'COMPARISON.md',
  'ATTRIBUTION.md', 'PROVENANCE.md'];

/**
 * Any integer adjacent to the word "headless", or to this suite's own suite
 * count, is a claim about the headless total.
 *
 * The suite count is interpolated rather than written in, which is what keeps
 * this narrow: "383 across 10 browser suites" is a different claim and must not
 * match, and it does not, because 10 is not 16. An earlier version spelled the
 * alternatives out by hand ("16 suites|sixteen suites|\d+ suites") and the last
 * of those matched the browser total, which would have failed the build the
 * first time the two numbers legitimately differed.
 */
const HEADLESS_CLAIM = new RegExp(
  String.raw`(\d{3,5})\s*(?:headless\b|checks?[,]?\s*(?:across|in)?\s*${headlessSuites}\s+suites`
  + String.raw`|(?:across|in)\s+${headlessSuites}\s+suites)`,
  'gi',
);

const wrong = [];
for (const doc of DOCS) {
  const path = join(root, doc);
  if (!existsSync(path)) continue;
  const body = readFileSync(path, 'utf8');
  for (const m of body.matchAll(HEADLESS_CLAIM)) {
    const claimed = Number(m[1]);
    if (claimed !== headlessTotal) {
      wrong.push(`${doc}: claims ${claimed}, actual ${headlessTotal}`);
    }
  }
}
ok('every documented headless check count matches the runner',
  wrong.length === 0, wrong.join(' | '));

// The security count is quoted in exactly one place, so it is matched exactly.
const comparison = existsSync(join(root, 'COMPARISON.md'))
  ? readFileSync(join(root, 'COMPARISON.md'), 'utf8') : '';
const securityClaim = /(\d+) security checks run attacks/.exec(comparison);
ok('the documented security check count matches the suite',
  !securityClaim || Number(securityClaim[1]) === securityChecks,
  securityClaim ? `claims ${securityClaim[1]}, actual ${securityChecks}` : 'not quoted');

/* ------------------------------------ claims that went stale once already */

// The command count is deliberately *not* checked here. The registry is
// assembled by buildCommands() at runtime, so no amount of pattern matching
// over commands.js can count it — a first attempt read 6 against an actual
// 202. tools/browser/ui.mjs asserts the real number in a real browser, which
// is where the question can actually be answered. A static check that cannot
// be made correct is worse than no static check, because it either fails
// forever or gets loosened until it means nothing.
const readme = readFileSync(join(root, 'README.md'), 'utf8');
ok('the README still carries a command badge for the browser suite to check',
  /commands-\d+-/.test(readme));

// The desktop build's Electron major, quoted in SECURITY.md if at all.
const desktopPkg = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8'));
const electronRange = desktopPkg.devDependencies.electron;
ok('the desktop build pins a supported Electron major',
  Number(/(\d+)/.exec(electronRange)[1]) >= 38,
  `${electronRange} — Electron drops support for all but the newest majors`);

/* --------------------------- the version, and the platforms actually built */

// Every artefact filename in the prose carries the version, and electron-builder
// takes that version from desktop/package.json rather than from the git tag.
// Three releases in a row shipped files whose names disagreed with something:
// v1.0.1 built TesserCAD-1.0.0-*, and the documents then quoted 1.0.3 against a
// manifest that had moved on. The workflow already refuses a tag that disagrees
// with the manifest; this refuses a *document* that does.
const version = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8')).version;
const FILENAME = /TesserCAD-(\d+\.\d+\.\d+)-/g;
const misnamed = [];
for (const doc of [...DOCS, 'PROVENANCE.md', 'dist/README.md']) {
  const path = join(root, doc);
  if (!existsSync(path)) continue;
  for (const m of readFileSync(path, 'utf8').matchAll(FILENAME)) {
    if (m[1] !== version) misnamed.push(`${doc}: ${m[0]} but the manifest says ${version}`);
  }
}
ok('every artefact filename in the documents carries the manifest version',
  misnamed.length === 0, misnamed.join(' | '));

// A platform is only downloadable if the workflow matrix runs a job for it.
// electron-builder.yml configures a mac target, which reads like macOS builds
// exist; no runner ever produces one, and the README said they were "there
// too". A promise of a download that is not built is the worst kind of
// documentation error, because the reader only finds out after looking.
//
// Asserted as a *positive* requirement — while no macOS job exists, the README
// has to carry the disclaimer — rather than by hunting the README for words
// that sound like an offer. The first version of this check did the latter,
// searching for ".dmg", and failed on the sentence explaining that there is no
// macOS build. That is the fourth time in this repository that a check written
// as a keyword search has matched its own documentation, so it is written the
// other way round here: the thing that must be true is stated, not the thing
// that must be absent.
const workflow = readFileSync(join(root, '.github/workflows/desktop.yml'), 'utf8');
const buildsMac = /os:\s*macos-/.test(workflow);
const readmeDisclaimsMac = /no macOS\s+.{0,12}build/i.test(readme);
ok('the README states plainly that macOS is not built, while it is not built',
  buildsMac || readmeDisclaimsMac,
  buildsMac ? 'a macOS job exists, so the disclaimer is no longer required'
    : readmeDisclaimsMac
      ? 'no macOS job in the matrix; the README says so'
      : 'no macOS job in the matrix, and the README does not say so — add a macOS'
        + ' runner to desktop.yml, or say plainly that there is no macOS build');

/* ------------------------------------------- no document promises the past */

const STALE_PHRASES = [
  ['portable .exe as a current download', /take the .{0,20}portable/i],
  ['a loopback server in the desktop build', /serves? the application (over|from) a loopback/i],
];
const stale = [];
for (const doc of DOCS) {
  const path = join(root, doc);
  if (!existsSync(path)) continue;
  const body = readFileSync(path, 'utf8');
  for (const [label, re] of STALE_PHRASES) if (re.test(body)) stale.push(`${doc}: ${label}`);
}
ok('no document still offers something the build no longer produces',
  stale.length === 0, stale.join(' | '));

console.log(fails ? `\n${fails} FAILURES` : '\nALL DOCUMENTATION CHECKS PASS');
process.exit(fails ? 1 : 0);
