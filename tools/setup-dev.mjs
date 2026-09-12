/**
 * Creates a tiny node_modules/three shim that points at the vendored build, so
 * the source modules (which import the bare specifier "three", resolved in the
 * browser by the import map in index.html) also resolve under plain Node.
 *
 * Run this once before `npm test`. Nothing is downloaded.
 */
import { mkdirSync, copyFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'node_modules', 'three');
const src = join(root, 'vendor', 'three.module.js');

if (!existsSync(src)) {
  console.error('vendor/three.module.js is missing — the repository is incomplete.');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
copyFileSync(src, join(dest, 'three.module.js'));

// The browser resolves "three/addons/X.js" through the import map in
// index.html; mirror that here so Node can import the application modules too.
const addons = join(dest, 'addons');
mkdirSync(addons, { recursive: true });
const vendor = join(root, 'vendor');
let n = 0;
for (const f of readdirSync(vendor)) {
  if (!f.endsWith('.js') || f === 'three.module.js') continue;
  copyFileSync(join(vendor, f), join(addons, f));
  n++;
}

writeFileSync(join(dest, 'package.json'), JSON.stringify({
  name: 'three', version: 'vendored', type: 'module',
  main: 'three.module.js',
  exports: { '.': './three.module.js', './addons/*': './addons/*' },
}, null, 2));
console.log(`dev shim ready: node_modules/three (core + ${n} addons) -> vendor/`);
