/**
 * Tablet tier checks: layout, the dock, the compact menu, and touch reach.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('responsive');
const server = await serve();
const BASE = server.base;

const UA_PAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const SIZES = [
  ['ipad-mini-portrait', 744, 1133],
  ['small-tablet-portrait', 712, 1138],
  ['ipad-portrait', 820, 1180],
  ['ipad-landscape', 1180, 820],
  ['ipad-pro-portrait', 1024, 1366],
];

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: LAUNCH_ARGS,
});

const errors = [];
async function open(w, h, { touch = true, ua = UA_PAD } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, userAgent: ua });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    // OrbitControls calls setPointerCapture on synthetic pointer ids that the
    // CDP-driven input stack never opened. A test artifact, not an app bug.
    if (String(e).includes('setPointerCapture')) return;
    errors.push(String(e));
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.click('.modal-foot .btn.primary').catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(n => n.remove()));
  await page.waitForTimeout(250);
  return { ctx, page };
}

const probe = (page) => page.evaluate(() => {
  // Both panel heads carry a dock switch and only one panel is on screen, so
  // "is it offered" means any match is visible, not the first one in the DOM.
  const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => {
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  });
  const box = (sel) => {
    const e = document.querySelector(sel);
    const r = e?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null;
  };
  return {
    tier: document.documentElement.classList.contains('phone') ? 'phone'
      : document.documentElement.classList.contains('tablet') ? 'tablet' : 'desktop',
    dock: document.documentElement.dataset.dock,
    collapsed: document.getElementById('workarea').classList.contains('dock-collapsed'),
    menubar: vis('#menubar'),
    compact: vis('.menu-compact'),
    fullMenus: [...document.querySelectorAll('.menubar > button:not(.menu-compact)')].filter(b => getComputedStyle(b).display !== 'none').length,
    bottombar: vis('#bottombar'),
    fab: vis('#mobFab'),
    fabBtns: [...document.querySelectorAll('#mobFab .fab-btn')].map(b => b.getAttribute('aria-label')),
    dockSwitch: vis('.dock-switch'),
    left: box('#leftpanel'), right: box('#rightpanel'), stage: box('#stage'),
    ribbon: vis('#ribbon'),
    docChip: vis('.doc-chip'),
    scrollW: document.documentElement.scrollWidth,
    innerW: innerWidth,
  };
});

/* ------------------------------------------------- per-size layout checks */
for (const [name, w, h] of SIZES) {
  const { ctx, page } = await open(w, h);
  const r = await probe(page);
  ok(`${name}: gets the tablet tier`, r.tier === 'tablet', JSON.stringify({ tier: r.tier }));
  ok(`${name}: keeps a menu bar`, r.menubar && (r.compact || r.fullMenus >= 13));
  ok(`${name}: no phone bottom bar`, !r.bottombar);
  ok(`${name}: exactly one panel is docked`, (r.left.w > 0) !== (r.right.w > 0), JSON.stringify({ l: r.left.w, rr: r.right.w }));
  ok(`${name}: viewport keeps most of the width`, r.stage.w >= w * 0.55, `${r.stage.w} of ${w}`);
  ok(`${name}: viewport has real height`, r.stage.h > 240, String(r.stage.h));
  ok(`${name}: dock switch is offered`, r.dockSwitch);
  ok(`${name}: floating cluster is present`, r.fab && r.fabBtns.length >= 3);
  ok(`${name}: cluster carries the dock toggle`, r.fabBtns.some(l => /panel/i.test(l || '')), JSON.stringify(r.fabBtns));
  ok(`${name}: page does not scroll sideways`, r.scrollW <= r.innerW + 1, `${r.scrollW} > ${r.innerW}`);
  // The top bar packs a menu, three workspace tabs, the document chip and eight
  // actions into one row; at tablet widths the right end used to run off screen.
  const clipped = await page.evaluate(() => [...document.querySelectorAll('#topbar button, #topbar input')]
    .filter(e => getComputedStyle(e).display !== 'none')
    .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 0.5 || b.left < -0.5); })
    .map(e => (e.title || e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)));
  ok(`${name}: nothing in the top bar is cut off`, clipped.length === 0, JSON.stringify(clipped));
  await page.evaluate(() => { const c = document.getElementById('learnCard'); if (c) c.hidden = true; });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/tab-after-${name}.png` });
  await ctx.close();
}

/* ------------------------------------------------------ dock behaviour */
{
  const { ctx, page } = await open(820, 1180);
  const before = await probe(page);
  ok('dock starts on the properties panel', before.dock === 'right' && before.right.w > 0);

  await page.click('.dock-switch:visible .ds-btn[data-dock="left"]');
  await page.waitForTimeout(200);
  let r = await probe(page);
  ok('switching the dock shows the outline panel', r.dock === 'left' && r.left.w > 0 && r.right.w === 0);
  ok('switching the dock does not change the stage width', Math.abs(r.stage.w - before.stage.w) <= 1);

  await page.click('#mobFab .fab-btn[aria-label*="panel" i]:visible');
  await page.waitForTimeout(250);
  r = await probe(page);
  ok('the cluster collapses the dock', r.collapsed && r.left.w === 0 && r.right.w === 0);
  ok('collapsing gives the whole width to the viewport', r.stage.w >= 815, String(r.stage.w));

  await page.click('#mobFab .fab-btn[aria-label*="panel" i]:visible');
  await page.waitForTimeout(250);
  r = await probe(page);
  ok('the cluster brings the dock back', !r.collapsed && r.left.w > 0);

  // the keyboard shortcuts drive the same dock
  await page.keyboard.press('n');
  await page.waitForTimeout(200);
  r = await probe(page);
  ok('N docks the properties panel', r.dock === 'right' && r.right.w > 0);
  await page.keyboard.press('n');
  await page.waitForTimeout(200);
  r = await probe(page);
  ok('N again puts the dock away', r.collapsed);

  // the dock choice survives a reload
  await page.click('#mobFab .fab-btn[aria-label*="panel" i]:visible');
  await page.waitForTimeout(150);
  await page.click('.dock-switch:visible .ds-btn[data-dock="left"]');
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(n => n.remove()));
  r = await probe(page);
  ok('the dock choice is remembered', r.dock === 'left' && r.left.w > 0);
  await ctx.close();
}

/* ------------------------------------------------- the compact menu */
{
  const { ctx, page } = await open(820, 1180);
  await page.click('.menu-compact');
  await page.waitForTimeout(200);
  let m = await page.evaluate(() => {
    const d = document.querySelector('.dropdown');
    return d ? { rows: [...d.querySelectorAll('.menu-item')].map(r => r.querySelector('.mi-label')?.textContent), arrows: d.querySelectorAll('.mi-arrow').length } : null;
  });
  ok('the compact menu holds all thirteen menus', m && m.rows.length === 13 && m.arrows === 13, JSON.stringify(m && m.rows));

  // tap a row: the submenu must open without a hover event
  await page.click('.dropdown .menu-item:has-text("Create")');
  await page.waitForTimeout(220);
  const sub = await page.evaluate(() => {
    const s = document.querySelector('.dropdown.submenu');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { items: s.querySelectorAll('.menu-item').length, x: Math.round(r.x), right: Math.round(r.right), fits: r.right <= innerWidth && r.left >= 0 };
  });
  ok('tapping a menu opens its submenu', sub && sub.items > 3, JSON.stringify(sub));
  ok('the submenu stays on screen', sub && sub.fits, JSON.stringify(sub));

  // tap back into the parent menu: it must not close the whole dropdown
  await page.click('.dropdown:not(.submenu) .menu-item:has-text("View")');
  await page.waitForTimeout(220);
  const still = await page.evaluate(() => ({
    root: !!document.querySelector('.dropdown:not(.submenu)'),
    subs: document.querySelectorAll('.dropdown.submenu').length,
  }));
  ok('tapping back into the parent keeps the menu open', still.root && still.subs === 1, JSON.stringify(still));

  // and a leaf command actually runs
  await page.click('.dropdown.submenu .menu-item:not([disabled]) >> nth=0');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ open: !!document.querySelector('.dropdown') }));
  ok('a submenu command runs and closes the menu', !after.open);
  await ctx.close();
}

/* -------------------- the floating cluster's view control and long-press */
{
  const { ctx, page } = await open(820, 1180);
  await page.click('#mobFab .fab-btn[aria-label*="Views" i]');
  await page.waitForTimeout(250);
  const pop = await page.evaluate(() => {
    const d = document.querySelector('.dropdown');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      items: d.querySelectorAll('.menu-item').length,
      groups: [...d.querySelectorAll('.grp')].map(g => g.textContent),
      onScreen: r.right <= innerWidth + 1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.top >= -1,
    };
  });
  // The bottom sheets are styled only inside the phone breakpoint, so the tablet
  // must reach these commands some other way or they are unstyled and unusable.
  ok('the cluster opens a real view popover, not a phone sheet', pop && pop.items === 18, JSON.stringify(pop && pop.items));
  ok('the view popover is grouped and on screen', pop && pop.groups.length === 3 && pop.onScreen, JSON.stringify(pop));
  ok('no bottom sheet was opened', await page.evaluate(() => !document.querySelector('.sheet')));

  await page.click('.dropdown .menu-item:has-text("Front")');
  await page.waitForTimeout(400);
  ok('a view command runs from the popover', await page.evaluate(() => !document.querySelector('.dropdown')));

  // Long-press stands in for right-click on a touch screen. Synthesised as real
  // touch PointerEvents: the CDP mouse never carries pointerType 'touch'.
  await page.evaluate(() => {
    const cv = document.querySelector('#viewport3d canvas');
    const b = cv.getBoundingClientRect();
    window.__lp = [cv, b.left + b.width / 2, b.top + b.height / 2];
    cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: window.__lp[1], clientY: window.__lp[2], bubbles: true }));
  });
  await page.waitForTimeout(720);
  await page.evaluate(() => {
    const [cv, x, y] = window.__lp;
    cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
  });
  await page.waitForTimeout(350);
  ok('long-press opens the viewport menu', await page.evaluate(() => !!document.querySelector('.dropdown')));
  await ctx.close();
}

/* --------------------------------- touch targets and the three workspaces */
{
  const { ctx, page } = await open(820, 1180);
  for (const ws of ['draft', 'sim', 'model']) {
    await page.evaluate((w) => window.tesserCAD.setWorkspace(w), ws);
    await page.waitForTimeout(500);
    const r = await probe(page);
    ok(`${ws}: viewport still has height`, r.stage.h > 220, String(r.stage.h));
    ok(`${ws}: no sideways scroll`, r.scrollW <= r.innerW + 1, `${r.scrollW} > ${r.innerW}`);
  }
  const small = await page.evaluate(() => {
    const sel = '#ribbon .tool, .menubar > button, #topActions .icon-btn, .ws, .fab-btn, .dock-switch .ds-btn, .mini-btn';
    return [...document.querySelectorAll(sel)]
      .filter(e => getComputedStyle(e).display !== 'none')
      .map(e => { const r = e.getBoundingClientRect(); return { t: (e.title || e.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(b => b.w > 0 && (b.w < 28 || b.h < 28));
  });
  ok('every visible control clears 28px', small.length === 0, JSON.stringify(small.slice(0, 8)));
  await ctx.close();
}

/* -------------------------------- the tiers above and below stay intact */
{
  const { ctx, page } = await open(1440, 900, { touch: false, ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' });
  const r = await probe(page);
  ok('desktop: tier is desktop', r.tier === 'desktop');
  ok('desktop: both panels are docked', r.left.w > 0 && r.right.w > 0);
  ok('desktop: full menu bar, no compact button', r.fullMenus >= 13 && !r.compact);
  ok('desktop: no phone bottom bar or floating cluster', !r.bottombar && !r.fab);
  await ctx.close();
}
{
  const { ctx, page } = await open(390, 844);
  const r = await probe(page);
  ok('phone: tier is phone', r.tier === 'phone');
  ok('phone: bottom bar and cluster are present', r.bottombar && r.fab);
  ok('phone: no menu bar', !r.menubar);
  ok('phone: viewport has height', r.stage.h > 300, String(r.stage.h));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
console.log('page errors:', errors.length, errors.slice(0, 5));
process.exit(fail || errors.length ? 1 : 0);
