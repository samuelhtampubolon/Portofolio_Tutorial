/**
 * Configurations: every size of a part, inside one file.
 *
 * A bracket that comes in six lengths is one design, and the filesystem makes
 * it six designs. Save-as for each variant and you get six files that drift
 * apart, six entries in every search result, and no way to tell which one is
 * the master. Nothing in the document says they are the same part, so nothing
 * can keep them consistent.
 *
 * A configuration is a named set of parameter values stored in the document
 * itself. The geometry, the feature tree and the relationships are shared by
 * every variant, because there is only one of each; switching a configuration
 * changes numbers and rebuilds. Six lengths is one file with six rows.
 *
 * Two design decisions worth stating.
 *
 * A configuration stores only the parameters it overrides. A variant that
 * changes the length and nothing else has one number in it, so a change to the
 * shared design reaches every variant automatically instead of having to be
 * applied six times. That is the whole point, and storing a full copy of every
 * parameter would quietly destroy it.
 *
 * The active configuration's values live in `doc.params` as usual, which means
 * every existing thing that reads parameters — the expression engine, the
 * inspector, the Doctor, the cost model, export — needs no knowledge of
 * configurations at all. Switching writes into params and rebuilds; nothing
 * downstream has a second code path to get wrong.
 */

const DEFAULT_ID = 'default';

/** The configuration block as it sits in a document. */
export function emptyConfigs() {
  return {
    active: DEFAULT_ID,
    list: [{ id: DEFAULT_ID, name: 'Default', overrides: {}, note: 'The design as drawn.' }],
  };
}

export function ensure(doc) {
  if (!doc.configs || !Array.isArray(doc.configs.list) || !doc.configs.list.length) {
    doc.configs = emptyConfigs();
  }
  if (!doc.configs.list.some(c => c.id === doc.configs.active)) {
    doc.configs.active = doc.configs.list[0].id;
  }
  return doc.configs;
}

export const activeConfig = (doc) => ensure(doc).list.find(c => c.id === doc.configs.active) || null;
export const configs = (doc) => ensure(doc).list;

/**
 * Switch to a configuration.
 *
 * The values of the configuration being left are captured first, so editing a
 * parameter while a variant is active edits *that variant* rather than silently
 * being lost on the next switch. This is the behaviour users expect and the one
 * that is easy to get wrong.
 */
export function activate(doc, id) {
  const cfg = ensure(doc);
  const target = cfg.list.find(c => c.id === id);
  if (!target) return false;

  const current = cfg.list.find(c => c.id === cfg.active);
  if (current && current.id !== DEFAULT_ID) capture(doc, current);

  cfg.active = id;
  apply(doc, target);
  return true;
}

/** Write a configuration's overrides into the live parameter list. */
export function apply(doc, cfg) {
  const base = cfg.id === DEFAULT_ID ? {} : cfg.overrides || {};
  for (const p of doc.params) {
    if (Object.prototype.hasOwnProperty.call(base, p.name)) {
      p.value = base[p.name];
    } else if (Object.prototype.hasOwnProperty.call(doc.configs.baseline || {}, p.name)) {
      // Restore the shared value for anything this variant does not override.
      p.value = doc.configs.baseline[p.name];
    }
  }
}

/** Record the parameters that differ from the baseline into this configuration. */
export function capture(doc, cfg) {
  const baseline = ensure(doc).baseline || {};
  const out = {};
  for (const p of doc.params) {
    if (!Object.prototype.hasOwnProperty.call(baseline, p.name)) continue;
    if (String(p.value) !== String(baseline[p.name])) out[p.name] = p.value;
  }
  cfg.overrides = out;
  return out;
}

/**
 * Freeze the current parameters as the shared baseline.
 *
 * Called whenever the default configuration is active and a parameter changes,
 * so "the design as drawn" tracks the design rather than the moment
 * configurations were first switched on.
 */
export function syncBaseline(doc) {
  const cfg = ensure(doc);
  if (cfg.active !== DEFAULT_ID) return;
  cfg.baseline = Object.fromEntries(doc.params.map(p => [p.name, p.value]));
}

export function addConfig(doc, name, { from = null } = {}) {
  const cfg = ensure(doc);
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const src = from ? cfg.list.find(c => c.id === from) : cfg.list.find(c => c.id === cfg.active);
  cfg.list.push({
    id, name: uniqueName(cfg.list, name || 'Variant'),
    overrides: { ...(src?.overrides || {}) },
    note: '',
  });
  return id;
}

export function removeConfig(doc, id) {
  const cfg = ensure(doc);
  if (id === DEFAULT_ID) return false;          // the shared design is not a variant
  cfg.list = cfg.list.filter(c => c.id !== id);
  if (cfg.active === id) activate(doc, DEFAULT_ID);
  return true;
}

export function renameConfig(doc, id, name) {
  const c = ensure(doc).list.find(x => x.id === id);
  if (!c) return false;
  c.name = uniqueName(ensure(doc).list.filter(x => x.id !== id), name);
  return true;
}

function uniqueName(list, name) {
  const taken = new Set(list.map(c => c.name));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

/**
 * The family, as a table: one row per configuration, one column per parameter
 * that any variant overrides. This is the view that makes a family legible, and
 * it is also exactly what a parts catalogue wants.
 */
export function familyTable(doc) {
  const cfg = ensure(doc);
  const baseline = cfg.baseline || Object.fromEntries(doc.params.map(p => [p.name, p.value]));
  const columns = [...new Set(cfg.list.flatMap(c => Object.keys(c.overrides || {})))].sort();
  const rows = cfg.list.map(c => ({
    id: c.id,
    name: c.name,
    active: c.id === cfg.active,
    note: c.note || '',
    values: Object.fromEntries(columns.map(k => [k, c.overrides?.[k] ?? baseline[k] ?? ''])),
  }));
  return { columns, rows, baseline };
}

export function familyCSV(doc) {
  const { columns, rows } = familyTable(doc);
  const head = ['Configuration', ...columns, 'Note'];
  const body = rows.map(r => [r.name, ...columns.map(k => r.values[k]), r.note]);
  return [head, ...body]
    .map(r => r.map(c => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(','))
    .join('\n');
}

export { DEFAULT_ID };
