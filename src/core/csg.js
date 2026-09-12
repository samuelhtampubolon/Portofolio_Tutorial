/**
 * Constructive Solid Geometry: the THREE-facing half.
 *
 * The algorithm itself lives in csg-core.js with no THREE in it, so it can run
 * in a Web Worker. This file is the adapter: BufferGeometry in, BufferGeometry
 * out, flat typed arrays in between. Keeping the split at exactly this line is
 * what lets the same maths run on the main thread and in a worker with no
 * second implementation to keep in step.
 */
import * as THREE from 'three';
import {
  booleanTriangles, trianglesToPolygons, polygonsToTriangles, TRI_BUDGET,
} from './csg-core.js';

export { TRI_BUDGET };

/** Flat, non-indexed triangle arrays for one geometry, with normals present. */
export function geometryToTriangles(geometry) {
  let geo = geometry;
  if (geo.index) geo = geo.toNonIndexed();
  if (!geo.attributes.normal) { geo = geo.clone(); geo.computeVertexNormals(); }
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  return {
    // Copies, because the caller may transfer these to a worker and a
    // transferred buffer is detached from whoever still holds the geometry.
    position: pos instanceof Float32Array ? pos.slice() : new Float32Array(pos),
    normal: nrm instanceof Float32Array ? nrm.slice() : new Float32Array(nrm),
  };
}

export function trianglesToGeometry({ position, normal }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Operands as the kernel wants them: arrays plus a plain 16-number matrix. */
export function operandsToArrays(operands) {
  return operands.map(o => ({
    ...geometryToTriangles(o.geometry),
    matrix: o.matrix ? Array.from(o.matrix.elements) : null,
  }));
}

export function geometryToPolygons(geometry, matrix = null) {
  const { position, normal } = geometryToTriangles(geometry);
  return trianglesToPolygons(position, normal, matrix ? Array.from(matrix.elements) : null);
}

export function polygonsToGeometry(polys) {
  return trianglesToGeometry(polygonsToTriangles(polys));
}

/**
 * Boolean over a list of { geometry, matrix } operands, folded left to right.
 * Returns a world-space BufferGeometry. Synchronous, on this thread: the
 * worker pool is the path the app uses, and this is the one the tests and the
 * fallback use.
 */
export function booleanGeometries(op, operands) {
  if (!operands.length) return new THREE.BufferGeometry();
  return trianglesToGeometry(booleanTriangles(op, operandsToArrays(operands)));
}
