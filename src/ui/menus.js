/**
 * Menu bar and ribbon layouts.
 *
 * Both are pure descriptions built fresh each time they open, so toggle
 * checkmarks and enabled states are always live. Nothing here holds state.
 */
import { CATALOG, MATERIALS, store } from '../core/doc.js';
import { ICON_FOR, TEMPLATES } from './commands.js';

const solids = () => Object.entries(CATALOG).filter(([, c]) => c.group === 'solid');

/**
 * @param {object} app
 * @param {(id:string)=>object} c  command lookup that resolves checked/enabled
 */
export function menuDefs(app, c) {
  return [
    ['File', () => [
      c('file.new'), {
        label: 'New from template', icon: 'template',
        sub: TEMPLATES.map(t => ({ label: t.name, icon: t.icon, run: () => app.applyTemplate(t) })),
      },
      '-',
      c('file.open'), c('file.save'), c('file.saveAs'),
      '-',
      { header: 'Bring in' },
      c('file.import'),
      { label: 'Import format', icon: 'file-import', sub: [
        { label: 'STL mesh…', icon: 'cube3d', run: () => app.pickFile('.stl') },
        { label: 'OBJ mesh…', icon: 'mesh', run: () => app.pickFile('.obj') },
        { label: 'DXF drawing…', icon: 'layers', run: () => app.pickFile('.dxf') },
        { label: 'TesserCAD project…', icon: 'file-open', run: () => app.pickFile('.tcad,.json') },
      ] },
      '-',
      c('file.props'), c('file.sample'), c('file.autosave'), c('file.revert'),
      '-',
      c('file.clearAutosave'),
    ]],

    ['Edit', () => [
      c('edit.undo'), c('edit.redo'), c('edit.history'),
      '-',
      c('edit.duplicate'), c('edit.rename'), c('edit.delete'),
      '-',
      { header: 'Select' },
      c('edit.selectAll'), c('edit.selectNone'), c('edit.selectInvert'), c('edit.selectSameType'),
      '-',
      c('edit.prefs'),
    ]],

    ['Create', () => [
      { header: 'Solids' },
      ...solids().slice(0, 6).map(([t]) => c(`add.${t}`)),
      { label: 'More solids', icon: 'workspace', sub: solids().slice(6).map(([t]) => c(`add.${t}`)) },
      '-',
      { header: 'From a drawing' },
      c('sketch.extrude'), c('sketch.revolve'),
      '-',
      c('add.import'),
    ]],

    ['Modify', () => [
      { header: 'Combine' },
      c('bool.union'), c('bool.subtract'), c('bool.intersect'),
      '-',
      { header: 'Repeat' },
      c('mod.linear'), c('mod.circular'), c('mod.mirror'),
      '-',
      { header: 'Transform' },
      c('op.move'), c('op.rotate'), c('op.scale'),
      { label: 'Gizmo', icon: 'move', sub: [c('gizmo.translate'), c('gizmo.rotate'), c('gizmo.scale'), '-', c('gizmo.off')] },
      { label: 'Align', icon: 'align', sub: [c('xf.alignX'), c('xf.alignY'), c('xf.alignZ'), '-', c('xf.distribute')] },
      c('xf.drop'), c('xf.centre'), c('xf.reset'),
      '-',
      { header: 'Appearance' },
      { label: 'Material', icon: 'palette', sub: Object.entries(MATERIALS).map(([k, m]) => ({
        label: m.name, icon: 'palette', run: () => app.setMaterial(k),
        disabled: app.selection.size === 0,
      })) },
      c('mod.colour'),
      '-',
      c('mod.hide'), c('mod.isolate'), c('mod.showAll'), c('mod.suppress'),
    ]],

    ['View', () => [
      c('view.fit'), c('view.selection'), c('view.zoomIn'), c('view.zoomOut'),
      '-',
      { label: 'Standard views', icon: 'view-iso', sub: [
        c('view.iso'), '-', c('view.front'), c('view.back'), c('view.left'), c('view.right'), c('view.top'), c('view.bottom'),
      ] },
      c('view.ortho'),
      '-',
      { header: 'Display' },
      { label: 'Shading', icon: 'shade-solid', sub: [
        c('shade.shaded-edges'), c('shade.shaded'), c('shade.wire'), c('shade.xray'),
      ] },
      { label: 'Background', icon: 'image', sub: [c('bg.studio'), c('bg.graphite'), c('bg.white'), c('bg.blueprint')] },
      c('view.grid'), c('view.axes'), c('view.ground'), c('view.section'),
      '-',
      c('view.theme'), c('view.fullscreen'),
    ]],

    ['Measure', () => [
      c('measure.distance'), c('measure.angle'), c('measure.point'),
      '-',
      c('measure.mass'), c('export.bom'),
      '-',
      c('measure.off'),
    ]],

    ['Draft', () => [
      { header: 'Draw' },
      c('draft.line'), c('draft.polyline'), c('draft.rect'), c('draft.circle'), c('draft.arc'),
      { label: 'More shapes', icon: 'polygon', sub: [c('draft.ellipse'), c('draft.polygon'), c('draft.spline'), c('draft.point'), c('draft.text')] },
      '-',
      { label: 'Dimensions', icon: 'dim-linear', sub: [c('draft.dimLinear'), c('draft.dimAligned'), c('draft.dimRadial'), c('draft.dimAngular')] },
      c('draft.offset'), c('draft.measure'),
      '-',
      { header: 'Drafting aids' },
      c('draft.snap'), c('draft.ortho'), c('draft.polar'), c('draft.gridSnap'),
      '-',
      { label: 'Modify', icon: 'rotate', sub: [c('draft.rotate90'), c('draft.mirrorX'), c('draft.mirrorY')] },
      c('draft.addLayer'), c('draft.zoomExtents'),
      '-',
      c('sketch.extrude'), c('sketch.revolve'),
    ]],

    ['Simulate', () => [
      c('sim.play'), c('sim.stop'),
      { label: 'Go to', icon: 'timeline', sub: [c('sim.rewind'), c('sim.end'), '-', c('sim.stepBack'), c('sim.stepFwd')] },
      c('sim.loop'),
      '-',
      { header: 'Animate' },
      c('sim.key'), c('sim.clearKeys'),
      '-',
      { header: '4D build sequence' },
      c('sim.schedule'), c('sim.autoSchedule'), c('sim.clearSchedule'),
      '-',
      { header: 'Physics' },
      c('sim.physics'), c('sim.dropTest'), c('sim.motor'), c('sim.bake'),
      '-',
      c('sim.record'),
    ]],

    ['Export', () => [
      c('export.quality'),
      '-',
      { header: '3D' },
      c('export.stl'), c('export.stlAscii'), c('export.obj'), c('export.glb'), c('export.gltf'), c('export.ply'),
      '-',
      { header: '2D drawing' },
      c('export.dxf'), c('export.svg'),
      '-',
      { header: 'Images and data' },
      { label: 'Viewport image', icon: 'image', sub: [c('export.png1'), c('export.png'), c('export.png4')] },
      c('export.bom'), c('export.report'),
      '-',
      c('sim.record'),
    ]],

    ['Window', () => [
      c('win.left'), c('win.right'), c('win.timeline'),
      '-',
      c('win.zen'), c('win.reset'),
      '-',
      { header: 'Workspace' },
      c('ws.model'), c('ws.draft'), c('ws.sim'),
    ]],

    ['Studio', () => [
      { header: 'Start from a requirement' },
      c('studio.brief'), c('speak.build'), c('lib.fasteners'),
      '-',
      { header: 'Check and cost' },
      c('studio.doctor'), c('studio.cost'),
      '-',
      { header: 'Draw' },
      c('draw.sheet'), c('draw.sheetSVG'), c('draw.sheetDXF'),
      '-',
      { header: 'Ship' },
      c('release.package'), c('studio.intent'), c('studio.intentIn'),
      '-',
      { header: 'Text' },
      c('spec.edit'), c('spec.copy'),
      '-',
      { header: 'Automate' },
      c('macro.record'), c('macro.stop'), c('macro.manage'),
      '-',
      c('studio.standards'), c('studio.lessons'),
    ]],

    ['Analyse', () => [
      { header: 'Strength' },
      c('studio.section'),
      '-',
      { header: 'Fit' },
      c('studio.clash'), c('tol.stack'), c('tol.fits'),
      '-',
      { header: 'Imported geometry' },
      c('studio.inspect'), c('dev.compare'),
      '-',
      { header: 'Variants' },
      c('cfg.manage'), c('cfg.add'), c('cfg.next'), c('cfg.family'),
      '-',
      { header: 'Versions' },
      c('vcs.commit'), c('vcs.browse'), c('vcs.branch'), c('vcs.merge'),
    ]],

    ['Help', () => [
      c('help.palette'), c('help.quickstart'), c('help.shortcuts'), c('help.expressions'),
      '-',
      c('help.learn'), c('help.guide'),
      '-',
      c('help.source'), c('help.issue'),
      '-',
      c('help.about'),
    ]],
  ];
}

/**
 * Ribbon layout per workspace.
 * A group is { label, items } where an item is a command id, or
 * { stack: [ids] } for a vertical pair, or { custom: 'name' } for a widget
 * main.js renders itself.
 */
export function ribbonDefs(app) {
  const isDraft = app.workspace === 'draft';
  const isSim = app.workspace === 'sim';

  if (isDraft) {
    return [
      { label: 'Draw', items: ['draft.select', 'draft.line', 'draft.polyline', 'draft.rect', 'draft.circle', 'draft.arc', 'draft.ellipse', 'draft.polygon', 'draft.spline'] },
      { label: 'Annotate', items: ['draft.text', 'draft.dimLinear', 'draft.dimAligned', 'draft.dimRadial', 'draft.dimAngular'] },
      { label: 'Modify', items: ['draft.offset', 'edit.duplicate', 'draft.rotate90', 'draft.mirrorX', 'edit.delete'] },
      { label: 'Precision', items: ['draft.snap', 'draft.ortho', 'draft.polar', 'draft.gridSnap', 'draft.measure'] },
      { label: 'To 3D', items: ['sketch.extrude', 'sketch.revolve'] },
      { label: 'View', items: ['draft.zoomExtents', 'view.grid', 'view.theme'] },
      { label: 'Layers', items: [{ custom: 'layerPicker' }] },
      { label: 'Output', items: ['export.dxf', 'export.svg'] },
      { label: 'Studio', items: ['studio.doctor', 'release.package'] },
    ];
  }

  if (isSim) {
    return [
      { label: 'Playback', items: ['sim.rewind', 'sim.stepBack', 'sim.play', 'sim.stepFwd', 'sim.end', 'sim.stop', 'sim.loop'] },
      { label: 'Animate', items: ['sim.key', 'sim.clearKeys'] },
      { label: '4D sequence', items: ['sim.schedule', 'sim.autoSchedule', 'sim.clearSchedule'] },
      { label: 'Physics', items: ['sim.physics', 'sim.dropTest', 'sim.motor', 'sim.bake'] },
      { label: 'Speed', items: [{ custom: 'speedPicker' }] },
      { label: 'Output', items: ['sim.record', 'export.png'] },
      { label: 'View', items: ['view.fit', 'view.shadingCycle', 'view.ortho'] },
      { label: 'Studio', items: ['studio.doctor', 'release.package'] },
    ];
  }

  return [
    { label: 'Create', items: solids().slice(0, 8).map(([t]) => `add.${t}`).concat([{ custom: 'moreSolids' }]) },
    { label: 'From drawing', items: ['sketch.extrude', 'sketch.revolve'] },
    { label: 'Combine', items: ['bool.union', 'bool.subtract', 'bool.intersect'] },
    { label: 'Repeat', items: ['mod.linear', 'mod.circular', 'mod.mirror'] },
    { label: 'Transform', items: ['op.move', 'op.rotate', 'op.scale', 'xf.drop'] },
    { label: 'Organise', items: ['mod.hide', 'mod.isolate', 'mod.showAll', 'mod.material'] },
    { label: 'Measure', items: ['measure.distance', 'measure.angle', 'measure.mass'] },
    { label: 'View', items: ['view.fit', 'view.shadingCycle', 'view.ortho', 'view.section'] },
    { label: 'Studio', items: ['studio.brief', 'studio.doctor', 'studio.cost', 'release.package'] },
    { label: 'Analyse', items: ['studio.section', 'studio.clash', 'tol.stack', 'cfg.manage', 'vcs.commit', 'vcs.browse'] },
    { label: 'Drawing', items: ['draw.sheet', 'spec.edit', 'vcs.merge'] },
    { label: 'Intent', items: ['speak.build', 'lib.fasteners'] },
  ];
}

/** The eight commands on the Q quick menu, resolved per workspace. */
export function quickDefaults(app) {
  if (app.workspace === 'draft') {
    return ['draft.line', 'draft.rect', 'draft.circle', 'draft.dimLinear', 'draft.offset', 'draft.snap', 'sketch.extrude', 'draft.zoomExtents'];
  }
  if (app.workspace === 'sim') {
    return ['sim.play', 'sim.key', 'sim.autoSchedule', 'sim.dropTest', 'sim.physics', 'sim.bake', 'sim.record', 'view.fit'];
  }
  return ['add.box', 'add.cylinder', 'bool.subtract', 'mod.linear', 'op.move', 'mod.isolate', 'view.fit', 'measure.distance'];
}

/** Right-click menu inside the 3D viewport. */
export function viewportContextMenu(app, c, hitId) {
  const sel = app.selection.size;
  if (!hitId && !sel) {
    return [
      { header: 'Viewport' },
      c('view.fit'), c('view.shadingCycle'), c('view.ortho'), c('view.section'),
      '-',
      c('edit.selectAll'), c('help.palette'),
    ];
  }
  return [
    { header: store.feature(hitId)?.name || `${sel} selected` },
    c('op.move'), c('op.rotate'), c('op.scale'),
    '-',
    c('edit.duplicate'), c('edit.rename'), c('mod.isolate'), c('mod.hide'),
    '-',
    c('bool.union'), c('bool.subtract'), c('mod.linear'), c('mod.circular'), c('mod.mirror'),
    '-',
    { label: 'Material', icon: 'palette', sub: Object.entries(MATERIALS).map(([k, m]) => ({ label: m.name, run: () => app.setMaterial(k) })) },
    c('xf.drop'), c('view.selection'),
    '-',
    c('edit.delete'),
  ];
}

/**
 * Short labels for the ribbon. A ribbon button is ~46px wide, so anything
 * longer than about nine characters wraps or clips; the full label still
 * shows in the tooltip, the menus and the palette.
 */
export const SHORT_LABEL = {
  'add.cone': 'Cone', 'add.tube': 'Tube', 'add.helix': 'Helix', 'add.plate': 'Plate',
  'sketch.extrude': 'Extrude', 'sketch.revolve': 'Revolve',
  'bool.union': 'Union', 'bool.subtract': 'Subtract', 'bool.intersect': 'Common',
  'mod.linear': 'Linear', 'mod.circular': 'Circular', 'mod.mirror': 'Mirror',
  'mod.hide': 'Hide', 'mod.isolate': 'Isolate', 'mod.showAll': 'Show all', 'mod.material': 'Material',
  'op.move': 'Move', 'op.rotate': 'Rotate', 'op.scale': 'Scale', 'xf.drop': 'Drop',
  'measure.distance': 'Distance', 'measure.angle': 'Angle', 'measure.mass': 'Mass',
  'view.fit': 'Fit', 'view.shadingCycle': 'Shading', 'view.ortho': 'Ortho', 'view.section': 'Section',
  'edit.duplicate': 'Copy', 'edit.delete': 'Delete',
  'export.dxf': 'DXF', 'export.svg': 'SVG', 'export.png': 'PNG',
  'draft.select': 'Select', 'draft.polyline': 'Polyline', 'draft.rect': 'Rect',
  'draft.dimLinear': 'Linear', 'draft.dimAligned': 'Aligned', 'draft.dimRadial': 'Radius', 'draft.dimAngular': 'Angle',
  'draft.offset': 'Offset', 'draft.snap': 'Snap', 'draft.ortho': 'Ortho', 'draft.polar': 'Polar',
  'draft.gridSnap': 'Grid', 'draft.zoomExtents': 'Fit', 'draft.measure': 'Measure',
  'draft.rotate90': 'Rotate', 'draft.mirrorX': 'Mirror', 'draft.addLayer': 'Layer',
  'sim.play': 'Play', 'sim.stop': 'Stop', 'sim.rewind': 'Start', 'sim.end': 'End',
  'sim.stepBack': 'Prev', 'sim.stepFwd': 'Next', 'sim.loop': 'Loop',
  'sim.key': 'Key pose', 'sim.clearKeys': 'Clear', 'sim.schedule': 'Sequencing',
  'sim.autoSchedule': 'Sequence', 'sim.clearSchedule': 'Clear', 'sim.physics': 'Physics',
  'sim.dropTest': 'Drop test', 'sim.motor': 'Motor', 'sim.bake': 'Bake', 'sim.record': 'Record',
  'studio.brief': 'Brief', 'studio.doctor': 'Doctor', 'studio.cost': 'Cost',
  'studio.section': 'Section', 'studio.clash': 'Clash', 'studio.inspect': 'Inspect',
  'cfg.manage': 'Variants', 'cfg.add': 'New variant', 'cfg.next': 'Next', 'cfg.family': 'Family',
  'vcs.commit': 'Save version', 'vcs.browse': 'History', 'vcs.branch': 'Branch',
  'export.quality': 'Quality',
  'release.package': 'Release', 'studio.intent': 'Intent', 'studio.standards': 'Standards',
  'macro.record': 'Record', 'macro.stop': 'Stop', 'macro.manage': 'Macros', 'studio.lessons': 'Notes',
};

/** Menu-bar labels to icons, for the compact single-button menu on a tablet. */
export const MENU_ICON = {
  File: 'file-new', Edit: 'undo', Create: 'box', Modify: 'union', View: 'view-iso',
  Measure: 'ruler', Draft: 'sketch', Simulate: 'timeline', Export: 'file-export',
  Window: 'panel-left', Studio: 'workspace', Analyse: 'probe', Drawing: 'sheet', Help: 'help',
};

export { ICON_FOR };
