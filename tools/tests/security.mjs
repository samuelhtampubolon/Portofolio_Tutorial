/**
 * Security regressions.
 *
 * Every check here is a live attack, not an assertion about intent. The point
 * is that a later change which reopens one of these holes fails the build
 * instead of shipping, because an audit is a snapshot and a test is a ratchet.
 *
 * The threat model is specific. This application has no server and no
 * accounts, so there is nothing to authenticate and no session to steal. What
 * it does do is open files that other people wrote: a `.tcad` document, an
 * STL, a DXF, a design-intent JSON, a pasted spec. Those are the untrusted
 * inputs, and a hostile one should be refused or clamped, never allowed to
 * execute, exhaust the tab, or corrupt the objects the rest of the program
 * relies on.
 */
import 'three';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.structuredClone ??= (o) => JSON.parse(JSON.stringify(o));

const { migrate, newDocument, makeFeature, sanitiseParams, CATALOG, SEGMENT_PRODUCT_CEILING } =
  await import('../../src/core/doc.js');
const { tryEval, buildScope } = await import('../../src/core/expr.js');
const { rebuild, invalidateCache, massProperties } = await import('../../src/core/rebuild.js');
const { fromDXF } = await import('../../src/draft/dxf.js');
const { buildSheet, sheetToSVG } = await import('../../src/intel/drawing.js');
const { buildPrimitive } = await import('../../src/core/geometry.js');
const Spec = await import('../../src/intel/spec.js');
const Dev = await import('../../src/intel/deviation.js');
const { safeName } = await import('../../src/io/io.js');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
};

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const sources = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (!/node_modules|\.git|vendor/.test(full)) walk(full); }
    else if (/\.m?js$/.test(name)) sources.push(full);
  }
};
walk(join(root, 'src'));
walk(join(root, 'tools'));

/** Source with comments removed, so a mention in prose is not a finding. */
const codeOf = (file) => readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ============================================ 1. no dynamic code execution */

const dynamic = sources.filter(f => /\beval\s*\(|\bnew\s+Function\s*\(|(^|[^.\w])Function\s*\(/.test(codeOf(f)));
ok('no file in the project executes a string as code',
  dynamic.length === 0, dynamic.map(f => relative(root, f)).join(', '));

const stringTimers = sources.filter(f => /set(Timeout|Interval)\s*\(\s*['"`]/.test(codeOf(f)));
ok('no timer is given a string body, which is eval by another name',
  stringTimers.length === 0, stringTimers.map(f => relative(root, f)).join(', '));

/* ================================================ 2. prototype pollution */

const unpolluted = () => ({}).polluted === undefined && ({}).pwned === undefined &&
  Object.prototype.polluted === undefined && Object.keys({}).length === 0;

const pollute = (label, doc) => {
  try { migrate(doc); } catch { /* refusing the document outright is also a pass */ }
  ok(label, unpolluted());
};

const withParams = (json) => {
  const d = JSON.parse(JSON.stringify(newDocument('x')));
  d.features = [{
    id: 'a', type: 'box', name: 'n', inputs: [], params: JSON.parse(json),
    transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
  }];
  return d;
};
pollute('a __proto__ key in feature params does not reach Object.prototype',
  withParams('{"__proto__":{"polluted":1},"w":10}'));
pollute('nor a constructor.prototype route',
  JSON.parse('{"schema":3,"meta":{"name":"x"},"features":[],"params":[],"constructor":{"prototype":{"pwned":1}}}'));
pollute('nor a __proto__ on the document itself',
  JSON.parse('{"schema":3,"meta":{"name":"x"},"features":[],"params":[],"__proto__":{"polluted":1}}'));
pollute('nor one inside a transform',
  JSON.parse('{"schema":3,"meta":{"name":"x"},"params":[],"features":[{"id":"a","type":"box","name":"n","inputs":[],"params":{},"transform":{"__proto__":{"polluted":1},"pos":[0,0,0]}}]}'));

const { scope } = buildScope([{ id: 'p', name: '__proto__', value: 1 }, { id: 'q', name: 'width', value: 60 }]);
ok('the expression scope has a null prototype, so a name cannot collide with it',
  Object.getPrototypeOf(scope) === null);
ok('a parameter called __proto__ therefore pollutes nothing', unpolluted());
ok('while ordinary parameters still resolve', scope.width === 60);

for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
  const r = tryEval(name, buildScope([]).scope);
  ok(`an expression cannot read Object.prototype.${name}`, r.ok === false, r.error);
}

/* ==================================== 3. resource exhaustion on opening */

const attack = (label, type, params, { maxMs = 4000, maxTris = 600000 } = {}) => {
  const d = newDocument('hostile');
  d.params = [];
  const f = makeFeature(type, { name: 'x' });
  f.params = { ...f.params, ...params };
  d.features = [f];
  const m = migrate(d);
  invalidateCache();
  const started = Date.now();
  let tris = 0, threw = null;
  try { tris = rebuild(m).stats.tris; } catch (e) { threw = e.message; }
  const ms = Date.now() - started;
  ok(label, !threw && ms < maxMs && tris <= maxTris,
    threw ? `threw: ${threw}` : `${tris} triangles in ${ms} ms`);
};

attack('a segment count of a billion is clamped, not attempted', 'cylinder', { seg: 1e9 });
attack('a negative segment count cannot invert a loop', 'cylinder', { seg: -5 });
attack('a non-finite segment count falls back to the catalogue default', 'cylinder', { seg: NaN });
attack('a torus cannot be asked for ten billion quads', 'torus', { seg: 1e5, tseg: 1e5 });
attack('a helix of a million turns is clamped', 'helix', { turns: 1e6, steps: 1e7, seg: 1e4 });
attack('a prism cannot have a hundred million sides', 'prism', { sides: 1e8 });
attack('an absurd radius does not produce absurd geometry', 'cylinder', { r: 1e308 });

ok('every clamped value lands inside the range the catalogue declares', (() => {
  for (const [type, cat] of Object.entries(CATALOG)) {
    const hostile = {};
    for (const f of cat.fields || []) if (f.kind === 'int' || f.kind === 'num') hostile[f.key] = 1e12;
    const out = sanitiseParams(type, { ...cat.params, ...hostile });
    for (const f of cat.fields || []) {
      if (typeof out[f.key] !== 'number') continue;
      if (f.max != null && out[f.key] > f.max) return false;
      if (f.min != null && out[f.key] < f.min) return false;
    }
  }
  return true;
})());

const helixClamped = sanitiseParams('helix', { R: 25, r: 4, pitch: 14, turns: 1e6, seg: 1e6, steps: 1e6 });
ok('and the product of the segment counts is held under its ceiling',
  helixClamped.seg * helixClamped.steps * helixClamped.turns <= SEGMENT_PRODUCT_CEILING * 1.001,
  JSON.stringify(helixClamped));
ok('a select field cannot be set to something outside its options',
  sanitiseParams('boolean', { op: 'rm -rf /' }).op === 'union',
  String(sanitiseParams('boolean', { op: 'rm -rf /' }).op));
ok('expressions are left alone, since a string cannot be range-checked',
  sanitiseParams('cylinder', { r: 'width * 2', seg: 48 }).r === 'width * 2');

let started = Date.now();
const deep = tryEval('('.repeat(20000) + '1' + ')'.repeat(20000), {});
ok('a deeply nested expression is refused rather than crashing the tab',
  !deep.ok && Date.now() - started < 2000, `${Date.now() - started} ms`);
ok('and its message is written for a person, not copied from the engine',
  /nested too deeply/.test(deep.error) && !/call stack/i.test(deep.error), deep.error);

started = Date.now();
ok('a huge exponent cannot hang or yield a non-finite dimension',
  tryEval('9^9^9', {}).ok === false && Date.now() - started < 500);

started = Date.now();
const long = tryEval('1' + '+1'.repeat(200000), {});
ok('a two-hundred-thousand term expression still finishes quickly',
  long.ok && Date.now() - started < 4000, `${Date.now() - started} ms`);

/* ========================================= 4. injection through documents */

/**
 * Markup that would actually run something, as opposed to text that merely
 * mentions it.
 *
 * The distinction matters and is easy to get wrong: an escaped payload sitting
 * inside a text node still contains the characters "onerror=", so a naive
 * search for that substring reports a hole where the escaping worked. What is
 * dangerous is a tag being opened, or an event attribute appearing inside a
 * tag, so that is what these look for.
 */
const INJECTED_ELEMENT = /<\s*(script|img|iframe|object|embed|foreignObject|animate|set)\b/i;
const EVENT_ATTRIBUTE = /<[^>]*\s(on\w+)\s*=/i;
const dangerous = (markup) => INJECTED_ELEMENT.exec(markup) || EVENT_ATTRIBUTE.exec(markup);
const isInert = (markup) => !dangerous(markup);

// Prove the detector is not vacuous: it must flag real injections.
ok('the injection detector catches an unescaped element',
  !isInert('<svg><text>x</text><script>alert(1)</script></svg>'));
ok('and an unescaped event attribute',
  !isInert('<svg><image href="x" onerror="alert(1)"/></svg>'));
ok('while passing markup where the payload is escaped text',
  isInert('<svg><text>&lt;img src=x onerror=alert(1)&gt;</text></svg>'));

const NUL = String.fromCharCode(0);
const PAYLOADS = [
  '</text><script>window.x=1</' + 'script><text>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE features; --",
  '${alert(1)}',
  `${NUL}<svg onload=alert(1)>`,
];

for (const payload of PAYLOADS) {
  const geo = buildPrimitive('box', { w: 40, d: 30, h: 10 });
  const mp = massProperties(geo);
  const feat = makeFeature('box', { name: payload });
  feat.material = payload;
  const doc = newDocument(payload);
  doc.meta.author = payload;
  doc.features = [feat];
  doc.params = [];
  doc.configs = { active: 'c', list: [{ id: 'c', name: payload, overrides: {} }] };
  const bodies = [{ geometry: geo, matrix: null, box: mp.box, size: mp.size, feature: feat }];
  const build = {
    scope: {},
    results: new Map([[feat.id, { error: null, instances: [{}] }]]),
    topLevel: [feat],
    stats: { volume: mp.volume, area: mp.area, mass: 0.1, tris: 12, box: mp.box, centroid: mp.centroid },
  };
  const svg = sheetToSVG(buildSheet(bodies, { doc, build, sheet: 'a3l', hlr: false }));
  ok(`a document named ${JSON.stringify(payload.slice(0, 20))} cannot inject into the drawing`,
    isInert(svg), (dangerous(svg) || []).slice(0, 1).join(''));
}

const hostileSpec = `part "x"\nparam __proto__ = 1\nfeature box "<img src=x onerror=alert(1)>"\n  w = 10\n  d = 10\n  h = 10\n`;
const parsedSpec = Spec.fromSpec(hostileSpec);
ok('a spec cannot declare a parameter named __proto__',
  !parsedSpec.doc && parsedSpec.errors.some(e => /reserved/.test(e.message)),
  JSON.stringify(parsedSpec.errors.map(e => e.message)).slice(0, 90));
ok('and parsing a hostile spec pollutes nothing', unpolluted());

const nameOnly = Spec.fromSpec(`part "x"\nfeature box "<script>x</script>"\n  w = 10\n  d = 10\n  h = 10\n`);
ok('a feature name is stored as text, never interpreted',
  nameOnly.doc && nameOnly.doc.features[0].name === '<script>x</script>',
  nameOnly.doc?.features[0].name);
ok('and it round trips as text rather than becoming markup',
  Spec.toSpec(nameOnly.doc).text.includes('"<script>x</script>"'));

const imported = Dev.importIntent({
  format: 'tessercad.design-intent',
  document: { name: '<img src=x onerror=alert(1)>', units: 'mm' },
  parameters: [{ name: '__proto__', expression: 1 }],
  features: [{ name: 'a', type: 'box', parameters: { w: 1e12, seg: 1e12 }, consumes: [] }],
});
ok('an intent file cannot pollute through a parameter name', unpolluted());
ok('and its numbers are finite once the document is migrated', (() => {
  if (!imported.doc) return true;
  return migrate(imported.doc).features
    .every(f => Object.values(f.params).every(v => typeof v !== 'number' || Number.isFinite(v)));
})());

/* =============================================== 5. malformed file imports */

const dxfCases = {
  'an empty file': '',
  'a file that is not DXF at all': 'hello world',
  'a truncated entity': '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n',
  'NaN and Infinity coordinates': '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nNaN\n20\nInfinity\n11\nabc\n21\n5\n0\nENDSEC\n0\nEOF',
  'coordinates at the float limit': '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n1e308\n20\n1e308\n11\n-1e308\n21\n0\n0\nENDSEC\n0\nEOF',
  'a layer named __proto__': '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n__proto__\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDSEC\n0\nEOF',
};
for (const [label, src] of Object.entries(dxfCases)) {
  let out = null, threw = null;
  const t = Date.now();
  try { out = fromDXF(src); } catch (e) { threw = e.message; }
  const finite = !out || (out.entities || []).every(e => !/NaN|Infinity/.test(JSON.stringify(e)));
  ok(`the DXF importer survives ${label}`,
    !threw && finite && Date.now() - t < 2000,
    threw ? `threw: ${threw}` : `${out?.entities?.length ?? 0} entities, all finite: ${finite}`);
}
ok('importing DXF pollutes nothing', unpolluted());

/* ================================================ 6. export file naming */

ok('a filename cannot escape its directory',
  !safeName('../../etc/passwd', '.stl').includes('/') && !safeName('..\\..\\win.ini', '.stl').includes('\\'),
  `${safeName('../../etc/passwd', '.stl')} | ${safeName('..\\..\\win.ini', '.stl')}`);
ok('a filename is never empty', safeName('', '.stl').length > 4 && safeName('   ', '.stl').length > 4,
  JSON.stringify(safeName('', '.stl')));
ok('quotes, angle brackets, newlines and NUL are stripped',
  !new RegExp(`["'<>\\n${NUL}]`).test(safeName(`a"b<c>${NUL}d\ne`, '.stl')),
  safeName(`a"b<c>${NUL}d\ne`, '.stl'));
ok('the extension appears exactly once',
  safeName('part.stl', '.stl') === 'part.stl' && safeName('part', '.stl') === 'part.stl');

/* ========================================= 7. the policy in index.html */

const html = readFileSync(join(root, 'index.html'), 'utf8');
const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
ok('index.html carries a Content-Security-Policy', !!csp);
ok('it denies everything by default', /default-src 'none'/.test(csp), csp.slice(0, 36));
ok('no origin other than this one may serve a script',
  /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/.test(csp) && !/script-src[^;]*(https?:|\*)/.test(csp),
  (/script-src[^;]*/.exec(csp) || [''])[0]);
ok('script-src allows neither unsafe-inline nor unsafe-eval',
  !/script-src[^;]*unsafe-(inline|eval)/.test(csp));
ok('no network origin is reachable at all',
  !/connect-src[^;]*(https?:|\*)/.test(csp), (/connect-src[^;]*/.exec(csp) || [''])[0]);
ok('objects and form submissions are denied outright',
  /object-src 'none'/.test(csp) && /form-action 'none'/.test(csp));
ok('the document cannot be re-based to another origin', /base-uri 'none'/.test(csp));

const inlineScripts = (html.match(/<script(?![^>]*\bsrc=)/g) || []).length;
ok('exactly one inline script remains, the import map', inlineScripts === 1, String(inlineScripts));

const mapBody = (/<script type="importmap">([\s\S]*?)<\/script>/.exec(html) || [])[1] || '';
ok('and the policy pins it by a hash that matches what the browser reads',
  csp.includes(`'sha256-${createHash('sha256').update(mapBody, 'utf8').digest('base64')}'`));

/* ============================================= 8. no outbound network code */

const netCalls = [];
for (const f of sources) {
  if (/tools\/tests\//.test(f)) continue;
  for (const m of codeOf(f).matchAll(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/g)) {
    netCalls.push(`${relative(root, f)}: ${m[1]}`);
  }
}
// Only runtime code counts: tools/ contains the service-worker generator,
// whose output legitimately mentions fetch, and it never ships to a browser.
// The one runtime use is the PNG export reading its own canvas snapshot, which
// is a data: URL. Anything else here needs a reason, and the policy would
// block it regardless.
const runtimeNetCalls = netCalls.filter(c => !c.startsWith('tools/'));
ok('the only network API in runtime code is the one same-origin data: read',
  runtimeNetCalls.every(c => c === 'src/io/io.js: fetch'), runtimeNetCalls.join(', ') || 'none');
ok('and the generated service worker only ever fetches same-origin requests',
  /url\.origin !== self\.location\.origin/.test(readFileSync(join(root, 'sw.js'), 'utf8')));

const thirdParty = sources.filter((f) => {
  if (/tools\/tests\//.test(f)) return false;
  return /https?:\/\/(?!github\.com\/samuelhtampubolon|localhost|127\.0\.0\.1|www\.w3\.org)/
    .test(codeOf(f));
});
ok('no source file references a third-party origin',
  thirdParty.length === 0, thirdParty.map(f => relative(root, f)).join(', '));

console.log(fails ? `\n${fails} FAILURES` : '\nALL SECURITY CHECKS PASS');
process.exit(fails ? 1 : 0);
