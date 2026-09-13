/**
 * Every identifier a module uses is one it declares, imports, or gets from the
 * platform.
 *
 * This suite exists because of a bug it would have caught. Splitting
 * `draft/entity.js` out of `draft/draft.js` left ten dangling references
 * behind: two module constants (`TAU`, `D2R`) that stayed in the old file, two
 * imports (`uid`, `entityToPath`) that were never added to the new one, and
 * six helpers the old file still called after they became private in the new
 * one. None of it is a syntax error, `node --check` passes, and every headless
 * suite passed too, because a free identifier in JavaScript is not an error
 * until the line runs. They surfaced as ReferenceErrors in a browser, one at a
 * time, each from whichever code path happened to be exercised next.
 *
 * A grep for the names was what produced the wrong answer first: searching for
 * `function name` at the start of a line finds neither a `const` arrow nor a
 * constant, and reports a clean bill of health for a file that cannot run. So
 * the check is inverted here. Rather than looking for what is missing, which
 * requires knowing what to look for, it enumerates every identifier the file
 * reads and subtracts everything the file could legitimately have got it from.
 *
 * Scope is tracked properly, and that was not the first design. A version that
 * pooled every declared name in a file into one set — on the reasoning that
 * over-collecting can only make the check quieter — let the last of those ten
 * through: `draft.js` has a local `const dist` inside one method and called a
 * *different* `dist` from seven others, so the local answered for all of them
 * and the file read as clean. A check that is quiet in the wrong place is
 * worse than no check, because it is trusted. Blocks are tracked instead, and
 * a name declared in one is visible only there and below.
 *
 * Parameters remain the one deliberate imprecision; `declarations` says why.
 * Every assertion below the fold is a case this scanner got wrong at some
 * point, kept so it cannot get it wrong again.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative as nodeRelative, sep } from 'node:path';
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

/* ------------------------------------------------------------ lexing */

/**
 * Comments, strings, template literals and regex literals removed, each
 * replaced by a space so that token boundaries survive.
 *
 * Regex literals are the reason this is a character scanner and not a pattern.
 * `/^https:\/\//` contains `//`, and a stripper that treats any `//` as a line
 * comment deletes the rest of that line, which is how an earlier version of a
 * different suite silently dropped the very code it was inspecting. Telling a
 * regex literal from a division operator needs the previous significant token,
 * so that is tracked.
 */
const KEYWORD_BEFORE_REGEX =
  /\b(return|typeof|case|in|of|do|else|yield|await|delete|void|new|instanceof)\s*$/;

function stripLiterals(src) {
  let out = '';
  let i = 0;
  let prev = '';                       // last significant character emitted
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      // A template literal's ${...} holds real code, so it is kept and scanned.
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { i += 2; continue; }
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += ` ${stripLiterals(src.slice(start, i))} `;
          i++;                          // past the closing brace
          continue;
        }
        i++;
      }
      i++;
      out += ' ';
      prev = 'x';                       // a string is a value, so a following / divides
      continue;
    }
    if (c === '/') {
      // A regex may begin only where a value may not: after an operator, a
      // comma, an opening bracket, or at the start of an expression. A keyword
      // is the case that is easy to forget and was in fact forgotten:
      // `return /^[-+]?\d*\.?\d+$/.test(s)` ends the previous token with the
      // letter `n`, which reads as a value, so the pattern survived stripping
      // and the `d` of `\d` was reported as an undeclared variable.
      const regexAllowed = prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev) ||
        KEYWORD_BEFORE_REGEX.test(out.slice(-16));
      if (regexAllowed) {
        i++;
        let inClass = false;
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
          else if (src[i] === '\n') break;     // unterminated: not a regex after all
          i++;
        }
        i++;
        while (i < n && /[gimsuy]/.test(src[i])) i++;
        out += ' ';
        prev = 'x';
        continue;
      }
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/* ------------------------------------------------- declarations in a file */

const IDENT = '[A-Za-z_$][A-Za-z0-9_$]*';
/**
 * The block structure of a file, as a tree of `{ start, end, parent }`.
 *
 * Scope is the whole point. A first version of this suite collected every
 * declared name in a file into one set, on the reasoning that over-collecting
 * only makes the check quieter. That reasoning was wrong, and the bug it let
 * through is the one that prompted this rewrite: `draft.js` holds a local
 * `const dist = Math.hypot(...)` inside one method, and calls a *different*
 * `dist` — a helper that had moved to another module — from seven other
 * methods. A file-wide set sees the local declaration, marks every call
 * resolved, and reports a clean file that throws on the first dimension drawn.
 *
 * So blocks are tracked. A name declared inside `{ ... }` is visible in that
 * block and the blocks nested in it, and nowhere else.
 */
const CLASS_HEAD = new RegExp(`\\bclass\\s+${IDENT}(?:\\s+extends\\s+[\\w$.]+)?\\s*$`);

function blockTree(code) {
  const blocks = [{ start: 0, end: code.length, parent: -1 }];   // module scope
  const open = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') {
      blocks.push({
        start: i,
        end: code.length,
        parent: open[open.length - 1],
        // A class body is marked because a bare `NAME = value` means something
        // different inside one: it declares a field, whereas anywhere else it
        // assigns to a name that had better exist already. Without the
        // distinction, either every class field reads as an undeclared
        // variable, or every assignment to a typo'd global passes silently.
        isClassBody: CLASS_HEAD.test(code.slice(Math.max(0, i - 120), i)),
      });
      open.push(blocks.length - 1);
    } else if (code[i] === '}' && open.length > 1) {
      blocks[open.pop()].end = i;
    }
  }
  return blocks;
}

/**
 * The innermost block containing an offset.
 *
 * The bounds are exclusive, and that is not a detail. A block's braces belong
 * to the scope *around* it, not to it: `}` at the end of a constructor is the
 * last character of the constructor's range, but code at that offset is in the
 * class body. Several of the patterns below anchor on the character before a
 * name, and that character is routinely the previous block's closing brace, so
 * an inclusive test filed every method of a class into whichever method
 * happened to precede it. Every one of them then read as undeclared at its own
 * definition, which is how this check first reported seventy false positives.
 */
function blockAt(blocks, index) {
  let best = 0;
  for (let b = 1; b < blocks.length; b++) {
    if (index > blocks[b].start && index < blocks[b].end) {
      if (blocks[b].start > blocks[best].start) best = b;
    }
  }
  return best;
}

const IDENT_RE = new RegExp(IDENT, 'g');

/**
 * Every name the file binds, each tagged with the block it is visible in.
 *
 * Parameters are the one deliberate imprecision. A parameter belongs to its
 * function's body, but finding that body means telling a concise arrow
 * (`x => x + 1`, which has no block at all) from a braced one, and the payoff
 * does not justify the machinery. They are attached to the enclosing block
 * instead, which makes a parameter visible to its function's siblings. That
 * leaks in the quiet direction — it can hide a missing name, never invent one
 * — and it does not reopen the hole above, because the bug there was a
 * `const` in a method body, and those are scoped exactly.
 */
function declarations(code, blocks) {
  const found = [];                       // { name, block }
  const at = (index, text) => {
    if (!text) return;
    const block = blockAt(blocks, index);
    for (const m of text.matchAll(IDENT_RE)) found.push({ name: m[0], block });
  };

  // `const ax = p1[0], ay = p1[1];` binds two names, and a pattern that reads
  // one identifier after the keyword sees only the first. That was this
  // suite's first bug: twenty-one false positives, every one of them the
  // second or third declarator of a list. So a declaration is consumed by a
  // scanner that splits on commas at bracket depth zero, which also handles
  // `const [x1, y1] = e.a` and `for (const [i, v] of pairs)`.
  for (const m of code.matchAll(/\b(?:const|let|var)\b/g)) {
    let i = m.index + m[0].length;
    let depth = 0;
    let segStart = i;
    const segments = [];
    for (; i < code.length; i++) {
      const c = code[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (depth === 0 && c === ';') break;
      else if (depth === 0 && c === ',') { segments.push(code.slice(segStart, i)); segStart = i + 1; }
    }
    segments.push(code.slice(segStart, i));
    for (const seg of segments) {
      // Everything left of the first depth-zero `=` is the binding; an arrow
      // or a comparison can only appear to the right of it.
      let d = 0, cut = seg.length;
      for (let j = 0; j < seg.length; j++) {
        const c = seg[j];
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) d--;
        else if (c === '=' && d === 0) { cut = j; break; }
      }
      // A `for (const x of list)` head has no `=`; the iterated expression is
      // not a binding, so it is dropped rather than over-collected.
      at(m.index, seg.slice(0, cut).split(/\s+(?:of|in)\s+/)[0]);
    }
  }

  for (const m of code.matchAll(new RegExp(`\\b(?:function|class)\\s*\\*?\\s*(${IDENT})`, 'g'))) at(m.index, m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([^)]*)\)/g)) at(m.index + m[0].length, m[1]);

  // Imports bind at module scope wherever they are written.
  for (const m of code.matchAll(new RegExp(`\\bimport\\s*\\{([^}]*)\\}`, 'g'))) at(0, m[1]);
  for (const m of code.matchAll(new RegExp(`\\bimport\\s+(${IDENT})`, 'g'))) at(0, m[1]);
  for (const m of code.matchAll(new RegExp(`\\bas\\s+(${IDENT})`, 'g'))) at(0, m[1]);

  // Parameter lists, of every function form. A default value may contain a
  // call, so each is matched one level of nesting deep: `(id, seen = new Set())`.
  for (const m of code.matchAll(/\bfunction\s*\*?\s*[A-Za-z_$0-9]*\s*\(((?:[^()]|\([^()]*\))*)\)/g)) at(m.index, m[1]);
  for (const m of code.matchAll(/\(((?:[^()]|\([^()]*\))*)\)\s*=>/g)) at(m.index, m[1]);
  for (const m of code.matchAll(new RegExp(`(${IDENT})\\s*=>`, 'g'))) at(m.index, m[1]);
  // Method shorthand in a class or object literal: `name(a, b) {`.
  for (const m of code.matchAll(new RegExp(`(?:^|[\\s;{}])(?:get|set|async|static|\\*)?\\s*(${IDENT})\\s*\\(((?:[^()]|\\([^()]*\\))*)\\)\\s*\\{`, 'gm'))) {
    at(m.index, m[1]);
    at(m.index, m[2]);
  }
  // Class fields: `LEARN_STEPS = [...]` at the top level of a class body.
  for (const block of blocks) {
    if (!block.isClassBody) continue;
    const body = code.slice(block.start, block.end);
    for (const m of body.matchAll(new RegExp(`(?:^|[\\n;{])\\s*(?:static\\s+)?(${IDENT})\\s*=[^=]`, 'g'))) {
      const index = block.start + m.index;
      if (blockAt(blocks, index + m[0].length - 1) !== blocks.indexOf(block)) continue;  // nested, not a field
      found.push({ name: m[1], block: blocks.indexOf(block) });
    }
  }

  return found;
}

/* --------------------------------------------------- identifiers read */

/**
 * Identifiers the file reads as free variables, each with the offset it was
 * read at: not after a dot, not an object key, not a label.
 */
function references(code) {
  const out = [];
  const pattern = new RegExp(`(^|[^.\\w$'"\`])(${IDENT})(\\s*)([^]|$)`, 'gm');
  for (const m of code.matchAll(pattern)) {
    // `{ key: value }` and `case x:` both end in a colon; a property key is
    // never a free read. Optional-chained access `?.name` is property access.
    if (m[4] === ':' && m[3] === '') continue;
    out.push({ name: m[2], index: m.index + m[1].length });
  }
  return out;
}

/** Is a name visible at an offset: declared in its block, or in one above it? */
function visible(found, blocks, name, index) {
  let block = blockAt(blocks, index);
  while (block >= 0) {
    for (const d of found) if (d.name === name && d.block === block) return true;
    block = blocks[block].parent;
  }
  return false;
}

/* ------------------------------------------------------------- globals */

/**
 * The platform. Split by surface, because "is this module allowed to see the
 * DOM" is a question the architecture suite answers and this one must not
 * accidentally re-answer by omission.
 */
const KEYWORDS = new Set(`
break case catch class const continue debugger default delete do else enum export extends
false finally for function if implements import in instanceof interface let new null of
package private protected public return static super switch this throw true try typeof
var void while with yield async await get set from as constructor prototype arguments
`.trim().split(/\s+/));

const LANGUAGE_GLOBALS = new Set(`
Object Array String Number Boolean Symbol BigInt Function Math JSON Date RegExp Error
TypeError RangeError SyntaxError ReferenceError EvalError URIError AggregateError
Map Set WeakMap WeakSet Promise Proxy Reflect Intl globalThis Infinity NaN undefined
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array
Float32Array Float64Array BigInt64Array BigUint64Array ArrayBuffer SharedArrayBuffer DataView
structuredClone queueMicrotask console TextEncoder TextDecoder URL URLSearchParams
AbortController Blob File FileReader crypto performance atob btoa fetch Response Request
setTimeout clearTimeout setInterval clearInterval
`.trim().split(/\s+/));

const BROWSER_GLOBALS = new Set(`
window document navigator location history screen localStorage sessionStorage
requestAnimationFrame cancelAnimationFrame matchMedia getComputedStyle
Image Audio Worker SharedWorker MessageChannel BroadcastChannel EventSource WebSocket
Element HTMLElement HTMLCanvasElement HTMLInputElement Node NodeList DOMParser
XMLSerializer CustomEvent Event KeyboardEvent MouseEvent PointerEvent WheelEvent
TouchEvent DragEvent ClipboardEvent ResizeObserver IntersectionObserver MutationObserver
Path2D ImageData OffscreenCanvas createImageBitmap devicePixelRatio alert confirm prompt
innerWidth innerHeight outerWidth outerHeight scrollX scrollY visualViewport
MediaRecorder MediaSource AudioContext speechSynthesis SpeechSynthesisUtterance
close postMessage self addEventListener removeEventListener onmessage caches
ServiceWorkerGlobalScope clients importScripts indexedDB IDBKeyRange
`.trim().split(/\s+/));

const KNOWN = new Set([...KEYWORDS, ...LANGUAGE_GLOBALS, ...BROWSER_GLOBALS]);

/* --------------------------------------------------------------- the check */

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.js')) files.push(full);
  }
};
walk(srcRoot);

/**
 * `export { a, b } from './x.js'` names two bindings of another module and
 * creates no local binding for either, so those names are neither declared
 * here nor read here. Left in, they are reported as unresolved: this suite's
 * second false positive, and a convincing one, because the names really were
 * missing from the importing file's own import list at the time. Dropping the
 * clause is what makes the remaining report true.
 */
const stripReExports = (code) => code.replace(/\bexport\s*\{[^}]*\}\s*from\s*/g, ' ');

const unresolvedIn = (source) => {
  const code = stripReExports(stripLiterals(source));
  const blocks = blockTree(code);
  const found = declarations(code, blocks);
  const missing = new Set();
  for (const { name, index } of references(code)) {
    if (KNOWN.has(name)) continue;
    if (visible(found, blocks, name, index)) continue;
    missing.add(name);
  }
  return [...missing].sort();
};

/* --- proof the check is not vacuous, using the actual bug it was written for */

const REAL_BUG = `
import { store } from '../core/doc.js';
const TAU = Math.PI * 2;
export function entityPoints(e) {
  const path = entityToPath(e, 24);
  return path ? path.pts : [];
}
export function spanOf(e) { return (e.a1 - e.a0) * TAU * D2R; }
`;
const found = unresolvedIn(REAL_BUG);
ok('the check finds a missing import', found.includes('entityToPath'), found.join(', '));
ok('and a missing module constant', found.includes('D2R'), found.join(', '));
ok('while accepting one that is declared', !found.includes('TAU'));
ok('and one that is imported', !found.includes('store'));

const PROPERTY_CASE = 'const data = {}, opts = {}; const u = data.units; const d = opts.D2R;';
ok('a property of the same name is not a free read',
  unresolvedIn(PROPERTY_CASE).length === 0, unresolvedIn(PROPERTY_CASE).join(', '));
const MULTI_CASE = 'const ax = 1, ay = 2, [bx, by] = [3, 4]; export const s = ax + ay + bx + by;';
ok('every declarator in a comma-separated list binds, not just the first',
  unresolvedIn(MULTI_CASE).length === 0, unresolvedIn(MULTI_CASE).join(', '));
ok('an object key is not a free read',
  unresolvedIn('export const o = { widthOfThing: 1, depthOfThing: 2 };').length === 0,
  unresolvedIn('export const o = { widthOfThing: 1, depthOfThing: 2 };').join(', '));
const REEXPORT = "export { rotateEntity, scaleEntity } from './entity.js';";
ok('a re-export names another module’s bindings, not local reads',
  unresolvedIn(REEXPORT).length === 0, unresolvedIn(REEXPORT).join(', '));
ok('but a local re-export without `from` is a real read',
  unresolvedIn('export { notDeclaredHere };').includes('notDeclaredHere'));
ok('a name inside a string is not a free read',
  unresolvedIn('const s = "entityToPath is fine here"; const t = `so is D2R`;').length === 0);
ok('a regex containing a slash-slash does not eat the line after it',
  unresolvedIn('const ok = /^https:\\/\\//.test(u); const v = missingName;').includes('missingName'));
ok('a divided value is not mistaken for a regex',
  unresolvedIn('const half = total / 2; const q = also / 2; const r = missingToo;')
    .includes('missingToo'));
const AFTER_RETURN = 'export const isNum = (s) => { return /^[-+]?\\d*\\.?\\d+$/.test(s); };';
ok('a regex literal following a keyword is stripped, not read as identifiers',
  unresolvedIn(AFTER_RETURN).length === 0, unresolvedIn(AFTER_RETURN).join(', '));
const CLASS_FIELD = 'class A { STEPS = [1, 2]; count() { return this.STEPS.length; } }';
ok('a class field is a declaration, not an assignment to an unknown name',
  unresolvedIn(CLASS_FIELD).length === 0, unresolvedIn(CLASS_FIELD).join(', '));
const SHADOWED = 'const f = () => { const dist = 1; return dist; };\nconst g = () => dist(1, 2);';
ok('a local declared in one function does not resolve a call in another',
  unresolvedIn(SHADOWED).includes('dist'), unresolvedIn(SHADOWED).join(', '));
ok('a name interpolated into a template is still checked',
  unresolvedIn('const s = `value ${missingInTemplate}`;').includes('missingInTemplate'));
ok('a parameter is not a free read',
  unresolvedIn('export const f = (alpha, beta) => alpha + beta;').length === 0,
  unresolvedIn('export const f = (alpha, beta) => alpha + beta;').join(', '));
const DEFAULTED = 'const f = (id, seen = new Set()) => seen.has(id); export const g = f;';
ok('a default parameter value containing a call still binds its parameters',
  unresolvedIn(DEFAULTED).length === 0, unresolvedIn(DEFAULTED).join(', '));
ok('a destructured binding is not a free read',
  unresolvedIn('const { alpha, beta } = thing; export const s = alpha + beta;')
    .join(',') === 'thing',
  unresolvedIn('const { alpha, beta } = thing; export const s = alpha + beta;').join(', '));

/* --- and now every module in the project */

const offenders = [];
for (const file of files) {
  const missing = unresolvedIn(readFileSync(file, 'utf8'));
  if (missing.length) offenders.push(`${relative(root, file)}: ${missing.join(', ')}`);
}
ok('every identifier in every module resolves to a declaration, an import or the platform',
  offenders.length === 0, offenders.slice(0, 8).join(' | '));
console.log(`     ${files.length} modules scanned`);

console.log(fails ? `\n${fails} FAILURES` : '\nALL BINDING CHECKS PASS');
process.exit(fails ? 1 : 0);
