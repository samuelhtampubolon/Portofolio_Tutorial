/**
 * Left panel: the feature tree (Model / Simulate) and the layer list (Draft).
 */
import { el, clear, promptDialog } from './shell.js';
import { store, catalogOf } from '../core/doc.js';
import { bus, T } from '../core/bus.js';

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
    host.appendChild(el('div', { class: 'empty-note' }, [
      el('b', { text: 'No features yet' }),
      el('span', { html: 'Add a solid from the toolbar, draw a profile in <b>Draft</b> and extrude it, or import an STL.' }),
    ]));
    return;
  }

  const consumed = store.consumedIds();
  const build = app.build;

  for (const f of doc.features) {
    const res = build?.results.get(f.id);
    const isConsumed = consumed.has(f.id);
    const cat = catalogOf(f.type);

    const node = el('div', {
      class: [
        'tree-node',
        app.selection.has(f.id) ? 'selected' : '',
        isConsumed ? 'consumed' : '',
        f.suppressed ? 'suppressed' : '',
        res?.error ? 'errored' : '',
        f.visible === false ? 'hidden-body' : '',
      ].filter(Boolean).join(' '),
      draggable: 'true',
      title: res?.error ? res.error : `${cat.label}${isConsumed ? ' — consumed by a later feature' : ''}`,
      dataset: { id: f.id },
      onclick: (e) => app.select([f.id], e.shiftKey || e.ctrlKey || e.metaKey),
      ondblclick: () => renameFeature(app, f),
    });

    node.append(...[
      el('span', { class: 'tn-glyph', text: res?.error ? '⚠' : cat.glyph }),
      el('span', { class: 'tn-swatch', style: { background: f.appearance.color } }),
      el('span', { class: 'tn-name', text: f.name }),
      res && !res.error && res.instances.length > 1
        ? el('span', { class: 'pill', text: `×${res.instances.length}` }) : null,
      f.inputs.length
        ? el('span', {
            class: 'pill',
            text: `↰${f.inputs.length}`,
            title: `Consumes: ${f.inputs.map(i => store.feature(i)?.name || '?').join(', ')}`,
          }) : null,
      el('button', {
        class: 'mini-btn tn-eye',
        text: f.visible === false ? '◌' : '◉',
        title: f.visible === false ? 'Show' : 'Hide',
        onclick: (e) => {
          e.stopPropagation();
          store.edit('Toggle visibility', () => { const t = store.feature(f.id); t.visible = t.visible === false; }, { rebuild: false });
          app.refreshBodies();
        },
      }),
    ].filter(Boolean));

    bindDrag(app, node, f);
    host.appendChild(node);

  }

  if (build) {
    const bad = [...build.results.values()].filter(r => r.error);
    if (bad.length) {
      host.appendChild(el('div', { class: 'banner err', style: { marginTop: '10px' } },
        [el('b', { text: `${bad.length} feature${bad.length > 1 ? 's' : ''} failed to build` }), el('br'), bad[0].error]));
    }
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

  host.appendChild(el('div', { class: 'btn-row', style: { marginBottom: '8px' } }, [
    el('button', { class: 'btn sm', text: '+ Layer', onclick: () => app.addLayer() }),
    el('button', { class: 'btn sm', text: 'Zoom extents', onclick: () => app.draft.zoomExtents() }),
  ]));

  for (const l of draw.layers) {
    const row = el('div', {
      class: `layer-row ${draw.activeLayer === l.id ? 'active' : ''}`,
      onclick: () => {
        store.edit('Active layer', (d) => { d.draw.activeLayer = l.id; }, { rebuild: false });
        app.refreshUI();
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
        class: 'mini-btn', text: l.visible ? '◉' : '◌', title: l.visible ? 'Hide layer' : 'Show layer',
        onclick: (e) => {
          e.stopPropagation();
          store.edit('Toggle layer', (d) => { const t = d.draw.layers.find(x => x.id === l.id); t.visible = !t.visible; });
          app.refreshUI();
        },
      }),
      el('button', {
        class: 'mini-btn', text: l.locked ? '▣' : '▢', title: l.locked ? 'Unlock layer' : 'Lock layer',
        onclick: (e) => {
          e.stopPropagation();
          store.edit('Lock layer', (d) => { const t = d.draw.layers.find(x => x.id === l.id); t.locked = !t.locked; });
          app.refreshUI();
        },
      }),
      colour,
      el('span', { class: 'lname', text: l.name }),
      el('span', { class: 'pill', text: String(draw.entities.filter(e => e.layer === l.id).length) }),
      el('button', {
        class: 'mini-btn', text: '✕', title: 'Delete layer and its objects',
        onclick: (e) => { e.stopPropagation(); app.deleteLayer(l.id); },
      }),
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
  host.appendChild(el('div', { class: 'panel-head', style: { padding: '10px 2px 6px' }, text: 'Objects' }));
  if (!counts.size) {
    host.appendChild(el('div', { class: 'empty-note' }, [
      el('b', { text: 'Empty drawing' }),
      el('span', { text: 'Pick a drawing tool above and click in the viewport.' }),
    ]));
  } else {
    for (const [type, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      host.appendChild(el('div', { class: 'tree-node' }, [
        el('span', { class: 'tn-glyph', text: '·' }),
        el('span', { class: 'tn-name', text: type }),
        el('span', { class: 'pill', text: String(n) }),
      ]));
    }
    host.appendChild(el('div', { class: 'btn-row', style: { marginTop: '8px' } }, [
      el('button', { class: 'btn sm', text: 'Select all', onclick: () => { app.draft.selectAll(); app.refreshUI(); } }),
    ]));
  }
}

bus.on(T.DRAFT_CHANGED, () => {});
