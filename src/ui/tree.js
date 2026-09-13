/**
 * Left panel: the feature tree (Model / Simulate) and the layer list (Draft).
 *
 * The tree is the model's history, in build order, with a live filter and
 * drag-to-reorder. Consumed features stay visible but dimmed — that is what
 * makes a feature history editable rather than a one-way pipeline.
 */
import { el, clear, promptDialog, icon, emptyState, contextMenu, verb } from './shell.js';
import { attachLongPress } from './mobile.js';
import { store, catalogOf, MATERIALS } from '../core/doc.js';
import { ICON_FOR } from './commands.js';

let filterText = '';

export function renderLeftPanel(app) {
  const host = clear(document.getElementById('leftBody'));
  const title = document.getElementById('leftTitle');
  if (app.workspace === 'draft') {
    title.textContent = 'Layers & objects';
    renderLayers(app, host);
  } else {
    title.textContent = app.workspace === 'sim' ? 'Bodies' : 'Feature tree';
    renderFeatures(app, host);
  }
}

/* ------------------------------------------------------------- features */

function renderFeatures(app, host) {
  const doc = store.doc;

  if (!doc.features.length) {
    host.appendChild(emptyState('No features yet', verb(
      'Add a solid from the <b>Create</b> group, draw a profile in <b>Draft</b> and extrude it, or drop an STL onto the viewport.',
      'Tap a shape in the toolbar above, or start from a template.',
    ), 'cube3d'));
    host.appendChild(el('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
      el('button', { class: 'btn sm', onclick: () => app.run('add.box') }, [icon('box', { size: 14 }), 'Add a box']),
      el('button', { class: 'btn sm', onclick: () => app.run('file.template') }, [icon('template', { size: 14 }), 'Templates']),
    ]));
    return;
  }

  /* filter + bulk actions */
  const search = el('input', { type: 'search', placeholder: 'Filter features…', value: filterText, spellcheck: 'false' });
  search.addEventListener('input', () => { filterText = search.value; renderLeftPanel(app); });
  host.appendChild(el('div', { class: 'tree-tools' }, [
    el('div', { class: 'tree-search' }, [icon('search', { size: 13 }), search]),
    el('button', {
      class: 'mini-btn', title: 'Tree actions',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        contextMenu(r.left, r.bottom + 4, [
          app.menuItem('edit.selectAll'), app.menuItem('edit.selectNone'), app.menuItem('edit.selectInvert'),
          '-', app.menuItem('mod.showAll'), app.menuItem('mod.isolate'),
          '-', app.menuItem('export.report'),
        ]);
      },
    }, [icon('dots', { size: 14 })]),
  ]));

  const q = filterText.trim().toLowerCase();
  const consumed = store.consumedIds();
  const build = app.build;
  let shown = 0;

  for (const f of doc.features) {
    if (q && !`${f.name} ${f.type}`.toLowerCase().includes(q)) continue;
    shown++;
    const res = build?.results.get(f.id);
    const isConsumed = consumed.has(f.id);
    const cat = catalogOf(f.type);
    const hiddenByIsolate = app.isolated && !app.isolated.has(f.id);

    const node = el('div', {
      class: [
        'tree-node',
        app.selection.has(f.id) ? 'selected' : '',
        isConsumed ? 'consumed' : '',
        f.suppressed ? 'suppressed' : '',
        res?.error ? 'errored' : '',
        (f.visible === false || hiddenByIsolate) ? 'hidden-body' : '',
      ].filter(Boolean).join(' '),
      draggable: 'true',
      title: res?.error ? res.error : `${cat.label}${isConsumed ? ' — consumed by a later feature' : ''}`,
      dataset: { id: f.id },
      onclick: (e) => app.select([f.id], e.shiftKey || e.ctrlKey || e.metaKey),
      ondblclick: () => renameFeature(app, f),
      oncontextmenu: (e) => {
        e.preventDefault();
        if (!app.selection.has(f.id)) app.select([f.id]);
        contextMenu(e.clientX, e.clientY, [
          { header: f.name },
          app.menuItem('edit.rename'), app.menuItem('edit.duplicate'), app.menuItem('mod.isolate'), app.menuItem('mod.suppress'),
          '-',
          app.menuItem('bool.union'), app.menuItem('bool.subtract'), app.menuItem('mod.linear'), app.menuItem('mod.mirror'),
          '-',
          { label: 'Material', icon: 'palette', sub: Object.entries(MATERIALS).map(([k, m]) => ({ label: m.name, run: () => app.setMaterial(k) })) },
          app.menuItem('view.selection'),
          '-',
          app.menuItem('edit.delete'),
        ]);
      },
    });

    node.append(...[
      el('span', { class: 'tn-glyph' }, [icon(res?.error ? 'warning' : (ICON_FOR[f.type] || 'box'), { size: 15 })]),
      el('span', { class: 'tn-swatch', style: { background: f.appearance.color } }),
      el('span', { class: 'tn-name', text: f.name }),
      el('span', { class: 'tn-badges' }, [
        res && !res.error && res.instances.length > 1 ? el('span', { class: 'pill', text: `×${res.instances.length}` }) : null,
        f.inputs.length ? el('span', {
          class: 'pill', text: `↰${f.inputs.length}`,
          title: `Consumes: ${f.inputs.map(i => store.feature(i)?.name || '?').join(', ')}`,
        }) : null,
      ].filter(Boolean)),
      el('button', {
        class: 'mini-btn tn-eye',
        title: f.visible === false ? 'Show' : 'Hide',
        onclick: (e) => {
          e.stopPropagation();
          store.edit('Toggle visibility', () => { const t = store.feature(f.id); t.visible = t.visible === false; }, { rebuild: false });
          app.refreshBodies();
        },
      }, [icon(f.visible === false ? 'eye-off' : 'eye', { size: 13 })]),
    ].filter(Boolean));

    bindDrag(app, node, f);
    attachLongPress(node, (e) => {
      if (!app.selection.has(f.id)) app.select([f.id]);
      node.dispatchEvent(new MouseEvent('contextmenu', { clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
    });
    host.appendChild(node);
  }

  // `text`, not `html`: filterText is whatever the user typed into the search
  // box, and emptyState's second argument is written into innerHTML. Typing a
  // tag here really did build the element — the Content-Security-Policy
  // refused the script it carried, but an injection that only a policy
  // prevents is one directive away from working, and injected markup alone is
  // enough to redress the interface. This message has no markup to lose.
  if (q && !shown) {
    host.appendChild(emptyState('No match', { text: `Nothing called “${filterText}”.` }, 'search'));
  }

  if (build) {
    const bad = [...build.results.values()].filter(r => r.error);
    if (bad.length) {
      host.appendChild(el('div', { class: 'banner err', style: { marginTop: '10px' } }, [
        icon('warning', { size: 15 }),
        el('div', {}, [el('b', { text: `${bad.length} feature${bad.length > 1 ? 's' : ''} failed to build` }), el('br'), bad[0].error]),
      ]));
    }
  }

  if (app.isolated) {
    host.appendChild(el('div', { class: 'banner info', style: { marginTop: '8px' } }, [
      icon('target', { size: 15 }),
      el('div', {}, [`Isolation is on — ${app.isolated.size} shown. `, el('a', { href: '#', text: 'Exit', onclick: (e) => { e.preventDefault(); app.isolate(); } })]),
    ]));
  }
}

function renameFeature(app, f) {
  promptDialog('Rename feature', 'Name', f.name, (v) => {
    const name = String(v || '').trim();
    if (!name) return;
    store.edit('Rename feature', () => { store.feature(f.id).name = name; }, { rebuild: false });
    app.refreshUI();
  });
}

function bindDrag(app, node, f) {
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', f.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('drag-over'); });
  node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('drag-over');
    const src = e.dataTransfer.getData('text/plain');
    if (!src || src === f.id) return;
    app.reorderFeature(src, f.id);
  });
}

/* --------------------------------------------------------------- layers */

function renderLayers(app, host) {
  const draw = store.doc.draw;

  host.appendChild(el('div', { class: 'tree-tools' }, [
    el('button', { class: 'btn sm', style: { flex: '1' }, onclick: () => app.addLayer() }, [icon('plus', { size: 13 }), 'Layer']),
    el('button', { class: 'btn sm', style: { flex: '1' }, onclick: () => app.draft.zoomExtents() }, [icon('fit', { size: 13 }), 'Fit']),
  ]));

  for (const l of draw.layers) {
    const row = el('div', {
      class: `layer-row ${draw.activeLayer === l.id ? 'active' : ''}`,
      title: `${l.name} — click to make active, double-click to rename`,
      onclick: () => {
        store.edit('Active layer', (d) => { d.draw.activeLayer = l.id; }, { rebuild: false });
        app.refreshUI();
        app.buildRibbon();
      },
    });

    const colour = el('input', { type: 'color', value: l.color, title: 'Layer colour' });
    colour.addEventListener('input', () => {
      store.quiet((d) => { const t = d.draw.layers.find(x => x.id === l.id); t.color = colour.value; });
      app.draft.invalidate();
    });
    colour.addEventListener('click', e => e.stopPropagation());

    row.append(
      el('button', {
        class: 'mini-btn', title: l.visible ? 'Hide layer' : 'Show layer',
        onclick: (e) => {
          e.stopPropagation();
          store.edit('Toggle layer', (d) => { const t = d.draw.layers.find(x => x.id === l.id); t.visible = !t.visible; });
          app.refreshUI();
        },
      }, [icon(l.visible ? 'eye' : 'eye-off', { size: 13 })]),
      el('button', {
        class: 'mini-btn', title: l.locked ? 'Unlock layer' : 'Lock layer',
        onclick: (e) => {
          e.stopPropagation();
          store.edit('Lock layer', (d) => { const t = d.draw.layers.find(x => x.id === l.id); t.locked = !t.locked; });
          app.refreshUI();
        },
      }, [icon(l.locked ? 'lock' : 'unlock', { size: 13 })]),
      colour,
      el('span', { class: 'lname', text: l.name }),
      el('span', { class: 'pill', text: String(draw.entities.filter(e => e.layer === l.id).length) }),
      el('button', {
        class: 'mini-btn', title: 'Delete layer and its objects',
        onclick: (e) => { e.stopPropagation(); app.deleteLayer(l.id); },
      }, [icon('trash', { size: 13 })]),
    );
    row.addEventListener('dblclick', () => {
      promptDialog('Rename layer', 'Name', l.name, (v) => {
        const name = String(v || '').trim();
        if (!name) return;
        store.edit('Rename layer', (d) => { d.draw.layers.find(x => x.id === l.id).name = name; });
        app.refreshUI();
      });
    });
    host.appendChild(row);
  }

  const counts = new Map();
  for (const e of draw.entities) counts.set(e.type, (counts.get(e.type) || 0) + 1);
  host.appendChild(el('div', { class: 'panel-head', style: { padding: '12px 2px 5px', borderBottom: '0' }, text: `Objects (${draw.entities.length})` }));

  if (!counts.size) {
    host.appendChild(emptyState('Empty drawing', verb(
      'Pick a tool from the ribbon and click in the viewport. Press <kbd>L</kbd> for a line.',
      'Pick a tool above, then tap in the drawing. Two fingers pan and zoom.',
    ), 'sketch'));
    return;
  }
  for (const [type, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    host.appendChild(el('div', {
      class: 'tree-node',
      onclick: () => {
        app.draft.selection = new Set(store.doc.draw.entities.filter(e => e.type === type).map(e => e.id));
        app.draft.invalidate();
        app.refreshUI();
      },
      title: `Select all ${type} objects`,
    }, [
      el('span', { class: 'tn-glyph' }, [icon(TYPE_ICON[type] || 'point', { size: 14 })]),
      el('span', { class: 'tn-name', text: type }),
      el('span', { class: 'pill', text: String(n) }),
    ]));
  }
  host.appendChild(el('div', { class: 'btn-row', style: { marginTop: '8px' } }, [
    el('button', { class: 'btn sm', text: 'Select all', onclick: () => { app.draft.selectAll(); app.refreshUI(); } }),
  ]));
}

const TYPE_ICON = {
  line: 'line', polyline: 'polyline', rect: 'rect', circle: 'circle', arc: 'arc',
  ellipse: 'ellipse', polygon: 'polygon', spline: 'spline', point: 'point',
  text: 'text', dim: 'dim-linear',
};
