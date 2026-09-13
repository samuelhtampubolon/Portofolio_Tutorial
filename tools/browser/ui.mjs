/**
 * The interface: every command in the registry is run, and nothing throws.
 *
 * Two hundred and two commands generate six surfaces from one list, which is
 * the arrangement that makes the interface consistent and also the arrangement
 * where a single bad `run` is invisible until someone clicks it. So they are
 * all clicked here.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('ui');
const server = await serve();
const BASE = server.base;
const browser = await chromium.launch({ executablePath: CHROME,
  args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

const R = [];
const check = (n, ok, x = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`);

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 20000 });
await page.waitForTimeout(1700);
await page.click('.modal-foot .btn.primary').catch(() => {});
await page.waitForTimeout(300);

let s = await page.evaluate(() => ({
  cmds: tesserCAD.commands.length,
  menus: document.querySelectorAll('#menubar button:not(.menu-compact)').length,
  icons: document.querySelectorAll('svg').length,
}));
check('boot: registry, menus and icons', s.cmds > 150 && s.menus === 13 && s.icons > 60, JSON.stringify(s));

// Phone and tablet chrome living inside a media query is easy to override by
// accident, and when that happens the bottom bar lands on the desktop. Nothing
// was asserting it, so assert it here.
const chrome = await page.evaluate(() => {
  const shown = (sel) => {
    const e = document.querySelector(sel);
    return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
  };
  return {
    bottombar: shown('#bottombar'), fab: shown('#mobFab'),
    dockSwitch: shown('.dock-switch'), compact: shown('.menu-compact'),
    left: document.getElementById('leftpanel').getBoundingClientRect().width,
    right: document.getElementById('rightpanel').getBoundingClientRect().width,
  };
});
check('desktop shows no phone or tablet chrome',
  !chrome.bottombar && !chrome.fab && !chrome.dockSwitch && !chrome.compact, JSON.stringify(chrome));
check('desktop keeps both side panels', chrome.left > 100 && chrome.right > 100, JSON.stringify(chrome));

// 1. every menu opens and every leaf resolves to a real command
let leaves = 0, broken = [];
for (let i = 1; i <= 13; i++) {
  await page.click(`#menubar button:nth-child(${i})`);
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.dropdown .menu-item')];
    return { n: items.length, bad: items.filter(b => !b.querySelector('.mi-label')?.textContent?.trim()).length };
  });
  leaves += r.n;
  if (!r.n || r.bad) broken.push(`menu ${i}: ${r.n} items, ${r.bad} unlabelled`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}
check('all 13 menus populate with labelled items', broken.length === 0 && leaves > 90, `${leaves} items${broken.length ? ' · ' + broken.join('; ') : ''}`);

// 2. submenus open on hover
await page.click('#menubar button:nth-child(4)');
await page.waitForTimeout(150);
await page.hover('.dropdown .menu-item:has-text("Material")');
await page.waitForTimeout(250);
check('submenus open on hover', await page.evaluate(() => document.querySelectorAll('.dropdown').length) === 2);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes the menu', await page.evaluate(() => document.querySelectorAll('.dropdown').length) === 0);

// 3. ribbon in each workspace
for (const [ws, min] of [['model', 25], ['draft', 30], ['sim', 20]]) {
  await page.evaluate(w => tesserCAD.setWorkspace(w), ws);
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => ({
    groups: document.querySelectorAll('#ribbon .rb-group').length,
    tools: document.querySelectorAll('#ribbon .tool').length,
    unlabelled: [...document.querySelectorAll('#ribbon .tool .tx')].filter(t => !t.textContent.trim()).length,
  }));
  check(`ribbon: ${ws}`, r.groups >= 6 && r.tools >= min && r.unlabelled === 0, JSON.stringify(r));
}
await page.evaluate(() => tesserCAD.setWorkspace('model'));
await page.waitForTimeout(300);

// 4. modal transform operator: drag, axis lock, typed value, confirm and cancel
await page.evaluate(() => { tesserCAD.select([tesserCAD.build.topLevel[0].id]); tesserCAD.vp.standardView('iso'); tesserCAD.vp.frameAll(1.5); });
await page.waitForTimeout(700);
const box = await page.locator('#viewport3d canvas').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.keyboard.press('g');
await page.mouse.move(cx + 150, cy, { steps: 6 });
await page.waitForTimeout(200);
check('operator: HUD appears while moving', await page.evaluate(() => !document.getElementById('opHud').hidden));
await page.keyboard.press('x');
await page.keyboard.type('42');
await page.waitForTimeout(150);
check('operator: typed value shows', (await page.evaluate(() => document.getElementById('opHud').textContent)).includes('42'));
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
s = await page.evaluate(async () => {
  const { store } = await import('./src/core/doc.js');
  return store.feature(tesserCAD.build.topLevel[0].id).transform.pos;
});
check('operator: exact typed move is committed', Math.abs(s[0] - 42) < 0.01 && Math.abs(s[1]) < 0.01, JSON.stringify(s));

await page.mouse.move(cx, cy);
await page.keyboard.press('g');
await page.mouse.move(cx + 120, cy + 80, { steps: 5 });
await page.waitForTimeout(150);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
s = await page.evaluate(async () => {
  const { store } = await import('./src/core/doc.js');
  return store.feature(tesserCAD.build.topLevel[0].id).transform.pos;
});
check('operator: Escape restores the original pose', Math.abs(s[0] - 42) < 0.01, JSON.stringify(s));
await page.evaluate(async () => { const { store } = await import('./src/core/doc.js'); store.undo(); });
await page.waitForTimeout(400);

// 5. rotate + scale operators
for (const [key, prop, want] of [['r', 'rot', 30], ['s', 'scale', 2]]) {
  await page.mouse.move(cx, cy);
  await page.keyboard.press(key);
  await page.keyboard.press('z');
  await page.keyboard.type(String(want));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const v = await page.evaluate(async (p) => {
    const { store } = await import('./src/core/doc.js');
    return store.feature(tesserCAD.build.topLevel[0].id).transform[p];
  }, prop);
  check(`operator: ${key === 'r' ? 'rotate' : 'scale'} about Z`, Math.abs(v[2] - want) < 0.02, JSON.stringify(v));
  await page.evaluate(async () => { const { store } = await import('./src/core/doc.js'); store.undo(); });
  await page.waitForTimeout(300);
}

// 6. palette precision
await page.keyboard.press('Control+k');
await page.waitForTimeout(250);
await page.keyboard.type('extr');
await page.waitForTimeout(250);
s = await page.evaluate(() => {
  const li = [...document.querySelectorAll('.palette li:not(.palette-head)')];
  return { n: li.length, first: li[0]?.textContent || '' };
});
check('palette: ranks the exact match first and stays tight', s.n <= 6 && s.first.includes('Extrude'), JSON.stringify(s));
await page.keyboard.press('Escape');

// 7. quick menu
await page.waitForTimeout(150);
await page.keyboard.press('q');
await page.waitForTimeout(250);
check('quick menu opens with 8 entries', await page.evaluate(() => document.querySelectorAll('.quick-item').length) === 8);
await page.keyboard.press('Escape');

// 8. dialogs
for (const [cmd, sel, name] of [
  ['edit.prefs', '.modal', 'Preferences'],
  ['edit.history', '.modal', 'Undo history'],
  ['file.template', '.card-grid .card', 'Templates'],
  ['measure.mass', '.modal table', 'Mass report'],
  ['help.shortcuts', '.kbd-grid', 'Shortcuts'],
  ['help.expressions', '.modal', 'Expression help'],
  ['help.about', '.modal', 'About'],
]) {
  await page.evaluate(c => tesserCAD.run(c), cmd);
  await page.waitForTimeout(280);
  const ok = await page.evaluate(q => !!document.querySelector(q), sel);
  check(`dialog: ${name}`, ok);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

// 9. viewport context menu
await page.mouse.click(cx, cy, { button: 'right' });
await page.waitForTimeout(300);
check('right-click opens the viewport context menu', await page.evaluate(() => document.querySelectorAll('.dropdown .menu-item').length) > 5);
await page.keyboard.press('Escape');

// 10. templates all build
s = await page.evaluate(async () => {
  const { TEMPLATES } = await import('./src/ui/commands.js');
  const { store } = await import('./src/core/doc.js');
  const { rebuild, invalidateCache } = await import('./src/core/rebuild.js');
  const out = [];
  for (const t of TEMPLATES) {
    try {
      invalidateCache();
      const doc = t.build();
      const r = rebuild(doc);
      const bad = [...r.results.values()].filter(x => x.error);
      out.push({ id: t.id, bodies: r.stats.bodies, tris: r.stats.tris, errors: bad.map(b => b.name + ': ' + b.error) });
    } catch (e) { out.push({ id: t.id, errors: ['THREW ' + e.message] }); }
  }
  void store;
  return out;
});
const badT = s.filter(t => t.errors.length || (t.id !== 'blank' && !t.bodies));
check('all 6 templates build cleanly', badT.length === 0, badT.length ? JSON.stringify(badT) : s.map(t => `${t.id}:${t.bodies}`).join(' '));

// 11. isolate / hide / show-all
await page.evaluate(() => { tesserCAD.setWorkspace('model'); tesserCAD.select([tesserCAD.build.topLevel[0].id]); tesserCAD.run('mod.isolate'); });
await page.waitForTimeout(300);
check('isolate hides the other bodies', await page.evaluate(() => !!tesserCAD.isolated));
await page.evaluate(() => tesserCAD.run('mod.isolate'));
await page.waitForTimeout(200);
check('isolate toggles back off', await page.evaluate(() => !tesserCAD.isolated));

// 12. align + distribute need real geometry
s = await page.evaluate(async () => {
  const { store } = await import('./src/core/doc.js');
  tesserCAD.run('add.box'); await new Promise(r => setTimeout(r, 250));
  tesserCAD.run('add.cylinder'); await new Promise(r => setTimeout(r, 250));
  const ids = tesserCAD.build.topLevel.slice(-2).map(f => f.id);
  store.edit('spread', (d) => {
    d.features.find(f => f.id === ids[0]).transform.pos = [0, 0, 20];
    d.features.find(f => f.id === ids[1]).transform.pos = [80, 40, 20];
  });
  await new Promise(r => setTimeout(r, 400));
  tesserCAD.select(ids);
  tesserCAD.run('xf.alignY');
  await new Promise(r => setTimeout(r, 400));
  return ids.map(i => store.feature(i).transform.pos[1]);
});
check('align on Y brings bodies to a common Y', Math.abs(s[0] - s[1]) < 0.05, JSON.stringify(s));

// 13. theme + responsive
await page.evaluate(() => tesserCAD.toggleTheme());
await page.waitForTimeout(400);
check('light theme applies', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light'));
await page.screenshot({ path: `${SHOTS}/ui-light.png` });
await page.evaluate(() => tesserCAD.toggleTheme());
await page.waitForTimeout(300);

await page.setViewportSize({ width: 420, height: 820 });
await page.waitForTimeout(600);
s = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
  bsw: document.body.scrollWidth,
}));
check('no horizontal overflow at 420px', s.sw <= s.cw + 1 && s.bsw <= s.cw + 1, JSON.stringify(s));
await page.screenshot({ path: `${SHOTS}/ui-mobile.png` });
await page.setViewportSize({ width: 1560, height: 950 });
await page.waitForTimeout(400);

// 14. run every command that is safe headlessly
const skip = new Set(['file.new','file.open','file.import','file.sample','file.template','file.revert','file.clearAutosave','file.autosave',
  'sim.record','help.guide','help.source','help.issue','view.fullscreen','add.import','mod.colour','win.zen']);
const ran = await page.evaluate(async (sk) => {
  const skip = new Set(sk);
  URL.createObjectURL = () => 'blob:stub';
  HTMLAnchorElement.prototype.click = function () {};
  const out = [];
  for (const c of tesserCAD.commands) {
    if (skip.has(c.id)) continue;
    try { c.run(); } catch (e) { out.push(`${c.id}: ${e.message}`); }
    document.querySelectorAll('.modal-back').forEach(n => n.remove());
    await new Promise(r => setTimeout(r, 6));
  }
  return out;
}, [...skip]);
await page.waitForTimeout(1200);
check('every command runs without throwing', ran.length === 0, ran.slice(0, 4).join(' | '));

console.log('\n' + R.join('\n'));
console.log('\nCONSOLE ERRORS: ' + errs.length);
for (const e of [...new Set(errs)].slice(0, 12)) console.log('  - ' + e);
const failed = R.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${R.length - failed}/${R.length} checks passed`);
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
