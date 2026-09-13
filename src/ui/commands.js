/**
 * The command registry.
 *
 * Every action in TesserCAD is a command object, and the menus, the ribbon,
 * the command palette, the quick menu and the keyboard map are all generated
 * from this one list. Adding a feature here makes it reachable five ways at
 * once, and nothing can drift out of sync.
 *
 * Shape: { id, label, icon, group, key, run, checked?, enabled?, keywords? }
 *   checked  — a predicate; when present the command renders as a toggle
 *   enabled  — a predicate; when false the command greys out everywhere
 */
import { store, CATALOG, MATERIALS, UNITS, newDocument } from '../core/doc.js';
import * as IO from '../io/io.js';

export function buildCommands(app) {
  const C = [];
  const add = (id, label, icon, group, run, opts = {}) => { C.push({ id, label, icon, group, run, ...opts }); return C[C.length - 1]; };

  const hasSel = () => app.selection.size > 0;
  const oneSel = () => app.selection.size === 1;
  const multiSel = () => app.selection.size > 1;
  const in3d = () => app.workspace !== 'draft';
  const hasDraftSel = () => app.draft.selection.size > 0;
  const view = () => store.doc.view;
  // Branch count comes from the app rather than from the version store, so the
  // registry stays free of storage imports.
  const VCSBranchCount = () => app.branchCount?.() ?? 1;

  /* ==================================================== File */

  add('file.new', 'New document', 'file-new', 'File', () => app.newDocument(), { key: 'Ctrl N', keywords: 'blank empty start over' });
  add('file.template', 'New from template…', 'template', 'File', () => app.showTemplates(), { keywords: 'starter example preset' });
  add('file.open', 'Open project…', 'file-open', 'File', () => app.pickFile('.tcad,.json'), { key: 'Ctrl O' });
  add('file.save', 'Save project', 'file-save', 'File', () => IO.saveProject(), { key: 'Ctrl S', keywords: 'download tcad' });
  add('file.saveAs', 'Save as…', 'file-save-as', 'File', () => app.saveAs(), { key: 'Ctrl ⇧ S' });
  add('file.import', 'Import file…', 'file-import', 'File', () => app.pickFile(IO.IMPORT_ACCEPT), { key: 'Ctrl I', keywords: 'stl obj dxf load open mesh' });
  add('file.revert', 'Revert to last save', 'refresh', 'File', () => app.revert(), { enabled: () => store.canUndo() });
  add('file.props', 'Document properties…', 'doc-props', 'File', () => app.showDocProps(), { keywords: 'units author notes metadata' });
  add('file.autosave', 'Recover autosave…', 'file-recent', 'File', () => app.showAutosave(), { keywords: 'restore crash backup' });
  add('file.clearAutosave', 'Clear saved session', 'trash', 'File', () => app.clearAutosave(), { danger: true });
  add('file.sample', 'Load the demo model', 'star', 'File', () => app.loadSample(), { keywords: 'example bracket demo' });

  /* ==================================================== Export */

  add('export.stl', 'STL — binary', 'cube3d', 'Export', () => IO.exportSTL(app.vp, { binary: true }), { keywords: '3d print slicer mesh' });
  add('export.stlAscii', 'STL — ASCII', 'cube3d', 'Export', () => IO.exportSTL(app.vp, { binary: false }));
  add('export.obj', 'OBJ', 'mesh', 'Export', () => IO.exportOBJ(app.vp), { keywords: 'wavefront' });
  add('export.glb', 'glTF — binary (.glb)', 'box', 'Export', () => IO.exportGLTF(app.vp, { binary: true }), { keywords: 'blender unity unreal three' });
  add('export.gltf', 'glTF — JSON (.gltf)', 'box', 'Export', () => IO.exportGLTF(app.vp, { binary: false }));
  add('export.ply', 'PLY', 'mesh', 'Export', () => IO.exportPLY(app.vp), { keywords: 'point cloud vertex colour' });
  add('export.dxf', 'DXF drawing', 'layers', 'Export', () => IO.exportDXF(), { keywords: 'autocad laser cam r12' });
  add('export.svg', 'SVG drawing', 'image', 'Export', () => IO.exportSVG(), { keywords: 'vector plot' });
  add('export.png1', 'Viewport PNG — 1×', 'image', 'Export', () => IO.exportPNG(app.vp, 1));
  add('export.png', 'Viewport PNG — 2×', 'image', 'Export', () => IO.exportPNG(app.vp, 2), { keywords: 'screenshot capture render' });
  add('export.png4', 'Viewport PNG — 4×', 'image', 'Export', () => IO.exportPNG(app.vp, 4));
  add('export.bom', 'Bill of materials (CSV)', 'table', 'Export', () => app.exportBOM(), { keywords: 'parts list mass spreadsheet' });
  add('export.report', 'Mass properties report', 'mass', 'Export', () => app.showMassReport(), { keywords: 'volume weight centroid' });

  /* ==================================================== Edit */

  add('edit.undo', 'Undo', 'undo', 'Edit', () => store.undo(), { key: 'Ctrl Z', enabled: () => store.canUndo() });
  add('edit.redo', 'Redo', 'redo', 'Edit', () => store.redo(), { key: 'Ctrl ⇧ Z', enabled: () => store.canRedo() });
  add('edit.history', 'Undo history…', 'history', 'Edit', () => app.showHistory(), { key: 'Ctrl ⇧ H', keywords: 'timeline steps revert' });
  add('edit.duplicate', 'Duplicate', 'duplicate', 'Edit', () => app.duplicateSelection(), { key: 'Ctrl D', enabled: () => hasSel() || hasDraftSel() });
  add('edit.delete', 'Delete', 'trash', 'Edit', () => app.deleteSelection(), { key: 'Del', danger: true, enabled: () => hasSel() || hasDraftSel() });
  add('edit.rename', 'Rename…', 'rename', 'Edit', () => app.renameSelected(), { key: 'F2', enabled: oneSel });
  add('edit.selectAll', 'Select all', 'select-all', 'Edit', () => app.selectAll(), { key: 'Ctrl A' });
  add('edit.selectNone', 'Select none', 'select-none', 'Edit', () => app.select([]), { key: 'Alt A', enabled: () => hasSel() || hasDraftSel() });
  add('edit.selectInvert', 'Invert selection', 'select-invert', 'Edit', () => app.invertSelection(), { key: 'Ctrl ⇧ I' });
  add('edit.selectSameType', 'Select same type', 'select-all', 'Edit', () => app.selectSameType(), { enabled: oneSel });
  add('edit.prefs', 'Preferences…', 'settings', 'Edit', () => app.showPrefs(), { key: 'Ctrl ,', keywords: 'settings options theme config' });

  /* ==================================================== Create */

  for (const [type, cat] of Object.entries(CATALOG)) {
    if (cat.group !== 'solid') continue;
    add(`add.${type}`, cat.label, ICON_FOR[type] || 'box', 'Create', () => app.addFeature(type), { keywords: `primitive solid ${type}` });
  }
  add('sketch.extrude', 'Extrude drawing', 'extrude', 'Create', () => app.createFromProfile('extrude'), { key: 'E', enabled: hasDraftSel, keywords: 'pad sweep profile' });
  add('sketch.revolve', 'Revolve drawing', 'revolve', 'Create', () => app.createFromProfile('revolve'), { enabled: hasDraftSel, keywords: 'lathe turn profile' });
  add('add.import', 'Import a mesh…', 'file-import', 'Create', () => app.pickFile('.stl,.obj'));

  /* ==================================================== Modify */

  add('bool.union', 'Union', 'union', 'Modify', () => app.addBoolean('union'), { key: 'Ctrl +', enabled: multiSel, keywords: 'add join combine weld' });
  add('bool.subtract', 'Subtract', 'subtract', 'Modify', () => app.addBoolean('subtract'), { key: 'Ctrl -', enabled: multiSel, keywords: 'cut difference hole remove' });
  add('bool.intersect', 'Intersect', 'intersect', 'Modify', () => app.addBoolean('intersect'), { enabled: multiSel, keywords: 'common overlap' });
  add('mod.linear', 'Linear pattern', 'pattern-linear', 'Modify', () => app.addModifier('patternLinear'), { enabled: oneSel, keywords: 'array grid repeat row' });
  add('mod.circular', 'Circular pattern', 'pattern-circular', 'Modify', () => app.addModifier('patternCircular'), { enabled: oneSel, keywords: 'array polar radial repeat' });
  add('mod.mirror', 'Mirror', 'mirror', 'Modify', () => app.addModifier('mirror'), { enabled: oneSel, keywords: 'reflect symmetry' });
  add('mod.suppress', 'Suppress / unsuppress', 'eye-off', 'Modify', () => app.toggleSuppress(), { enabled: hasSel, keywords: 'skip disable' });
  add('mod.hide', 'Hide selected', 'eye-off', 'Modify', () => app.setVisible(false), { key: 'H', enabled: hasSel });
  add('mod.showAll', 'Show everything', 'eye', 'Modify', () => app.setVisible(true, { all: true }), { key: 'Alt H' });
  add('mod.isolate', 'Isolate selected', 'target', 'Modify', () => app.isolate(), { key: '/', enabled: hasSel, keywords: 'solo focus only' });
  add('mod.material', 'Assign material…', 'palette', 'Modify', () => app.showMaterialPicker(), { enabled: hasSel, keywords: 'steel aluminium plastic density colour' });
  add('mod.colour', 'Set colour…', 'palette', 'Modify', () => app.pickColour(), { enabled: hasSel });

  /* ==================================================== Transform */

  add('op.move', 'Move', 'move', 'Transform', () => app.startOperator('move'), { key: 'G', enabled: () => hasSel() && in3d(), keywords: 'translate grab offset' });
  add('op.rotate', 'Rotate', 'rotate', 'Transform', () => app.startOperator('rotate'), { key: 'R', enabled: () => hasSel() && in3d(), keywords: 'turn spin orient' });
  add('op.scale', 'Scale', 'scale', 'Transform', () => app.startOperator('scale'), { key: 'S', enabled: () => hasSel() && in3d(), keywords: 'resize grow shrink' });
  add('gizmo.translate', 'Move gizmo', 'move', 'Transform', () => app.setGizmo('translate'), { key: 'W', checked: () => app.gizmoMode === 'translate' });
  add('gizmo.rotate', 'Rotate gizmo', 'rotate', 'Transform', () => app.setGizmo('rotate'), { key: 'Shift E', checked: () => app.gizmoMode === 'rotate' });
  add('gizmo.scale', 'Scale gizmo', 'scale', 'Transform', () => app.setGizmo('scale'), { key: 'Shift R', checked: () => app.gizmoMode === 'scale' });
  add('gizmo.off', 'No gizmo', 'close', 'Transform', () => app.setGizmo(null), { checked: () => !app.gizmoMode });
  add('xf.reset', 'Reset transform', 'reset', 'Transform', () => app.resetTransform(), { enabled: hasSel });
  add('xf.drop', 'Drop to floor', 'drop', 'Transform', () => app.dropSelection(), { key: 'D', enabled: hasSel, keywords: 'ground z zero sit' });
  add('xf.centre', 'Centre on origin', 'center', 'Transform', () => app.centreSelection(), { enabled: hasSel });
  add('xf.alignX', 'Align on X', 'align', 'Transform', () => app.alignSelection('x'), { enabled: multiSel });
  add('xf.alignY', 'Align on Y', 'align', 'Transform', () => app.alignSelection('y'), { enabled: multiSel });
  add('xf.alignZ', 'Align on Z', 'align', 'Transform', () => app.alignSelection('z'), { enabled: multiSel });
  add('xf.distribute', 'Distribute evenly', 'pattern-linear', 'Transform', () => app.distributeSelection(), { enabled: () => app.selection.size > 2 });

  /* ==================================================== View */

  add('view.fit', 'Zoom to fit', 'fit', 'View', () => app.zoomFit(), { key: 'F', keywords: 'frame all extents' });
  add('view.selection', 'Zoom to selection', 'zoom-sel', 'View', () => app.vp.frameSelection(), { key: '⇧ F', enabled: hasSel });
  add('view.zoomIn', 'Zoom in', 'zoom-in', 'View', () => app.zoomBy(1.25), { key: '+' });
  add('view.zoomOut', 'Zoom out', 'zoom-out', 'View', () => app.zoomBy(0.8), { key: '-' });
  for (const [k, label, key, ic] of [
    ['iso', 'Isometric', '0', 'view-iso'], ['front', 'Front', '1', 'view-front'], ['back', 'Back', '⇧ 1', 'view-front'],
    ['right', 'Right', '3', 'view-right'], ['left', 'Left', '⇧ 3', 'view-right'],
    ['top', 'Top', '7', 'view-top'], ['bottom', 'Bottom', '⇧ 7', 'view-top'],
  ]) add(`view.${k}`, `${label} view`, ic, 'View', () => app.vp.standardView(k), { key, enabled: in3d });

  add('view.ortho', 'Orthographic camera', 'ortho', 'View', () => app.toggleView('ortho'), { key: '5', checked: () => view().ortho, keywords: 'parallel projection isometric' });
  add('view.grid', 'Show grid', 'grid', 'View', () => app.toggleView('grid'), { checked: () => view().grid });
  add('view.axes', 'Show world axes', 'axes', 'View', () => app.toggleView('axes'), { checked: () => view().axes });
  add('view.ground', 'Show shadow ground', 'ground', 'View', () => app.toggleView('ground'), { checked: () => view().ground, enabled: in3d });
  for (const [mode, label, ic] of [
    ['shaded-edges', 'Shaded with edges', 'shade-edges'], ['shaded', 'Shaded', 'shade-solid'],
    ['wire', 'Wireframe', 'shade-wire'], ['xray', 'X-ray', 'shade-xray'],
  ]) add(`shade.${mode}`, label, ic, 'View', () => app.setShading(mode), { checked: () => view().shading === mode, enabled: in3d });
  add('view.shadingCycle', 'Cycle shading mode', 'shade-solid', 'View', () => app.cycleShading(), { key: 'Z', enabled: in3d });
  add('view.section', 'Section view', 'section', 'View', () => app.toggleSection(), { checked: () => view().clip.enabled, enabled: in3d, keywords: 'clip cut slice inside' });
  for (const [bg, label] of [['studio', 'Studio'], ['graphite', 'Graphite'], ['white', 'Paper'], ['blueprint', 'Blueprint']]) {
    add(`bg.${bg}`, label, 'image', 'View', () => app.setBackground(bg), { checked: () => view().bg === bg, enabled: in3d });
  }
  add('view.theme', 'Light / dark theme', 'moon', 'View', () => app.toggleTheme(), { key: 'Ctrl ⇧ L', keywords: 'dark light appearance colour' });
  add('view.fullscreen', 'Full screen', 'fullscreen', 'View', () => app.toggleFullscreen(), { key: 'F11' });

  /* ==================================================== Measure */

  add('measure.distance', 'Measure distance', 'ruler', 'Measure', () => app.vp.setMeasureMode('distance'), { key: 'M', enabled: in3d, checked: () => app.vp.measureMode === 'distance' });
  add('measure.angle', 'Measure angle', 'angle', 'Measure', () => app.vp.setMeasureMode('angle'), { enabled: in3d, checked: () => app.vp.measureMode === 'angle' });
  add('measure.point', 'Probe a point', 'probe', 'Measure', () => app.vp.setMeasureMode('point'), { enabled: in3d, checked: () => app.vp.measureMode === 'point' });
  add('measure.mass', 'Mass properties…', 'mass', 'Measure', () => app.showMassReport(), { keywords: 'volume weight density centroid' });
  add('measure.off', 'Stop measuring', 'close', 'Measure', () => app.stopMeasuring(), { enabled: () => !!app.vp.measureMode });

  /* ==================================================== Draft */

  const draftTool = (id, label, ic, key, kw) => add(`draft.${id}`, label, ic, 'Draft', () => app.setDraftTool(id), {
    key, keywords: kw, checked: () => app.workspace === 'draft' && app.draft.tool === id,
  });
  draftTool('select', 'Select', 'target', 'Esc', 'pick arrow');
  draftTool('line', 'Line', 'line', 'L', 'segment');
  draftTool('polyline', 'Polyline', 'polyline', 'P', 'chain path');
  draftTool('rect', 'Rectangle', 'rect', 'R', 'box square');
  draftTool('circle', 'Circle', 'circle', 'C', 'round');
  draftTool('arc', 'Arc', 'arc', 'A', 'curve');
  draftTool('ellipse', 'Ellipse', 'ellipse', 'Shift E', 'oval');
  draftTool('polygon', 'Polygon', 'polygon', 'G', 'hexagon ngon');
  draftTool('spline', 'Spline', 'spline', 'S', 'curve bezier');
  draftTool('point', 'Point', 'point', '', 'node');
  draftTool('text', 'Text', 'text', 'X', 'label annotate');
  draftTool('dimLinear', 'Linear dimension', 'dim-linear', 'D', 'measure annotate');
  draftTool('dimAligned', 'Aligned dimension', 'dim-aligned', '', 'measure');
  draftTool('dimRadial', 'Radius dimension', 'dim-radial', '', 'measure circle');
  draftTool('dimAngular', 'Angle dimension', 'dim-angular', '', 'measure');
  draftTool('offset', 'Offset', 'offset', 'O', 'parallel');
  draftTool('measure', 'Measure', 'ruler', 'M', 'distance');

  add('draft.snap', 'Object snap', 'magnet', 'Draft', () => app.toggleDraft('snap'), { key: 'F3', checked: () => app.draft.snap.on });
  add('draft.ortho', 'Ortho mode', 'ortho-lock', 'Draft', () => app.toggleDraft('ortho'), { key: 'F8', checked: () => app.draft.ortho });
  add('draft.polar', 'Polar tracking', 'polar', 'Draft', () => app.toggleDraft('polar'), { key: 'F10', checked: () => app.draft.polar });
  add('draft.gridSnap', 'Snap to grid', 'grid', 'Draft', () => app.toggleDraft('grid'), { key: 'F9', checked: () => app.draft.snap.grid });
  add('draft.zoomExtents', 'Zoom drawing extents', 'fit', 'Draft', () => app.draft.zoomExtents());
  add('draft.addLayer', 'New layer…', 'layers', 'Draft', () => app.addLayer());
  add('draft.rotate90', 'Rotate 90°', 'rotate', 'Draft', () => app.rotateDraftSelection(90), { enabled: hasDraftSel });
  add('draft.mirrorX', 'Mirror across X', 'mirror', 'Draft', () => app.mirrorDraftSelection('x'), { enabled: hasDraftSel });
  add('draft.mirrorY', 'Mirror across Y', 'mirror', 'Draft', () => app.mirrorDraftSelection('y'), { enabled: hasDraftSel });

  /* ==================================================== Simulate */

  add('sim.play', 'Play / pause', 'play', 'Simulate', () => app.togglePlay(), { key: 'Space', checked: () => app.sim.playing });
  add('sim.stop', 'Stop and rewind', 'stop', 'Simulate', () => app.sim.stop());
  add('sim.rewind', 'Go to start', 'rewind', 'Simulate', () => app.sim.seek(0), { key: 'Home' });
  add('sim.end', 'Go to end', 'forward', 'Simulate', () => app.sim.seek(store.doc.sim.duration), { key: 'End' });
  add('sim.stepBack', 'Step back one frame', 'step-back', 'Simulate', () => app.sim.step(-1), { key: ',' });
  add('sim.stepFwd', 'Step forward one frame', 'step-fwd', 'Simulate', () => app.sim.step(1), { key: '.' });
  add('sim.loop', 'Loop playback', 'refresh', 'Simulate', () => app.toggleLoop(), { checked: () => store.doc.sim.loop });
  add('sim.key', 'Key the current pose', 'key', 'Simulate', () => app.keyPose(), { key: 'K', enabled: oneSel, keywords: 'keyframe animate record' });
  add('sim.clearKeys', 'Clear animation on selection', 'trash', 'Simulate', () => app.clearKeys(), { enabled: oneSel, danger: true });
  add('sim.autoSchedule', 'Auto-sequence the build', 'sequence', 'Simulate', () => app.autoSchedule(), { keywords: '4d construction gantt schedule bim' });
  add('sim.clearSchedule', 'Clear build sequence', 'trash', 'Simulate', () => app.clearSchedule());
  add('sim.schedule', 'Build sequencing', 'sequence', 'Simulate', () => app.toggleSchedule(), { checked: () => store.doc.sim.schedule.enabled });
  add('sim.physics', 'Rigid-body dynamics', 'physics', 'Simulate', () => app.togglePhysics(), { checked: () => store.doc.sim.dynamics.enabled, keywords: 'gravity collision simulate' });
  add('sim.dropTest', 'Set up a drop test', 'physics', 'Simulate', () => app.setupDropTest(), { keywords: 'gravity fall physics' });
  add('sim.motor', 'Add a spin motor', 'motor', 'Simulate', () => app.addMotor(), { enabled: oneSel, keywords: 'mechanism rotate gear' });
  add('sim.bake', 'Bake dynamics to keyframes', 'bake', 'Simulate', () => app.bakeDynamics(), { enabled: () => store.doc.sim.dynamics.enabled });
  add('sim.record', 'Record to video', 'record', 'Simulate', () => app.recordVideo(), { keywords: 'webm export movie capture' });

  /* ==================================================== Window */

  add('win.left', 'Outline panel', 'panel-left', 'Window', () => app.togglePanel('left'), { key: 'T', checked: () => !app.isCollapsed('left') });
  add('win.right', 'Properties panel', 'panel-right', 'Window', () => app.togglePanel('right'), { key: 'N', checked: () => !app.isCollapsed('right') });
  add('win.timeline', 'Timeline', 'timeline', 'Window', () => app.togglePanel('timeline'), { checked: () => !document.getElementById('timeline').hidden });
  add('win.zen', 'Zen mode (hide all panels)', 'fullscreen', 'Window', () => app.zenMode(), { key: 'Ctrl ⇧ Z' });
  add('win.reset', 'Reset layout', 'refresh', 'Window', () => app.resetLayout());
  for (const [ws, label, ic] of [['model', 'Model workspace', 'cube3d'], ['draft', 'Draft workspace', 'sketch'], ['sim', 'Simulate workspace', 'timeline']]) {
    add(`ws.${ws}`, label, ic, 'Window', () => app.setWorkspace(ws), { checked: () => app.workspace === ws });
  }

  /* ==================================================== Help */

  add('help.palette', 'Command palette', 'command', 'Help', () => app.openPalette(), { key: 'Ctrl K', keywords: 'search find run' });
  add('help.quickstart', 'Quick start', 'bulb', 'Help', () => app.showWelcome(), { keywords: 'tutorial intro guide getting started' });
  add('help.shortcuts', 'Keyboard shortcuts', 'keyboard', 'Help', () => app.showShortcuts(), { key: 'F1' });
  add('help.expressions', 'Expression reference', 'book', 'Help', () => app.showExpressionHelp(), { keywords: 'parameters formula math functions' });
  add('help.learn', 'Show the learning card', 'bulb', 'Help', () => app.toggleLearn(), { checked: () => !document.getElementById('learnCard').hidden });
  add('help.guide', 'User guide (opens GitHub)', 'book', 'Help', () => app.openLink('https://github.com/samuelhtampubolon/TesserCAD/blob/main/docs/USER-GUIDE.md'));
  add('help.source', 'Source code', 'github', 'Help', () => app.openLink('https://github.com/samuelhtampubolon/TesserCAD'));
  add('help.issue', 'Report a problem', 'warning', 'Help', () => app.openLink('https://github.com/samuelhtampubolon/TesserCAD/issues/new'));
  add('help.about', 'About TesserCAD', 'info', 'Help', () => app.showAbout());

  /* ---------------------------------------------------------------- studio
     The design-intelligence commands. They sit in their own group so the
     menu, the palette and the shortcut sheet all pick them up automatically:
     adding a command here is the only registration step there is. */
  const built = () => !!app.build;

  add('studio.brief', 'New from a design brief…', 'bulb', 'Studio', () => app.showBrief(), {
    keywords: 'requirements load generate size calculate bracket shaft plate intent',
  });
  add('studio.doctor', 'Design doctor', 'probe', 'Studio', () => app.showDoctorReport(), {
    key: 'F8', enabled: built, keywords: 'check validate dfm manufacturability review problems',
  });
  add('studio.cost', 'Cost estimate', 'gauge', 'Studio', () => app.showCostReport(), {
    enabled: built, keywords: 'price money process compare cnc print mould economics',
  });
  add('release.package', 'Release design…', 'download', 'Studio', () => app.showRelease(), {
    key: 'Ctrl ⇧ R', enabled: built, keywords: 'package deliverables zip ship handoff bom drawing',
  });
  add('studio.intent', 'Export design intent', 'file-export', 'Studio', () => app.exportDesignIntent(), {
    enabled: built, keywords: 'json parameters handoff interoperability semantic',
  });
  add('macro.record', 'Record a macro', 'record', 'Studio', () => app.startMacro(), {
    enabled: () => !app.macro.isRecording, keywords: 'automate repeat workflow script',
  });
  add('macro.stop', 'Stop recording', 'stop', 'Studio', () => app.stopMacro(), {
    enabled: () => app.macro.isRecording,
  });
  add('macro.manage', 'Macros…', 'sequence', 'Studio', () => app.showMacros(), {
    keywords: 'automation replay recorded workflow',
  });
  add('studio.standards', 'Studio standards…', 'workspace', 'Studio', () => app.showStudio(), {
    keywords: 'defaults house organisation memory rates decisions log preferences',
  });
  add('studio.lessons', 'Engineering notes', 'book', 'Studio', () => app.showLessons(), {
    keywords: 'why learn tutor explain principles',
  });

  /* ------------------------------------------------------------- analysis */

  add('studio.section', 'Section properties…', 'section', 'Analyse', () => app.showSection(), {
    key: 'Ctrl ⇧ A', enabled: () => oneSel() && built(),
    keywords: 'second moment of area inertia bending stress beam strength modulus',
  });
  add('studio.clash', 'Clash check', 'target', 'Analyse', () => app.showClashes(), {
    enabled: built, keywords: 'interference collision overlap intersect assembly clearance',
  });
  add('studio.inspect', 'Inspect imported mesh…', 'probe', 'Analyse', () => app.showInspect(), {
    enabled: () => built() && store.doc.features.some(f => f.type === 'mesh'),
    keywords: 'recognise features holes faces measure stl step dumb solid reverse',
  });

  /* -------------------------------------------------------- configurations */

  add('cfg.manage', 'Configurations…', 'template', 'Configure', () => app.showConfigs(), {
    keywords: 'variants sizes family table catalogue options',
  });
  add('cfg.add', 'New configuration', 'plus', 'Configure', () => app.newConfiguration(), {
    keywords: 'variant size option',
  });
  add('cfg.next', 'Next configuration', 'chevron-right', 'Configure', () => app.cycleConfiguration(1), {
    enabled: () => (store.doc.configs?.list?.length || 1) > 1,
  });
  add('cfg.family', 'Export the family table', 'table', 'Configure', () => app.exportFamily(), {
    keywords: 'csv catalogue parts list variants',
  });

  /* ------------------------------------------------------------- versions */

  add('vcs.commit', 'Save a version…', 'history', 'Versions', () => app.commitVersion(), {
    key: 'Ctrl ⇧ S', keywords: 'snapshot checkpoint milestone revision commit',
  });
  add('vcs.browse', 'Version history…', 'sequence', 'Versions', () => app.showVersions(), {
    keywords: 'revisions diff compare restore branch git timeline',
  });
  add('vcs.branch', 'New branch…', 'workspace', 'Versions', () => app.newBranch(), {
    keywords: 'experiment alternative try variant fork',
  });

  add('export.quality', 'Export quality…', 'settings', 'Export', () => app.showExportQuality(), {
    keywords: 'tolerance tessellation triangles chord resolution mesh density',
  });

  /* ------------------------------------------------------- shop drawings */

  add('draw.sheet', 'Shop drawing…', 'sheet', 'Drawing', () => app.showDrawing(), {
    key: 'Ctrl ⇧ D', enabled: built,
    keywords: 'orthographic views print title block dimension hidden line first angle blueprint plan elevation',
  });
  add('draw.sheetSVG', 'Drawing to SVG', 'image', 'Drawing', () => app.exportSheet('svg'), {
    enabled: built, keywords: 'print plot paper a3 a4 vector',
  });
  add('draw.sheetDXF', 'Drawing to DXF', 'layers', 'Drawing', () => app.exportSheet('dxf'), {
    enabled: built, keywords: 'autocad cam laser plotter r12',
  });

  /* ---------------------------------------------------------- tolerances */

  add('tol.stack', 'Tolerance stack-up…', 'ruler', 'Analyse', () => app.showTolerance(), {
    enabled: built,
    keywords: 'stack chain worst case rss monte carlo cpk capability variation assembly gap fit',
  });
  add('tol.fits', 'Fits and limits…', 'target', 'Analyse', () => app.showFits(), {
    keywords: 'iso 286 h7 g6 shaft hole clearance interference press slide bearing tolerance grade',
  });

  /* --------------------------------------------------------- verification */

  add('dev.compare', 'Compare with a mesh…', 'deviation', 'Analyse', () => app.showDeviation(), {
    enabled: () => built() && store.doc.features.some(f => f.type === 'mesh'),
    keywords: 'deviation map scan supplier stl verify same part units inspect difference',
  });
  add('studio.intentIn', 'Import design intent…', 'file-import', 'Studio', () => app.pickIntent(), {
    keywords: 'round trip json parameters rebuild interoperability read back',
  });

  /* ------------------------------------------------------ design as code */

  add('spec.edit', 'Design as code…', 'code', 'Studio', () => app.showSpec(), {
    key: 'Ctrl ⇧ C',
    keywords: 'text script source edit parametric openscad diff review programmatic',
  });
  add('spec.copy', 'Copy the spec text', 'copy', 'Studio', () => app.copySpec(), {
    keywords: 'clipboard share paste review text',
  });

  /* ------------------------------------------------------- typed intent */

  add('speak.build', 'Say what you want…', 'command', 'Create', () => app.showSpeak(), {
    key: 'Ctrl ⇧ B',
    keywords: 'natural language type intent describe tell prompt copilot ai command sentence make a plate hole bolt',
  });

  add('lib.fasteners', 'Fasteners…', 'key', 'Create', () => app.showFasteners(), {
    keywords: 'bolt screw nut thread iso metric m6 m8 torque proof load clearance tapping drill washer hardware library',
  });

  add('doc.health', 'Document health…', 'probe', 'Analyse', () => app.showHygiene(), {
    keywords: 'hygiene weight size proxy far origin coordinates precision duplicate dedup empty degenerate crash bloat heavy',
  });
  add('app.ownership', 'Offline and ownership…', 'lock', 'Help', () => app.showOwnership(), {
    keywords: 'offline install perpetual subscription privacy telemetry account licence phone home local storage data',
  });

  /* ---------------------------------------------------------- merge */

  add('vcs.merge', 'Merge a branch…', 'merge', 'Versions', () => app.showMerge(), {
    enabled: () => VCSBranchCount() > 1,
    keywords: 'three way conflict combine branch bring in resolve',
  });

  return C;
}

/** Per-primitive icons, so the Create menu reads as shapes rather than words. */
export const ICON_FOR = {
  box: 'box', cylinder: 'cylinder', sphere: 'sphere', cone: 'cone', torus: 'torus',
  tube: 'tube', wedge: 'wedge', prism: 'prism', pyramid: 'pyramid', plate: 'plate',
  helix: 'helix', mesh: 'mesh', extrude: 'extrude', revolve: 'revolve',
  boolean: 'union', patternLinear: 'pattern-linear', patternCircular: 'pattern-circular', mirror: 'mirror',
};

/* ------------------------------------------------------------ templates */

/** Starter documents — every one is a real, buildable model. */
export const TEMPLATES = [
  {
    id: 'blank', name: 'Blank document', icon: 'file-new',
    blurb: 'An empty model with millimetres and one example parameter.',
    build: () => newDocument('Untitled'),
  },
  {
    id: 'plate', name: 'Bolted plate', icon: 'plate',
    blurb: 'A rounded plate with a parametric bolt pattern — good for brackets.',
    build: () => app_plate(),
  },
  {
    id: 'flange', name: 'Flanged pipe', icon: 'tube',
    blurb: 'Two flanges on a tube with a ring of bolt holes.',
    build: () => app_flange(),
  },
  {
    id: 'enclosure', name: 'Enclosure shell', icon: 'box',
    blurb: 'A hollow box with a lid lip — the start of any electronics case.',
    build: () => app_enclosure(),
  },
  {
    id: 'shaft', name: 'Stepped shaft', icon: 'cylinder',
    blurb: 'Three concentric diameters, driven by one length parameter.',
    build: () => app_shaft(),
  },
  {
    id: 'tower', name: '4D build sequence', icon: 'sequence',
    blurb: 'A stack of floors pre-sequenced on the timeline — press play.',
    build: () => app_tower(),
  },
];

/* The template builders live here rather than in main.js so the catalogue and
   its contents stay in one file. Each returns a complete document. */

function baseDoc(name, params) {
  const doc = newDocument(name);
  doc.params = params.map((p, i) => ({ id: `p${i}${Math.random().toString(36).slice(2, 6)}`, name: p[0], value: p[1], note: p[2] || '' }));
  return doc;
}

function mk(type, over) {
  const { makeFeature } = mkDeps;
  return makeFeature(type, over);
}
const mkDeps = {};
export function registerFeatureFactory(makeFeature) { mkDeps.makeFeature = makeFeature; }

function app_plate() {
  const doc = baseDoc('Bolted plate', [['plate_w', 140, 'Overall width'], ['plate_d', 90, 'Overall depth'], ['thick', 10, 'Thickness'], ['bolt_r', 5.5, 'Bolt hole radius'], ['inset', 16, 'Hole inset from the edge']]);
  const plate = mk('plate', { name: 'Plate', material: 'aluminium', params: { w: 'plate_w', d: 'plate_d', h: 'thick', fillet: 14, hole: 0, seg: 12 }, pos: [0, 0, 'thick/2'] });
  const hole = mk('cylinder', { name: 'Bolt hole', params: { r: 'bolt_r', h: 'thick*3', seg: 32, arc: 360 }, pos: ['plate_w/2 - inset', 'plate_d/2 - inset', 'thick/2'] });
  const pat = mk('patternLinear', { name: 'Bolt pattern', params: { dx: '-(plate_w - inset*2)', dy: 0, dz: 0, count: 2, dx2: 0, dy2: '-(plate_d - inset*2)', dz2: 0, count2: 2 }, inputs: [hole.id] });
  const cut = mk('boolean', { name: 'Bolted plate', material: 'aluminium', params: { op: 'subtract' }, inputs: [plate.id, pat.id] });
  doc.features = [plate, hole, pat, cut];
  return doc;
}

function app_flange() {
  const doc = baseDoc('Flanged pipe', [['bore', 32, 'Inside diameter/2'], ['wall', 6, 'Pipe wall'], ['len', 190, 'Overall length'], ['flange_r', 58, 'Flange radius'], ['bolts', 6, 'Bolt count']]);
  const pipe = mk('tube', { name: 'Pipe', material: 'stainless', params: { ro: 'bore + wall', ri: 'bore', h: 'len', seg: 40 }, pos: [0, 0, 'len/2'] });
  const f1 = mk('cylinder', { name: 'Flange bottom', material: 'stainless', params: { r: 'flange_r', h: 12, seg: 40, arc: 360 }, pos: [0, 0, 6] });
  const f2 = mk('cylinder', { name: 'Flange top', material: 'stainless', params: { r: 'flange_r', h: 12, seg: 40, arc: 360 }, pos: [0, 0, 'len - 6'] });
  const join = mk('boolean', { name: 'Body', material: 'stainless', params: { op: 'union' }, inputs: [pipe.id, f1.id, f2.id] });
  const drill = mk('cylinder', { name: 'Bore', params: { r: 'bore', h: 'len*1.2', seg: 40, arc: 360 }, pos: [0, 0, 'len/2'] });
  const bolt = mk('cylinder', { name: 'Bolt hole', params: { r: 5, h: 40, seg: 16, arc: 360 }, pos: ['flange_r - 14', 0, 6] });
  const ring = mk('patternCircular', { name: 'Bolt ring', params: { axis: 'z', cx: 0, cy: 0, cz: 0, count: 'bolts', angle: 360, rotate: true }, inputs: [bolt.id] });
  const bolt2 = mk('cylinder', { name: 'Bolt hole top', params: { r: 5, h: 40, seg: 16, arc: 360 }, pos: ['flange_r - 14', 0, 'len - 6'] });
  const ring2 = mk('patternCircular', { name: 'Bolt ring top', params: { axis: 'z', cx: 0, cy: 0, cz: 0, count: 'bolts', angle: 360, rotate: true }, inputs: [bolt2.id] });
  const cut = mk('boolean', { name: 'Flanged pipe', material: 'stainless', params: { op: 'subtract' }, inputs: [join.id, drill.id, ring.id, ring2.id] });
  doc.features = [pipe, f1, f2, join, drill, bolt, ring, bolt2, ring2, cut];
  return doc;
}

function app_enclosure() {
  const doc = baseDoc('Enclosure shell', [['w', 120, 'Width'], ['d', 80, 'Depth'], ['h', 45, 'Height'], ['wall', 2.5, 'Wall thickness']]);
  const outer = mk('plate', { name: 'Outer', material: 'abs', params: { w: 'w', d: 'd', h: 'h', fillet: 8, hole: 0, seg: 10 }, pos: [0, 0, 'h/2'] });
  const inner = mk('plate', { name: 'Cavity', params: { w: 'w - wall*2', d: 'd - wall*2', h: 'h', fillet: 'max(1, 8 - wall)', hole: 0, seg: 10 }, pos: [0, 0, 'h/2 + wall'] });
  const shell = mk('boolean', { name: 'Shell', material: 'abs', params: { op: 'subtract' }, inputs: [outer.id, inner.id] });
  doc.features = [outer, inner, shell];
  return doc;
}

function app_shaft() {
  const doc = baseDoc('Stepped shaft', [['d1', 20, 'Large diameter/2'], ['d2', 14, 'Middle diameter/2'], ['d3', 9, 'Small diameter/2'], ['seg_len', 45, 'Length of each step']]);
  const a = mk('cylinder', { name: 'Step 1', material: 'steel', params: { r: 'd1', h: 'seg_len', seg: 48, arc: 360 }, pos: [0, 0, 'seg_len/2'] });
  const b = mk('cylinder', { name: 'Step 2', material: 'steel', params: { r: 'd2', h: 'seg_len', seg: 48, arc: 360 }, pos: [0, 0, 'seg_len*1.5'] });
  const c = mk('cylinder', { name: 'Step 3', material: 'steel', params: { r: 'd3', h: 'seg_len', seg: 48, arc: 360 }, pos: [0, 0, 'seg_len*2.5'] });
  const u = mk('boolean', { name: 'Shaft', material: 'steel', params: { op: 'union' }, inputs: [a.id, b.id, c.id] });
  doc.features = [a, b, c, u];
  return doc;
}

function app_tower() {
  const doc = baseDoc('4D build sequence', [['floor_h', 30, 'Floor height'], ['floors', 6, 'Number of floors']]);
  const slab = mk('box', { name: 'Foundation', material: 'concrete', params: { w: 140, d: 100, h: 14 }, pos: [0, 0, 7] });
  const floor = mk('box', { name: 'Floor', material: 'concrete', params: { w: 120, d: 84, h: 'floor_h * 0.25' }, pos: [0, 0, 'floor_h/2 + 14'] });
  const stack = mk('patternLinear', { name: 'Floor stack', params: { dx: 0, dy: 0, dz: 'floor_h', count: 'floors', dx2: 0, dy2: 0, dz2: 0, count2: 1 }, inputs: [floor.id] });
  const col = mk('cylinder', { name: 'Column', material: 'steel', params: { r: 4, h: 'floor_h * floors', seg: 20, arc: 360 }, pos: [52, 34, 'floor_h*floors/2 + 14'] });
  const cols = mk('patternLinear', { name: 'Columns', params: { dx: -104, dy: 0, dz: 0, count: 2, dx2: 0, dy2: -68, dz2: 0, count2: 2 }, inputs: [col.id] });
  doc.features = [slab, floor, stack, col, cols];
  doc.sim.duration = 12;
  doc.sim.schedule.enabled = true;
  doc.sim.schedule.items[slab.id] = { start: 0, dur: 1.4, mode: 'build', enabled: true };
  doc.sim.schedule.items[stack.id] = { start: 1.6, dur: 4.5, mode: 'riseZ', enabled: true };
  doc.sim.schedule.items[cols.id] = { start: 6.4, dur: 3, mode: 'build', enabled: true };
  return doc;
}

export { UNITS, MATERIALS };
