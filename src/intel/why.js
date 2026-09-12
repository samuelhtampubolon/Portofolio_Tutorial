/**
 * The why-tutor.
 *
 * Every CAD package has documentation and none of it is read at the moment it
 * would matter. Help explains which button does what; the thing a student or a
 * new engineer actually lacks is knowing *why* one choice is better than another
 * at the point where they are about to make it.
 *
 * So this is not a tour and not a tooltip. Lessons are bound to observable
 * states of the document, they surface at most one at a time, they surface only
 * when their condition is genuinely true right now, and each one is dismissed
 * for good once it has been read. A lesson that fires twice has failed.
 *
 * Precedence is deliberate: a Doctor finding always outranks a general lesson,
 * because a concrete problem in front of you teaches better than a principle in
 * the abstract. The tutor is an explanation layer over the checks rather than a
 * separate stream of advice competing with them.
 */
import { MATERIALS } from '../core/doc.js';
import { processOf } from './process.js';
import { standards } from './standards.js';

const SEEN_KEY = 'tessercad.why.seen.v1';

function seen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}

function markSeen(id) {
  const s = seen();
  s.add(id);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s])); } catch { /* optional */ }
}

export function resetSeen() {
  try { localStorage.removeItem(SEEN_KEY); } catch { /* optional */ }
}

/**
 * A lesson is { id, title, body, when(ctx) }.
 *
 * `when` must be cheap: this runs after every rebuild. It must also be specific
 * — a condition that is true of most documents is a banner, not a lesson.
 */
const LESSONS = [
  {
    id: 'parameters',
    title: 'Why type an expression instead of a number',
    body: 'You have several features carrying the same dimension. Name it once as a parameter and reference it, and the model stops being a drawing of one part and becomes a description of every part in the family. This is the whole reason a feature tree exists, and it is the difference between changing a design in one place and changing it in eleven.',
    when: (c) => c.doc.features.length >= 3 && c.doc.params.length <= 1 && c.repeatedDimension,
  },
  {
    id: 'boolean-order',
    title: 'Why boolean order matters',
    body: 'Subtract takes the first input and removes the rest, so swapping the inputs of a subtract gives you the cutter instead of the part. Union and intersect do not care about order. If a boolean produced something inside-out, check which body is listed first before you change any geometry.',
    when: (c) => c.doc.features.some(f => f.type === 'boolean' && f.params.op === 'subtract'),
  },
  {
    id: 'tessellation',
    title: 'Why segment counts cost more than they look',
    body: 'A cylinder at 128 segments carries roughly eight times the triangles of one at 16, and every boolean it touches pays that cost again on both sides. Curved surfaces only need enough segments for the tolerance you are working to: at 48, a 20mm radius is within 0.02mm of true. Reach for the segment count before you reach for anything else when a rebuild gets slow.',
    when: (c) => c.build.stats.tris > 30000,
  },
  {
    id: 'wall-thickness',
    title: 'Why the process decides the minimum wall, not the material',
    body: 'A 0.4mm wall is fine in injection-moulded ABS and impossible in sand casting, in the same material. The limit is set by how the material gets into the shape: what can flow, what can cool without warping, what a cutter can reach without deflecting. This is why the Doctor asks which process you are using before it tells you anything about your walls.',
    when: (c) => c.doc.features.some(f => f.type === 'tube'),
  },
  {
    id: 'machining-cost',
    title: 'Why a lighter machined part often costs more',
    body: 'Machining is billed on the block you start from and the time spent removing everything that is not the part. Hollowing a part out makes it lighter and slower to cut, so the price goes up. Additive is the opposite: you pay for what you keep. Which way round that is should change how you design, not just who you send it to.',
    when: (c) => c.process.kind === 'subtractive' && c.build.stats.bodies > 0,
  },
  {
    id: 'draft-angle',
    title: 'Why moulded and cast parts need draft',
    body: 'A vertical wall in a mould has to slide out against friction along its whole length, and it will gall, drag or stick. One to two degrees of draft on every face perpendicular to the parting line costs almost nothing in function and is the difference between a tool that works and one that does not. Add it early: retrofitting draft usually means re-cutting the model.',
    when: (c) => c.process.kind === 'formative',
  },
  {
    id: 'mass-vs-weight',
    title: 'Why this says mass and not weight',
    body: 'The panel reports kilograms, which is mass and does not change with where the part is. Weight is a force and would be in newtons. It matters here because every load you enter in a design brief is a force: a 10kg part hanging off a bracket applies about 98N, not 10.',
    when: (c) => c.build.stats.mass > 0.5,
  },
  {
    id: 'watertight',
    title: 'Why a mesh has to be closed',
    body: 'A solid is a surface that separates an inside from an outside. If there is a hole anywhere in it, "inside" has no meaning, so volume, mass, centre of gravity and every slicer path become undefined. Most exporters will write an open mesh out happily, which is why this fails at the machine rather than at the export dialog.',
    when: (c) => c.doc.features.some(f => f.type === 'mesh'),
  },
  {
    id: 'safety-factor',
    title: 'What a safety factor is actually covering',
    body: 'It is not a fudge for bad arithmetic. It covers the load being larger than specified, the material being at the bottom of its spec, the stress concentration at a corner nobody modelled, and the part being made slightly wrong. Two to three is normal for static, well-understood loads; anything cyclic, shock-loaded or life-critical needs more and needs a fatigue calculation this application does not do.',
    when: (c) => !!c.doc.meta.notes && /safety factor/i.test(c.doc.meta.notes),
  },
  {
    id: 'undo-history',
    title: 'Why the feature tree beats undo',
    body: 'Undo walks backwards through time and takes everything after it along. A feature tree lets you reach into the middle of the history, change one dimension, and rebuild forward with everything else intact. That is why it is worth putting a dimension in a feature rather than dragging geometry into place: dragging is undoable, features are editable.',
    when: (c) => c.doc.features.length >= 5,
  },
];

/**
 * Pick the single most relevant unseen lesson, or null.
 *
 * @param {object} doc
 * @param {object} build
 * @param {object} report  the Doctor's output, so findings can take precedence
 */
export function nextLesson(doc, build, report = null) {
  const s = standards();
  const done = seen();

  // A live finding always wins: it is concrete, it is on screen, and it is the
  // moment the explanation is worth most.
  const finding = report?.issues.find(i => i.why && i.severity >= 2 && !done.has(`finding:${i.check}`));
  if (finding) {
    return {
      id: `finding:${finding.check}`,
      kind: 'finding',
      title: finding.title,
      body: finding.why,
      severity: finding.severity,
    };
  }

  const ctx = {
    doc, build,
    process: processOf(doc.studio?.process || s.process),
    repeatedDimension: hasRepeatedDimension(doc),
  };

  for (const l of LESSONS) {
    if (done.has(l.id)) continue;
    let ok = false;
    try { ok = !!l.when(ctx); } catch { ok = false; }
    if (ok) return { id: l.id, kind: 'lesson', title: l.title, body: l.body };
  }
  return null;
}

export function dismissLesson(id) { markSeen(id); }

export function progress() {
  const done = seen();
  const total = LESSONS.length;
  const read = LESSONS.filter(l => done.has(l.id)).length;
  return { read, total };
}

/** Every lesson, for the help dialog, with whether it has been seen. */
export function allLessons() {
  const done = seen();
  return LESSONS.map(l => ({ id: l.id, title: l.title, body: l.body, read: done.has(l.id) }));
}

/**
 * Does the same length appear as a literal in three or more places?
 * That is the signal that a parameter is missing, and it is much more specific
 * than "this document has no parameters".
 */
function hasRepeatedDimension(doc) {
  const counts = new Map();
  for (const f of doc.features) {
    for (const v of Object.values(f.params)) {
      if (typeof v !== 'number' || v === 0 || v === 1) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  for (const n of counts.values()) if (n >= 3) return true;
  return false;
}

export { MATERIALS };
