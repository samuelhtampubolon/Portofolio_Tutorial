/**
 * TesserCAD — application controller.
 *
 * Wires the document store, the geometry engine, the three workspaces
 * (Model / Draft / Simulate) and the whole command surface together.
 */
import * as THREE from 'three';
import { bus, T } from './core/bus.js';
import {
  store, newDocument, makeFeature, makeLayer, catalogOf, CATALOG, MATERIALS,
  saveLocal, loadLocal, clearLocal, APP_NAME, APP_VERSION, FILE_EXT, UNITS, toDisplay, uid,
} from './core/doc.js';
import { rebuild, invalidateCache, massProperties } from './core/rebuild.js';
import { evalSafe } from './core/expr.js';
import { Viewport } from './view/viewport.js';
import { Draft2D, DRAW_TOOLS, fmt, rotateEntity, scaleEntity, mirrorEntity, entityBBox } from './draft/draft.js';
import { Simulator } from './sim/sim.js';
import { recordTimeline, recordingSupported } from './sim/recorder.js';
import * as IO from './io/io.js';
import {
  el, $, clear, toast, status, modal, closeModal, isModalOpen, confirmDialog,
  promptDialog, dropdown, closeDropdown, commandPalette,
} from './ui/shell.js';
import { renderLeftPanel } from './ui/tree.js';
import { renderRightPanel } from './ui/inspector.js';
import { TimelineUI } from './ui/timelineui.js';

/* ==================================================================
   Application
   ================================================================== */

class App {
  constructor() {
    this.workspace = 'model';
    this.selection = new Set();
    this.build = null;
    this.defaultEase = 'smooth';
    this.gizmoMode = 'translate';
    this._rebuildTimer = 0;
  }

  boot() {
    this.vp = new Viewport($('#viewport3d'));
    this.draft = new Draft2D($('#viewport2d'));
    this.sim = new Simulator(this.vp);
    this.timeline = new TimelineUI(this);

    this.vp.onSelect = (id, additive) => this.select(id ? [id] : [], additive);
    this.vp.onTransformEnd = () => this.commitGizmo();
    this.vp.onTransformDrag = () => this.previewGizmo();
    this.draft.onStatus = (s) => this.draftStatus(s);
    this.draft.onEntityAdded = () => this.refreshUI();
    this.draft.onTextRequest = (place) => promptDialog('Add text', 'Text', '', (v) => { place(v); this.refreshUI(); },
      { placeholder: 'PLATE A', help: 'Height comes from “Text / dim size” in the right panel.' });

    this.buildCommands();
    this.buildMenus();
    this.buildViewCube();
    this.bindGlobalUI();
    this.bindKeys();
    this.bindFiles();

    bus.on(T.DOC_CHANGED, () => this.onDocChanged());
    bus.on(T.DOC_TOUCHED, () => this.refreshUI());
    bus.on(T.SELECTION, (p) => { if (p.source === 'draft') this.refreshUI(); });
    bus.on('measure:result', (r) => this.showMeasure(r));

    this.restoreOrWelcome();
    this.setWorkspace('model');
    this.rebuildNow();
    this.vp.frameAll();
    this.draft.start();
    this.draft.resize();

    setInterval(() => { if (store.dirty) { saveLocal(); this.markSaved(); } }, 20000);
    addEventListener('beforeunload', (e) => {
      saveLocal();
      if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    addEventListener('resize', () => { this.draft.resize(); this.vp.resize(); });

    $('#boot').classList.add('gone');
    setTimeout(() => $('#boot').remove(), 400);
  }

  /* ------------------------------------------------------- document ops */

  restoreOrWelcome() {
    const saved = loadLocal();
    if (saved && saved.doc && (saved.doc.features?.length || saved.doc.draw?.entities?.length)) {
      try {
        store.load(saved.doc, { markClean: false });
        const when = new Date(saved.at).toLocaleString();
        toast(`Restored your last session (${when})`, 'ok', 5000);
        return;
      } catch (e) { console.warn('restore failed', e); }
    }
    store.load(this.sampleDocument());
    let seen = false;
    try { seen = localStorage.getItem('tessercad.seenWelcome') === '1'; } catch { /* ignore */ }
    if (!seen) {
      setTimeout(() => {
        this.showWelcome();
        try { localStorage.setItem('tessercad.seenWelcome', '1'); } catch { /* ignore */ }
      }, 600);
    }
  }

  sampleDocument() {
    const doc = newDocument('Demo bracket');
    doc.params = [
      { id: uid('p'), name: 'plate_w', value: 120, note: 'Plate width' },
      { id: uid('p'), name: 'plate_d', value: 70, note: 'Plate depth' },
      { id: uid('p'), name: 'thick', value: 10, note: 'Plate thickness' },
      { id: uid('p'), name: 'bore', value: 9, note: 'Bolt hole radius' },
    ];
    const plate = makeFeature('plate', {
      name: 'Base plate', material: 'aluminium',
      params: { w: 'plate_w', d: 'plate_d', h: 'thick', fillet: 12, hole: 0, seg: 10 },
      pos: [0, 0, 'thick/2'],
    });
    const boss = makeFeature('cylinder', {
      name: 'Boss', material: 'aluminium',
      params: { r: 22, h: 34, seg: 48, arc: 360 },
      pos: [0, 0, 'thick + 17'],
    });
    const bore = makeFeature('cylinder', {
      name: 'Centre bore', material: 'steel',
      params: { r: 12, h: 90, seg: 48, arc: 360 },
      pos: [0, 0, 20],
    });
    const hole = makeFeature('cylinder', {
      name: 'Bolt hole', material: 'steel',
      params: { r: 'bore', h: 'thick*3', seg: 32, arc: 360 },
      pos: ['plate_w/2 - 18', 'plate_d/2 - 16', 'thick/2'],
    });
    const holes = makeFeature('patternLinear', {
      name: 'Bolt pattern',
      params: { dx: '-(plate_w - 36)', dy: 0, dz: 0, count: 2, dx2: 0, dy2: '-(plate_d - 32)', dz2: 0, count2: 2 },
      inputs: [hole.id],
    });
    const merged = makeFeature('boolean', { name: 'Bracket', params: { op: 'union' }, inputs: [plate.id, boss.id], material: 'aluminium' });
    const cut = makeFeature('boolean', { name: 'Drilled bracket', params: { op: 'subtract' }, inputs: [merged.id, bore.id, holes.id], material: 'aluminium' });
    doc.features = [plate, boss, bore, hole, holes, merged, cut];
    doc.sim.duration = 8;
    return doc;
  }

  onDocChanged() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => this.rebuildNow(), 8);
  }

  rebuildNow() {
    const t0 = performance.now();
    try {
      this.build = rebuild(store.doc);
    } catch (err) {
      console.error(err);
      toast(`Rebuild failed: ${err.message}`, 'err', 6000);
      return;
    }
    this.buildMs = performance.now() - t0;
    this.vp.syncBodies(this.build);
    this.sim.refreshPivots();
    this.sim.bakeKey = '';
    if (this.workspace === 'sim') this.sim.seek(this.sim.time); else this.sim.reset();
    this.applyView();
    this.refreshUI();
    this.timeline.render();
  }

  refreshBodies(hard = false) {
    if (hard) { invalidateCache(); this.rebuildNow(); return; }
    this.vp.syncBodies(this.build || rebuild(store.doc));
    this.vp.refreshMaterials();
    this.refreshUI();
  }

  refreshSim() {
    this.sim.refreshPivots();
    if (this.workspace === 'sim') this.sim.seek(this.sim.time);
    this.timeline.render();
  }

  refreshUI() {
    renderLeftPanel(this);
    renderRightPanel(this);
    this.updateStatus();
    $('#btnUndo').disabled = !store.canUndo();
    $('#btnRedo').disabled = !store.canRedo();
    $('#docDirty').classList.toggle('on', store.dirty);
    const name = $('#docName');
    if (document.activeElement !== name) name.value = store.doc.meta.name;
    this.updateToolbarState();
  }

  markSaved() { $('#docDirty').classList.remove('on'); }

  updateStatus() {
    const s = this.build?.stats;
    const u = store.doc.meta.units;
    $('#statusUnits').textContent = `units: ${u}`;
    if (this.workspace === 'draft') {
      $('#statusStats').textContent = `${store.doc.draw.entities.length} objects · ${store.doc.draw.layers.length} layers`;
    } else if (s) {
      $('#statusStats').textContent = `${s.bodies} bodies · ${s.tris.toLocaleString()} tris · ${fmt(s.mass, 3)} kg · rebuild ${Math.round(this.buildMs || 0)} ms`;
    }
  }

  draftStatus({ coords, prompt, snap }) {
    $('#statusCoords').textContent = coords;
    if (this.workspace === 'draft') status(prompt ? `${prompt}${snap ? `  ·  snap: ${snap}` : ''}` : 'Ready');
  }

  /* ------------------------------------------------------- workspaces */

  setWorkspace(ws) {
    this.workspace = ws;
    for (const b of document.querySelectorAll('.ws')) b.setAttribute('aria-selected', String(b.dataset.ws === ws));
    const is3d = ws !== 'draft';
    $('#viewport3d').style.display = is3d ? '' : 'none';
    $('#viewport2d').hidden = is3d;
    $('#viewcube').style.display = is3d ? '' : 'none';
    $('#axisHint').style.display = is3d ? '' : 'none';
    $('#hud').textContent = '';
    this.setTimelineVisible(ws === 'sim');
    if (is3d) { this.vp.resize(); this.vp.invalidate(); } else { this.draft.resize(); }
    if (ws === 'sim') { this.sim.refreshPivots(); this.sim.seek(this.sim.time); this.timeline.render(); }
    else { this.sim.pause(); this.sim.reset(); }
    this.vp.setGizmoMode(ws === 'model' ? this.gizmoMode : null);
    this.buildToolbar();
    this.refreshUI();
    bus.emit(T.WORKSPACE, ws);
    status(WS_HINTS[ws]);
  }

  setTimelineVisible(v) {
    $('#timeline').hidden = !v;
    if (v) setTimeout(() => this.timeline.layout(), 30);
    setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 40);
  }

  /* -------------------------------------------------------- selection */

  select(ids, additive = false) {
    if (this.workspace === 'draft') {
      if (!additive) this.draft.selection.clear();
      for (const id of ids) this.draft.selection.add(id);
      this.draft.invalidate();
      this.refreshUI();
      return;
    }
    if (!additive) this.selection.clear();
    for (const id of ids) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.vp.setSelection([...this.selection]);
    bus.emit(T.SELECTION, { source: 'model', ids: [...this.selection] });
    this.refreshUI();
    this.timeline.render();
  }

  selected() { return [...this.selection].map(id => store.feature(id)).filter(Boolean); }

  /* --------------------------------------------------- feature editing */

  addFeature(type, extra = {}) {
    const cat = catalogOf(type);
    const f = makeFeature(type, extra);
    f.name = store.uniqueName(cat.label);
    // sit new solids on the ground plane
    if (cat.group === 'solid' && !extra.pos) {
      const h = f.params.h ?? f.params.pitch ?? 0;
      const r = f.params.r ?? f.params.R ?? f.params.ro ?? 0;
      f.transform.pos = [0, 0, type === 'sphere' ? r : (type === 'torus' ? (f.params.r || 0) : (h || r) / 2)];
    }
    store.edit(`Add ${cat.label}`, (doc) => { doc.features.push(f); });
    this.select([f.id]);
    toast(`${f.name} added`, 'ok', 1800);
    return f;
  }

  addBoolean(op) {
    const ids = [...this.selection];
    if (ids.length < 2) { toast('Select two or more bodies first', 'warn'); return; }
    const ordered = store.doc.features.filter(f => ids.includes(f.id)).map(f => f.id);
    const first = store.feature(ordered[0]);
    const f = makeFeature('boolean', { params: { op }, inputs: ordered, material: first?.material });
    f.name = store.uniqueName(op === 'union' ? 'Union' : op === 'subtract' ? 'Cut' : 'Common');
    if (first) f.appearance.color = first.appearance.color;
    store.edit(`Boolean ${op}`, (doc) => {
      const last = Math.max(...ordered.map(id => doc.features.findIndex(x => x.id === id)));
      doc.features.splice(last + 1, 0, f);
    });
    this.select([f.id]);
  }

  addModifier(type) {
    const ids = [...this.selection];
    if (ids.length !== 1) { toast('Select exactly one body', 'warn'); return; }
    const src = store.feature(ids[0]);
    const f = makeFeature(type, { inputs: [src.id], material: src.material });
    f.name = store.uniqueName(catalogOf(type).label);
    f.appearance.color = src.appearance.color;
    store.edit(`Add ${catalogOf(type).label}`, (doc) => {
      const i = doc.features.findIndex(x => x.id === src.id);
      doc.features.splice(i + 1, 0, f);
    });
    this.select([f.id]);
  }

  deleteSelection() {
    if (this.workspace === 'draft') { this.draft.deleteSelection(); this.refreshUI(); return; }
    const ids = new Set(this.selection);
    if (!ids.size) return;
    store.edit('Delete features', (doc) => {
      doc.features = doc.features.filter(f => !ids.has(f.id));
      for (const f of doc.features) f.inputs = f.inputs.filter(i => !ids.has(i));
      for (const id of ids) { delete doc.sim.tracks[id]; delete doc.sim.schedule.items[id]; delete doc.sim.dynamics.bodies[id]; }
    });
    this.selection.clear();
    this.vp.setSelection([]);
    this.refreshUI();
  }

  duplicateSelection() {
    if (this.workspace === 'draft') { this.draft.duplicateSelection(); this.refreshUI(); return; }
    const ids = [...this.selection];
    if (!ids.length) return;
    const added = [];
    store.edit('Duplicate features', (doc) => {
      for (const id of ids) {
        const src = doc.features.find(f => f.id === id);
        if (!src) continue;
        const copy = structuredClone(src);
        copy.id = uid();
        copy.name = store.uniqueName(`${src.name} copy`);
        copy.inputs = [];       // a copy is a standalone body
        copy.transform.pos = copy.transform.pos.map(v => (typeof v === 'number' ? v : v));
        doc.features.push(copy);
        added.push(copy.id);
      }
    });
    this.select(added);
  }

  reorderFeature(srcId, targetId) {
    store.edit('Reorder features', (doc) => {
      const from = doc.features.findIndex(f => f.id === srcId);
      const to = doc.features.findIndex(f => f.id === targetId);
      if (from < 0 || to < 0) return;
      const [f] = doc.features.splice(from, 1);
      doc.features.splice(to, 0, f);
    });
  }

  dropToFloor(id) {
    const res = this.build?.results.get(id);
    if (!res || !res.instances.length) return;
    let minZ = Infinity;
    for (const inst of res.instances) {
      const mp = massProperties(inst.geometry, inst.matrix);
      minZ = Math.min(minZ, mp.box.min.z);
    }
    if (!Number.isFinite(minZ)) return;
    const scope = this.build.scope;
    store.edit('Drop to floor', () => {
      const f = store.feature(id);
      f.transform.pos[2] = evalSafe(f.transform.pos[2], scope, 0) - minZ;
    });
  }

  centreOnOrigin(id) {
    const res = this.build?.results.get(id);
    if (!res || !res.instances.length) return;
    const mp = massProperties(res.instances[0].geometry, res.instances[0].matrix);
    const c = new THREE.Vector3();
    mp.box.getCenter(c);
    const scope = this.build.scope;
    store.edit('Centre on origin', () => {
      const f = store.feature(id);
      const p = f.transform.pos.map(v => evalSafe(v, scope, 0));
      f.transform.pos = [p[0] - c.x, p[1] - c.y, p[2] - c.z];
    });
  }

  /* ------------------------------------------------------------ gizmo */

  previewGizmo() {
    const ids = [...this.selection];
    if (ids.length !== 1) return;
    const g = this.vp.readGizmo();
    const group = this.vp.bodies.get(ids[0]);
    if (!group) return;
    const f = store.feature(ids[0]);
    const cur = { pos: f.transform.pos.map(v => evalSafe(v, this.build.scope, 0)) };
    group.matrixAutoUpdate = false;
    group.matrix.makeTranslation(g.pos[0] - cur.pos[0], g.pos[1] - cur.pos[1], g.pos[2] - cur.pos[2]);
    group.updateMatrixWorld(true);
    this.vp.invalidate();
  }

  commitGizmo() {
    const ids = [...this.selection];
    if (ids.length !== 1) return;
    const g = this.vp.readGizmo();
    const round = (v) => Math.round(v * 1e4) / 1e4;
    store.edit('Transform body', () => {
      const f = store.feature(ids[0]);
      if (this.gizmoMode === 'translate') f.transform.pos = g.pos.map(round);
      else if (this.gizmoMode === 'rotate') f.transform.rot = g.rot.map(round);
      else f.transform.scale = g.scale.map(round);
    });
  }

  setGizmo(mode) {
    this.gizmoMode = mode;
    this.vp.setGizmoMode(this.workspace === 'model' ? mode : null);
    this.buildToolbar();
  }

  /* ----------------------------------------------------- draft bridging */

  linkProfile(featureId) {
    const ids = [...this.draft.selection];
    if (!ids.length) { toast('Select geometry in the Draft workspace first', 'warn'); return; }
    store.edit('Link sketch profile', () => { store.feature(featureId).profile = ids; });
    toast(`${ids.length} object${ids.length > 1 ? 's' : ''} linked`, 'ok');
  }

  showProfile(featureId) {
    const f = store.feature(featureId);
    if (!f?.profile?.length) { toast('No profile linked', 'warn'); return; }
    this.setWorkspace('draft');
    this.draft.selection = new Set(f.profile);
    const boxes = f.profile.map(id => entityBBox(store.entity(id))).filter(Boolean);
    if (boxes.length) {
      const x1 = Math.min(...boxes.map(b => b[0])), y1 = Math.min(...boxes.map(b => b[1]));
      const x2 = Math.max(...boxes.map(b => b[2])), y2 = Math.max(...boxes.map(b => b[3]));
      this.draft.view.cx = (x1 + x2) / 2;
      this.draft.view.cy = (y1 + y2) / 2;
      this.draft.view.scale = Math.min(this.draft.w / Math.max(1, (x2 - x1) * 1.6), this.draft.h / Math.max(1, (y2 - y1) * 1.6));
    }
    this.draft.invalidate();
    this.refreshUI();
  }

  createFromProfile(kind) {
    const ids = [...this.draft.selection];
    if (!ids.length) { toast('Select closed geometry first', 'warn'); return; }
    const f = makeFeature(kind, { material: 'abs' });
    f.profile = ids;
    f.name = store.uniqueName(kind === 'extrude' ? 'Extrusion' : 'Revolution');
    store.edit(`Create ${kind}`, (doc) => { doc.features.push(f); });
    this.setWorkspace('model');
    this.select([f.id]);
    setTimeout(() => {
      const res = this.build?.results.get(f.id);
      if (res?.error) toast(res.error, 'err', 6000);
      else this.vp.frameAll();
    }, 60);
  }

  addLayer() {
    promptDialog('New layer', 'Name', `Layer ${store.doc.draw.layers.length}`, (v) => {
      const name = String(v || '').trim();
      if (!name) return;
      const l = makeLayer(name, randomColour());
      store.edit('Add layer', (d) => { d.draw.layers.push(l); d.draw.activeLayer = l.id; });
      this.refreshUI();
    });
  }

  deleteLayer(id) {
    const draw = store.doc.draw;
    if (draw.layers.length <= 1) { toast('The last layer cannot be deleted', 'warn'); return; }
    const n = draw.entities.filter(e => e.layer === id).length;
    const go = () => {
      store.edit('Delete layer', (d) => {
        d.draw.entities = d.draw.entities.filter(e => e.layer !== id);
        d.draw.layers = d.draw.layers.filter(l => l.id !== id);
        if (d.draw.activeLayer === id) d.draw.activeLayer = d.draw.layers[0].id;
      });
      this.refreshUI();
    };
    if (n) confirmDialog('Delete layer', `This removes the layer and its ${n} object${n > 1 ? 's' : ''}.`, go, { danger: true, yes: 'Delete' });
    else go();
  }

  rotateDraftSelection(deg) {
    const c = this.draftSelectionCentre();
    this.draft.transformSelection(`Rotate ${deg}°`, (e) => rotateEntity(e, c[0], c[1], deg));
    this.refreshUI();
  }

  scaleDraftSelection(k) {
    const c = this.draftSelectionCentre();
    this.draft.transformSelection(`Scale ×${k}`, (e) => scaleEntity(e, c[0], c[1], k));
    this.refreshUI();
  }

  mirrorDraftSelection(axis) {
    const c = this.draftSelectionCentre();
    this.draft.transformSelection(`Mirror ${axis.toUpperCase()}`, (e) => mirrorEntity(e, axis, axis === 'x' ? c[0] : c[1]));
    this.refreshUI();
  }

  draftSelectionCentre() {
    const boxes = [...this.draft.selection].map(id => entityBBox(store.entity(id))).filter(Boolean);
    if (!boxes.length) return [0, 0];
    const x1 = Math.min(...boxes.map(b => b[0])), y1 = Math.min(...boxes.map(b => b[1]));
    const x2 = Math.max(...boxes.map(b => b[2])), y2 = Math.max(...boxes.map(b => b[3]));
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }

  /* ---------------------------------------------------------- 4D tools */

  autoSchedule() {
    const n = this.sim.autoSchedule({ perItem: 1, gap: 0.3, mode: 'grow' });
    this.setWorkspace('sim');
    this.refreshSim();
    this.refreshUI();
    toast(`Sequenced ${n} bodies across the timeline`, 'ok');
  }

  bakeDynamics() {
    const n = this.sim.bakeToKeys(3);
    if (n) { this.refreshSim(); this.refreshUI(); toast(`Baked ${n} keyframes`, 'ok'); }
  }

  async recordVideo() {
    if (!recordingSupported()) { toast('This browser cannot record canvas video', 'err'); return; }
    this.setWorkspace('sim');
    const body = modal({
      title: 'Recording the timeline',
      body: [
        el('p', { text: 'Rendering every frame and encoding with the browser’s video encoder. Keep this tab in the foreground.' }),
        el('div', { class: 'row wide' }, [el('progress', { id: 'recProg', max: '1', value: '0', style: { width: '100%' } })]),
      ],
    });
    const prog = body.querySelector('#recProg');
    try {
      await recordTimeline(this.vp, this.sim, { fps: store.doc.sim.fps || 30, onProgress: (p) => { prog.value = p; } });
      closeModal();
    } catch (e) {
      closeModal();
      toast(`Recording failed: ${e.message}`, 'err', 6000);
    }
  }

  showMeasure(r) {
    if (!r) return;
    const u = store.doc.meta.units;
    if (r.kind === 'distance') {
      $('#hud').textContent = `distance ${fmt(toDisplay(r.value, u))} ${u}\nΔ ${fmt(toDisplay(r.delta.x, u))}, ${fmt(toDisplay(r.delta.y, u))}, ${fmt(toDisplay(r.delta.z, u))}`;
      toast(`Distance ${fmt(toDisplay(r.value, u))} ${u}`, 'ok', 6000);
    } else if (r.kind === 'angle') {
      $('#hud').textContent = `angle ${fmt(r.value)}°`;
      toast(`Angle ${fmt(r.value)}°`, 'ok', 6000);
    } else if (r.kind === 'point') {
      $('#hud').textContent = `point ${fmt(toDisplay(r.point.x, u))}, ${fmt(toDisplay(r.point.y, u))}, ${fmt(toDisplay(r.point.z, u))}`;
    }
  }

  /* -------------------------------------------------------------- view */

  applyView() {
    const v = store.doc.view;
    this.vp.setGrid(v.grid);
    this.vp.setAxes(v.axes);
    this.vp.setGround(v.ground);
    this.vp.setBackground(v.bg);
    this.vp.setOrtho(v.ortho);
    this.vp.setClipping(v.clip);
    this.draft.invalidate();
  }

  /* ==================================================================
     Commands
     ================================================================== */

  buildCommands() {
    const C = [];
    const add = (id, label, glyph, group, run, opts = {}) => C.push({ id, label, glyph, group, run, ...opts });

    /* file */
    add('file.new', 'New document', '✧', 'File', () => {
      confirmDialog('New document', 'Discard the current model and start over?', () => {
        clearLocal();
        store.load(newDocument('Untitled'));
        this.selection.clear();
        this.vp.frameAll();
      }, { danger: true, yes: 'New document' });
    }, { key: 'Ctrl+N' });
    add('file.save', 'Save project', '⤓', 'File', () => IO.saveProject(), { key: 'Ctrl+S' });
    add('file.open', 'Open project…', '⤒', 'File', () => this.pickFile('.tcad,.json'), { key: 'Ctrl+O' });
    add('file.import', 'Import STL / OBJ / DXF…', '⇩', 'File', () => this.pickFile(IO.IMPORT_ACCEPT));
    add('file.sample', 'Load the demo model', '★', 'File', () => {
      confirmDialog('Load demo', 'Replace the current document with the demo bracket?', () => {
        store.load(this.sampleDocument());
        this.vp.frameAll();
      });
    });

    /* export */
    add('export.stl', 'Export STL (binary)', '⬢', 'Export', () => IO.exportSTL(this.vp, { binary: true }));
    add('export.stlAscii', 'Export STL (ASCII)', '⬡', 'Export', () => IO.exportSTL(this.vp, { binary: false }));
    add('export.obj', 'Export OBJ', '◈', 'Export', () => IO.exportOBJ(this.vp));
    add('export.glb', 'Export glTF (.glb)', '◆', 'Export', () => IO.exportGLTF(this.vp, { binary: true }));
    add('export.ply', 'Export PLY', '◇', 'Export', () => IO.exportPLY(this.vp));
    add('export.dxf', 'Export drawing as DXF', '▤', 'Export', () => IO.exportDXF());
    add('export.svg', 'Export drawing as SVG', '▥', 'Export', () => IO.exportSVG());
    add('export.png', 'Export viewport PNG', '▣', 'Export', () => IO.exportPNG(this.vp, 2));
    add('export.bom', 'Export bill of materials (CSV)', '▦', 'Export', () => this.exportBOM());

    /* edit */
    add('edit.undo', 'Undo', '↶', 'Edit', () => store.undo(), { key: 'Ctrl+Z' });
    add('edit.redo', 'Redo', '↷', 'Edit', () => store.redo(), { key: 'Ctrl+Shift+Z' });
    add('edit.delete', 'Delete selection', '✕', 'Edit', () => this.deleteSelection(), { key: 'Del' });
    add('edit.duplicate', 'Duplicate selection', '⧉', 'Edit', () => this.duplicateSelection(), { key: 'Ctrl+D' });
    add('edit.selectAll', 'Select all', '▤', 'Edit', () => {
      if (this.workspace === 'draft') this.draft.selectAll();
      else this.select(store.doc.features.filter(f => !store.consumedIds().has(f.id)).map(f => f.id));
      this.refreshUI();
    }, { key: 'Ctrl+A' });

    /* solids */
    for (const [type, cat] of Object.entries(CATALOG)) {
      if (cat.group !== 'solid') continue;
      add(`add.${type}`, `Add ${cat.label.toLowerCase()}`, cat.glyph, 'Solids', () => this.addFeature(type));
    }

    /* combine */
    add('bool.union', 'Union selected', '⊕', 'Combine', () => this.addBoolean('union'));
    add('bool.subtract', 'Subtract selected', '⊖', 'Combine', () => this.addBoolean('subtract'));
    add('bool.intersect', 'Intersect selected', '⊗', 'Combine', () => this.addBoolean('intersect'));
    add('mod.linear', 'Linear pattern', '⋯', 'Combine', () => this.addModifier('patternLinear'));
    add('mod.circular', 'Circular pattern', '✳', 'Combine', () => this.addModifier('patternCircular'));
    add('mod.mirror', 'Mirror', '⇄', 'Combine', () => this.addModifier('mirror'));

    /* sketch */
    add('sketch.extrude', 'Extrude the draft selection', '⇧', 'Sketch', () => this.createFromProfile('extrude'));
    add('sketch.revolve', 'Revolve the draft selection', '⟳', 'Sketch', () => this.createFromProfile('revolve'));

    /* transform tools */
    add('gizmo.translate', 'Move tool', '✛', 'Transform', () => this.setGizmo('translate'), { key: 'G' });
    add('gizmo.rotate', 'Rotate tool', '⟲', 'Transform', () => this.setGizmo('rotate'), { key: 'R' });
    add('gizmo.scale', 'Scale tool', '⤢', 'Transform', () => this.setGizmo('scale'), { key: 'T' });
    add('gizmo.off', 'No gizmo', '⊘', 'Transform', () => this.setGizmo(null));

    /* view */
    add('view.fit', 'Zoom to fit', '⤢', 'View', () => (this.workspace === 'draft' ? this.draft.zoomExtents() : this.vp.frameAll()), { key: 'F' });
    add('view.selection', 'Zoom to selection', '⊙', 'View', () => this.vp.frameSelection());
    for (const [k, label] of [['iso', 'Isometric'], ['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']]) {
      add(`view.${k}`, `${label} view`, '▢', 'View', () => this.vp.standardView(k));
    }
    add('view.ortho', 'Toggle orthographic camera', '▱', 'View', () => {
      store.edit('Camera', (d) => { d.view.ortho = !d.view.ortho; }, { rebuild: false });
      this.applyView(); this.refreshUI();
    }, { key: 'O' });
    add('view.grid', 'Toggle grid', '▦', 'View', () => {
      store.edit('Grid', (d) => { d.view.grid = !d.view.grid; }, { rebuild: false });
      this.applyView(); this.refreshUI();
    });
    add('view.shading', 'Cycle shading mode', '◐', 'View', () => {
      const modes = ['shaded-edges', 'shaded', 'wire', 'xray'];
      const next = modes[(modes.indexOf(store.doc.view.shading) + 1) % modes.length];
      store.edit('Shading', (d) => { d.view.shading = next; }, { rebuild: false });
      this.refreshBodies(true);
      toast(`Shading: ${next}`, 'info', 1400);
    });
    add('view.theme', 'Toggle light / dark theme', '◑', 'View', () => this.toggleTheme());

    /* measure */
    add('measure.distance', 'Measure distance', '⟺', 'Measure', () => this.vp.setMeasureMode('distance'));
    add('measure.angle', 'Measure angle', '∠', 'Measure', () => this.vp.setMeasureMode('angle'));
    add('measure.point', 'Probe a point', '⌖', 'Measure', () => this.vp.setMeasureMode('point'));
    add('measure.off', 'Stop measuring', '⊘', 'Measure', () => { this.vp.setMeasureMode(null); $('#hud').textContent = ''; });

    /* simulation */
    add('sim.play', 'Play / pause the timeline', '▶', 'Simulate', () => { this.setWorkspace('sim'); this.sim.toggle(); }, { key: 'Space' });
    add('sim.rewind', 'Rewind to the start', '⏮', 'Simulate', () => this.sim.seek(0));
    add('sim.key', 'Key the current pose', '◆', 'Simulate', () => {
      const ids = [...this.selection];
      if (ids.length !== 1) { toast('Select one body first', 'warn'); return; }
      this.sim.keyCurrentPose(ids[0]); this.refreshSim(); this.refreshUI();
    });
    add('sim.autoSchedule', 'Auto-sequence the build', '≡', 'Simulate', () => this.autoSchedule());
    add('sim.bake', 'Bake dynamics to keyframes', '⚙', 'Simulate', () => this.bakeDynamics());
    add('sim.record', 'Record the simulation to video', '●', 'Simulate', () => this.recordVideo());
    add('sim.dropTest', 'Set up a drop test', '⤓', 'Simulate', () => this.setupDropTest());

    /* help */
    add('help.shortcuts', 'Keyboard shortcuts', '⌨', 'Help', () => this.showHelp());
    add('help.about', 'About TesserCAD', 'ⓘ', 'Help', () => this.showWelcome());
    add('help.palette', 'Command palette', '⌘', 'Help', () => this.openPalette(), { key: 'Ctrl+K' });

    this.commands = C;
    this.commandMap = new Map(C.map(c => [c.id, c]));
  }

  run(id) {
    const c = this.commandMap.get(id);
    if (!c) { console.warn('unknown command', id); return; }
    c.run();
  }

  openPalette() {
    commandPalette(this.commands, (c) => c.run());
  }

  exportBOM() {
    if (!this.build) return;
    const per = new Map();
    for (const f of this.build.topLevel) {
      const r = this.build.results.get(f.id);
      if (!r || r.error) continue;
      let volume = 0;
      for (const inst of r.instances) volume += massProperties(inst.geometry, inst.matrix).volume;
      per.set(f.id, { volume, mass: volume * (MATERIALS[f.material] || MATERIALS.steel).density });
    }
    IO.exportBOM({ ...this.build, perFeature: per });
  }

  setupDropTest() {
    const ids = [...this.vp.bodies.keys()];
    if (!ids.length) { toast('Add a body first', 'warn'); return; }
    store.edit('Set up drop test', (d) => {
      d.sim.dynamics.enabled = true;
      d.sim.dynamics.ground = true;
      d.sim.dynamics.groundZ = 0;
      d.sim.schedule.enabled = false;
      ids.forEach((id, i) => {
        d.sim.dynamics.bodies[id] = {
          enabled: true, static: false, mass: 1,
          vel: [0, 0, 0], spin: [40 * (i % 3 - 1), 30, 0],
          bounce: 0.45, friction: 0.4,
          motor: { type: 'none', axis: 'z', rate: 90, amp: 30, freq: 0.5, phase: 0 },
        };
      });
      d.sim.duration = Math.max(d.sim.duration, 6);
    }, { rebuild: false });
    this.setWorkspace('sim');
    this.sim.bakeKey = '';
    this.refreshSim();
    this.refreshUI();
    this.sim.seek(0);
    this.sim.play();
    toast('Drop test running — bodies fall onto the ground plane', 'ok', 4000);
  }

  /* ==================================================================
     Chrome: menus, toolbar, view cube
     ================================================================== */

  buildMenus() {
    const bar = clear($('#menubar'));
    const menus = [
      ['File', ['file.new', 'file.open', 'file.save', '-', 'file.import', '-', 'file.sample']],
      ['Export', ['export.stl', 'export.stlAscii', 'export.obj', 'export.glb', 'export.ply', '-', 'export.dxf', 'export.svg', '-', 'export.png', 'export.bom']],
      ['Edit', ['edit.undo', 'edit.redo', '-', 'edit.duplicate', 'edit.delete', 'edit.selectAll']],
      ['View', ['view.fit', 'view.selection', '-', 'view.iso', 'view.front', 'view.top', 'view.right', '-', 'view.ortho', 'view.shading', 'view.grid', 'view.theme']],
      ['Simulate', ['sim.play', 'sim.rewind', 'sim.key', '-', 'sim.autoSchedule', 'sim.dropTest', 'sim.bake', '-', 'sim.record']],
      ['Help', ['help.palette', 'help.shortcuts', 'help.about']],
    ];
    for (const [label, ids] of menus) {
      const b = el('button', { text: label });
      b.addEventListener('click', () => {
        if (b.classList.contains('open')) { closeDropdown(); return; }
        dropdown(b, ids.map(id => (id === '-' ? '-' : this.commandMap.get(id))).filter(Boolean));
      });
      bar.appendChild(b);
    }
  }

  buildToolbar() {
    const bar = clear($('#toolbar'));
    const group = (label, items) => {
      if (label) bar.appendChild(el('span', { class: 'tb-label', text: label }));
      const g = el('div', { class: 'tb-group' });
      for (const it of items) g.appendChild(it);
      bar.appendChild(g);
      bar.appendChild(el('span', { class: 'tb-sep' }));
    };
    const cmdBtn = (id, opts = {}) => {
      const c = this.commandMap.get(id);
      if (!c) return el('span');
      return el('button', {
        class: `tool ${opts.active ? 'toggled' : ''}`,
        title: `${c.label}${c.key ? `  (${c.key})` : ''}`,
        dataset: { cmd: id },
        onclick: () => c.run(),
      }, [el('span', { class: 'gl', text: c.glyph }), el('span', { class: 'tx', text: opts.short || c.label })]);
    };

    if (this.workspace === 'model') {
      group('Solids', Object.entries(CATALOG)
        .filter(([, c]) => c.group === 'solid')
        .map(([t, c]) => cmdBtn(`add.${t}`, { short: c.label.split(' ')[0] })));
      group('Combine', [
        cmdBtn('bool.union', { short: 'Union' }),
        cmdBtn('bool.subtract', { short: 'Subtract' }),
        cmdBtn('bool.intersect', { short: 'Intersect' }),
        cmdBtn('mod.linear', { short: 'Linear' }),
        cmdBtn('mod.circular', { short: 'Circular' }),
        cmdBtn('mod.mirror', { short: 'Mirror' }),
      ]);
      group('Transform', [
        cmdBtn('gizmo.translate', { short: 'Move', active: this.gizmoMode === 'translate' }),
        cmdBtn('gizmo.rotate', { short: 'Rotate', active: this.gizmoMode === 'rotate' }),
        cmdBtn('gizmo.scale', { short: 'Scale', active: this.gizmoMode === 'scale' }),
      ]);
      group('Measure', [
        cmdBtn('measure.distance', { short: 'Distance' }),
        cmdBtn('measure.angle', { short: 'Angle' }),
        cmdBtn('measure.off', { short: 'Off' }),
      ]);
      group('View', [cmdBtn('view.fit', { short: 'Fit' }), cmdBtn('view.shading', { short: 'Shading' }), cmdBtn('view.ortho', { short: 'Ortho' })]);
    } else if (this.workspace === 'draft') {
      const g = el('div', { class: 'tb-group' });
      for (const t of DRAW_TOOLS) {
        g.appendChild(el('button', {
          class: `tool ${this.draft.tool === t.id ? 'active' : ''}`,
          title: `${t.label}${t.key ? `  (${t.key})` : ''}`,
          onclick: () => { this.draft.setTool(t.id); this.buildToolbar(); },
        }, [el('span', { class: 'gl', text: t.glyph }), el('span', { class: 'tx', text: t.label })]));
      }
      bar.appendChild(el('span', { class: 'tb-label', text: 'Draw' }));
      bar.appendChild(g);
      bar.appendChild(el('span', { class: 'tb-sep' }));
      group('Modify', [
        el('button', { class: 'tool', title: 'Duplicate', onclick: () => { this.draft.duplicateSelection(); this.refreshUI(); } }, [el('span', { class: 'gl', text: '⧉' }), el('span', { class: 'tx', text: 'Copy' })]),
        el('button', { class: 'tool', title: 'Rotate 90°', onclick: () => this.rotateDraftSelection(90) }, [el('span', { class: 'gl', text: '⟲' }), el('span', { class: 'tx', text: 'Rotate' })]),
        el('button', { class: 'tool', title: 'Mirror across X', onclick: () => this.mirrorDraftSelection('x') }, [el('span', { class: 'gl', text: '⇄' }), el('span', { class: 'tx', text: 'Mirror' })]),
        el('button', { class: 'tool', title: 'Delete selection', onclick: () => { this.draft.deleteSelection(); this.refreshUI(); } }, [el('span', { class: 'gl', text: '✕' }), el('span', { class: 'tx', text: 'Delete' })]),
      ]);
      group('Aids', [
        el('button', {
          class: `tool ${this.draft.ortho ? 'toggled' : ''}`, title: 'Ortho mode (F8)',
          onclick: () => { this.draft.ortho = !this.draft.ortho; this.draft.polar = false; this.buildToolbar(); this.refreshUI(); },
        }, [el('span', { class: 'gl', text: '⊥' }), el('span', { class: 'tx', text: 'Ortho' })]),
        el('button', {
          class: `tool ${this.draft.polar ? 'toggled' : ''}`, title: 'Polar tracking (F10)',
          onclick: () => { this.draft.polar = !this.draft.polar; this.draft.ortho = false; this.buildToolbar(); this.refreshUI(); },
        }, [el('span', { class: 'gl', text: '✳' }), el('span', { class: 'tx', text: 'Polar' })]),
        el('button', {
          class: `tool ${this.draft.snap.on ? 'toggled' : ''}`, title: 'Object snap (F3)',
          onclick: () => { this.draft.snap.on = !this.draft.snap.on; this.buildToolbar(); this.refreshUI(); },
        }, [el('span', { class: 'gl', text: '⌖' }), el('span', { class: 'tx', text: 'Snap' })]),
      ]);
      group('Make', [cmdBtn('sketch.extrude', { short: 'Extrude' }), cmdBtn('sketch.revolve', { short: 'Revolve' })]);
      group('View', [
        el('button', { class: 'tool', title: 'Zoom extents', onclick: () => this.draft.zoomExtents() }, [el('span', { class: 'gl', text: '⤢' }), el('span', { class: 'tx', text: 'Fit' })]),
        cmdBtn('export.dxf', { short: 'DXF' }),
        cmdBtn('export.svg', { short: 'SVG' }),
      ]);
    } else {
      group('Playback', [
        cmdBtn('sim.play', { short: 'Play' }),
        cmdBtn('sim.rewind', { short: 'Rewind' }),
        cmdBtn('sim.key', { short: 'Key pose' }),
      ]);
      group('4D', [
        cmdBtn('sim.autoSchedule', { short: 'Sequence' }),
        cmdBtn('sim.dropTest', { short: 'Drop test' }),
        cmdBtn('sim.bake', { short: 'Bake' }),
      ]);
      group('Output', [cmdBtn('sim.record', { short: 'Record' }), cmdBtn('export.png', { short: 'PNG' })]);
      group('View', [cmdBtn('view.fit', { short: 'Fit' }), cmdBtn('view.shading', { short: 'Shading' })]);
    }
    if (bar.lastChild && bar.lastChild.classList?.contains('tb-sep')) bar.lastChild.remove();
  }

  updateToolbarState() {
    for (const b of document.querySelectorAll('#toolbar .tool[data-cmd]')) {
      const id = b.dataset.cmd;
      if (id.startsWith('bool.')) b.disabled = this.selection.size < 2;
      else if (id.startsWith('mod.')) b.disabled = this.selection.size !== 1;
      else if (id === 'view.selection') b.disabled = this.selection.size === 0;
    }
  }

  buildViewCube() {
    const host = clear($('#viewcube'));
    const mk = (label, view, wide = false) => el('button', {
      class: `vc${wide ? ' wide' : ''}`, text: label, title: `${label} view`,
      onclick: () => { if (this.workspace === 'draft') this.draft.zoomExtents(); else this.vp.standardView(view); },
    });
    host.append(
      el('div', { class: 'vc-row' }, [mk('TOP', 'top'), mk('FRT', 'front'), mk('RGT', 'right')]),
      el('div', { class: 'vc-row' }, [mk('BTM', 'bottom'), mk('BCK', 'back'), mk('LFT', 'left')]),
      el('div', { class: 'vc-row' }, [mk('ISO', 'iso', true), mk('⤢', 'fit')]),
    );
    host.lastChild.lastChild.onclick = () => (this.workspace === 'draft' ? this.draft.zoomExtents() : this.vp.frameAll());
    this.drawAxisHint();
    bus.on(T.VIEW, () => this.drawAxisHint());
  }

  drawAxisHint() {
    const host = $('#axisHint');
    if (!this._axisSvg) {
      host.innerHTML = '<svg viewBox="-40 -40 80 80" width="74" height="74"></svg>';
      this._axisSvg = host.firstChild;
    }
    const cam = this.vp.camera;
    const m = new THREE.Matrix4().copy(cam.matrixWorldInverse);
    const project = (v) => {
      const p = v.clone().applyMatrix4(m);
      return [p.x, -p.y];
    };
    const L = 30;
    const axes = [
      [new THREE.Vector3(L, 0, 0), '#ff5f56', 'X'],
      [new THREE.Vector3(0, L, 0), '#5ad469', 'Y'],
      [new THREE.Vector3(0, 0, L), '#4da3ff', 'Z'],
    ];
    const scale = 1;
    let svg = '';
    for (const [v, colour, label] of axes) {
      const [x, y] = project(v).map(n => n * scale);
      const len = Math.hypot(x, y) || 1;
      const k = Math.min(1, 30 / len);
      svg += `<line x1="0" y1="0" x2="${(x * k).toFixed(1)}" y2="${(y * k).toFixed(1)}" stroke="${colour}" stroke-width="2.4" stroke-linecap="round"/>`;
      svg += `<text x="${(x * k * 1.22).toFixed(1)}" y="${(y * k * 1.22 + 3.5).toFixed(1)}" fill="${colour}" font-size="10" text-anchor="middle" font-family="system-ui">${label}</text>`;
    }
    this._axisSvg.innerHTML = svg;
  }

  toggleTheme() {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('tessercad.theme', next); } catch { /* ignore */ }
    this.applyView();
    this.draft.invalidate();
    this.timeline.drawRuler();
  }

  /* ==================================================================
     Global UI bindings
     ================================================================== */

  bindGlobalUI() {
    for (const b of document.querySelectorAll('.ws')) b.addEventListener('click', () => this.setWorkspace(b.dataset.ws));
    $('#btnUndo').addEventListener('click', () => store.undo());
    $('#btnRedo').addEventListener('click', () => store.redo());
    $('#btnTheme').addEventListener('click', () => this.toggleTheme());
    $('#btnHelp').addEventListener('click', () => this.showHelp());
    $('#docName').addEventListener('change', (e) => {
      store.quiet((d) => { d.meta.name = e.target.value || 'Untitled'; });
    });
    const wa = $('#workarea');
    const mobile = () => matchMedia('(max-width: 860px)').matches;
    const drawer = (side) => {
      const cls = side === 'left' ? 'mobile-left' : 'mobile-right';
      const other = side === 'left' ? 'mobile-right' : 'mobile-left';
      wa.classList.remove(other);
      wa.classList.toggle(cls);
    };
    $('#mobLeft').addEventListener('click', () => drawer('left'));
    $('#mobRight').addEventListener('click', () => drawer('right'));
    $('#stage').addEventListener('pointerdown', (e) => {
      if (!mobile()) return;
      if (e.target.closest('.edge-tab')) return;
      wa.classList.remove('mobile-left', 'mobile-right');
    });

    $('#btnCollapseLeft').addEventListener('click', () => {
      const w = $('#workarea');
      if (mobile()) { w.classList.remove('mobile-left'); return; }
      w.classList.toggle('left-collapsed');
      $('#btnCollapseLeft').textContent = w.classList.contains('left-collapsed') ? '›' : '‹';
      setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 30);
    });
    $('#btnCollapseRight').addEventListener('click', () => {
      const w = $('#workarea');
      if (mobile()) { w.classList.remove('mobile-right'); return; }
      w.classList.toggle('right-collapsed');
      $('#btnCollapseRight').textContent = w.classList.contains('right-collapsed') ? '‹' : '›';
      setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 30);
    });
    try {
      const t = localStorage.getItem('tessercad.theme');
      if (t) document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }

    this.vp.onHover = (hit) => {
      $('#viewInfo').textContent = hit
        ? `${store.feature(hit.object.userData.featureId)?.name || ''}  ·  ${fmt(toDisplay(hit.point.x, store.doc.meta.units))}, ${fmt(toDisplay(hit.point.y, store.doc.meta.units))}, ${fmt(toDisplay(hit.point.z, store.doc.meta.units))}`
        : '';
    };
  }

  bindFiles() {
    const input = $('#fileInput');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try { await IO.importAny(file); this.vp.frameAll(); }
      catch (e) { toast(e.message, 'err', 6000); }
    });

    const stage = $('#stage');
    stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    stage.addEventListener('drop', async (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      try { await IO.importAny(file); this.vp.frameAll(); }
      catch (err) { toast(err.message, 'err', 6000); }
    });
  }

  pickFile(accept) {
    const input = $('#fileInput');
    input.accept = accept;
    input.click();
  }

  bindKeys() {
    addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        if (isModalOpen()) { closeModal(); return; }
        closeDropdown();
        if (this.workspace === 'draft') { if (this.draft.cancel()) { this.buildToolbar(); this.refreshUI(); return; } }
        if (this.vp.measureMode) { this.vp.setMeasureMode(null); $('#hud').textContent = ''; return; }
        this.select([]);
        return;
      }

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); this.openPalette(); return; }
      if (typing) {
        // typed coordinate entry is handled by the draft canvas below
        return;
      }

      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
        if (k === 'y') { e.preventDefault(); store.redo(); return; }
        if (k === 's') { e.preventDefault(); IO.saveProject(); return; }
        if (k === 'o') { e.preventDefault(); this.pickFile('.tcad,.json'); return; }
        if (k === 'n') { e.preventDefault(); this.run('file.new'); return; }
        if (k === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
        if (k === 'a') { e.preventDefault(); this.run('edit.selectAll'); return; }
        return;
      }

      if (e.key === 'F1') { e.preventDefault(); this.showHelp(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }

      if (this.workspace === 'draft') {
        if (e.key === 'F3') { e.preventDefault(); this.draft.snap.on = !this.draft.snap.on; this.buildToolbar(); return; }
        if (e.key === 'F8') { e.preventDefault(); this.draft.ortho = !this.draft.ortho; this.draft.polar = false; this.buildToolbar(); return; }
        if (e.key === 'F10') { e.preventDefault(); this.draft.polar = !this.draft.polar; this.draft.ortho = false; this.buildToolbar(); return; }
        if (this.draft.pending.length && this.draft.typeKey(e.key)) { e.preventDefault(); return; }
        if (e.key.toLowerCase() === 'c' && this.draft.pending.length >= 3) { this.draft.closeChain(); return; }
        const tool = DRAW_TOOLS.find(t => t.key && t.key.toLowerCase() === e.key.toLowerCase());
        if (tool) { this.draft.setTool(tool.id); this.buildToolbar(); return; }
        if (e.key === 'Enter') { this.draft._finishChain(); return; }
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ': e.preventDefault(); this.run('sim.play'); break;
        case 'g': this.setGizmo('translate'); break;
        case 'r': this.setGizmo('rotate'); break;
        case 't': this.setGizmo('scale'); break;
        case 'f': this.vp.frameAll(); break;
        case 'o': this.run('view.ortho'); break;
        case '1': this.vp.standardView('front'); break;
        case '2': this.vp.standardView('back'); break;
        case '3': this.vp.standardView('right'); break;
        case '4': this.vp.standardView('left'); break;
        case '5': this.vp.standardView('top'); break;
        case '6': this.vp.standardView('bottom'); break;
        case '0': this.vp.standardView('iso'); break;
        case ',': this.sim.step(-1); break;
        case '.': this.sim.step(1); break;
        case 'home': this.sim.seek(0); break;
        default: break;
      }
      if (e.key === 'Home') this.sim.seek(0);
      if (e.key === 'End') this.sim.seek(store.doc.sim.duration);
    });
  }

  /* ------------------------------------------------------------- modals */

  showHelp() {
    const rows = [
      ['Command palette', 'Ctrl K'], ['Save project', 'Ctrl S'], ['Open project', 'Ctrl O'],
      ['Undo / redo', 'Ctrl Z / Ctrl ⇧ Z'], ['Duplicate', 'Ctrl D'], ['Select all', 'Ctrl A'],
      ['Delete selection', 'Del'], ['Zoom to fit', 'F'], ['Move / rotate / scale gizmo', 'G / R / T'],
      ['Orthographic toggle', 'O'], ['Standard views', '1–6, 0'], ['Play / pause timeline', 'Space'],
      ['Step one frame', ', / .'], ['Timeline start / end', 'Home / End'],
      ['Draft: line, polyline, rect', 'L / P / R'], ['Draft: circle, arc, ellipse', 'C / A / E'],
      ['Draft: polygon, spline, text', 'G / S / X'], ['Draft: dimension, offset, measure', 'D / O / M'],
      ['Draft: object snap / ortho / polar', 'F3 / F8 / F10'], ['Draft: finish or close a chain', 'Enter / C'],
      ['Cancel, clear selection', 'Esc'], ['This help', 'F1'],
    ];
    modal({
      title: 'Keyboard shortcuts',
      wide: true,
      body: [
        el('div', { class: 'kbd-grid' }, rows.map(([l, k]) =>
          el('div', {}, [el('span', { text: l }), el('kbd', { text: k })]))),
        el('h3', { text: 'Mouse' }),
        el('p', { html: '<b>3D:</b> left-drag orbits · right-drag pans · wheel zooms · click selects · double-click frames the selection.<br><b>Draft:</b> middle or right-drag pans · wheel zooms · drag right-to-left for a crossing selection window.' }),
        el('h3', { text: 'Typed coordinates (Draft)' }),
        el('p', { html: 'While a drawing tool is active, type <code>50,30</code> for an absolute point, <code>@40,0</code> for a relative one, <code>@60&lt;30</code> for length and angle, or just <code>25</code> for a length along the cursor direction, then press Enter.' }),
      ],
      actions: [{ label: 'Close', primary: true }],
    });
  }

  showWelcome() {
    modal({
      title: `${APP_NAME} ${APP_VERSION}`,
      wide: true,
      body: [
        el('p', { html: 'A parametric CAD studio that runs entirely in your browser. Nothing is uploaded — your model lives in this tab and in the files you save.' }),
        el('h3', { text: 'The three workspaces' }),
        el('p', { html: '<b>Model</b> — parametric solids, booleans, patterns and mirrors in a rebuildable feature tree.<br><b>Draft</b> — 2D drafting with object snaps, layers, dimensions and DXF exchange. Any closed profile can be extruded or revolved into the model.<br><b>Simulate</b> — the fourth dimension: a timeline with keyframes, construction sequencing and rigid-body dynamics.' }),
        el('h3', { text: 'Try this first' }),
        el('p', { html: '1. Click a body, then edit its parameters on the right — try typing <code>plate_w*0.6</code> into a field.<br>2. Switch to <b>Draft</b>, draw a closed shape and press <b>Extrude</b>.<br>3. Switch to <b>Simulate</b> and press <b>Sequence</b> to watch the model assemble itself.' }),
        el('h3', { text: 'Honest limits' }),
        el('p', { html: 'TesserCAD is a mesh-based modeller, not a B-rep kernel: booleans work on triangle meshes, so there are no true fillets or chamfers on arbitrary edges, and very dense meshes make booleans slow. Dynamics use bounding-sphere collisions — right for drop tests and sequencing studies, not for stress analysis.' }),
        el('p', { class: 'hint', html: `Free and open source. Lengths are stored in millimetres. Files are saved as <code>${FILE_EXT}</code> (plain JSON) and can be exported to STL, OBJ, glTF, PLY, DXF, SVG, CSV and PNG.` }),
      ],
      actions: [
        { label: 'Keyboard shortcuts', run: () => setTimeout(() => this.showHelp(), 60) },
        { label: 'Start modelling', primary: true },
      ],
    });
  }
}

const WS_HINTS = {
  model: 'Model — add solids, combine them, and drive every dimension from a parameter.',
  draft: 'Draft — draw a 2D profile, then extrude or revolve it into the model.',
  sim: 'Simulate — scrub the timeline, key poses, sequence the build or run the physics.',
};

function randomColour() {
  const palette = ['#4da3ff', '#4ecb8b', '#ffb454', '#ff6b6b', '#b98cff', '#4fd0d8', '#f37ab5', '#a0d468'];
  return palette[Math.floor(Math.random() * palette.length)];
}

/* ------------------------------------------------------------------ go */

const app = new App();
window.tesserCAD = app;          // handy for the console and for automated checks
try {
  app.boot();
} catch (err) {
  console.error(err);
  const m = document.getElementById('bootMsg');
  if (m) { m.textContent = `Startup failed: ${err.message}`; m.style.color = '#ff6b6b'; }
}
