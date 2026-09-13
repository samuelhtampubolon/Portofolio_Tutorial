/**
 * How the desktop build reads its own files, separated from the shell.
 *
 * This file exists apart from main.cjs for one reason: it holds the only
 * security-critical logic in the desktop build, and main.cjs cannot be loaded
 * outside Electron, so nothing inside it can be tested. Path containment is
 * exactly the kind of code that must be tested rather than reviewed, so it
 * lives here where `node` can require it and `tools/tests/desktop.mjs` can
 * attack it directly.
 *
 * ## Why a custom scheme rather than a loopback HTTP server
 *
 * The first version of this served the application from `http://127.0.0.1` on
 * an OS-assigned port. That works, and it is what most Electron applications
 * do, but it has two costs that a custom scheme does not:
 *
 * A listening socket is reachable by everything else on the machine. Bound to
 * loopback it is not on the network, but every other process running as that
 * user can connect to it for as long as the window is open. For an
 * application whose whole claim is that your documents stay yours, handing out
 * a port that serves those documents to any local caller is the wrong shape,
 * even when the port is random and the surface is a read-only allowlist.
 *
 * And opening a port, then serving an application out of it, is behaviour that
 * endpoint protection notices. That is not a reason to make a security
 * decision on its own, but here the more private option is also the quieter
 * one, so there is no trade to weigh.
 *
 * `file://` is not the alternative. ES modules and the import map need a real
 * origin, and under `file://` every local file is same-origin with the page,
 * which is a worse position than either of the above. A scheme registered as
 * `standard` and `secure` gives the page a genuine origin (`app://tessercad`),
 * makes it a secure context so workers behave as they do on the web, and
 * reaches the disk through this handler and nothing else.
 */
const path = require('node:path');
const fs = require('node:fs');

/** The origin the application is served from. */
const SCHEME = 'app';
const HOST = 'tessercad';
const ORIGIN = `${SCHEME}://${HOST}`;

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
 * The headers a meta tag cannot deliver.
 *
 * The page carries its own Content-Security-Policy inline, because that has to
 * travel with the file for the hosted copy too. These three can only be sent
 * as headers, which is why the hosted copy documents that it lacks them and
 * this build does not: here we control the response.
 */
const HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

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
 * types the application actually ships. A `.pem` or a `.env` that found its
 * way into the directory is refused on the way out.
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
 * The handler `protocol.handle` is given: a request in, a Response out.
 *
 * Returned as a plain function of `(root)` so that it can be exercised in Node
 * with no Electron present. `Request` and `Response` are platform globals in
 * both places, so what the tests drive is the same function the shell installs
 * rather than a stand-in that could drift from it.
 */
function createHandler(root) {
  return async function handle(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
    }

    let url;
    try { url = new URL(request.url); } catch { return refuse(); }

    // A request for another host on this scheme is not this application's.
    if (url.host !== HOST) return refuse();

    const file = resolveSafely(root, url.pathname);
    if (!file) return refuse();

    const type = TYPES.get(path.extname(file).toLowerCase());
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...HEADERS, 'Content-Type': type } });
    }
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { status: 200, headers: { ...HEADERS, 'Content-Type': type } });
    } catch {
      return refuse();
    }
  };
}

/** Every refusal looks the same, so a probe learns nothing from the difference. */
function refuse() {
  return new Response('Not found', {
    status: 404,
    headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

module.exports = { SCHEME, HOST, ORIGIN, TYPES, HEADERS, resolveSafely, createHandler };
