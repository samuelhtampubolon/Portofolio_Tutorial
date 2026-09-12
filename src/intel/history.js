/**
 * Local version control for a design.
 *
 * The software world settled this thirty years ago and CAD never got the
 * benefit. Instead there are two bad options: a filename convention
 * ("assembly_rev7_final_FINAL.dwg"), which is a version control system with no
 * software in it; or a vendor's product lifecycle server, which wants a check-in
 * to rotate a bolt and a licence to exist.
 *
 * Neither is necessary. A TesserCAD document is plain JSON at every instant —
 * that is what makes undo a structuredClone and saving a stringify — and plain
 * JSON is exactly what a version control system knows how to handle. So this is
 * snapshots, branches and a real structural diff, entirely in the browser. No
 * server, no account, no check-in, no network.
 *
 * Three things it does that a filename cannot:
 *
 *   A diff that speaks CAD. Not "the file changed" and not a wall of JSON, but
 *   "plate_w 140 to 180, added Bolt hole, Bolt pattern count 4 to 6". That is
 *   the only form of history worth having, because it is the form you can read
 *   in a review six months later.
 *
 *   Branches, so an experiment costs nothing. Try the heavier variant on a
 *   branch, keep the trunk intact, and discard the branch if it was wrong.
 *
 *   Storage that stays honest about its limits. Snapshots are whole documents,
 *   not deltas, because a delta chain that cannot be replayed is worse than no
 *   history at all, and because localStorage is small enough that the right
 *   answer to running out is to say so and offer to prune. Both happen here.
 */
import { store } from '../core/doc.js';

const KEY = 'tessercad.vcs.v1';
const MAX_SNAPSHOTS = 40;
/** localStorage is typically 5MB; stop well short so the app can still save. */
const SOFT_LIMIT = 3.2e6;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      branches: raw.branches && typeof raw.branches === 'object' ? raw.branches : { main: [] },
      current: typeof raw.current === 'string' ? raw.current : 'main',
    };
  } catch {
    return { branches: { main: [] }, current: 'main' };
  }
}

function write(state) {
  const payload = JSON.stringify(state);
  if (payload.length > SOFT_LIMIT) return { ok: false, reason: 'full', bytes: payload.length };
  try {
    localStorage.setItem(KEY, payload);
    return { ok: true, bytes: payload.length };
  } catch {
    return { ok: false, reason: 'quota', bytes: payload.length };
  }
}

/* -------------------------------------------------------------- branches */

export function branches() {
  const s = read();
  return Object.keys(s.branches).map(name => ({
    name,
    current: name === s.current,
    count: s.branches[name].length,
    latest: s.branches[name][0]?.at || null,
  }));
}

export const currentBranch = () => read().current;

export function createBranch(name, { from = null } = {}) {
  const s = read();
  const key = uniqueBranch(s.branches, name || 'experiment');
  const src = from || s.current;
  // A branch starts from where you are, so the experiment has the history
  // behind it rather than beginning from nothing.
  s.branches[key] = [...(s.branches[src] || [])];
  s.current = key;
  write(s);
  return key;
}

export function switchBranch(name) {
  const s = read();
  if (!s.branches[name]) return false;
  s.current = name;
  write(s);
  return true;
}

export function deleteBranch(name) {
  const s = read();
  if (name === 'main' || !s.branches[name]) return false;
  delete s.branches[name];
  if (s.current === name) s.current = 'main';
  write(s);
  return true;
}

function uniqueBranch(map, name) {
  const base = String(name).trim().replace(/\s+/g, '-').toLowerCase() || 'branch';
  if (!map[base]) return base;
  let i = 2;
  while (map[`${base}-${i}`]) i++;
  return `${base}-${i}`;
}

/* ------------------------------------------------------------- snapshots */

/**
 * Save the current document as a named version on the current branch.
 * @returns {{ ok: boolean, id?: string, reason?: string, pruned?: number }}
 */
export function commitVersion(message, { doc = store.doc } = {}) {
  const s = read();
  const branch = s.branches[s.current] || (s.branches[s.current] = []);
  const entry = {
    id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    message: String(message || 'Snapshot').slice(0, 160),
    name: doc.meta.name,
    summary: summarise(doc),
    doc: structuredClone(doc),
  };
  branch.unshift(entry);

  let pruned = 0;
  while (branch.length > MAX_SNAPSHOTS) { branch.pop(); pruned++; }

  let res = write(s);
  // Out of room: drop the oldest versions until it fits, and report how many
  // went. Silently failing to save a version is the one behaviour a version
  // control system must never have.
  while (!res.ok && branch.length > 1) {
    branch.pop(); pruned++;
    res = write(s);
  }
  if (!res.ok) return { ok: false, reason: res.reason, pruned };
  return { ok: true, id: entry.id, pruned, bytes: res.bytes };
}

export function versions({ branch = null } = {}) {
  const s = read();
  const b = branch || s.current;
  return (s.branches[b] || []).map(({ doc, ...meta }) => meta);
}

export function getVersion(id, { branch = null } = {}) {
  const s = read();
  const b = branch || s.current;
  return (s.branches[b] || []).find(v => v.id === id) || null;
}

export function deleteVersion(id) {
  const s = read();
  const b = s.branches[s.current] || [];
  s.branches[s.current] = b.filter(v => v.id !== id);
  write(s);
}

export function restore(id) {
  const v = getVersion(id);
  if (!v) return false;
  store.load(structuredClone(v.doc), { markClean: false });
  return true;
}

export function clearAll() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

export function usage() {
  const s = read();
  const bytes = JSON.stringify(s).length;
  return {
    bytes,
    limit: SOFT_LIMIT,
    percent: (bytes / SOFT_LIMIT) * 100,
    versions: Object.values(s.branches).reduce((n, b) => n + b.length, 0),
    branches: Object.keys(s.branches).length,
  };
}

function summarise(doc) {
  return {
    features: doc.features.length,
    params: doc.params.length,
    entities: doc.draw?.entities?.length || 0,
    configs: doc.configs?.list?.length || 1,
  };
}

/* ------------------------------------------------------------------ diff */

/**
 * Compare two documents and describe the change the way a person would.
 *
 * Features are matched by id first and by name second, so a rename reads as a
 * rename rather than as a delete plus an add. That single detail is most of the
 * difference between a diff that is worth reading and one that is not.
 *
 * @returns {{ params: object[], features: object[], meta: object[], counts: object }}
 */
export function diff(before, after) {
  const params = diffParams(before.params || [], after.params || []);
  const features = diffFeatures(before.features || [], after.features || []);
  const meta = diffMeta(before, after);

  const counts = {
    added: features.filter(f => f.kind === 'added').length,
    removed: features.filter(f => f.kind === 'removed').length,
    changed: features.filter(f => f.kind === 'changed').length + params.filter(p => p.kind === 'changed').length,
    params: params.length,
  };
  return { params, features, meta, counts, empty: !params.length && !features.length && !meta.length };
}

function diffParams(a, b) {
  const byName = (list) => new Map(list.map(p => [p.name, p]));
  const A = byName(a), B = byName(b);
  const out = [];
  for (const [name, p] of B) {
    const q = A.get(name);
    if (!q) { out.push({ kind: 'added', name, to: p.value }); continue; }
    if (String(q.value) !== String(p.value)) out.push({ kind: 'changed', name, from: q.value, to: p.value });
  }
  for (const [name, p] of A) if (!B.has(name)) out.push({ kind: 'removed', name, from: p.value });
  return out;
}

function diffFeatures(a, b) {
  const A = new Map(a.map(f => [f.id, f]));
  const B = new Map(b.map(f => [f.id, f]));
  const out = [];
  const matched = new Set();

  for (const [id, f] of B) {
    const g = A.get(id);
    if (!g) continue;
    matched.add(id);
    const changes = featureChanges(g, f);
    if (changes.length) out.push({ kind: 'changed', name: f.name, was: g.name, type: f.type, changes });
  }

  // Anything unmatched by id: try by name, so a rebuilt-but-same-name feature
  // reads as a change rather than a delete and an add.
  const leftoverA = [...A.values()].filter(f => !matched.has(f.id));
  const leftoverB = [...B.values()].filter(f => !matched.has(f.id));
  const byName = new Map(leftoverA.map(f => [f.name, f]));

  for (const f of leftoverB) {
    const g = byName.get(f.name);
    if (g) {
      byName.delete(f.name);
      const changes = featureChanges(g, f);
      out.push(changes.length
        ? { kind: 'changed', name: f.name, type: f.type, changes }
        : { kind: 'rebuilt', name: f.name, type: f.type, changes: [] });
    } else {
      out.push({ kind: 'added', name: f.name, type: f.type, changes: [] });
    }
  }
  for (const g of byName.values()) out.push({ kind: 'removed', name: g.name, type: g.type, changes: [] });
  return out;
}

function featureChanges(a, b) {
  const out = [];
  if (a.name !== b.name) out.push({ what: 'name', from: a.name, to: b.name });
  if (a.type !== b.type) out.push({ what: 'type', from: a.type, to: b.type });
  if (a.material !== b.material) out.push({ what: 'material', from: a.material, to: b.material });
  if (!!a.suppressed !== !!b.suppressed) out.push({ what: 'suppressed', from: !!a.suppressed, to: !!b.suppressed });

  for (const k of new Set([...Object.keys(a.params || {}), ...Object.keys(b.params || {})])) {
    const x = a.params?.[k], y = b.params?.[k];
    if (String(x) !== String(y)) out.push({ what: k, from: x, to: y });
  }
  for (const axis of ['pos', 'rot', 'scale']) {
    const x = a.transform?.[axis] || [], y = b.transform?.[axis] || [];
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ what: axis, from: x.join(', '), to: y.join(', ') });
  }
  if (JSON.stringify(a.inputs || []) !== JSON.stringify(b.inputs || [])) {
    out.push({ what: 'inputs', from: `${(a.inputs || []).length} bodies`, to: `${(b.inputs || []).length} bodies` });
  }
  return out;
}

function diffMeta(a, b) {
  const out = [];
  for (const k of ['name', 'units', 'author']) {
    if ((a.meta?.[k] ?? '') !== (b.meta?.[k] ?? '')) {
      out.push({ what: k, from: a.meta?.[k] ?? '', to: b.meta?.[k] ?? '' });
    }
  }
  return out;
}

/** A one-line description of a diff, for a list row. */
export function diffLine(d) {
  if (d.empty) return 'No change';
  const bits = [];
  if (d.counts.added) bits.push(`+${d.counts.added}`);
  if (d.counts.removed) bits.push(`−${d.counts.removed}`);
  if (d.counts.changed) bits.push(`${d.counts.changed} changed`);
  return bits.join(' · ') || 'Metadata only';
}
