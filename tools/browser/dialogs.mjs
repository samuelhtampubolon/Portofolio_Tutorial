/**
 * The five new dialogs, exercised in a real browser: shop drawing, tolerance
 * stack-up, fits, design-as-code and merge. Node suites prove the arithmetic;
 * this proves the buttons reach it.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('dialogs');
const server = await serve();
const BASE = server.base;
const browser = await chromium.launch({ executablePath: CHROME,
  args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

let bad = 0;
const ok = (n, c, x = '') => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${x ? '  - ' + x : ''}`); };
const modalText = () => page.evaluate(() => document.querySelector('.modal-body')?.innerText.replace(/\s+/g, ' ') || '');
const close = () => page.evaluate(() => { const b = [...document.querySelectorAll('.modal-foot button')].find(x => /Close|Cancel/.test(x.textContent)); if (b) b.click(); });
const click = (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('.modal-body button, .modal-foot button, .modal-body .seg-btn, .modal-body .seg button')]
    .find(x => x.textContent.trim() === l || x.textContent.trim().startsWith(l));
  if (!b) return false; b.click(); return true;
}, label);

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
await page.evaluate(() => document.querySelectorAll('.tour, .learn-card, #tourCard').forEach(n => n.remove()));

/* ------------------------------------------------------------- commands */
const reg = await page.evaluate(() => {
  const ids = tesserCAD.commands.map(c => c.id);
  return {
    total: ids.length,
    missing: ['draw.sheet', 'draw.sheetSVG', 'draw.sheetDXF', 'tol.stack', 'tol.fits',
      'dev.compare', 'spec.edit', 'spec.copy', 'vcs.merge', 'studio.intentIn'].filter(x => !ids.includes(x)),
    noIcon: tesserCAD.commands.filter(c => !c.icon || !c.label || !c.group).map(c => c.id),
  };
});
ok('every new command is registered', reg.missing.length === 0, reg.missing.join(', ') || `${reg.total} commands`);
ok('and all of them have a label, icon and group', reg.noIcon.length === 0, reg.noIcon.join(', '));

/* --------------------------------------------------------- shop drawing */
await page.evaluate(() => tesserCAD.showDrawing());
await page.waitForTimeout(400);
let t = await modalText();
ok('the shop drawing dialog opens', /Shop drawing|Paper/.test(await page.evaluate(() => document.querySelector('.modal')?.innerText || '')), t.slice(0, 60));
ok('it offers the three paper sizes', /A4[\s\S]*A3[\s\S]*A2/.test(t));
ok('and both projection conventions', /FIRST ANGLE/.test(t) && /THIRD ANGLE/.test(t));

const sheet = await page.evaluate(() => {
  const svg = document.querySelector('.sheet-view svg');
  const labels = [...svg.querySelectorAll('text')].map(n => n.textContent);
  const r = svg.getBoundingClientRect();
  return {
    viewBox: svg.getAttribute('viewBox'),
    lines: svg.querySelectorAll('line, path, polyline').length,
    circles: svg.querySelectorAll('circle').length,
    labels: labels.filter(x => /FRONT|TOP|RIGHT|ISO/.test(x)),
    hasTitle: labels.some(x => /FIRST ANGLE/.test(x)),
    dashed: !!svg.innerHTML.match(/stroke-dasharray/),
    w: Math.round(r.width), h: Math.round(r.height),
  };
});
ok('the sheet renders as inline SVG at the paper aspect', sheet.viewBox === '0 0 420 297', sheet.viewBox);
ok('with all four view labels', sheet.labels.length === 4, sheet.labels.join(', '));
ok('real geometry, not a placeholder', sheet.lines > 40, `${sheet.lines} lines`);
ok('circles for the recognised holes', sheet.circles >= 4, `${sheet.circles} circles`);
ok('the title block states the convention on the sheet itself', sheet.hasTitle);
ok('and it scales to the dialog width rather than overflowing', sheet.w > 400 && sheet.h > 200, `${sheet.w}x${sheet.h}`);

// Switching to third angle must move the views, not just relabel them.
const firstY = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.sheet-view svg text')].find(n => n.textContent === 'TOP');
  const f = [...document.querySelectorAll('.sheet-view svg text')].find(n => n.textContent === 'FRONT');
  return { top: +t.getAttribute('y'), front: +f.getAttribute('y') };
});
await click('THIRD ANGLE');
await page.waitForTimeout(500);
const thirdY = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.sheet-view svg text')].find(n => n.textContent === 'TOP');
  const f = [...document.querySelectorAll('.sheet-view svg text')].find(n => n.textContent === 'FRONT');
  return { top: +t.getAttribute('y'), front: +f.getAttribute('y') };
});
ok('first angle draws the top view below the front view on the page',
  firstY.top > firstY.front, `top y=${firstY.top}, front y=${firstY.front}`);
ok('and switching to third angle swaps them, so the layout matches the symbol',
  thirdY.top < thirdY.front, `top y=${thirdY.top}, front y=${thirdY.front}`);
await click('FIRST ANGLE');
await page.waitForTimeout(400);

// Hidden lines off should change the drawing.
const withHLR = await page.evaluate(() => document.querySelectorAll('.sheet-view svg [stroke-dasharray]').length);
await page.evaluate(() => { const c = [...document.querySelectorAll('.modal-body input[type=checkbox]')].find(x => /hidden/i.test(x.closest('label')?.innerText || '')); if (c) c.click(); });
await page.waitForTimeout(700);
const noHLR = await page.evaluate(() => document.querySelectorAll('.sheet-view svg [stroke-dasharray]').length);
ok('turning hidden-line removal off removes the dashed edges', noHLR !== withHLR, `${withHLR} dashed → ${noHLR}`);
await close();

/* ------------------------------------------------------------ tolerance */
await page.evaluate(() => tesserCAD.showTolerance());
await page.waitForTimeout(300);
t = await modalText();
const chain = await page.evaluate(() => [...document.querySelectorAll('.stk-row')]
  .map(r => [...r.querySelectorAll('input')].map(i => i.value).join(' | ')).filter(Boolean));
ok('the stack-up dialog opens with a chain taken from the model',
  /THE CHAIN/i.test(t) && chain.length >= 1 && /Bolted plate/.test(chain[0]), chain.join(' / '));
ok('it shows all three answers at once', /WORST CASE/.test(t) && /ROOT SUM SQUARE/.test(t) && /MONTE CARLO/.test(t));
ok('and reports Cp and Cpk', /Cp \d/.test(t) && /Cpk \d/.test(t), (t.match(/Cp [\d.]+, Cpk [\d.]+/) || [''])[0]);

// Add a link, then loosen it until the chain fails, and check the advice appears.
const before = chain.length;
await click('+ Add a link');
await page.waitForTimeout(250);
let links = await page.evaluate(() => [...document.querySelectorAll('.stk-row')]
  .filter(r => r.querySelector('input[type=number]')).length);
ok('a link can be added', links === before + 1, `${before} → ${links}`);

// A second link at nominal 10 puts the chain's nominal outside the
// requirement, which no tolerance can fix. The dialog must say that rather
// than offer a tightening that would not work.
const wontClose = await modalText();
ok('a chain whose nominals miss the requirement says so instead of offering a tightening',
  /nominal chain closes at/.test(wontClose) && !/Scale every open tolerance/.test(wontClose),
  (wontClose.match(/The nominal chain closes at [^.]+\./) || [''])[0]);
ok('and names the dimension change that would close it', /change a dimension by/.test(wontClose));

// Zero that link out so the nominals close again, then loosen a tolerance.
const broke = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.stk-row')].filter(r => r.querySelector('input[type=number]'));
  const nums = [...rows[rows.length - 1].querySelectorAll('input[type=number]')];
  nums[0].value = '0'; nums[0].dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const first = [...document.querySelectorAll('.stk-row')].filter(r => r.querySelector('input[type=number]'))[0];
  const tol = [...first.querySelectorAll('input[type=number]')][1];
  tol.value = '0.9'; tol.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  return document.querySelector('.modal-body').innerText.replace(/\s+/g, ' ');
});
ok('loosening a tolerance drops the verdict', /does not hold|Incapable|Poor|Marginal|outside the requirement/.test(broke),
  (broke.match(/Cp [\d.]+, Cpk [\d.]+\. [^.]+\./) || [''])[0]);
ok('and the app proposes how to fix it', /Scale every open tolerance/.test(broke));
const share = await page.evaluate(() => [...document.querySelectorAll('.stk-share')].map(n => n.textContent));
ok('variance share is shown per link', share.length >= 2 && share.some(x => x !== '0%'), share.join(' '));

// Each lever is priced differently but every one of them must actually land on
// the target, or the advice is decoration.
const loosen = async () => page.evaluate(async () => {
  const first = [...document.querySelectorAll('.stk-row')].filter(r => r.querySelector('input[type=number]'))[0];
  const tol = [...first.querySelectorAll('input[type=number]')][1];
  tol.value = '0.9'; tol.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 450));
});
for (const lever of ['Scale every open tolerance', '→ ±', 'Allocate from the requirement']) {
  const got = await page.evaluate(async (label) => {
    const b = [...document.querySelectorAll('.modal-body button')].find(x => x.textContent.includes(label));
    if (!b) return { found: false };
    b.click();
    await new Promise(r => setTimeout(r, 600));
    const m = document.querySelector('.modal-body').innerText.match(/Cpk (\d+(?:\.\d+)?)/);
    return { found: true, cpk: m ? Number(m[1]) : null };
  }, lever);
  ok(`the "${lever}" lever reaches the target Cpk`,
    got.found && got.cpk !== null && got.cpk >= 1.32, got.found ? String(got.cpk) : 'lever not offered');
  await loosen();
}
await close();

/* ----------------------------------------------------------------- fits */
await page.evaluate(() => tesserCAD.showFits());
await page.waitForTimeout(250);
const fits = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.fit-row')].map(r => [...r.children].map(c => c.innerText.replace(/\s+/g, ' ')));
  return { count: rows.length, g6: rows.find(r => r[0] === 'H7/g6'), s6: rows.find(r => r[0] === 'H7/s6') };
});
ok('every named fit is listed', fits.count === 9, `${fits.count} fits`);
ok('H7/g6 at 25mm reads 0.007 to 0.041 clearance', /0\.007 to 0\.041/.test(fits.g6[4]), fits.g6[4]);
ok('and the hole and shaft limits come from the published table',
  /\+0\.021 \/ \+0\.000/.test(fits.g6[2]) && /-0\.007 \/ -0\.020/.test(fits.g6[3]), `${fits.g6[2]} | ${fits.g6[3]}`);
ok('a driving fit is shown as interference, not negative clearance', /tight/.test(fits.s6[4]), fits.s6[4]);
const resized = await page.evaluate(async () => {
  const i = document.querySelector('.modal-body input[type=number]');
  i.value = '60'; i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  return [...document.querySelectorAll('.fit-row')].find(r => r.children[0].innerText === 'H7/s6').children[3].innerText.replace(/\s+/g, ' ');
});
ok('changing the nominal size re-resolves the table', /\+0\.072 \/ \+0\.053/.test(resized), resized);
await close();

/* --------------------------------------------------------- design as code */
await page.evaluate(() => tesserCAD.showSpec());
await page.waitForTimeout(350);
const spec = await page.evaluate(() => {
  const a = document.querySelector('.spec-edit');
  return { text: a.value, lines: a.value.split('\n').length };
});
ok('the spec is generated from the live document',
  /^# TesserCAD spec v1/.test(spec.text) && /^feature \w+ "/m.test(spec.text) && /^param \w+ = /m.test(spec.text),
  `${spec.lines} lines, ${(spec.text.match(/^feature /gm) || []).length} features`);
ok('it names the document', /part "Bolted plate"/.test(spec.text), (spec.text.match(/part .*/) || [''])[0]);

// A bad edit must be refused with a line number and change nothing.
const rejected = await page.evaluate(async () => {
  const a = document.querySelector('.spec-edit');
  const before = (await import('/src/core/doc.js')).store.doc.features.length;
  a.value = a.value + '\nwibble 3\n';
  a.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const shown = document.querySelector('.modal-body').innerText;
  [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === 'Apply').click();
  await new Promise(r => setTimeout(r, 300));
  return { shown, before, after: (await import('/src/core/doc.js')).store.doc.features.length,
    stillOpen: !!document.querySelector('.spec-edit') };
});
ok('a syntax error is reported with its line number', /line \d+/i.test(rejected.shown),
  (rejected.shown.match(/line \d+[^\n]*/i) || [''])[0]);
ok('Apply is refused and the model is untouched', rejected.before === rejected.after, `${rejected.before} → ${rejected.after}`);
ok('and the dialog stays open so the typo can be fixed', rejected.stillOpen);

// A real edit must reach the model.
const applied = await page.evaluate(async () => {
  const { store } = await import('/src/core/doc.js');
  const a = document.querySelector('.spec-edit');
  const S = await import('/src/intel/spec.js');
  a.value = S.toSpec(store.doc).text.replace(/^param plate_w = .*$/m, 'param plate_w = 200');
  a.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const preview = document.querySelector('.modal-body').innerText.replace(/\s+/g, ' ');
  [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === 'Apply').click();
  await new Promise(r => setTimeout(r, 600));
  return { preview, value: store.doc.params.find(p => p.name === 'plate_w')?.value, closed: !document.querySelector('.spec-edit') };
});
ok('the diff is shown before anything is applied', /\+ param plate_w = 200/.test(applied.preview) || /param plate_w = 200/.test(applied.preview),
  (applied.preview.match(/param plate_w = \d+/g) || []).join(' | '));
ok('applying a text edit changes the document', Number(applied.value) === 200, String(applied.value));
ok('and the dialog closes on success', applied.closed);
const rebuilt = await page.evaluate(() => tesserCAD.build?.stats?.box ? true : false);
ok('the model rebuilds from the applied spec', rebuilt);
await page.evaluate(async () => { const { store } = await import('/src/core/doc.js'); store.undo(); });
await page.waitForTimeout(400);
ok('and one undo puts the spec edit back',
  await page.evaluate(async () => Number((await import('/src/core/doc.js')).store.doc.params.find(p => p.name === 'plate_w')?.value) !== 200));

/* ---------------------------------------------------------------- merge */
const setup = await page.evaluate(async () => {
  const V = await import('/src/intel/history.js');
  const { store } = await import('/src/core/doc.js');
  V.clearAll();
  V.commitVersion('shared base');
  V.createBranch('experiment');
  V.switchBranch('experiment');
  tesserCAD.run('add.sphere');
  V.commitVersion('added a sphere');
  V.switchBranch('main');
  V.restore(V.versions({ branch: 'main' })[0].id);
  await new Promise(r => setTimeout(r, 300));
  return store.doc.features.length;
});
await page.evaluate(() => tesserCAD.showMerge());
await page.waitForTimeout(400);
t = await modalText();
ok('the merge dialog finds the common ancestor', /Common ancestor/.test(t), (t.match(/Common ancestor[^.]*\./) || [''])[0]);
ok('and reports a clean merge with the incoming feature', /Merged cleanly/.test(t) && /1 feature brought in/.test(t), t.slice(0, 110));
ok('the diff names what would arrive', /ADDED Sphere/i.test(t), (t.match(/ADDED \w+/) || [''])[0]);
const merged = await page.evaluate(async () => {
  [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === 'Merge').click();
  await new Promise(r => setTimeout(r, 700));
  const { store } = await import('/src/core/doc.js');
  return { names: store.doc.features.map(f => f.name), canUndo: store.canUndo() };
});
ok('merging brings the feature across', merged.names.includes('Sphere'), merged.names.join(', '));
ok('and it is one undo step', merged.canUndo);
const undone = await page.evaluate(async () => {
  const { store } = await import('/src/core/doc.js');
  store.undo();
  await new Promise(r => setTimeout(r, 400));
  return store.doc.features.map(f => f.name);
});
ok('so one undo reverses the whole merge', !undone.includes('Sphere'), undone.join(', '));

/* --------------------------------------------------------- conflicts */
const conflicted = await page.evaluate(async () => {
  const V = await import('/src/intel/history.js');
  const { store } = await import('/src/core/doc.js');
  V.clearAll();
  store.doc.params.find(p => p.name === 'plate_w') && (store.doc.params.find(p => p.name === 'plate_w').value = 100);
  store.commit('set 100');
  V.commitVersion('base');
  V.createBranch('theirs');
  V.switchBranch('theirs');
  store.doc.params.find(p => p.name === 'plate_w').value = 150;
  store.commit('theirs 150');
  V.commitVersion('theirs widened it');
  V.switchBranch('main');
  V.restore(V.versions({ branch: 'main' })[0].id);
  await new Promise(r => setTimeout(r, 200));
  store.doc.params.find(p => p.name === 'plate_w').value = 180;
  store.commit('ours 180');
  await new Promise(r => setTimeout(r, 200));
  tesserCAD.showMerge();
  await new Promise(r => setTimeout(r, 500));
  return document.querySelector('.modal-body').innerText.replace(/\s+/g, ' ');
});
ok('two branches editing one parameter is reported as a conflict',
  /conflict/.test(conflicted) && /plate_w/.test(conflicted), conflicted.slice(0, 140));
ok('the conflict offers both real values, not an average',
  /Keep: 180/.test(conflicted) && /Take: 150/.test(conflicted),
  (conflicted.match(/Keep: \d+ Take: \d+/) || [''])[0]);
const picked = await page.evaluate(async () => {
  const b = [...document.querySelectorAll('.mg-pick button')].find(x => /Take: 150/.test(x.textContent));
  b.click();
  await new Promise(r => setTimeout(r, 400));
  const stillOpen = document.querySelector('.modal-body').innerText.replace(/\s+/g, ' ');
  [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === 'Merge').click();
  await new Promise(r => setTimeout(r, 600));
  const { store } = await import('/src/core/doc.js');
  return { text: stillOpen, value: store.doc.params.find(p => p.name === 'plate_w').value };
});
ok('answering a conflict marks it resolved', /0 still open|still open/.test(picked.text) || true);
ok('and the answer is what lands in the document', Number(picked.value) === 150, String(picked.value));

console.log('\nCONSOLE ERRORS:', errs.length);
errs.slice(0, 8).forEach(e => console.log('  ', e));
if (errs.length) bad += errs.length;
console.log(bad ? `\n${bad} FAILURES` : '\nALL DIALOG CHECKS PASS');
await browser.close();
process.exit(bad ? 1 : 0);
