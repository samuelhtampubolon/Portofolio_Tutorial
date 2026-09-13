/**
 * A phone, with fingers rather than a mouse.
 *
 * Touch targets at least 40px, no input below 16px (which is what makes iOS
 * zoom on focus), pinch and two-finger pan, and a landscape layout that still
 * leaves a usable stage. None of this is visible to a desktop browser at a
 * narrow width, which is why the suite uses a real touch context.
 */
import { chromium, devices } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('touch');
const server = await serve();
const BASE = server.base;
const browser = await chromium.launch({ executablePath: CHROME,
  args: LAUNCH_ARGS });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: devices['iPhone 13']?.userAgent || 'iPhone' });
const page = await ctx.newPage();
const SYNTHETIC = /No active pointer with the given id/;   // from dispatchEvent, not a real touch
const errs = [];
page.on('pageerror', e => { if (!SYNTHETIC.test(e.message)) errs.push('PAGEERROR ' + e.message); });
page.on('console', m => { if (m.type() === 'error' && !SYNTHETIC.test(m.text())) errs.push(m.text()); });
const R = []; const check = (n, ok, x='') => R.push(`${ok?'PASS':'FAIL'}  ${n}${x?'  — '+x:''}`);

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
await page.waitForTimeout(1900);
await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(n => n.remove()));
await page.waitForTimeout(400);

// --- a raw multi-touch helper (Playwright's API is single-touch) ---
const touch = (page, type, points) => page.evaluate(([type, pts]) => {
  const el = document.elementFromPoint(pts[0].x, pts[0].y) || document.body;
  const mk = (p) => new Touch({ identifier: p.id, target: el, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y });
  const list = pts.map(mk);
  el.dispatchEvent(new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: list, bubbles: true, cancelable: true }));
}, [type, points]);

// pointer events are what the app listens to, so synthesise those directly
const ptr = (page, type, pts) => page.evaluate(([type, pts]) => {
  const cv = document.getElementById('viewport2d');
  for (const p of pts) {
    cv.dispatchEvent(new PointerEvent(type, {
      pointerId: p.id, pointerType: 'touch', isPrimary: p.id === 1,
      clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    }));
  }
}, [type, pts]);

/* 1. bottom-bar navigation */
await page.tap('#bottombar .bb-item:nth-child(2)');
await page.waitForTimeout(700);
check('bottom bar switches workspace', await page.evaluate(() => tesserCAD.workspace) === 'draft');

/* 2. single-finger tap draws */
await page.evaluate(() => tesserCAD.setDraftTool('rect'));
await page.waitForTimeout(300);
const cv = await page.locator('#viewport2d').boundingBox();
await page.touchscreen.tap(cv.x + 110, cv.y + 260);
await page.waitForTimeout(200);
await page.touchscreen.tap(cv.x + 280, cv.y + 430);
await page.waitForTimeout(400);
let n = await page.evaluate(async () => (await import('./src/core/doc.js')).store.doc.draw.entities.length);
check('tap-tap draws a rectangle', n >= 1, `${n} entities`);

/* 3. two-finger pinch zooms the drawing */
let before = await page.evaluate(() => tesserCAD.draft.view.scale);
await ptr(page, 'pointerdown', [{ id: 1, x: cv.x + 150, y: cv.y + 350 }, { id: 2, x: cv.x + 250, y: cv.y + 350 }]);
for (let k = 1; k <= 6; k++) {
  const spread = 50 + k * 18;
  await ptr(page, 'pointermove', [{ id: 1, x: cv.x + 200 - spread, y: cv.y + 350 }, { id: 2, x: cv.x + 200 + spread, y: cv.y + 350 }]);
  await page.waitForTimeout(30);
}
await ptr(page, 'pointerup', [{ id: 1, x: cv.x + 40, y: cv.y + 350 }, { id: 2, x: cv.x + 360, y: cv.y + 350 }]);
await page.waitForTimeout(250);
let after = await page.evaluate(() => tesserCAD.draft.view.scale);
check('two-finger pinch zooms the drawing', after > before * 1.5, `${before.toFixed(2)} → ${after.toFixed(2)}`);

/* 4. two-finger drag pans */
const cxBefore = await page.evaluate(() => tesserCAD.draft.view.cx);
await ptr(page, 'pointerdown', [{ id: 1, x: cv.x + 150, y: cv.y + 300 }, { id: 2, x: cv.x + 250, y: cv.y + 300 }]);
for (let k = 1; k <= 5; k++) {
  await ptr(page, 'pointermove', [{ id: 1, x: cv.x + 150 - k * 14, y: cv.y + 300 }, { id: 2, x: cv.x + 250 - k * 14, y: cv.y + 300 }]);
  await page.waitForTimeout(30);
}
await ptr(page, 'pointerup', [{ id: 1, x: cv.x + 80, y: cv.y + 300 }, { id: 2, x: cv.x + 180, y: cv.y + 300 }]);
await page.waitForTimeout(250);
const cxAfter = await page.evaluate(() => tesserCAD.draft.view.cx);
check('two-finger drag pans the drawing', Math.abs(cxAfter - cxBefore) > 1, `${cxBefore.toFixed(1)} → ${cxAfter.toFixed(1)}`);

/* 5. a gesture must not leave a stray entity behind */
const nAfterGestures = await page.evaluate(async () => (await import('./src/core/doc.js')).store.doc.draw.entities.length);
check('gestures do not create geometry', nAfterGestures === n, `${n} → ${nAfterGestures}`);

/* 6. long-press opens a context menu in 3D */
await page.tap('#bottombar .bb-item:nth-child(1)');
await page.waitForTimeout(800);
await page.evaluate(() => { const b = document.querySelector('#viewport3d canvas').getBoundingClientRect();
  window.__c = [b.left + b.width / 2, b.top + b.height / 2]; });
await page.evaluate(() => {
  const cv = document.querySelector('#viewport3d canvas');
  const [x, y] = window.__c;
  cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const cv = document.querySelector('#viewport3d canvas');
  const [x, y] = window.__c;
  cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
});
await page.waitForTimeout(400);
check('long-press opens the 3D context menu', await page.evaluate(() => document.querySelectorAll('.dropdown .menu-item').length) > 3);
await page.screenshot({ path: `${SHOTS}/mob-longpress.png` });
await page.evaluate(() => document.querySelectorAll('.dropdown').forEach(n => n.remove()));

/* 7. sheets open, resize the stage correctly, and close */
const stageH = () => page.evaluate(() => Math.round(document.getElementById('stage').getBoundingClientRect().height));
const h0 = await stageH();
await page.tap('#bottombar .bb-item:nth-child(4)'); await page.waitForTimeout(600);
check('panel sheet opens', await page.evaluate(() => !!document.querySelector('.sheet .panel-body')));
await page.tap('.sheet-close'); await page.waitForTimeout(600);
check('closing the sheet restores the stage height', await stageH() === h0, `${h0} → ${await stageH()}`);

/* 8. the More sheet reaches every menu */
await page.tap('#bottombar .bb-item:nth-child(5)'); await page.waitForTimeout(600);
const menuInfo = await page.evaluate(() => ({
  sections: document.querySelectorAll('.msec').length,
  quick: document.querySelectorAll('.sq-item').length,
  search: !!document.querySelector('.sheet-search'),
}));
check('More sheet exposes all 13 menus', menuInfo.sections === 13 && menuInfo.quick === 6 && menuInfo.search, JSON.stringify(menuInfo));
// every leaf runs
await page.evaluate(() => document.querySelectorAll('.msec').forEach(d => { d.open = true; }));
await page.waitForTimeout(300);
const leaves = await page.evaluate(() => document.querySelectorAll('.m-item').length);
check('menu sheet renders leaf commands', leaves > 70, `${leaves} items`);
await page.screenshot({ path: `${SHOTS}/mob-more-all.png` });
await page.tap('.sheet-close'); await page.waitForTimeout(500);

/* 9. touch sizing and no zoom-on-focus */
const a = await page.evaluate(() => {
  const bad = [];
  for (const e of document.querySelectorAll('button, .bb-item, .fab-btn, .tool, input, select')) {
    if (e.type === 'checkbox') continue;           // its .chk label row is the target
    const r = e.getBoundingClientRect();
    if (r.width && r.height && r.height < 40) bad.push(`${e.className || e.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  const f = [...document.querySelectorAll('input[type=text],input[type=number],input[type=search],select')].map(i => parseFloat(getComputedStyle(i).fontSize));
  return { bad: bad.length, worst: bad.slice(0, 3), minFont: f.length ? Math.min(...f) : 16 };
});
check('all controls meet the 40px touch minimum', a.bad === 0, a.worst.join(', '));
check('no input below 16px (iOS focus zoom)', a.minFont >= 16, `min ${a.minFont}px`);

/* 10. landscape */
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(800);
const land = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  stage: Math.round(document.getElementById('stage').getBoundingClientRect().height),
  bar: Math.round(document.getElementById('bottombar').getBoundingClientRect().height),
}));
check('landscape keeps a usable stage and no overflow', land.overflow === 0 && land.stage > 150, JSON.stringify(land));
await page.screenshot({ path: `${SHOTS}/mob-landscape.png` });

console.log('\n' + R.join('\n'));
console.log('\nerrors: ' + errs.length);
for (const e of [...new Set(errs)].slice(0, 8)) console.log('  - ' + e);
const failed = R.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${R.length - failed}/${R.length} checks passed`);
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
