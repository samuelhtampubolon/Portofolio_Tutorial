/**
 * The 4D engine — geometry plus time.
 *
 * Three independent layers drive every body, evaluated in this order:
 *   1. Schedule   — the 4D-BIM idea: each body has a start time and duration
 *                   and animates itself into existence (build sequencing).
 *   2. Keyframes  — explicit animation curves per property with easing.
 *   3. Dynamics   — rigid-body motion: gravity, restitution, friction,
 *                   collisions, and analytic motors for mechanisms.
 *
 * Dynamics are baked to a frame cache so scrubbing the timeline backwards is
 * instant and always reproduces exactly the same motion.
 */
import * as THREE from 'three';
import { bus, T } from '../core/bus.js';
import { store } from '../core/doc.js';

const D2R = Math.PI / 180;

export const ANIM_PROPS = [
  { key: 'px', label: 'Move X', unit: 'len', def: 0 },
  { key: 'py', label: 'Move Y', unit: 'len', def: 0 },
  { key: 'pz', label: 'Move Z', unit: 'len', def: 0 },
  { key: 'rx', label: 'Spin X', unit: 'ang', def: 0 },
  { key: 'ry', label: 'Spin Y', unit: 'ang', def: 0 },
  { key: 'rz', label: 'Spin Z', unit: 'ang', def: 0 },
  { key: 'sx', label: 'Scale X', unit: 'num', def: 1 },
  { key: 'sy', label: 'Scale Y', unit: 'num', def: 1 },
  { key: 'sz', label: 'Scale Z', unit: 'num', def: 1 },
  { key: 'op', label: 'Opacity', unit: 'num', def: 1 },
  { key: 'vis', label: 'Visible', unit: 'bool', def: 1 },
];

export const EASINGS = {
  linear: t => t,
  step: t => (t >= 1 ? 1 : 0),
  smooth: t => t * t * (3 - 2 * t),
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  cubicIn: t => t * t * t,
  cubicOut: t => 1 - Math.pow(1 - t, 3),
  cubicInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: t => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  elastic: t => (t === 0 || t === 1) ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU3)) + 1,
  bounce: t => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
const TAU3 = (2 * Math.PI) / 3;

export const SCHEDULE_MODES = [
  ['none', 'Pop in'],
  ['fade', 'Fade in'],
  ['grow', 'Grow from centre'],
  ['riseZ', 'Rise (Z)'],
  ['dropZ', 'Drop in (Z)'],
  ['slideX', 'Slide in (X)'],
  ['slideY', 'Slide in (Y)'],
  ['build', 'Build up (Z sweep)'],
];

export const MOTOR_TYPES = [
  ['none', 'None'],
  ['spin', 'Continuous spin'],
  ['oscillate', 'Oscillate (rotary)'],
  ['reciprocate', 'Reciprocate (linear)'],
  ['orbit', 'Orbit a point'],
];

/* ---------------------------------------------------- track evaluation */

export function sampleTrack(keys, t, def) {
  if (!keys || !keys.length) return def;
  if (keys.length === 1) return keys[0].v;
  const sorted = keys;
  if (t <= sorted[0].t) return sorted[0].v;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].t < t) i++;
  const a = sorted[i], b = sorted[i + 1];
  const span = b.t - a.t;
  const u = span <= 1e-9 ? 1 : (t - a.t) / span;
  const ease = EASINGS[a.ease || 'smooth'] || EASINGS.linear;
  return a.v + (b.v - a.v) * ease(Math.max(0, Math.min(1, u)));
}

export function sortTrack(keys) { keys.sort((a, b) => a.t - b.t); return keys; }

/* --------------------------------------------------------- the engine */

export class Simulator {
  constructor(viewport) {
    this.vp = viewport;
    this.time = 0;
    this.playing = false;
    this.frames = null;         // baked dynamics: Map(featureId -> Float32Array)
    this.frameCount = 0;
    this.bakeKey = '';
    this.pivots = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
  }

  get sim() { return store.doc.sim; }

  /** Recompute per-body pivots (world centroid of the modelled geometry). */
  refreshPivots() {
    this.pivots.clear();
    for (const [id, group] of this.vp.bodies) {
      const prevAuto = group.matrixAutoUpdate;
      group.matrixAutoUpdate = false;
      const saved = group.matrix.clone();
      group.matrix.identity();
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      const c = new THREE.Vector3();
      if (box.isEmpty()) c.set(0, 0, 0); else box.getCenter(c);
      const size = new THREE.Vector3();
      box.getSize(size);
      this.pivots.set(id, { centre: c, radius: Math.max(size.length() / 2, 0.5), size, box: box.clone() });
      group.matrix.copy(saved);
      group.matrixAutoUpdate = prevAuto;
      group.updateMatrixWorld(true);
    }
  }

  /** Reset every body to its modelled pose. */
  reset() {
    for (const [, group] of this.vp.bodies) {
      group.matrixAutoUpdate = false;
      group.matrix.identity();
      group.updateMatrixWorld(true);
      group.visible = true;
    }
    this.vp.refreshMaterials();
    this.vp.invalidate();
  }

  /* ------------------------------------------------------------ baking */

  _dynamicsKey() {
    const d = this.sim.dynamics;
    return JSON.stringify([d, this.sim.duration, this.sim.fps, [...this.vp.bodies.keys()],
      [...this.pivots.entries()].map(([k, v]) => [k, v.centre.toArray(), v.radius])]);
  }

  ensureBaked() {
    if (!this.sim.dynamics.enabled) { this.frames = null; return; }
    const key = this._dynamicsKey();
    if (this.frames && key === this.bakeKey) return;
    this.bake();
    this.bakeKey = key;
  }

  /**
   * Integrate the whole timeline once and store a pose per frame.
   * Semi-implicit Euler with substeps — stable enough for the scales CAD
   * models live at, and completely deterministic.
   */
  bake() {
    const dyn = this.sim.dynamics;
    const fps = Math.max(5, Math.min(120, this.sim.fps || 30));
    const frames = Math.max(1, Math.ceil(this.sim.duration * fps) + 1);
    const sub = Math.max(1, Math.min(16, Math.round(dyn.substeps || 4)));
    const dt = 1 / (fps * sub);

    const ids = [...this.vp.bodies.keys()].filter(id => {
      const b = dyn.bodies[id];
      return b && b.enabled !== false;
    });

    const state = ids.map(id => {
      const b = dyn.bodies[id] || {};
      const pv = this.pivots.get(id) || { centre: new THREE.Vector3(), radius: 1 };
      return {
        id,
        static: !!b.static,
        mass: Math.max(0.001, b.mass ?? 1),
        p: pv.centre.clone(),
        p0: pv.centre.clone(),
        r: pv.radius,
        v: new THREE.Vector3(...(b.vel || [0, 0, 0])),
        w: new THREE.Vector3(...(b.spin || [0, 0, 0])).multiplyScalar(D2R),
        q: new THREE.Quaternion(),
        bounce: b.bounce ?? 0.35,
        friction: b.friction ?? 0.4,
      };
    });

    const out = new Map();
    for (const s of state) out.set(s.id, new Float32Array(frames * 7));

    const g = new THREE.Vector3(0, 0, dyn.gravity ?? -9810);
    const drag = Math.max(0, Math.min(1, dyn.airDrag ?? 0.02));
    const dq = new THREE.Quaternion();
    const tmp = new THREE.Vector3();

    for (let f = 0; f < frames; f++) {
      // record current pose
      for (const s of state) {
        const arr = out.get(s.id);
        const o = f * 7;
        arr[o] = s.p.x - s.p0.x; arr[o + 1] = s.p.y - s.p0.y; arr[o + 2] = s.p.z - s.p0.z;
        arr[o + 3] = s.q.x; arr[o + 4] = s.q.y; arr[o + 5] = s.q.z; arr[o + 6] = s.q.w;
      }
      if (f === frames - 1) break;

      for (let k = 0; k < sub; k++) {
        for (const s of state) {
          if (s.static) continue;
          s.v.addScaledVector(g, dt);
          s.v.multiplyScalar(1 - drag * dt);
          s.p.addScaledVector(s.v, dt);

          const wl = s.w.length();
          if (wl > 1e-9) {
            dq.setFromAxisAngle(tmp.copy(s.w).multiplyScalar(1 / wl), wl * dt);
            s.q.premultiply(dq).normalize();
          }

          if (dyn.ground) {
            const floor = (dyn.groundZ ?? 0) + s.r * 0.0;   // contact at the body's lowest point
            const low = s.p.z - s.r;
            if (low < floor) {
              s.p.z = floor + s.r;
              if (s.v.z < 0) {
                s.v.z = -s.v.z * s.bounce;
                if (Math.abs(s.v.z) < 60) s.v.z = 0;
                const fr = Math.max(0, 1 - s.friction * 0.35);
                s.v.x *= fr; s.v.y *= fr;
                s.w.multiplyScalar(Math.max(0, 1 - s.friction * 0.2));
              }
            }
          }
        }

        // pairwise collisions against bounding spheres
        for (let i = 0; i < state.length; i++) {
          for (let j = i + 1; j < state.length; j++) {
            const a = state[i], b = state[j];
            if (a.static && b.static) continue;
            tmp.subVectors(b.p, a.p);
            const d = tmp.length();
            const min = a.r + b.r;
            if (d >= min || d < 1e-9) continue;
            tmp.multiplyScalar(1 / d);
            const overlap = min - d;
            const ma = a.static ? 0 : 1 / a.mass, mb = b.static ? 0 : 1 / b.mass;
            const inv = ma + mb;
            if (inv <= 0) continue;
            a.p.addScaledVector(tmp, -overlap * (ma / inv));
            b.p.addScaledVector(tmp, overlap * (mb / inv));
            const rel = b.v.clone().sub(a.v).dot(tmp);
            if (rel > 0) continue;
            const e = Math.min(a.bounce, b.bounce);
            const jImp = (-(1 + e) * rel) / inv;
            a.v.addScaledVector(tmp, -jImp * ma);
            b.v.addScaledVector(tmp, jImp * mb);
          }
        }
      }
    }

    this.frames = out;
    this.frameCount = frames;
    this.bakeFps = fps;
  }

  /* ---------------------------------------------------------- evaluate */

  /** Position the scene at time `t` (seconds). */
  seek(t) {
    const sim = this.sim;
    this.time = Math.max(0, Math.min(sim.duration, t));
    if (sim.dynamics.enabled) this.ensureBaked();

    for (const [id, group] of this.vp.bodies) {
      const feature = store.feature(id);
      if (!feature) continue;
      const pv = this.pivots.get(id) || { centre: new THREE.Vector3(), radius: 1, size: new THREE.Vector3(1, 1, 1) };

      let ox = 0, oy = 0, oz = 0;
      let rx = 0, ry = 0, rz = 0;
      let sx = 1, sy = 1, sz = 1;
      let opacity = feature.appearance.opacity ?? 1;
      let visible = feature.visible !== false;

      /* --- 1. construction schedule --- */
      if (sim.schedule.enabled) {
        const item = sim.schedule.items[id];
        if (item && item.enabled !== false) {
          const start = item.start ?? 0;
          const dur = Math.max(1e-4, item.dur ?? 1);
          const u = (this.time - start) / dur;
          if (u < 0) { visible = false; }
          else if (u < 1) {
            const e = EASINGS.easeOut(Math.max(0, Math.min(1, u)));
            switch (item.mode) {
              case 'fade': opacity *= e; break;
              case 'grow': sx = sy = sz = Math.max(0.001, e); break;
              case 'riseZ': oz -= (1 - e) * (pv.size.z || 10) * 1.2; opacity *= Math.min(1, e * 2); break;
              case 'dropZ': oz += (1 - e) * (pv.size.z || 10) * 3; opacity *= Math.min(1, e * 2); break;
              case 'slideX': ox -= (1 - e) * (pv.size.x || 10) * 3; opacity *= Math.min(1, e * 2); break;
              case 'slideY': oy -= (1 - e) * (pv.size.y || 10) * 3; opacity *= Math.min(1, e * 2); break;
              case 'build': sz = Math.max(0.001, e); oz -= (pv.size.z || 0) * (1 - e) / 2; break;
              default: break;
            }
          }
          if (item.hideAt != null && this.time >= item.hideAt) visible = false;
        } else if (item && item.enabled === false) { /* not scheduled */ }
      }

      /* --- 2. keyframe tracks --- */
      const tr = sim.tracks[id];
      if (tr) {
        ox += sampleTrack(tr.px, this.time, 0);
        oy += sampleTrack(tr.py, this.time, 0);
        oz += sampleTrack(tr.pz, this.time, 0);
        rx += sampleTrack(tr.rx, this.time, 0);
        ry += sampleTrack(tr.ry, this.time, 0);
        rz += sampleTrack(tr.rz, this.time, 0);
        sx *= sampleTrack(tr.sx, this.time, 1);
        sy *= sampleTrack(tr.sy, this.time, 1);
        sz *= sampleTrack(tr.sz, this.time, 1);
        if (tr.op && tr.op.length) opacity *= sampleTrack(tr.op, this.time, 1);
        if (tr.vis && tr.vis.length) visible = visible && sampleTrack(tr.vis, this.time, 1) >= 0.5;
      }

      /* --- 3. dynamics + motors --- */
      let quat = null;
      if (sim.dynamics.enabled) {
        const b = sim.dynamics.bodies[id];
        if (b && b.enabled !== false && this.frames && this.frames.has(id)) {
          const arr = this.frames.get(id);
          const fpos = this.time * this.bakeFps;
          const i0 = Math.max(0, Math.min(this.frameCount - 1, Math.floor(fpos)));
          const i1 = Math.min(this.frameCount - 1, i0 + 1);
          const u = fpos - i0;
          const o0 = i0 * 7, o1 = i1 * 7;
          ox += arr[o0] + (arr[o1] - arr[o0]) * u;
          oy += arr[o0 + 1] + (arr[o1 + 1] - arr[o0 + 1]) * u;
          oz += arr[o0 + 2] + (arr[o1 + 2] - arr[o0 + 2]) * u;
          const qa = this._q.set(arr[o0 + 3], arr[o0 + 4], arr[o0 + 5], arr[o0 + 6]);
          const qb = new THREE.Quaternion(arr[o1 + 3], arr[o1 + 4], arr[o1 + 5], arr[o1 + 6]);
          quat = qa.clone().slerp(qb, u);
        }
        if (b && b.motor && b.motor.type && b.motor.type !== 'none') {
          const m = b.motor;
          const axis = new THREE.Vector3(
            m.axis === 'x' ? 1 : 0, m.axis === 'y' ? 1 : 0, m.axis === 'z' ? 1 : 0,
          );
          if (axis.lengthSq() === 0) axis.set(0, 0, 1);
          if (m.type === 'spin') {
            const ang = (m.rate || 60) * D2R * this.time;
            const mq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
            quat = quat ? quat.premultiply(mq) : mq;
          } else if (m.type === 'oscillate') {
            const ang = (m.amp || 30) * D2R * Math.sin(TAUf(m.freq ?? 0.5) * this.time + (m.phase || 0) * D2R);
            const mq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
            quat = quat ? quat.premultiply(mq) : mq;
          } else if (m.type === 'reciprocate') {
            const d = (m.amp || 30) * Math.sin(TAUf(m.freq ?? 0.5) * this.time + (m.phase || 0) * D2R);
            ox += axis.x * d; oy += axis.y * d; oz += axis.z * d;
          } else if (m.type === 'orbit') {
            const a = TAUf(m.freq ?? 0.25) * this.time + (m.phase || 0) * D2R;
            const rad = m.amp || 60;
            const u1 = new THREE.Vector3(), u2 = new THREE.Vector3();
            basisFor(axis, u1, u2);
            ox += (u1.x * Math.cos(a) + u2.x * Math.sin(a)) * rad;
            oy += (u1.y * Math.cos(a) + u2.y * Math.sin(a)) * rad;
            oz += (u1.z * Math.cos(a) + u2.z * Math.sin(a)) * rad;
            if (m.face) {
              const mq = new THREE.Quaternion().setFromAxisAngle(axis, a);
              quat = quat ? quat.premultiply(mq) : mq;
            }
          }
        }
      }

      /* --- compose: T(offset) · T(pivot) · R · S · T(-pivot) --- */
      if (!quat) {
        this._e.set(rx * D2R, ry * D2R, rz * D2R, 'XYZ');
        quat = new THREE.Quaternion().setFromEuler(this._e);
      } else if (rx || ry || rz) {
        this._e.set(rx * D2R, ry * D2R, rz * D2R, 'XYZ');
        quat = quat.clone().multiply(new THREE.Quaternion().setFromEuler(this._e));
      }

      const c = pv.centre;
      const m = this._m;
      m.compose(this._v.set(c.x + ox, c.y + oy, c.z + oz), quat, new THREE.Vector3(sx, sy, sz));
      m.multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));

      group.matrixAutoUpdate = false;
      group.matrix.copy(m);
      group.updateMatrixWorld(true);
      group.visible = visible;

      // opacity is per-material, so only touch it when the value actually moved
      const wantOpacity = Math.max(0, Math.min(1, opacity));
      if (group.userData.appliedOpacity !== wantOpacity) {
        group.userData.appliedOpacity = wantOpacity;
        for (const child of group.children) {
          if (!child.material) continue;
          if (child.userData.edge) { child.material.opacity = 0.42 * wantOpacity; continue; }
          child.material.transparent = wantOpacity < 1;
          child.material.opacity = wantOpacity;
          child.material.depthWrite = wantOpacity > 0.95;
          child.material.needsUpdate = true;
        }
      }
    }

    this.vp.invalidate();
    bus.emit(T.TIME, this.time);
  }

  /* --------------------------------------------------------- playback */

  play() {
    if (this.playing) return;
    this.playing = true;
    this._last = performance.now();
    bus.emit(T.SIM_STATE, { playing: true });
    const tick = (now) => {
      if (!this.playing) return;
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      let t = this.time + dt * (this.sim.speed || 1);
      if (t >= this.sim.duration) {
        if (this.sim.loop) t = t % this.sim.duration;
        else { t = this.sim.duration; this.pause(); }
      }
      this.seek(t);
      if (this.playing) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this._raf);
    bus.emit(T.SIM_STATE, { playing: false });
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  stop() { this.pause(); this.seek(0); }

  step(frames = 1) {
    const fps = this.sim.fps || 30;
    this.seek(this.time + frames / fps);
  }

  /* ------------------------------------------------------ key editing */

  setKey(featureId, prop, t, value, ease = 'smooth') {
    store.edit('Set keyframe', (doc) => {
      const tr = (doc.sim.tracks[featureId] = doc.sim.tracks[featureId] || {});
      const keys = (tr[prop] = tr[prop] || []);
      const existing = keys.find(k => Math.abs(k.t - t) < 1e-4);
      if (existing) { existing.v = value; existing.ease = ease; }
      else keys.push({ t, v: value, ease });
      sortTrack(keys);
    }, { rebuild: false });
  }

  removeKey(featureId, prop, t) {
    store.edit('Remove keyframe', (doc) => {
      const tr = doc.sim.tracks[featureId];
      if (!tr || !tr[prop]) return;
      tr[prop] = tr[prop].filter(k => Math.abs(k.t - t) > 1e-4);
      if (!tr[prop].length) delete tr[prop];
      if (!Object.keys(tr).length) delete doc.sim.tracks[featureId];
    }, { rebuild: false });
  }

  clearTracks(featureId) {
    store.edit('Clear animation', (doc) => { delete doc.sim.tracks[featureId]; }, { rebuild: false });
  }

  /** Write the current pose of a body as keyframes at the playhead. */
  keyCurrentPose(featureId) {
    const group = this.vp.bodies.get(featureId);
    if (!group) return;
    const pv = this.pivots.get(featureId);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    group.matrix.decompose(p, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    const c = pv ? pv.centre : new THREE.Vector3();
    const t = this.time;
    store.edit('Key pose', (doc) => {
      const tr = (doc.sim.tracks[featureId] = doc.sim.tracks[featureId] || {});
      const put = (prop, v) => {
        const keys = (tr[prop] = tr[prop] || []);
        const ex = keys.find(k => Math.abs(k.t - t) < 1e-4);
        if (ex) ex.v = v; else keys.push({ t, v, ease: 'smooth' });
        sortTrack(keys);
      };
      put('px', p.x - c.x); put('py', p.y - c.y); put('pz', p.z - c.z);
      put('rx', e.x / D2R); put('ry', e.y / D2R); put('rz', e.z / D2R);
      put('sx', s.x); put('sy', s.y); put('sz', s.z);
    }, { rebuild: false });
  }

  /** Turn the baked dynamics solution into editable keyframes. */
  bakeToKeys(step = 4) {
    this.ensureBaked();
    if (!this.frames) { bus.emit(T.TOAST, { msg: 'Enable dynamics first', kind: 'warn' }); return 0; }
    const fps = this.bakeFps;
    let n = 0;
    store.edit('Bake dynamics to keyframes', (doc) => {
      for (const [id, arr] of this.frames) {
        const tr = (doc.sim.tracks[id] = doc.sim.tracks[id] || {});
        for (const p of ['px', 'py', 'pz', 'rx', 'ry', 'rz']) tr[p] = [];
        for (let f = 0; f < this.frameCount; f += step) {
          const o = f * 7;
          const t = f / fps;
          const q = new THREE.Quaternion(arr[o + 3], arr[o + 4], arr[o + 5], arr[o + 6]);
          const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
          tr.px.push({ t, v: arr[o], ease: 'linear' });
          tr.py.push({ t, v: arr[o + 1], ease: 'linear' });
          tr.pz.push({ t, v: arr[o + 2], ease: 'linear' });
          tr.rx.push({ t, v: e.x / D2R, ease: 'linear' });
          tr.ry.push({ t, v: e.y / D2R, ease: 'linear' });
          tr.rz.push({ t, v: e.z / D2R, ease: 'linear' });
          n++;
        }
      }
      doc.sim.dynamics.enabled = false;
    }, { rebuild: false });
    return n;
  }

  /** Lay every body out along the timeline, in feature order. */
  autoSchedule({ perItem = 1, gap = 0.25, mode = 'grow' } = {}) {
    const ids = [...this.vp.bodies.keys()];
    store.edit('Auto-schedule build sequence', (doc) => {
      doc.sim.schedule.enabled = true;
      let t = 0;
      for (const id of ids) {
        doc.sim.schedule.items[id] = { start: t, dur: perItem, mode, enabled: true };
        t += perItem + gap;
      }
      doc.sim.duration = Math.round(Math.max(doc.sim.duration, t + 1) * 100) / 100;
    }, { rebuild: false });
    return ids.length;
  }
}

function TAUf(freqHz) { return Math.PI * 2 * (freqHz || 0); }

function basisFor(axis, u1, u2) {
  const a = axis.clone().normalize();
  const ref = Math.abs(a.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  u1.crossVectors(ref, a).normalize();
  u2.crossVectors(a, u1).normalize();
}
