/**
 * Modal transform operators.
 *
 * Press G / R / S and the model follows the pointer; press X, Y or Z to lock
 * an axis (twice for the perpendicular plane); type a number for an exact
 * value; Enter or click confirms, Esc or right-click cancels and restores
 * everything. Shift is precision, Ctrl snaps to increments.
 *
 * This is the one interaction Blender gets decisively right and the CAD
 * packages do not: no dialog, no gizmo hunt, no mode switch — the keyboard
 * and the pointer drive the same operation, and it is always cancellable.
 */
import * as THREE from 'three';
import { store } from '../core/doc.js';
import { evalSafe } from '../core/expr.js';

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const R2D = 180 / Math.PI;

export class OperatorHost {
  constructor(app, hudEl) {
    this.app = app;
    this.hud = hudEl;
    this.active = null;
  }

  get running() { return !!this.active; }

  /** @param {'move'|'rotate'|'scale'} kind */
  start(kind) {
    if (this.active) this.cancel();
    const ids = [...this.app.selection];
    if (!ids.length) { this.app.flash('Select a body first', 'warn'); return false; }

    const vp = this.app.vp;
    const scope = this.app.build?.scope || {};
    const bodies = [];
    const pivot = new THREE.Vector3();
    let n = 0;

    for (const id of ids) {
      const f = store.feature(id);
      if (!f) continue;
      const base = {
        pos: f.transform.pos.map(v => evalSafe(v, scope, 0)),
        rot: f.transform.rot.map(v => evalSafe(v, scope, 0)),
        scale: (f.transform.scale || [1, 1, 1]).map(v => evalSafe(v, scope, 1)),
      };
      const group = vp.bodies.get(id);
      const centre = new THREE.Vector3();
      if (group) {
        const box = new THREE.Box3().setFromObject(group);
        if (!box.isEmpty()) box.getCenter(centre);
      }
      bodies.push({ id, base, centre });
      pivot.add(centre);
      n++;
    }
    if (!n) return false;
    pivot.multiplyScalar(1 / n);

    this.active = {
      kind,
      bodies,
      pivot,
      axis: null,            // null | 'x' | 'y' | 'z'
      plane: false,          // axis is a plane normal rather than a direction
      typed: '',
      value: kind === 'scale' ? 1 : 0,
      vector: new THREE.Vector3(),
      startWorld: null,
      startScreen: new THREE.Vector2(),
      lastAngle: 0,
      turns: 0,
      precise: false,
      snap: false,
      moved: false,
    };

    const p = vp.pointer;
    this.active.startScreen.set(p.x, p.y);
    this.active.startWorld = this._planePoint(p);
    this.active.startDir = this._screenDir(p);

    vp.controls.enabled = false;
    this.app.setStatusKeys(KEY_HINTS[kind]);
    this._render();
    return true;
  }

  /* --------------------------------------------------------- pointer */

  /** Point under the pointer on the view-aligned plane through the pivot. */
  _planePoint(pointer) {
    const vp = this.app.vp;
    const normal = new THREE.Vector3();
    vp.camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.active.pivot);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), vp.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : this.active.pivot.clone();
  }

  /** Pointer offset from the pivot in normalised screen space. */
  _screenDir(pointer) {
    const vp = this.app.vp;
    const p = this.active.pivot.clone().project(vp.camera);
    return new THREE.Vector2(pointer.x - p.x, pointer.y - p.y);
  }

  onPointerMove() {
    const a = this.active;
    if (!a) return;
    const vp = this.app.vp;
    const p = vp.pointer;

    if (a.typed) { this._apply(); return; }   // typed values ignore the pointer

    if (a.kind === 'move') {
      const now = this._planePoint(p);
      a.vector.subVectors(now, a.startWorld);
      if (a.precise) a.vector.multiplyScalar(0.1);
      if (a.axis && !a.plane) {
        const ax = AXES[a.axis];
        a.vector.copy(ax.clone().multiplyScalar(a.vector.dot(ax)));
      } else if (a.axis && a.plane) {
        const ax = AXES[a.axis];
        a.vector.addScaledVector(ax, -a.vector.dot(ax));
      }
      if (a.snap) {
        const step = this.app.prefs.snapStep || 1;
        a.vector.set(Math.round(a.vector.x / step) * step, Math.round(a.vector.y / step) * step, Math.round(a.vector.z / step) * step);
      }
      a.value = a.vector.length();
    } else if (a.kind === 'rotate') {
      const dir = this._screenDir(p);
      let ang = Math.atan2(dir.y, dir.x) - Math.atan2(a.startDir.y, a.startDir.x);
      // unwrap so dragging past ±180° keeps counting
      while (ang - a.lastAngle > Math.PI) ang -= Math.PI * 2;
      while (ang - a.lastAngle < -Math.PI) ang += Math.PI * 2;
      a.lastAngle = ang;
      let deg = ang * R2D * (a.precise ? 0.1 : 1);
      if (a.snap) deg = Math.round(deg / 15) * 15;
      a.value = deg;
    } else {
      const dir = this._screenDir(p);
      const d0 = a.startDir.length() || 1e-3;
      let k = dir.length() / d0;
      if (a.precise) k = 1 + (k - 1) * 0.1;
      if (a.snap) k = Math.round(k / 0.1) * 0.1;
      a.value = Math.max(0.001, k);
    }
    a.moved = true;
    this._apply();
  }

  /* ------------------------------------------------------------ keys */

  /** @returns {boolean} true when the key was consumed by the operator */
  onKey(e) {
    const a = this.active;
    if (!a) return false;
    const k = e.key;

    if (k === 'Escape') { this.cancel(); return true; }
    if (k === 'Enter' || k === 'Tab') { this.confirm(); return true; }

    if (k === 'Shift') { a.precise = true; this.onPointerMove(); return true; }
    if (k === 'Control' || k === 'Meta') { a.snap = true; this.onPointerMove(); return true; }

    const lower = k.toLowerCase();
    if (lower === 'x' || lower === 'y' || lower === 'z') {
      const plane = e.shiftKey;
      if (a.axis === lower && a.plane === plane) { a.axis = null; a.plane = false; }
      else { a.axis = lower; a.plane = plane; }
      a.lastAngle = 0;
      this.onPointerMove();
      this._render();
      return true;
    }

    if (/^[0-9]$/.test(k) || k === '.' || (k === '-' && !a.typed)) {
      a.typed += k;
      this._apply();
      return true;
    }
    if (k === 'Backspace') { a.typed = a.typed.slice(0, -1); this._apply(); return true; }

    return true;   // swallow everything else while an operator is running
  }

  onKeyUp(e) {
    const a = this.active;
    if (!a) return;
    if (e.key === 'Shift') { a.precise = false; this.onPointerMove(); }
    if (e.key === 'Control' || e.key === 'Meta') { a.snap = false; this.onPointerMove(); }
  }

  /* --------------------------------------------------------- applying */

  _effectiveValue() {
    const a = this.active;
    if (a.typed) {
      const v = parseFloat(a.typed);
      return Number.isFinite(v) ? v : (a.kind === 'scale' ? 1 : 0);
    }
    return a.value;
  }

  /** Preview the transform on the render tree without touching the document. */
  _apply() {
    const a = this.active;
    if (!a) return;
    const vp = this.app.vp;
    const v = this._effectiveValue();

    for (const b of a.bodies) {
      const group = vp.bodies.get(b.id);
      if (!group) continue;
      const m = new THREE.Matrix4();

      if (a.kind === 'move') {
        const vec = a.typed
          ? (a.axis ? AXES[a.axis].clone().multiplyScalar(v) : a.vector.clone().normalize().multiplyScalar(v || 0))
          : a.vector;
        m.makeTranslation(vec.x, vec.y, vec.z);
      } else if (a.kind === 'rotate') {
        const axis = a.axis ? AXES[a.axis].clone() : vp.camera.getWorldDirection(new THREE.Vector3()).negate();
        const q = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), v / R2D);
        m.makeTranslation(a.pivot.x, a.pivot.y, a.pivot.z)
          .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
          .multiply(new THREE.Matrix4().makeTranslation(-a.pivot.x, -a.pivot.y, -a.pivot.z));
      } else {
        const s = new THREE.Vector3(v, v, v);
        if (a.axis && !a.plane) { s.set(1, 1, 1); s[a.axis] = v; }
        else if (a.axis && a.plane) { s.set(v, v, v); s[a.axis] = 1; }
        m.makeTranslation(a.pivot.x, a.pivot.y, a.pivot.z)
          .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z))
          .multiply(new THREE.Matrix4().makeTranslation(-a.pivot.x, -a.pivot.y, -a.pivot.z));
      }

      group.matrixAutoUpdate = false;
      group.matrix.copy(m);
      group.updateMatrixWorld(true);
    }
    vp.invalidate();
    this._render();
  }

  /** Write the previewed transform into the document as a real edit. */
  confirm() {
    const a = this.active;
    if (!a) return;
    const v = this._effectiveValue();
    const changed = a.typed ? Number.isFinite(parseFloat(a.typed)) : a.moved;
    this._finish();
    if (!changed) return;

    const round = (x) => Math.round(x * 1e4) / 1e4;
    store.edit(LABELS[a.kind], () => {
      for (const b of a.bodies) {
        const f = store.feature(b.id);
        if (!f) continue;

        if (a.kind === 'move') {
          const vec = a.typed
            ? (a.axis ? AXES[a.axis].clone().multiplyScalar(v) : a.vector.clone().normalize().multiplyScalar(v || 0))
            : a.vector;
          f.transform.pos = [round(b.base.pos[0] + vec.x), round(b.base.pos[1] + vec.y), round(b.base.pos[2] + vec.z)];
        } else if (a.kind === 'rotate') {
          const axis = a.axis ? AXES[a.axis].clone() : this.app.vp.camera.getWorldDirection(new THREE.Vector3()).negate();
          const q = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), v / R2D);
          const e0 = new THREE.Euler(b.base.rot[0] / R2D, b.base.rot[1] / R2D, b.base.rot[2] / R2D, 'XYZ');
          const q0 = new THREE.Quaternion().setFromEuler(e0);
          const e1 = new THREE.Euler().setFromQuaternion(q.multiply(q0), 'XYZ');
          f.transform.rot = [round(e1.x * R2D), round(e1.y * R2D), round(e1.z * R2D)];
          // rotating several bodies about a shared pivot also moves them
          if (a.bodies.length > 1) {
            const p = new THREE.Vector3(...b.base.pos).sub(a.pivot).applyQuaternion(q).add(a.pivot);
            f.transform.pos = [round(p.x), round(p.y), round(p.z)];
          }
        } else {
          const s = new THREE.Vector3(v, v, v);
          if (a.axis && !a.plane) { s.set(1, 1, 1); s[a.axis] = v; }
          else if (a.axis && a.plane) { s.set(v, v, v); s[a.axis] = 1; }
          f.transform.scale = [round(b.base.scale[0] * s.x), round(b.base.scale[1] * s.y), round(b.base.scale[2] * s.z)];
          if (a.bodies.length > 1) {
            const p = new THREE.Vector3(...b.base.pos).sub(a.pivot).multiply(s).add(a.pivot);
            f.transform.pos = [round(p.x), round(p.y), round(p.z)];
          }
        }
      }
    });
  }

  cancel() {
    const a = this.active;
    if (!a) return;
    const vp = this.app.vp;
    for (const b of a.bodies) {
      const group = vp.bodies.get(b.id);
      if (!group) continue;
      group.matrix.identity();
      group.updateMatrixWorld(true);
    }
    vp.invalidate();
    this._finish();
  }

  _finish() {
    this.app.vp.controls.enabled = true;
    this.active = null;
    this.hud.hidden = true;
    this.hud.textContent = '';
    this.app.setStatusKeys(null);
  }

  /* ----------------------------------------------------------- the HUD */

  _render() {
    const a = this.active;
    if (!a) return;
    const u = store.doc.meta.units;
    const v = this._effectiveValue();
    const axisLabel = a.axis ? (a.plane ? `${a.axis.toUpperCase()}-plane` : `${a.axis.toUpperCase()} axis`) : 'view plane';

    let readout;
    if (a.kind === 'move') {
      const vec = a.typed
        ? (a.axis ? AXES[a.axis].clone().multiplyScalar(v) : a.vector.clone().normalize().multiplyScalar(v || 0))
        : a.vector;
      readout = `ΔX ${num(vec.x)}   ΔY ${num(vec.y)}   ΔZ ${num(vec.z)}  ${u}`;
    } else if (a.kind === 'rotate') {
      readout = `${num(v)}°`;
    } else {
      readout = `×${num(v, 3)}`;
    }

    this.hud.hidden = false;
    this.hud.innerHTML = '';
    const row = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      return d;
    };
    this.hud.append(
      row('op-title', `${LABELS[a.kind]} · ${axisLabel}`),
      row('op-value', a.typed ? `${a.typed}${CARET[a.kind]}` : readout),
      row('op-hint', a.bodies.length > 1 ? `${a.bodies.length} bodies · ${HINT}` : HINT),
    );
    this.hud.classList.toggle('typing', !!a.typed);
  }
}

const LABELS = { move: 'Move', rotate: 'Rotate', scale: 'Scale' };
const CARET = { move: ' mm', rotate: '°', scale: '×' };
const HINT = 'X/Y/Z axis · ⇧X plane · type a number · ⇧ precise · ⌃ snap · ⏎ confirm · esc cancel';

const KEY_HINTS = {
  move: [['drag', 'move'], ['X Y Z', 'axis'], ['0-9', 'exact'], ['⏎', 'confirm'], ['esc', 'cancel']],
  rotate: [['drag', 'rotate'], ['X Y Z', 'axis'], ['0-9', 'exact'], ['⏎', 'confirm'], ['esc', 'cancel']],
  scale: [['drag', 'scale'], ['X Y Z', 'axis'], ['0-9', 'exact'], ['⏎', 'confirm'], ['esc', 'cancel']],
};

function num(v, p = 2) {
  if (!Number.isFinite(v)) return '0';
  return (Math.abs(v) < 1e-9 ? 0 : v).toFixed(p).replace(/\.?0+$/, '') || '0';
}
