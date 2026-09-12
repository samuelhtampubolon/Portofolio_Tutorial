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
import { rebuild, invalidateCache, massProperties } from './core/rebuild.js';
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
    this.rebuildNow();
    this.draft.start();
    this.draft.resize();
    this.renderLearn();
    // Frame after the chrome has laid out, so the camera sees the real canvas.
    requestAnimationFrame(() => requestAnimationFrame(() => this.vp.frameAll()));

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

  rebuildNow() {
    const t0 = performance.now();
    try { this.build = rebuild(store.doc); }
    catch (err) { console.error(err); this.flash(`Rebuild failed: ${err.message}`, 'err', 6000); return; }
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

  toggleView(key) {
    store.edit('View setting', (d) => { d.view[key] = !d.view[key]; }, { rebuild: false });
    this.applyView();
    this.refreshUI();
  }

  setShading(mode) {
    store.edit('Shading', (d) => { d.view.shading = mode; }, { rebuild: false });
    this.refreshBodies(true);
  }

  cycleShading() {
    const modes = ['shaded-edges', 'shaded', 'wire', 'xray'];
    const next = modes[(modes.indexOf(store.doc.view.shading) + 1) % modes.length];
    this.setShading(next);
    this.flash(`Shading: ${next.replace('-', ' with ')}`, 'info', 1300);
  }

  setBackground(bg) {
    store.edit('Background', (d) => { d.view.bg = bg; }, { rebuild: false });
    this.applyView();
    this.refreshUI();
  }

  toggleSection() {
    store.edit('Section', (d) => { d.view.clip.enabled = !d.view.clip.enabled; }, { rebuild: false });
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

  showHistory() {
    const undo = store.undoStack;
    const redo = store.redoStack;
    const rows = [];
    undo.forEach((h, i) => rows.push({ label: h.label, i, kind: 'past' }));
    rows.push({ label: 'Current state', kind: 'now' });
    [...redo].reverse().forEach((h) => rows.push({ label: h.label, kind: 'future' }));

    const list = el('div', { class: 'hist-list' }, rows.map((r, k) => el('div', {
      class: `hist-item ${r.kind === 'now' ? 'now' : r.kind === 'future' ? 'future' : ''}`,
      onclick: () => {
        const nowIndex = undo.length;
        if (k < nowIndex) { for (let n = 0; n < nowIndex - k; n++) store.undo(); }
        else if (k > nowIndex) { for (let n = 0; n < k - nowIndex; n++) store.redo(); }
        closeModal();
        this.refreshUI();
      },
    }, [
      icon(r.kind === 'now' ? 'target' : r.kind === 'future' ? 'redo' : 'undo', { size: 14 }),
      el('span', { class: 'hn', text: r.label }),
      el('span', { class: 'hi', text: r.kind === 'now' ? 'you are here' : '' }),
    ])));

    modal({
      title: 'Undo history', icon: 'history',
      subtitle: `${undo.length} step${undo.length === 1 ? '' : 's'} back, ${redo.length} forward. Click any step to jump there.`,
      body: [undo.length || redo.length ? list : emptyState('Nothing to undo yet', 'Every edit you make lands here.', 'history')],
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
window.tesserCAD = app;
try {
  app.boot();
} catch (err) {
  console.error(err);
  const m = document.getElementById('bootMsg');
  if (m) { m.textContent = `Startup failed: ${err.message}`; m.style.color = '#ff6b6b'; }
}
