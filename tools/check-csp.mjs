/**
 * Keep the Content-Security-Policy in index.html honest.
 *
 * The policy pins the inline import map by a sha256 hash of its contents. A
 * hash is exactly as useful as it is current: edit the map and forget the
 * hash, and the browser refuses the map, module resolution fails and the
 * application does not start. That is a whole-app outage caused by a one-line
 * edit somewhere else, which is precisely the kind of failure a person should
 * not be asked to remember to prevent.
 *
 * So it is computed rather than remembered.
 *
 *   node tools/check-csp.mjs          verify, exit non-zero if stale
 *   node tools/check-csp.mjs --write  recompute and update index.html
 *
 * The digest is taken over the element's text content exactly as the browser
 * sees it, which includes the newline after the opening tag and the one before
 * the closing tag. Getting that wrong produces a hash that looks plausible and
 * fails at runtime, so the content is captured with those newlines included.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const path = new URL('../index.html', import.meta.url);
const html = readFileSync(path, 'utf8');
const write = process.argv.includes('--write');

const IMPORTMAP = /<script type="importmap">([\s\S]*?)<\/script>/;
const found = IMPORTMAP.exec(html);
if (!found) {
  console.error('check-csp: no import map in index.html. If it was removed on purpose, remove its hash from the policy too.');
  process.exit(1);
}

const digest = createHash('sha256').update(found[1], 'utf8').digest('base64');
const want = `'sha256-${digest}'`;

const POLICY = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/;
const policy = POLICY.exec(html);
if (!policy) {
  console.error('check-csp: index.html has no Content-Security-Policy meta tag.');
  process.exit(1);
}

const current = /'sha256-[A-Za-z0-9+/=]+'/.exec(policy[2]);
if (current && current[0] === want) {
  console.log(`check-csp: ok, import map hash matches (${want}).`);
  process.exit(0);
}

if (!write) {
  console.error('check-csp: STALE. The import map does not match the hash in the policy,');
  console.error('           so the browser will refuse it and the application will not start.');
  console.error(`  in policy: ${current ? current[0] : '(no hash present)'}`);
  console.error(`  should be: ${want}`);
  console.error('  fix with: node tools/check-csp.mjs --write');
  process.exit(1);
}

const updated = html.replace(POLICY, (_, a, body, c) => {
  const next = current
    ? body.replace(/'sha256-[A-Za-z0-9+/=]+'/, want)
    : body.replace(/script-src ([^;]*)/, `script-src $1 ${want}`);
  return a + next + c;
});
writeFileSync(path, updated);
console.log(`check-csp: updated the import map hash to ${want}.`);
