/**
 * Three-way merge for a design.
 *
 * Version control gave us branches, and branches are worthless without a merge.
 * CAD has neither: the shared model is a mutex, and two people who edited the
 * same assembly resolve it by one of them redoing their work. The usual excuse
 * is that geometry cannot be merged, which is true of a binary kernel dump and
 * false of a feature tree. A feature tree is an ordered list of small records.
 * That is the thing git merges all day.
 *
 * So this merges the tree, not the triangles. Two people who changed different
 * parameters of different features get both changes with no interaction at all.
 * Two people who changed the same parameter get a conflict that names the
 * feature, the parameter, and both values, which is a question a human can
 * answer in two seconds instead of an afternoon.
 *
 * What it will not do is guess. There is no averaging of two numbers, no
 * "newest wins" on a dimension somebody chose deliberately, and no silent drop
 * of a deleted feature the other side edited. Every case where the answer is
 * genuinely unknown becomes a conflict with both candidates attached.
 */

/** A conflict the user has to answer. `pick` is set by `resolve`. */
function conflict(kind, path, label, ours, theirs, note = '') {
  return { id: `c${path.replace(/[^a-z0-9]+/gi, '')}${kind}`, kind, path, label, ours, theirs, note, pick: null };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ------------------------------------------------------- scalar three-way */

/**
 * The whole of three-way merging in five lines: if the two sides agree there is
 * nothing to decide; if only one side moved, take the side that moved; if both
 * moved differently, ask.
 */
function mergeValue(base, ours, theirs) {
  if (same(ours, theirs)) return { value: ours, state: 'agree' };
  if (same(base, ours)) return { value: theirs, state: 'theirs' };
  if (same(base, theirs)) return { value: ours, state: 'ours' };
  return { value: ours, state: 'conflict' };
}

/* -------------------------------------------------------- sequence merge */

/** Longest common subsequence of two id arrays, returned as index pairs. */
function lcs(a, b) {
  const n = a.length, m = b.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = a[i] === b[j]
        ? dp[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Three-way merge of the feature order.
 *
 * Order is not cosmetic in a history tree: a shell after a fillet is a
 * different part from a fillet after a shell. So the order is merged as a
 * sequence rather than sorted.
 *
 * Regions both sides left alone pass through. Regions one side rearranged take
 * that side. Where both sides inserted at the same point, the insertions are
 * composed, ours first: each side's features still sit where that side put
 * them relative to the existing tree, so composing satisfies both intents and
 * loses nothing. The one case that is a genuine disagreement, and so a
 * conflict, is both sides placing the same features in different orders.
 *
 * Returns two sequences. `order` is the merge proper, with deletions honoured.
 * `union` keeps every id either side still has, which is what a caller needs
 * when a delete on one side collides with an edit on the other and the
 * question has to be put to the user rather than answered by dropping the
 * feature.
 */
export function mergeOrder(base, ours, theirs) {
  const conflicts = [];
  const withOurs = lcs(base, ours);
  const withTheirs = lcs(base, theirs);
  const anchorOurs = new Map(withOurs.map(([bi, oi]) => [bi, oi]));
  const anchorTheirs = new Map(withTheirs.map(([bi, ti]) => [bi, ti]));

  // Base indices both sides kept, in base order: the stable spine.
  const spine = [];
  for (let i = 0; i < base.length; i++) {
    if (anchorOurs.has(i) && anchorTheirs.has(i)) spine.push(i);
  }

  const out = [];
  const emitted = new Set();
  const push = (id) => { if (id != null && !emitted.has(id)) { emitted.add(id); out.push(id); } };

  // Walk the spine, and between each pair of anchors take whichever side
  // actually inserted or reordered something in that gap.
  let oPrev = -1, tPrev = -1;
  const gap = (list, from, to) => list.slice(from + 1, to);
  for (const bi of [...spine, null]) {
    const oAt = bi == null ? ours.length : anchorOurs.get(bi);
    const tAt = bi == null ? theirs.length : anchorTheirs.get(bi);
    const oGap = gap(ours, oPrev, oAt);
    const tGap = gap(theirs, tPrev, tAt);
    if (same(oGap, tGap)) {
      oGap.forEach(push);
    } else if (!oGap.length) {
      tGap.forEach(push);
    } else if (!tGap.length) {
      oGap.forEach(push);
    } else if (same([...oGap].sort(), [...tGap].sort())) {
      // The same features, sequenced differently. Sequence changes the part,
      // so this is the one ordering question the merge cannot answer.
      conflicts.push(conflict('order', `features.order.${bi ?? 'end'}`,
        'Feature order', oGap, tGap,
        'Both branches placed the same features in a different order.'));
      oGap.forEach(push);
    } else {
      // Different features at the same point. Compose them.
      oGap.forEach(push);
      tGap.forEach(push);
    }
    if (bi != null) push(base[bi]);
    oPrev = oAt; tPrev = tAt;
  }

  // Anything either side still holds that the walk did not reach (added inside
  // a region the other side deleted) goes on the end rather than vanishing.
  for (const id of ours) push(id);
  for (const id of theirs) push(id);

  // A feature present in the base and gone from either side was deleted, and a
  // deletion is a decision. `order` honours it; `union` keeps it so a caller
  // can notice a delete that collided with an edit.
  const oSet = new Set(ours), tSet = new Set(theirs);
  const dropped = base.filter(id => !oSet.has(id) || !tSet.has(id));
  const gone = new Set(dropped);
  return { order: out.filter(id => !gone.has(id)), union: out, dropped, conflicts };
}

/* --------------------------------------------------------------- features */

const FEATURE_FIELDS = ['name', 'type', 'material', 'suppressed', 'visible', 'profile', 'data'];
const AXES = ['pos', 'rot', 'scale'];

function mergeFeature(base, ours, theirs, { policy }) {
  const conflicts = [];
  const out = structuredClone(ours);
  const label = ours.name || theirs.name || base?.name || ours.type;

  const take = (r, path, what, a, b) => {
    if (r.state !== 'conflict') return r.value;
    conflicts.push(conflict('field', path, `${label}: ${what}`, a, b));
    return policy === 'theirs' ? b : a;
  };

  for (const k of FEATURE_FIELDS) {
    const r = mergeValue(base?.[k], ours[k], theirs[k]);
    out[k] = take(r, `${ours.id}.${k}`, k, ours[k], theirs[k]);
  }

  // Parameters merge key by key, which is the whole point: one person raising
  // a radius and another lengthening the same block is not a conflict.
  out.params = { ...ours.params };
  const keys = new Set([...Object.keys(base?.params || {}), ...Object.keys(ours.params || {}), ...Object.keys(theirs.params || {})]);
  for (const k of keys) {
    const b = base?.params?.[k], o = ours.params?.[k], t = theirs.params?.[k];
    const r = mergeValue(b, o, t);
    if (r.state === 'conflict') {
      conflicts.push(conflict('param', `${ours.id}.params.${k}`, `${label}: ${k}`, o, t));
      out.params[k] = policy === 'theirs' ? t : o;
    } else if (r.value === undefined) {
      delete out.params[k];
    } else {
      out.params[k] = r.value;
    }
  }

  // Transforms merge per axis, not per component: half of one branch's
  // rotation and half of the other's is a pose neither person designed.
  out.transform = { ...ours.transform };
  for (const axis of AXES) {
    const r = mergeValue(base?.transform?.[axis], ours.transform?.[axis], theirs.transform?.[axis]);
    out.transform[axis] = take(r, `${ours.id}.${axis}`, axis, ours.transform?.[axis], theirs.transform?.[axis]);
  }

  const app = mergeValue(base?.appearance, ours.appearance, theirs.appearance);
  // Colour is not design intent. Take ours rather than stopping a merge over it.
  out.appearance = app.state === 'conflict' ? ours.appearance : app.value;

  const inputs = mergeValue(base?.inputs, ours.inputs, theirs.inputs);
  out.inputs = take(inputs, `${ours.id}.inputs`, 'inputs', ours.inputs, theirs.inputs);

  return { feature: out, conflicts };
}

/* ----------------------------------------------------------------- params */

function mergeParams(base, ours, theirs, { policy }) {
  const conflicts = [];
  const key = (list) => new Map((list || []).map(p => [p.name, p]));
  const B = key(base), O = key(ours), T = key(theirs);
  const names = [...new Set([...(ours || []).map(p => p.name), ...(theirs || []).map(p => p.name), ...(base || []).map(p => p.name)])];
  const out = [];

  for (const name of names) {
    const b = B.get(name), o = O.get(name), t = T.get(name);
    if (!o && !t) continue;                                   // deleted by both
    if (o && !t) { if (!b || !same(b, o)) out.push(o); continue; }   // theirs deleted
    if (!o && t) { if (!b || !same(b, t)) out.push(t); continue; }   // ours deleted
    const value = mergeValue(b?.value, o.value, t.value);
    const note = mergeValue(b?.note, o.note, t.note);
    if (value.state === 'conflict') {
      conflicts.push(conflict('param', `params.${name}`, `Parameter ${name}`, o.value, t.value));
    }
    out.push({
      ...o,
      value: value.state === 'conflict' ? (policy === 'theirs' ? t.value : o.value) : value.value,
      note: note.state === 'conflict' ? o.note : note.value,
    });
  }
  return { params: out, conflicts };
}

/* ------------------------------------------------------------------ lists */

/** Merge an id-keyed list (draft entities, layers, configurations). */
function mergeById(base, ours, theirs, { policy, label }) {
  const conflicts = [];
  const map = (list) => new Map((list || []).map(x => [x.id, x]));
  const B = map(base), O = map(ours), T = map(theirs);
  const ids = mergeOrder((base || []).map(x => x.id), (ours || []).map(x => x.id), (theirs || []).map(x => x.id));
  const out = [];
  for (const id of ids.union) {
    const b = B.get(id), o = O.get(id), t = T.get(id);
    if (!o && !t) continue;
    if (o && !t) { if (!b || !same(b, o)) out.push(o); continue; }
    if (!o && t) { if (!b || !same(b, t)) out.push(t); continue; }
    const r = mergeValue(b, o, t);
    if (r.state === 'conflict') {
      conflicts.push(conflict('item', `${label}.${id}`, `${label}: ${o.name || id}`, o, t));
      out.push(policy === 'theirs' ? t : o);
    } else out.push(r.value);
  }
  return { list: out, conflicts };
}

/* ----------------------------------------------------------------- merge */

/**
 * Merge two documents that share a common ancestor.
 *
 * @param {object} base    the version both branches started from
 * @param {object} ours    this branch
 * @param {object} theirs  the branch being merged in
 * @param {{policy?: 'ours'|'theirs'}} opts  which side a conflict falls back
 *        to so the result is always a loadable document. The conflict is still
 *        reported either way; the policy only decides what sits in the
 *        document until somebody answers it.
 */
export function mergeDocuments(base, ours, theirs, { policy = 'ours' } = {}) {
  if (!base || !ours || !theirs) throw new Error('A three-way merge needs a base, ours and theirs');
  const conflicts = [];
  const merged = structuredClone(ours);

  /* meta: name and notes are text, units are not negotiable */
  merged.meta = { ...ours.meta };
  for (const k of ['name', 'author', 'notes', 'units']) {
    const r = mergeValue(base.meta?.[k], ours.meta?.[k], theirs.meta?.[k]);
    if (r.state === 'conflict') {
      conflicts.push(conflict('meta', `meta.${k}`, `Document ${k}`, ours.meta?.[k], theirs.meta?.[k],
        k === 'units' ? 'Two different display units. Everything is stored in millimetres, so this only changes what is shown.' : ''));
      merged.meta[k] = policy === 'theirs' ? theirs.meta?.[k] : ours.meta?.[k];
    } else merged.meta[k] = r.value;
  }
  merged.meta.modified = new Date().toISOString();

  /* parameters */
  const p = mergeParams(base.params, ours.params, theirs.params, { policy });
  merged.params = p.params;
  conflicts.push(...p.conflicts);

  /* features: order first, then each feature's fields */
  const bIds = (base.features || []).map(f => f.id);
  const oIds = (ours.features || []).map(f => f.id);
  const tIds = (theirs.features || []).map(f => f.id);
  const ord = mergeOrder(bIds, oIds, tIds);
  conflicts.push(...ord.conflicts);

  const B = new Map((base.features || []).map(f => [f.id, f]));
  const O = new Map((ours.features || []).map(f => [f.id, f]));
  const T = new Map((theirs.features || []).map(f => [f.id, f]));
  const features = [];
  for (const id of ord.union) {
    const b = B.get(id), o = O.get(id), t = T.get(id);
    if (!o && !t) continue;                       // both deleted it, agreed
    if (o && !t) {
      // They deleted it. If we also edited it, that is a real question.
      if (b && !same(b, o)) {
        conflicts.push(conflict('delete', `${id}.exists`, `${o.name}: kept here, deleted there`, o, null,
          'One branch deleted this feature while the other edited it.'));
        if (policy !== 'theirs') features.push(o);
      } else if (!b) features.push(o);            // we added it
      continue;
    }
    if (!o && t) {
      if (b && !same(b, t)) {
        conflicts.push(conflict('delete', `${id}.exists`, `${t.name}: deleted here, kept there`, null, t,
          'One branch deleted this feature while the other edited it.'));
        if (policy === 'theirs') features.push(t);
      } else if (!b) features.push(t);            // they added it
      continue;
    }
    const m = mergeFeature(b, o, t, { policy });
    features.push(m.feature);
    conflicts.push(...m.conflicts);
  }
  merged.features = features;

  /* drafting */
  merged.draw = { ...ours.draw };
  for (const part of ['layers', 'entities']) {
    const r = mergeById(base.draw?.[part], ours.draw?.[part], theirs.draw?.[part], { policy, label: `draw.${part}` });
    merged.draw[part] = r.list;
    conflicts.push(...r.conflicts);
  }
  const active = mergeValue(base.draw?.activeLayer, ours.draw?.activeLayer, theirs.draw?.activeLayer);
  merged.draw.activeLayer = active.state === 'conflict' ? ours.draw?.activeLayer : active.value;

  /* configurations */
  if (ours.configs || theirs.configs) {
    const r = mergeById(base.configs?.list, ours.configs?.list, theirs.configs?.list, { policy, label: 'configs' });
    merged.configs = { ...(ours.configs || {}), list: r.list };
    conflicts.push(...r.conflicts);
  }

  /* simulation: merge the bodies and settings, per field */
  if (ours.sim || theirs.sim) {
    merged.sim = structuredClone(ours.sim || theirs.sim);
    for (const k of Object.keys({ ...(ours.sim || {}), ...(theirs.sim || {}) })) {
      if (Array.isArray(ours.sim?.[k]) && ours.sim[k][0]?.id) {
        const r = mergeById(base.sim?.[k], ours.sim[k], theirs.sim?.[k], { policy, label: `sim.${k}` });
        merged.sim[k] = r.list;
        conflicts.push(...r.conflicts);
      } else {
        const r = mergeValue(base.sim?.[k], ours.sim?.[k], theirs.sim?.[k]);
        merged.sim[k] = r.state === 'conflict' ? (policy === 'theirs' ? theirs.sim[k] : ours.sim[k]) : r.value;
      }
    }
  }

  /* the viewport is a preference, not a design. Ours wins, silently. */
  merged.view = structuredClone(ours.view || theirs.view);

  const stats = {
    features: merged.features.length,
    fromOurs: merged.features.filter(f => !B.has(f.id) && O.has(f.id)).length,
    fromTheirs: merged.features.filter(f => !B.has(f.id) && !O.has(f.id)).length,
    deleted: bIds.filter(id => !merged.features.some(f => f.id === id)).length,
    params: merged.params.length,
    conflicts: conflicts.length,
  };
  return { merged, conflicts, stats, clean: conflicts.length === 0, policy };
}

/* ------------------------------------------------------------- resolution */

/**
 * Apply the user's answers. `picks` maps conflict id to 'ours' | 'theirs'.
 * Rerunning the merge with a policy would only flip every conflict at once,
 * so the picks are written into the merged document one at a time instead.
 */
export function resolve(result, picks = {}) {
  const merged = structuredClone(result.merged);
  const conflicts = result.conflicts.map(c => ({ ...c }));
  const byId = new Map(merged.features.map(f => [f.id, f]));

  for (const c of conflicts) {
    const pick = picks[c.id];
    if (pick !== 'ours' && pick !== 'theirs') continue;
    c.pick = pick;
    const want = pick === 'ours' ? c.ours : c.theirs;
    const [head, ...rest] = c.path.split('.');

    if (head === 'meta') { merged.meta[rest[0]] = want; continue; }
    if (head === 'params') {
      const p = merged.params.find(x => x.name === rest[0]);
      if (p) p.value = want;
      continue;
    }
    if (head === 'features') continue;            // order conflicts are resolved by reorder()
    if (head === 'draw' || head === 'configs' || head === 'sim') continue;

    const f = byId.get(head);
    if (!f) continue;
    if (c.kind === 'delete') {
      if (pick === 'theirs' && c.theirs == null) merged.features = merged.features.filter(x => x.id !== head);
      else if (pick === 'ours' && c.ours == null) merged.features = merged.features.filter(x => x.id !== head);
      else if (want) byId.set(head, Object.assign(f, want));
      continue;
    }
    if (rest[0] === 'params') { f.params[rest[1]] = want; continue; }
    if (AXES.includes(rest[0])) { f.transform[rest[0]] = want; continue; }
    f[rest[0]] = want;
  }

  const open = conflicts.filter(c => !c.pick);
  return { ...result, merged, conflicts, clean: open.length === 0, open: open.length };
}

/** Set the feature order explicitly, for answering an order conflict. */
export function reorder(result, ids) {
  const merged = structuredClone(result.merged);
  const byId = new Map(merged.features.map(f => [f.id, f]));
  const seen = new Set();
  const out = [];
  for (const id of ids) { const f = byId.get(id); if (f && !seen.has(id)) { seen.add(id); out.push(f); } }
  for (const f of merged.features) if (!seen.has(f.id)) out.push(f);
  merged.features = out;
  return { ...result, merged };
}

/* ---------------------------------------------------------------- reports */

/** One readable line per conflict, for a list the user works down. */
export function conflictLine(c) {
  const show = (v) => {
    if (v == null) return 'deleted';
    if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? `${v.length} items` : `[${v.join(', ')}]`;
    if (typeof v === 'object') return v.name || 'changed';
    return String(v);
  };
  return `${c.label}: here ${show(c.ours)}, there ${show(c.theirs)}`;
}

export function mergeSummary(result) {
  const { stats, conflicts } = result;
  const byKind = {};
  for (const c of conflicts) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  return {
    clean: result.clean,
    headline: result.clean
      ? `Merged cleanly: ${stats.fromTheirs} feature${stats.fromTheirs === 1 ? '' : 's'} brought in, ${stats.features} total`
      : `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} to answer`,
    stats, byKind,
    lines: conflicts.map(conflictLine),
  };
}

/**
 * Find the newest snapshot two branches share, which is the base a three-way
 * merge needs. Branches here are created by copying a version list, so the
 * shared prefix is a genuine common ancestry rather than a guess.
 */
export function commonAncestor(oursVersions, theirsVersions) {
  const theirIds = new Set((theirsVersions || []).map(v => v.id));
  for (const v of oursVersions || []) if (theirIds.has(v.id)) return v;
  return null;
}

/**
 * What a merge would do, without doing it. Cheap enough to run while the user
 * hovers a branch in the list.
 */
export function previewMerge(base, ours, theirs) {
  try {
    const r = mergeDocuments(base, ours, theirs);
    return { ok: true, ...mergeSummary(r) };
  } catch (e) {
    return { ok: false, headline: e.message, stats: null, byKind: {}, lines: [] };
  }
}
