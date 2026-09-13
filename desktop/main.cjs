/**
 * The desktop shell.
 *
 * TesserCAD is a static site, so a desktop build is a browser window with the
 * browser taken away. That framing is what makes this file short, and short is
 * the point: every line of shell is attack surface that the web version does
 * not have, because on the web the browser's own sandbox does this job.
 *
 * The security posture is therefore the whole content of this file, and it is
 * deliberately the strictest configuration Electron offers rather than the
 * default one:
 *
 *   sandbox            on. The renderer runs in an OS-level sandbox.
 *   contextIsolation   on. Page scripts cannot reach Electron's internals.
 *   nodeIntegration    off. `require` does not exist in the page. An XSS in a
 *                      shell with node integration is not a script injection,
 *                      it is arbitrary code execution on the user's machine.
 *   no preload         there is nothing the page needs from the host, so there
 *                      is no bridge to audit. The application already runs
 *                      unmodified in a browser; giving it privileges here
 *                      would mean maintaining two behaviours.
 *   webSecurity        on. Same-origin policy applies, and the app's own
 *                      Content-Security-Policy is served with the page, so the
 *                      desktop build is governed by the same rules as the web
 *                      build rather than a relaxed variant.
 *
 * Navigation and window creation are refused outright. A CAD application has
 * no reason to follow a link to another origin, and a shell that can be
 * navigated is a shell that can be pointed at a page somebody else controls.
 * External links open in the user's real browser, where they belong.
 *
 * Loaded over a private `app://` scheme rather than file:// or a loopback HTTP
 * server. ES modules and the import map need a real origin, which file:// does
 * not usefully provide, and a loopback server would hand every other process
 * on the machine a port that serves the user's documents for as long as the
 * window is open. The scheme is registered standard and secure, so the page
 * gets a proper origin and a secure context while the only route to the disk
 * is the handler in protocol.cjs. See that file for the reasoning in full.
 */
const { app, BrowserWindow, shell, Menu, protocol } = require('electron');
const path = require('node:path');
const { SCHEME, ORIGIN, createHandler } = require('./protocol.cjs');

// Must be called before the app is ready: the scheme's privileges are fixed
// when the renderer process starts. `standard` gives the page a real origin so
// modules and the import map resolve; `secure` makes it a secure context, so
// the application behaves exactly as it does over https rather than through a
// degraded path that would need its own testing.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

// In a packaged build the application files sit beside this one inside the
// archive; in a checkout they are one level up. Both resolve to the directory
// that holds index.html.
const ROOT = require('node:fs').existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : path.join(__dirname, '..');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: '#0d1117',
    title: 'TesserCAD',
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });

  // Refuse to navigate anywhere but the app itself, and open anything else in
  // the user's browser. Both handlers are needed: the first covers links and
  // scripted navigation, the second covers target=_blank and window.open.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // A renderer that tries to attach a webview or a preload script is not doing
  // anything this application asks for.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/**
 * The menu is the standard editing and window menu with the developer tools
 * kept, because a tool that claims its data never leaves the machine should
 * let anyone open the network panel and confirm it.
 */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

// One instance, so two windows cannot fight over the same local storage.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, createHandler(ROOT));
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  // Deny every permission request. The application asks for none: no camera,
  // no microphone, no geolocation, no notifications, no clipboard read.
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
  });
}
