/**
 * File input/output: project save & load, mesh import/export, drawing
 * exchange and image capture. Everything happens in the browser — no file
 * ever leaves the machine.
 */
import * as THREE from 'three';
import { STLExporter } from 'three/addons/STLExporter.js';
import { OBJExporter } from 'three/addons/OBJExporter.js';
import { GLTFExporter } from 'three/addons/GLTFExporter.js';
import { STLLoader } from 'three/addons/STLLoader.js';
import { OBJLoader } from 'three/addons/OBJLoader.js';
import { bus, T } from '../core/bus.js';
import { store, makeFeature, uid, FILE_EXT, APP_NAME, APP_VERSION, migrate } from '../core/doc.js';
import { toDXF, fromDXF, toSVG } from '../draft/dxf.js';

/* ------------------------------------------------------------- download */

export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  bus.emit(T.TOAST, { msg: `Saved ${filename}`, kind: 'ok' });
}

export function safeName(base, ext) {
  const n = String(base || 'model').trim().replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '-') || 'model';
  return n.toLowerCase().endsWith(ext) ? n : n + ext;
}

/* ---------------------------------------------------------- the project */

export function saveProject() {
  const doc = store.doc;
  const payload = JSON.stringify({ ...doc, app: APP_NAME, appVersion: APP_VERSION }, null, 1);
  download(safeName(doc.meta.name, FILE_EXT), payload, 'application/json');
  store.dirty = false;
  bus.emit(T.DOC_TOUCHED, doc);
}

export async function openProjectFile(file) {
  const text = await file.text();
  const raw = JSON.parse(text);
  store.load(migrate(raw));
  bus.emit(T.TOAST, { msg: `Opened ${file.name}`, kind: 'ok' });
}

/* --------------------------------------------------- geometry gathering */

/** A flat list of world-space meshes for the visible bodies. */
export function collectMeshes(viewport) {
  const out = [];
  for (const [id, group] of viewport.bodies) {
    if (!group.visible) continue;
    const f = store.feature(id);
    group.updateMatrixWorld(true);
    for (const child of group.children) {
      if (!child.isMesh || child.userData.edge) continue;
      out.push({ mesh: child, feature: f });
    }
  }
  return out;
}

export function exportGroup(viewport) {
  const root = new THREE.Group();
  for (const { mesh, feature } of collectMeshes(viewport)) {
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: new THREE.Color(feature?.appearance?.color || '#9aa7b8'),
      metalness: feature?.appearance?.metalness ?? 0.4,
      roughness: feature?.appearance?.roughness ?? 0.5,
    }));
    m.name = (feature?.name || 'Body').replace(/\s+/g, '_');
    root.add(m);
  }
  return root;
}

/* ------------------------------------------------------------- exporters */

export function exportSTL(viewport, { binary = true } = {}) {
  const root = exportGroup(viewport);
  if (!root.children.length) { bus.emit(T.TOAST, { msg: 'Nothing to export', kind: 'warn' }); return; }
  const result = new STLExporter().parse(root, { binary });
  download(safeName(store.doc.meta.name, '.stl'), binary ? new Blob([result]) : result, binary ? 'model/stl' : 'text/plain');
  disposeRoot(root);
}

export function exportOBJ(viewport) {
  const root = exportGroup(viewport);
  if (!root.children.length) { bus.emit(T.TOAST, { msg: 'Nothing to export', kind: 'warn' }); return; }
  const text = new OBJExporter().parse(root);
  download(safeName(store.doc.meta.name, '.obj'), `# ${APP_NAME} ${APP_VERSION} export\n${text}`, 'text/plain');
  disposeRoot(root);
}

export function exportGLTF(viewport, { binary = true } = {}) {
  const root = exportGroup(viewport);
  if (!root.children.length) { bus.emit(T.TOAST, { msg: 'Nothing to export', kind: 'warn' }); return; }
  new GLTFExporter().parse(root, (result) => {
    if (binary) download(safeName(store.doc.meta.name, '.glb'), new Blob([result]), 'model/gltf-binary');
    else download(safeName(store.doc.meta.name, '.gltf'), JSON.stringify(result), 'model/gltf+json');
    disposeRoot(root);
  }, (err) => {
    bus.emit(T.TOAST, { msg: `glTF export failed: ${err.message || err}`, kind: 'err' });
    disposeRoot(root);
  }, { binary, onlyVisible: true });
}

/** 3MF-style plain XML is out of scope; PLY is trivial and widely supported. */
export function exportPLY(viewport) {
  const meshes = collectMeshes(viewport);
  if (!meshes.length) { bus.emit(T.TOAST, { msg: 'Nothing to export', kind: 'warn' }); return; }
  const verts = [];
  const cols = [];
  for (const { mesh, feature } of meshes) {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const p = g.attributes.position;
    const c = new THREE.Color(feature?.appearance?.color || '#9aa7b8');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      verts.push(v.x, v.y, v.z);
      cols.push(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255));
    }
  }
  const n = verts.length / 3;
  const lines = [
    'ply', 'format ascii 1.0', `comment ${APP_NAME} ${APP_VERSION}`,
    `element vertex ${n}`,
    'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue',
    `element face ${n / 3}`, 'property list uchar int vertex_indices', 'end_header',
  ];
  for (let i = 0; i < n; i++) {
    lines.push(`${round(verts[i * 3])} ${round(verts[i * 3 + 1])} ${round(verts[i * 3 + 2])} ${cols[i * 3]} ${cols[i * 3 + 1]} ${cols[i * 3 + 2]}`);
  }
  for (let i = 0; i < n / 3; i++) lines.push(`3 ${i * 3} ${i * 3 + 1} ${i * 3 + 2}`);
  download(safeName(store.doc.meta.name, '.ply'), lines.join('\n'), 'text/plain');
}

const round = (v) => Math.round(v * 10000) / 10000;

export function disposeRoot(root) {
  root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}

export function exportDXF() {
  if (!store.doc.draw.entities.length) { bus.emit(T.TOAST, { msg: 'The drawing is empty', kind: 'warn' }); return; }
  download(safeName(store.doc.meta.name, '.dxf'), toDXF(store.doc.draw, { units: store.doc.meta.units }), 'application/dxf');
}

export function exportSVG() {
  if (!store.doc.draw.entities.length) { bus.emit(T.TOAST, { msg: 'The drawing is empty', kind: 'warn' }); return; }
  download(safeName(store.doc.meta.name, '.svg'), toSVG(store.doc.draw, { units: store.doc.meta.units }), 'image/svg+xml');
}

export function exportPNG(viewport, scale = 2) {
  const url = viewport.snapshot(scale);
  // The only export that goes through fetch, because turning a data: URL into
  // a Blob is what fetch is for. That also puts it under connect-src, unlike
  // every other export here, so it is the one that a tightening of the policy
  // would break on its own. Reported rather than left as an unhandled
  // rejection: a silent no-op after clicking Export PNG reads as the
  // application being broken, which is worse than the failure itself.
  fetch(url)
    .then(r => r.blob())
    .then(b => download(safeName(store.doc.meta.name, '.png'), b, 'image/png'))
    .catch(err => bus.emit(T.TOAST, { msg: `PNG export failed: ${err.message || err}`, kind: 'err' }));
}

/** A plain-text bill of materials for the current model. */
export function exportBOM(build) {
  const rows = [['Item', 'Feature', 'Type', 'Material', 'Bodies', 'Volume (mm^3)', 'Mass (kg)']];
  let i = 1;
  for (const f of build.topLevel) {
    const r = build.results.get(f.id);
    if (!r || r.error) continue;
    const mp = build.perFeature?.get(f.id);
    rows.push([
      i++, f.name, f.type, f.material || 'steel', r.instances.length,
      mp ? mp.volume.toFixed(2) : '', mp ? mp.mass.toFixed(4) : '',
    ]);
  }
  const csv = rows.map(r => r.map(c => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  download(safeName(store.doc.meta.name + '-bom', '.csv'), csv, 'text/csv');
}

/* ------------------------------------------------------------- importers */

export async function importMeshFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let geometries = [];

  if (ext === 'stl') {
    const buf = await file.arrayBuffer();
    geometries = [new STLLoader().parse(buf)];
  } else if (ext === 'obj') {
    const text = await file.text();
    const obj = new OBJLoader().parse(text);
    obj.traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geometries.push(g); } });
  } else {
    throw new Error(`Unsupported mesh format “.${ext}”`);
  }
  if (!geometries.length) throw new Error('No geometry found in that file');

  const added = [];
  store.edit(`Import ${file.name}`, (doc) => {
    geometries.forEach((g0, i) => {
      const g = g0.index ? g0.toNonIndexed() : g0;
      const positions = Array.from(g.attributes.position.array);
      const feature = makeFeature('mesh', {
        name: store.uniqueName(geometries.length > 1 ? `${name} ${i + 1}` : name),
        material: 'abs',
      });
      feature.data = { positions, hash: `${file.name}:${i}:${positions.length}` };
      doc.features.push(feature);
      added.push(feature.id);
    });
  });
  bus.emit(T.TOAST, { msg: `Imported ${geometries.length} bod${geometries.length === 1 ? 'y' : 'ies'} from ${file.name}`, kind: 'ok' });
  return added;
}

export async function importDXFFile(file, { replace = false } = {}) {
  const text = await file.text();
  const parsed = fromDXF(text);
  if (!parsed.entities.length) throw new Error('No drawable entities found in that DXF');
  store.edit(`Import ${file.name}`, (doc) => {
    if (replace) { doc.draw.layers = []; doc.draw.entities = []; }
    const idFor = new Map();
    for (const l of parsed.layers) {
      const existing = doc.draw.layers.find(x => x.name === l.name);
      if (existing) idFor.set(l.id, existing.id);
      else { doc.draw.layers.push(l); idFor.set(l.id, l.id); }
    }
    if (!doc.draw.layers.length) doc.draw.layers.push({ id: uid('l'), name: '0', color: '#c9d3e0', visible: true, locked: false, weight: 1, style: 'solid' });
    for (const e of parsed.entities) {
      e.layer = idFor.get(e.layer) || doc.draw.layers[0].id;
      doc.draw.entities.push(e);
    }
    doc.draw.activeLayer = doc.draw.layers[0].id;
  });
  bus.emit(T.TOAST, { msg: `Imported ${parsed.entities.length} entities from ${file.name}`, kind: 'ok' });
  return parsed.entities.length;
}

/** Route any dropped/selected file to the right importer. */
export async function importAny(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'tcad' || ext === 'json') return openProjectFile(file);
  if (ext === 'dxf') return importDXFFile(file);
  if (ext === 'stl' || ext === 'obj') return importMeshFile(file);
  throw new Error(`Don't know how to open “.${ext}” — supported: .tcad .stl .obj .dxf`);
}

export const IMPORT_ACCEPT = '.tcad,.json,.stl,.obj,.dxf';
