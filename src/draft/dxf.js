/**
 * DXF (AutoCAD R12 / AC1009) reader and writer, plus an SVG writer.
 *
 * R12 is the most widely readable DXF flavour — every CAD package, laser
 * cutter and CAM tool on the planet opens it. The reader is deliberately
 * permissive and also understands the R13+ entities (LWPOLYLINE, ELLIPSE)
 * that modern files use.
 */
import { uid } from '../core/doc.js';
import { entityToPath } from '../core/geometry.js';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/* AutoCAD Color Index — the first 10 slots cover the standard palette. */
const ACI = [
  [0, '#000000'], [1, '#ff0000'], [2, '#ffff00'], [3, '#00ff00'], [4, '#00ffff'],
  [5, '#0000ff'], [6, '#ff00ff'], [7, '#ffffff'], [8, '#414141'], [9, '#808080'],
];

function hexToRgb(h) {
  const s = String(h || '#ffffff').replace('#', '');
  const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function nearestAci(hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = 7, bd = Infinity;
  for (const [idx, h] of ACI) {
    const [r2, g2, b2] = hexToRgb(h);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bd) { bd = d; best = idx; }
  }
  return best === 0 ? 7 : best;
}

/* ==================================================================
   Writer
   ================================================================== */

class DxfWriter {
  constructor() { this.out = []; }
  g(code, value) { this.out.push(String(code), String(value)); return this; }
  toString() { return this.out.join('\r\n') + '\r\n'; }
}

export function toDXF(draw, { units = 'mm' } = {}) {
  const w = new DxfWriter();
  const insunits = { mm: 4, cm: 5, m: 6, in: 1, ft: 2 }[units] ?? 4;

  w.g(0, 'SECTION').g(2, 'HEADER');
  w.g(9, '$ACADVER').g(1, 'AC1009');
  w.g(9, '$INSUNITS').g(70, insunits);
  w.g(9, '$EXTMIN').g(10, 0).g(20, 0).g(30, 0);
  w.g(9, '$EXTMAX').g(10, 1000).g(20, 1000).g(30, 0);
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION').g(2, 'TABLES');
  w.g(0, 'TABLE').g(2, 'LAYER').g(70, draw.layers.length);
  for (const l of draw.layers) {
    w.g(0, 'LAYER').g(2, dxfName(l.name)).g(70, l.visible ? 0 : 1)
      .g(62, l.visible ? nearestAci(l.color) : -nearestAci(l.color))
      .g(6, l.style === 'dashed' ? 'DASHED' : l.style === 'dotted' ? 'DOT' : 'CONTINUOUS');
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION').g(2, 'ENTITIES');
  const layerName = (id) => dxfName((draw.layers.find(l => l.id === id) || draw.layers[0] || { name: '0' }).name);
  for (const e of draw.entities) writeEntity(w, e, layerName(e.layer));
  w.g(0, 'ENDSEC');

  w.g(0, 'EOF');
  return w.toString();
}

function dxfName(n) { return String(n || '0').replace(/[^A-Za-z0-9_$\-. ]/g, '_').slice(0, 31) || '0'; }

function line(w, layer, a, b) {
  w.g(0, 'LINE').g(8, layer).g(10, a[0]).g(20, a[1]).g(30, 0).g(11, b[0]).g(21, b[1]).g(31, 0);
}

function polyline(w, layer, pts, closed) {
  w.g(0, 'POLYLINE').g(8, layer).g(66, 1).g(10, 0).g(20, 0).g(30, 0).g(70, closed ? 1 : 0);
  for (const p of pts) w.g(0, 'VERTEX').g(8, layer).g(10, p[0]).g(20, p[1]).g(30, 0);
  w.g(0, 'SEQEND').g(8, layer);
}

function writeEntity(w, e, layer) {
  switch (e.type) {
    case 'line': line(w, layer, e.a, e.b); break;

    case 'rect': {
      const [x1, y1] = e.a, [x2, y2] = e.b;
      polyline(w, layer, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true);
      break;
    }

    case 'polyline': polyline(w, layer, e.pts, !!e.closed); break;

    case 'polygon':
    case 'spline':
    case 'ellipse': {
      const path = entityToPath(e, 72);
      if (path) polyline(w, layer, path.pts, path.closed);
      break;
    }

    case 'circle':
      w.g(0, 'CIRCLE').g(8, layer).g(10, e.c[0]).g(20, e.c[1]).g(30, 0).g(40, e.r);
      break;

    case 'arc':
      w.g(0, 'ARC').g(8, layer).g(10, e.c[0]).g(20, e.c[1]).g(30, 0).g(40, e.r)
        .g(50, e.a0 * R2D).g(51, e.a1 * R2D);
      break;

    case 'point':
      w.g(0, 'POINT').g(8, layer).g(10, e.p[0]).g(20, e.p[1]).g(30, 0);
      break;

    case 'text':
      w.g(0, 'TEXT').g(8, layer).g(10, e.p[0]).g(20, e.p[1]).g(30, 0)
        .g(40, e.size || 6).g(1, String(e.text || '')).g(50, e.rot || 0);
      break;

    case 'dim': writeDim(w, e, layer); break;

    default: break;
  }
}

/** Dimensions are exploded to lines + text so any reader shows them. */
function writeDim(w, e, layer) {
  const size = e.size || 6;
  if (e.kind === 'radial') {
    const a = e.ang || 0;
    // The leader runs from the centre out past the arc, which is where the
    // text sits, so the point on the arc itself is never drawn.
    const out = [e.c[0] + Math.cos(a) * (e.r + size * 2), e.c[1] + Math.sin(a) * (e.r + size * 2)];
    line(w, layer, e.c, out);
    w.g(0, 'TEXT').g(8, layer).g(10, out[0]).g(20, out[1] + size * 0.4).g(30, 0).g(40, size).g(1, `R${round(e.r)}`);
    return;
  }
  if (e.kind === 'angular') {
    line(w, layer, e.c, e.p1);
    line(w, layer, e.c, e.p2);
    const a1 = Math.atan2(e.p1[1] - e.c[1], e.p1[0] - e.c[0]);
    const a2 = Math.atan2(e.p2[1] - e.c[1], e.p2[0] - e.c[0]);
    w.g(0, 'ARC').g(8, layer).g(10, e.c[0]).g(20, e.c[1]).g(30, 0).g(40, e.rad || size * 3)
      .g(50, Math.min(a1, a2) * R2D).g(51, Math.max(a1, a2) * R2D);
    const am = (a1 + a2) / 2, rr = (e.rad || size * 3) + size;
    w.g(0, 'TEXT').g(8, layer).g(10, e.c[0] + Math.cos(am) * rr).g(20, e.c[1] + Math.sin(am) * rr).g(30, 0)
      .g(40, size).g(1, `${round(Math.abs(a1 - a2) * R2D)}%%d`);
    return;
  }
  const a = e.a, b = e.b, off = e.off || 0;
  let da, db, value;
  if (e.kind === 'h') { const y = Math.max(a[1], b[1]) + off; da = [a[0], y]; db = [b[0], y]; value = Math.abs(b[0] - a[0]); }
  else if (e.kind === 'v') { const x = Math.max(a[0], b[0]) + off; da = [x, a[1]]; db = [x, b[1]]; value = Math.abs(b[1] - a[1]); }
  else {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    da = [a[0] - dy / L * off, a[1] + dx / L * off];
    db = [b[0] - dy / L * off, b[1] + dx / L * off];
    value = L;
  }
  line(w, layer, a, da);
  line(w, layer, b, db);
  line(w, layer, da, db);
  const mx = (da[0] + db[0]) / 2, my = (da[1] + db[1]) / 2;
  w.g(0, 'TEXT').g(8, layer).g(10, mx).g(20, my + size * 0.3).g(30, 0).g(40, size).g(1, String(round(value)));
}

const round = (v) => Math.round(v * 1000) / 1000;

/* ==================================================================
   Reader
   ================================================================== */

/** Parse DXF text into { layers, entities } ready to merge into a document. */
export function fromDXF(text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1]]);
  }

  const layers = new Map();
  const entities = [];
  let i = 0;
  let section = null;

  const readGroup = () => {
    // collect group codes until the next 0-code
    const rec = {};
    while (i < pairs.length && pairs[i][0] !== 0) {
      const [c, v] = pairs[i];
      if (rec[c] === undefined) rec[c] = v;
      else if (Array.isArray(rec[c])) rec[c].push(v);
      else rec[c] = [rec[c], v];
      i++;
    }
    return rec;
  };
  const num = (rec, code, dflt = 0) => {
    const v = rec[code];
    const n = parseFloat(Array.isArray(v) ? v[0] : v);
    return Number.isFinite(n) ? n : dflt;
  };
  const arr = (rec, code) => {
    const v = rec[code];
    if (v === undefined) return [];
    return (Array.isArray(v) ? v : [v]).map(parseFloat);
  };

  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code !== 0) { i++; continue; }
    const kind = String(value).trim().toUpperCase();
    i++;
    if (kind === 'SECTION') { const r = readGroup(); section = String(r[2] || '').trim().toUpperCase(); continue; }
    if (kind === 'ENDSEC') { section = null; continue; }
    if (kind === 'EOF') break;

    if (section === 'TABLES' && kind === 'LAYER') {
      const r = readGroup();
      const name = String(r[2] || '0').trim();
      const aci = Math.abs(parseInt(Array.isArray(r[62]) ? r[62][0] : r[62], 10) || 7);
      const found = ACI.find(a => a[0] === aci);
      layers.set(name, {
        id: uid('l'), name,
        color: found ? found[1] : '#c9d3e0',
        visible: !(String(r[62]).trim().startsWith('-')),
        locked: false, weight: 1, style: 'solid',
      });
      continue;
    }

    if (section !== 'ENTITIES' && section !== 'BLOCKS') { readGroup(); continue; }

    const rec = readGroup();
    const layerName = String(rec[8] || '0').trim();
    if (!layers.has(layerName)) {
      layers.set(layerName, { id: uid('l'), name: layerName, color: '#c9d3e0', visible: true, locked: false, weight: 1, style: 'solid' });
    }
    const layer = layers.get(layerName).id;

    switch (kind) {
      case 'LINE':
        entities.push({ id: uid('e'), layer, type: 'line', a: [num(rec, 10), num(rec, 20)], b: [num(rec, 11), num(rec, 21)] });
        break;
      case 'CIRCLE':
        entities.push({ id: uid('e'), layer, type: 'circle', c: [num(rec, 10), num(rec, 20)], r: num(rec, 40, 1) });
        break;
      case 'ARC':
        entities.push({
          id: uid('e'), layer, type: 'arc',
          c: [num(rec, 10), num(rec, 20)], r: num(rec, 40, 1),
          a0: num(rec, 50) * D2R, a1: num(rec, 51) * D2R,
        });
        break;
      case 'POINT':
        entities.push({ id: uid('e'), layer, type: 'point', p: [num(rec, 10), num(rec, 20)] });
        break;
      case 'TEXT':
      case 'MTEXT': {
        const raw = rec[1];
        const txt = String(Array.isArray(raw) ? raw.join('') : (raw ?? '')).replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
        entities.push({ id: uid('e'), layer, type: 'text', p: [num(rec, 10), num(rec, 20)], text: txt, size: num(rec, 40, 6) || 6, rot: num(rec, 50) });
        break;
      }
      case 'LWPOLYLINE': {
        const xs = arr(rec, 10), ys = arr(rec, 20);
        const pts = xs.map((x, k) => [x, ys[k] ?? 0]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (pts.length >= 2) entities.push({ id: uid('e'), layer, type: 'polyline', pts, closed: (num(rec, 70) & 1) === 1 });
        break;
      }
      case 'POLYLINE': {
        const closed = (num(rec, 70) & 1) === 1;
        const pts = [];
        // consume the following VERTEX records up to SEQEND
        while (i < pairs.length) {
          const [c2, v2] = pairs[i];
          if (c2 !== 0) { i++; continue; }
          const k2 = String(v2).trim().toUpperCase();
          i++;
          if (k2 === 'VERTEX') { const vr = readGroup(); pts.push([num(vr, 10), num(vr, 20)]); continue; }
          if (k2 === 'SEQEND') { readGroup(); break; }
          i -= 1; break;
        }
        if (pts.length >= 2) entities.push({ id: uid('e'), layer, type: 'polyline', pts, closed });
        break;
      }
      case 'ELLIPSE': {
        const c = [num(rec, 10), num(rec, 20)];
        const mx = num(rec, 11), my = num(rec, 21);
        const rx = Math.hypot(mx, my) || 1;
        entities.push({
          id: uid('e'), layer, type: 'ellipse',
          c, rx, ry: rx * (num(rec, 40, 1) || 1), rot: Math.atan2(my, mx) * R2D,
        });
        break;
      }
      case 'SOLID':
      case '3DFACE': {
        const pts = [[num(rec, 10), num(rec, 20)], [num(rec, 11), num(rec, 21)], [num(rec, 13), num(rec, 23)], [num(rec, 12), num(rec, 22)]];
        entities.push({ id: uid('e'), layer, type: 'polyline', pts, closed: true });
        break;
      }
      default: break;
    }
  }

  return { layers: [...layers.values()], entities };
}

/* ==================================================================
   SVG writer
   ================================================================== */

export function toSVG(draw, { units = 'mm', pad = 10, background = null } = {}) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const layerMap = new Map(draw.layers.map(l => [l.id, l]));
  const body = [];

  const grow = (pts) => { for (const p of pts) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); } };

  for (const e of draw.entities) {
    const l = layerMap.get(e.layer);
    if (l && !l.visible) continue;
    const stroke = l ? l.color : '#000';
    const sw = (l ? l.weight : 1) * 0.3;
    const dash = l && l.style === 'dashed' ? ' stroke-dasharray="3 2"' : l && l.style === 'dotted' ? ' stroke-dasharray="0.8 1.6"' : '';
    const common = `fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} vector-effect="non-scaling-stroke"`;

    if (e.type === 'circle') {
      grow([[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]]);
      body.push(`<circle cx="${n(e.c[0])}" cy="${n(-e.c[1])}" r="${n(e.r)}" ${common}/>`);
      continue;
    }
    if (e.type === 'text') {
      grow([e.p]);
      body.push(`<text x="${n(e.p[0])}" y="${n(-e.p[1])}" font-size="${n(e.size || 6)}" fill="${stroke}" font-family="sans-serif">${esc(e.text)}</text>`);
      continue;
    }
    if (e.type === 'point') {
      grow([e.p]);
      body.push(`<circle cx="${n(e.p[0])}" cy="${n(-e.p[1])}" r="0.6" fill="${stroke}"/>`);
      continue;
    }
    if (e.type === 'dim') {
      const pts = [e.a, e.b, e.c, e.p1, e.p2].filter(Boolean);
      grow(pts);
      // exploded, same as DXF
      const sub = { ...e };
      body.push(...svgDim(sub, stroke));
      continue;
    }
    const path = entityToPath(e, 72);
    if (!path) continue;
    grow(path.pts);
    const d = path.pts.map((p, k) => `${k ? 'L' : 'M'}${n(p[0])} ${n(-p[1])}`).join(' ') + (path.closed ? ' Z' : '');
    body.push(`<path d="${d}" ${common}/>`);
  }

  if (!Number.isFinite(x1)) { x1 = 0; y1 = 0; x2 = 100; y2 = 100; }
  const w = (x2 - x1) + pad * 2, h = (y2 - y1) + pad * 2;
  const vb = `${n(x1 - pad)} ${n(-y2 - pad)} ${n(w)} ${n(h)}`;
  const bg = background ? `<rect x="${n(x1 - pad)}" y="${n(-y2 - pad)}" width="${n(w)}" height="${n(h)}" fill="${background}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}${units}" height="${n(h)}${units}" viewBox="${vb}">
<title>TesserCAD drawing</title>
${bg}
${body.join('\n')}
</svg>
`;
}

function svgDim(e, stroke) {
  const out = [];
  const seg = (a, b) => `<line x1="${n(a[0])}" y1="${n(-a[1])}" x2="${n(b[0])}" y2="${n(-b[1])}" stroke="${stroke}" stroke-width="0.25" vector-effect="non-scaling-stroke"/>`;
  const size = e.size || 6;
  const txt = (p, s) => `<text x="${n(p[0])}" y="${n(-p[1])}" font-size="${n(size)}" fill="${stroke}" text-anchor="middle" font-family="sans-serif">${esc(s)}</text>`;
  if (e.kind === 'radial') {
    const a = e.ang || 0;
    const out1 = [e.c[0] + Math.cos(a) * (e.r + size * 2), e.c[1] + Math.sin(a) * (e.r + size * 2)];
    out.push(seg(e.c, out1), txt([out1[0], out1[1] + size * 0.4], `R${round(e.r)}`));
    return out;
  }
  if (e.kind === 'angular') {
    out.push(seg(e.c, e.p1), seg(e.c, e.p2));
    const a1 = Math.atan2(e.p1[1] - e.c[1], e.p1[0] - e.c[0]);
    const a2 = Math.atan2(e.p2[1] - e.c[1], e.p2[0] - e.c[0]);
    const am = (a1 + a2) / 2, rr = (e.rad || size * 3);
    out.push(txt([e.c[0] + Math.cos(am) * (rr + size), e.c[1] + Math.sin(am) * (rr + size)], `${round(Math.abs(a1 - a2) * R2D)}°`));
    return out;
  }
  const a = e.a, b = e.b, off = e.off || 0;
  let da, db, value;
  if (e.kind === 'h') { const y = Math.max(a[1], b[1]) + off; da = [a[0], y]; db = [b[0], y]; value = Math.abs(b[0] - a[0]); }
  else if (e.kind === 'v') { const x = Math.max(a[0], b[0]) + off; da = [x, a[1]]; db = [x, b[1]]; value = Math.abs(b[1] - a[1]); }
  else {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    da = [a[0] - dy / L * off, a[1] + dx / L * off];
    db = [b[0] - dy / L * off, b[1] + dx / L * off];
    value = L;
  }
  out.push(seg(a, da), seg(b, db), seg(da, db));
  out.push(txt([(da[0] + db[0]) / 2, (da[1] + db[1]) / 2 + size * 0.3], String(round(value))));
  return out;
}

const n = (v) => (Math.round(v * 1000) / 1000);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
