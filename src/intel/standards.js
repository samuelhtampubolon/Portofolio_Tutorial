/**
 * Studio memory: the things you should only have to tell the software once.
 *
 * CAD knows the open document extremely well and knows nothing about the
 * organisation around it. Every new file starts from the same factory defaults,
 * so the same house conventions get re-entered project after project, and the
 * reasoning behind a rejected approach lives in someone's head until they leave.
 *
 * This module holds two kinds of memory, deliberately kept apart:
 *
 *   Standards — the settings that should seed every new document: units,
 *   default material, the shop you actually send work to, your rates, your
 *   minimum wall, your naming convention. Applied on file/new, never silently
 *   applied to a document someone else authored.
 *
 *   The decision log — what was tried, what was chosen, and what was rejected
 *   and why. This is the part no CAD package keeps, and the part that is most
 *   expensive to lose: six months later the model shows what was built and
 *   nothing at all about the three alternatives that were considered first.
 *
 * All of it is localStorage. Nothing leaves the browser, which is the whole
 * privacy model of the application and is not negotiable for a convenience
 * feature.
 */

const KEY = 'tessercad.studio.v1';

export const DEFAULT_STANDARDS = {
  /* seeded into every new document */
  units: 'mm',
  material: 'aluminium',
  namePattern: '{part}-{nn}',
  author: '',

  /* what the Doctor measures against */
  process: 'cnc3',
  minWall: null,        // null means "use the process default"
  minFeature: null,
  tolerance: null,

  /* what the estimate uses */
  batch: 1,
  currency: '',            // a symbol or code to print after a figure; blank stays unitless
  rates: {},            // processId -> partial Process override
  materialPrice: {},    // material -> price per kg

  /* housekeeping */
  autoDoctor: true,
  seedNewDocuments: true,
};

const MAX_DECISIONS = 200;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      standards: { ...DEFAULT_STANDARDS, ...(raw.standards || {}) },
      decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
      macros: Array.isArray(raw.macros) ? raw.macros : [],
    };
  } catch {
    return { standards: { ...DEFAULT_STANDARDS }, decisions: [], macros: [] };
  }
}

function write(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { /* private mode, or the quota is full; memory is a convenience, not a requirement */ }
}

/* ------------------------------------------------------------- standards */

export function standards() { return read().standards; }

export function setStandard(key, value) {
  const s = read();
  s.standards[key] = value;
  write(s);
  return s.standards;
}

export function setStandards(patch) {
  const s = read();
  s.standards = { ...s.standards, ...patch };
  write(s);
  return s.standards;
}

export function resetStandards() {
  const s = read();
  s.standards = { ...DEFAULT_STANDARDS };
  write(s);
  return s.standards;
}

/**
 * Seed a fresh document from the house standards.
 *
 * Only ever called on a document this session created. Applying remembered
 * settings to a file that arrived from someone else would quietly rewrite their
 * intent, which is the opposite of what memory is for.
 */
export function seedDocument(doc) {
  const s = standards();
  if (!s.seedNewDocuments) return doc;
  doc.meta.units = s.units;
  if (s.author) doc.meta.author = s.author;
  doc.studio = { process: s.process, batch: s.batch };
  return doc;
}

/** The effective manufacturing limits: house overrides on top of the process. */
export function limits(process) {
  const s = standards();
  return {
    minWall: s.minWall ?? process.minWall,
    minFeature: s.minFeature ?? process.minFeature,
    tolerance: s.tolerance ?? process.tolerance,
  };
}

/* --------------------------------------------------------- decision log */

/**
 * Record a design decision.
 * @param {object} entry { title, choice, rejected?, why?, doc?, featureId? }
 */
export function logDecision(entry) {
  const s = read();
  s.decisions.unshift({
    id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ...entry,
  });
  if (s.decisions.length > MAX_DECISIONS) s.decisions.length = MAX_DECISIONS;
  write(s);
  return s.decisions;
}

export function decisions({ doc = null } = {}) {
  const all = read().decisions;
  return doc ? all.filter(d => d.doc === doc) : all;
}

export function deleteDecision(id) {
  const s = read();
  s.decisions = s.decisions.filter(d => d.id !== id);
  write(s);
  return s.decisions;
}

export function clearDecisions() {
  const s = read();
  s.decisions = [];
  write(s);
}

/* --------------------------------------------------------------- macros */
/* Stored here rather than in prefs so that one export carries everything the
   studio has learned: standards, decisions and automations together. */

export function macros() { return read().macros; }

export function saveMacro(macro) {
  const s = read();
  const i = s.macros.findIndex(m => m.id === macro.id);
  if (i >= 0) s.macros[i] = macro; else s.macros.push(macro);
  write(s);
  return s.macros;
}

export function deleteMacro(id) {
  const s = read();
  s.macros = s.macros.filter(m => m.id !== id);
  write(s);
  return s.macros;
}

/* ------------------------------------------------------ portability */

/** The whole studio as one JSON blob, for moving between machines or people. */
export function exportStudio() {
  return JSON.stringify({ app: 'TesserCAD', kind: 'studio', version: 1, ...read() }, null, 2);
}

export function importStudio(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  if (raw.kind !== 'studio') throw new Error('Not a TesserCAD studio file');
  const next = {
    standards: { ...DEFAULT_STANDARDS, ...(raw.standards || {}) },
    decisions: Array.isArray(raw.decisions) ? raw.decisions.slice(0, MAX_DECISIONS) : [],
    macros: Array.isArray(raw.macros) ? raw.macros : [],
  };
  write(next);
  return next;
}
