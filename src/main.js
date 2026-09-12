/**
 * TesserCAD — application controller.
 *
 * Owns the three workspaces, the command registry, the chrome (menu bar,
 * ribbon, panels, status bar) and the keyboard map. Everything the user can
 * do is a command; the chrome is generated from those commands so a new
 * feature appears in the menus, the ribbon, the palette and the keyboard map
 * at the same time.
 */
import * as THREE from 'three';
import { bus, T } from './core/bus.js';
import {
  store, newDocument, makeFeature, makeLayer, catalogOf, CATALOG, MATERIALS, UNITS,
  saveLocal, loadLocal, clearLocal, APP_NAME, APP_VERSION, FILE_EXT, toDisplay, uid,
} from './core/doc.js';
import { rebuild, rebuildAsync, invalidateCache, massProperties } from './core/rebuild.js';
import { pool as csgPool } from './core/csg-pool.js';
import { evalSafe, EXPR_HELP } from './core/expr.js';
import { Viewport } from './view/viewport.js';
import { Draft2D, DRAW_TOOLS, fmt, rotateEntity, scaleEntity, mirrorEntity, entityBBox } from './draft/draft.js';
import { Simulator } from './sim/sim.js';
import { recordTimeline, recordingSupported } from './sim/recorder.js';
import * as IO from './io/io.js';
import {
  el, $, $$, clear, toast, status, modal, closeModal, isModalOpen, confirmDialog, promptDialog,
  dropdown, closeDropdown, isDropdownOpen, contextMenu, commandPalette, quickMenu, closeQuickMenu,
  isQuickMenuOpen, field, checkbox, select, segmented, section, kv, scrubNumber, emptyState, icon,
} from './ui/shell.js';
import { buildCommands, TEMPLATES, registerFeatureFactory, ICON_FOR } from './ui/commands.js';
import { menuDefs, ribbonDefs, quickDefaults, viewportContextMenu, SHORT_LABEL, MENU_ICON } from './ui/menus.js';
import { OperatorHost } from './ui/operators.js';
import { MobileShell, isPhone, isTablet, attachLongPress } from './ui/mobile.js';
import { diagnose, severityLabel } from './intel/doctor.js';
import { PROCESSES, processOf } from './intel/process.js';
import { partsFrom, costDocument, compare, crossovers, levers, QUANTITIES } from './intel/cost.js';
import { releasePackage, exportIntent } from './intel/release.js';
import { MacroRecorder } from './intel/macros.js';
import * as Studio from './intel/standards.js';
import { ARCHETYPES, ARCHETYPE_IDS, synthesise, briefNotes, STRENGTH } from './intel/brief.js';
import { nextLesson, dismissLesson, allLessons, progress as whyProgress, resetSeen as resetWhy } from './intel/why.js';
import { findClashes, clearance } from './intel/interfere.js';
import { sectionAt, checkSection, standardPlanes, LOAD_CASES } from './intel/section.js';
import * as Cfg from './intel/configs.js';
import * as VCS from './intel/history.js';
import { recognise, cutterFor } from './intel/recognise.js';
import { QUALITY, retessellate, cleanMesh, segmentsFor, unitSanity } from './intel/tessellate.js';
import { buildSheet, sheetToSVG, sheetToDraw, scaleLabel, SHEETS, VIEWS, PROJECTIONS } from './intel/drawing.js';
import * as Tol from './intel/tolerance.js';
import * as Merge from './intel/merge.js';
import * as Spec from './intel/spec.js';
import * as Dev from './intel/deviation.js';
import * as Speak from './intel/speak.js';
import * as Fast from './intel/fasteners.js';
import * as Hygiene from './intel/hygiene.js';
import * as Offline from './intel/offline.js';
import { toDXF } from './draft/dxf.js';
import { renderLeftPanel } from './ui/tree.js';
import { renderRightPanel } from './ui/inspector.js';
import { TimelineUI } from './ui/timelineui.js';

registerFeatureFactory(makeFeature);

const PREFS_KEY = 'tessercad.prefs.v1';
const DEFAULT_PREFS = {
  theme: 'dark',
  gizmoSize: 0.85,
  snapStep: 5,
  autosaveSec: 20,
  showLearn: true,
  confirmDelete: false,
  edgeAngle: 24,
  dock: 'right',
  learnDone: [],
};

const WS_META = {
  model: { label: 'Model', icon: 'cube3d', hint: 'Model — add solids, combine them, and drive every dimension from a parameter.' },
  draft: { label: 'Draft', icon: 'sketch', hint: 'Draft — draw a 2D profile, then extrude or revolve it into the model.' },
  sim: { label: 'Simulate', icon: 'timeline', hint: 'Simulate — scrub the timeline, key poses, sequence the build or run the physics.' },
};

class App {
  constructor() {
    this.workspace = 'model';
    this.selection = new Set();
    this.build = null;
    this.defaultEase = 'smooth';
    this.gizmoMode = null;
    this.isolated = null;
    this._rebuildTimer = 0;
    this.prefs = this.loadPrefs();
  }

  /* ================================================================ boot */

  boot() {
    document.documentElement.setAttribute('data-theme', this.prefs.theme);
    // Which panel the tablet dock shows. Harmless on the other two tiers: no
    // rule outside the tablet breakpoint reads it.
    document.documentElement.dataset.dock = this.prefs.dock === 'left' ? 'left' : 'right';

    this.vp = new Viewport($('#viewport3d'));
    this.vp.edgeAngle = this.prefs.edgeAngle;
    this.vp.gizmo.setSize(this.prefs.gizmoSize);
    this.draft = new Draft2D($('#viewport2d'));
    this.sim = new Simulator(this.vp);
    this.timeline = new TimelineUI(this);
    this.ops = new OperatorHost(this, $('#opHud'));

    this.vp.onSelect = (id, additive) => this.select(id ? [id] : [], additive);
    this.vp.onTransformEnd = () => this.commitGizmo();
    this.vp.onTransformDrag = () => this.previewGizmo();
    this.vp.onContext = (e, hit) => this.showViewportMenu(e, hit);
    attachLongPress(this.vp.renderer.domElement, (e) => {
      this.vp._updatePointer(e);
      this.showViewportMenu(e, this.vp.pick());
    });
    attachLongPress($('#viewport2d'), (e) => this.showDraftMenu(e));
    this.vp.onPointerMove = () => { if (this.ops.running) this.ops.onPointerMove(); };
    this.draft.onStatus = (s) => this.draftStatus(s);
    this.draft.onEntityAdded = () => { this.markLearn('draw'); this.refreshUI(); };
    this.draft.onTextRequest = (place) => promptDialog('Add text', 'Text', '', (v) => { place(v); this.refreshUI(); },
      { placeholder: 'PLATE A', help: 'Height comes from “Text / dim size” in the right panel.' });

    this.macro = new MacroRecorder(this);
    this.macro.onChange = () => this.updateStatus();
    this.commands = buildCommands(this);
    this.commandMap = new Map(this.commands.map(c => [c.id, c]));
    this.mobile = new MobileShell(this);

    this.buildWorkspaceTabs();
    this.buildDocChip();
    this.buildTopActions();
    this.buildMenus();
    this.buildViewCube();
    this.bindGlobalUI();
    this.bindKeys();
    this.bindFiles();

    bus.on(T.DOC_CHANGED, () => this.onDocChanged());
    bus.on(T.DOC_TOUCHED, () => this.refreshUI());
    bus.on(T.SELECTION, (p) => { if (p.source === 'draft') this.refreshUI(); });
    bus.on('measure:result', (r) => this.showMeasure(r));

    this.restoreSession();
    this.setWorkspace('model');
    this.draft.start();
    this.draft.resize();
    this.renderLearn();
    // The first rebuild is awaited before framing: it is asynchronous now, and
    // a camera framed before the first body exists frames nothing. Two frames
    // after it, so the chrome has laid out and the canvas is its real size.
    this.rebuildNow().then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => this.vp.frameAll()));
      // The offline copy is registered after the first frame, never before:
      // caching sixty files must not compete with getting a model on screen.
      Offline.install().then((r) => { this._offline = r; });
    });

    this._autosave = setInterval(() => { if (store.dirty) { saveLocal(); this.markSaved(); } }, Math.max(5, this.prefs.autosaveSec) * 1000);
    addEventListener('beforeunload', (e) => {
      saveLocal();
      if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    addEventListener('resize', () => { this.draft.resize(); this.vp.resize(); });

    $('#boot').classList.add('gone');
    setTimeout(() => $('#boot')?.remove(), 400);
  }

  /* ============================================================= prefs */

  loadPrefs() {
    try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) }; }
    catch { return { ...DEFAULT_PREFS }; }
  }

  savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ }
  }

  setPref(key, value) {
    this.prefs[key] = value;
    this.savePrefs();
    if (key === 'gizmoSize') this.vp.gizmo.setSize(value);
    if (key === 'edgeAngle') { this.vp.edgeAngle = value; this.refreshBodies(true); }
  }

  /* ========================================================== documents */

  restoreSession() {
    const saved = loadLocal();
    if (saved?.doc && (saved.doc.features?.length || saved.doc.draw?.entities?.length)) {
      try {
        store.load(saved.doc, { markClean: false });
        this.flash(`Restored your last session from ${new Date(saved.at).toLocaleString()}`, 'ok', 5000);
        return;
      } catch (e) { console.warn('restore failed', e); }
    }
    store.load(TEMPLATES.find(t => t.id === 'plate').build());
    let seen = false;
    try { seen = localStorage.getItem('tessercad.seenWelcome') === '1'; } catch { /* ignore */ }
    if (!seen) {
      setTimeout(() => {
        this.showWelcome();
        try { localStorage.setItem('tessercad.seenWelcome', '1'); } catch { /* ignore */ }
      }, 550);
    }
  }

  newDocument() {
    this.guardUnsaved('Start a new document?', () => {
      clearLocal();
      // Seeded, not silently rewritten: this only ever applies to a document
      // this session is creating, never to one that arrived from someone else.
      store.load(Studio.seedDocument(newDocument('Untitled')));
      this.selection.clear();
      this.vp.frameAll();
    });
  }

  guardUnsaved(message, go) {
    if (!store.dirty) { go(); return; }
    confirmDialog('Unsaved changes', `${message} Anything not saved to a file will be lost.`, go, { danger: true, yes: 'Discard and continue' });
  }

  loadSample() {
    this.guardUnsaved('Load the demo model?', () => {
      store.load(TEMPLATES.find(t => t.id === 'flange').build());
      this.vp.frameAll();
    });
  }

  applyTemplate(t) {
    this.guardUnsaved(`Start from “${t.name}”?`, () => {
      store.load(t.build());
      this.selection.clear();
      setTimeout(() => this.vp.frameAll(), 80);
      this.flash(`Started from ${t.name}`, 'ok');
      closeModal();
    });
  }

  showTemplates() {
    modal({
      title: 'New from template', icon: 'template', wide: true,
      subtitle: 'Every template is a working parametric model — open one and change its parameters.',
      body: [el('div', { class: 'card-grid' }, TEMPLATES.map(t => el('button', {
        class: 'card', onclick: () => this.applyTemplate(t),
      }, [icon(t.icon, { size: 22 }), el('b', { text: t.name }), el('span', { text: t.blurb })])))],
      actions: [{ label: 'Cancel' }],
    });
  }

  saveAs() {
    promptDialog('Save as', 'File name', store.doc.meta.name, (v) => {
      const name = String(v || '').trim();
      if (!name) return;
      store.quiet((d) => { d.meta.name = name; });
      IO.saveProject();
      this.refreshUI();
    }, { help: `Saved as ${FILE_EXT} — plain JSON you can keep in git.` });
  }

  revert() {
    confirmDialog('Revert', 'Undo every change back to the start of this session?', () => {
      while (store.canUndo()) store.undo();
    }, { danger: true, yes: 'Revert everything' });
  }

  clearAutosave() {
    confirmDialog('Clear saved session', 'Remove the copy of this document kept in your browser? The document on screen is untouched.', () => {
      clearLocal();
      this.flash('Saved session cleared', 'ok');
    }, { danger: true, yes: 'Clear' });
  }

  showAutosave() {
    const saved = loadLocal();
    if (!saved?.doc) { this.flash('No autosaved session found', 'warn'); return; }
    const n = saved.doc.features?.length || 0;
    confirmDialog('Recover autosave',
      `Restore the session saved at ${new Date(saved.at).toLocaleString()} (${n} feature${n === 1 ? '' : 's'})? The current document will be replaced.`,
      () => { store.load(saved.doc, { markClean: false }); this.vp.frameAll(); }, { yes: 'Restore' });
  }

  showDocProps() {
    const d = store.doc;
    const nameInput = el('input', { type: 'text', value: d.meta.name });
    const author = el('input', { type: 'text', value: d.meta.author || '', placeholder: 'Optional' });
    const notes = el('textarea', { rows: 4, placeholder: 'Revision notes, tolerances, finish…' });
    notes.value = d.meta.notes || '';
    const unitSel = select(d.meta.units, Object.keys(UNITS).map(u => [u, `${u} — ${{ mm: 'millimetres', cm: 'centimetres', m: 'metres', in: 'inches', ft: 'feet' }[u]}`]), () => {});
    modal({
      title: 'Document properties', icon: 'doc-props',
      body: [
        field('Name', nameInput),
        field('Author', author),
        field('Display units', unitSel, { hint: 'Geometry is always stored in millimetres; this only changes what you read and export.' }),
        field('Notes', notes, { full: true }),
        el('h3', { text: 'Statistics' }),
        kv([
          ['Features', String(d.features.length)],
          ['Drawing objects', String(d.draw.entities.length)],
          ['Parameters', String(d.params.length)],
          ['Created', new Date(d.meta.created).toLocaleString()],
          ['Modified', new Date(d.meta.modified).toLocaleString()],
          ['Schema', `v${d.schema}`],
        ]),
      ],
      actions: [
        { label: 'Cancel' },
        { label: 'Apply', primary: true, run: () => {
          store.edit('Document properties', (doc) => {
            doc.meta.name = nameInput.value.trim() || 'Untitled';
            doc.meta.author = author.value;
            doc.meta.notes = notes.value;
            doc.meta.units = unitSel.value;
          }, { rebuild: false });
          this.refreshUI();
        } },
      ],
    });
  }

  /* ============================================================ rebuild */

  onDocChanged() {
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => this.rebuildNow(), 8);
  }

  /**
   * Rebuild, with the booleans off this thread.
   *
   * The rebuild is asynchronous because the expensive part of it now runs in
   * worker threads, which is the difference between a window that keeps
   * responding during a heavy boolean and one that does not. Two consequences
   * are handled here rather than pushed onto callers:
   *
   * A rebuild can be superseded while it is in flight. Every run takes a
   * ticket, and a run that finds a newer ticket on completion drops its own
   * result instead of drawing a model the user has already edited past.
   *
   * Everything after the await is the same work in the same order as before,
   * so nothing downstream has to know the rebuild ever yielded.
   */
  async rebuildNow() {
    const ticket = (this._buildTicket = (this._buildTicket || 0) + 1);
    const t0 = performance.now();
    let build;
    try {
      build = await rebuildAsync(store.doc);
    } catch (err) {
      console.error(err);
      if (ticket === this._buildTicket) this.flash(`Rebuild failed: ${err.message}`, 'err', 6000);
      return;
    }
    // A newer edit started its own rebuild while this one was running. That
    // one is the truth; this result is already stale, so it is discarded.
    if (ticket !== this._buildTicket) return;

    this.build = build;
    this.buildMs = performance.now() - t0;
    this.vp.syncBodies(this.build);
    this.sim.refreshPivots();
    this.sim.bakeKey = '';
    if (this.workspace === 'sim') this.sim.seek(this.sim.time); else this.sim.reset();
    this.applyView();
    this.applyIsolation();
    this.runDoctor();
    this.refreshUI();
    this.timeline.render();
  }

  /* ====================================================== design intelligence */

  /**
   * Re-run the checks against the current build.
   *
   * Deliberately synchronous and inside the rebuild: the findings have to be
   * true of the geometry on screen, and a check that lags a frame behind the
   * model is worse than no check because it is occasionally wrong.
   */
  runDoctor() {
    if (!this.build) { this.report = null; return; }
    if (!Studio.standards().autoDoctor) { this.report = null; return; }
    const process = store.doc.studio?.process || Studio.standards().process;
    try { this.report = diagnose(store.doc, this.build, { process }); }
    catch (err) { console.error(err); this.report = null; }
  }

  /** Apply one of the Doctor's repairs, saying plainly what changed. */
  applyFix(issue) {
    if (!issue.fix) return;
    try {
      issue.fix.apply(store, makeFeature);
      Studio.logDecision({
        title: issue.title,
        choice: issue.fix.label,
        why: issue.why,
        doc: store.doc.meta.name,
      });
      this.flash(`${issue.fix.label}. Ctrl Z puts it back.`, 'ok', 4200);
    } catch (err) {
      this.flash(`Could not apply that repair: ${err.message}`, 'err', 6000);
    }
  }

  /** Everything the cost model needs, computed from the current build. */
  costInputs() {
    const s = Studio.standards();
    const rates = { ...s.rates, materialPrice: s.materialPrice };
    const batch = store.doc.studio?.batch || s.batch;
    const parts = this.build ? partsFrom(store.doc, this.build, massProperties) : [];
    return { parts, batch, rates, standards: s };
  }

  refreshBodies(hard = false) {
    if (hard) { invalidateCache(); this.rebuildNow(); return; }
    this.vp.syncBodies(this.build || rebuild(store.doc));
    this.vp.refreshMaterials();
    this.applyIsolation();
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
    this.refreshRibbon();
    this.updateStatus();
    this.updateTopActions();
    this.mobile?.refresh();
    this.updateDockSwitch();
    const name = $('#docName');
    if (name && document.activeElement !== name) name.value = store.doc.meta.name;
    $('#docDirty')?.classList.toggle('on', store.dirty);
    this.renderLearn();
  }

  /** Keep the tablet dock switch labelled with whatever the panels now hold. */
  updateDockSwitch() {
    // The panel titles are written for a full-width heading ("Layers & objects")
    // and truncate to noise in a half-width tab, so the switch carries its own
    // short names instead.
    const names = {
      left: { draft: 'Layers', sim: 'Bodies' }[this.workspace] || 'Outline',
      right: 'Properties',
    };
    for (const b of $$('.dock-switch .ds-btn')) {
      const which = b.dataset.dock;
      b.querySelector('.ds-label').textContent = names[which];
      const on = this.dock === which;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
  }

  markSaved() { $('#docDirty')?.classList.remove('on'); }

  flash(msg, kind = 'info', ms = 3200) { toast(msg, kind, ms); }

  /* ========================================================= workspaces */

  setWorkspace(ws) {
    if (this.ops.running) this.ops.cancel();
    this.workspace = ws;
    for (const b of $$('.ws')) b.setAttribute('aria-selected', String(b.dataset.ws === ws));
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
    this.buildRibbon();
    this.mobile?.refresh();
    this.refreshUI();
    bus.emit(T.WORKSPACE, ws);
    status(WS_META[ws].hint);
  }

  setTimelineVisible(v) {
    $('#timeline').hidden = !v;
    if (v) setTimeout(() => this.timeline.layout(), 30);
    setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 40);
  }

  /* ========================================================== selection */

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
    if (ids.length) this.markLearn('select');
    this.refreshUI();
    this.timeline.render();
  }

  selectAll() {
    if (this.workspace === 'draft') this.draft.selectAll();
    else this.select(store.doc.features.filter(f => !store.consumedIds().has(f.id) && !f.suppressed).map(f => f.id));
    this.refreshUI();
  }

  invertSelection() {
    if (this.workspace === 'draft') {
      const all = store.doc.draw.entities.map(e => e.id);
      const cur = this.draft.selection;
      this.draft.selection = new Set(all.filter(id => !cur.has(id)));
      this.draft.invalidate();
    } else {
      const all = store.doc.features.filter(f => !store.consumedIds().has(f.id)).map(f => f.id);
      this.select(all.filter(id => !this.selection.has(id)));
    }
    this.refreshUI();
  }

  selectSameType() {
    const f = this.selected()[0];
    if (!f) return;
    this.select(store.doc.features.filter(x => x.type === f.type && !store.consumedIds().has(x.id)).map(x => x.id));
  }

  selected() { return [...this.selection].map(id => store.feature(id)).filter(Boolean); }

  renameSelected() {
    const f = this.selected()[0];
    if (!f) return;
    promptDialog('Rename feature', 'Name', f.name, (v) => {
      const name = String(v || '').trim();
      if (!name) return;
      store.edit('Rename feature', () => { store.feature(f.id).name = name; }, { rebuild: false });
      this.refreshUI();
    });
  }

  /* ===================================================== feature editing */

  addFeature(type, extra = {}) {
    const cat = catalogOf(type);
    const f = makeFeature(type, extra);
    f.name = store.uniqueName(cat.label);
    if (cat.group === 'solid' && !extra.pos) {
      const h = f.params.h ?? f.params.pitch ?? 0;
      const r = f.params.r ?? f.params.R ?? f.params.ro ?? 0;
      f.transform.pos = [0, 0, type === 'sphere' ? r : (type === 'torus' ? (f.params.r || 0) : (h || r) / 2)];
    }
    store.edit(`Add ${cat.label}`, (doc) => { doc.features.push(f); });
    this.select([f.id]);
    this.markLearn('create');
    this.flash(`${f.name} added`, 'ok', 1600);
    return f;
  }

  addBoolean(op) {
    const ids = [...this.selection];
    if (ids.length < 2) { this.flash('Select two or more bodies first', 'warn'); return; }
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
    this.markLearn('boolean');
    setTimeout(() => {
      const r = this.build?.results.get(f.id);
      if (r?.error) this.flash(r.error, 'err', 6000);
    }, 60);
  }

  addModifier(type) {
    const ids = [...this.selection];
    if (ids.length !== 1) { this.flash('Select exactly one body', 'warn'); return; }
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
    const go = () => {
      store.edit('Delete features', (doc) => {
        doc.features = doc.features.filter(f => !ids.has(f.id));
        for (const f of doc.features) f.inputs = f.inputs.filter(i => !ids.has(i));
        for (const id of ids) { delete doc.sim.tracks[id]; delete doc.sim.schedule.items[id]; delete doc.sim.dynamics.bodies[id]; }
      });
      this.selection.clear();
      this.vp.setSelection([]);
      this.refreshUI();
    };
    if (this.prefs.confirmDelete) {
      confirmDialog('Delete', `Delete ${ids.size} feature${ids.size === 1 ? '' : 's'}?`, go, { danger: true, yes: 'Delete' });
    } else go();
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
        copy.inputs = [];
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

  toggleSuppress() {
    const ids = [...this.selection];
    if (!ids.length) return;
    const any = ids.some(id => !store.feature(id)?.suppressed);
    store.edit('Suppress', () => { for (const id of ids) { const f = store.feature(id); if (f) f.suppressed = any; } });
  }

  setVisible(visible, { all = false } = {}) {
    const ids = all ? store.doc.features.map(f => f.id) : [...this.selection];
    if (!ids.length) return;
    store.edit(visible ? 'Show' : 'Hide', () => { for (const id of ids) { const f = store.feature(id); if (f) f.visible = visible; } }, { rebuild: false });
    if (all) this.isolated = null;
    this.refreshBodies();
  }

  isolate() {
    if (this.isolated) { this.isolated = null; this.flash('Isolation off', 'info', 1400); }
    else {
      if (!this.selection.size) return;
      this.isolated = new Set(this.selection);
      this.flash(`Isolated ${this.isolated.size} bod${this.isolated.size === 1 ? 'y' : 'ies'} — press / to exit`, 'ok');
    }
    this.applyIsolation();
    this.refreshUI();
  }

  applyIsolation() {
    for (const [id, group] of this.vp.bodies) {
      const f = store.feature(id);
      const base = f ? f.visible !== false : true;
      group.visible = this.isolated ? (base && this.isolated.has(id)) : base;
    }
    this.vp.invalidate();
  }

  setMaterial(key) {
    const ids = [...this.selection];
    if (!ids.length) { this.flash('Select a body first', 'warn'); return; }
    const m = MATERIALS[key];
    store.edit('Assign material', () => {
      for (const id of ids) {
        const f = store.feature(id);
        if (!f) continue;
        f.material = key;
        f.appearance.color = m.color;
        f.appearance.metalness = m.metal;
        f.appearance.roughness = m.rough;
      }
    }, { rebuild: false });
    this.refreshBodies();
    this.flash(`${m.name} applied to ${ids.length} bod${ids.length === 1 ? 'y' : 'ies'}`, 'ok', 1800);
  }

  showMaterialPicker() {
    modal({
      title: 'Assign material', icon: 'palette', wide: true,
      subtitle: 'Material sets the appearance and the density used for mass properties.',
      body: [el('div', { class: 'card-grid' }, Object.entries(MATERIALS).map(([k, m]) => el('button', {
        class: 'card', onclick: () => { this.setMaterial(k); closeModal(); },
      }, [
        el('span', { style: { width: '22px', height: '22px', borderRadius: '5px', background: m.color, border: '1px solid rgba(127,127,127,.4)' } }),
        el('b', { text: m.name }),
        el('span', { text: `${(m.density * 1e6).toFixed(0)} kg/m³` }),
      ])))],
      actions: [{ label: 'Cancel' }],
    });
  }

  pickColour() {
    const ids = [...this.selection];
    if (!ids.length) return;
    const input = el('input', { type: 'color', value: store.feature(ids[0])?.appearance.color || '#4c9fff' });
    input.addEventListener('change', () => {
      store.edit('Set colour', () => { for (const id of ids) { const f = store.feature(id); if (f) f.appearance.color = input.value; } }, { rebuild: false });
      this.refreshBodies();
    });
    input.click();
  }

  /* ========================================================== transforms */

  startOperator(kind) {
    if (this.workspace === 'draft') { this.flash('Transform operators work in the Model and Simulate workspaces', 'warn'); return; }
    if (this.ops.start(kind)) this.markLearn('transform');
  }

  setGizmo(mode) {
    this.gizmoMode = mode;
    this.vp.setGizmoMode(this.workspace === 'model' ? mode : null);
    this.refreshRibbon();
  }

  previewGizmo() {
    const ids = [...this.selection];
    if (ids.length !== 1) return;
    const g = this.vp.readGizmo();
    const group = this.vp.bodies.get(ids[0]);
    if (!group) return;
    const f = store.feature(ids[0]);
    const cur = f.transform.pos.map(v => evalSafe(v, this.build.scope, 0));
    group.matrixAutoUpdate = false;
    group.matrix.makeTranslation(g.pos[0] - cur[0], g.pos[1] - cur[1], g.pos[2] - cur[2]);
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

  resetTransform() {
    const ids = [...this.selection];
    if (!ids.length) return;
    store.edit('Reset transform', () => {
      for (const id of ids) {
        const f = store.feature(id);
        if (!f) continue;
        f.transform.pos = [0, 0, 0]; f.transform.rot = [0, 0, 0]; f.transform.scale = [1, 1, 1];
      }
    });
  }

  dropSelection() {
    const ids = [...this.selection];
    if (!ids.length) return;
    const scope = this.build.scope;
    store.edit('Drop to floor', () => {
      for (const id of ids) {
        const res = this.build.results.get(id);
        const f = store.feature(id);
        if (!res || !f || !res.instances.length) continue;
        let minZ = Infinity;
        for (const inst of res.instances) minZ = Math.min(minZ, massProperties(inst.geometry, inst.matrix).box.min.z);
        if (Number.isFinite(minZ)) f.transform.pos[2] = evalSafe(f.transform.pos[2], scope, 0) - minZ;
      }
    });
  }

  centreSelection() {
    const ids = [...this.selection];
    if (!ids.length) return;
    const scope = this.build.scope;
    store.edit('Centre on origin', () => {
      for (const id of ids) {
        const res = this.build.results.get(id);
        const f = store.feature(id);
        if (!res || !f || !res.instances.length) continue;
        const c = new THREE.Vector3();
        massProperties(res.instances[0].geometry, res.instances[0].matrix).box.getCenter(c);
        const p = f.transform.pos.map(v => evalSafe(v, scope, 0));
        f.transform.pos = [p[0] - c.x, p[1] - c.y, p[2] - c.z];
      }
    });
  }

  _bodyCentres() {
    const out = [];
    for (const id of this.selection) {
      const res = this.build?.results.get(id);
      if (!res || !res.instances.length) continue;
      const c = new THREE.Vector3();
      massProperties(res.instances[0].geometry, res.instances[0].matrix).box.getCenter(c);
      out.push({ id, c });
    }
    return out;
  }

  alignSelection(axis) {
    const list = this._bodyCentres();
    if (list.length < 2) return;
    const i = { x: 0, y: 1, z: 2 }[axis];
    const target = list.reduce((s, b) => s + b.c.getComponent(i), 0) / list.length;
    const scope = this.build.scope;
    store.edit(`Align on ${axis.toUpperCase()}`, () => {
      for (const b of list) {
        const f = store.feature(b.id);
        if (!f) continue;
        f.transform.pos[i] = evalSafe(f.transform.pos[i], scope, 0) + (target - b.c.getComponent(i));
      }
    });
    this.flash(`Aligned ${list.length} bodies on ${axis.toUpperCase()}`, 'ok', 1800);
  }

  distributeSelection() {
    const list = this._bodyCentres();
    if (list.length < 3) return;
    // spread along whichever axis the selection already spans most
    const span = ['x', 'y', 'z'].map((a, i) => {
      const vals = list.map(b => b.c.getComponent(i));
      return { a, i, d: Math.max(...vals) - Math.min(...vals) };
    }).sort((p, q) => q.d - p.d)[0];
    const sorted = [...list].sort((p, q) => p.c.getComponent(span.i) - q.c.getComponent(span.i));
    const lo = sorted[0].c.getComponent(span.i);
    const hi = sorted[sorted.length - 1].c.getComponent(span.i);
    const step = (hi - lo) / (sorted.length - 1);
    const scope = this.build.scope;
    store.edit('Distribute evenly', () => {
      sorted.forEach((b, k) => {
        const f = store.feature(b.id);
        if (!f) return;
        const want = lo + step * k;
        f.transform.pos[span.i] = evalSafe(f.transform.pos[span.i], scope, 0) + (want - b.c.getComponent(span.i));
      });
    });
    this.flash(`Distributed along ${span.a.toUpperCase()}`, 'ok', 1800);
  }

  /* ============================================================== draft */

  setDraftTool(id) {
    if (this.workspace !== 'draft') this.setWorkspace('draft');
    this.draft.setTool(id);
    this.refreshRibbon();
    this.refreshUI();
  }

  toggleDraft(which) {
    const d = this.draft;
    if (which === 'snap') d.snap.on = !d.snap.on;
    if (which === 'grid') d.snap.grid = !d.snap.grid;
    if (which === 'ortho') { d.ortho = !d.ortho; if (d.ortho) d.polar = false; }
    if (which === 'polar') { d.polar = !d.polar; if (d.polar) d.ortho = false; }
    d.invalidate();
    this.refreshRibbon();
    this.refreshUI();
  }

  linkProfile(featureId) {
    const ids = [...this.draft.selection];
    if (!ids.length) { this.flash('Select geometry in the Draft workspace first', 'warn'); return; }
    store.edit('Link sketch profile', () => { store.feature(featureId).profile = ids; });
    this.flash(`${ids.length} object${ids.length > 1 ? 's' : ''} linked`, 'ok');
  }

  showProfile(featureId) {
    const f = store.feature(featureId);
    if (!f?.profile?.length) { this.flash('No profile linked', 'warn'); return; }
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
    if (!ids.length) { this.flash('Select closed geometry in the Draft workspace first', 'warn'); return; }
    const f = makeFeature(kind, { material: 'abs' });
    f.profile = ids;
    f.name = store.uniqueName(kind === 'extrude' ? 'Extrusion' : 'Revolution');
    store.edit(`Create ${kind}`, (doc) => { doc.features.push(f); });
    this.setWorkspace('model');
    this.select([f.id]);
    this.markLearn('extrude');
    setTimeout(() => {
      const res = this.build?.results.get(f.id);
      if (res?.error) this.flash(res.error, 'err', 6000);
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
    if (draw.layers.length <= 1) { this.flash('The last layer cannot be deleted', 'warn'); return; }
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

  draftSelectionCentre() {
    const boxes = [...this.draft.selection].map(id => entityBBox(store.entity(id))).filter(Boolean);
    if (!boxes.length) return [0, 0];
    const x1 = Math.min(...boxes.map(b => b[0])), y1 = Math.min(...boxes.map(b => b[1]));
    const x2 = Math.max(...boxes.map(b => b[2])), y2 = Math.max(...boxes.map(b => b[3]));
    return [(x1 + x2) / 2, (y1 + y2) / 2];
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

  /* ========================================================== simulate */

  togglePlay() { if (this.workspace !== 'sim') this.setWorkspace('sim'); this.sim.toggle(); this.markLearn('play'); }
  toggleLoop() { store.quiet((d) => { d.sim.loop = !d.sim.loop; }); this.timeline.render(); this.refreshRibbon(); }

  toggleSchedule() {
    store.edit('Build sequencing', (d) => { d.sim.schedule.enabled = !d.sim.schedule.enabled; }, { rebuild: false });
    this.refreshSim(); this.refreshUI();
  }

  togglePhysics() {
    store.edit('Dynamics', (d) => { d.sim.dynamics.enabled = !d.sim.dynamics.enabled; }, { rebuild: false });
    this.sim.bakeKey = '';
    this.refreshSim(); this.refreshUI();
  }

  keyPose() {
    const ids = [...this.selection];
    if (ids.length !== 1) { this.flash('Select one body first', 'warn'); return; }
    this.sim.keyCurrentPose(ids[0]);
    this.refreshSim(); this.refreshUI();
    this.flash('Pose keyed at the playhead', 'ok', 1600);
  }

  clearKeys() {
    const ids = [...this.selection];
    if (ids.length !== 1) return;
    this.sim.clearTracks(ids[0]);
    this.refreshSim(); this.refreshUI();
  }

  autoSchedule() {
    const n = this.sim.autoSchedule({ perItem: 1, gap: 0.3, mode: 'grow' });
    this.setWorkspace('sim');
    this.refreshSim(); this.refreshUI();
    this.markLearn('sequence');
    this.flash(`Sequenced ${n} bodies across the timeline`, 'ok');
  }

  clearSchedule() {
    store.edit('Clear build sequence', (d) => { d.sim.schedule.items = {}; d.sim.schedule.enabled = false; }, { rebuild: false });
    this.refreshSim(); this.refreshUI();
  }

  addMotor() {
    const id = [...this.selection][0];
    if (!id) return;
    store.edit('Add motor', (d) => {
      const cur = d.sim.dynamics.bodies[id] || { mass: 1, static: true, vel: [0, 0, 0], spin: [0, 0, 0], bounce: 0.35, friction: 0.4, enabled: true };
      d.sim.dynamics.bodies[id] = { ...cur, static: true, motor: { type: 'spin', axis: 'z', rate: 90, amp: 30, freq: 0.5, phase: 0 } };
      d.sim.dynamics.enabled = true;
    }, { rebuild: false });
    this.setWorkspace('sim');
    this.sim.bakeKey = '';
    this.refreshSim(); this.refreshUI();
    this.flash('Spin motor added — tune it in the Dynamics panel', 'ok');
  }

  bakeDynamics() {
    const n = this.sim.bakeToKeys(3);
    if (n) { this.refreshSim(); this.refreshUI(); this.flash(`Baked ${n} keyframes`, 'ok'); }
  }

  setupDropTest() {
    const ids = [...this.vp.bodies.keys()];
    if (!ids.length) { this.flash('Add a body first', 'warn'); return; }
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
    this.refreshSim(); this.refreshUI();
    this.sim.seek(0);
    this.sim.play();
    this.flash('Drop test running — bodies fall onto the ground plane', 'ok', 4000);
  }

  async recordVideo() {
    if (!recordingSupported()) { this.flash('This browser cannot record canvas video', 'err'); return; }
    this.setWorkspace('sim');
    const body = modal({
      title: 'Recording the timeline', icon: 'record',
      subtitle: 'Rendering every frame and encoding with the browser’s own video encoder.',
      body: [
        el('p', { text: 'Keep this tab in the foreground until it finishes.' }),
        el('div', { class: 'row wide' }, [el('progress', { id: 'recProg', max: '1', value: '0', style: { width: '100%' } })]),
      ],
    });
    const prog = body.querySelector('#recProg');
    try {
      await recordTimeline(this.vp, this.sim, { fps: store.doc.sim.fps || 30, onProgress: (p) => { prog.value = p; } });
      closeModal();
    } catch (e) {
      closeModal();
      this.flash(`Recording failed: ${e.message}`, 'err', 6000);
    }
  }

  /* ============================================================== view */

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

  /**
   * View settings never enter the model's history.
   *
   * This is the single most bitterly reported thing about the packages this
   * one imitates: you press undo expecting your last edit back and instead the
   * grid turns on. How you are *looking* at a model is not a change to the
   * model, so it is written with `quiet` rather than `edit`. It still saves,
   * still travels in the document, and still marks the file dirty. It simply
   * is not an undo step, because it was never an edit.
   */
  toggleView(key) {
    store.quiet((d) => { d.view[key] = !d.view[key]; });
    this.applyView();
    this.refreshUI();
  }

  setShading(mode) {
    store.quiet((d) => { d.view.shading = mode; });
    this.refreshBodies(true);
  }

  cycleShading() {
    const modes = ['shaded-edges', 'shaded', 'wire', 'xray'];
    const next = modes[(modes.indexOf(store.doc.view.shading) + 1) % modes.length];
    this.setShading(next);
    this.flash(`Shading: ${next.replace('-', ' with ')}`, 'info', 1300);
  }

  setBackground(bg) {
    store.quiet((d) => { d.view.bg = bg; });
    this.applyView();
    this.refreshUI();
  }

  toggleSection() {
    store.quiet((d) => { d.view.clip.enabled = !d.view.clip.enabled; });
    this.applyView();
    this.refreshUI();
  }

  zoomFit() { if (this.workspace === 'draft') this.draft.zoomExtents(); else this.vp.frameAll(); }

  zoomBy(f) {
    if (this.workspace === 'draft') { this.draft.zoomBy(f); return; }
    const c = this.vp.controls;
    const dir = new THREE.Vector3().subVectors(this.vp.camera.position, c.target).multiplyScalar(1 / f);
    this.vp.camera.position.copy(c.target).add(dir);
    c.update();
    this.vp.invalidate();
  }

  toggleTheme() {
    const next = this.prefs.theme === 'light' ? 'dark' : 'light';
    this.prefs.theme = next;
    this.savePrefs();
    document.documentElement.setAttribute('data-theme', next);
    this.applyView();
    this.draft.invalidate();
    this.timeline.drawRuler();
    this.refreshUI();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => this.flash('Full screen was refused by the browser', 'warn'));
  }

  stopMeasuring() { this.vp.setMeasureMode(null); $('#hud').textContent = ''; this.refreshRibbon(); }

  showMeasure(r) {
    if (!r) return;
    const u = store.doc.meta.units;
    if (r.kind === 'distance') {
      $('#hud').textContent = `distance  ${fmt(toDisplay(r.value, u))} ${u}\nΔ  ${fmt(toDisplay(r.delta.x, u))}, ${fmt(toDisplay(r.delta.y, u))}, ${fmt(toDisplay(r.delta.z, u))}`;
      this.flash(`Distance ${fmt(toDisplay(r.value, u))} ${u}`, 'ok', 6000);
    } else if (r.kind === 'angle') {
      $('#hud').textContent = `angle  ${fmt(r.value)}°`;
      this.flash(`Angle ${fmt(r.value)}°`, 'ok', 6000);
    } else if (r.kind === 'point') {
      $('#hud').textContent = `point  ${fmt(toDisplay(r.point.x, u))}, ${fmt(toDisplay(r.point.y, u))}, ${fmt(toDisplay(r.point.z, u))}`;
    }
    this.markLearn('measure');
  }

  /* ============================================================ panels
   *
   * Three layouts share one set of commands.
   *
   *   Desktop  two independent side panels, each collapsible on its own.
   *   Tablet   one dock column beside the stage. Both panels still exist and
   *            still render; `data-dock` on <html> decides which is on screen
   *            and `.dock-collapsed` hides the column entirely. Two 280px
   *            panels would leave about 200px of viewport on an iPad in
   *            portrait, which is not a CAD viewport.
   *   Phone    panels become bottom sheets, handled by MobileShell.
   *
   * `togglePanel` is what every surface calls (the T and N keys, the Window
   * menu, the panel-head buttons), so the branch lives there and nowhere else.
   */

  /** Which panel the tablet dock is currently showing. */
  get dock() { return document.documentElement.dataset.dock === 'left' ? 'left' : 'right'; }

  /** Show `side` in the tablet dock, opening the dock if it was collapsed. */
  setDock(side) {
    document.documentElement.dataset.dock = side;
    $('#workarea').classList.remove('dock-collapsed');
    this.prefs.dock = side;
    this.savePrefs();
    setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 30);
    this.refreshUI();
  }

  /** Hide or show the whole tablet dock. Bound to the floating cluster. */
  toggleDock() {
    $('#workarea').classList.toggle('dock-collapsed');
    setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 30);
    this.refreshUI();
  }

  isCollapsed(side) {
    if (isPhone()) return true;
    if (isTablet()) return this.dock !== side || $('#workarea').classList.contains('dock-collapsed');
    return $('#workarea').classList.contains(`${side}-collapsed`);
  }

  togglePanel(which) {
    if (which === 'timeline') { this.setTimelineVisible($('#timeline').hidden); this.refreshUI(); return; }
    if (isPhone()) { this.mobile.togglePanelSheet(which); return; }
    if (isTablet()) {
      // Asking for the panel that is already showing means "put it away";
      // asking for the other one swaps the dock rather than stacking them.
      if (this.isCollapsed(which)) this.setDock(which); else this.toggleDock();
      return;
    }
    $('#workarea').classList.toggle(`${which}-collapsed`);
    setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 30);
    this.refreshUI();
  }

  zenMode() {
    const w = $('#workarea');
    const tablet = isTablet();
    const on = tablet
      ? !w.classList.contains('dock-collapsed')
      : !(w.classList.contains('left-collapsed') && w.classList.contains('right-collapsed'));
    if (tablet) {
      w.classList.toggle('dock-collapsed', on);
    } else {
      w.classList.toggle('left-collapsed', on);
      w.classList.toggle('right-collapsed', on);
    }
    if (on) this.setTimelineVisible(false);
    setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 30);
    this.flash(on ? 'Zen mode — press Ctrl ⇧ Z to bring the panels back' : 'Panels restored', 'info', 2200);
    this.refreshUI();
  }

  resetLayout() {
    const w = $('#workarea');
    w.classList.remove('left-collapsed', 'right-collapsed', 'mobile-left', 'mobile-right', 'dock-collapsed');
    document.documentElement.dataset.dock = this.prefs.dock === 'left' ? 'left' : 'right';
    this.setTimelineVisible(this.workspace === 'sim');
    setTimeout(() => { this.vp.resize(); this.draft.resize(); }, 30);
    this.refreshUI();
  }

  /* ========================================================== chrome */

  buildWorkspaceTabs() {
    const host = clear($('#workspaces'));
    for (const [id, meta] of Object.entries(WS_META)) {
      host.appendChild(el('button', {
        class: 'ws', role: 'tab', dataset: { ws: id },
        'aria-selected': String(id === this.workspace),
        title: `${meta.label} workspace`,
        onclick: () => this.setWorkspace(id),
      }, [icon(meta.icon, { size: 15 }), el('span', { class: 'ws-label', text: meta.label })]));
    }
  }

  buildDocChip() {
    const host = clear($('#docChip'));
    const input = el('input', { id: 'docName', value: store.doc.meta.name, spellcheck: 'false', 'aria-label': 'Document name' });
    input.addEventListener('change', () => store.quiet((d) => { d.meta.name = input.value || 'Untitled'; }));
    host.append(icon('doc-props', { size: 14 }), input, el('span', { class: 'doc-dirty', id: 'docDirty', title: 'Unsaved changes' }));
  }

  buildTopActions() {
    const host = clear($('#topActions'));
    const btn = (id, ic, title) => {
      const b = el('button', { class: 'icon-btn', title, 'aria-label': title, dataset: { cmd: id }, onclick: () => this.run(id) }, [icon(ic, { size: 16 })]);
      host.appendChild(b);
      return b;
    };
    btn('edit.undo', 'undo', 'Undo  (Ctrl Z)');
    btn('edit.redo', 'redo', 'Redo  (Ctrl ⇧ Z)');
    host.appendChild(el('span', { class: 'top-sep' }));
    btn('file.save', 'file-save', 'Save project  (Ctrl S)');
    btn('help.palette', 'command', 'Command palette  (Ctrl K)');
    host.appendChild(el('span', { class: 'top-sep' }));
    btn('view.theme', this.prefs.theme === 'light' ? 'sun' : 'moon', 'Light / dark theme');
    btn('help.shortcuts', 'help', 'Help and shortcuts  (F1)');
    this.updateTopActions();
  }

  updateTopActions() {
    for (const b of $$('#topActions .icon-btn')) {
      const c = this.commandMap.get(b.dataset.cmd);
      if (c?.enabled) b.disabled = !c.enabled();
    }
  }

  /** Resolve a command id into a menu item with live checked/enabled state. */
  menuItem(id) {
    const c = this.commandMap.get(id);
    if (!c) return { label: id, disabled: true };
    return {
      label: c.label, icon: c.icon, key: c.key, danger: c.danger,
      checked: c.checked ? c.checked() : false,
      disabled: c.enabled ? !c.enabled() : false,
      run: () => this.run(id),
    };
  }

  buildMenus() {
    const bar = clear($('#menubar'));
    const defs = menuDefs(this, (id) => this.menuItem(id));
    for (const [label, itemsFn] of defs) {
      const b = el('button', { text: label });
      b.addEventListener('click', () => {
        if (b.classList.contains('open')) { closeDropdown(); return; }
        dropdown(b, itemsFn().filter(Boolean));
      });
      b.addEventListener('pointerenter', () => {
        if (isDropdownOpen() && !b.classList.contains('open')) dropdown(b, itemsFn().filter(Boolean));
      });
      bar.appendChild(b);
    }

    // Eleven menu buttons stop fitting somewhere around a tablet's width. Rather
    // than drop menus or scroll the bar, the same eleven collapse into one
    // button holding them as submenus; CSS decides which form is showing, so
    // both are always built and neither needs a resize listener.
    const compact = el('button', {
      class: 'menu-compact', title: 'All menus', 'aria-label': 'All menus', 'aria-haspopup': 'true',
    }, [icon('menu', { size: 16 }), el('span', { text: 'Menu' })]);
    compact.addEventListener('click', () => {
      if (compact.classList.contains('open')) { closeDropdown(); return; }
      dropdown(compact, defs.map(([label, itemsFn]) => ({
        label, icon: MENU_ICON[label], sub: itemsFn().filter(Boolean),
      })));
    });
    bar.appendChild(compact);
  }

  buildRibbon() {
    const bar = clear($('#ribbon'));
    for (const group of ribbonDefs(this)) {
      const items = el('div', { class: 'rb-items' });
      for (const it of group.items) {
        if (typeof it === 'string') items.appendChild(this.ribbonButton(it));
        else if (it.custom) items.appendChild(this.ribbonCustom(it.custom));
      }
      bar.appendChild(el('div', { class: 'rb-group' }, [items, el('div', { class: 'rb-label', text: group.label })]));
    }
    this.refreshRibbon();
  }

  ribbonButton(id) {
    const c = this.commandMap.get(id);
    if (!c) return el('span');
    const short = SHORT_LABEL[id] || c.label;
    return el('button', {
      class: 'tool', dataset: { cmd: id },
      title: `${c.label}${c.key ? `   ${c.key}` : ''}`,
      onclick: () => this.run(id),
    }, [icon(c.icon || 'dots', { size: 18 }), el('span', { class: 'tx', text: short })]);
  }

  ribbonCustom(kind) {
    if (kind === 'moreSolids') {
      const rest = Object.entries(CATALOG).filter(([, c]) => c.group === 'solid').slice(8);
      return el('button', {
        class: 'tool', title: 'More solids',
        onclick: (e) => dropdown(e.currentTarget, rest.map(([t]) => this.menuItem(`add.${t}`))),
      }, [icon('dots', { size: 18 }), el('span', { class: 'tx', text: 'More' })]);
    }
    if (kind === 'layerPicker') {
      const draw = store.doc.draw;
      const active = draw.layers.find(l => l.id === draw.activeLayer) || draw.layers[0];
      return el('button', {
        class: 'tool compact', title: 'Active drawing layer',
        onclick: (e) => dropdown(e.currentTarget, [
          { header: 'Active layer' },
          ...draw.layers.map(l => ({
            label: l.name, icon: 'layers', checked: l.id === draw.activeLayer,
            run: () => { store.edit('Active layer', (d) => { d.draw.activeLayer = l.id; }, { rebuild: false }); this.refreshUI(); this.buildRibbon(); },
          })),
          '-', this.menuItem('draft.addLayer'),
        ]),
      }, [
        el('span', { style: { width: '11px', height: '11px', borderRadius: '3px', background: active?.color || '#888', border: '1px solid rgba(127,127,127,.5)' } }),
        el('span', { class: 'tx', text: active?.name || '0' }),
        icon('chevron-down', { size: 12 }),
      ]);
    }
    if (kind === 'speedPicker') {
      const sp = store.doc.sim.speed || 1;
      return el('button', {
        class: 'tool compact', title: 'Playback speed',
        onclick: (e) => dropdown(e.currentTarget, [0.1, 0.25, 0.5, 1, 2, 4].map(s => ({
          label: `${s}×`, checked: s === sp,
          run: () => { store.quiet((d) => { d.sim.speed = s; }); this.buildRibbon(); this.timeline.render(); },
        }))),
      }, [icon('gauge', { size: 18 }), el('span', { class: 'tx', text: `${sp}×` }), icon('chevron-down', { size: 12 })]);
    }
    return el('span');
  }

  refreshRibbon() {
    for (const b of $$('#ribbon .tool[data-cmd]')) {
      const c = this.commandMap.get(b.dataset.cmd);
      if (!c) continue;
      if (c.enabled) b.disabled = !c.enabled();
      if (c.checked) b.classList.toggle('toggled', !!c.checked());
    }
  }

  buildViewCube() {
    const host = clear($('#viewcube'));
    const mk = (label, view, wide = false) => el('button', {
      class: `vc${wide ? ' wide' : ''}`, text: label, title: `${label} view`,
      onclick: () => this.vp.standardView(view),
    });
    host.append(
      el('div', { class: 'vc-row' }, [mk('TOP', 'top'), mk('FRT', 'front'), mk('RGT', 'right')]),
      el('div', { class: 'vc-row' }, [mk('BTM', 'bottom'), mk('BCK', 'back'), mk('LFT', 'left')]),
      el('div', { class: 'vc-row' }, [
        mk('ISO', 'iso', true),
        el('button', { class: 'vc', title: 'Zoom to fit  (F)', onclick: () => this.zoomFit() }, [icon('fit', { size: 13 })]),
      ]),
    );
    this.drawAxisHint();
    bus.on(T.VIEW, () => this.drawAxisHint());
  }

  drawAxisHint() {
    const host = $('#axisHint');
    if (!host) return;
    if (!this._axisSvg) {
      host.innerHTML = '<svg viewBox="-40 -40 80 80" width="72" height="72"></svg>';
      this._axisSvg = host.firstChild;
    }
    const m = new THREE.Matrix4().copy(this.vp.camera.matrixWorldInverse);
    const project = (v) => { const p = v.clone().applyMatrix4(m); return [p.x, -p.y]; };
    let svg = '';
    for (const [v, colour, label] of [
      [new THREE.Vector3(30, 0, 0), 'var(--x-axis)', 'X'],
      [new THREE.Vector3(0, 30, 0), 'var(--y-axis)', 'Y'],
      [new THREE.Vector3(0, 0, 30), 'var(--z-axis)', 'Z'],
    ]) {
      const [x, y] = project(v);
      const len = Math.hypot(x, y) || 1;
      const k = Math.min(1, 29 / len);
      svg += `<line x1="0" y1="0" x2="${(x * k).toFixed(1)}" y2="${(y * k).toFixed(1)}" stroke="${colour}" stroke-width="2.2" stroke-linecap="round"/>`;
      svg += `<circle cx="${(x * k).toFixed(1)}" cy="${(y * k).toFixed(1)}" r="6.5" fill="${colour}"/>`;
      svg += `<text x="${(x * k).toFixed(1)}" y="${(y * k + 3).toFixed(1)}" fill="#fff" font-size="8.5" text-anchor="middle" font-family="system-ui" font-weight="700">${label}</text>`;
    }
    this._axisSvg.innerHTML = svg;
  }

  /* ========================================================= status bar */

  updateStatus() {
    const s = this.build?.stats;
    const u = store.doc.meta.units;
    const units = clear($('#statusUnits'));
    units.append(icon('ruler', { size: 12 }), el('span', { text: u }));

    const sel = clear($('#statusSel'));
    const n = this.workspace === 'draft' ? this.draft.selection.size : this.selection.size;
    if (n) sel.append(icon('target', { size: 12 }), el('span', { text: `${n} selected` }));

    if (this.workspace === 'draft') {
      $('#statusStats').textContent = `${store.doc.draw.entities.length} objects · ${store.doc.draw.layers.length} layers`;
    } else if (s) {
      $('#statusStats').textContent = `${s.bodies} bodies · ${s.tris.toLocaleString()} tris · ${fmt(s.mass, 3)} kg · ${Math.round(this.buildMs || 0)} ms`;
    }
    this.updateDoctorBadge();
    if (!this.ops.running) this.setStatusKeys(this.defaultKeyHints());
  }

  /**
   * The Doctor's headline in the status bar.
   *
   * A count that is always on screen is the difference between checking being
   * something you do and something that is simply true of the model. Clicking
   * it opens the full report; the colour is the worst finding, not an average.
   */
  updateDoctorBadge() {
    const btn = $('#statusDoctor');
    if (btn) {
      const r = this.report;
      if (!r || this.workspace === 'draft') {
        btn.hidden = true;
      } else {
        btn.hidden = false;
        btn.className = `sb-item sb-btn dx-${r.counts.block ? 'err' : r.counts.warn ? 'warn' : r.issues.length ? 'info' : 'ok'}`;
        btn.onclick = () => this.showDoctorReport();
        btn.title = `${r.checked} checks ran. Click for the full report.`;
        clear(btn);
        btn.append(
          icon(r.counts.block ? 'warning' : r.issues.length ? 'probe' : 'check', { size: 12 }),
          el('span', { text: r.counts.block ? `${r.counts.block} blocking`
            : r.counts.warn ? `${r.counts.warn} warning${r.counts.warn === 1 ? '' : 's'}`
              : r.issues.length ? `${r.issues.length} note${r.issues.length === 1 ? '' : 's'}` : 'Checks pass' }),
        );
      }
    }

    const rec = $('#statusRec');
    if (rec) {
      if (!this.macro?.isRecording) { rec.hidden = true; } else {
        rec.hidden = false;
        clear(rec);
        rec.append(icon('record', { size: 12 }), el('span', { text: `Recording · ${this.macro.recording.steps.length}` }));
      }
    }
  }

  defaultKeyHints() {
    if (matchMedia('(pointer: coarse)').matches) {
      if (this.workspace === 'draft') return [['tap', 'draw'], ['2 fingers', 'pan / zoom'], ['hold', 'menu']];
      return [['drag', 'orbit'], ['2 fingers', 'pan / zoom'], ['hold', 'menu']];
    }
    if (this.workspace === 'draft') return [['LMB', 'draw'], ['RMB', 'pan'], ['wheel', 'zoom'], ['F3/F8', 'snap/ortho']];
    if (this.workspace === 'sim') return [['space', 'play'], [',/.', 'step'], ['K', 'key pose']];
    return [['LMB', 'select'], ['RMB', 'menu'], ['G/R/S', 'transform'], ['Q', 'quick'], ['Ctrl K', 'commands']];
  }

  setStatusKeys(pairs) {
    const host = clear($('#statusKeys'));
    if (!pairs) return;
    for (const [k, label] of pairs) {
      host.appendChild(el('span', {}, [el('kbd', { text: k }), el('span', { text: label })]));
    }
  }

  draftStatus({ coords, prompt, snap }) {
    $('#statusCoords').textContent = coords;
    if (this.workspace === 'draft') status(prompt ? `${prompt}${snap ? `   ·   snap: ${snap}` : ''}` : 'Ready');
  }

  /* ========================================================= learn card */

  LEARN_STEPS = [
    ['create', 'Add a solid from the <b>Create</b> group'],
    ['select', 'Click it in the viewport'],
    ['transform', 'Press <b>G</b> and move it, then type a number'],
    ['boolean', 'Select two bodies and press <b>Subtract</b>'],
    ['draw', 'Switch to <b>Draft</b> and draw a shape'],
    ['extrude', 'Select it and press <b>Extrude</b>'],
    ['sequence', 'In <b>Simulate</b>, press <b>Sequence</b>'],
    ['play', 'Press <b>space</b> to play the timeline'],
  ];

  markLearn(step) {
    if (this.prefs.learnDone.includes(step)) return;
    this.prefs.learnDone.push(step);
    this.savePrefs();
    this.renderLearn();
  }

  toggleLearn() {
    this.prefs.showLearn = !this.prefs.showLearn;
    this.savePrefs();
    this.renderLearn();
  }

  /**
   * The card in the corner of the viewport.
   *
   * It starts as the eight-step tour and then becomes the why-tutor: once you
   * have done the eight things, the card keeps its place on screen but switches
   * to explaining the engineering reason behind whatever the document is
   * currently doing. That ordering matters — an explanation of draft angles is
   * noise to someone who has not yet made a box, and the single most useful
   * thing to a person who has.
   */
  renderLearn() {
    const card = $('#learnCard');
    if (!card) return;
    if (!this.prefs.showLearn) { card.hidden = true; return; }
    const done = new Set(this.prefs.learnDone);
    if (done.size >= this.LEARN_STEPS.length) { this.renderWhy(card); return; }

    card.hidden = false;
    card.classList.remove('why');
    clear(card);
    const next = this.LEARN_STEPS.findIndex(([k]) => !done.has(k));
    card.append(
      el('h4', {}, [
        icon('bulb', { size: 15 }),
        el('span', { text: `Learn TesserCAD · ${done.size}/${this.LEARN_STEPS.length}` }),
        el('button', { class: 'mini-btn', title: 'Hide this card', onclick: () => this.toggleLearn() }, [icon('close', { size: 13 })]),
      ]),
      el('ol', {}, this.LEARN_STEPS.slice(Math.max(0, next - 1), next + 2).map(([k, html]) =>
        el('li', { class: done.has(k) ? 'done' : '', html }))),
      el('div', { class: 'learn-bar' }, [el('i', { style: { width: `${(done.size / this.LEARN_STEPS.length) * 100}%` } })]),
    );
  }

  renderWhy(card) {
    if (!this.build) { card.hidden = true; return; }
    const lesson = nextLesson(store.doc, this.build, this.report);
    if (!lesson) { card.hidden = true; return; }
    // Re-rendering the same lesson would restart its animation on every rebuild.
    if (this._whyId === lesson.id && !card.hidden) return;
    this._whyId = lesson.id;

    card.hidden = false;
    card.classList.add('why');
    clear(card);
    card.append(
      el('h4', {}, [
        icon(lesson.kind === 'finding' ? 'probe' : 'bulb', { size: 15 }),
        el('span', { text: lesson.kind === 'finding' ? 'Why this matters' : 'Worth knowing' }),
        el('button', {
          class: 'mini-btn', title: 'Got it',
          onclick: () => { dismissLesson(lesson.id); this._whyId = null; this.renderLearn(); },
        }, [icon('check', { size: 13 })]),
      ]),
      el('div', { class: 'why-title', text: lesson.title }),
      el('div', { class: 'why-body', text: lesson.body }),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn sm', text: 'Got it',
          onclick: () => { dismissLesson(lesson.id); this._whyId = null; this.renderLearn(); },
        }),
        el('button', { class: 'btn sm ghost', text: 'Stop showing these', onclick: () => this.toggleLearn() }),
      ]),
    );
  }

  /* ============================================================ dialogs */

  /**
   * The history dialog, which is where the tree earns its keep.
   *
   * Three groups: what you can go back to, where you are, and what is ahead.
   * Then a fourth that no linear undo stack can offer at all: the states you
   * undid past and then edited away from. In every other package those are
   * gone. Here they are a click away for as long as the session lasts.
   */
  showHistory() {
    const t = store.timeline();
    const body = el('div');

    const row = (entry, kind) => el('div', {
      class: `hist-item ${kind}`,
      onclick: () => {
        if (kind !== 'now') { store.gotoNode(entry.id); this.refreshUI(); }
        closeModal();
      },
    }, [
      icon(kind === 'now' ? 'target' : kind === 'future' ? 'redo' : kind === 'abandoned' ? 'merge' : 'undo', { size: 14 }),
      el('span', { class: 'hn', text: entry.label }),
      el('span', { class: 'hi', text: kind === 'now' ? 'you are here' : '' }),
    ]);

    if (!t.past.length && !t.future.length && !t.abandoned.length) {
      body.appendChild(emptyState('Nothing to undo yet', 'Every edit you make lands here. View settings do not: changing the grid or the shading is not an edit, so it never costs you an undo.', 'history'));
    } else {
      body.appendChild(el('div', { class: 'hist-list' }, [
        ...t.past.map(p => row(p, 'past')),
        row(t.now, 'now'),
        ...t.future.map(f => row(f, 'future')),
      ]));
      if (t.abandoned.length) {
        body.appendChild(section(`Branches you left · ${t.abandoned.length}`, [
          el('p', { class: 'hint', text: 'These are states you undid past and then edited away from. A linear undo stack throws them away the moment you make that next edit; here they are still reachable. Click one to go back to it, and the branch you are on now stays reachable too.' }),
          el('div', { class: 'hist-list' }, t.abandoned.slice(0, 40).map(a => row(a, 'abandoned'))),
        ], true, { icon: 'merge' }));
      }
    }

    modal({
      title: 'History', icon: 'history', wide: !!t.abandoned.length,
      subtitle: `${t.past.length} step${t.past.length === 1 ? '' : 's'} back, ${t.future.length} forward` +
        (t.abandoned.length ? `, ${t.abandoned.length} on branches you left` : ''),
      body,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  showPrefs() {
    const p = this.prefs;
    modal({
      title: 'Preferences', icon: 'settings',
      subtitle: 'Stored in this browser only — they travel with the machine, not the document.',
      body: [
        section('Appearance', [
          field('Theme', segmented(p.theme, [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun']], (v) => {
            if (v !== p.theme) this.toggleTheme();
          })),
          field('Edge angle', scrubNumber(p.edgeAngle, () => {}, {
            step: 1, min: 1, max: 89, precision: 0,
            onCommit: (v) => this.setPref('edgeAngle', v),
          }), { hint: 'Faces meeting at more than this angle get a drawn edge. Lower shows more edges.' }),
        ]),
        section('Interaction', [
          field('Gizmo size', scrubNumber(p.gizmoSize, () => {}, {
            step: 0.05, min: 0.3, max: 2, precision: 2, onCommit: (v) => this.setPref('gizmoSize', v),
          })),
          field('Snap step', scrubNumber(p.snapStep, () => {}, {
            step: 1, min: 0.1, max: 100, precision: 2, onCommit: (v) => this.setPref('snapStep', v),
          }), { hint: 'Hold Ctrl during a move operator to snap to this increment.' }),
          checkbox('Confirm before deleting', p.confirmDelete, (v) => this.setPref('confirmDelete', v)),
          checkbox('Show the learning card', p.showLearn, (v) => { this.prefs.showLearn = v; this.savePrefs(); this.renderLearn(); }),
        ]),
        section('Session', [
          field('Autosave every', scrubNumber(p.autosaveSec, () => {}, {
            step: 5, min: 5, max: 600, precision: 0, suffix: ' s',
            onCommit: (v) => {
              this.setPref('autosaveSec', v);
              clearInterval(this._autosave);
              this._autosave = setInterval(() => { if (store.dirty) { saveLocal(); this.markSaved(); } }, v * 1000);
            },
          }), { hint: 'Seconds between automatic saves into browser storage.' }),
          el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn sm', text: 'Reset the learning card', onclick: () => { this.prefs.learnDone = []; this.savePrefs(); this.renderLearn(); this.flash('Learning card reset', 'ok'); } }),
            el('button', { class: 'btn sm danger', text: 'Reset all preferences', onclick: () => {
              this.prefs = { ...DEFAULT_PREFS };
              this.savePrefs();
              document.documentElement.setAttribute('data-theme', this.prefs.theme);
              closeModal();
              this.refreshUI();
              this.flash('Preferences reset', 'ok');
            } }),
          ]),
        ]),
      ],
      actions: [{ label: 'Done', primary: true }],
    });
  }

  showMassReport() {
    if (!this.build) return;
    const u = store.doc.meta.units;
    const rows = [];
    let totalV = 0, totalM = 0;
    for (const f of this.build.topLevel) {
      const r = this.build.results.get(f.id);
      if (!r || r.error) continue;
      let v = 0;
      for (const inst of r.instances) v += massProperties(inst.geometry, inst.matrix).volume;
      const m = v * (MATERIALS[f.material] || MATERIALS.steel).density;
      totalV += v; totalM += m;
      rows.push([f.name, MATERIALS[f.material]?.name || f.material, String(r.instances.length), `${fmt(v)} mm³`, `${fmt(m, 4)} kg`]);
    }
    const s = this.build.stats;
    const size = s.box.isEmpty() ? null : s.box.getSize(new THREE.Vector3());
    const table = el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' } });
    table.appendChild(el('tr', {}, ['Body', 'Material', 'Count', 'Volume', 'Mass'].map(h =>
      el('th', { text: h, style: { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--line)', color: 'var(--txt-3)', fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.07em' } }))));
    for (const r of rows) {
      table.appendChild(el('tr', {}, r.map((cell, i) =>
        el('td', { text: cell, style: { padding: '4px 6px', borderBottom: '1px solid var(--line-soft)', fontFamily: i >= 2 ? 'var(--mono)' : '', textAlign: i >= 2 ? 'right' : 'left' } }))));
    }
    modal({
      title: 'Mass properties', icon: 'mass', wide: true,
      subtitle: `${s.bodies} bodies · ${s.tris.toLocaleString()} triangles`,
      body: [
        rows.length ? table : emptyState('Nothing to measure', 'Add a solid first.', 'mass'),
        el('h3', { text: 'Totals' }),
        kv([
          ['Volume', `${fmt(totalV)} mm³`],
          ['Mass', `${fmt(totalM, 4)} kg`],
          ['Overall size', size ? `${fmt(toDisplay(size.x, u))} × ${fmt(toDisplay(size.y, u))} × ${fmt(toDisplay(size.z, u))} ${u}` : '–'],
          ['Centre of mass', s.bodies ? `${fmt(s.centroid.x)}, ${fmt(s.centroid.y)}, ${fmt(s.centroid.z)} mm` : '–'],
          ['Surface area', `${fmt(s.area)} mm²`],
        ]),
        el('p', { class: 'hint', text: 'Volumes come from the divergence theorem over each closed mesh, so they are exact for watertight bodies and meaningless for open ones — the feature panel reports which is which.' }),
      ],
      actions: [
        { label: 'Export CSV', run: () => this.exportBOM() },
        { label: 'Close', primary: true },
      ],
    });
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

  /* ------------------------------------------------- the doctor, in full */

  showDoctorReport() {
    if (!this.build) return;
    this.runDoctor();
    const r = this.report;
    if (!r) { this.flash('Continuous checking is switched off in Studio standards.', 'warn'); return; }
    const proc = processOf(store.doc.studio?.process || Studio.standards().process);

    const body = [
      el('p', { class: 'hint', text: `${r.checked} checks ran against ${proc.label}. ${proc.note}` }),
    ];
    if (!r.issues.length) {
      body.push(el('div', { class: 'banner ok', text: 'Everything passes. The model is ready to release.' }));
    } else {
      for (const issue of r.issues) {
        const sev = issue.severity === 3 ? 'err' : issue.severity === 2 ? 'warn' : 'info';
        body.push(el('div', { class: `dx-item ${sev}` }, [
          el('div', { class: 'dx-head' }, [
            el('span', { class: `dx-sev ${sev}`, text: severityLabel(issue.severity) }),
            el('span', { class: 'dx-title', text: issue.title }),
          ]),
          issue.detail ? el('div', { class: 'dx-detail', text: issue.detail }) : null,
          issue.why ? el('div', { class: 'dx-why', text: issue.why }) : null,
          issue.fix ? el('div', { class: 'btn-row' }, [
            el('button', {
              class: 'btn sm primary', text: issue.fix.label,
              onclick: (e) => { this.applyFix(issue); e.target.disabled = true; e.target.textContent = 'Applied'; },
            }),
          ]) : null,
        ].filter(Boolean)));
      }
    }
    modal({
      title: 'Design doctor', icon: 'probe', wide: true,
      subtitle: r.issues.length
        ? `${r.counts.block} blocking · ${r.counts.warn} warnings · ${r.counts.note} notes`
        : 'No findings',
      body,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  /* --------------------------------------------------- cost and release */

  showCostReport() {
    if (!this.build) return;
    const { parts, batch, rates, standards: s } = this.costInputs();
    if (!parts.length) { this.flash('No bodies to cost.', 'warn'); return; }

    const est = costDocument(parts, { batch, rates });
    const body = [];

    body.push(el('div', { class: 'banner warn', text: 'Order-of-magnitude estimates from a generic rate model, not a quote. Read the shape of the answer — which process wins, which dimension drives the price — and ignore the absolute figures.' }));

    const qtyRow = el('div', { class: 'row wide' }, [
      el('label', { text: 'Batch size' }),
      select(String(batch), QUANTITIES.map(q => [String(q), String(q)]), (v) => {
        const n = Number(v);
        store.quiet((d) => { d.studio = { ...(d.studio || {}), batch: n }; });
        Studio.setStandard('batch', n);
        closeModal();
        this.showCostReport();
      }),
    ]);
    body.push(qtyRow);

    body.push(el('div', { class: 'big-stat' }, [
      el('span', { class: 'bs-value', text: est.each.toFixed(2) }),
      el('span', { class: 'bs-unit', text: `${s.currency ? s.currency + ' ' : ''}per unit at ${batch} off` }),
    ]));

    for (const { part, cost } of est.rows) {
      const cmp = compare(part, { batch, rates });
      body.push(section(part.name, [
        kv([
          ['Cheapest process', cost.label],
          ['Each', cost.each.toFixed(2)],
          ['Material', `${cost.material.toFixed(2)}  (${(cost.materialKg * 1000).toFixed(0)} g billed)`],
          ['Machine time', `${cost.machine.toFixed(2)}  (${cost.hours.toFixed(2)} h)`],
          ['Setup, per part', cost.setup.toFixed(2)],
          ['Tooling, per part', cost.tooling.toFixed(2)],
        ]),
        el('div', { class: 'hint', text: `Biggest cost driver: ${cost.drivers[0]?.label || 'none'}.` +
          (cost.removedFraction > 0.6 ? ` ${(cost.removedFraction * 100).toFixed(0)}% of the stock block is cut away and thrown out.` : '') }),
        el('table', { class: 'mass-table' }, [
          el('thead', {}, [el('tr', {}, ['Process', 'Each', 'Material', 'Machine'].map(h => el('th', { text: h })))]),
          el('tbody', {}, cmp.rows.map(row => el('tr', { class: row.processId === cost.processId ? 'on' : '' }, [
            el('td', { text: row.label }),
            el('td', { class: 'mono', text: row.each.toFixed(2) }),
            el('td', { class: 'mono', text: row.material.toFixed(2) }),
            el('td', { class: 'mono', text: row.machine.toFixed(2) }),
          ]))),
        ]),
      ], true, { icon: 'gauge' }));
    }

    if (parts.length === 1) {
      const cross = crossovers(parts[0], { rates });
      const lev = levers(parts[0], { batch, rates });
      body.push(section('How quantity changes the answer', [
        el('table', { class: 'mass-table' }, [
          el('thead', {}, [el('tr', {}, ['Quantity', 'Cheapest', 'Each'].map(h => el('th', { text: h })))]),
          el('tbody', {}, cross.points.map(pt => el('tr', {}, [
            el('td', { class: 'mono', text: String(pt.qty) }),
            el('td', { text: pt.label || '–' }),
            el('td', { class: 'mono', text: pt.each.toFixed(2) }),
          ]))),
        ]),
        ...cross.changes.map(c => el('div', { class: 'hint', text: `Between ${c.from.qty} and ${c.to.qty} off, ${c.to.label} overtakes ${c.from.label}.` })),
        cross.changes.length ? null : el('div', { class: 'hint', text: 'One process wins at every quantity here, so the decision does not hinge on volume.' }),
      ].filter(Boolean), true, { icon: 'timeline' }));

      if (lev.length) {
        body.push(section('What would make it cheaper', lev.map(l => el('div', { class: 'dx-item info' }, [
          el('div', { class: 'dx-head' }, [
            el('span', { class: 'dx-sev info', text: `−${(l.saving * 100).toFixed(0)}%` }),
            el('span', { class: 'dx-title', text: l.label }),
          ]),
          el('div', { class: 'dx-why', text: l.note }),
          el('div', { class: 'dx-detail', text: `${l.each.toFixed(2)} each by ${l.process}.` }),
        ])), true, { icon: 'bulb' }));
      }
    }

    modal({
      title: 'Cost estimate', icon: 'gauge', wide: true,
      subtitle: `${parts.length} part${parts.length === 1 ? '' : 's'} · batch of ${batch} · ${est.mass.toFixed(3)} kg total`,
      body,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  showRelease() {
    if (!this.build) return;
    const s = Studio.standards();
    const proc = store.doc.studio?.process || s.process;
    const batch = store.doc.studio?.batch || s.batch;
    this.runDoctor();
    const r = this.report || diagnose(store.doc, this.build, { process: proc });
    const blocking = r.issues.filter(i => i.severity === 3);

    const body = [
      el('p', { class: 'hint', text: 'One archive with the geometry, the drawing, the bill of materials, the cost basis, the editable source and a record of every check that ran.' }),
      el('div', { class: 'row wide' }, [
        el('label', { text: 'Process' }),
        select(proc, Object.entries(PROCESSES).map(([k, v]) => [k, v.label]), (v) => {
          store.quiet((d) => { d.studio = { ...(d.studio || {}), process: v }; });
          Studio.setStandard('process', v);
          closeModal(); this.showRelease();
        }),
      ]),
      el('div', { class: 'row wide' }, [
        el('label', { text: 'Batch size' }),
        select(String(batch), QUANTITIES.map(q => [String(q), String(q)]), (v) => {
          store.quiet((d) => { d.studio = { ...(d.studio || {}), batch: Number(v) }; });
          Studio.setStandard('batch', Number(v));
          closeModal(); this.showRelease();
        }),
      ]),
    ];

    if (blocking.length) {
      body.push(el('div', { class: 'banner err', text: `${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'} must be cleared first. Releasing is the moment an error costs the most, so this one is not a warning you can click past.` }));
      for (const i of blocking) {
        body.push(el('div', { class: 'dx-item err' }, [
          el('div', { class: 'dx-head' }, [el('span', { class: 'dx-title', text: i.title })]),
          i.detail ? el('div', { class: 'dx-detail', text: i.detail }) : null,
          i.fix ? el('div', { class: 'btn-row' }, [
            el('button', {
              class: 'btn sm primary', text: i.fix.label,
              onclick: () => { this.applyFix(i); closeModal(); setTimeout(() => this.showRelease(), 60); },
            }),
          ]) : null,
        ].filter(Boolean)));
      }
    } else {
      body.push(el('div', { class: 'banner ok', text: `All ${r.checked} checks pass. ${r.counts.warn} warning${r.counts.warn === 1 ? '' : 's'} and ${r.counts.note} note${r.counts.note === 1 ? '' : 's'} will be recorded in the package.` }));
    }

    modal({
      title: 'Release design', icon: 'download', wide: true,
      subtitle: store.doc.meta.name,
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: blocking.length ? 'Release anyway' : 'Build the package',
          primary: !blocking.length, danger: !!blocking.length,
          run: () => {
            const out = releasePackage(this, { process: proc, batch, force: true });
            if (!out.ok) this.flash(out.reason || 'Release failed', 'err', 6000);
            else this.flash(`${out.name}: ${out.files.length} files`, 'ok', 5000);
          },
        },
      ],
    });
  }

  /* ------------------------------------------------------- design brief */

  showBrief() {
    const s = Studio.standards();
    let id = ARCHETYPE_IDS[0];
    let material = s.material;
    const values = {};

    const host = el('div');
    const preview = el('div', { class: 'brief-preview' });

    const renderPreview = () => {
      clear(preview);
      let result;
      try { result = synthesise(id, values, { material, process: s.process }); }
      catch (e) { preview.appendChild(el('div', { class: 'banner err', text: e.message })); return null; }

      preview.append(
        el('div', { class: 'msec-head', text: 'How it will be sized' }),
        el('ul', { class: 'why-list' }, result.rationale.map(t => el('li', { text: t }))),
      );
      if (result.warnings.length) {
        for (const w of result.warnings) preview.appendChild(el('div', { class: 'banner warn', text: w }));
      }
      preview.append(
        el('div', { class: 'msec-head', text: `${result.params.length} parameters, ${result.features.length} features` }),
        el('div', { class: 'hint', text: result.params.map(p => p.name).join(' · ') }),
        el('div', { class: 'hint', text: `Every dimension above is written into the model as an expression, so changing the load changes the part.` }),
      );
      return result;
    };

    const renderFields = () => {
      clear(host);
      const arch = ARCHETYPES[id];
      for (const f of arch.fields) if (values[f.key] === undefined) values[f.key] = f.def;

      host.appendChild(el('div', { class: 'card-grid' }, ARCHETYPE_IDS.map(k => el('button', {
        class: `card${k === id ? ' on' : ''}`,
        onclick: () => { id = k; for (const key of Object.keys(values)) delete values[key]; renderFields(); },
      }, [
        icon(ARCHETYPES[k].icon, { size: 20 }),
        el('b', { text: ARCHETYPES[k].label }),
        el('span', { text: ARCHETYPES[k].blurb }),
      ]))));

      // The blurb is already on the selected card; repeating it here just
      // pushed the live sizing below the fold.
      const fields = el('div', { class: 'brief-fields' });
      const grid = el('div', { class: 'brief-grid' }, [fields, preview]);

      for (const f of arch.fields) {
        let control;
        if (f.kind === 'bool') {
          fields.appendChild(checkbox(f.label, !!values[f.key], (v) => { values[f.key] = v; renderPreview(); }));
          continue;
        }
        if (f.kind === 'select') {
          control = select(values[f.key], f.options.map(o => [o, o]), (v) => { values[f.key] = v; renderPreview(); });
        } else {
          const i = el('input', { type: 'number', value: String(values[f.key]), step: 'any' });
          i.addEventListener('input', () => { values[f.key] = Number(i.value); renderPreview(); });
          control = i;
        }
        fields.appendChild(el('div', { class: 'row wide' }, [
          el('label', { text: f.unit ? `${f.label} (${f.unit})` : f.label }), control,
        ]));
      }

      fields.appendChild(el('div', { class: 'row wide' }, [
        el('label', { text: 'Material' }),
        select(material, Object.entries(MATERIALS).map(([k, m]) => [k, `${m.name}${STRENGTH[k] ? ` · ${STRENGTH[k].yield} MPa` : ''}`]), (v) => {
          material = v; renderPreview();
        }),
      ]));
      host.appendChild(grid);
      renderPreview();
    };

    renderFields();

    modal({
      title: 'Design brief', icon: 'bulb', wide: true,
      subtitle: 'State the requirement; get an editable parametric model with the sizing shown.',
      body: [
        el('div', { class: 'banner warn', text: 'Closed-form textbook calculations on idealised sections. No stress concentrations, no fatigue, no buckling, no real boundary conditions. Not a substitute for analysis or for an engineer signing it off.' }),
        host,
      ],
      actions: [
        { label: 'Cancel' },
        {
          label: 'Build the model', primary: true,
          run: () => {
            const result = synthesise(id, values, { material, process: s.process });
            this.applyBrief(result, values);
          },
        },
      ],
    });
  }

  /** Turn a synthesised brief into a real document, in one undoable step. */
  applyBrief(result, values) {
    store.edit(`Design brief: ${result.label}`, (d) => {
      d.params = result.params.map(p => ({ id: uid('p'), name: p.name, value: p.value, note: p.note }));
      const made = [];
      for (const spec of result.features) {
        const f = makeFeature(spec.type, {
          name: spec.name,
          params: spec.params,
          material: result.material,
          pos: spec.pos,
          inputs: (spec.inputs || []).map(i => made[i]?.id).filter(Boolean),
        });
        made.push(f);
      }
      d.features = made;
      d.meta.notes = briefNotes(result, values);
    });
    Studio.logDecision({
      title: `${result.label} from a design brief`,
      choice: result.rationale[0] || '',
      why: result.rationale.join(' '),
      doc: store.doc.meta.name,
    });
    this.markLearn('create');
    setTimeout(() => this.vp.frameAll(), 120);
    this.flash(`${result.label} built. The sizing is in Document → notes.`, 'ok', 5200);
  }

  /* ------------------------------------------------------------ macros */

  showMacros() {
    const render = () => {
      const list = this.macro.list;
      const body = [
        el('p', { class: 'hint', text: 'A macro is a recorded run of commands. Press record, do the thing once, press stop. Replaying it is a single undo step. Only commands from the registry are captured, so a drag in the viewport is not recorded.' }),
      ];

      if (this.macro.isRecording) {
        body.push(el('div', { class: 'banner warn', text: `Recording “${this.macro.recording.name}” · ${this.macro.recording.steps.length} step${this.macro.recording.steps.length === 1 ? '' : 's'} so far.` }));
      }

      if (!list.length) {
        body.push(emptyState('No macros yet', 'Record one from Studio → Record macro, or press the record button below.', 'record'));
      } else {
        for (const m of list) {
          body.push(el('div', { class: 'dx-item info' }, [
            el('div', { class: 'dx-head' }, [
              el('span', { class: 'dx-title', text: m.name }),
              el('span', { class: 'pill', text: `${m.steps.length} steps` }),
            ]),
            el('div', { class: 'dx-detail', text: m.steps.map(x => this.commandMap.get(x.id)?.label || x.id).join(' → ') }),
            m.needsSelection ? el('div', { class: 'dx-why', text: 'Some of its commands act on the selection, so select something before you run it.' }) : null,
            el('div', { class: 'btn-row' }, [
              el('button', {
                class: 'btn sm primary', text: 'Run',
                onclick: () => {
                  const out = this.macro.run(m);
                  this.flash(out.ok
                    ? `Ran ${out.ran} of ${out.total} steps${out.failed.length ? `, ${out.failed.length} skipped` : ''}. Ctrl Z undoes all of it.`
                    : `Nothing ran: ${out.reason || out.failed[0]?.why || 'no applicable commands'}`,
                  out.ok ? 'ok' : 'warn', 5000);
                },
              }),
              el('button', {
                class: 'btn sm', text: 'Rename',
                onclick: () => promptDialog('Rename macro', 'Name', m.name, (v) => {
                  if (v) { this.macro.rename(m.id, v); closeModal(); this.showMacros(); }
                }),
              }),
              el('button', {
                class: 'btn sm danger', text: 'Delete',
                onclick: () => { this.macro.remove(m.id); closeModal(); this.showMacros(); },
              }),
            ]),
          ].filter(Boolean)));
        }
      }

      modal({
        title: 'Macros', icon: 'record', wide: true,
        subtitle: `${list.length} recorded`,
        body,
        actions: [
          this.macro.isRecording
            ? { label: 'Stop recording', primary: true, run: () => this.stopMacro() }
            : { label: 'Record a new macro', primary: true, run: () => this.startMacro() },
          { label: 'Close' },
        ],
      });
    };
    render();
  }

  startMacro() {
    promptDialog('Record a macro', 'Name it', 'My workflow', (name) => {
      this.macro.start(name || 'Macro');
      this.flash('Recording. Every command you run is captured until you stop.', 'info', 5000);
      this.refreshUI();
    }, { help: 'Do the workflow once, then stop. Replay is one undo step.' });
  }

  stopMacro() {
    const m = this.macro.stop();
    if (!m) { this.flash('Nothing replayable was recorded.', 'warn'); this.refreshUI(); return; }
    this.flash(`Saved “${m.name}” with ${m.steps.length} steps.`, 'ok', 4500);
    this.refreshUI();
  }

  /* ------------------------------------------------- studio standards */

  showStudio() {
    const s = Studio.standards();
    const set = (k) => (v) => { Studio.setStandard(k, v); this.runDoctor(); this.refreshUI(); };

    const body = [
      el('p', { class: 'hint', text: 'Settings the software should only need to be told once. They seed every new document and are what the Design Doctor measures against. Everything here stays in this browser.' }),

      section('House defaults', [
        field('Units', select(s.units, Object.keys(UNITS).map(u => [u, u]), set('units'))),
        field('Material', select(s.material, Object.entries(MATERIALS).map(([k, m]) => [k, m.name]), set('material'))),
        field('Process', select(s.process, Object.entries(PROCESSES).map(([k, p]) => [k, p.label]), set('process'))),
        field('Batch size', select(String(s.batch), QUANTITIES.map(q => [String(q), String(q)]), (v) => set('batch')(Number(v)))),
        (() => {
          const i = el('input', { type: 'text', value: s.author || '', placeholder: 'Name on every new document' });
          i.addEventListener('change', () => Studio.setStandard('author', i.value));
          return field('Author', i);
        })(),
      ], true, { icon: 'workspace' }),

      section('Manufacturing limits', [
        el('div', { class: 'hint', text: `Leave blank to use the process defaults. ${processOf(s.process).label}: ${processOf(s.process).minWall}mm wall, ${processOf(s.process).minFeature}mm feature, ±${processOf(s.process).tolerance}mm.` }),
        ...[['minWall', 'Minimum wall'], ['minFeature', 'Minimum feature'], ['tolerance', 'Tolerance ±']].map(([k, label]) => {
          const i = el('input', { type: 'number', step: '0.1', value: s[k] ?? '', placeholder: 'process default' });
          i.addEventListener('change', () => Studio.setStandard(k, i.value === '' ? null : Number(i.value)));
          return field(label, i);
        }),
      ], false, { icon: 'ruler' }),

      section('Behaviour', [
        checkbox('Check the model continuously', s.autoDoctor, (v) => { Studio.setStandard('autoDoctor', v); this.runDoctor(); this.refreshUI(); }),
        checkbox('Seed new documents from these standards', s.seedNewDocuments, set('seedNewDocuments')),
      ], false, { icon: 'settings' }),

      section('Decision log', [
        el('div', { class: 'hint', text: 'What was chosen and why. Written whenever you accept a repair or build from a brief, and kept across projects, because the reasoning behind a design outlives the file that carries it.' }),
        ...(() => {
          const d = Studio.decisions();
          if (!d.length) return [el('div', { class: 'hint', text: 'Nothing recorded yet.' })];
          return d.slice(0, 20).map(x => el('div', { class: 'dx-item info' }, [
            el('div', { class: 'dx-head' }, [
              el('span', { class: 'dx-title', text: x.title }),
              el('span', { class: 'pill', text: new Date(x.at).toISOString().slice(0, 10) }),
            ]),
            x.choice ? el('div', { class: 'dx-detail', text: x.choice }) : null,
            x.why ? el('div', { class: 'dx-why', text: x.why }) : null,
            x.doc ? el('div', { class: 'hint', text: x.doc }) : null,
          ].filter(Boolean)));
        })(),
      ], false, { icon: 'history', badge: Studio.decisions().length }),

      section('Portability', [
        el('div', { class: 'hint', text: 'Standards, decisions and macros as one file, to move between machines or hand to a colleague.' }),
        el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn sm', text: 'Export studio', onclick: () => IO.download('tessercad-studio.json', Studio.exportStudio(), 'application/json') }),
          el('button', {
            class: 'btn sm', text: 'Import studio…',
            onclick: async () => {
              const file = await this.pickFileAsync('.json');
              if (!file) return;
              try { Studio.importStudio(await file.text()); closeModal(); this.showStudio(); this.flash('Studio imported.', 'ok'); }
              catch (e) { this.flash(e.message, 'err', 6000); }
            },
          }),
          el('button', {
            class: 'btn sm danger', text: 'Reset standards',
            onclick: () => confirmDialog('Reset standards', 'Put every house default back to the factory setting. Decisions and macros are kept.', () => {
              Studio.resetStandards(); closeModal(); this.showStudio();
            }, { danger: true, yes: 'Reset' }),
          }),
        ]),
      ], false, { icon: 'file-export' }),
    ];

    modal({ title: 'Studio standards', icon: 'workspace', wide: true, body, actions: [{ label: 'Done', primary: true }] });
  }

  showLessons() {
    const list = allLessons();
    const p = whyProgress();
    modal({
      title: 'Engineering notes', icon: 'book', wide: true,
      subtitle: `${p.read} of ${p.total} read`,
      body: [
        el('p', { class: 'hint', text: 'These surface one at a time in the viewport, at the point where the model is actually doing the thing they describe. Here they all are at once.' }),
        ...list.map(l => section(l.title, [el('p', { text: l.body })], false, { icon: l.read ? 'check' : 'bulb' })),
      ],
      actions: [
        { label: 'Show them all again', run: () => { resetWhy(); this._whyId = null; this.renderLearn(); } },
        { label: 'Close', primary: true },
      ],
    });
  }

  /* ============================================== section and clash analysis */

  /** Every visible body with the geometry the analysers need. */
  analysisBodies() {
    const out = [];
    if (!this.build) return out;
    for (const f of this.build.topLevel) {
      const r = this.build.results.get(f.id);
      if (!r || r.error || !r.instances.length) continue;
      r.instances.forEach((inst, i) => {
        const mp = massProperties(inst.geometry, inst.matrix);
        out.push({ feature: f, index: i, geometry: inst.geometry, matrix: inst.matrix, ...mp });
      });
    }
    return out;
  }

  showSection() {
    const id = [...this.selection][0];
    const body = this.analysisBodies().find(b => b.feature.id === id);
    if (!body) { this.flash('Select a body first.', 'warn'); return; }

    const planes = standardPlanes(body.box);
    let which = 'yz';
    let load = { case: 'cantilever', force: 500, span: Math.max(10, Math.round(body.size.length())), safety: 2 };

    const host = el('div');
    const draw = () => {
      clear(host);
      // Named `sec`, not `section`: the panel helper of that name is imported
      // into this module, and shadowing it here breaks every section below.
      const sec = sectionAt(body, planes[which].plane);
      if (!sec) {
        host.appendChild(el('div', { class: 'banner warn', text: 'That plane does not cut this body.' }));
        return;
      }
      const r = checkSection(sec, { ...load, material: body.feature.material });

      host.append(
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Cut at' }),
          segmented(which, Object.entries(planes).map(([k, v]) => [k, v.label]), (v) => { which = v; draw(); }),
        ]),
        section2D(sec),
        section('Geometry', [kv([
          ['Area', `${fmt(sec.area)} mm²`],
          ['Loops', `${sec.loops}${sec.holes ? ` (${sec.holes} internal)` : ''}`],
          ['Iₓₓ', `${fmt(sec.ixx, 0)} mm⁴`],
          ['I_yy', `${fmt(sec.iyy, 0)} mm⁴`],
          ['I₁ strong axis', `${fmt(sec.i1, 0)} mm⁴`],
          ['I₂ weak axis', `${fmt(sec.i2, 0)} mm⁴`],
          ['Principal axis', `${fmt(sec.principalAngleDeg, 2)}°`],
          ['S₁ section modulus', `${fmt(sec.s1, 0)} mm³`],
          ['r₁ radius of gyration', `${fmt(sec.r1, 2)} mm`],
        ])], true, { icon: 'ruler' }),
        section('Load', [
          field('Case', select(load.case, Object.entries(LOAD_CASES).map(([k, v]) => [k, v.label]), (v) => { load.case = v; draw(); })),
          el('div', { class: 'hint', text: LOAD_CASES[load.case].note }),
          numRow('Force (N)', load.force, (v) => { load.force = v; draw(); }),
          numRow('Span (mm)', load.span, (v) => { load.span = v; draw(); }),
          numRow('Safety factor', load.safety, (v) => { load.safety = Math.max(1, v); draw(); }),
        ], true, { icon: 'physics' }),
        el('div', { class: `banner ${r.pass ? 'ok' : 'err'}`, text:
          `${fmt(r.total, 2)} N/mm² against ${fmt(r.allow, 1)} allowable — ${r.verdict}. ` +
          `${MATERIALS[body.feature.material]?.name || body.feature.material} at ${r.yieldMPa} MPa yield, safety factor ${r.safety}.` }),
        el('div', { class: 'banner warn', text: 'Exact section properties, and a first-order stress from them. This is the calculation an engineer does on paper before deciding whether a part is worth analysing properly. It knows nothing about stress concentrations, how the load is introduced, fatigue, or anything three-dimensional. It is not finite element analysis.' }),
      );
      // append() stringifies null into the document, so a conditional row is
      // added rather than passed in as one.
      if (r.bucklingN) {
        host.appendChild(el('div', { class: 'hint', text: `Euler buckling load for this length: ${fmt(r.bucklingN, 0)} N.` }));
      }
    };
    draw();

    modal({
      title: 'Section properties', icon: 'section', wide: true,
      subtitle: `${body.feature.name} · ${MATERIALS[body.feature.material]?.name || body.feature.material}`,
      body: host,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  showClashes() {
    const bodies = this.analysisBodies();
    if (bodies.length < 2) { this.flash('Clash checking needs at least two bodies.', 'warn'); return; }
    const { clashes, tested, pairs, skipped, unchecked, ms } = findClashes(bodies, { budgetMs: 6000, maxPairs: 400 });

    const body = [
      el('p', { class: 'hint', text: `${pairs} pairs share a bounding box; ${tested} were intersected exactly in ${Math.round(ms)} ms. This is a measured shared volume, not a bounding-box guess.` }),
    ];

    if (!clashes.length) {
      body.push(el('div', { class: 'banner ok', text: 'No two bodies occupy the same space.' }));
      // Without a clash, the useful number is how close the nearest pair comes.
      const near = nearestPair(bodies);
      if (near) {
        body.push(el('div', { class: 'hint', text: `Closest approach: ${near.a} and ${near.b}, about ${fmt(near.distance, 2)} mm apart. Sampled from the meshes, so the true gap may be slightly smaller.` }));
      }
    } else {
      for (const c of clashes) {
        body.push(el('div', { class: `dx-item ${c.exact ? (c.fraction > 0.02 ? 'err' : 'warn') : 'info'}` }, [
          el('div', { class: 'dx-head' }, [
            el('span', { class: `dx-sev ${c.exact ? 'err' : 'info'}`, text: c.exact ? `${fmt(c.volume)} mm³` : 'not checked' }),
            el('span', { class: 'dx-title', text: `${c.a.feature.name} ↔ ${c.b.feature.name}` }),
          ]),
          el('div', { class: 'dx-detail', text: c.exact
            ? `Centred at ${fmt(c.at.x)}, ${fmt(c.at.y)}, ${fmt(c.at.z)}${c.fraction ? ` · ${(c.fraction * 100).toFixed(1)}% of the smaller body` : ''}`
            : 'Too many triangles to intersect within the boolean budget.' }),
          el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn sm', text: 'Show me', onclick: () => { this.select([c.a.feature.id, c.b.feature.id]); this.vp.frameSelection(); } }),
            c.exact ? el('button', {
              class: 'btn sm primary', text: 'Union them',
              onclick: () => {
                store.edit('Union clashing bodies', (d) => {
                  d.features.push(makeFeature('boolean', { name: 'Union', params: { op: 'union' }, inputs: [c.a.feature.id, c.b.feature.id] }));
                });
                closeModal();
              },
            }) : null,
          ].filter(Boolean)),
        ]));
      }
    }
    if (skipped) body.push(el('div', { class: 'hint', text: `${skipped} pairs were skipped for size. Coarser segment counts would bring them inside the triangle budget.` }));
    if (unchecked) body.push(el('div', { class: 'banner warn', text: `${unchecked} pairs ran out of time and were not checked. Reduce the model or check those bodies in isolation.` }));

    modal({
      title: 'Clash check', icon: 'target', wide: true,
      subtitle: `${bodies.length} bodies · ${clashes.filter(c => c.exact).length} real clashes`,
      body,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  /* ------------------------------------------------- imported mesh inspection */

  showInspect() {
    const meshes = store.doc.features.filter(f => f.type === 'mesh' && !f.suppressed);
    if (!meshes.length) { this.flash('No imported mesh in this document.', 'warn'); return; }
    const f = meshes.find(m => this.selection.has(m.id)) || meshes[0];
    const r = this.build.results.get(f.id);
    if (!r || !r.instances.length) { this.flash(`${f.name} has no geometry.`, 'warn'); return; }

    const inst = r.instances[0];
    const found = recognise(inst.geometry, inst.matrix);

    const body = [
      el('p', { class: 'hint', text: 'An imported mesh has no feature tree. This measures what is actually there: the flat faces, and the holes with their axis, position and diameter. Nothing is reconstructed and nothing is guessed.' }),
    ];

    if (found.truncated) {
      body.push(el('div', { class: 'banner warn', text: found.reason }));
    } else {
      body.push(el('div', { class: 'banner info', text:
        `${found.triangles.toLocaleString()} triangles · ${found.patches} surface patches · ${found.faces.length} flat faces · ${found.holes.length} holes · ${found.bosses.length} bosses` }));

      if (found.holes.length) {
        body.push(section(`Holes (${found.holes.length})`, [
          el('table', { class: 'mass-table' }, [
            el('thead', {}, [el('tr', {}, ['Ø mm', 'Centre', 'Axis', 'Depth', 'Round', 'Standard', ''].map(h => el('th', { text: h })))]),
            el('tbody', {}, found.holes.map(h => el('tr', {}, [
              el('td', { class: 'mono', text: h.diameter.toFixed(3) }),
              el('td', { class: 'mono', text: `${h.centre.x.toFixed(1)}, ${h.centre.y.toFixed(1)}, ${h.centre.z.toFixed(1)}` }),
              el('td', { class: 'mono', text: h.axisName || `${h.axis.x.toFixed(2)},${h.axis.y.toFixed(2)},${h.axis.z.toFixed(2)}` }),
              el('td', { class: 'mono', text: h.length.toFixed(1) }),
              el('td', { class: 'mono', text: `${(h.roundness * 100).toFixed(1)}%` }),
              el('td', { text: h.nominal?.label || '–' }),
              el('td', {}, [el('button', {
                class: 'btn sm', text: 'Make a cut',
                onclick: () => { this.addCutterFor(h, f); closeModal(); },
              })]),
            ]))),
          ]),
          el('div', { class: 'hint', text: 'Roundness is how tightly the surface clusters on its fitted radius. A drilled hole is over 99%; anything lower is a rounded pocket that is nearly circular, and the number is shown so you can tell the difference.' }),
        ], true, { icon: 'circle' }));
      }

      if (found.faces.length) {
        body.push(section(`Flat faces (${found.faces.length})`, [
          el('table', { class: 'mass-table' }, [
            el('thead', {}, [el('tr', {}, ['Area mm²', 'Normal', 'Centre', 'Triangles'].map(h => el('th', { text: h })))]),
            el('tbody', {}, found.faces.slice(0, 20).map(x => el('tr', {}, [
              el('td', { class: 'mono', text: x.area.toFixed(1) }),
              el('td', { class: 'mono', text: x.axis || `${x.normal.x.toFixed(2)},${x.normal.y.toFixed(2)},${x.normal.z.toFixed(2)}` }),
              el('td', { class: 'mono', text: `${x.centre.x.toFixed(1)}, ${x.centre.y.toFixed(1)}, ${x.centre.z.toFixed(1)}` }),
              el('td', { class: 'mono', text: String(x.triangles) }),
            ]))),
          ]),
          found.faces.length > 20 ? el('div', { class: 'hint', text: `${found.faces.length - 20} smaller faces not listed.` }) : null,
        ].filter(Boolean), false, { icon: 'plate' }));
      }

      const size = new THREE.Vector3(); inst.geometry.computeBoundingBox(); inst.geometry.boundingBox.getSize(size);
      const u = unitSanity(size);
      if (u.suspect) {
        body.push(el('div', { class: 'banner warn', text:
          `Largest dimension is ${fmt(u.largestMm)} mm as read. ${u.suggestion ? `If the file was authored in ${u.suggestion.unit}, it would be ${fmt(u.suggestion.largest)} mm.` : 'That is outside the range real parts occupy.'} Nothing in a mesh file states its units, so this is for you to decide.` }));
      }
    }

    modal({
      title: 'Inspect imported mesh', icon: 'probe', wide: true,
      subtitle: f.name,
      body,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  /** Place a parametric cut on a measured hole, and subtract it from the mesh. */
  addCutterFor(hole, meshFeature) {
    const spec = cutterFor(hole);
    store.edit(`Cut ${spec.name}`, (d) => {
      const cut = makeFeature(spec.type, {
        name: spec.name, params: spec.params, pos: spec.pos, rot: spec.rot,
        material: meshFeature.material,
      });
      d.features.push(cut);
      d.features.push(makeFeature('boolean', {
        name: `${meshFeature.name} cut`, params: { op: 'subtract' },
        inputs: [meshFeature.id, cut.id], material: meshFeature.material,
      }));
    });
    Studio.logDecision({
      title: `Parametric cut on a measured hole`,
      choice: `Ø${hole.diameter.toFixed(2)} at ${hole.centre.x.toFixed(1)}, ${hole.centre.y.toFixed(1)}, ${hole.centre.z.toFixed(1)}`,
      why: 'The imported mesh stays opaque, but the hole now has a feature that can be moved, resized and driven by a parameter.',
      doc: store.doc.meta.name,
    });
    this.flash(`${spec.name} added as a parametric cut. It can be moved and resized like any feature.`, 'ok', 5200);
  }

  /* ========================================================= configurations */

  showConfigs() {
    const render = () => {
      const table = Cfg.familyTable(store.doc);
      const body = [
        el('p', { class: 'hint', text: 'A configuration is a named set of parameter values inside this document. The geometry, the feature tree and the relationships are shared by every variant, so a change to the design reaches all of them. Only the numbers that differ are stored.' }),
      ];

      body.push(el('table', { class: 'mass-table' }, [
        el('thead', {}, [el('tr', {}, ['Configuration', ...table.columns, ''].map(h => el('th', { text: h })))]),
        el('tbody', {}, table.rows.map(r => el('tr', { class: r.active ? 'on' : '' }, [
          el('td', {}, [
            el('b', { text: r.name }),
            r.active ? el('span', { class: 'pill', text: 'active' }) : null,
          ].filter(Boolean)),
          ...table.columns.map(k => el('td', { class: 'mono', text: String(r.values[k] ?? '') })),
          el('td', {}, [el('div', { class: 'btn-row' }, [
            r.active ? null : el('button', {
              class: 'btn sm', text: 'Use',
              onclick: () => { this.activateConfiguration(r.id); closeModal(); this.showConfigs(); },
            }),
            el('button', {
              class: 'btn sm', text: 'Rename',
              onclick: () => promptDialog('Rename configuration', 'Name', r.name, (v) => {
                if (!v) return;
                store.edit('Rename configuration', (d) => Cfg.renameConfig(d, r.id, v), { rebuild: false });
                closeModal(); this.showConfigs();
              }),
            }),
            r.id === Cfg.DEFAULT_ID ? null : el('button', {
              class: 'btn sm danger', text: 'Delete',
              onclick: () => {
                store.edit('Delete configuration', (d) => Cfg.removeConfig(d, r.id));
                closeModal(); this.showConfigs();
              },
            }),
          ].filter(Boolean))]),
        ]))),
      ]));

      if (!table.columns.length) {
        body.push(el('div', { class: 'hint', text: 'No variant overrides anything yet. Add a configuration, switch to it, and change a parameter: the change is recorded against that variant and nothing else.' }));
      }

      modal({
        title: 'Configurations', icon: 'template', wide: true,
        subtitle: `${table.rows.length} in ${store.doc.meta.name}`,
        body,
        actions: [
          { label: 'Add a configuration', run: () => this.newConfiguration() },
          { label: 'Export the family', run: () => this.exportFamily() },
          { label: 'Close', primary: true },
        ],
      });
    };
    render();
  }

  newConfiguration() {
    promptDialog('New configuration', 'Name', 'Long', (v) => {
      if (!v) return;
      let id = null;
      store.edit('Add configuration', (d) => {
        Cfg.syncBaseline(d);
        id = Cfg.addConfig(d, v);
      }, { rebuild: false });
      if (id) this.activateConfiguration(id);
      this.flash(`“${v}” is now active. Change a parameter and it is recorded against this variant only.`, 'ok', 5200);
    }, { help: 'Variants share one feature tree. Only the parameters you change are stored against them.' });
  }

  activateConfiguration(id) {
    store.edit('Switch configuration', (d) => {
      Cfg.syncBaseline(d);
      Cfg.activate(d, id);
    });
    this.refreshUI();
  }

  cycleConfiguration(dir = 1) {
    const list = Cfg.configs(store.doc);
    if (list.length < 2) return;
    const i = list.findIndex(c => c.id === store.doc.configs.active);
    const next = list[(i + dir + list.length) % list.length];
    this.activateConfiguration(next.id);
    this.flash(`Configuration: ${next.name}`, 'info', 2200);
  }

  exportFamily() {
    IO.download(`${store.doc.meta.name}-family.csv`, Cfg.familyCSV(store.doc), 'text/csv');
  }

  /* ============================================================== versions */

  commitVersion() {
    promptDialog('Save a version', 'What changed?', '', (msg) => {
      const r = VCS.commitVersion(msg || 'Snapshot');
      if (!r.ok) {
        this.flash(`Could not save: local storage is full. ${r.pruned} old versions were dropped and it still did not fit.`, 'err', 7000);
        return;
      }
      this.flash(`Version saved on ${VCS.currentBranch()}${r.pruned ? `, ${r.pruned} oldest dropped for space` : ''}.`, 'ok', 4200);
      this.refreshUI();
    }, { help: 'A version is a full snapshot kept in this browser. Nothing is uploaded.' });
  }

  newBranch() {
    promptDialog('New branch', 'Name', 'experiment', (v) => {
      if (!v) return;
      const name = VCS.createBranch(v);
      this.flash(`On branch “${name}”. Versions you save now stay here; the trunk is untouched.`, 'ok', 5000);
      this.refreshUI();
    }, { help: 'A branch is somewhere to try an alternative without risking what already works.' });
  }

  showVersions() {
    const render = () => {
      const list = VCS.versions();
      const use = VCS.usage();
      const body = [
        el('p', { class: 'hint', text: 'Versions and branches, kept in this browser. No account, no server, no check-in. A document is plain JSON at every instant, which is what makes a real diff possible.' }),
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Branch' }),
          select(VCS.currentBranch(), VCS.branches().map(b => [b.name, `${b.name} (${b.count})`]), (v) => {
            VCS.switchBranch(v); closeModal(); this.showVersions();
          }),
        ]),
      ];

      if (!list.length) {
        body.push(emptyState('No versions on this branch', 'Save one from Analyse → Save a version, or press Ctrl ⇧ S.', 'history'));
      } else {
        for (let i = 0; i < list.length; i++) {
          const v = list[i];
          const older = list[i + 1];
          const full = VCS.getVersion(v.id);
          const against = older ? VCS.getVersion(older.id) : null;
          const d = against ? VCS.diff(against.doc, full.doc) : null;

          body.push(el('div', { class: 'dx-item info' }, [
            el('div', { class: 'dx-head' }, [
              el('span', { class: 'dx-title', text: v.message }),
              el('span', { class: 'pill', text: new Date(v.at).toLocaleString() }),
            ]),
            el('div', { class: 'dx-detail', text: `${v.summary.features} features · ${v.summary.params} parameters${v.summary.configs > 1 ? ` · ${v.summary.configs} configurations` : ''}` }),
            d ? el('div', { class: 'dx-why', text: `Against the version below: ${VCS.diffLine(d)}` }) : null,
            el('div', { class: 'btn-row' }, [
              el('button', {
                class: 'btn sm', text: 'Compare with now',
                onclick: () => { closeModal(); this.showDiff(full); },
              }),
              el('button', {
                class: 'btn sm primary', text: 'Restore',
                onclick: () => confirmDialog('Restore this version?',
                  `The document goes back to "${v.message}". Save a version of where you are first if you want to come back.`,
                  () => { VCS.restore(v.id); this.flash('Restored.', 'ok'); setTimeout(() => this.vp.frameAll(), 150); },
                  { yes: 'Restore' }),
              }),
              el('button', {
                class: 'btn sm danger', text: 'Delete',
                onclick: () => { VCS.deleteVersion(v.id); closeModal(); this.showVersions(); },
              }),
            ]),
          ].filter(Boolean)));
        }
      }

      body.push(el('div', { class: 'hint', text: `${use.versions} versions across ${use.branches} branches, using ${(use.bytes / 1e6).toFixed(2)} MB of about ${(use.limit / 1e6).toFixed(1)} MB. Oldest versions are dropped automatically when the space runs out.` }));

      modal({
        title: 'Version history', icon: 'sequence', wide: true,
        subtitle: `${VCS.currentBranch()} · ${list.length} versions`,
        body,
        actions: [
          { label: 'Save a version', run: () => setTimeout(() => this.commitVersion(), 60) },
          { label: 'New branch', run: () => setTimeout(() => this.newBranch(), 60) },
          { label: 'Close', primary: true },
        ],
      });
    };
    render();
  }

  /** The structural difference between a saved version and the live document. */
  showDiff(version) {
    const d = VCS.diff(version.doc, store.doc);
    const body = [
      el('p', { class: 'hint', text: `Comparing “${version.message}” (${new Date(version.at).toLocaleString()}) with the document as it is now.` }),
    ];

    if (d.empty) {
      body.push(el('div', { class: 'banner ok', text: 'Identical. Nothing has changed since that version.' }));
    } else {
      if (d.meta.length) {
        body.push(section('Document', d.meta.map(m =>
          el('div', { class: 'diff-row' }, [
            el('span', { class: 'diff-key', text: m.what }),
            el('span', { class: 'diff-from', text: String(m.from || '—') }),
            el('span', { class: 'diff-arrow', text: '→' }),
            el('span', { class: 'diff-to', text: String(m.to || '—') }),
          ])), true, { icon: 'doc-props' }));
      }
      if (d.params.length) {
        body.push(section(`Parameters (${d.params.length})`, d.params.map(p =>
          el('div', { class: `diff-row ${p.kind}` }, [
            el('span', { class: 'diff-key', text: p.name }),
            el('span', { class: 'diff-from', text: p.kind === 'added' ? '—' : String(p.from) }),
            el('span', { class: 'diff-arrow', text: p.kind === 'removed' ? '✕' : '→' }),
            el('span', { class: 'diff-to', text: p.kind === 'removed' ? '—' : String(p.to) }),
          ])), true, { icon: 'book' }));
      }
      if (d.features.length) {
        body.push(section(`Features (${d.features.length})`, d.features.map(f =>
          el('div', { class: `diff-feature ${f.kind}` }, [
            el('div', { class: 'diff-head' }, [
              el('span', { class: `diff-badge ${f.kind}`, text: f.kind }),
              el('span', { class: 'diff-name', text: f.name }),
              el('span', { class: 'diff-type', text: f.type }),
            ]),
            ...f.changes.map(c => el('div', { class: 'diff-row changed' }, [
              el('span', { class: 'diff-key', text: c.what }),
              el('span', { class: 'diff-from', text: String(c.from ?? '—') }),
              el('span', { class: 'diff-arrow', text: '→' }),
              el('span', { class: 'diff-to', text: String(c.to ?? '—') }),
            ])),
          ])), true, { icon: 'workspace' }));
      }
    }

    modal({
      title: 'What changed', icon: 'history', wide: true,
      subtitle: VCS.diffLine(d),
      body,
      actions: [
        { label: 'Back to history', run: () => setTimeout(() => this.showVersions(), 60) },
        { label: 'Close', primary: true },
      ],
    });
  }

  /* ======================================================== export quality */

  showExportQuality() {
    const s = Studio.standards();
    let quality = s.exportQuality || 'standard';
    const host = el('div');

    const draw = () => {
      clear(host);
      const q = QUALITY[quality];
      const preview = q.tol ? retessellate(store.doc, q.tol) : null;

      host.append(
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Quality' }),
          select(quality, Object.entries(QUALITY).map(([k, v]) => [k, v.label]), (v) => { quality = v; draw(); }),
        ]),
        el('div', { class: 'hint', text: q.note }),
        q.tol
          ? el('div', { class: 'banner info', text: `Chord tolerance ${q.tol} mm: no point on the exported mesh is further than that from the surface it represents. Segment counts follow from it, per feature, so a 3mm hole and a 200mm flange each get exactly what they need.` })
          : el('div', { class: 'banner info', text: 'Export uses whatever segment counts the features already carry.' }),
      );

      if (preview) {
        const grew = preview.changes.filter(c => c.to > c.from).length;
        const cut = preview.changes.filter(c => c.to < c.from).length;
        host.append(
          el('div', { class: 'big-stat' }, [
            el('span', { class: 'bs-value', text: String(preview.after) }),
            el('span', { class: 'bs-unit', text: `segments in total, from ${preview.before}` }),
          ]),
          el('div', { class: 'hint', text: `${grew} features refined, ${cut} coarsened, ${store.doc.features.length - preview.changes.length} unchanged.` }),
        );
        if (preview.changes.length) {
          host.appendChild(section('Per feature', [
            el('table', { class: 'mass-table' }, [
              el('thead', {}, [el('tr', {}, ['Feature', 'Radius', 'Segments', ''].map(h => el('th', { text: h })))]),
              el('tbody', {}, preview.changes.slice(0, 24).map(c => el('tr', {}, [
                el('td', { text: c.name }),
                el('td', { class: 'mono', text: `${c.radius.toFixed(1)} mm` }),
                el('td', { class: 'mono', text: `${c.from} → ${c.to}` }),
                el('td', { text: c.to > c.from ? 'refined' : 'coarsened' }),
              ]))),
            ]),
          ], false, { icon: 'mesh' }));
        }
      }

      host.appendChild(el('div', { class: 'hint', text: 'This applies to export only. The document you are editing keeps its own segment counts, so a tolerance chosen for one handoff never becomes the model\'s.' }));
    };
    draw();

    modal({
      title: 'Export quality', icon: 'settings', wide: true,
      subtitle: 'Spend triangles where the surface actually curves',
      body: host,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Use this quality', primary: true,
          run: () => {
            Studio.setStandard('exportQuality', quality);
            this.flash(`Exports now use ${QUALITY[quality].label}.`, 'ok');
          },
        },
      ],
    });
  }

  showShortcuts() {
    const groups = {};
    for (const c of this.commands) {
      if (!c.key) continue;
      (groups[c.group] ||= []).push(c);
    }
    modal({
      title: 'Keyboard shortcuts', icon: 'keyboard', wide: true,
      subtitle: 'Everything else is one Ctrl K away.',
      body: [
        ...Object.entries(groups).flatMap(([g, list]) => [
          el('h3', { text: g }),
          el('div', { class: 'kbd-grid' }, list.map(c => el('div', {}, [el('span', { text: c.label }), el('kbd', { text: c.key })]))),
        ]),
        el('h3', { text: 'Modal transform (Model / Simulate)' }),
        el('p', { html: 'Press <kbd>G</kbd>, <kbd>R</kbd> or <kbd>S</kbd> and the selection follows the pointer. Then: <kbd>X</kbd>/<kbd>Y</kbd>/<kbd>Z</kbd> locks an axis, <kbd>⇧X</kbd> locks the perpendicular plane, typing a number sets an exact value, <kbd>⇧</kbd> is precision, <kbd>Ctrl</kbd> snaps, <kbd>⏎</kbd> confirms and <kbd>esc</kbd> cancels.' }),
        el('h3', { text: 'Mouse' }),
        el('p', { html: '<b>3D:</b> left-drag orbits · right-drag pans · wheel zooms · click selects · right-click opens the context menu · double-click frames.<br><b>Draft:</b> middle or right-drag pans · wheel zooms · drag right-to-left for a crossing window.' }),
        el('h3', { text: 'Typed coordinates (Draft)' }),
        el('p', { html: 'With a tool active, type <code>50,30</code> absolute · <code>@40,0</code> relative · <code>@60&lt;30</code> length and angle · <code>25</code> length along the cursor, then <kbd>⏎</kbd>.' }),
      ],
      actions: [{ label: 'Close', primary: true }],
    });
  }

  showExpressionHelp() {
    modal({
      title: 'Expression reference', icon: 'book',
      subtitle: 'Every numeric field accepts an expression, not just a number.',
      body: [
        el('p', { html: 'Define parameters in the <b>Parameters</b> section of the right panel, then reference them anywhere: <code>width * 2</code>, <code>thick + clearance</code>, <code>sqrt(area)</code>.' }),
        el('h3', { text: 'Operators' }),
        el('p', { html: '<code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>%</code> <code>^</code> and parentheses. <code>^</code> is right-associative, so <code>2^3^2</code> is 512.' }),
        el('h3', { text: 'Functions' }),
        el('p', { html: EXPR_HELP.map(f => `<code>${f}</code>`).join(' ') }),
        el('h3', { text: 'Constants' }),
        el('p', { html: '<code>pi</code> <code>tau</code> <code>e</code> <code>phi</code>' }),
        el('h3', { text: 'Angles' }),
        el('p', { html: 'Trigonometric functions work in radians: write <code>cos(rad(30))</code>, and <code>deg(x)</code> to go back.' }),
        el('h3', { text: 'Safety' }),
        el('p', { text: 'Expressions are parsed by a hand-written tokeniser and recursive-descent parser that can only ever produce a number — no eval, so opening someone else’s project file can never run code.' }),
      ],
      actions: [{ label: 'Close', primary: true }],
    });
  }

  showWelcome() {
    modal({
      title: `Welcome to ${APP_NAME}`, icon: 'bulb', wide: true,
      subtitle: 'A parametric CAD studio that runs entirely in your browser. Nothing is uploaded.',
      body: [
        el('div', { class: 'card-grid' }, [
          ['cube3d', 'Model', 'Parametric solids, booleans, patterns and mirrors in a rebuildable feature tree.'],
          ['sketch', 'Draft', '2D drafting with snaps, layers and dimensions. Any closed profile extrudes or revolves.'],
          ['timeline', 'Simulate', 'The fourth dimension: keyframes, build sequencing and rigid-body physics.'],
        ].map(([ic, t, b]) => el('div', { class: 'card', style: { cursor: 'default' } }, [
          icon(ic, { size: 22 }), el('b', { text: t }), el('span', { text: b }),
        ]))),
        el('h3', { text: 'Three things worth knowing' }),
        el('p', { html: '<b>Type expressions, not numbers.</b> Any field takes <code>width*2</code> and rebuilds when <code>width</code> changes.<br><b>Press G, R or S.</b> The selection follows the pointer; press X/Y/Z to lock an axis or type an exact value.<br><b>Press Ctrl K.</b> Every one of the 150+ commands is one search away.' }),
        el('h3', { text: 'Honest limits' }),
        el('p', { html: 'This is a mesh modeller, not a B-rep kernel: no true fillets on arbitrary edges and no STEP export. Dynamics use bounding-sphere collisions — right for drop tests and sequencing, not for stress analysis.' }),
      ],
      actions: [
        { label: 'Browse templates', run: () => setTimeout(() => this.showTemplates(), 60) },
        { label: 'Shortcuts', run: () => setTimeout(() => this.showShortcuts(), 60) },
        { label: 'Start modelling', primary: true },
      ],
    });
  }

  showAbout() {
    modal({
      title: `${APP_NAME} ${APP_VERSION}`, icon: 'info',
      body: [
        el('p', { html: 'A free, open-source, browser-based CAD studio: parametric 3D modelling, 2D drafting and 4D simulation. No install, no account, no server.' }),
        kv([
          ['Version', APP_VERSION],
          ['Commands', String(this.commands.length)],
          ['Renderer', 'three.js r169 (vendored)'],
          ['Project format', `${FILE_EXT} — plain JSON`],
          ['Licence', 'MIT'],
        ]),
        el('p', { class: 'hint', html: 'Built as a single static site. <a href="https://github.com/samuelhtampubolon/Portofolio_Tutorial" target="_blank" rel="noopener">Source on GitHub</a>.' }),
      ],
      actions: [{ label: 'Close', primary: true }],
    });
  }

  openLink(url) { window.open(url, '_blank', 'noopener'); }

  /* =========================================================== commands */

  run(id) {
    const c = this.commandMap.get(id);
    if (!c) { console.warn('unknown command', id); return; }
    if (c.enabled && !c.enabled()) { this.flash(`${c.label} is not available right now`, 'warn', 2000); return; }
    // Every surface routes through here, so recording one function records the
    // menus, the ribbon, the palette, the quick menu and the keyboard at once.
    this.macro?.capture(id);
    c.run();
  }

  exportDesignIntent() {
    if (!this.build) return;
    exportIntent(store.doc, this.build);
  }

  openPalette() {
    commandPalette(this.commands.map(c => ({
      ...c, label: c.checked?.() ? `${c.label}  ✓` : c.label,
    })), (c) => this.run(c.id), { context: WS_META[this.workspace].label });
  }

  openQuickMenu(x, y) {
    const ids = quickDefaults(this);
    quickMenu(x, y, ids.map(id => this.commandMap.get(id)).filter(Boolean), (c) => this.run(c.id));
  }

  showDraftMenu(e) {
    const d = this.draft;
    const hit = d.hitTest(d.toWorld(e.clientX - d.cv.getBoundingClientRect().left, e.clientY - d.cv.getBoundingClientRect().top));
    if (hit && !d.selection.has(hit.id)) { d.selection = new Set([hit.id]); d.invalidate(); this.refreshUI(); }
    const sel = d.selection.size;
    contextMenu(e.clientX, e.clientY, [
      { header: sel ? `${sel} object${sel === 1 ? '' : 's'} selected` : 'Drawing' },
      ...(sel ? [
        this.menuItem('sketch.extrude'), this.menuItem('sketch.revolve'), '-',
        this.menuItem('edit.duplicate'), this.menuItem('draft.rotate90'), this.menuItem('draft.mirrorX'),
        '-', this.menuItem('edit.delete'),
      ] : [
        this.menuItem('draft.line'), this.menuItem('draft.rect'), this.menuItem('draft.circle'),
        '-', this.menuItem('edit.selectAll'), this.menuItem('draft.zoomExtents'), this.menuItem('draft.snap'),
      ]),
    ].filter(Boolean));
  }

  showViewportMenu(e, hit) {
    const id = hit?.object?.userData?.featureId || null;
    if (id && !this.selection.has(id)) this.select([id]);
    contextMenu(e.clientX, e.clientY, viewportContextMenu(this, (cid) => this.menuItem(cid), id).filter(Boolean));
  }

  /* ============================================================ binding */

  bindGlobalUI() {
    const mobile = () => isPhone();

    const leftActions = clear($('#leftActions'));
    leftActions.appendChild(el('button', {
      class: 'mini-btn', title: 'Collapse the outline panel  (T)',
      onclick: () => (mobile() ? this.mobile.closeSheet() : this.togglePanel('left')),
    }, [icon('chevron-left', { size: 14 })]));

    const rightActions = clear($('#rightActions'));
    rightActions.appendChild(el('button', {
      class: 'mini-btn', title: 'Collapse the properties panel  (N)',
      onclick: () => (mobile() ? this.mobile.closeSheet() : this.togglePanel('right')),
    }, [icon('chevron-right', { size: 14 })]));

    // On a tablet only one panel is docked at a time, so each head carries the
    // switch that brings the other one forward. It is built on every tier and
    // shown by CSS on one, which keeps the breakpoint in a single place.
    for (const side of ['left', 'right']) {
      const head = $(`#${side}panel .panel-head`);
      const sw = el('div', { class: 'dock-switch', role: 'tablist', 'aria-label': 'Docked panel' });
      for (const [which, ic] of [['left', 'workspace'], ['right', 'settings']]) {
        sw.appendChild(el('button', {
          class: 'ds-btn', role: 'tab', dataset: { dock: which },
          onclick: () => this.setDock(which),
        }, [icon(ic, { size: 14 }), el('span', { class: 'ds-label' })]));
      }
      head.insertBefore(sw, head.querySelector('.ph-actions'));
    }

    this.vp.onHover = (hit) => {
      const u = store.doc.meta.units;
      $('#viewInfo').textContent = hit
        ? `${store.feature(hit.object.userData.featureId)?.name || ''}\n${fmt(toDisplay(hit.point.x, u))}, ${fmt(toDisplay(hit.point.y, u))}, ${fmt(toDisplay(hit.point.z, u))} ${u}`
        : '';
    };
  }

  bindFiles() {
    const input = $('#fileInput');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      // A pending pickFileAsync takes the file instead of the importer, so one
      // hidden input can serve both "open a model" and "read this settings file".
      if (this._pendingPick) { const r = this._pendingPick; this._pendingPick = null; r(file || null); return; }
      if (!file) return;
      try { await IO.importAny(file); this.vp.frameAll(); }
      catch (e) { this.flash(e.message, 'err', 6000); }
    });
    const stage = $('#stage');
    stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    stage.addEventListener('drop', async (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      try { await IO.importAny(file); this.vp.frameAll(); }
      catch (err) { this.flash(err.message, 'err', 6000); }
    });
  }

  pickFile(accept) {
    const input = $('#fileInput');
    input.accept = accept;
    input.click();
  }

  /** Pick a file and get it back, rather than handing it to the importer. */
  pickFileAsync(accept) {
    return new Promise((resolve) => {
      const input = $('#fileInput');
      this._pendingPick = resolve;
      input.accept = accept;
      input.click();
      // A cancelled picker fires no event in most browsers, so the promise would
      // hang for the life of the page. One window focus later, give up.
      const bail = () => {
        setTimeout(() => { if (this._pendingPick === resolve) { this._pendingPick = null; resolve(null); } }, 700);
        removeEventListener('focus', bail);
      };
      setTimeout(() => addEventListener('focus', bail, { once: true }), 0);
    });
  }

  bindKeys() {
    addEventListener('keyup', (e) => { if (this.ops.running) this.ops.onKeyUp(e); });

    addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      // a running operator owns the keyboard
      if (this.ops.running && !typing) { if (this.ops.onKey(e)) { e.preventDefault(); return; } }

      if (e.key === 'Escape') {
        if (isQuickMenuOpen()) { closeQuickMenu(); return; }
        if (isModalOpen()) { closeModal(); return; }
        closeDropdown();
        if (this.workspace === 'draft' && this.draft.cancel()) { this.buildRibbon(); this.refreshUI(); return; }
        if (this.vp.measureMode) { this.stopMeasuring(); return; }
        if (this.isolated) { this.isolated = null; this.applyIsolation(); this.refreshUI(); return; }
        this.select([]);
        return;
      }

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); this.openPalette(); return; }
      if (typing) return;

      if (mod) {
        const k = e.key.toLowerCase();
        const map = {
          z: () => (e.shiftKey ? (this.zenModeOrRedo(e)) : store.undo()),
          y: () => store.redo(),
          s: () => (e.shiftKey ? this.saveAs() : IO.saveProject()),
          o: () => this.pickFile('.tcad,.json'),
          n: () => this.newDocument(),
          i: () => (e.shiftKey ? this.invertSelection() : this.pickFile(IO.IMPORT_ACCEPT)),
          d: () => this.duplicateSelection(),
          a: () => this.selectAll(),
          h: () => (e.shiftKey ? this.showHistory() : null),
          l: () => (e.shiftKey ? this.toggleTheme() : null),
          ',': () => this.showPrefs(),
          '=': () => this.zoomBy(1.25),
          '+': () => this.addBoolean('union'),
          '-': () => this.addBoolean('subtract'),
        };
        if (map[k]) { e.preventDefault(); map[k](); }
        return;
      }

      if (e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'a') { e.preventDefault(); this.select([]); return; }
        if (k === 'h') { e.preventDefault(); this.setVisible(true, { all: true }); return; }
        return;
      }

      if (e.key === 'F1') { e.preventDefault(); this.showShortcuts(); return; }
      if (e.key === 'F2') { e.preventDefault(); this.renameSelected(); return; }
      if (e.key === 'F11') { e.preventDefault(); this.toggleFullscreen(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }

      if (this.workspace === 'draft') { this.draftKey(e); return; }

      const k = e.key.toLowerCase();
      const actions = {
        ' ': () => this.togglePlay(),
        g: () => this.startOperator('move'),
        r: () => this.startOperator('rotate'),
        s: () => this.startOperator('scale'),
        w: () => this.setGizmo('translate'),
        e: () => (e.shiftKey ? this.setGizmo('rotate') : null),
        f: () => (e.shiftKey ? this.vp.frameSelection() : this.zoomFit()),
        z: () => this.cycleShading(),
        h: () => this.setVisible(false),
        d: () => this.dropSelection(),
        k: () => this.keyPose(),
        m: () => this.vp.setMeasureMode('distance'),
        q: () => this.openQuickMenu(innerWidth / 2, innerHeight / 2),
        '/': () => this.isolate(),
        n: () => this.togglePanel('right'),
        t: () => this.togglePanel('left'),
        '0': () => this.vp.standardView('iso'),
        '1': () => this.vp.standardView(e.shiftKey ? 'back' : 'front'),
        '3': () => this.vp.standardView(e.shiftKey ? 'left' : 'right'),
        '5': () => this.run('view.ortho'),
        '7': () => this.vp.standardView(e.shiftKey ? 'bottom' : 'top'),
        ',': () => this.sim.step(-1),
        '.': () => this.sim.step(1),
        '+': () => this.zoomBy(1.25),
        '=': () => this.zoomBy(1.25),
        '-': () => this.zoomBy(0.8),
      };
      if (actions[k]) { e.preventDefault(); actions[k](); return; }
      if (e.key === 'Home') { this.sim.seek(0); return; }
      if (e.key === 'End') { this.sim.seek(store.doc.sim.duration); return; }
    });
  }


  /* ============================================================ drawings */

  /**
   * A shop drawing from the model.
   *
   * The reason this matters is that the drawing is still the contract. A
   * supplier quotes from a dimensioned print with a title block, not from an
   * STL, and a package that cannot produce one leaves its user to redraw their
   * own part in something else. So the views are projected, hidden lines are
   * classified rather than guessed at, and the title block is filled from the
   * document instead of left as boxes to type into.
   */
  showDrawing() {
    const bodies = this.analysisBodies();
    if (!bodies.length) { this.flash('There is nothing to draw yet.', 'warn'); return; }

    const opts = {
      sheet: this._sheetOpts?.sheet || 'a3l',
      views: this._sheetOpts?.views || ['front', 'top', 'right', 'iso'],
      hlr: this._sheetOpts?.hlr !== false,
      scale: this._sheetOpts?.scale || null,
      projection: this._sheetOpts?.projection || 'first',
    };
    const host = el('div');
    let sheet = null;

    const draw = () => {
      clear(host);
      this._sheetOpts = { ...opts };
      const t0 = performance.now();
      try {
        sheet = buildSheet(bodies, {
          doc: store.doc, build: this.build, sheet: opts.sheet,
          views: opts.views, hlr: opts.hlr, scale: opts.scale, projection: opts.projection,
        });
      } catch (err) {
        host.appendChild(el('div', { class: 'banner err', text: `The drawing could not be built: ${err.message}` }));
        return;
      }
      const ms = Math.round(performance.now() - t0);

      host.append(
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Paper' }),
          segmented(opts.sheet, Object.entries(SHEETS).map(([k, v]) => [k, v.label.replace(' landscape', '')]),
            (v) => { opts.sheet = v; draw(); }),
        ]),
        el('div', { class: 'sheet-views' }, Object.keys(VIEWS).map(k =>
          checkbox(VIEWS[k].label, opts.views.includes(k), (on) => {
            opts.views = on ? [...opts.views, k] : opts.views.filter(x => x !== k);
            if (!opts.views.length) opts.views = [k];
            draw();
          }))),
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Projection' }),
          segmented(opts.projection, Object.entries(PROJECTIONS).map(([k, v]) => [k, v.label]),
            (v) => { opts.projection = v; draw(); }),
        ]),
        el('div', { class: 'hint', text: PROJECTIONS[opts.projection].note }),
        checkbox('Remove hidden lines', opts.hlr, (v) => { opts.hlr = v; draw(); },
          { hint: 'Off draws every edge, which is faster and sometimes clearer on a simple part.' }),
        el('div', { class: 'sheet-view', html: sheetToSVG(sheet, { dark: document.documentElement.dataset.theme !== 'light' }) }),
        el('div', { class: 'hint', text:
          `${sheet.views.length} view${sheet.views.length === 1 ? '' : 's'} at ${scaleLabel(sheet.scale)} on ${sheet.paper.w} × ${sheet.paper.h} mm, ` +
          `${sheet.views.reduce((n, v) => n + v.segs.length, 0)} edges and ${sheet.views.reduce((n, v) => n + v.circles.length, 0)} circles, built in ${ms} ms.` }),
        el('div', { class: 'banner warn', text: 'Dimensions are the overall extents of each view and the diameters of the holes the recogniser found, which is a starting drawing rather than a finished one: datums, geometric tolerance and anything a functional surface needs are still yours to add.' }),
      );
    };
    draw();

    modal({
      title: 'Shop drawing', icon: 'sheet', wide: true, size: 'tall',
      subtitle: `${store.doc.meta.name} · ${bodies.length} bod${bodies.length === 1 ? 'y' : 'ies'}`,
      body: host,
      actions: [
        { label: 'Save SVG', run: () => { this.exportSheet('svg', sheet); return true; } },
        { label: 'Save DXF', run: () => { this.exportSheet('dxf', sheet); return true; } },
        { label: 'Close', primary: true },
      ],
    });
  }

  /** Write the current sheet out, building one first if the dialog never ran. */
  exportSheet(kind, prebuilt = null) {
    const bodies = this.analysisBodies();
    if (!bodies.length) { this.flash('There is nothing to draw yet.', 'warn'); return; }
    let sheet = prebuilt;
    if (!sheet) {
      const o = this._sheetOpts || {};
      try {
        sheet = buildSheet(bodies, {
          doc: store.doc, build: this.build,
          sheet: o.sheet || 'a3l', views: o.views || ['front', 'top', 'right', 'iso'],
          hlr: o.hlr !== false, scale: o.scale || null, projection: o.projection || 'first',
        });
      } catch (err) { this.flash(`The drawing could not be built: ${err.message}`, 'err'); return; }
    }
    const name = store.doc.meta.name || 'drawing';
    if (kind === 'svg') {
      IO.download(IO.safeName(`${name}-drawing`, '.svg'), sheetToSVG(sheet), 'image/svg+xml');
    } else {
      IO.download(IO.safeName(`${name}-drawing`, '.dxf'), toDXF(sheetToDraw(sheet), { units: 'mm' }), 'image/vnd.dxf');
    }
    this.flash(`Drawing saved as ${kind.toUpperCase()} at ${scaleLabel(sheet.scale)}.`, 'ok');
  }


  /* ========================================================== tolerances */

  /**
   * Tolerance stack-up.
   *
   * The dialog shows all three answers side by side on purpose. Worst case is
   * what a drawing promises and is almost always too pessimistic to build to;
   * root sum square is what a production run actually does; Monte Carlo shows
   * whether the failures pile against one limit or spread evenly. Quoting one
   * of the three without the others is how a stack-up spreadsheet misleads.
   */
  showTolerance() {
    const bodies = this.analysisBodies();
    const limits = Studio.limits(processOf(this.processId()));
    if (!store.doc.stacks?.length) {
      store.doc.stacks = [Tol.stackFromBuild(bodies, { axis: 'x', limits, process: this.processId() })];
    }
    let which = 0;
    let target = 1.33;
    const host = el('div');

    const commit = (label) => { store.commit(label); };

    const draw = () => {
      clear(host);
      const stacks = store.doc.stacks;
      const stack = stacks[Math.min(which, stacks.length - 1)];
      const a = Tol.analyseStack(stack);
      const lv = Tol.levers(stack, { target });

      if (stacks.length > 1) {
        host.appendChild(el('div', { class: 'row wide' }, [
          el('label', { text: 'Stack' }),
          select(String(which), stacks.map((s, i) => [String(i), s.name]), (v) => { which = Number(v); draw(); }),
        ]));
      }

      /* --- the requirement --- */
      host.appendChild(section('The requirement', [
        field('Name', (() => {
          const i = el('input', { type: 'text', value: stack.requirement });
          i.addEventListener('change', () => { stack.requirement = i.value; commit('Rename requirement'); });
          return i;
        })()),
        numRow('Lower limit (mm)', stack.lower, (v) => { stack.lower = v; commit('Stack limit'); draw(); }),
        numRow('Upper limit (mm)', stack.upper, (v) => { stack.upper = v; commit('Stack limit'); draw(); }),
        numRow('Mean shift allowance (mm)', stack.shift || 0, (v) => { stack.shift = v; commit('Stack shift'); draw(); }),
        el('div', { class: 'hint', text: 'The shift allowance is for a process that drifts off centre over a run. Leave it at zero unless you have evidence for a number.' }),
      ], true, { icon: 'target' }));

      /* --- the chain --- */
      const rows = stack.links.map((l, i) => {
        const c = a.contributors.find(x => x.id === l.id);
        const nom = el('input', { type: 'number', step: 'any', value: String(l.nominal), class: 'stk-num' });
        nom.addEventListener('input', () => { const n = Number(nom.value); if (Number.isFinite(n)) { l.nominal = n; commit('Stack nominal'); draw(); } });
        const tol = el('input', { type: 'number', step: 'any', min: '0', value: String((Math.abs(l.plus) + Math.abs(l.minus)) / 2), class: 'stk-num' });
        tol.addEventListener('input', () => { const n = Math.abs(Number(tol.value)); if (Number.isFinite(n)) { l.plus = l.minus = n; commit('Stack tolerance'); draw(); } });
        const dirBtn = el('button', { class: 'btn tiny', text: l.dir >= 0 ? '+' : '−', title: 'Which way this dimension pushes the gap' });
        dirBtn.addEventListener('click', () => { l.dir = l.dir >= 0 ? -1 : 1; commit('Stack direction'); draw(); });
        const del = el('button', { class: 'btn tiny danger', text: '✕', title: 'Remove this link' });
        del.addEventListener('click', () => { stack.links = stack.links.filter(x => x.id !== l.id); commit('Remove stack link'); draw(); });
        const lock = el('button', { class: `btn tiny${l.fixed ? ' on' : ''}`, text: l.fixed ? '🔒' : '🔓', title: l.fixed ? 'Fixed: a supplier part or a standard. Not available to tighten.' : 'Open to tightening' });
        lock.addEventListener('click', () => { l.fixed = !l.fixed; commit('Stack lock'); draw(); });

        const name = el('input', { type: 'text', value: l.label, class: 'stk-name' });
        name.addEventListener('change', () => { l.label = name.value; commit('Rename stack link'); draw(); });

        return el('div', { class: 'stk-row' }, [
          dirBtn, name, nom,
          el('span', { class: 'stk-pm', text: '±' }), tol,
          select(l.dist, Object.entries(Tol.DISTRIBUTIONS).map(([k, v]) => [k, v.label]),
            (v) => { l.dist = v; commit('Stack distribution'); draw(); }),
          el('div', { class: 'stk-bar', title: `${((c?.varianceShare || 0) * 100).toFixed(1)}% of the total variance` }, [
            el('div', { class: 'stk-fill', style: `width:${((c?.varianceShare || 0) * 100).toFixed(1)}%` }),
          ]),
          el('span', { class: 'stk-share', text: `${((c?.varianceShare || 0) * 100).toFixed(0)}%` }),
          lock, del,
        ]);
      });
      const addBtn = el('button', { class: 'btn', text: '+ Add a link' });
      addBtn.addEventListener('click', () => {
        stack.links.push(Tol.makeLink({ label: `Dimension ${stack.links.length + 1}`, plus: limits.tolerance, minus: limits.tolerance }));
        commit('Add stack link'); draw();
      });
      const fromModel = el('button', { class: 'btn', text: 'Rebuild from the model' });
      fromModel.addEventListener('click', () => {
        const s = Tol.stackFromBuild(bodies, { axis: 'x', limits, process: this.processId() });
        stack.links = s.links; commit('Stack from model'); draw();
      });

      host.appendChild(section(`The chain · ${stack.links.length} link${stack.links.length === 1 ? '' : 's'}`, [
        el('div', { class: 'stk-head' }, [
          el('span', { text: '±' }), el('span', { text: 'Dimension' }), el('span', { text: 'Nominal' }),
          el('span', { text: '' }), el('span', { text: 'Tolerance' }), el('span', { text: 'Distribution' }),
          el('span', { text: 'Share of variance' }), el('span', { text: '' }), el('span', { text: '' }), el('span', { text: '' }),
        ]),
        ...rows,
        el('div', { class: 'row' }, [addBtn, fromModel]),
        el('div', { class: 'hint', text: 'The ± button sets which way a dimension pushes the gap: a shaft length adds to the stack, a bore depth subtracts from it. The lock marks a dimension you cannot change, such as a bought-in bearing, so the advice below never suggests tightening it.' }),
      ], true, { icon: 'sequence' }));

      /* --- the three answers --- */
      const band = (min, max, fits) => el('div', { class: `stk-verdict ${fits ? 'ok' : 'bad'}` }, [
        el('strong', { text: `${fmt(min, 4)} to ${fmt(max, 4)} mm` }),
        el('span', { text: fits ? 'inside the requirement' : 'outside the requirement' }),
      ]);
      host.appendChild(section('What the chain does', [
        el('div', { class: 'stk-answers' }, [
          el('div', { class: 'stk-answer' }, [
            el('h4', { text: 'Worst case' }), band(a.worst.min, a.worst.max, a.worst.fits),
            el('div', { class: 'hint', text: `Uses ${(a.worst.used * 100).toFixed(0)}% of the requirement. This is the arithmetic a drawing promises, and it assumes every part is at its worst limit at once.` }),
          ]),
          el('div', { class: 'stk-answer' }, [
            el('h4', { text: 'Root sum square' }), band(a.rss.min, a.rss.max, a.rss.fits),
            el('div', { class: 'hint', text: `σ = ${fmt(a.rss.sigma, 5)} mm. What a run of parts really does, if the processes are centred and independent.` }),
          ]),
          el('div', { class: 'stk-answer' }, [
            el('h4', { text: 'Monte Carlo' }), band(a.mc.p1, a.mc.p99, a.mc.failures === 0),
            el('div', { class: 'hint', text: `${a.mc.trials.toLocaleString()} assemblies sampled, ${a.mc.failures} outside spec (${Math.round(a.mc.ppm)} ppm). 1st to 99th percentile shown.` }),
          ]),
        ]),
        el('div', { class: `banner ${a.verdict.severity === 'ok' ? 'ok' : a.verdict.severity === 'warn' ? 'warn' : 'err'}`, text:
          `Cp ${a.capability.cp.toFixed(2)}, Cpk ${a.capability.cpk.toFixed(2)}. ${a.verdict.label}. ` +
          `About ${Math.round(a.capability.ppm)} parts per million will not assemble.` }),
        el('div', { class: 'hint', text: a.capability.centred
          ? 'Cp and Cpk agree, so the chain is aimed at the middle of its requirement.'
          : 'Cp is well above Cpk, which means the chain is tight enough but aimed off centre. Moving a nominal is cheaper than buying tolerance.' }),
      ], true, { icon: 'gauge' }));

      /* --- what to change --- */
      const advice = [];
      advice.push(el('div', { class: 'row wide' }, [
        el('label', { text: 'Target Cpk' }),
        segmented(String(target), [['1', '1.00'], ['1.33', '1.33'], ['1.67', '1.67'], ['2', '2.00']],
          (v) => { target = Number(v); draw(); }),
      ]));
      if (lv.met) {
        advice.push(el('div', { class: 'banner ok', text: `The chain already meets Cpk ${target}. Nothing to change.` }));
      } else if (!lv.closes) {
        // The nominals miss the requirement. Tolerance advice would be wrong
        // here, not merely unhelpful, so the dialog says what is actually wrong.
        advice.push(el('div', { class: 'banner err', text: lv.nominal.note }));
        const centreIt = el('button', { class: 'btn', text: `Move the requirement to ${fmt(lv.nominal.mean - (a.upper - a.lower) / 2, 4)} … ${fmt(lv.nominal.mean + (a.upper - a.lower) / 2, 4)} mm` });
        centreIt.addEventListener('click', () => {
          const width = (stack.upper - stack.lower) / 2;
          stack.lower = lv.nominal.mean - width;
          stack.upper = lv.nominal.mean + width;
          commit('Recentre the requirement'); draw();
        });
        advice.push(el('div', { class: 'dx-item' }, [centreIt,
          el('div', { class: 'hint', text: 'Only if the requirement was the thing entered wrongly. If the requirement is real, a dimension has to move instead.' })]));
      } else {
        if (lv.centring) advice.push(el('div', { class: 'banner warn', text: `${lv.centring.note} Move a nominal by ${fmt(lv.centring.move, 4)} mm.` }));
        if (lv.uniform?.possible) {
          const apply = el('button', { class: 'btn', text: `Scale every open tolerance by ×${lv.uniform.factor.toFixed(3)}` });
          apply.addEventListener('click', () => {
            for (const l of stack.links) if (!l.fixed) { l.plus *= lv.uniform.factor; l.minus *= lv.uniform.factor; }
            commit('Tighten the stack'); draw();
          });
          advice.push(el('div', { class: 'dx-item' }, [apply,
            el('div', { class: 'hint', text: 'Spreads the cost across every operation. Simple, and usually the most expensive option.' })]));
        } else if (lv.uniform) {
          advice.push(el('div', { class: 'banner err', text: lv.uniform.note }));
        }
        for (const one of lv.single.filter(x => x.enough).slice(0, 3)) {
          const b = el('button', { class: 'btn', text: `${one.label}: ±${fmt(one.from, 4)} → ±${fmt(one.to, 4)}` });
          b.addEventListener('click', () => {
            const l = stack.links.find(x => x.id === one.id);
            if (l) { l.plus = l.minus = one.to; commit('Tighten one link'); draw(); }
          });
          advice.push(el('div', { class: 'dx-item' }, [b,
            el('div', { class: 'hint', text: 'One tighter operation instead of five. This is what a shop would actually quote.' })]));
        }
        if (!lv.single.some(x => x.enough)) {
          advice.push(el('div', { class: 'banner err', text: 'No single link can absorb the shortfall on its own. The chain needs fewer links, not tighter ones: that means a design change, such as machining two surfaces in one setup so they share a datum.' }));
        }
        const alloc = Tol.allocate(stack, { method: 'proportional', target });
        if (alloc.some(x => x.tol != null)) {
          const b = el('button', { class: 'btn', text: 'Allocate from the requirement backwards' });
          b.addEventListener('click', () => {
            alloc.forEach(x => { const l = stack.links.find(y => y.id === x.id); if (l && x.tol != null) l.plus = l.minus = x.tol; });
            commit('Allocate tolerances'); draw();
          });
          advice.push(el('div', { class: 'dx-item' }, [b,
            el('div', { class: 'hint', text: `Sizes every band from the requirement, scaled with the dimension: ${alloc.filter(x => x.tol != null).map(x => `${x.label} ±${fmt(x.tol, 4)}`).join(', ')}.` })]));
        }
      }
      host.appendChild(section('What to change', advice, true, { icon: 'bulb' }));
      host.appendChild(el('div', { class: 'banner warn', text: 'Independent, normally distributed processes are assumed unless a link says otherwise. Real machining has correlated errors from a shared fixture and a shared operator, which this cannot see. Treat the ppm figure as an order of magnitude.' }));
    };
    draw();

    modal({
      title: 'Tolerance stack-up', icon: 'ruler', wide: true, size: 'tall',
      subtitle: store.doc.meta.name,
      body: host,
      actions: [
        { label: 'New stack', run: () => {
          store.doc.stacks.push(Tol.emptyStack({ name: `Stack ${store.doc.stacks.length + 1}` }));
          which = store.doc.stacks.length - 1;
          store.commit('New stack');
          // Reopening rebuilds the dialog around the new stack; returning falsy
          // lets the old one close underneath it.
          setTimeout(() => this.showTolerance(), 0);
        } },
        { label: 'Close', primary: true },
      ],
    });
  }

  /**
   * ISO 286 fits, resolved at a real size.
   *
   * A fit table is one of those references everybody looks up and nobody
   * remembers, and looking it up in a PDF gives deviations in micrometres that
   * still have to be added to a nominal by hand. Here the nominal is the one
   * the model uses, and the answer is the clearance in millimetres.
   */
  showFits() {
    let D = 25;
    const sel = [...this.selection][0];
    const holes = sel ? this.holesOf(sel) : [];
    if (holes.length) D = Number(holes[0].diameter.toFixed(3));
    const host = el('div');

    const draw = () => {
      clear(host);
      const table = Tol.fitTable(D);
      if (!table.length) {
        host.appendChild(el('div', { class: 'banner warn', text: `ISO 286 is tabulated to 500 mm. ${fmt(D)} mm is outside it, so there is no standard answer to give.` }));
        return;
      }
      host.append(
        el('div', { class: 'row wide' }, [el('label', { text: 'Nominal size (mm)' }),
          (() => {
            const i = el('input', { type: 'number', step: 'any', min: '0.1', value: String(D) });
            i.addEventListener('input', () => { const n = Number(i.value); if (n > 0) { D = n; draw(); } });
            return i;
          })()]),
        el('div', { class: 'fit-table' }, [
          el('div', { class: 'fit-head' }, ['Fit', 'What it is for', 'Hole', 'Shaft', 'Clearance'].map(t => el('span', { text: t }))),
          ...table.map(f => el('div', { class: `fit-row ${f.kind}` }, [
            el('strong', { text: f.name }),
            el('span', { class: 'fit-note' }, [
              el('b', { text: f.named?.label || f.kind }),
              el('small', { text: f.named?.note || '' }),
            ]),
            el('span', { class: 'mono', text: `${f.hole.upper >= 0 ? '+' : ''}${f.hole.upper.toFixed(3)} / ${f.hole.lower >= 0 ? '+' : ''}${f.hole.lower.toFixed(3)}` }),
            el('span', { class: 'mono', text: `${f.shaft.upper >= 0 ? '+' : ''}${f.shaft.upper.toFixed(3)} / ${f.shaft.lower >= 0 ? '+' : ''}${f.shaft.lower.toFixed(3)}` }),
            el('span', { class: 'mono', text: f.kind === 'interference'
              ? `${Math.abs(f.maxClearance).toFixed(3)} to ${Math.abs(f.minClearance).toFixed(3)} tight`
              : `${f.minClearance.toFixed(3)} to ${f.maxClearance.toFixed(3)}` }),
          ])),
        ]),
        el('div', { class: 'hint', text: `IT6 at this size is ${fmt(Tol.itGrade(6, D) * 1000, 0)} µm, IT7 ${fmt(Tol.itGrade(7, D) * 1000, 0)} µm, IT11 ${fmt(Tol.itGrade(11, D) * 1000, 0)} µm. Grades widen with size, which is why a fit is a letter and a grade rather than a number.` }),
        el('div', { class: 'banner warn', text: 'Hole-basis fits: the hole is the H member and the shaft carries the deviation, because a reamer or a drill is a fixed size and a shaft can be turned to anything. Values are the published ISO 286-1 tables, exact, not interpolated.' }),
      );
      if (holes.length) {
        host.appendChild(el('div', { class: 'hint', text: `The selected body has ${holes.length} recognised hole${holes.length === 1 ? '' : 's'}; the largest is ${fmt(holes[0].diameter, 3)} mm.` }));
      }
    };
    draw();

    modal({
      title: 'Fits and limits', icon: 'target', wide: true,
      subtitle: 'ISO 286 hole basis',
      body: host,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  /** Recognised holes on one body, or an empty list when it has none. */
  holesOf(featureId) {
    const b = this.analysisBodies().find(x => x.feature.id === featureId);
    if (!b) return [];
    try { return recognise(b.geometry, b.matrix).holes || []; } catch { return []; }
  }

  /** The process the document is being made by, matching the Doctor's choice. */
  processId() {
    return store.doc.studio?.process || Studio.standards().process;
  }


  /* ====================================================== design as code */

  /**
   * The document as editable text.
   *
   * Two things make this more than a novelty. The spec is generated from the
   * live document, so it is never stale; and applying an edit goes through a
   * review that names what would change before anything does, because text is
   * a sharp enough tool to delete half a model with one keystroke.
   */
  showSpec() {
    const current = Spec.toSpec(store.doc);
    const area = el('textarea', { class: 'spec-edit', spellcheck: 'false', rows: '22' });
    area.value = current.text;
    const statusLine = el('div', { class: 'hint' });
    const diffHost = el('div');

    const review = () => {
      const r = Spec.reviewSpec(area.value, store.doc);
      clear(diffHost);
      statusLine.textContent = '';

      if (!r.ok) {
        statusLine.textContent = r.summary;
        diffHost.appendChild(el('div', { class: 'banner err', text: `${r.errors.length} error${r.errors.length === 1 ? '' : 's'}. Nothing will be applied until they are fixed.` }));
        for (const e of r.errors.slice(0, 12)) {
          diffHost.appendChild(el('div', { class: 'spec-err' }, [
            el('span', { class: 'spec-line', text: e.line ? `line ${e.line}` : 'document' }),
            el('span', { text: e.message }),
            e.text ? el('code', { text: e.text }) : el('span'),
          ]));
        }
        return r;
      }

      statusLine.textContent = r.summary;
      const parts = [];
      if (r.added.length) parts.push(el('div', { class: 'diff-row added', text: `Added: ${r.added.join(', ')}` }));
      if (r.removed.length) parts.push(el('div', { class: 'diff-row removed', text: `Removed: ${r.removed.join(', ')}` }));
      if (r.changed.length) parts.push(el('div', { class: 'diff-row changed', text: `Changed: ${r.changed.join(', ')}` }));
      if (!parts.length && r.diff.empty) parts.push(el('div', { class: 'hint', text: 'No change yet. Edit the text above and the effect appears here before it is applied.' }));

      for (const h of Spec.hunks(r.diff, 2)) {
        parts.push(el('div', { class: 'spec-hunk' }, h.rows.map(row =>
          el('div', { class: `spec-drow ${row.kind}` }, [
            el('span', { class: 'spec-sign', text: row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' ' }),
            el('code', { text: row.text || ' ' }),
          ]))));
      }
      for (const w of r.warnings.slice(0, 8)) {
        parts.push(el('div', { class: 'dx-item warn', text: w.line ? `Line ${w.line}: ${w.message}` : w.message }));
      }
      clear(diffHost);
      parts.forEach(p => diffHost.appendChild(p));
      return r;
    };

    let timer = null;
    area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(review, 220); });
    review();

    const body = el('div', {}, [
      el('p', { class: 'hint', text: 'This text is the document, not a copy of it. Editing the model rewrites the text; applying the text rewrites the model. Parameters are referenced by name, so changing one value moves everything that depends on it.' }),
      area,
      statusLine,
      section('What this would do', [diffHost], true, { icon: 'sequence' }),
      el('div', { class: 'banner warn', text: current.lossy.length
        ? `${current.lossy.length} item${current.lossy.length === 1 ? '' : 's'} cannot be written as text and stay attached to the document instead: ${current.lossy.map(l => `${l.feature} (${l.what})`).join(', ')}. They survive the round trip; they are simply not editable here.`
        : 'Everything in this document round trips through the text, which the app checks rather than assumes.' }),
    ]);

    modal({
      title: 'Design as code', icon: 'code', wide: true, size: 'tall',
      subtitle: `${store.doc.meta.name} · spec v${Spec.SPEC_VERSION}`,
      body,
      actions: [
        // A truthy return keeps the dialog open, which is what the editing
        // actions want and what a rejected Apply wants.
        { label: 'Tidy up', run: () => { area.value = Spec.format(area.value); review(); return true; } },
        { label: 'Copy', run: () => { this.copyText(area.value, 'Spec copied.'); return true; } },
        { label: 'Apply', primary: true, run: () => {
          const r = Spec.reviewSpec(area.value, store.doc);
          if (!r.ok) { this.flash(`${r.errors.length} error${r.errors.length === 1 ? '' : 's'} in the spec. Nothing applied.`, 'err'); return true; }
          if (r.diff.empty) { this.flash('The text matches the model already.', 'info'); return false; }
          store.batch('Apply the spec', () => {
            const d = store.doc;
            d.meta = { ...d.meta, ...r.doc.meta };
            d.params = r.doc.params;
            d.features = r.doc.features;
          });
          this.selection.clear();
          this.rebuildNow();
          this.flash(`Spec applied: ${r.summary}.`, 'ok');
          return false;
        } },
        { label: 'Cancel' },
      ],
    });
  }

  copySpec() {
    this.copyText(Spec.toSpec(store.doc).text, 'Spec copied to the clipboard.');
  }

  copyText(text, note) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => this.flash(note, 'ok')).catch(() => this.flash('The browser refused clipboard access.', 'warn'));
    } else {
      this.flash('This browser has no clipboard API. Select the text and copy it manually.', 'warn');
    }
  }

  /* ============================================================== merge */

  /** How many branches the local version store holds. */
  branchCount() {
    try { return VCS.branches().length; } catch { return 1; }
  }

  /**
   * Merge another branch into this document.
   *
   * A three-way merge needs a common ancestor, and this is the one place the
   * app has to be honest about not having one: two branches with no shared
   * snapshot cannot be merged safely, and saying so is better than merging
   * them badly.
   */
  showMerge() {
    const here = VCS.currentBranch();
    const others = VCS.branches().filter(b => b.name !== here);
    if (!others.length) { this.flash('There is only one branch. Create one from the Versions menu first.', 'warn'); return; }

    let target = others[0].name;
    let policy = 'ours';
    let result = null;
    const picks = {};
    const host = el('div');

    const draw = () => {
      clear(host);
      const mine = VCS.versions({ branch: here });
      const theirs = VCS.versions({ branch: target });
      const baseMeta = Merge.commonAncestor(mine, theirs);

      host.appendChild(el('div', { class: 'row wide' }, [
        el('label', { text: 'Bring in' }),
        select(target, others.map(b => [b.name, `${b.name} · ${b.count} version${b.count === 1 ? '' : 's'}`]),
          (v) => { target = v; Object.keys(picks).forEach(k => delete picks[k]); draw(); }),
      ]));

      if (!baseMeta) {
        host.appendChild(el('div', { class: 'banner err', text: `"${here}" and "${target}" share no saved version, so there is no common ancestor to merge from. A three-way merge without one is guesswork. Save a version on both branches from the same starting point, or restore one branch's version and continue from there.` }));
        return;
      }
      const base = VCS.getVersion(baseMeta.id, { branch: here })?.doc;
      const head = VCS.getVersion(theirs[0].id, { branch: target })?.doc;
      if (!base || !head) {
        host.appendChild(el('div', { class: 'banner err', text: 'That branch\'s snapshots could not be read back from local storage.' }));
        return;
      }

      result = Merge.mergeDocuments(base, store.doc, head, { policy });
      const resolved = Merge.resolve(result, picks);
      const sum = Merge.mergeSummary(resolved);

      host.append(
        el('div', { class: 'hint', text: `Common ancestor: "${baseMeta.message || baseMeta.id}" from ${new Date(baseMeta.at).toLocaleString()}. Merging ${theirs[0].message || 'the latest version'} of "${target}" into the document open now.` }),
        el('div', { class: `banner ${sum.clean ? 'ok' : 'warn'}`, text: sum.headline }),
        el('div', { class: 'merge-stats' }, [
          el('div', { class: 'big-stat' }, [el('strong', { text: String(resolved.stats.features) }), el('span', { text: 'features after' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: String(resolved.stats.fromTheirs) }), el('span', { text: 'brought in' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: String(resolved.stats.deleted) }), el('span', { text: 'removed' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: String(resolved.conflicts.length) }), el('span', { text: 'conflicts' })]),
        ]),
      );

      if (resolved.conflicts.length) {
        host.appendChild(section(`Conflicts · ${resolved.conflicts.filter(c => !c.pick).length} still open`,
          resolved.conflicts.map(c => {
            const show = (v) => v == null ? 'deleted' : Array.isArray(v) ? (v.length && typeof v[0] === 'object' ? `${v.length} items` : `[${v.join(', ')}]`) : typeof v === 'object' ? (v.name || 'changed') : String(v);
            const mineBtn = el('button', { class: `btn tiny${picks[c.id] === 'ours' ? ' on' : ''}`, text: `Keep: ${show(c.ours)}` });
            const theirsBtn = el('button', { class: `btn tiny${picks[c.id] === 'theirs' ? ' on' : ''}`, text: `Take: ${show(c.theirs)}` });
            mineBtn.addEventListener('click', () => { picks[c.id] = 'ours'; draw(); });
            theirsBtn.addEventListener('click', () => { picks[c.id] = 'theirs'; draw(); });
            return el('div', { class: `mg-conflict${picks[c.id] ? ' done' : ''}` }, [
              el('div', { class: 'mg-label' }, [
                el('strong', { text: c.label }),
                el('small', { text: c.note || `${c.kind} conflict` }),
              ]),
              el('div', { class: 'mg-pick' }, [mineBtn, theirsBtn]),
            ]);
          }), true, { icon: 'warning' }));
        host.appendChild(el('div', { class: 'hint', text: 'Nothing is averaged and nothing is guessed. Every conflict is a value two people chose deliberately, so it is a question rather than a calculation. Unanswered ones fall back to the side below.' }));
        host.appendChild(el('div', { class: 'row wide' }, [
          el('label', { text: 'Unanswered conflicts keep' }),
          segmented(policy, [['ours', 'this document'], ['theirs', `"${target}"`]], (v) => { policy = v; draw(); }),
        ]));
      }

      const d = VCS.diff(store.doc, resolved.merged);
      host.appendChild(section('What the document would become', [
        d.empty ? el('div', { class: 'hint', text: 'The merge changes nothing here: this branch already contains everything the other one has.' })
          : el('div', {}, [
            ...d.features.slice(0, 30).map(f => el('div', { class: `diff-row ${f.kind}` }, [
              el('span', { class: 'diff-badge', text: f.kind }),
              el('span', { class: 'diff-feature', text: f.name }),
              el('small', { text: f.changes.map(c => `${c.what} ${c.from} → ${c.to}`).join(', ') }),
            ])),
            ...d.params.map(p => el('div', { class: `diff-row ${p.kind}` }, [
              el('span', { class: 'diff-badge', text: 'param' }),
              el('span', { class: 'diff-feature', text: p.name }),
              el('small', { text: p.kind === 'changed' ? `${p.from} → ${p.to}` : String(p.to ?? p.from) }),
            ])),
          ]),
      ], true, { icon: 'sequence' }));
    };
    draw();

    modal({
      title: 'Merge a branch', icon: 'merge', wide: true, size: 'tall',
      subtitle: `into "${here}"`,
      body: host,
      actions: [
        { label: 'Merge', primary: true, run: () => {
          if (!result) { this.flash('There is nothing to merge.', 'warn'); return true; }
          const resolved = Merge.resolve(result, picks);
          const open = resolved.conflicts.filter(c => !c.pick).length;
          // One batch, so the whole merge is one undo step. That is what makes
          // it safe to merge with conflicts outstanding: Ctrl+Z puts it back.
          store.batch(`Merge "${target}"`, () => {
            const d = store.doc;
            d.meta = resolved.merged.meta;
            d.params = resolved.merged.params;
            d.features = resolved.merged.features;
            d.draw = resolved.merged.draw;
            if (resolved.merged.configs) d.configs = resolved.merged.configs;
          });
          this.selection.clear();
          this.rebuildNow();
          this.flash(open
            ? `Merged "${target}" with ${open} conflict${open === 1 ? '' : 's'} left to ${policy === 'ours' ? 'this document' : `"${target}"`}. Undo puts it back.`
            : `Merged "${target}": ${resolved.stats.fromTheirs} brought in, no conflicts.`, open ? 'warn' : 'ok');
        } },
        { label: 'Cancel' },
      ],
    });
  }


  /* ========================================================== deviation */

  /**
   * Compare an imported mesh against the parametric model.
   *
   * This is the question a supplier STL or a scan actually raises: is this my
   * part? A file size cannot answer it and a visual overlay only answers it
   * when the difference is large. A signed distance from every sampled point
   * to the nearest surface answers it with a number, and the shape of the
   * histogram says what kind of difference it is.
   */
  showDeviation() {
    const bodies = this.analysisBodies();
    const meshes = bodies.filter(b => b.feature.type === 'mesh');
    const models = bodies.filter(b => b.feature.type !== 'mesh');
    if (!meshes.length) { this.flash('Import a mesh first: this compares an incoming file against the model.', 'warn'); return; }
    if (!models.length) { this.flash('There is no parametric body to compare against.', 'warn'); return; }

    let candidate = meshes[0].feature.id;
    let tolerance = null;
    const host = el('div');

    const draw = () => {
      clear(host);
      const can = meshes.filter(b => b.feature.id === candidate);
      const ref = models;

      host.appendChild(el('div', { class: 'row wide' }, [
        el('label', { text: 'Incoming mesh' }),
        select(candidate, meshes.map(b => [b.feature.id, b.feature.name]), (v) => { candidate = v; draw(); }),
      ]));

      const t0 = performance.now();
      const map = Dev.deviationMap(can, ref, { maxSamples: 6000, tolerance });
      const ms = Math.round(performance.now() - t0);
      if (!map.ok) { host.appendChild(el('div', { class: 'banner err', text: map.reason })); return; }

      const sev = map.verdict.severity === 'ok' ? 'ok' : map.verdict.severity === 'warn' ? 'warn' : 'err';
      const peak = Math.max(map.p95, map.tolerance, 1e-6);
      const maxBin = Math.max(...map.histogram.map(b => b.count), 1);

      host.append(
        el('div', { class: `banner ${sev}`, text: map.verdict.label }),
        el('div', { class: 'merge-stats' }, [
          el('div', { class: 'big-stat' }, [el('strong', { text: `${fmt(map.max, 4)}` }), el('span', { text: 'peak mm' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: `${fmt(map.rms, 4)}` }), el('span', { text: 'RMS mm' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: `${fmt(map.p95, 4)}` }), el('span', { text: '95% within' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: `${(map.outsideFraction * 100).toFixed(1)}%` }), el('span', { text: 'outside tolerance' })]),
        ]),
        section('Where the difference sits', [
          el('div', { class: 'dv-hist' }, map.histogram.map(b => el('div', {
            class: `dv-bin ${b.to <= -map.tolerance ? 'under' : b.from >= map.tolerance ? 'over' : 'inside'}`,
            style: `height:${Math.max(1, (b.count / maxBin) * 100).toFixed(1)}%`,
            title: `${fmt(b.from, 4)} to ${fmt(b.to, 4)} mm: ${b.count} samples`,
          }))),
          el('div', { class: 'dv-axis' }, [
            el('span', { text: `${fmt(map.histogram[0].from, 3)} mm` }),
            el('span', { text: '0' }),
            el('span', { text: `${fmt(map.histogram.at(-1).to, 3)} mm` }),
          ]),
          el('div', { class: 'hint', text: 'Negative is inside the model, positive is outside it. A symmetric spread around zero is tessellation. One tall bar off centre is a moved or mis-sized feature. Two separated humps usually mean a fillet or a chamfer that is present in one and not the other.' }),
        ], true, { icon: 'deviation' }),
        section('Measurement', [kv([
          ['Samples', `${map.samples.toLocaleString()} points in ${ms} ms`],
          ['Incoming triangles', map.candidateTriangles.toLocaleString()],
          ['Model triangles', map.referenceTriangles.toLocaleString()],
          ['Tolerance band', `±${fmt(map.tolerance, 4)} mm`],
          ['Size ratio', `${map.scale.toFixed(4)}×`],
          ['Position offset', `${fmt(map.offset, 4)} mm (${map.offsetVector.map(v => fmt(v, 2)).join(', ')})`],
          ['Median deviation', `${fmt(map.p50, 4)} mm`],
          ['99th percentile', `${fmt(map.p99, 4)} mm`],
          ['Worst point', map.worstPoint ? map.worstPoint.map(v => fmt(v, 2)).join(', ') : '—'],
        ])], true, { icon: 'probe' }),
        (() => {
          const i = el('input', { type: 'number', step: 'any', min: '0', value: String(fmt(map.tolerance, 4)) });
          i.addEventListener('change', () => { const n = Number(i.value); tolerance = n > 0 ? n : null; draw(); });
          return el('div', { class: 'row wide' }, [el('label', { text: 'Tolerance band (mm)' }), i]);
        })(),
        el('div', { class: 'banner warn', text: 'Distances are exact point-to-triangle, measured from the incoming mesh to the model. Sampling is capped, so the peak is the worst of what was sampled rather than the worst that exists; raise it by importing a coarser mesh or lower it by trusting the RMS over the peak. Nothing here registers the two shapes together: if the offset above is not near zero, fix that first.' }),
      );
      void peak;
    };
    draw();

    modal({
      title: 'Compare with a mesh', icon: 'deviation', wide: true, size: 'tall',
      subtitle: `${meshes.length} imported mesh${meshes.length === 1 ? '' : 'es'} · ${models.length} modelled bod${models.length === 1 ? 'y' : 'ies'}`,
      body: host,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  /* ===================================================== intent, read in */

  /** Read a design-intent JSON file back into a live parametric document. */
  pickIntent() {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.showIntentImport(String(reader.result), file.name);
      reader.onerror = () => this.flash('That file could not be read.', 'err');
      reader.readAsText(file);
    });
    input.click();
  }

  showIntentImport(text, filename) {
    const r = Dev.importIntent(text);
    if (!r.doc) {
      modal({
        title: 'Design intent', icon: 'file-import',
        subtitle: filename,
        body: el('div', {}, [
          el('div', { class: 'banner err', text: `${r.errors.length} problem${r.errors.length === 1 ? '' : 's'} stopped this file importing.` }),
          ...r.errors.slice(0, 10).map(e => el('div', { class: 'dx-item', text: e })),
        ]),
        actions: [{ label: 'Close', primary: true }],
      });
      return;
    }

    const check = Dev.intentRoundTrip(typeof text === 'string' ? JSON.parse(text) : text);
    const body = el('div', {}, [
      el('p', { class: 'hint', text: 'A design-intent file carries the parameters, the feature tree and the relationships behind a mesh. Reading it back rebuilds a live parametric document, which is the half of interoperability that normally goes missing.' }),
      el('div', { class: 'merge-stats' }, [
        el('div', { class: 'big-stat' }, [el('strong', { text: String(r.doc.features.length) }), el('span', { text: 'features' })]),
        el('div', { class: 'big-stat' }, [el('strong', { text: String(r.doc.params.length) }), el('span', { text: 'parameters' })]),
        el('div', { class: 'big-stat' }, [el('strong', { text: r.doc.meta.units }), el('span', { text: 'display units' })]),
      ]),
      el('div', { class: `banner ${check.ok ? 'ok' : 'warn'}`, text: check.ok
        ? 'Everything in the file came back unchanged: the round trip is lossless on this document.'
        : `${check.differences.length} thing${check.differences.length === 1 ? '' : 's'} did not survive the trip exactly.` }),
      ...(check.ok ? [] : check.differences.slice(0, 10).map(d => el('div', { class: 'dx-item warn', text: d }))),
      ...r.notes.slice(0, 8).map(n => el('div', { class: 'dx-item', text: n })),
      section('Features', [el('div', {}, r.doc.features.map(f => el('div', { class: 'diff-row' }, [
        el('span', { class: 'diff-badge', text: f.type }),
        el('span', { class: 'diff-feature', text: f.name }),
        el('small', { text: f.inputs.length ? `consumes ${f.inputs.length}` : Object.entries(f.params).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ') }),
      ])))], true, { icon: 'sequence' }),
      el('div', { class: 'banner warn', text: 'Opening this replaces the document that is open now. Save first if you want to keep it.' }),
    ]);

    modal({
      title: 'Import design intent', icon: 'file-import', wide: true,
      subtitle: `${filename} · ${r.doc.meta.name}`,
      body,
      actions: [
        { label: 'Open it', primary: true, run: () => {
          store.load(r.doc);
          this.selection.clear();
          this.rebuildNow();
          this.flash(`Imported ${r.doc.features.length} features from design intent.`, 'ok');
        } },
        { label: 'Cancel' },
      ],
    });
  }


  /* ========================================================== typed intent */

  /**
   * Say what you want, in the vocabulary the app knows.
   *
   * The readback is the whole design of this dialog. It is not a language
   * model and it must never pretend to be one, so before anything is built it
   * shows every fact it took from the sentence, in the app's own words, and
   * lists any word it could not act on. A co-pilot that quietly does the wrong
   * thing costs more than one that says it did not follow you.
   */
  showSpeak() {
    const input = el('input', {
      type: 'text', class: 'sp-input', spellcheck: 'false',
      placeholder: 'a 120 by 80 plate 8 thick in aluminium',
    });
    const out = el('div', { class: 'sp-out' });
    let current = null;

    const target = [...this.selection][0] || null;
    const targetName = target ? (store.feature(target)?.name || null) : null;

    const read = () => {
      const text = input.value.trim();
      clear(out);
      current = null;
      if (!text) {
        out.appendChild(el('div', { class: 'hint', text: 'Type an instruction and the effect appears here before anything is built.' }));
        return;
      }
      const r = Speak.interpret(text, { doc: store.doc, target });
      if (!r.ok) {
        out.appendChild(el('div', { class: 'banner err', text: r.why }));
        return;
      }
      current = r;

      out.append(
        el('div', { class: 'sp-read' }, [
          el('h4', { text: 'What that says' }),
          el('ul', {}, r.understood.map(u => el('li', { text: u }))),
        ]),
        el('div', { class: 'sp-read' }, [
          el('h4', { text: 'What it would build' }),
          el('ul', {}, r.features.map(f => el('li', {
            text: `${f.name} (${CATALOG[f.type].label})` +
              (f.inputs.length ? ` from ${f.inputs.length} input${f.inputs.length === 1 ? '' : 's'}` : '') +
              `: ${Object.entries(f.params).filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${k} ${v}`).join(', ')}`,
          }))),
        ]),
      );
      if (r.params.length) {
        out.appendChild(el('div', { class: 'sp-read' }, [
          el('h4', { text: 'Parameters it would declare' }),
          el('ul', {}, r.params.map(p => el('li', { text: `${p.name} = ${p.value}${p.note ? `  (${p.note})` : ''}` }))),
        ]));
      }
      if (r.unknown.length) {
        out.appendChild(el('div', { class: 'banner warn', text:
          `Ignored: ${r.unknown.join(', ')}. This reads a vocabulary rather than English, so those words had no effect. Nothing was guessed from them.` }));
      }
      for (const n of r.notes) out.appendChild(el('div', { class: 'dx-item', text: n }));
    };

    let timer = null;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(read, 140); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && current) { e.preventDefault(); apply(); }
    });

    const apply = () => {
      if (!current) { this.flash('Nothing to build yet.', 'warn'); return; }
      const r = current;
      store.batch(`Build: ${input.value.trim().slice(0, 40)}`, () => {
        const d = store.doc;
        for (const p of r.params) d.params.push({ id: uid('p'), ...p });
        for (const f of r.features) d.features.push(f);
      });
      this.selection.clear();
      this.selection.add(r.features.at(-1).id);
      this.rebuildNow();
      this.flash(`${r.understood[0]}. Ctrl Z puts it back.`, 'ok', 4200);
      closeModal();
    };

    read();
    const body = el('div', {}, [
      el('p', { class: 'hint', text: 'A grammar, not a language model. It recognises shapes, numbers, units, thread callouts and counts, and refuses anything outside that vocabulary rather than guessing. Everything it builds is a normal feature you can edit, drag and drive from a parameter afterwards.' }),
      input,
      targetName
        ? el('div', { class: 'hint', text: `"${targetName}" is selected, so a hole will be cut from it.` })
        : el('div', { class: 'hint', text: 'Nothing is selected, so a hole would arrive as a body to subtract yourself.' }),
      out,
      section('Things it understands', [
        el('div', { class: 'sp-examples' }, Speak.EXAMPLES.map(ex => {
          const b = el('button', { class: 'btn tiny', text: ex });
          b.addEventListener('click', () => { input.value = ex; read(); input.focus(); });
          return b;
        })),
        el('div', { class: 'hint', text: 'Shapes: box, plate, cylinder, tube, sphere, cone, torus, wedge, prism, pyramid, helix. Units: mm, cm, m, inches, feet. Threads: M1.6 to M36, clearance or tapped, from ISO 273. Counts become patterns, so you can change your mind about the number afterwards.' }),
      ], false, { icon: 'book' }),
    ]);

    modal({
      title: 'Say what you want', icon: 'command', wide: true,
      subtitle: 'Typed intent, turned into real features',
      body,
      actions: [
        { label: 'Build it', primary: true, run: () => { apply(); return true; } },
        { label: 'Cancel' },
      ],
    });
    setTimeout(() => input.focus(), 30);
  }


  /* =========================================================== fasteners */

  /**
   * The fastener library.
   *
   * A component in CAD is normally a shape and nothing else, so the proof
   * load, the torque, the tapping drill and the purchase-order description all
   * get looked up by hand. They are all published numbers, so they are here,
   * next to the geometry, and they travel with it into the bill of materials.
   */
  showFasteners() {
    let size = 'M8';
    let cls = '8.8';
    let length = 30;
    let fit = 'medium';
    let lubricated = false;
    let load = 5000;
    let count = 4;
    let shear = false;
    const host = el('div');

    const draw = () => {
      clear(host);
      const s = Fast.spec(size, { cls, length, fit, lubricated });
      const j = Fast.checkJoint(size, { cls, load, count, shear, safety: 2, lubricated });
      const sev = j.utilisation <= 0.5 ? 'ok' : j.pass ? 'warn' : 'err';

      host.append(
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Size' }),
          select(size, Fast.SIZES.map(x => [x, x]), (v) => { size = v; draw(); }),
        ]),
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Property class' }),
          select(cls, Object.keys(Fast.CLASSES).map(x => [x, x]), (v) => { cls = v; draw(); }),
        ]),
        el('div', { class: 'hint', text: Fast.CLASSES[cls].note }),
        numRow('Length (mm)', length, (v) => { length = Math.max(2, v); draw(); }),
        el('div', { class: 'row wide' }, [
          el('label', { text: 'Clearance' }),
          segmented(fit, [['close', 'Close'], ['medium', 'Medium'], ['free', 'Free']], (v) => { fit = v; draw(); }),
        ]),

        section('What this bolt is', [kv([
          ['Designation', `${s.designation}, ${s.standard}`],
          ['Thread pitch', `${s.pitch} mm (coarse, ISO 724)`],
          ['Tensile stress area', `${s.tensileArea} mm²`],
          ['Proof stress', `${s.proofStress} N/mm²`],
          ['Proof load', `${(s.proofLoadN / 1000).toFixed(1)} kN`],
          ['Clearance hole', `⌀${s.clearanceHole} mm (${s.clearanceFit}, ISO 273)`],
          ['Tapping drill', `⌀${s.tappingDrill} mm`],
          ['Min thread engagement', `${s.minThreadEngagement} mm`],
          ['Head', `⌀${s.headDiameter} × ${s.headHeight} mm`],
          ['Nut', `${s.nutAcrossFlats} A/F × ${s.nutHeight} mm, ISO 4032`],
        ])], true, { icon: 'key' }),
        el('div', { class: 'hint', text: s.engagementNote }),

        section('Tightening', [
          checkbox('Lubricated thread', lubricated, (v) => { lubricated = v; draw(); }),
          el('div', { class: 'banner ok', text: `${s.torqueNm} N·m to reach ${(s.preloadN / 1000).toFixed(1)} kN of preload.` }),
          el('div', { class: 'hint', text: s.torqueBasis }),
        ], true, { icon: 'rotate' }),

        section('Will the joint hold?', [
          numRow('Total load (N)', load, (v) => { load = Math.max(0, v); draw(); }),
          numRow('Number of bolts', count, (v) => { count = Math.max(1, Math.round(v)); draw(); }),
          checkbox('Loaded in shear rather than tension', shear, (v) => { shear = v; draw(); }),
          el('div', { class: `banner ${sev}`, text:
            `${j.per} N per bolt against ${j.allowableN} N allowable in ${j.mode} at safety factor ${j.safety}. ` +
            `${(j.utilisation * 100).toFixed(0)}% used. ${j.verdict}.` }),
          (() => {
            const smallest = Fast.sizeFor({ load, count, cls, shear, safety: 2 });
            const b = el('button', { class: 'btn', text: smallest
              ? `Smallest class ${cls} bolt that holds this: ${smallest.size}`
              : 'No bolt in this library carries that load' });
            if (smallest) b.addEventListener('click', () => { size = smallest.size; draw(); });
            return b;
          })(),
        ], true, { icon: 'physics' }),
        el('div', { class: 'banner warn', text: j.caveat }),
      );
    };
    draw();

    modal({
      title: 'Fasteners', icon: 'key', wide: true, size: 'tall',
      subtitle: 'ISO metric, with the data a drawing and a purchase order need',
      body: host,
      actions: [
        { label: 'Add to the model', run: () => {
          const made = Fast.featuresFor(size, { length, cls }, makeFeature);
          store.batch(`Add ${made.spec.designation}`, () => {
            store.doc.features.push(...made.features);
          });
          this.selection.clear();
          this.selection.add(made.features.at(-1).id);
          this.rebuildNow();
          this.flash(`${made.spec.designation} added. Torque ${made.spec.torqueNm} N·m.`, 'ok', 5000);
        } },
        { label: 'Close', primary: true },
      ],
    });
  }


  /* ====================================================== hygiene, offline */

  /**
   * What is making this document heavy, and what is quietly wrong with it.
   *
   * Every finding here is the kind that does not show up as a modelling error
   * and does show up as a file that crashes, draws imprecisely, or takes forty
   * megabytes to describe a bracket.
   */
  showHygiene() {
    const host = el('div');
    const draw = () => {
      clear(host);
      const r = Hygiene.inspect(store.doc, this.build);
      const w = r.weight;

      host.append(
        el('div', { class: `banner ${r.clean ? 'ok' : r.issues[0].severity === 'block' ? 'err' : 'warn'}`,
          text: Hygiene.summary(r) }),
        el('div', { class: 'merge-stats' }, [
          el('div', { class: 'big-stat' }, [el('strong', { text: String(w.features) }), el('span', { text: 'features' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: `${(w.totalBytes / 1024).toFixed(0)} kB` }), el('span', { text: 'document' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: `${(w.meshShare * 100).toFixed(0)}%` }), el('span', { text: 'imported mesh' })]),
          el('div', { class: 'big-stat' }, [el('strong', { text: String(w.drawEntities) }), el('span', { text: 'draft entities' })]),
        ]),
      );

      if (!r.clean) {
        host.appendChild(section(`Findings · ${r.issues.length}`, r.issues.map(i => {
          const rows = [
            el('div', { class: 'dx-sev', text: i.severity === 'block' ? 'Serious' : i.severity === 'warn' ? 'Worth fixing' : 'Note' }),
            el('strong', { text: i.title }),
            el('div', { text: i.detail }),
            el('div', { class: 'dx-why', text: i.why }),
          ];
          if (i.fix) {
            const b = el('button', { class: 'btn', text: i.fix.label });
            b.addEventListener('click', () => {
              try {
                i.fix.apply(store);
                this.rebuildNow();
                this.flash(`${i.fix.label}. Ctrl Z puts it back.`, 'ok', 4200);
                draw();
              } catch (err) { this.flash(`Could not apply that: ${err.message}`, 'err'); }
            });
            rows.push(b);
          }
          return el('div', { class: `dx-item ${i.severity === 'block' ? 'err' : i.severity}` }, rows);
        }), true, { icon: 'warning' }));
      }

      host.appendChild(section('Where the weight is', [
        el('div', { class: 'fit-table' }, [
          el('div', { class: 'fit-head' }, ['Feature', 'Type', 'Size', '', ''].map(t => el('span', { text: t }))),
          ...w.heaviest.map(row => el('div', { class: 'fit-row' }, [
            el('strong', { text: row.name }),
            el('span', { text: CATALOG[row.type]?.label || row.type }),
            el('span', { class: 'mono', text: `${(row.bytes / 1024).toFixed(1)} kB` }),
            el('span'), el('span'),
          ])),
        ]),
        el('div', { class: 'hint', text: 'Sizes are of the saved JSON. Parametric features cost a couple of hundred bytes each however complex the shape they produce; imported triangles cost what they weigh, which is why a scan dominates a document the moment one arrives.' }),
      ], true, { icon: 'mass' }));

      host.appendChild(el('div', { class: 'banner warn', text: 'Precision figures are the real gaps between 32-bit floats at the distances involved, not a rule of thumb. At 500 km from the origin the smallest representable step is 32 mm, which is why geometry at survey coordinates looks subtly wrong in ways nothing in the feature tree explains.' }));
    };
    draw();

    modal({
      title: 'Document health', icon: 'probe', wide: true, size: 'tall',
      subtitle: store.doc.meta.name,
      body: host,
      actions: [{ label: 'Close', primary: true }],
    });
  }

  /**
   * What this application keeps, and what it sends.
   *
   * The honest answer to the subscription and phone-home complaints is not a
   * promise in a licence, it is a property of the software that the user can
   * check. So this says exactly what is on the machine, offers to delete it,
   * and tells them how to verify the network claim themselves.
   */
  async showOwnership() {
    const st = await Offline.status();
    const rows = Offline.localData();
    const total = rows.reduce((n, r) => n + r.bytes, 0);
    const host = el('div');

    const draw = () => {
      clear(host);
      host.append(
        el('div', { class: `banner ${st.controlled ? 'ok' : 'warn'}`, text: st.controlled
          ? `Installed. ${st.files} files, ${(st.cachedBytes / 1024 / 1024).toFixed(1)} MB on this machine. Turn the network off and reload: it will still open.`
          : st.supported
            ? (this._offline?.ok
              ? 'Installing. Reload once and the offline copy takes over; nothing else changes.'
              : `Not installed: ${this._offline?.reason || 'the offline copy has not registered yet.'}`)
            : 'This browser cannot keep an offline copy. Everything else works the same; you just need the page to load.' }),

        section('What it sends', [
          el('ul', {}, Offline.NETWORK_FACTS.map(f => el('li', { text: f }))),
        ], true, { icon: 'info' }),

        section(`What it keeps here · ${(total / 1024).toFixed(0)} kB`, [
          el('div', { class: 'fit-table' }, [
            el('div', { class: 'fit-head' }, ['Stored', 'What it is', 'Size', '', ''].map(t => el('span', { text: t }))),
            ...rows.map(r => el('div', { class: 'fit-row' }, [
              el('strong', { text: r.present ? 'yes' : 'nothing yet' }),
              el('span', { text: r.what }),
              el('span', { class: 'mono', text: r.bytes ? `${(r.bytes / 1024).toFixed(1)} kB` : '—' }),
              el('span'), el('span'),
            ])),
          ]),
          el('div', { class: 'hint', text: 'All of it is in this browser’s local storage, on this machine, readable by you and by nothing else. It never leaves. Clearing your browser data clears it, which is why a document you care about belongs in a saved file as well.' }),
        ], true, { icon: 'lock' }),

        el('div', { class: 'banner warn', text: 'The licence is MIT and the source is in the repository, so this cannot be taken away from you: a copy of the files is a working copy of the application. Nothing here checks a licence, so nothing here can refuse to start.' }),
      );
    };
    draw();

    modal({
      title: 'Offline and ownership', icon: 'lock', wide: true,
      subtitle: st.controlled ? 'Running from your machine' : 'Runs in this browser, no account',
      body: host,
      actions: [
        { label: 'Forget everything stored', danger: true, run: () => {
          confirmDialog('Delete everything stored in this browser?',
            'Your saved versions, standards, decisions, macros and the autosaved document all go. Files you exported are untouched. This cannot be undone.',
            () => {
              const gone = Offline.forgetEverything();
              this.flash(`Removed ${gone.length} stored item${gone.length === 1 ? '' : 's'}. Reload to start clean.`, 'ok', 5000);
            }, { danger: true, yes: 'Delete it all' });
        } },
        { label: 'Remove the offline copy', run: async () => {
          const r = await Offline.uninstall();
          this.flash(`Offline copy removed (${r.caches} cache${r.caches === 1 ? '' : 's'}). The app will load from the network again.`, 'ok', 5000);
          return true;
        } },
        { label: 'Close', primary: true },
      ],
    });
  }

  zenModeOrRedo(e) {
    // Ctrl+Shift+Z is redo everywhere; the zen-mode binding lives on the menu.
    void e;
    store.redo();
  }

  draftKey(e) {
    if (e.key === 'F3') { e.preventDefault(); this.toggleDraft('snap'); return; }
    if (e.key === 'F8') { e.preventDefault(); this.toggleDraft('ortho'); return; }
    if (e.key === 'F9') { e.preventDefault(); this.toggleDraft('grid'); return; }
    if (e.key === 'F10') { e.preventDefault(); this.toggleDraft('polar'); return; }
    if (this.draft.pending.length && this.draft.typeKey(e.key)) { e.preventDefault(); return; }
    if (e.key.toLowerCase() === 'c' && this.draft.pending.length >= 3) { this.draft.closeChain(); return; }
    if (e.key.toLowerCase() === 'q') { e.preventDefault(); this.openQuickMenu(innerWidth / 2, innerHeight / 2); return; }
    const tool = DRAW_TOOLS.find(t => t.key && t.key.toLowerCase() === e.key.toLowerCase());
    if (tool) { e.preventDefault(); this.setDraftTool(tool.id); return; }
    if (e.key === 'Enter') { this.draft._finishChain(); return; }
    if (e.key.toLowerCase() === 'f') { e.preventDefault(); this.draft.zoomExtents(); }
  }
}

function randomColour() {
  const palette = ['#4c9fff', '#46cf8b', '#ffb454', '#ff6b6b', '#b98cff', '#4fd0d8', '#f37ab5', '#a0d468'];
  return palette[Math.floor(Math.random() * palette.length)];
}

/* ------------------------------------------------------------------ go */

const app = new App();
/* ======================================================= analysis helpers */

/** A numeric row for the section dialog. */
function numRow(label, value, onChange) {
  const i = el('input', { type: 'number', step: 'any', value: String(value) });
  i.addEventListener('input', () => { const n = Number(i.value); if (Number.isFinite(n)) onChange(n); });
  return el('div', { class: 'row wide' }, [el('label', { text: label }), i]);
}

/**
 * Draw a cross-section to scale.
 *
 * A table of second moments means very little without the shape they came from,
 * and the outline is the one part of a section report that can be checked at a
 * glance: if the picture is not the section you expected, no number below it
 * matters.
 */
function section2D(sec, size = 300) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of sec.outline) {
    for (const [x, y] of loop) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
  const pad = Math.max(w, h) * 0.08;
  const vb = [minX - pad, minY - pad, w + pad * 2, h + pad * 2];
  const stroke = Math.max(w, h) / 240;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', vb.join(' '));
  svg.setAttribute('class', 'section-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // An inline SVG carrying only a viewBox has no intrinsic height, and in a
  // flex column that collapses it to nothing. The size is set here rather than
  // left to the stylesheet so the drawing cannot silently disappear.
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(size));
  // SVG's y axis runs down the screen and the section's runs up it.
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('transform', `translate(0 ${2 * (minY - pad) + h + pad * 2}) scale(1 -1)`);

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', sec.outline.map(loop =>
    `M ${loop.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join(' L ')} Z`).join(' '));
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('class', 'section-fill');
  path.setAttribute('stroke-width', String(stroke));
  g.appendChild(path);

  // The centroid, because every section modulus below is measured from it.
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', String(sec.centroid2D[0]));
  c.setAttribute('cy', String(sec.centroid2D[1]));
  c.setAttribute('r', String(Math.max(w, h) / 90));
  c.setAttribute('class', 'section-centroid');
  g.appendChild(c);

  // The principal axes, which are the directions the section is strongest and
  // weakest about, and are rarely the ones you would have guessed.
  const len = Math.max(w, h) * 0.55;
  const t = (sec.principalAngleDeg * Math.PI) / 180;
  for (const [dx, dy, cls] of [[Math.cos(t), Math.sin(t), 'strong'], [-Math.sin(t), Math.cos(t), 'weak']]) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(sec.centroid2D[0] - dx * len));
    line.setAttribute('y1', String(sec.centroid2D[1] - dy * len));
    line.setAttribute('x2', String(sec.centroid2D[0] + dx * len));
    line.setAttribute('y2', String(sec.centroid2D[1] + dy * len));
    line.setAttribute('class', `section-axis ${cls}`);
    line.setAttribute('stroke-width', String(stroke));
    g.appendChild(line);
  }

  svg.appendChild(g);
  return el('div', { class: 'section-view' }, [
    svg,
    el('div', { class: 'hint', text: `${fmt(w)} × ${fmt(h)} mm. The dot is the centroid; the solid line is the strong principal axis and the dashed one the weak.` }),
  ]);
}

/** The closest two bodies, sampled. Only meaningful when nothing clashes. */
function nearestPair(bodies) {
  if (bodies.length < 2) return null;
  let best = null;
  for (let i = 0; i < bodies.length && i < 12; i++) {
    for (let j = i + 1; j < bodies.length && j < 12; j++) {
      if (bodies[i].feature.id === bodies[j].feature.id) continue;
      const c = clearance(bodies[i], bodies[j], { samples: 160 });
      if (c && (!best || c.distance < best.distance)) {
        best = { distance: c.distance, a: bodies[i].feature.name, b: bodies[j].feature.name };
      }
    }
  }
  return best;
}

window.tesserCAD = app;
try {
  app.boot();
} catch (err) {
  console.error(err);
  const m = document.getElementById('bootMsg');
  if (m) { m.textContent = `Startup failed: ${err.message}`; m.style.color = '#ff6b6b'; }
}
