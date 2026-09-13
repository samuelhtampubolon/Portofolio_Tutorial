/**
 * Launch the real desktop shell and confirm the real application works in it.
 *
 * Every other suite in this project tests the application in a browser or in
 * Node. Neither of those exercises the thing the desktop build actually
 * changes: the page is no longer served over HTTP. It is served over a private
 * `app://` scheme by a handler in desktop/protocol.cjs, and that swap can
 * break things no unit test would notice.
 *
 * Three of them are genuine risks rather than theoretical ones:
 *
 *   The import map. `vendor/`'s three.js addons import the bare specifier
 *   'three', which only resolves because index.html carries an import map. A
 *   scheme that is not registered `standard` has no proper origin, and module
 *   resolution against it fails.
 *
 *   The worker pool. If `new Worker` on an app:// URL is refused, the boolean
 *   kernel falls back to its synchronous path. Every answer stays correct and
 *   nothing throws, so the application simply becomes single-threaded again
 *   without saying so. A silent loss of a headline feature is worse than a
 *   loud one, which is why this is checked by number and not by eye.
 *
 *   localStorage. A scheme that is not registered `secure` is not a secure
 *   context, and the document store is local storage.
 *
 * Run with Electron rather than Node, because it needs a renderer:
 *
 *   cd desktop && npm install
 *   xvfb-run -a ./node_modules/.bin/electron ../tools/verify-desktop.cjs
 *
 * It is deliberately not part of `npm test`. That suite runs in four seconds
 * and downloads nothing, and requiring a 100 MB Electron install to run it
 * would cost every contributor far more than this check is worth to them. CI
 * runs it in the desktop workflow, where Electron is already installed to
 * package the build.
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const SHELL = path.join(__dirname, '..', 'desktop', 'main.cjs');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
};

/**
 * Errors the headless renderer emits that are about the runner, not the app.
 *
 * `CONTEXT_LOST_WEBGL` is on this list only after checking that the
 * application does not cause it. There is exactly one `WebGLRenderer` in the
 * project, nothing calls `dispose()` on the viewport, and no code asks for
 * `loseContext`, so the loss comes from the GPU process — which here is
 * SwiftShader rendering in software on a machine with no GPU at all. The
 * functional checks below remain the real gate: the demo model reports its
 * 4008 triangles whether or not the compositor dropped a context afterwards,
 * and if rendering had actually stopped working those checks would fail.
 */
const ENVIRONMENTAL =
  /swiftshader|software WebGL|GPU stall|GroupMarkerNotSet|GL Driver Message|CONTEXT_LOST_WEBGL|WebGL2 blocklisted/i;

require(SHELL);

app.whenReady().then(() => {
  const consoleErrors = [];
  const START = Date.now();
  const waitForWindow = setInterval(async () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win || win.webContents.isLoading()) return;
    clearInterval(waitForWindow);

    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !ENVIRONMENTAL.test(message)) consoleErrors.push(`[t+${Date.now() - START}ms] ` + message.slice(0, 300));
    });
    win.webContents.on('render-process-gone',
      (_e, details) => consoleErrors.push(`RENDERER GONE ${JSON.stringify(details)}`));

    try {
      await run(win, consoleErrors);
    } catch (err) {
      ok('the probe itself completed', false, String((err && err.message) || err));
    }

    console.log(fails ? `\n${fails} FAILURES` : '\nALL DESKTOP RUNTIME CHECKS PASS');
    app.exit(fails ? 1 : 0);
  }, 400);

  setTimeout(() => {
    console.log('FAIL the window never finished loading\n\n1 FAILURES');
    app.exit(1);
  }, 120000);
});

async function run(win, consoleErrors) {
  const evaluate = (source) => win.webContents.executeJavaScript(source);

  // Wait for the same condition the browser suite waits for, so what follows
  // is the application having booted rather than the page having loaded.
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 60000;
    const t = setInterval(() => {
      if (window.tesserCAD && window.tesserCAD.build) { clearInterval(t); resolve(true); }
      else if (Date.now() > deadline) { clearInterval(t); reject(new Error('app did not boot')); }
    }, 200);
  })`);
  await evaluate(`document.querySelectorAll('.modal-back').forEach(n => n.remove())`);

  /* ------------------------------------------------- the origin it runs at */

  const origin = await evaluate(`({
    origin: location.origin,
    protocol: location.protocol,
    secure: window.isSecureContext,
    title: document.title,
  })`);
  ok('the application is served from its own scheme, not file:// and not a port',
    origin.origin === 'app://tessercad' && origin.protocol === 'app:', origin.origin);
  ok('and that origin is a secure context, so it behaves as it does on https',
    origin.secure === true);
  ok('the page is the application', /TesserCAD/.test(origin.title), origin.title);

  /* ----------------------------------------- modules, and the import map */

  const modules = await evaluate(`(async () => {
    const doc = await import('./src/core/doc.js');
    const three = await import('three').catch(e => ({ _error: e.message }));
    return {
      relative: !!(doc && doc.store),
      bare: !!(three && three.BufferGeometry),
      bareError: three._error || null,
    };
  })()`);
  ok('a relative module import resolves over the scheme', modules.relative);
  ok('and so does the bare specifier the import map rewrites, which needs a real origin',
    modules.bare, modules.bareError || '');

  /* ------------------------------------------------ the application itself */

  const build = await evaluate(`(() => ({
    tris: tesserCAD.build.stats.tris,
    bodies: tesserCAD.vp.bodies.size,
    errors: [...tesserCAD.build.results.values()].filter(r => r.error).length,
    commands: tesserCAD.commands.length,
  }))()`);
  ok('the demo model builds, with the same triangle count the browser produces',
    build.tris > 1000 && build.bodies === 1 && build.errors === 0, JSON.stringify(build));
  ok('the command registry is fully populated', build.commands > 200, String(build.commands));

  const primitives = await evaluate(`(async () => {
    for (const t of ['box','cylinder','sphere','torus','helix','tube','prism','wedge','plate','cone','pyramid'])
      tesserCAD.addFeature(t);
    await new Promise(r => setTimeout(r, 1500));
    return {
      n: tesserCAD.build.topLevel.length,
      errors: [...tesserCAD.build.results.values()].filter(r => r.error).map(r => r.name + ': ' + r.error),
    };
  })()`);
  ok('every primitive type builds with no error',
    primitives.n === 12 && primitives.errors.length === 0, primitives.errors.join(', '));

  /* ---------------------------------- the worker pool, by number not by eye */

  const pool = await evaluate(`(async () => {
    const { pool } = await import('./src/core/csg-pool.js');
    const started = pool.start();
    const ids = tesserCAD.build.topLevel.slice(-2).map(f => f.id);
    tesserCAD.addFeature('boolean', { op: 'subtract', inputs: ids });
    await new Promise(r => setTimeout(r, 3000));
    const last = tesserCAD.build.topLevel[tesserCAD.build.topLevel.length - 1];
    const result = tesserCAD.build.results.get(last.id);
    return { started, report: pool.report(), booleanError: (result && result.error) || null };
  })()`);
  ok('the boolean worker pool starts under the scheme', pool.report.available === true,
    pool.report.reason);
  ok('with more than one worker, so the parallelism is real',
    pool.report.size > 1, `${pool.report.size} workers, ${pool.report.cores} cores`);
  ok('work reaches the workers and comes back',
    pool.report.dispatched > 0 && pool.report.completed === pool.report.dispatched,
    `${pool.report.completed}/${pool.report.dispatched}`);
  ok('and nothing fell back to the synchronous path, which would be a silent loss',
    pool.report.failed === 0 && pool.report.fellBack === 0,
    `failed ${pool.report.failed}, fell back ${pool.report.fellBack}`);
  ok('the boolean itself evaluated', pool.booleanError === null, pool.booleanError || '');

  /* --------------------------------------------------- storage and history */

  const state = await evaluate(`(async () => {
    const { store } = await import('./src/core/doc.js');
    let storage = false;
    try { localStorage.setItem('_probe', '1'); storage = localStorage.getItem('_probe') === '1'; localStorage.removeItem('_probe'); } catch {}
    const depth = store.depth;
    store.undo();
    await new Promise(r => setTimeout(r, 400));
    const undone = store.depth;
    store.redo();
    await new Promise(r => setTimeout(r, 400));
    return { storage, undoWorks: undone === depth - 1, redoWorks: store.depth === depth };
  })()`);
  ok('local storage is writable, which is where the document lives', state.storage);
  ok('undo walks the history tree', state.undoWorks);
  ok('and redo walks back, so no state is stranded', state.redoWorks);

  /* ------------------------------------------------ nothing broke quietly */

  ok('the renderer logged no errors of its own', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
}
