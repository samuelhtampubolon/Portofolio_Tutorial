/**
 * The desktop shell's security-critical parts.
 *
 * Two things are checked here, and they are the two that could turn a local
 * CAD application into a way of reading somebody's disk.
 *
 * The protocol handler's path containment, attacked directly with the
 * encodings that defeat naive checks. This is the only code in the desktop
 * build that takes an untrusted string and turns it into a filesystem read, so
 * it is the only code in the desktop build that has to be tested rather than
 * reviewed. It is a plain function of a Request returning a Response, which is
 * why it can be driven here with no Electron present: what these checks
 * exercise is the same function the shell installs, not a stand-in.
 *
 * The shell's Electron configuration, read out of main.cjs as text. That may
 * look like testing a comment, and it is not: `nodeIntegration: true` in a
 * shell is the difference between a script injection and arbitrary code
 * execution on the user's machine, and it is a one-word edit away at all
 * times. Asserting the posture means a future change that relaxes it fails
 * here instead of shipping in a binary.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveSafely, createHandler, TYPES, ORIGIN, HOST } =
  require('../../desktop/protocol.cjs');

// `fileURLToPath`, not `.pathname`. On Windows a file URL's pathname is
// `/D:/a/repo/...` — a leading slash before the drive letter — which is not a
// path any filesystem call accepts. Every read against it fails, which is how
// four suites came to fail on the Windows runner while passing everywhere else.
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
};

/* ======================================== 1. path containment, attacked */

// A sandbox with a secret just outside it, so a traversal that succeeds is
// demonstrably a read of something it should not reach.
const sandbox = mkdtempSync(join(tmpdir(), 'tc-desktop-'));
mkdirSync(join(sandbox, 'app'));
writeFileSync(join(sandbox, 'app', 'index.html'), '<!doctype html>ok');
writeFileSync(join(sandbox, 'app', 'app.js'), 'export default 1;');
writeFileSync(join(sandbox, 'secret.txt'), 'PRIVATE');
const appRoot = join(sandbox, 'app');

ok('the application itself is served', !!resolveSafely(appRoot, '/index.html'));
ok('and the root path maps to index.html',
  resolveSafely(appRoot, '/') === join(appRoot, 'index.html'));
ok('an empty path maps there too', resolveSafely(appRoot, '') === join(appRoot, 'index.html'));
ok('a module inside the tree is served', !!resolveSafely(appRoot, '/app.js'));

const TRAVERSALS = [
  '/../secret.txt',
  '/../../secret.txt',
  '/..%2Fsecret.txt',
  '/%2e%2e%2fsecret.txt',
  '/%2E%2E%2Fsecret.txt',
  '/%252e%252e%252fsecret.txt',
  '/....//secret.txt',
  '/app/../../secret.txt',
  '//../secret.txt',
  '/./../secret.txt',
  '/..\\secret.txt',
  '/%5c..%5csecret.txt',
  `${sep}..${sep}secret.txt`,
  '/subdir/../../secret.txt',
];
for (const attempt of TRAVERSALS) {
  const got = resolveSafely(appRoot, attempt);
  ok(`refuses the traversal ${JSON.stringify(attempt)}`, got === null, got || '');
}

ok('an absolute path outside the tree is refused',
  resolveSafely(appRoot, '/etc/passwd') === null);
ok('a Windows absolute path is refused',
  resolveSafely(appRoot, '/C:/Windows/win.ini') === null);
ok('a NUL byte is refused rather than truncating the path',
  resolveSafely(appRoot, '/index.html\0.png') === null);
ok('a malformed percent escape is refused rather than throwing',
  resolveSafely(appRoot, '/%zz') === null);
ok('a directory is never served as a file', resolveSafely(appRoot, '/') !== null &&
  resolveSafely(sandbox, '/app') === null);
ok('a file that does not exist is refused', resolveSafely(appRoot, '/nope.html') === null);

/* --- the extension allowlist is a second, independent barrier --- */
writeFileSync(join(appRoot, 'keys.pem'), 'SECRET KEY');
writeFileSync(join(appRoot, 'notes.cjs'), 'module.exports = 1;');
writeFileSync(join(appRoot, '.env'), 'TOKEN=abc');
ok('a file inside the tree with an unlisted extension is still refused',
  resolveSafely(appRoot, '/keys.pem') === null);
ok('so is a CommonJS file, which is the shell and not the application',
  resolveSafely(appRoot, '/notes.cjs') === null);
ok('and a dotfile', resolveSafely(appRoot, '/.env') === null);
ok('the allowlist covers what the application actually ships',
  ['.html', '.js', '.css', '.json', '.svg', '.png'].every(e => TYPES.has(e)));
ok('and nothing executable or credential-shaped',
  !['.exe', '.cjs', '.sh', '.bat', '.pem', '.key', '.env'].some(e => TYPES.has(e)));

/* --- and through the real handler, end to end --- */

const handle = createHandler(appRoot);
const ask = (p, method = 'GET') => handle(new Request(`${ORIGIN}${p}`, { method }));

let res = await ask('/index.html');
let body = await res.text();
ok('a real request for the app succeeds', res.status === 200 && body.includes('ok'),
  String(res.status));
ok('and carries the headers a meta tag cannot deliver',
  res.headers.get('x-frame-options') === 'DENY' &&
  res.headers.get('x-content-type-options') === 'nosniff' &&
  res.headers.get('referrer-policy') === 'no-referrer',
  `${res.headers.get('x-frame-options')} / ${res.headers.get('x-content-type-options')}`);
ok('with the correct content type, so nosniff is meaningful',
  res.headers.get('content-type').startsWith('text/html'));

res = await ask('/../secret.txt');
body = await res.text();
ok('a traversal through the handler returns 404 and no content',
  res.status === 404 && !body.includes('PRIVATE'), String(res.status));
res = await ask('/%2e%2e%2fsecret.txt');
body = await res.text();
ok('and so does an encoded one', res.status === 404 && !body.includes('PRIVATE'));

res = await ask('/index.html', 'POST');
ok('the handler accepts no method but GET and HEAD', res.status === 405, String(res.status));
res = await ask('/index.html', 'HEAD');
ok('HEAD returns headers with no body',
  res.status === 200 && (await res.text()) === '');

// The scheme is standard, so a URL carries a host. Another host on the same
// scheme is not this application and must not reach its files.
res = await handle(new Request(`app://elsewhere/index.html`));
ok('a request for another host on the scheme is refused', res.status === 404,
  String(res.status));
ok('and the application is served from its own origin only',
  ORIGIN === `app://${HOST}`, ORIGIN);

// The reason the scheme exists at all: no socket is opened, so nothing else on
// the machine can reach the user's files while the window is open.
// Read with comments removed, for the reason stripComments explains: both
// files describe the loopback server they replaced, in prose that names the
// very things these two checks rule out. `stripComments` is a hoisted
// declaration, so calling it above its definition is fine.
const desktopCode = stripComments(readFileSync(join(root, 'desktop/main.cjs'), 'utf8')) +
  stripComments(readFileSync(join(root, 'desktop/protocol.cjs'), 'utf8'));
ok('the desktop build opens no listening socket at all',
  !/createServer|\.listen\(|require\(['"]node:(http|net)['"]\)/.test(desktopCode));
ok('and does not fall back to a loopback origin',
  !/127\.0\.0\.1|localhost/.test(desktopCode));

/**
 * The shell with its comments removed.
 *
 * These assertions are about what the code does, and the header explains the
 * posture in prose that mentions the very things being ruled out: it says the
 * shell does not use file://, which made a naive search for "file://" report
 * that it does.
 *
 * Only line-initial comments are removed. A general comment stripper written
 * as a regex is wrong on JavaScript, and wrong in a way that bit this file:
 * `/^https:\/\//` contains a `//` inside a regex literal, so a pattern that
 * treats any `//` as a comment deletes the rest of that line, which is the
 * openExternal call these checks are looking for. The prose here is all in
 * block comments that begin a line, so removing only those is both sufficient
 * and safe.
 */
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
    const trimmed = line.trimStart();
    if (inBlock) { if (trimmed.includes('*/')) inBlock = false; continue; }
    if (trimmed.startsWith('/*')) { if (!trimmed.includes('*/')) inBlock = true; continue; }
    if (trimmed.startsWith('//')) continue;
    out.push(line);
  }
  return out.join('\n');
}

/* ============================== 2. the Electron posture, asserted as code */

const shell = stripComments(readFileSync(join(root, 'desktop/main.cjs'), 'utf8'));
const setting = (key) => new RegExp(`${key}\\s*:\\s*(true|false)`).exec(shell)?.[1];

ok('the renderer runs sandboxed', setting('sandbox') === 'true');
ok('context isolation is on, so page scripts cannot reach Electron',
  setting('contextIsolation') === 'true');
ok('node integration is off, so an injection stays an injection',
  setting('nodeIntegration') === 'false');
ok('and off in workers too', setting('nodeIntegrationInWorker') === 'false');
ok('web security is on, so the same-origin policy applies',
  setting('webSecurity') === 'true');
ok('insecure content is not allowed', setting('allowRunningInsecureContent') === 'false');
ok('the webview tag is disabled', setting('webviewTag') === 'false');
ok('dropping a file cannot navigate the window', setting('navigateOnDragDrop') === 'false');

ok('there is no preload script, so there is no bridge to audit',
  !/preload\s*:/.test(shell));
ok('navigation away from the application is refused',
  /will-navigate/.test(shell) && /event\.preventDefault\(\)/.test(shell));
ok('window.open is denied and handed to the real browser',
  /setWindowOpenHandler/.test(shell) && /action: 'deny'/.test(shell) && /openExternal/.test(shell));
// Checked as a substring rather than a regex matching a regex, which is
// unreadable and was wrong on the first attempt.
const externalCalls = shell.split('openExternal').length - 1;
const httpsGuards = shell.split('/^https:\\/\\//').length - 1;
ok('every openExternal call is guarded by an https-only test',
  externalCalls > 0 && httpsGuards === externalCalls,
  `${externalCalls} calls, ${httpsGuards} guards`);
ok('attaching a webview is refused', /will-attach-webview/.test(shell));
ok('every permission request is denied',
  /setPermissionRequestHandler/.test(shell) && /callback\(false\)/.test(shell) &&
  /setPermissionCheckHandler\(\(\) => false\)/.test(shell));
ok('the shell loads over its own scheme, not file:// and not a loopback port',
  /ORIGIN/.test(shell) && !/loadFile|file:\/\//.test(shell) && !/127\.0\.0\.1/.test(shell));
ok('and the scheme is registered standard and secure, so the page is a real origin',
  /registerSchemesAsPrivileged/.test(shell) &&
  /standard:\s*true/.test(shell) && /secure:\s*true/.test(shell));
ok('only one instance may run, so two windows cannot fight over local storage',
  /requestSingleInstanceLock/.test(shell));
ok('the developer tools stay available, so anyone can verify the network claim',
  /toggleDevTools/.test(shell));

/**
 * The network claim, as a property of the process rather than of the page.
 *
 * The Content-Security-Policy governs what the page may request. It says
 * nothing about the browser around the page, and Chromium ships background
 * services — a component updater, a variations client, a reliability reporter
 * — that talk to Google infrastructure on their own schedule. A packaged build
 * was watched with a network monitor and did exactly that: it reached for
 * redirector.gvt1.com having loaded nothing but local files.
 *
 * Switching those services off individually is asking. Resolving every
 * hostname to nothing is preventing, and it is what makes "your documents stay
 * on your machine" true of the program and not only of the page.
 */
ok('every hostname resolves to nothing, so the process cannot reach the network',
  /host-resolver-rules[\s\S]{0,60}MAP \* ~NOTFOUND/.test(shell));
ok('and Chromium’s own background services are switched off as well',
  /disable-component-update/.test(shell) && /disable-domain-reliability/.test(shell) &&
  /no-pings/.test(shell));
ok('while external links still leave through the real browser, which resolves its own',
  /openExternal/.test(shell));

/* --- and the packaging does not undo any of it --- */
const builder = readFileSync(join(root, 'desktop/electron-builder.yml'), 'utf8');
ok('the Windows build ships a zip, which extracts nothing and runs nothing',
  /target: zip/.test(builder));
ok('and no self-extracting portable target, which is what tripped the warnings',
  !/target: portable/.test(builder));
ok('compression is not maximum, which would make the result look packed',
  /compression: normal/.test(builder));
// The version resource is written by `signAndEditExecutable`, and its company
// name comes from `author` in the manifest. `publisherName` used to be
// asserted here too and must not come back: electron-builder 26 removed it
// from the win schema and rejects the entire configuration if it is present,
// which broke the build with an error naming neither the key nor the reason.
const desktopManifest = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8'));
ok('resource editing is on, so the binary carries real version metadata',
  /signAndEditExecutable: true/.test(builder));
ok('and the manifest supplies the company name that resource needs',
  !!(desktopManifest.author && desktopManifest.author.name),
  JSON.stringify(desktopManifest.author));
// Matched as a YAML key at the start of a line, not as a word anywhere in the
// file: the comment above the setting explains why publisherName was removed,
// and a search for the bare word finds that explanation and fails on it. The
// same mistake, in the same shape, has now been made three times in this
// repository — a check that reads its own documentation as evidence.
ok('publisherName is absent, because electron-builder 26 refuses the whole config for it',
  !/^\s*publisherName\s*:/m.test(builder));
ok('and the installer is per-user, so it never asks for administrator rights',
  /perMachine: false/.test(builder));
ok('the shipped file list is explicit rather than a bundler’s output',
  /index\.html/.test(builder) && /vendor\/\*\*\/\*/.test(builder));
ok('no source map is shipped', /'!\*\*\/\*\.map'/.test(builder));

const workflow = readFileSync(join(root, '.github/workflows/desktop.yml'), 'utf8');
ok('the binary is built by CI from a readable commit, not committed as a blob',
  /runs-on: \$\{\{ matrix\.os \}\}/.test(workflow) && /windows-latest/.test(workflow));
ok('the test suite runs before anything is packaged', /npm test/.test(workflow));
ok('the packaging configuration is validated before the long build',
  /--dir --publish never/.test(workflow));
ok('and a pull request touching desktop/ builds it, so a broken config cannot reach a tag',
  /pull_request:[\s\S]{0,200}desktop\/\*\*/.test(workflow));
ok('and the shell is launched and driven before the build is published',
  /verify-desktop\.cjs/.test(workflow));
ok('and a SHA-256 is published beside every artefact', /sha256sum/.test(workflow));
ok('every artefact carries a signed build-provenance attestation, which a hash cannot give',
  /attest-build-provenance/.test(workflow));
ok('and the workflow takes only the two extra scopes that needs',
  /id-token: write/.test(workflow) && /attestations: write/.test(workflow));
ok('the zip is published alongside the installer, so the safer download exists',
  /dist-desktop\/\*\.zip/.test(workflow));

/*
 * The application icon, which the build shipped without for four releases.
 *
 * electron-builder looks for desktop/build/icon.png and, finding none, uses
 * Electron's default and says so in a line nobody read. Every published binary
 * carried a generic icon in the taskbar and the Start menu.
 *
 * Checked here rather than left to that warning, because the failure is silent
 * and cosmetic, which is exactly the kind that survives four releases. The
 * dimensions are read out of the PNG header: electron-builder derives every
 * size it needs, the Windows .ico included, from one square image of at least
 * 256x256, and quietly produces a blurred icon from anything smaller.
 *
 * Regenerate it from assets/favicon.svg with `node tools/make-icon.mjs`.
 */
const iconPath = join(root, 'desktop/build/icon.png');
ok('the desktop build has an application icon, rather than Electron’s default',
  existsSync(iconPath), iconPath);
if (existsSync(iconPath)) {
  const png = readFileSync(iconPath);
  const isPng = png.subarray(1, 4).toString() === 'PNG';
  const w = isPng ? png.readUInt32BE(16) : 0;
  const h = isPng ? png.readUInt32BE(20) : 0;
  ok('and it is a square PNG large enough for every size derived from it',
    isPng && w === h && w >= 256, `${w}x${h}`);
}

/*
 * The licence travels with the binary.
 *
 * MIT requires its notice to be included in copies, and a 146 MB zip someone
 * downloaded is a copy. Whoever has only the unzipped folder has to be able to
 * read the terms from it, without being sent back to a repository they may
 * never have visited.
 *
 * This is a packaging glob, so it fails by omission and silently: a file simply
 * is not there, and the build succeeds. NOTICE was added to the repository and
 * would have been left out of every binary until someone thought to look.
 */
for (const legal of ['LICENSE', 'NOTICE', 'ATTRIBUTION.md']) {
  ok(`the packaged application carries ${legal}`,
    new RegExp(`^\\s*-\\s*${legal}\\s*$`, 'm').test(builder));
}
ok('and vendor/** carries three.js’s own licence into the package',
  /vendor\/\*\*/.test(builder) && existsSync(join(root, 'vendor/THREE-LICENSE.txt')));

const ignored = readFileSync(join(root, '.gitignore'), 'utf8');
ok('build output and the shell’s dependencies are not committed',
  /dist-desktop/.test(ignored) && /node_modules/.test(ignored), ignored.split('\n').join(' '));

console.log(fails ? `\n${fails} FAILURES` : '\nALL DESKTOP CHECKS PASS');
process.exit(fails ? 1 : 0);
