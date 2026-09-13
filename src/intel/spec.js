/**
 * Design as code: the document and its text are the same object.
 *
 * Two camps, both half right. Scripted CAD (OpenSCAD and friends) gives you
 * text, so you get diffs, review, search, generation and version control for
 * free, and gives up direct manipulation: you cannot drag a face. Graphical
 * CAD gives you the mouse and locks the design in a format only its own
 * binary can read, so a design review is screenshots and a merge is a phone
 * call.
 *
 * The usual compromise is a scripting API bolted onto the side, which is a
 * third representation that drifts from the other two. This is not that. The
 * text below is a projection of the document, and parsing it is the inverse
 * projection. Edit the model and the text changes; edit the text and the model
 * changes. There is one source of truth and two ways to hold it.
 *
 * The format is deliberately dull: line oriented, indentation for structure,
 * one fact per line, stable key order. That is what makes a diff readable, and
 * a readable diff is the whole reason to have text at all.
 *
 * Where text genuinely cannot carry something, `toSpec` says so instead of
 * pretending. Imported mesh payloads are tens of thousands of floats; writing
 * them as text would make the spec unreadable and the diff useless. They stay
 * attached to the document and `fromSpec` restores them by id, which is
 * honest: the text is the design, not the triangles it was scanned from.
 */
import { CATALOG, MATERIALS, UNITS, makeFeature, newDocument, uid } from '../core/doc.js';
import { buildScope, tryEval } from '../core/expr.js';

export const SPEC_VERSION = 1;
const INDENT = '  ';

/**
 * Keys that live on the feature record rather than in its parameters. A
 * catalogue parameter is allowed to share one of these names (the mesh import
 * has its own scalar `scale`), so a colliding parameter is written with an
 * explicit `param` prefix and read back the same way. Without that the two
 * meanings of `scale` would silently overwrite each other.
 */
const RESERVED = new Set(['pos', 'rot', 'scale', 'material', 'inputs', 'profile', 'color', 'opacity', 'mesh', 'suppressed', 'hidden', 'param']);

/* ------------------------------------------------------------------ write */

const isIdent = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);

/**
 * Names a parameter may not take.
 *
 * `__proto__` and friends are valid identifiers, so the pattern above accepts
 * them, and a parameter called `__proto__` then exists but can never be read
 * back reliably: the expression scope has a null prototype precisely so such a
 * name cannot collide with the object model, which means the parameter
 * silently does nothing. Refusing it by name is clearer than accepting a
 * parameter that cannot work.
 */
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__']);
const quote = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function num(n) {
  if (!Number.isFinite(n)) return '0';
  // Trim float noise so a diff shows the edit and not the arithmetic.
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

function value(v) {
  if (v == null) return 'none';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v)) return v.map(value).join(', ');
  const s = String(v);
  // An expression or a bare word can go unquoted; anything else is quoted so
  // the parser never has to guess.
  return /^[-+]?\d*\.?\d+$/.test(s) || /^[A-Za-z0-9_ .+\-*/()]+$/.test(s) ? s : quote(s);
}

// A transform component is evaluated like any other field, so it may be an
// expression rather than a number. Write each component with the same rules as
// a parameter value.
const vec = (a, fallback) => (Array.isArray(a) ? a : fallback).map(v => (typeof v === 'number' ? num(v) : value(v))).join(', ');

/**
 * Write a document as spec text.
 * @returns {{text: string, lossy: Array<{feature: string, what: string, note: string}>}}
 */
export function toSpec(doc) {
  const lossy = [];
  const out = [];
  const w = (s = '') => out.push(s);

  w(`# TesserCAD spec v${SPEC_VERSION}`);
  w(`part ${quote(doc.meta?.name || 'Untitled')}`);
  w(`units ${doc.meta?.units || 'mm'}`);
  if (doc.meta?.author) w(`author ${quote(doc.meta.author)}`);
  if (doc.meta?.notes) w(`notes ${quote(doc.meta.notes)}`);

  if (doc.params?.length) {
    w('');
    w('# Parameters. Any feature field can reference these by name.');
    for (const p of doc.params) {
      const name = isIdent(p.name) ? p.name : quote(p.name);
      w(`param ${name} = ${value(p.value)}${p.note ? `   # ${p.note}` : ''}`);
    }
  }

  for (const f of doc.features || []) {
    w('');
    const cat = CATALOG[f.type];
    if (!cat) lossy.push({ feature: f.name, what: 'type', note: `Unknown feature type "${f.type}"; it is written out but will not rebuild.` });
    w(`feature ${f.type} ${quote(f.name)} #${f.id}`);

    // Parameters in catalogue order, so two documents of the same type diff
    // line for line instead of by whatever order the keys were created in.
    const order = (cat?.fields || []).map(x => x.key);
    const keys = [...new Set([...order, ...Object.keys(f.params || {})])];
    for (const k of keys) {
      if (!(k in (f.params || {}))) continue;
      w(`${INDENT}${RESERVED.has(k) ? 'param ' : ''}${k} = ${value(f.params[k])}`);
    }

    const t = f.transform || {};
    if ((t.pos || []).some(Boolean)) w(`${INDENT}pos = ${vec(t.pos, [0, 0, 0])}`);
    if ((t.rot || []).some(Boolean)) w(`${INDENT}rot = ${vec(t.rot, [0, 0, 0])}`);
    if ((t.scale || []).some(v => v !== 1)) w(`${INDENT}scale = ${vec(t.scale, [1, 1, 1])}`);
    if (f.material && f.material !== 'steel') w(`${INDENT}material = ${f.material}`);
    if (f.inputs?.length) w(`${INDENT}inputs = ${f.inputs.map(id => `#${id}`).join(', ')}`);
    if (f.profile?.length) w(`${INDENT}profile = ${f.profile.map(id => `#${id}`).join(', ')}`);
    if (f.appearance?.color && f.appearance.color !== MATERIALS[f.material]?.color) w(`${INDENT}color = ${f.appearance.color}`);
    if (f.appearance && f.appearance.opacity != null && f.appearance.opacity !== 1) w(`${INDENT}opacity = ${num(f.appearance.opacity)}`);
    if (f.suppressed) w(`${INDENT}suppressed`);
    if (f.visible === false) w(`${INDENT}hidden`);

    if (f.data?.positions?.length) {
      const n = Math.round(f.data.positions.length / 9);
      w(`${INDENT}mesh ${n} triangles   # payload kept in the document, not in the text`);
      lossy.push({ feature: f.name, what: 'mesh', note: `${n} triangles stay attached to the document; the text records only that they exist.` });
    }
  }
  w('');
  return { text: out.join('\n'), lossy };
}

/* ------------------------------------------------------------------- read */

/**
 * Split a line into content and trailing comment, respecting quotes.
 *
 * The hash does two jobs, so one rule separates them: `#` followed by a space
 * starts a comment, `#` followed by anything else is an id reference. That is
 * why every id this module writes is `#f3` and every comment is `# note`.
 */
function stripComment(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && inStr) { i++; continue; }
    if (c === '"') inStr = !inStr;
    else if (c === '#' && !inStr && !/[^\s]/.test(line[i + 1] || ' ')) {
      return { body: line.slice(0, i), comment: line.slice(i + 1).trim() };
    }
  }
  return { body: line, comment: '' };
}

function unquote(s) {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}

/** Parse one right-hand side into a number, boolean, string or array. */
function parseValue(raw) {
  const t = raw.trim();
  if (!t) return '';
  if (t.includes(',') && !t.startsWith('"')) {
    return t.split(',').map(p => parseValue(p));
  }
  if (t === 'none') return null;
  if (t === 'yes' || t === 'true') return true;
  if (t === 'no' || t === 'false') return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t);
  if (t.startsWith('"')) return unquote(t);
  return t;                                  // expression or bare word
}

const idsOf = (v) => (Array.isArray(v) ? v : [v]).map(x => String(x).replace(/^#/, '').trim()).filter(Boolean);

/**
 * Parse spec text into a document.
 *
 * @param {string} text
 * @param {{base?: object, keepIds?: boolean}} opts
 *        `base` supplies the payloads text cannot carry (imported mesh data,
 *        and any feature field this format does not model) matched by id, so a
 *        round trip through text does not quietly discard them.
 * @returns {{doc: object|null, errors: Array<{line: number, text: string, message: string}>,
 *            warnings: Array<{line: number, message: string}>}}
 */
export function fromSpec(text, { base = null, keepIds = true } = {}) {
  const errors = [];
  const warnings = [];
  const lines = String(text ?? '').split(/\r?\n/);
  const doc = newDocument('Untitled');
  doc.params = [];
  doc.features = [];
  if (base?.draw) doc.draw = structuredClone(base.draw);
  if (base?.sim) doc.sim = structuredClone(base.sim);
  if (base?.view) doc.view = structuredClone(base.view);

  const baseFeatures = new Map((base?.features || []).map(f => [f.id, f]));
  const seenIds = new Set();
  const seenParams = new Set();
  let current = null;
  const fail = (i, message) => errors.push({ line: i + 1, text: lines[i].trim(), message });

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const { body, comment } = stripComment(rawLine);
    if (!body.trim()) continue;
    const indented = /^\s/.test(rawLine);
    const line = body.trim();

    if (indented) {
      if (!current) { fail(i, 'Indented line with no feature above it.'); continue; }
      const eq = line.indexOf('=');
      if (eq < 0) {
        // Flags, and the mesh marker, which is informational only.
        if (line === 'suppressed') current.suppressed = true;
        else if (line === 'hidden') current.visible = false;
        else if (/^mesh\b/.test(line)) { /* payload comes from base, not text */ }
        else fail(i, `Expected "key = value", got "${line}".`);
        continue;
      }
      let key = line.slice(0, eq).trim();
      const val = parseValue(line.slice(eq + 1));
      if (!key) { fail(i, 'Missing key before "=".'); continue; }

      // An explicit `param` prefix forces a parameter, which is how a feature
      // type that has its own `scale` states it without meaning the transform.
      const forced = /^param\s+(\S+)$/.exec(key);
      if (forced) {
        key = forced[1];
        current.params[key] = val;
        continue;
      }

      if (key === 'pos' || key === 'rot' || key === 'scale') {
        const a = Array.isArray(val) ? val : [val];
        const usable = a.every(x => (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x.trim()));
        if (a.length !== 3 || !usable) { fail(i, `${key} needs three components, each a number or an expression.`); continue; }
        current.transform[key] = a;
      } else if (key === 'material') {
        const m = String(val);
        if (!MATERIALS[m]) warnings.push({ line: i + 1, message: `Unknown material "${m}"; falling back to steel.` });
        current.material = MATERIALS[m] ? m : 'steel';
        const mat = MATERIALS[current.material];
        current.appearance = { ...current.appearance, color: mat.color, metalness: mat.metal, roughness: mat.rough };
      } else if (key === 'inputs') {
        current.inputs = idsOf(val);
      } else if (key === 'profile') {
        current.profile = idsOf(val);
      } else if (key === 'color') {
        current.appearance = { ...current.appearance, color: String(val) };
      } else if (key === 'opacity') {
        current.appearance = { ...current.appearance, opacity: Number(val) };
      } else if (RESERVED.has(key)) {
        warnings.push({ line: i + 1, message: `"${key}" is reserved and was ignored.` });
      } else {
        current.params[key] = val;
      }
      continue;
    }

    // Top level.
    current = null;
    const m = /^(\w+)\b\s*(.*)$/.exec(line);
    if (!m) { fail(i, `Cannot read "${line}".`); continue; }
    const [, word, rest] = m;

    switch (word) {
      case 'part': doc.meta.name = unquote(rest) || 'Untitled'; break;
      case 'units': {
        const u = unquote(rest);
        if (!UNITS[u]) { warnings.push({ line: i + 1, message: `Unknown unit "${u}"; keeping mm.` }); break; }
        doc.meta.units = u;
        break;
      }
      case 'author': doc.meta.author = unquote(rest); break;
      case 'notes': doc.meta.notes = unquote(rest); break;
      case 'param': {
        const eq = rest.indexOf('=');
        if (eq < 0) { fail(i, 'A parameter needs a value: param name = 10.'); break; }
        const name = unquote(rest.slice(0, eq));
        if (!isIdent(name)) { fail(i, `"${name}" is not a usable parameter name. Letters, digits and underscore, starting with a letter.`); break; }
        if (RESERVED_NAMES.has(name)) { fail(i, `"${name}" is reserved by the language and cannot name a parameter.`); break; }
        if (seenParams.has(name)) { fail(i, `Parameter "${name}" is defined twice.`); break; }
        seenParams.add(name);
        doc.params.push({ id: uid('p'), name, value: parseValue(rest.slice(eq + 1)), note: comment });
        break;
      }
      case 'feature': {
        const fm = /^([A-Za-z][\w-]*)\s+(".*?"|\S+)?\s*(?:#(\S+))?\s*$/.exec(rest);
        if (!fm) { fail(i, 'A feature needs a type and a name: feature box "Plate".'); break; }
        const type = fm[1];
        if (!CATALOG[type]) { fail(i, `Unknown feature type "${type}". Known types: ${Object.keys(CATALOG).slice(0, 8).join(', ')}, ...`); break; }
        const name = fm[2] ? unquote(fm[2]) : CATALOG[type].label;
        const wantId = keepIds && fm[3] ? fm[3] : null;
        if (wantId && seenIds.has(wantId)) { fail(i, `Two features share the id #${wantId}.`); break; }
        const f = makeFeature(type, { name });
        // makeFeature seeds catalogue defaults; a spec is a complete statement
        // of the feature, so start empty and take only what the text says.
        f.params = {};
        if (wantId) f.id = wantId;
        seenIds.add(f.id);
        // Reattach what the text does not carry.
        const prior = baseFeatures.get(f.id);
        if (prior?.data) f.data = prior.data;
        doc.features.push(f);
        current = f;
        break;
      }
      default:
        fail(i, `"${word}" is not a spec keyword. Expected part, units, author, notes, param or feature.`);
    }
  }

  // Fill in catalogue defaults for parameters the text left out, and flag them,
  // because a silently defaulted dimension is how a spec lies.
  for (const f of doc.features) {
    const cat = CATALOG[f.type];
    for (const [k, v] of Object.entries(cat?.params || {})) {
      if (!(k in f.params)) {
        f.params[k] = structuredClone(v);
        warnings.push({ line: 0, message: `${f.name}: ${k} not given, using the default ${value(v)}.` });
      }
    }
  }

  // Every expression is checked against the parameters the spec declares, so a
  // mistyped name is reported here with a line number rather than surfacing as
  // a feature that silently fails to rebuild.
  const { scope, errors: paramErrors } = buildScope(doc.params);
  for (const [name, message] of Object.entries(paramErrors)) {
    errors.push({ line: 0, text: `param ${name}`, message: `Parameter "${name}": ${message}` });
  }
  for (const f of doc.features) {
    const check = (label, v) => {
      if (typeof v !== 'string' || !v.trim()) return;
      // A bare word that is not a number is a material, an op or a colour; only
      // check things that actually look like arithmetic on names.
      if (!/[A-Za-z_]/.test(v) && !/\d/.test(v)) return;
      const r = tryEval(v, scope);
      if (!r.ok) warnings.push({ line: 0, message: `${f.name}: ${label} "${v}" does not evaluate (${r.error}).` });
    };
    const cat = CATALOG[f.type];
    for (const [k, v] of Object.entries(f.params || {})) {
      if (typeof (cat?.params || {})[k] === 'string' || typeof (cat?.params || {})[k] === 'boolean') continue;
      check(k, v);
    }
    for (const axis of ['pos', 'rot', 'scale']) for (const v of f.transform?.[axis] || []) check(axis, v);
  }

  // Inputs must name features that exist, or the tree will not rebuild.
  const have = new Set(doc.features.map(f => f.id));
  for (const f of doc.features) {
    const missing = (f.inputs || []).filter(id => !have.has(id));
    if (missing.length) errors.push({ line: 0, text: f.name, message: `${f.name} refers to ${missing.map(x => '#' + x).join(', ')}, which no feature defines.` });
  }

  return { doc: errors.length ? null : doc, errors, warnings };
}

/* -------------------------------------------------------------- round trip */

/**
 * Prove the projection is invertible on this document. Anything the text
 * cannot carry is listed rather than glossed over, so the claim is checkable
 * on real input instead of asserted in a README.
 */
export function roundTrip(doc) {
  const { text, lossy } = toSpec(doc);
  const { doc: back, errors, warnings } = fromSpec(text, { base: doc });
  if (!back) return { ok: false, text, errors, warnings, lossy, differences: ['The spec did not parse.'] };

  const differences = [];
  const strip = (d) => ({
    name: d.meta?.name, units: d.meta?.units, author: d.meta?.author || '', notes: d.meta?.notes || '',
    params: (d.params || []).map(p => ({ name: p.name, value: p.value })),
    features: (d.features || []).map(f => ({
      id: f.id, type: f.type, name: f.name,
      params: Object.fromEntries(Object.entries(f.params || {}).sort()),
      pos: f.transform?.pos || [0, 0, 0], rot: f.transform?.rot || [0, 0, 0], scale: f.transform?.scale || [1, 1, 1],
      material: f.material, suppressed: !!f.suppressed, visible: f.visible !== false,
      inputs: f.inputs || [], profile: f.profile || null,
      tris: f.data?.positions ? f.data.positions.length : 0,
    })),
  });
  const a = strip(doc), b = strip(back);
  const walk = (x, y, path) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
      return;
    }
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      x.forEach((v, i) => walk(v, y[i], `${path}[${i}]`));
      return;
    }
    differences.push(`${path}: ${JSON.stringify(x)} became ${JSON.stringify(y)}`);
  };
  walk(a, b, '');
  return { ok: differences.length === 0, text, back, errors, warnings, lossy, differences };
}

/* ------------------------------------------------------------------- diff */

/**
 * A line diff of two specs, which is the review artefact CAD has never had:
 * a page a colleague can read and comment on without opening the software.
 */
export function specDiff(beforeText, afterText) {
  const A = String(beforeText ?? '').split('\n');
  const B = String(afterText ?? '').split('\n');
  const n = A.length, m = B.length;
  // LCS over lines. Specs are hundreds of lines at most, so the plain table is
  // faster than any cleverness and far easier to trust.
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = A[i] === B[j]
        ? dp[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { rows.push({ kind: 'same', text: A[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { rows.push({ kind: 'removed', text: A[i], a: i + 1, b: null }); i++; }
    else { rows.push({ kind: 'added', text: B[j], a: null, b: j + 1 }); j++; }
  }
  while (i < n) rows.push({ kind: 'removed', text: A[i], a: ++i, b: null });
  while (j < m) rows.push({ kind: 'added', text: B[j], a: null, b: ++j });

  const added = rows.filter(r => r.kind === 'added').length;
  const removed = rows.filter(r => r.kind === 'removed').length;
  return { rows, added, removed, empty: !added && !removed };
}

/** Collapse a diff to changed regions with a few lines of context each. */
export function hunks(diff, context = 2) {
  const rows = diff.rows;
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, k) => {
    if (r.kind === 'same') return;
    for (let x = Math.max(0, k - context); x <= Math.min(rows.length - 1, k + context); x++) keep[x] = true;
  });
  const out = [];
  let run = null;
  rows.forEach((r, k) => {
    if (keep[k]) { if (!run) { run = { from: k, rows: [] }; out.push(run); } run.rows.push(r); }
    else run = null;
  });
  return out;
}

/* ------------------------------------------------------------------ apply */

/**
 * Take edited text and report what it would do before doing it. Text is a
 * powerful editing surface precisely because a typo can delete half a model,
 * so the answer to "apply this" is a summary first.
 */
export function reviewSpec(text, doc) {
  const parsed = fromSpec(text, { base: doc });
  const before = toSpec(doc).text;
  const diff = specDiff(before, text);
  if (!parsed.doc) {
    return { ok: false, errors: parsed.errors, warnings: parsed.warnings, diff, summary: `${parsed.errors.length} error${parsed.errors.length === 1 ? '' : 's'}; nothing applied.` };
  }
  // Compare canonically: `toSpec` writes parameters in catalogue order, so a
  // document whose keys happen to be stored in another order must not read as
  // a change when nothing about it changed.
  const canonical = (f) => JSON.stringify({ ...f, params: Object.fromEntries(Object.entries(f.params || {}).sort()) });
  const had = new Map((doc.features || []).map(f => [f.id, f]));
  const now = new Map(parsed.doc.features.map(f => [f.id, f]));
  const addedF = [...now.keys()].filter(id => !had.has(id));
  const removedF = [...had.keys()].filter(id => !now.has(id));
  const changedF = [...now.keys()].filter(id => had.has(id) && canonical(had.get(id)) !== canonical(now.get(id)));
  return {
    ok: true, doc: parsed.doc, errors: [], warnings: parsed.warnings, diff,
    added: addedF.map(id => now.get(id).name),
    removed: removedF.map(id => had.get(id).name),
    changed: changedF.map(id => now.get(id).name),
    summary: [
      addedF.length ? `${addedF.length} added` : '',
      removedF.length ? `${removedF.length} removed` : '',
      changedF.length ? `${changedF.length} changed` : '',
    ].filter(Boolean).join(', ') || 'No change',
  };
}

/** Canonical formatting, so a hand-edited spec stops producing noisy diffs. */
export function format(text) {
  const parsed = fromSpec(text);
  return parsed.doc ? toSpec(parsed.doc).text : text;
}

/** A starter spec, for the first time someone opens the text view on nothing. */
export const EXAMPLE = `# TesserCAD spec v${SPEC_VERSION}
part "Mounting plate"
units mm

# Change a parameter and every feature that references it follows.
param plate_w = 120
param plate_d = 80
param thick = 8
param bolt = 6.6      # M6 clearance

feature box "Plate"
  w = plate_w
  d = plate_d
  h = thick
  material = aluminium

feature cylinder "Bolt hole"
  r = bolt / 2
  h = thick * 2
  pos = plate_w / 2 - 12, plate_d / 2 - 12, 0
`;
