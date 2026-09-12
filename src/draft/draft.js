/**
 * The Draft workspace — a 2D drafting board in the AutoCAD idiom.
 *
 * Canvas2D rather than WebGL: 2D drafting is line work, and Canvas2D gives
 * crisp hairlines at any zoom, real dashed patterns and cheap text without a
 * font atlas. Entities live in `store.doc.draw` and can be handed to the
 * modelling workspace as extrude/revolve profiles.
 */
import { bus, T } from '../core/bus.js';
import { store, uid, UNITS, toDisplay } from '../core/doc.js';
import { entityToPath } from '../core/geometry.js';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * The entity arithmetic lives next door in entity.js and is imported, not
 * re-exported. A re-export here would let a caller reach entity geometry
 * through the canvas engine, which is the coupling the split was made to
 * remove: a module that only needs to measure a rectangle has no business
 * loading a drafting board to do it. Callers import from entity.js directly.
 */
import {
  fmt, dist, translateEntity, entityPoints, entityBBox, distanceToEntity,
  offsetEntity, offsetDistanceFor, nearestOnEntity, segIntersect,
  pointLineSignedDistance, arcFrom3,
} from './entity.js';

export const DRAW_TOOLS = [
  { id: 'select', label: 'Select', glyph: '⬈', key: 'Esc' },
  { id: 'line', label: 'Line', glyph: '╱', key: 'L' },
  { id: 'polyline', label: 'Polyline', glyph: '⌒', key: 'P' },
  { id: 'rect', label: 'Rectangle', glyph: '▭', key: 'R' },
  { id: 'circle', label: 'Circle', glyph: '◯', key: 'C' },
  { id: 'arc', label: 'Arc', glyph: '◜', key: 'A' },
  { id: 'ellipse', label: 'Ellipse', glyph: '⬭', key: 'E' },
  { id: 'polygon', label: 'Polygon', glyph: '⬡', key: 'G' },
  { id: 'spline', label: 'Spline', glyph: '∿', key: 'S' },
  { id: 'point', label: 'Point', glyph: '·', key: '' },
  { id: 'text', label: 'Text', glyph: 'T', key: 'X' },
  { id: 'dimLinear', label: 'Linear dim', glyph: '↔', key: 'D' },
  { id: 'dimAligned', label: 'Aligned dim', glyph: '⤡', key: '' },
  { id: 'dimRadial', label: 'Radius dim', glyph: '◠', key: '' },
  { id: 'dimAngular', label: 'Angle dim', glyph: '∠', key: '' },
  { id: 'offset', label: 'Offset', glyph: '⧉', key: 'O' },
  { id: 'measure', label: 'Measure', glyph: '⟺', key: 'M' },
];

const SNAP_KINDS = ['end', 'mid', 'center', 'quad', 'node', 'intersect', 'grid', 'near'];

export class Draft2D {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { cx: 0, cy: 0, scale: 2.4 };     // scale = px per mm
    this.tool = 'select';
    this.pending = [];
    this.selection = new Set();
    this.hover = null;
    this.cursor = { x: 0, y: 0 };
    this.snap = { on: true, grid: true, kinds: new Set(SNAP_KINDS), size: 5 };
    this.ortho = false;
    this.polar = false;
    this.polarStep = 15;
    this.snapHit = null;
    this.dragBox = null;
    this.dragMove = null;
    this.typed = '';
    this.touches = new Map();     // active touch points, for pinch/pan
    this.gesture = null;
    this.onStatus = null;
    this.onEntityAdded = null;
    this.onTextRequest = null;
    this.textSize = 6;
    this._raf = 0;
    this._dirty = true;
    this._bind();
  }

  /* ------------------------------------------------------- coordinates */

  get w() { return this.cv.clientWidth || 1; }
  get h() { return this.cv.clientHeight || 1; }

  toScreen(x, y) {
    return [(x - this.view.cx) * this.view.scale + this.w / 2, this.h / 2 - (y - this.view.cy) * this.view.scale];
  }

  toWorld(sx, sy) {
    return [(sx - this.w / 2) / this.view.scale + this.view.cx, (this.h / 2 - sy) / this.view.scale + this.view.cy];
  }

  invalidate() { this._dirty = true; }

  /* ------------------------------------------------------------ lifecycle */

  start() {
    const loop = () => { this._raf = requestAnimationFrame(loop); if (this._dirty) { this._dirty = false; this.render(); } };
    loop();
  }
  stop() { cancelAnimationFrame(this._raf); }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = Math.max(1, Math.round(this.w * dpr));
    this.cv.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidate();
  }

  setTool(t) {
    this.tool = t;
    this.pending = [];
    this.typed = '';
    this.dragBox = null;
    bus.emit(T.TOOL, t);
    this._status();
    this.invalidate();
  }

  /* ------------------------------------------------------------- input */

  _bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => this._down(e));
    cv.addEventListener('pointermove', e => this._move(e));
    cv.addEventListener('pointerup', e => this._up(e));
    cv.addEventListener('pointercancel', e => this._up(e));
    cv.addEventListener('pointerleave', () => { this.snapHit = null; this.invalidate(); });
    cv.addEventListener('wheel', e => this._wheel(e), { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('dblclick', () => { if (this.tool === 'polyline' || this.tool === 'spline') this._finishChain(); });
  }

  /* ------------------------------------------------ touch gestures */

  /**
   * A phone has no wheel and no middle button, so the two-finger gesture is
   * the only way to pan and zoom. One finger keeps drawing; the moment a
   * second lands, any in-progress drag is abandoned and the pair drives the
   * view instead.
   */
  _trackDown(e) {
    if (e.pointerType !== 'touch') return false;
    this.touches.set(e.pointerId, this._local(e));
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.gesture = {
        dist: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1,
        mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        scale: this.view.scale,
        cx: this.view.cx, cy: this.view.cy,
      };
      // abandon anything the first finger had started
      this.dragBox = null;
      this.dragMove = null;
      this.panning = null;
      this._tap = null;
      this.invalidate();
    }
    return this.touches.size >= 2;
  }

  _trackMove(e) {
    if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return false;
    this.touches.set(e.pointerId, this._local(e));
    if (this.touches.size < 2 || !this.gesture) return this.touches.size >= 2;

    const [a, b] = [...this.touches.values()];
    // Named `spread` rather than `dist`: `dist` is now an imported function,
    // and a local that shadows it reads as a call site that cannot fail.
    const spread = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const g = this.gesture;

    // anchor the zoom on the world point under the original pinch centre
    const next = Math.max(0.002, Math.min(4000, g.scale * (spread / g.dist)));
    const wx = (g.mid[0] - this.w / 2) / g.scale + g.cx;
    const wy = (this.h / 2 - g.mid[1]) / g.scale + g.cy;
    this.view.scale = next;
    this.view.cx = wx - (mid[0] - this.w / 2) / next;
    this.view.cy = wy + (mid[1] - this.h / 2) / next;
    this.invalidate();
    return true;
  }

  _trackUp(e) {
    if (e.pointerType !== 'touch') return false;
    const had = this.touches.size >= 2;
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.gesture = null;
    if (had) { this.pending = this.pending; return true; }   // swallow the tap that ended a gesture
    return false;
  }

  _down(e) {
    if (this._trackDown(e)) return;
    try { this.cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic or stale pointer */ }
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      this.panning = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy };
      return;
    }
    if (e.button !== 0) return;
    const p = this._pick(e);
    this.cursor = { x: p[0], y: p[1] };
    if (this.tool === 'select') {
      const hit = this.hitTest(p);
      if (hit && this.selection.has(hit.id) && !e.shiftKey) {
        this.dragMove = { from: p, ids: [...this.selection], moved: false };
      } else if (hit) {
        if (e.shiftKey) { this.selection.has(hit.id) ? this.selection.delete(hit.id) : this.selection.add(hit.id); }
        else this.selection = new Set([hit.id]);
        this._emitSel();
        this.dragMove = { from: p, ids: [...this.selection], moved: false };
      } else {
        if (!e.shiftKey) { this.selection.clear(); this._emitSel(); }
        this.dragBox = { a: p, b: p };
      }
      this.invalidate();
      return;
    }
    if (e.pointerType === 'touch') {
      // Defer to pointerup: a second finger may still arrive and turn this
      // into a pan/zoom gesture, and a committed point cannot be taken back.
      this._tap = { p, x: e.clientX, y: e.clientY };
      return;
    }
    this._toolClick(p, e);
  }

  _move(e) {
    if (this._trackMove(e)) return;
    if (this.panning) {
      const dx = (e.clientX - this.panning.x) / this.view.scale;
      const dy = (e.clientY - this.panning.y) / this.view.scale;
      this.view.cx = this.panning.cx - dx;
      this.view.cy = this.panning.cy + dy;
      this.invalidate();
      return;
    }
    const p = this._pick(e);
    this.cursor = { x: p[0], y: p[1] };
    if (this.dragBox) { this.dragBox.b = p; this.invalidate(); }
    else if (this.dragMove) {
      this.dragMove.to = p;
      this.dragMove.moved = Math.hypot(p[0] - this.dragMove.from[0], p[1] - this.dragMove.from[1]) > 1e-6;
      this.invalidate();
    } else if (this.tool === 'select') {
      const hit = this.hitTest(p);
      const id = hit ? hit.id : null;
      if (id !== this.hover) { this.hover = id; this.invalidate(); }
    } else this.invalidate();
    this._status();
  }

  _up(e) {
    const tap = this._tap;
    this._tap = null;
    if (this._trackUp(e)) return;
    if (tap && e.pointerType === 'touch' && this.touches.size === 0) {
      // a tap, not the start of a gesture and not a drag
      if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= 14) { this._toolClick(tap.p, e); return; }
    }
    if (this.panning) { this.panning = null; return; }
    if (this.dragBox) {
      const { a, b } = this.dragBox;
      this.dragBox = null;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) * this.view.scale > 3) {
        const crossing = b[0] < a[0];
        const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        if (!e.shiftKey) this.selection.clear();
        for (const ent of this._visibleEntities()) {
          if (this._entityInBox(ent, box, crossing)) this.selection.add(ent.id);
        }
        this._emitSel();
      }
      this.invalidate();
      return;
    }
    if (this.dragMove) {
      const d = this.dragMove;
      this.dragMove = null;
      if (d.moved && d.to) {
        const dx = d.to[0] - d.from[0], dy = d.to[1] - d.from[1];
        store.edit('Move entities', () => {
          for (const id of d.ids) { const ent = store.entity(id); if (ent) translateEntity(ent, dx, dy); }
        }, { rebuild: true });
      }
      this.invalidate();
    }
  }

  _wheel(e) {
    e.preventDefault();
    const [wx, wy] = this.toWorld(...this._local(e));
    const f = Math.exp(-e.deltaY * 0.0014);
    const next = Math.max(0.002, Math.min(4000, this.view.scale * f));
    const k = next / this.view.scale;
    this.view.cx = wx - (wx - this.view.cx) / k;
    this.view.cy = wy - (wy - this.view.cy) / k;
    this.view.scale = next;
    this.invalidate();
  }

  _local(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Screen point -> snapped world point. */
  _pick(e) {
    const [sx, sy] = this._local(e);
    let p = this.toWorld(sx, sy);
    this.snapHit = null;
    if (this.snap.on) {
      const hit = this.findSnap(p, 12 / this.view.scale);
      if (hit) { p = hit.p; this.snapHit = hit; }
    }
    const anchor = this.pending.length ? this.pending[this.pending.length - 1] : null;
    if (anchor && (this.ortho || this.polar) && !this.snapHit) {
      p = this._constrain(anchor, p);
    }
    return p;
  }

  _constrain(a, p) {
    const dx = p[0] - a[0], dy = p[1] - a[1];
    if (this.ortho) {
      return Math.abs(dx) >= Math.abs(dy) ? [a[0] + dx, a[1]] : [a[0], a[1] + dy];
    }
    const len = Math.hypot(dx, dy);
    const step = this.polarStep * D2R;
    const ang = Math.round(Math.atan2(dy, dx) / step) * step;
    return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
  }

  /* -------------------------------------------------------------- snaps */

  findSnap(p, tol) {
    const cands = [];
    const add = (kind, x, y) => { if (this.snap.kinds.has(kind)) cands.push({ kind, p: [x, y], d: Math.hypot(x - p[0], y - p[1]) }); };
    const ents = this._visibleEntities();

    for (const e of ents) {
      switch (e.type) {
        case 'line':
          add('end', e.a[0], e.a[1]); add('end', e.b[0], e.b[1]);
          add('mid', (e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2);
          break;
        case 'polyline': {
          for (const q of e.pts) add('end', q[0], q[1]);
          for (let i = 0; i + 1 < e.pts.length; i++) add('mid', (e.pts[i][0] + e.pts[i + 1][0]) / 2, (e.pts[i][1] + e.pts[i + 1][1]) / 2);
          break;
        }
        case 'rect': {
          const [x1, y1] = e.a, [x2, y2] = e.b;
          add('end', x1, y1); add('end', x2, y1); add('end', x2, y2); add('end', x1, y2);
          add('mid', (x1 + x2) / 2, y1); add('mid', (x1 + x2) / 2, y2);
          add('mid', x1, (y1 + y2) / 2); add('mid', x2, (y1 + y2) / 2);
          add('center', (x1 + x2) / 2, (y1 + y2) / 2);
          break;
        }
        case 'circle':
          add('center', e.c[0], e.c[1]);
          for (let k = 0; k < 4; k++) add('quad', e.c[0] + e.r * Math.cos(k * Math.PI / 2), e.c[1] + e.r * Math.sin(k * Math.PI / 2));
          break;
        case 'ellipse':
          add('center', e.c[0], e.c[1]);
          break;
        case 'polygon': {
          add('center', e.c[0], e.c[1]);
          const n = Math.max(3, Math.round(e.n || 6)), rot = (e.rot || 0) * D2R;
          for (let i = 0; i < n; i++) add('end', e.c[0] + e.r * Math.cos(rot + i / n * TAU), e.c[1] + e.r * Math.sin(rot + i / n * TAU));
          break;
        }
        case 'arc':
          add('center', e.c[0], e.c[1]);
          add('end', e.c[0] + e.r * Math.cos(e.a0), e.c[1] + e.r * Math.sin(e.a0));
          add('end', e.c[0] + e.r * Math.cos(e.a1), e.c[1] + e.r * Math.sin(e.a1));
          break;
        case 'spline':
          for (const q of e.pts) add('node', q[0], q[1]);
          break;
        case 'point':
          add('node', e.p[0], e.p[1]);
          break;
        default: break;
      }
    }

    // line/line intersections near the cursor
    if (this.snap.kinds.has('intersect')) {
      const segs = [];
      for (const e of ents) {
        if (e.type === 'line') segs.push([e.a, e.b]);
        else if (e.type === 'polyline') for (let i = 0; i + 1 < e.pts.length; i++) segs.push([e.pts[i], e.pts[i + 1]]);
      }
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          const x = segIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
          if (x) add('intersect', x[0], x[1]);
        }
      }
    }

    if (this.snap.kinds.has('near')) {
      for (const e of ents) {
        const q = nearestOnEntity(e, p);
        if (q) add('near', q[0], q[1]);
      }
    }

    const rank = { end: 0, intersect: 1, center: 2, mid: 3, quad: 4, node: 5, near: 8, grid: 9 };
    const best = cands.filter(c => c.d <= tol).sort((a, b) => (rank[a.kind] - rank[b.kind]) || (a.d - b.d))[0];
    if (best) return best;

    if (this.snap.grid && this.snap.kinds.has('grid')) {
      const g = this.gridStep();
      const gx = Math.round(p[0] / g) * g, gy = Math.round(p[1] / g) * g;
      if (Math.hypot(gx - p[0], gy - p[1]) <= tol) return { kind: 'grid', p: [gx, gy] };
    }
    return null;
  }

  gridStep() {
    const target = 26 / this.view.scale;   // ≈26 px between minor lines
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, target))));
    for (const m of [1, 2, 5, 10]) if (pow * m >= target) return pow * m;
    return pow * 10;
  }

  /* -------------------------------------------------------- hit testing */

  _visibleEntities() {
    const d = store.doc.draw;
    return d.entities.filter(e => {
      const l = d.layers.find(x => x.id === e.layer);
      return !l || (l.visible && !l.locked);
    });
  }

  hitTest(p) {
    const tol = 7 / this.view.scale;
    let best = null;
    for (const e of this._visibleEntities()) {
      const d = distanceToEntity(e, p);
      if (d !== null && d <= tol && (!best || d < best.d)) best = { id: e.id, d, entity: e };
    }
    return best;
  }

  _entityInBox(e, box, crossing) {
    const pts = entityPoints(e);
    if (!pts.length) return false;
    const inside = pts.every(q => q[0] >= box[0] && q[0] <= box[2] && q[1] >= box[1] && q[1] <= box[3]);
    if (inside) return true;
    if (!crossing) return false;
    return pts.some(q => q[0] >= box[0] && q[0] <= box[2] && q[1] >= box[1] && q[1] <= box[3]);
  }

  /* ------------------------------------------------------------- tools */

  _toolClick(p) {
    const t = this.tool;
    const push = () => this.pending.push(p);

    switch (t) {
      case 'line':
        push();
        if (this.pending.length === 2) { this._add({ type: 'line', a: this.pending[0], b: this.pending[1] }); this.pending = [this.pending[1]]; }
        break;

      case 'polyline':
      case 'spline':
        push();
        break;

      case 'rect':
        push();
        if (this.pending.length === 2) { this._add({ type: 'rect', a: this.pending[0], b: this.pending[1] }); this.pending = []; }
        break;

      case 'circle':
        push();
        if (this.pending.length === 2) {
          const r = dist(this.pending[0], this.pending[1]);
          if (r > 1e-6) this._add({ type: 'circle', c: this.pending[0], r });
          this.pending = [];
        }
        break;

      case 'ellipse':
        push();
        if (this.pending.length === 3) {
          const c = this.pending[0];
          this._add({ type: 'ellipse', c, rx: Math.abs(this.pending[1][0] - c[0]) || 1, ry: Math.abs(this.pending[2][1] - c[1]) || 1, rot: 0 });
          this.pending = [];
        }
        break;

      case 'polygon':
        push();
        if (this.pending.length === 2) {
          const c = this.pending[0], q = this.pending[1];
          this._add({ type: 'polygon', c, r: dist(c, q) || 1, n: this.polygonSides || 6, rot: Math.atan2(q[1] - c[1], q[0] - c[0]) * R2D });
          this.pending = [];
        }
        break;

      case 'arc':
        push();
        if (this.pending.length === 3) {
          const arc = arcFrom3(this.pending[0], this.pending[1], this.pending[2]);
          if (arc) this._add({ type: 'arc', ...arc });
          this.pending = [];
        }
        break;

      case 'point':
        this._add({ type: 'point', p });
        break;

      case 'text': {
        // The host supplies the dialog so this module stays UI-framework free.
        const place = (txt) => {
          const t = String(txt || '').trim();
          if (t) this._add({ type: 'text', p, text: t, size: this.textSize, rot: 0 });
        };
        if (this.onTextRequest) this.onTextRequest(place);
        else place(globalThis.prompt ? globalThis.prompt('Text:', '') : '');
        break;
      }

      case 'dimLinear':
      case 'dimAligned':
        push();
        if (this.pending.length === 3) {
          const [a, b, o] = this.pending;
          const aligned = t === 'dimAligned';
          const off = aligned
            ? pointLineSignedDistance(a, b, o)
            : (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? o[1] - Math.max(a[1], b[1]) : o[0] - Math.max(a[0], b[0]));
          this._add({ type: 'dim', kind: aligned ? 'aligned' : (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'h' : 'v'), a, b, off, size: this.textSize });
          this.pending = [];
        }
        break;

      case 'dimRadial': {
        const hit = this.hitTest(p);
        if (hit && (hit.entity.type === 'circle' || hit.entity.type === 'arc')) {
          this._add({ type: 'dim', kind: 'radial', c: hit.entity.c, r: hit.entity.r, ang: Math.atan2(p[1] - hit.entity.c[1], p[0] - hit.entity.c[0]), size: this.textSize });
        } else bus.emit(T.TOAST, { msg: 'Click a circle or arc to dimension', kind: 'warn' });
        break;
      }

      case 'dimAngular':
        push();
        if (this.pending.length === 3) {
          const [c, p1, p2] = this.pending;
          this._add({ type: 'dim', kind: 'angular', c, p1, p2, rad: dist(c, p1) * 0.8, size: this.textSize });
          this.pending = [];
        }
        break;

      case 'offset': {
        if (!this.pending.length) {
          const hit = this.hitTest(p);
          if (!hit) { bus.emit(T.TOAST, { msg: 'Pick an object to offset', kind: 'warn' }); return; }
          this.pending = [p];
          this.offsetSrc = hit.entity;
          this._status();
        } else {
          const src = this.offsetSrc;
          const d = offsetDistanceFor(src, p);
          const copy = offsetEntity(src, d);
          if (copy) this._add(copy); else bus.emit(T.TOAST, { msg: 'That object cannot be offset', kind: 'warn' });
          this.pending = [];
          this.offsetSrc = null;
        }
        break;
      }

      case 'measure':
        push();
        if (this.pending.length === 2) {
          const [a, b] = this.pending;
          const u = store.doc.meta.units;
          const d = dist(a, b);
          bus.emit(T.TOAST, {
            msg: `Distance ${fmt(toDisplay(d, u))} ${u} · ΔX ${fmt(toDisplay(b[0] - a[0], u))} · ΔY ${fmt(toDisplay(b[1] - a[1], u))} · ∠ ${fmt(Math.atan2(b[1] - a[1], b[0] - a[0]) * R2D)}°`,
            kind: 'ok', ms: 6000,
          });
          this.pending = [];
        }
        break;

      default: break;
    }
    this._status();
    this.invalidate();
  }

  _finishChain() {
    if (this.pending.length >= 2) {
      const type = this.tool === 'spline' ? 'spline' : 'polyline';
      this._add({ type, pts: this.pending.map(p => [p[0], p[1]]), closed: false });
    }
    this.pending = [];
    this.invalidate();
  }

  closeChain() {
    if (this.pending.length >= 3) {
      const type = this.tool === 'spline' ? 'spline' : 'polyline';
      this._add({ type, pts: this.pending.map(p => [p[0], p[1]]), closed: true });
    }
    this.pending = [];
    this.invalidate();
  }

  cancel() {
    if (this.pending.length) { this.pending = []; this.typed = ''; this.invalidate(); return true; }
    if (this.tool !== 'select') { this.setTool('select'); return true; }
    if (this.selection.size) { this.selection.clear(); this._emitSel(); this.invalidate(); return true; }
    return false;
  }

  _add(entity) {
    const e = { id: uid('e'), layer: store.doc.draw.activeLayer, ...entity };
    store.edit(`Draw ${entity.type}`, (doc) => { doc.draw.entities.push(e); }, { rebuild: true });
    this.selection = new Set([e.id]);
    this._emitSel();
    if (this.onEntityAdded) this.onEntityAdded(e);
    return e;
  }

  _emitSel() { bus.emit(T.SELECTION, { source: 'draft', ids: [...this.selection] }); }

  /* ------------------------------------------------- typed coordinates */

  /** Accept keyboard input while a drawing tool has a rubber band active. */
  typeKey(key) {
    if (this.tool === 'select') return false;
    if (key === 'Backspace') { this.typed = this.typed.slice(0, -1); this.invalidate(); return true; }
    if (key === 'Enter') { return this._applyTyped(); }
    if (/^[-0-9.,<@ ]$/.test(key)) { this.typed += key; this.invalidate(); return true; }
    return false;
  }

  _applyTyped() {
    const s = this.typed.trim();
    this.typed = '';
    if (!s) { if (this.tool === 'polyline' || this.tool === 'spline') this._finishChain(); return true; }
    const anchor = this.pending.length ? this.pending[this.pending.length - 1] : [0, 0];
    let p = null;
    const rel = s.startsWith('@');
    const body = rel ? s.slice(1) : s;
    if (body.includes('<')) {
      const [l, a] = body.split('<').map(Number);
      if (Number.isFinite(l) && Number.isFinite(a)) {
        p = [anchor[0] + Math.cos(a * D2R) * l, anchor[1] + Math.sin(a * D2R) * l];
      }
    } else if (body.includes(',')) {
      const [x, y] = body.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) p = rel ? [anchor[0] + x, anchor[1] + y] : [x, y];
    } else {
      const len = Number(body);
      if (Number.isFinite(len) && this.pending.length) {
        const dir = Math.atan2(this.cursor.y - anchor[1], this.cursor.x - anchor[0]);
        p = [anchor[0] + Math.cos(dir) * len, anchor[1] + Math.sin(dir) * len];
      }
    }
    if (!p) { bus.emit(T.TOAST, { msg: 'Type  x,y  ·  @dx,dy  ·  @len<angle  ·  len', kind: 'warn' }); return true; }
    this._toolClick(p);
    return true;
  }

  /* ------------------------------------------------------------ editing */

  deleteSelection() {
    if (!this.selection.size) return;
    const ids = new Set(this.selection);
    store.edit('Delete entities', (doc) => {
      doc.draw.entities = doc.draw.entities.filter(e => !ids.has(e.id));
      for (const f of doc.features) if (f.profile) f.profile = f.profile.filter(i => !ids.has(i));
    }, { rebuild: true });
    this.selection.clear();
    this._emitSel();
    this.invalidate();
  }

  duplicateSelection(dx = 10, dy = 10) {
    if (!this.selection.size) return;
    const copies = [];
    store.edit('Duplicate entities', (doc) => {
      for (const id of this.selection) {
        const e = doc.draw.entities.find(x => x.id === id);
        if (!e) continue;
        const c = structuredClone(e);
        c.id = uid('e');
        translateEntity(c, dx, dy);
        doc.draw.entities.push(c);
        copies.push(c.id);
      }
    }, { rebuild: true });
    this.selection = new Set(copies);
    this._emitSel();
    this.invalidate();
  }

  transformSelection(label, fn) {
    if (!this.selection.size) return;
    store.edit(label, (doc) => {
      for (const id of this.selection) {
        const e = doc.draw.entities.find(x => x.id === id);
        if (e) fn(e);
      }
    }, { rebuild: true });
    this.invalidate();
  }

  selectAll() {
    this.selection = new Set(this._visibleEntities().map(e => e.id));
    this._emitSel();
    this.invalidate();
  }

  /* ------------------------------------------------------------- extent */

  extents() {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const e of store.doc.draw.entities) {
      for (const p of entityPoints(e)) {
        minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
        maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]);
      }
    }
    if (!Number.isFinite(minx)) return null;
    return [minx, miny, maxx, maxy];
  }

  zoomExtents() {
    const ex = this.extents();
    if (!ex) { this.view = { cx: 0, cy: 0, scale: 2.4 }; this.invalidate(); return; }
    const [x1, y1, x2, y2] = ex;
    const w = Math.max(x2 - x1, 1), h = Math.max(y2 - y1, 1);
    this.view.cx = (x1 + x2) / 2;
    this.view.cy = (y1 + y2) / 2;
    this.view.scale = Math.min(this.w / (w * 1.25), this.h / (h * 1.25));
    this.invalidate();
  }

  zoomBy(f) {
    this.view.scale = Math.max(0.002, Math.min(4000, this.view.scale * f));
    this.invalidate();
  }

  _status() {
    if (!this.onStatus) return;
    const u = store.doc.meta.units;
    const prompt = TOOL_PROMPTS[this.tool];
    const step = this.pending.length;
    this.onStatus({
      coords: `X ${fmt(toDisplay(this.cursor.x, u))}  Y ${fmt(toDisplay(this.cursor.y, u))}`,
      prompt: typeof prompt === 'function' ? prompt(step) : prompt,
      snap: this.snapHit ? this.snapHit.kind : null,
    });
  }

  /* ------------------------------------------------------------ drawing */

  render() {
    const ctx = this.ctx;
    const css = getComputedStyle(document.documentElement);
    const col = (n, fb) => (css.getPropertyValue(n) || fb).trim();
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = col('--bg-inset', '#0a0d12');
    ctx.fillRect(0, 0, this.w, this.h);

    this._drawGrid(ctx, col);
    this._drawEntities(ctx, col);
    this._drawPending(ctx, col);
    this._drawSelectionBox(ctx, col);
    this._drawSnap(ctx, col);
  }

  _drawGrid(ctx, col) {
    if (!store.doc.view.grid) { this._drawAxes(ctx, col); return; }
    const step = this.gridStep();
    const major = step * 10;
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(this.w, this.h);
    ctx.lineWidth = 1;
    for (const [s, c] of [[step, col('--grid', '#2a3240')], [major, col('--grid-major', '#3a4557')]]) {
      if (s * this.view.scale < 6) continue;
      ctx.strokeStyle = c;
      ctx.beginPath();
      for (let x = Math.floor(x0 / s) * s; x <= x1; x += s) {
        const sx = Math.round(this.toScreen(x, 0)[0]) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, this.h);
      }
      for (let y = Math.floor(y0 / s) * s; y <= y1; y += s) {
        const sy = Math.round(this.toScreen(0, y)[1]) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(this.w, sy);
      }
      ctx.stroke();
    }
    this._drawAxes(ctx, col);
  }

  _drawAxes(ctx, col) {
    if (!store.doc.view.axes) return;
    const o = this.toScreen(0, 0);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = col('--x-axis', '#ff5f56');
    ctx.beginPath(); ctx.moveTo(0, o[1]); ctx.lineTo(this.w, o[1]); ctx.stroke();
    ctx.strokeStyle = col('--y-axis', '#5ad469');
    ctx.beginPath(); ctx.moveTo(o[0], 0); ctx.lineTo(o[0], this.h); ctx.stroke();
  }

  _drawEntities(ctx, col) {
    const d = store.doc.draw;
    const layerMap = new Map(d.layers.map(l => [l.id, l]));
    const selCol = col('--sel', '#ff9f1c');
    const hoverCol = col('--accent', '#4da3ff');
    const profileIds = new Set();
    for (const f of store.doc.features) if (f.profile) for (const id of f.profile) profileIds.add(id);

    for (const e of d.entities) {
      const layer = layerMap.get(e.layer);
      if (layer && !layer.visible) continue;
      const selected = this.selection.has(e.id);
      const hovered = this.hover === e.id;
      let colour = layer ? layer.color : '#c9d3e0';
      if (profileIds.has(e.id)) colour = col('--ok', '#4ecb8b');
      if (hovered) colour = hoverCol;
      if (selected) colour = selCol;

      ctx.save();
      let ox = 0, oy = 0;
      if (this.dragMove && this.dragMove.to && this.selection.has(e.id)) {
        ox = this.dragMove.to[0] - this.dragMove.from[0];
        oy = this.dragMove.to[1] - this.dragMove.from[1];
      }
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = Math.max(1, (layer ? layer.weight : 1) * (selected ? 2 : 1));
      if (layer && layer.style === 'dashed') ctx.setLineDash([8, 5]);
      else if (layer && layer.style === 'dotted') ctx.setLineDash([2, 4]);
      this._drawEntity(ctx, e, ox, oy, colour);
      ctx.restore();
    }
  }

  _drawEntity(ctx, e, ox = 0, oy = 0, colour = '#fff') {
    const S = (x, y) => this.toScreen(x + ox, y + oy);
    switch (e.type) {
      case 'line': {
        const a = S(...e.a), b = S(...e.b);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        break;
      }
      case 'polyline':
      case 'spline': {
        const path = entityToPath(e, 64);
        if (!path) break;
        ctx.beginPath();
        path.pts.forEach((p, i) => { const s = S(p[0], p[1]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
        if (path.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'rect': {
        const a = S(...e.a), b = S(...e.b);
        ctx.beginPath(); ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.stroke();
        break;
      }
      case 'circle': {
        const c = S(...e.c);
        ctx.beginPath(); ctx.arc(c[0], c[1], Math.abs(e.r) * this.view.scale, 0, TAU); ctx.stroke();
        break;
      }
      case 'ellipse': {
        const c = S(...e.c);
        ctx.beginPath();
        ctx.ellipse(c[0], c[1], e.rx * this.view.scale, e.ry * this.view.scale, -(e.rot || 0) * D2R, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'polygon': {
        const n = Math.max(3, Math.round(e.n || 6)), rot = (e.rot || 0) * D2R;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const a = rot + (i % n) / n * TAU;
          const s = S(e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a));
          i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]);
        }
        ctx.closePath(); ctx.stroke();
        break;
      }
      case 'arc': {
        const c = S(...e.c);
        ctx.beginPath();
        ctx.arc(c[0], c[1], Math.abs(e.r) * this.view.scale, -e.a1, -e.a0);
        ctx.stroke();
        break;
      }
      case 'point': {
        const p = S(...e.p);
        ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1]); ctx.lineTo(p[0] + 4, p[1]);
        ctx.moveTo(p[0], p[1] - 4); ctx.lineTo(p[0], p[1] + 4); ctx.stroke();
        break;
      }
      case 'text': {
        const p = S(...e.p);
        ctx.save();
        ctx.translate(p[0], p[1]);
        ctx.rotate(-(e.rot || 0) * D2R);
        ctx.font = `${Math.max(8, (e.size || 6) * this.view.scale)}px system-ui, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(e.text || '', 0, 0);
        ctx.restore();
        break;
      }
      case 'dim':
        this._drawDim(ctx, e, ox, oy, colour);
        break;
      default: break;
    }
  }

  _drawDim(ctx, e, ox, oy, colour) {
    const u = store.doc.meta.units;
    const S = (x, y) => this.toScreen(x + ox, y + oy);
    const px = Math.max(9, (e.size || 6) * this.view.scale * 0.85);
    ctx.font = `${px}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const arrow = (x, y, ang) => {
      const L = Math.max(5, px * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - L * Math.cos(ang - 0.32), y + L * Math.sin(ang - 0.32));
      ctx.lineTo(x - L * Math.cos(ang + 0.32), y + L * Math.sin(ang + 0.32));
      ctx.closePath(); ctx.fill();
    };
    const label = (x, y, text, ang = 0) => {
      const w = ctx.measureText(text).width + 8;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-inset').trim() || '#0a0d12';
      ctx.fillRect(-w / 2, -px * 0.68, w, px * 1.36);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colour;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };

    if (e.kind === 'radial') {
      const c = S(...e.c);
      const ang = e.ang || 0;
      const r = e.r * this.view.scale;
      const ex = c[0] + Math.cos(ang) * r, ey = c[1] - Math.sin(ang) * r;
      const tx = c[0] + Math.cos(ang) * (r + 26), ty = c[1] - Math.sin(ang) * (r + 26);
      ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(tx, ty); ctx.stroke();
      arrow(ex, ey, Math.PI - ang);
      label(tx, ty, `R${fmt(toDisplay(e.r, u))}`);
      return;
    }

    if (e.kind === 'angular') {
      const c = S(...e.c);
      const a1 = Math.atan2(e.p1[1] - e.c[1], e.p1[0] - e.c[0]);
      const a2 = Math.atan2(e.p2[1] - e.c[1], e.p2[0] - e.c[0]);
      const r = (e.rad || 20) * this.view.scale;
      ctx.beginPath(); ctx.arc(c[0], c[1], r, -Math.max(a1, a2), -Math.min(a1, a2)); ctx.stroke();
      const s1 = S(e.p1[0], e.p1[1]), s2 = S(e.p2[0], e.p2[1]);
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(s1[0], s1[1]); ctx.moveTo(c[0], c[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke();
      ctx.setLineDash([]);
      const am = (a1 + a2) / 2;
      label(c[0] + Math.cos(am) * (r + 14), c[1] - Math.sin(am) * (r + 14), `${fmt(Math.abs(a1 - a2) * R2D)}°`);
      return;
    }

    // linear / aligned
    const a = e.a, b = e.b, off = e.off || 0;
    let da, db, value;
    if (e.kind === 'h') { da = [a[0], Math.max(a[1], b[1]) + off]; db = [b[0], Math.max(a[1], b[1]) + off]; value = Math.abs(b[0] - a[0]); }
    else if (e.kind === 'v') { da = [Math.max(a[0], b[0]) + off, a[1]]; db = [Math.max(a[0], b[0]) + off, b[1]]; value = Math.abs(b[1] - a[1]); }
    else {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      da = [a[0] + nx * off, a[1] + ny * off];
      db = [b[0] + nx * off, b[1] + ny * off];
      value = L;
    }
    const sa = S(...a), sb = S(...b), sda = S(...da), sdb = S(...db);
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sda[0], sda[1]); ctx.moveTo(sb[0], sb[1]); ctx.lineTo(sdb[0], sdb[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(sda[0], sda[1]); ctx.lineTo(sdb[0], sdb[1]); ctx.stroke();
    const ang = Math.atan2(sdb[1] - sda[1], sdb[0] - sda[0]);
    arrow(sda[0], sda[1], Math.PI - ang + Math.PI);
    arrow(sdb[0], sdb[1], -ang);
    let ta = ang;
    if (ta > Math.PI / 2 || ta < -Math.PI / 2) ta += Math.PI;
    label((sda[0] + sdb[0]) / 2, (sda[1] + sdb[1]) / 2, `${fmt(toDisplay(value, u))}`, ta);
  }

  _drawPending(ctx, col) {
    if (!this.pending.length && this.tool === 'select') return;
    const accent = col('--accent', '#4da3ff');
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([6, 4]);

    const c = [this.cursor.x, this.cursor.y];
    const p = this.pending;
    const S = (q) => this.toScreen(q[0], q[1]);

    if (p.length) {
      ctx.beginPath();
      const first = S(p[0]);
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < p.length; i++) { const s = S(p[i]); ctx.lineTo(s[0], s[1]); }
      const sc = S(c);
      if (this.tool === 'circle' && p.length === 1) {
        ctx.beginPath(); ctx.arc(first[0], first[1], dist(p[0], c) * this.view.scale, 0, TAU);
      } else if (this.tool === 'rect' && p.length === 1) {
        ctx.beginPath(); ctx.rect(first[0], first[1], sc[0] - first[0], sc[1] - first[1]);
      } else if (this.tool === 'polygon' && p.length === 1) {
        const n = this.polygonSides || 6;
        const r = dist(p[0], c) * this.view.scale;
        const rot = Math.atan2(c[1] - p[0][1], c[0] - p[0][0]);
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const a = -rot + (i % n) / n * TAU;
          const x = first[0] + r * Math.cos(a), y = first[1] + r * Math.sin(a);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
      } else {
        ctx.lineTo(sc[0], sc[1]);
      }
      ctx.stroke();

      for (const q of p) {
        const s = S(q);
        ctx.fillRect(s[0] - 2.5, s[1] - 2.5, 5, 5);
      }

      // live readout next to the cursor
      if (this.pending.length) {
        const anchor = p[p.length - 1];
        const u = store.doc.meta.units;
        const L = toDisplay(dist(anchor, c), u);
        const A = Math.atan2(c[1] - anchor[1], c[0] - anchor[0]) * R2D;
        const txt = this.typed ? `⌨ ${this.typed}` : `${fmt(L)} ${u} @ ${fmt(A)}°`;
        ctx.setLineDash([]);
        ctx.font = '12px ui-monospace, monospace';
        const w = ctx.measureText(txt).width + 12;
        const sc2 = S(c);
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = col('--bg-2', '#141920');
        ctx.fillRect(sc2[0] + 14, sc2[1] - 28, w, 20);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = accent;
        ctx.strokeRect(sc2[0] + 14, sc2[1] - 28, w, 20);
        ctx.fillStyle = col('--txt', '#e6ebf2');
        ctx.fillText(txt, sc2[0] + 20, sc2[1] - 14);
      }
    }

    // crosshair
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    const sc = this.toScreen(this.cursor.x, this.cursor.y);
    ctx.beginPath();
    ctx.moveTo(sc[0] - 14, sc[1]); ctx.lineTo(sc[0] + 14, sc[1]);
    ctx.moveTo(sc[0], sc[1] - 14); ctx.lineTo(sc[0], sc[1] + 14);
    ctx.stroke();
    ctx.restore();
  }

  _drawSelectionBox(ctx, col) {
    if (!this.dragBox) return;
    const a = this.toScreen(...this.dragBox.a);
    const b = this.toScreen(...this.dragBox.b);
    const crossing = this.dragBox.b[0] < this.dragBox.a[0];
    ctx.save();
    ctx.strokeStyle = crossing ? col('--ok', '#4ecb8b') : col('--accent', '#4da3ff');
    ctx.fillStyle = ctx.strokeStyle;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.globalAlpha = 1;
    ctx.setLineDash(crossing ? [6, 4] : []);
    ctx.lineWidth = 1;
    ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.restore();
  }

  _drawSnap(ctx, col) {
    if (!this.snapHit) return;
    const s = this.toScreen(...this.snapHit.p);
    ctx.save();
    ctx.strokeStyle = col('--ok', '#4ecb8b');
    ctx.lineWidth = 1.6;
    const r = 6;
    ctx.beginPath();
    switch (this.snapHit.kind) {
      case 'end': ctx.rect(s[0] - r, s[1] - r, r * 2, r * 2); break;
      case 'mid': ctx.moveTo(s[0] - r, s[1] + r); ctx.lineTo(s[0], s[1] - r); ctx.lineTo(s[0] + r, s[1] + r); ctx.closePath(); break;
      case 'center': ctx.arc(s[0], s[1], r, 0, TAU); break;
      case 'quad': ctx.moveTo(s[0], s[1] - r); ctx.lineTo(s[0] + r, s[1]); ctx.lineTo(s[0], s[1] + r); ctx.lineTo(s[0] - r, s[1]); ctx.closePath(); break;
      case 'intersect': ctx.moveTo(s[0] - r, s[1] - r); ctx.lineTo(s[0] + r, s[1] + r); ctx.moveTo(s[0] + r, s[1] - r); ctx.lineTo(s[0] - r, s[1] + r); break;
      default: ctx.arc(s[0], s[1], r * 0.7, 0, TAU);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/* ==================================================================
   Entity helpers (pure functions, also used by the exporters)
   ================================================================== */

const TOOL_PROMPTS = {
  select: 'Click to select · drag right-to-left for a crossing window · Del removes',
  line: (n) => n ? 'Pick the end point (or type a length)' : 'Pick the start point',
  polyline: (n) => n ? 'Pick the next point · Enter finishes · C closes' : 'Pick the start point',
  spline: (n) => n ? 'Pick the next fit point · Enter finishes' : 'Pick the first fit point',
  rect: (n) => n ? 'Pick the opposite corner' : 'Pick the first corner',
  circle: (n) => n ? 'Pick a point on the circle (or type a radius)' : 'Pick the centre',
  ellipse: (n) => n === 0 ? 'Pick the centre' : n === 1 ? 'Pick the X radius' : 'Pick the Y radius',
  polygon: (n) => n ? 'Pick a vertex (radius + rotation)' : 'Pick the centre',
  arc: (n) => n === 0 ? 'Pick the arc start' : n === 1 ? 'Pick a point along the arc' : 'Pick the arc end',
  point: 'Click to place a node',
  text: 'Click to place text',
  dimLinear: (n) => n < 2 ? `Pick measurement point ${n + 1}` : 'Pick the dimension line position',
  dimAligned: (n) => n < 2 ? `Pick measurement point ${n + 1}` : 'Pick the dimension line position',
  dimRadial: 'Click a circle or arc',
  dimAngular: (n) => n === 0 ? 'Pick the vertex' : n === 1 ? 'Pick the first leg' : 'Pick the second leg',
  offset: (n) => n ? 'Click the side to offset towards' : 'Pick an object to offset',
  measure: (n) => n ? 'Pick the second point' : 'Pick the first point',
};
