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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

/* --------------------------------- every link points at this repository */

// The repository was renamed from Portofolio_Tutorial to TesserCAD, and the
// name appeared in twenty places: prose links, clone instructions, the two
// `gh attestation verify --repo` examples, the desktop manifest, and three
// Help menu items that open a browser from inside the application.
//
// GitHub redirects an old repository URL to the new one, so a stale link keeps
// working and nothing tells you it is stale. That is the problem: it decays
// quietly, and it stops working the day the old name is claimed by someone
// else. GitHub Pages does not redirect at all, so a stale live-app link is
// simply dead.
//
// The manifest's `repository` field is the single source of truth, because
// electron-builder already reads it and a wrong value there breaks the build
// loudly. Every link under this owner is compared against it. Links to other
// owners are third-party — the thirteen prior-art projects — and are left
// alone.
const repoUrl = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8')).repository.url;
const [, owner, repoName] = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(repoUrl);

const LINKED = [...DOCS, 'dist/README.md', 'src/ui/commands.js', 'src/main.js'];

// One exemption, as narrow as it can be made.
//
// A build-provenance attestation records the repository URL at the moment it
// was signed, so the v1.0.4 artefacts name the old repository for ever, and
// `gh attestation verify --repo <new name>` will not match them. The documents
// have to say so, which means they have to write the old name down.
//
// Permitted only inside the blockquote that carries that caveat, identified by
// the sentence it opens with, and only for this one name.
//
// The first attempt exempted any blockquote line, which was wrong and was
// caught by testing it: the README's download callout is a blockquote too, so
// a stale Releases link in the most prominent place on the page would have
// passed. Scoped to the block, not the line.
//
// Everything else still fails: a stale link on an ordinary line, any other
// wrong name even inside this block, and any stale Pages path anywhere, since
// Pages has no redirect and there is no historical reason to name the old one.
const HISTORICAL_NAME = 'Portofolio_Tutorial';
const EXEMPT_BLOCK_MARKER = 'before the repository was renamed';

/** Character ranges of blockquote blocks that carry the rename caveat. */
function exemptRanges(body) {
  const ranges = [];
  let start = null, offset = 0;
  const flush = (end) => {
    if (start === null) return;
    if (body.slice(start, end).includes(EXEMPT_BLOCK_MARKER)) ranges.push([start, end]);
    start = null;
  };
  for (const line of body.split('\n')) {
    const isQuote = line.trimStart().startsWith('>');
    if (isQuote && start === null) start = offset;
    if (!isQuote) flush(offset);
    offset += line.length + 1;
  }
  flush(offset);
  return ranges;
}

const badLinks = [];
for (const doc of LINKED) {
  const path = join(root, doc);
  if (!existsSync(path)) continue;
  const body = readFileSync(path, 'utf8');
  const exempt = exemptRanges(body);
  const isHistoricalNote = (index, named) =>
    named === HISTORICAL_NAME && exempt.some(([a, b]) => index >= a && index < b);

  // github.com/<this owner>/<anything> must be this repository.
  for (const m of body.matchAll(new RegExp(`github\\.com/${owner}/([A-Za-z0-9_.-]+)`, 'g'))) {
    const named = m[1].replace(/\.git$/, '');
    if (named === repoName) continue;
    if (isHistoricalNote(m.index, named)) continue;
    badLinks.push(`${doc}: github.com/${owner}/${named}`);
  }
  // <owner>.github.io/<path> is the Pages site, whose path is the repo name.
  for (const m of body.matchAll(new RegExp(`${owner}\\.github\\.io/([A-Za-z0-9_.-]+)`, 'g'))) {
    // Pages has no redirect, so a stale live-app link is simply dead. No
    // exemption here: there is no historical reason to name the old path.
    if (m[1] !== repoName) badLinks.push(`${doc}: ${owner}.github.io/${m[1]}`);
  }
  // `--repo owner/name` in the attestation examples.
  for (const m of body.matchAll(new RegExp(`--repo ${owner}/([A-Za-z0-9_.-]+)`, 'g'))) {
    if (m[1] === repoName) continue;
    if (isHistoricalNote(m.index, m[1])) continue;
    badLinks.push(`${doc}: --repo ${owner}/${m[1]}`);
  }
}
ok(`every link under ${owner}/ points at ${repoName}, the repository the manifest names`,
  badLinks.length === 0, badLinks.join(' | '));

/* ------------------------------------------- the licence GitHub can read */

// GitHub reported this repository's licence as NOASSERTION, meaning its
// detector could not match LICENSE to any known one, so the sidebar showed no
// licence at all. The text was verbatim MIT; what defeated the match was a
// two-line note appended after a rule, explaining that three.js is bundled.
//
// That matters more here than it would elsewhere. This project's licence story
// is a substantive claim — MIT, with ten GPL-family projects deliberately kept
// out of it — and a repository whose stated licence is "unrecognised" argues
// against that claim on its own front page.
//
// The note moved to NOTICE, where bundled-component attribution belongs, and
// where ATTRIBUTION.md, PROVENANCE.md and vendor/THREE-LICENSE.txt already
// carried the same information. LICENSE is now nothing but the MIT text.
//
// Checked by normalising whitespace and comparing against the MIT body, so
// this cannot regress by someone appending a helpful paragraph again.
const MIT_BODY = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction, including without limitation the rights',
  'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  'copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
].join(' ');

const licence = readFileSync(join(root, 'LICENSE'), 'utf8');
const flat = licence.replace(/\s+/g, ' ').trim();
ok('LICENSE opens with the MIT title and a copyright line',
  /^MIT License Copyright \(c\) \d{4} \S/.test(flat), flat.slice(0, 46));
ok('and contains the MIT grant verbatim', flat.includes(MIT_BODY));
const endsClean = /OTHER DEALINGS IN THE SOFTWARE\.$/.test(flat);
ok('and ends on the MIT warranty clause, with nothing appended', endsClean,
  endsClean ? '' : 'text after it makes GitHub report the licence as NOASSERTION; put it in NOTICE');
ok('and the bundled-component notice exists, so nothing was lost in moving it',
  existsSync(join(root, 'NOTICE')) && /three\.js/.test(readFileSync(join(root, 'NOTICE'), 'utf8')));

/* ------------------------------------------------ the size of the thing */

// PROVENANCE and COMPARISON both state how large this codebase is, and they
// disagreed with each other and with the tree: 23,138 against 23,115 against an
// actual 23,147. For a document whose purpose is to be handed to someone
// assessing the work formally, a figure that is merely close is worse than no
// figure, because it invites the question of what else is approximate.
//
// Counted the obvious way — every .js line under src/ — and the method is
// stated here so the number can be reproduced rather than trusted:
//
//   find src -name '*.js' | wc -l        # modules
//   cat $(find src -name '*.js') | wc -l # lines
function countTree(dir, exts) {
  let files = 0, lines = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.some(e => entry.name.endsWith(e))) {
        files++;
        lines += readFileSync(full, 'utf8').split('\n').length - 1;
      }
    }
  };
  walk(join(root, dir));
  return { files, lines };
}

const src = countTree('src', ['.js']);
const tooling = {
  files: countTree('tools', ['.js', '.mjs', '.cjs']).files + countTree('desktop', ['.js', '.mjs', '.cjs']).files,
  lines: countTree('tools', ['.js', '.mjs', '.cjs']).lines + countTree('desktop', ['.js', '.mjs', '.cjs']).lines,
};
const group = (n) => n.toLocaleString('en-US');
console.log(`     src: ${group(src.lines)} lines across ${src.files} modules`
  + ` · tooling: ${group(tooling.lines)} lines across ${tooling.files} files`);

// "modules" means src/, "files" means the tooling. Two different trees, so the
// noun is what tells them apart, and each document has to use the right one.
const sizeWrong = [];
const SIZE_CLAIM = /([\d,]{4,8}) lines across (\d+) (modules|files)/g;
for (const doc of ['PROVENANCE.md', 'COMPARISON.md', 'ARCHITECTURE.md', 'README.md']) {
  const path = join(root, doc);
  if (!existsSync(path)) continue;
  for (const m of readFileSync(path, 'utf8').matchAll(SIZE_CLAIM)) {
    const lines = Number(m[1].replace(/,/g, ''));
    const count = Number(m[2]);
    const want = m[3] === 'modules' ? src : tooling;
    if (lines !== want.lines || count !== want.files) {
      sizeWrong.push(`${doc}: "${m[0]}" but the tree is ${group(want.lines)} lines across ${want.files} ${m[3]}`);
    }
  }
}
ok('every documented source size matches the tree', sizeWrong.length === 0, sizeWrong.join(' | '));

// A commit count in a document can never be right, because the commit that
// corrects it changes it. PROVENANCE said 44 against an actual 51. Rather than
// check an uncheckable number, the document is required not to state one and
// to give the command instead — which is both always accurate and more use to
// someone verifying the record than a figure they would have to trust.
const provenance = existsSync(join(root, 'PROVENANCE.md'))
  ? readFileSync(join(root, 'PROVENANCE.md'), 'utf8') : '';
const pinsCommitCount = /\|\s*\*\*Commits\*\*\s*\|\s*\d+\s*\|/.test(provenance);
ok('PROVENANCE does not pin a commit count that goes stale on the next commit',
  !pinsCommitCount,
  pinsCommitCount
    ? 'it quotes a number; name the command that counts them instead'
    : 'it names the command instead');

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
