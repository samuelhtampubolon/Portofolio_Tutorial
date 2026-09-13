/**
 * The architecture, enforced.
 *
 * "Well structured" is not a property a README can confer. It is a property of
 * the import graph, and an import graph drifts the moment one convenient
 * shortcut is taken. So the layering is written down as data here and checked,
 * which means a change that inverts a dependency fails the build with the
 * offending line rather than being noticed a year later.
 *
 * The rule is the ordinary one: a layer may import from any layer below it and
 * from none above it. That single constraint is what keeps `core` testable in
 * Node with no DOM, keeps the boolean kernel loadable in a worker, and keeps
 * the composition root the only file that knows about everything.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative as nodeRelative, dirname, sep, win32 } from 'node:path';
/**
 * `path.relative` that always returns forward slashes.
 *
 * On Windows it returns `src\\core\\doc.js`, and every check below compares
 * against literals like `'core/'` or splits on `/`. Without this the layering
 * checks silently match nothing and the suite passes for the wrong reason,
 * which is worse than the outright failure the root-path bug caused. One
 * wrapper fixes every call site at once.
 */
const relative = (from, to) => nodeRelative(from, to).split(sep).join('/');

import { fileURLToPath } from 'node:url';

/**
 * Layers, lowest first. A file in one layer may import from a lower-numbered
 * layer, never from a higher-numbered or an equal-numbered sibling directory.
 *
 * The reasoning behind each placement, since a layer list with no justification
 * is just a list:
 *
 *   0 core    the document model, the expression engine, the geometry and
 *             boolean kernels. Imports nothing from this project, so it runs
 *             under Node with no browser and no DOM, which is what makes the
 *             arithmetic testable at all.
 *   1 draft   2D entities and the DXF/SVG codec. Needs the document model.
 *     view    the 3D viewport. Needs the document model. Deliberately knows
 *             nothing about drafting, so neither one can drag in the other.
 *   2 io      import and export. Needs core and the draft codec.
 *   3 intel   the engineering layer: doctor, cost, drawings, tolerance, merge,
 *             spec, fasteners, hygiene. Consumes core, draft and io; knows
 *             nothing about the interface, which is why every module in it is
 *             testable headlessly.
 *     sim     the simulator. Same level as intel and independent of it.
 *   4 ui      widgets, the command registry, the menus, the panels. May use
 *             everything below. Nothing below may use it.
 *   5 main    the composition root, and the only file that imports ui.
 */
const LAYERS = [
  ['core'],
  ['draft', 'view'],
  ['io'],
  ['intel', 'sim'],
  ['ui'],
];

const layerOf = (dir) => LAYERS.findIndex(group => group.includes(dir));

// `fileURLToPath`, not `.pathname`. On Windows a file URL's pathname is
// `/D:/a/repo/...` — a leading slash before the drive letter — which is not a
// path any filesystem call accepts. Every read against it fails, which is how
// four suites came to fail on the Windows runner while passing everywhere else.
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const srcRoot = join(root, 'src');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
};

/* ------------------------------------------------------------ collect */

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.js')) files.push(full);
  }
};
walk(srcRoot);

/** Every local import in a file, as a repository-relative path. */
const importsOf = (file) => {
  const body = readFileSync(file, 'utf8');
  const specs = [];
  for (const m of body.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of body.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs
    .filter(s => s.startsWith('.'))
    .map(s => relative(srcRoot, join(dirname(file), s)));
};

const dirOf = (relPath) => relPath.split('/')[0];
const inLayer = (relPath) => (relPath.includes('/') ? dirOf(relPath) : null);

/**
 * Does this source reach for the browser?
 *
 * Naively searching for "document." finds the word in prose and finds
 * `data.document?.units`, which is a property of a parsed JSON object and has
 * nothing to do with the DOM. Both produced false reports on the first
 * attempt. So the test is narrower and therefore actually true: a known DOM
 * member, accessed on a bare `document` or `window` that is not itself a
 * property of something else.
 */
const DOM_ACCESS = new RegExp(
  '(^|[^.\\w$])(document|window)\\s*\\.\\s*' +
  '(createElement|createElementNS|querySelector|querySelectorAll|getElementById' +
  '|body|head|documentElement|addEventListener|removeEventListener|location|cookie)\\b',
);
const touchesDOM = (source) => DOM_ACCESS.test(
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
);

ok('the DOM detector finds a real access', touchesDOM('const n = document.createElement("div");'));
ok('and is not fooled by a JSON property of the same name',
  !touchesDOM('const u = data.document?.units;'));
ok('nor by the word appearing in a sentence',
  !touchesDOM('const msg = `90% of the document. Pick its inputs.`;'));

/* -------------------------------------------- 1. no upward dependencies */

const violations = [];
for (const file of files) {
  const from = relative(srcRoot, file);
  const fromDir = inLayer(from);
  if (fromDir === null) continue;                  // main.js and boot.js: the root
  const fromLayer = layerOf(fromDir);
  if (fromLayer < 0) { violations.push(`${from}: directory "${fromDir}" is not in any declared layer`); continue; }

  for (const target of importsOf(file)) {
    const toDir = inLayer(target);
    if (toDir === null || toDir === fromDir) continue;   // same directory is fine
    const toLayer = layerOf(toDir);
    if (toLayer < 0) { violations.push(`${from} imports ${target}, whose directory is not in any layer`); continue; }
    if (toLayer >= fromLayer) {
      violations.push(`${from} (layer ${fromLayer}, ${fromDir}) imports ${target} (layer ${toLayer}, ${toDir})`);
    }
  }
}
ok('no module imports from its own layer or above', violations.length === 0,
  violations.slice(0, 6).join(' | '));

/* ------------------------------------------- 2. core depends on nothing */

const coreFiles = files.filter(f => relative(srcRoot, f).startsWith('core/'));
const coreEscapes = [];
for (const f of coreFiles) {
  for (const t of importsOf(f)) if (!t.startsWith('core/')) coreEscapes.push(`${relative(srcRoot, f)} -> ${t}`);
}
ok('core imports nothing from outside core, so it runs headlessly',
  coreEscapes.length === 0, coreEscapes.join(', '));
ok('and core is a real layer, not one file', coreFiles.length >= 6, `${coreFiles.length} files`);

/* --------------------------- 3. the boolean kernel stays worker-loadable */

const kernel = readFileSync(join(srcRoot, 'core/csg-core.js'), 'utf8');
const kernelImports = importsOf(join(srcRoot, 'core/csg-core.js'));
ok('the boolean kernel imports nothing at all', kernelImports.length === 0, kernelImports.join(', '));
ok('and has no bare specifier, which a module worker could not resolve',
  !/^\s*import\s[^;]*from\s*['"][^.]/m.test(kernel));
const worker = readFileSync(join(srcRoot, 'core/csg-worker.js'), 'utf8');
ok('the worker imports only by relative path', !/from\s*['"][^.]/.test(worker));
ok('and reaches for no DOM and no document model',
  !touchesDOM(worker) && !/from ['"]\.\/doc\.js/.test(worker));

/* ---------------------------------- 4. the engineering layer has no UI */

const intelFiles = files.filter(f => relative(srcRoot, f).startsWith('intel/'));
const domInIntel = intelFiles.filter(f => touchesDOM(readFileSync(f, 'utf8')));
ok('no engineering module touches the DOM, which is why each is testable in Node',
  domInIntel.length === 0, domInIntel.map(f => relative(srcRoot, f)).join(', '));
ok('the engineering layer is substantial', intelFiles.length >= 18, `${intelFiles.length} modules`);

/* ------------------------------------------- 5. one composition root */

const rootFiles = files.filter(f => !relative(srcRoot, f).includes('/'));
ok('src has exactly two files at its root: the entry point and the app',
  rootFiles.length === 2, rootFiles.map(f => relative(srcRoot, f)).sort().join(', '));

const uiImporters = files.filter(f => importsOf(f).some(t => t.startsWith('ui/')) && relative(srcRoot, f) !== 'main.js');
ok('only the composition root imports the interface layer',
  uiImporters.every(f => relative(srcRoot, f).startsWith('ui/')),
  uiImporters.map(f => relative(srcRoot, f)).join(', '));

/* ------------------------------------------------------- 6. no cycles */

const graph = new Map();
for (const f of files) graph.set(relative(srcRoot, f), importsOf(f).map(t => (t.endsWith('.js') ? t : `${t}.js`)));

const cycles = [];
const colour = new Map();
const stack = [];
const visit = (node) => {
  if (colour.get(node) === 'done') return;
  if (colour.get(node) === 'open') {
    cycles.push([...stack.slice(stack.indexOf(node)), node].join(' -> '));
    return;
  }
  colour.set(node, 'open');
  stack.push(node);
  for (const next of graph.get(node) || []) if (graph.has(next)) visit(next);
  stack.pop();
  colour.set(node, 'done');
};
for (const node of graph.keys()) visit(node);
ok('the module graph is acyclic', cycles.length === 0, cycles.slice(0, 3).join(' | '));

/* --------------------------------------- 7. no file has grown unreadable */

const sizes = files
  .map(f => ({ file: relative(srcRoot, f), lines: readFileSync(f, 'utf8').split('\n').length }))
  .sort((a, b) => b.lines - a.lines);
// main.js is the composition root and holds the dialogs, so it is allowed to be
// the largest file by a wide margin; everything else has one job.
const oversized = sizes.filter(s => s.file !== 'main.js' && s.lines > 1200);
ok('no module except the composition root exceeds 1200 lines',
  oversized.length === 0, oversized.map(s => `${s.file} (${s.lines})`).join(', '));
console.log(`     largest modules: ${sizes.slice(0, 4).map(s => `${s.file} ${s.lines}`).join(', ')}`);

/* ------------------------------- 8. every module explains what it is for */

const undocumented = files.filter((f) => {
  const head = readFileSync(f, 'utf8').slice(0, 400).trimStart();
  return !head.startsWith('/**');
});
ok('every module opens with a block comment saying what it is for',
  undocumented.length === 0, undocumented.map(f => relative(srcRoot, f)).join(', '));

/* ------------------------- 9. originality, as a checkable property */

/**
 * ATTRIBUTION.md claims this repository contains nothing from the thirteen
 * projects it is measured against, and lists the only five lines that mention
 * any of them by name. A claim like that decays the moment someone adds a
 * comment, so the list is asserted here rather than left as prose.
 *
 * Nine of the thirteen are GPL, LGPL or AGPL. Copying from them into an
 * MIT-licensed project is a licence violation, not a style issue, which is why
 * this is a build failure and not a note.
 */
const PRIOR_ART = /freecad|librecad|openscad|solvespace|brlcad|qcad|cadquery|blender|build123d|chili3d|meshlab|bforartists|dust3d/i;

const EXPECTED_MENTIONS = new Set([
  'ui/operators.js',      // credits Blender for modal transforms
  'ui/commands.js',       // two palette search keywords
  'intel/drawing.js',     // contrasts with Blender's approach
  'intel/spec.js',        // argues with OpenSCAD's premise
]);

const mentions = [];
for (const file of files) {
  const rel = relative(srcRoot, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => { if (PRIOR_ART.test(line)) mentions.push(`${rel}:${i + 1}`); });
}
const unexpected = mentions.filter(m => !EXPECTED_MENTIONS.has(m.split(':')[0]));
ok('no module mentions a prior-art project outside the four that explain why',
  unexpected.length === 0, unexpected.join(', '));
ok('and the count ATTRIBUTION.md publishes is the count there is',
  mentions.length === 5, `${mentions.length}: ${mentions.join(', ')}`);
ok('the originality detector is not vacuous', PRIOR_ART.test('ported from FreeCAD'));

/* ---------------------------- 10. the tooling runs on Windows too */

/**
 * Four suites passed everywhere and failed on the Windows runner, which is
 * where a release is built, so `npm test` failing there means no .exe.
 *
 * Two causes, both in this project's own tooling rather than in the
 * application. A file URL's `.pathname` is `/D:/a/repo/...` on Windows — a
 * leading slash before the drive letter — which no filesystem call accepts.
 * And `path.relative` returns backslashes there, so every comparison against a
 * literal like `'core/'` quietly matched nothing.
 *
 * The second is the more dangerous of the two: it does not fail, it passes
 * vacuously. A layering check that matches no files reports success. So the
 * pattern is banned outright rather than left to be noticed.
 */
const toolFiles = [];
const walkTools = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTools(full);
    else if (/\.(mjs|cjs|js)$/.test(name)) toolFiles.push(full);
  }
};
walkTools(join(root, 'tools'));

const urlPathname = toolFiles.filter(f =>
  /import\.meta\.url[^\n]*\)\s*\.pathname/.test(readFileSync(f, 'utf8')));
ok('no tool derives a filesystem path from a file URL’s .pathname',
  urlPathname.length === 0,
  urlPathname.map(f => relative(root, f)).join(', ') + ' (use fileURLToPath)');

// Every tool that compares a relative path against a '/' literal has to
// normalise separators first, or it matches nothing on Windows.
const unnormalised = toolFiles.filter((f) => {
  const body = readFileSync(f, 'utf8');
  const comparesWithSlash = /relative\([^)]*\)\s*\.(startsWith|includes|split)\(\s*['"][^'"]*\//.test(body);
  const normalises = /split\(sep\)\.join\(['"]\/['"]\)/.test(body);
  return comparesWithSlash && !normalises;
});
ok('and every tool comparing a relative path to a "/" literal normalises first',
  unnormalised.length === 0, unnormalised.map(f => relative(root, f)).join(', '));

ok('the detectors are not vacuous', toolFiles.length > 10, `${toolFiles.length} tool files`);

/**
 * And the Windows behaviour itself, checked from here.
 *
 * Banning a pattern is only half the argument; the other half is showing what
 * the pattern actually did. Node carries the Windows implementations on every
 * platform — `path.win32`, and a `windows` option on `fileURLToPath` — so the
 * failure that could only be seen on a Windows runner can be reproduced on a
 * Linux one, which is where it will now be caught.
 */
const WIN_URL = 'file:///D:/a/repo/tools/tests/architecture.mjs';
ok('a file URL’s .pathname really does start with a slash before the drive',
  new URL('../..', WIN_URL).pathname.startsWith('/D:'));
ok('and fileURLToPath really does remove it',
  /^D:\\/.test(fileURLToPath(new URL('../..', WIN_URL), { windows: true })));

const winRaw = win32.relative('D:\\a\\repo\\src', 'D:\\a\\repo\\src\\core\\doc.js');
ok('a Windows relative path really does defeat a "core/" comparison',
  winRaw === 'core\\doc.js' && !winRaw.startsWith('core/'), winRaw);
ok('and normalising the separators really does fix it',
  winRaw.split(win32.sep).join('/').startsWith('core/'));

console.log(fails ? `\n${fails} FAILURES` : '\nALL ARCHITECTURE CHECKS PASS');
process.exit(fails ? 1 : 0);
