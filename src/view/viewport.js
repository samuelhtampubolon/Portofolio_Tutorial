/**
 * The 3D viewport: renderer, cameras, lighting, grid, body management,
 * picking, transform gizmo, section clipping and measurement.
 *
 * World is Z-up. Everything rendered under `bodyRoot` mirrors the feature list
 * one-to-one: one THREE.Group per feature, one Mesh per pattern instance.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { TransformControls } from 'three/addons/TransformControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { bus, T } from '../core/bus.js';
import { store, MATERIALS } from '../core/doc.js';
import { featureEdges } from '../core/geometry.js';

const Z = new THREE.Vector3(0, 0, 1);

export class Viewport {
  constructor(host) {
    this.host = host;
    this.selection = new Set();
    this.bodies = new Map();       // featureId -> THREE.Group
    this.measurePts = [];
    this.measureMode = null;
    this.onSelect = null;
    this.onTransformEnd = null;
    this.onHover = null;
    this.onContext = null;
    this.onPointerMove = null;
    this._raf = 0;
    this._needsRender = true;
    this._init();
  }

  /* ------------------------------------------------------------- setup */

  _init() {
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();

    // cameras — both share the same target so toggling is seamless
    this.persp = new THREE.PerspectiveCamera(45, w / h, 0.5, 200000);
    this.persp.up.copy(Z);
    this.persp.position.set(220, -280, 200);

    this.ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -100000, 200000);
    this.ortho.up.copy(Z);
    this.ortho.position.copy(this.persp.position);

    this.camera = this.persp;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('change', () => this.invalidate());

    this._buildLights();
    this._buildHelpers();

    this.bodyRoot = new THREE.Group();
    this.scene.add(this.bodyRoot);

    this.overlay = new THREE.Group();
    this.overlay.renderOrder = 10;
    this.scene.add(this.overlay);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSpace('world');
    this.gizmo.setSize(0.85);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value && this.onTransformEnd) this.onTransformEnd();
    });
    this.gizmo.addEventListener('objectChange', () => {
      this.invalidate();
      if (this.onTransformDrag) this.onTransformDrag();
    });
    const helper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    this.scene.add(helper);
    this.gizmoHelper = helper;
    helper.visible = false;
    this.gizmo.enabled = false;

    this.gizmoProxy = new THREE.Object3D();
    this.scene.add(this.gizmoProxy);

    this.ray = new THREE.Raycaster();
    this.ray.params.Line.threshold = 2;
    this.pointer = new THREE.Vector2();

    this._bindInput();
    this._observe();
    this.setBackground('studio');
    this.start();
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xd8e4f0, 0x2a2f38, 1.1);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xffffff, 2.0);
    this.key.position.set(260, -340, 420);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    const c = this.key.shadow.camera;
    c.left = -500; c.right = 500; c.top = 500; c.bottom = -500; c.near = 1; c.far = 3000;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    this.fill = new THREE.DirectionalLight(0xbcd4ff, 0.45);
    this.fill.position.set(-320, 240, 160);
    this.scene.add(this.fill);

    this.rim = new THREE.DirectionalLight(0xffffff, 0.35);
    this.rim.position.set(0, 420, -260);
    this.scene.add(this.rim);
  }

  _buildHelpers() {
    this.helpers = new THREE.Group();
    this.scene.add(this.helpers);

    // ground grid, rebuilt when the extent changes
    this.gridSize = 1000;
    this._makeGrid(1000, 10);

    // world axes drawn as three coloured lines
    this.axes = new THREE.Group();
    const mk = (dir, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir]);
      const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
      const l = new THREE.Line(g, m);
      l.renderOrder = 3;
      return l;
    };
    this.axes.add(mk(new THREE.Vector3(90, 0, 0), 0xff5f56));
    this.axes.add(mk(new THREE.Vector3(0, 90, 0), 0x5ad469));
    this.axes.add(mk(new THREE.Vector3(0, 0, 90), 0x4da3ff));
    this.helpers.add(this.axes);

    // shadow-catching ground
    const gm = new THREE.ShadowMaterial({ opacity: 0.22 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), gm);
    this.ground.receiveShadow = true;
    this.ground.position.z = -0.02;
    this.scene.add(this.ground);
  }

  _makeGrid(size, divisions) {
    if (this.grid) { this.helpers.remove(this.grid); this.grid.geometry.dispose(); this.grid.material.dispose(); }
    const g = new THREE.GridHelper(size, divisions, 0x3a4557, 0x2a3240);
    g.rotation.x = Math.PI / 2;         // Y-up helper -> Z-up world
    g.material.transparent = true;
    g.material.opacity = 0.65;
    this.grid = g;
    this.gridSize = size;
    this.helpers.add(g);
  }

  _observe() {
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    // updateStyle must stay on: with it off the drawing buffer resizes but the
    // canvas keeps whatever CSS size it had at construction, so every later
    // layout change leaves an oversized canvas clipped by its container.
    this.renderer.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this._syncOrtho();
    this.invalidate();
  }

  _syncOrtho() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    const dist = this.persp.position.distanceTo(this.controls.target);
    const halfH = Math.tan((this.persp.fov * Math.PI) / 360) * dist;
    const halfW = halfH * (w / h);
    this.ortho.left = -halfW; this.ortho.right = halfW;
    this.ortho.top = halfH; this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
  }

  /* ----------------------------------------------------------- rendering */

  invalidate() { this._needsRender = true; }

  start() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const damping = this.controls.update();
      if (damping || this._needsRender) {
        this._needsRender = false;
        this._renderFrame();
      }
    };
    loop();
  }

  stop() { cancelAnimationFrame(this._raf); }

  _renderFrame() {
    if (this.camera === this.ortho) this._syncOrtho();
    this.renderer.render(this.scene, this.camera);
    bus.emit(T.VIEW, this);
  }

  /* ------------------------------------------------------------- bodies */

  _material(feature) {
    const a = feature.appearance || {};
    const mat = MATERIALS[feature.material] || MATERIALS.steel;
    const shading = store.doc.view.shading;
    const common = {
      color: new THREE.Color(a.color || mat.color),
      metalness: a.metalness ?? mat.metal,
      roughness: a.roughness ?? mat.rough,
      transparent: (a.opacity ?? 1) < 1 || shading === 'xray',
      opacity: shading === 'xray' ? Math.min(a.opacity ?? 1, 0.32) : (a.opacity ?? 1),
      side: THREE.DoubleSide,
      clippingPlanes: this.clipPlanes || null,
      clipShadows: true,
      envMapIntensity: 0.9,
      flatShading: false,
      // push faces very slightly back so the edge overlay cannot z-fight
      polygonOffset: shading === 'shaded-edges',
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    };
    if (shading === 'wire') {
      return new THREE.MeshBasicMaterial({ color: common.color, wireframe: true, clippingPlanes: this.clipPlanes || null });
    }
    const m = new THREE.MeshStandardMaterial(common);
    m.depthWrite = !common.transparent || common.opacity > 0.95;
    return m;
  }

  _edgeMaterial() {
    return new THREE.LineBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.42,
      clippingPlanes: this.clipPlanes || null,
    });
  }

  /** Rebuild the render tree from an engine result. */
  syncBodies(build) {
    const { results, consumed } = build;
    this.modelBox = build.stats && build.stats.box ? build.stats.box.clone() : null;
    const keep = new Set();
    const showEdges = store.doc.view.shading === 'shaded-edges';

    for (const f of store.doc.features) {
      if (consumed.has(f.id) || f.suppressed) continue;
      const res = results.get(f.id);
      if (!res || res.error || !res.instances.length) continue;
      keep.add(f.id);

      let group = this.bodies.get(f.id);
      const sig = res.instances.map(i => i.geometry.uuid).join(',') + '|' + showEdges;
      if (group && group.userData.sig !== sig) { this._disposeGroup(group); group = null; }

      if (!group) {
        group = new THREE.Group();
        group.userData = { featureId: f.id, sig, base: null };
        for (const inst of res.instances) {
          const mesh = new THREE.Mesh(inst.geometry, this._material(f));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(inst.matrix);
          mesh.userData = { featureId: f.id, pickable: true };
          group.add(mesh);
          if (showEdges) {
            const eg = featureEdges(inst.geometry, this.edgeAngle || 24);
            const line = new THREE.LineSegments(eg, this._edgeMaterial());
            line.matrixAutoUpdate = false;
            line.matrix.copy(inst.matrix);
            line.userData = { edge: true };
            line.raycast = () => {};
            group.add(line);
          }
        }
        this.bodies.set(f.id, group);
        this.bodyRoot.add(group);
      } else {
        // geometry unchanged: refresh instance matrices and material only
        let k = 0;
        for (const child of group.children) {
          if (child.userData.edge) continue;
          const inst = res.instances[k++];
          if (inst) { child.matrix.copy(inst.matrix); }
        }
        let e = 0;
        for (const child of group.children) {
          if (!child.userData.edge) continue;
          const inst = res.instances[e++];
          if (inst) child.matrix.copy(inst.matrix);
        }
        this._applyMaterial(group, f);
      }
      group.visible = f.visible !== false;
    }

    for (const [id, group] of [...this.bodies]) {
      if (!keep.has(id)) { this._disposeGroup(group); this.bodies.delete(id); }
    }

    this._refreshSelectionVisuals();
    this.invalidate();
  }

  _applyMaterial(group, feature) {
    for (const child of group.children) {
      if (child.userData.edge) continue;
      const old = child.material;
      child.material = this._material(feature);
      if (old && old !== child.material) old.dispose();
    }
  }

  refreshMaterials() {
    for (const [id, group] of this.bodies) {
      const f = store.feature(id);
      if (f) this._applyMaterial(group, f);
    }
    this._refreshSelectionVisuals();
    this.invalidate();
  }

  _disposeGroup(group) {
    group.traverse(o => {
      if (o.isMesh || o.isLineSegments) {
        if (o.userData.edge && o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      }
    });
    this.bodyRoot.remove(group);
  }

  /* ---------------------------------------------------------- selection */

  setSelection(ids) {
    this.selection = new Set(ids);
    this._refreshSelectionVisuals();
    this._attachGizmo();
    this.invalidate();
  }

  _refreshSelectionVisuals() {
    for (const [id, group] of this.bodies) {
      const on = this.selection.has(id);
      for (const child of group.children) {
        if (child.userData.edge) {
          child.material.color.set(on ? 0xff9f1c : 0x000000);
          child.material.opacity = on ? 0.95 : 0.42;
        } else if (child.material && child.material.emissive) {
          // a hint of warmth, not a recolour — the orange edge overlay is the
          // real selection signal, and it reads on both themes
          child.material.emissive.set(on ? 0x6b3a00 : 0x000000);
          child.material.emissiveIntensity = on ? 0.26 : 0;
        }
      }
      // selection box for bodies without an edge overlay
      if (store.doc.view.shading !== 'shaded-edges') {
        if (on && !group.userData.selBox) {
          const box = new THREE.BoxHelper(group, 0xff9f1c);
          box.userData.edge = true;
          box.raycast = () => {};
          group.add(box);
          group.userData.selBox = box;
        } else if (!on && group.userData.selBox) {
          group.remove(group.userData.selBox);
          group.userData.selBox.geometry.dispose();
          group.userData.selBox = null;
        }
      }
    }
  }

  /* -------------------------------------------------------------- gizmo */

  setGizmoMode(mode) {
    this.gizmoMode = mode;                 // null | 'translate' | 'rotate' | 'scale'
    this._attachGizmo();
  }

  _attachGizmo() {
    const ids = [...this.selection];
    const single = ids.length === 1 ? this.bodies.get(ids[0]) : null;
    if (!this.gizmoMode || !single) {
      this.gizmo.detach();
      this.gizmo.enabled = false;
      this.gizmoHelper.visible = false;
      this.invalidate();
      return;
    }
    const f = store.feature(ids[0]);
    if (!f) return;
    this.gizmoProxy.position.set(...f.transform.pos.map(Number));
    this.gizmoProxy.rotation.set(
      THREE.MathUtils.degToRad(Number(f.transform.rot[0]) || 0),
      THREE.MathUtils.degToRad(Number(f.transform.rot[1]) || 0),
      THREE.MathUtils.degToRad(Number(f.transform.rot[2]) || 0),
    );
    this.gizmoProxy.scale.set(...(f.transform.scale || [1, 1, 1]).map(v => Number(v) || 1));
    this.gizmo.attach(this.gizmoProxy);
    this.gizmo.setMode(this.gizmoMode);
    this.gizmo.enabled = true;
    this.gizmoHelper.visible = true;
    this.invalidate();
  }

  readGizmo() {
    const p = this.gizmoProxy;
    return {
      pos: [p.position.x, p.position.y, p.position.z],
      rot: [THREE.MathUtils.radToDeg(p.rotation.x), THREE.MathUtils.radToDeg(p.rotation.y), THREE.MathUtils.radToDeg(p.rotation.z)],
      scale: [p.scale.x, p.scale.y, p.scale.z],
    };
  }

  /* -------------------------------------------------------------- input */

  _bindInput() {
    const el = this.renderer.domElement;
    let down = null;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });

    el.addEventListener('pointermove', (e) => {
      this._updatePointer(e);
      if (this.onPointerMove) this.onPointerMove(e);
      if (this.measureMode) this.invalidate();
      // Skip the hover raycast while orbiting or dragging the gizmo.
      if (this.onHover && !down && !this.gizmo.dragging && e.buttons === 0) {
        const hit = this.pick();
        this.onHover(hit, this._worldPoint(hit));
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || this.gizmo.dragging) return;
      this._updatePointer(e);
      const hit = this.pick();
      if (this.measureMode) { this._measureClick(hit); return; }
      if (this.onSelect) this.onSelect(hit ? hit.object.userData.featureId : null, e.shiftKey || e.ctrlKey || e.metaKey);
    });

    el.addEventListener('dblclick', () => { if (this.selection.size) this.frameSelection(); });

    let rightDown = null;
    el.addEventListener('pointerdown', (e) => { if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // a right-drag is a pan, not a menu
      if (rightDown && Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) > 4) { rightDown = null; return; }
      rightDown = null;
      if (!this.onContext) return;
      this._updatePointer(e);
      this.onContext(e, this.pick());
    });
  }

  _updatePointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  pick() {
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(this.bodyRoot.children, true);
    for (const h of hits) {
      if (!h.object.userData.pickable) continue;
      if (this.clipPlanes && this.clipPlanes.some(p => p.distanceToPoint(h.point) < 0)) continue;
      return h;
    }
    return null;
  }

  _worldPoint(hit) { return hit ? hit.point.clone() : null; }

  /* --------------------------------------------------------- measuring */

  setMeasureMode(mode) {
    this.measureMode = mode;                // null | 'distance' | 'angle' | 'point'
    this.measurePts = [];
    this._clearMeasure();
    this.renderer.domElement.style.cursor = mode ? 'crosshair' : '';
    bus.emit(T.STATUS, mode ? `Measure ${mode}: click points on the model (Esc to finish)` : 'Ready');
  }

  _measureClick(hit) {
    if (!hit) return;
    this.measurePts.push(hit.point.clone());
    const need = this.measureMode === 'angle' ? 3 : this.measureMode === 'point' ? 1 : 2;
    if (this.measurePts.length >= need) {
      this._drawMeasure();
      const r = this.measureResult();
      bus.emit('measure:result', r);
      this.measurePts = [];
    } else {
      this._drawMeasure();
    }
    this.invalidate();
  }

  measureResult() {
    const p = this.lastMeasure || [];
    if (this.measureMode === 'distance' && p.length >= 2) {
      const d = p[0].distanceTo(p[1]);
      return { kind: 'distance', value: d, delta: p[1].clone().sub(p[0]), points: p };
    }
    if (this.measureMode === 'angle' && p.length >= 3) {
      const a = p[0].clone().sub(p[1]).normalize();
      const b = p[2].clone().sub(p[1]).normalize();
      return { kind: 'angle', value: THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1))), points: p };
    }
    if (this.measureMode === 'point' && p.length >= 1) return { kind: 'point', point: p[0], points: p };
    return null;
  }

  _clearMeasure() {
    if (this.measureGroup) {
      this.measureGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.overlay.remove(this.measureGroup);
      this.measureGroup = null;
    }
  }

  _drawMeasure() {
    this._clearMeasure();
    this.lastMeasure = this.measurePts.map(p => p.clone());
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0xff9f1c, depthTest: false, transparent: true });
    const dot = new THREE.MeshBasicMaterial({ color: 0xff9f1c, depthTest: false });
    const scale = this._pixelScale();
    for (const p of this.measurePts) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(scale * 4, 12, 8), dot);
      s.position.copy(p); s.renderOrder = 20; s.raycast = () => {};
      g.add(s);
    }
    if (this.measurePts.length >= 2) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.measurePts), mat);
      line.renderOrder = 20; line.raycast = () => {};
      g.add(line);
    }
    this.measureGroup = g;
    this.overlay.add(g);
  }

  _pixelScale() {
    const d = this.camera.position.distanceTo(this.controls.target);
    return (d * Math.tan((this.persp.fov * Math.PI) / 360) * 2) / (this.host.clientHeight || 600);
  }

  /* ---------------------------------------------------------- view state */

  setBackground(kind) {
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    const map = {
      studio: dark ? 0x0a0d12 : 0xe7ebf1,
      graphite: dark ? 0x15181d : 0xd6dbe3,
      white: dark ? 0x22262c : 0xffffff,
      blueprint: dark ? 0x0b1f3a : 0x1b3a66,
    };
    const c = map[kind] ?? map.studio;
    this.scene.background = new THREE.Color(c);
    this.bgKind = kind;
    this.invalidate();
  }

  setGrid(on) { this.grid.visible = !!on; this.invalidate(); }
  setAxes(on) { this.axes.visible = !!on; this.invalidate(); }
  setGround(on) { this.ground.visible = !!on; this.invalidate(); }

  setOrtho(on) {
    const target = on ? this.ortho : this.persp;
    if (target === this.camera) return;
    target.position.copy(this.camera.position);
    target.quaternion.copy(this.camera.quaternion);
    this.camera = target;
    this.controls.object = target;
    this.gizmo.camera = target;
    this._syncOrtho();
    this.controls.update();
    this.invalidate();
  }

  setClipping(cfg) {
    if (!cfg || !cfg.enabled) {
      this.clipPlanes = null;
    } else {
      const n = new THREE.Vector3(
        cfg.axis === 'x' ? 1 : 0, cfg.axis === 'y' ? 1 : 0, cfg.axis === 'z' ? 1 : 0,
      ).multiplyScalar(cfg.flip ? -1 : 1);
      this.clipPlanes = [new THREE.Plane(n, cfg.flip ? cfg.pos : -cfg.pos)];
    }
    this.refreshMaterials();
  }

  /* -------------------------------------------------------- view presets */

  /**
   * Bounds of the model as it is *modelled*, not as it is currently posed.
   * During a simulation bodies can be scaled to nothing or flung across the
   * scene, and framing on that would be useless, so the rebuild's own bounding
   * box wins whenever it is available.
   */
  worldBox() {
    if (this.modelBox && !this.modelBox.isEmpty()) return this.modelBox.clone();
    const box = new THREE.Box3();
    box.makeEmpty();
    for (const [, g] of this.bodies) if (g.visible) box.expandByObject(g);
    return box;
  }

  frameAll(margin = 1.35) { this.resize(); this._frame(this.worldBox(), margin); }

  frameSelection(margin = 1.6) {
    this.resize();
    const box = new THREE.Box3(); box.makeEmpty();
    for (const id of this.selection) { const g = this.bodies.get(id); if (g) box.expandByObject(g); }
    const size = new THREE.Vector3();
    if (!box.isEmpty()) box.getSize(size);
    // a body mid-way through a "grow" animation has no useful size
    if (box.isEmpty() || size.length() < 1e-2) this._frame(this.worldBox(), margin);
    else this._frame(box, margin);
  }

  _frame(box, margin) {
    if (box.isEmpty()) {
      this.controls.target.set(0, 0, 0);
      this.persp.position.set(220, -280, 200);
      this.ortho.position.copy(this.persp.position);
      this.controls.update();
      this.autoGrid(200);
      this.invalidate();
      return;
    }
    const c = new THREE.Vector3(), s = new THREE.Vector3();
    box.getCenter(c); box.getSize(s);
    const radius = Math.max(s.length() / 2, 1);
    /* The camera's field of view is vertical, so on a portrait viewport the
       horizontal extent is the binding constraint and framing on the vertical
       one alone pushes the model off both sides. Divide by the aspect ratio
       whenever it is below 1 to back the camera off far enough. */
    const aspect = Math.max(0.05, (this.host.clientWidth || 1) / (this.host.clientHeight || 1));
    const dist = (radius * margin) / Math.tan((this.persp.fov * Math.PI) / 360) / Math.min(1, aspect);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, -1.2, 0.85);
    dir.normalize().multiplyScalar(dist);
    this.controls.target.copy(c);
    this.persp.position.copy(c).add(dir);
    this.ortho.position.copy(this.persp.position);
    this.persp.near = Math.max(0.1, dist / 1000);
    this.persp.far = dist * 100;
    this.persp.updateProjectionMatrix();
    this.controls.update();
    this.autoGrid(Math.max(s.x, s.y, s.z));
    this.invalidate();
  }

  autoGrid(extent) {
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const want = Math.max(50, extent * 3);
    const size = nice.find(n => n >= want) || nice[nice.length - 1];
    if (size !== this.gridSize) this._makeGrid(size, Math.max(4, Math.round(size / (size / 10))));
    const c = this.controls.target;
    this.grid.position.set(Math.round(c.x / (size / 10)) * (size / 10), Math.round(c.y / (size / 10)) * (size / 10), 0);
  }

  standardView(name) {
    const box = this.worldBox();
    const c = new THREE.Vector3();
    if (box.isEmpty()) c.set(0, 0, 0); else box.getCenter(c);
    const d = Math.max(this.camera.position.distanceTo(this.controls.target), 10);
    const dirs = {
      front: [0, -1, 0], back: [0, 1, 0],
      left: [-1, 0, 0], right: [1, 0, 0],
      top: [0, 0, 1], bottom: [0, 0, -1],
      iso: [1, -1, 0.85], iso2: [-1, -1, 0.85],
      dimetric: [1, -1.6, 0.7],
    };
    const v = dirs[name] || dirs.iso;
    const dir = new THREE.Vector3(...v).normalize().multiplyScalar(d);
    this.controls.target.copy(c);
    this.persp.position.copy(c).add(dir);
    this.ortho.position.copy(this.persp.position);
    // keep the up vector sane when looking straight down
    this.persp.up.copy(name === 'top' || name === 'bottom' ? new THREE.Vector3(0, 1, 0) : Z);
    this.ortho.up.copy(this.persp.up);
    this.controls.update();
    this.frameAll();
  }

  snapshot(scale = 2) {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const oldRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(scale, 4));
    this.renderer.setSize(w, h, false);
    this._renderFrame();
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(oldRatio);
    this.renderer.setSize(w, h, false);
    this.invalidate();
    return url;
  }

  dispose() {
    this.stop();
    this.ro.disconnect();
    this.renderer.dispose();
    this.host.innerHTML = '';
  }
}
