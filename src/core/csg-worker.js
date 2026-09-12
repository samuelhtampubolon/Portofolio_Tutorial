/**
 * One boolean worker.
 *
 * Deliberately tiny. It imports the kernel by a relative path, which is the
 * only kind of import a module worker can resolve without the page's import
 * map, and it never touches THREE, the DOM or the document model. Everything
 * it receives and returns is a transferable typed array, so a job costs no
 * copy in either direction.
 */
import { booleanTriangles } from './csg-core.js';

self.onmessage = (e) => {
  const { id, op, operands } = e.data;
  try {
    const out = booleanTriangles(op, operands);
    self.postMessage({ id, ok: true, ...out }, [out.position.buffer, out.normal.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
