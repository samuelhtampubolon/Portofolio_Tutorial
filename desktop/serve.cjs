/**
 * The loopback file server for the desktop build, separated from the shell.
 *
 * This file exists apart from main.cjs for one reason: it contains the only
 * security-critical logic in the desktop build, and main.cjs cannot be loaded
 * outside Electron, so anything inside it cannot be tested. Path containment
 * is exactly the kind of code that must be tested rather than reviewed, so it
 * lives here where `node` can require it and `tools/tests/desktop.mjs` can
 * attack it directly.
 *
 * The application is served over loopback HTTP rather than file:// because ES
 * modules and the import map need an HTTP origin, and because under file://
 * every local file is same-origin with the page, which is a worse position
 * than the one this avoids.
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

/** The only extensions ever served, and the type each is served as. */
const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
}));

/**
 * Resolve a request path to a file inside `root`, or null to refuse it.
 *
 * The containment check is applied to the *resolved, normalised* path, which
 * is the only form of the check that holds. `..` segments, percent-encoded
 * separators, backslashes on Windows, doubled slashes and absolute paths all
 * collapse before the comparison; a blacklist applied to the raw request
 * string does not survive any of them.
 *
 * The extension allowlist is a second, independent barrier: even a path that
 * somehow resolved inside the tree cannot be read unless it is one of the
 * types the application actually ships.
 */
function resolveSafely(root, urlPath) {
  const base = path.resolve(root);
  let decoded;
  try { decoded = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]); }
  catch { return null; }                                   // malformed escape
  if (decoded.includes('\0')) return null;

  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null;

  if (!TYPES.has(path.extname(full).toLowerCase())) return null;

  let stat;
  try { stat = fs.statSync(full); } catch { return null; }
  if (!stat.isFile()) return null;
  return full;
}

/**
 * Start the server on a free loopback port.
 *
 * Port 0 lets the OS choose, so two copies can run at once and nothing
 * collides with a well-known port. Bound to 127.0.0.1 explicitly: binding to
 * 0.0.0.0 would put the user's documents on their local network.
 */
function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      const file = resolveSafely(root, req.url || '/');
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES.get(path.extname(file).toLowerCase()),
        // The page carries its own Content-Security-Policy in a meta tag.
        // These are the three a meta tag cannot deliver, so the desktop build
        // gets the protection the web build documents that it lacks.
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { TYPES, resolveSafely, startServer };
