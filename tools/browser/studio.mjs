/**
 * The design-intelligence layer: doctor, repairs, cost, release, macros,
 * standards, brief and the why-tutor.
 *
 * Modules are reached with a dynamic import inside the page rather than a
 * global test hook, so nothing here exists in the shipped application.
 */
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS, serve, shotsDir, watchdog } from './harness.mjs';

watchdog();

const CHROME = chromePath();
const SHOTS = shotsDir('studio');
const server = await serve();
const BASE = server.base;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: LAUNCH_ARGS,
});
const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

const R = [];
const check = (n, ok, x = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  - ' + x : ''}`);

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.tesserCAD?.build, null, { timeout: 25000 });
await page.waitForTimeout(1700);
await page.click('.modal-foot .btn.primary').catch(() => {});
await page.waitForTimeout(300);

// One import of every module under test, hung off the window for later steps.
await page.evaluate(async () => {
  window.M = {
    doc: await import('./src/core/doc.js'),
    doctor: await import('./src/intel/doctor.js'),
    cost: await import('./src/intel/cost.js'),
    release: await import('./src/intel/release.js'),
    studio: await import('./src/intel/standards.js'),
    brief: await import('./src/intel/brief.js'),
    why: await import('./src/intel/why.js'),
    process: await import('./src/intel/process.js'),
  };
  window.__dl = [];
  URL.createObjectURL = (blob) => { window.__lastBlob = blob; return 'blob:stub'; };
  HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); };
});

/* ------------------------------------------------------- 1. the doctor runs */
const d = await page.evaluate(() => {
  const r = window.tesserCAD.report;
  return r ? { checked: r.checked, issues: r.issues.length, counts: r.counts } : null;
});
check('the doctor runs on every rebuild', d && d.checked >= 14, JSON.stringify(d));
check('the demo model has no blocking findings', d && d.counts.block === 0, JSON.stringify(d && d.counts));

const badge = await page.evaluate(() => {
  const b = document.getElementById('statusDoctor');
  return b && !b.hidden ? { text: b.textContent.trim(), cls: b.className } : null;
});
check('the status bar carries the verdict', !!badge && /pass|note|warning|blocking/i.test(badge.text), JSON.stringify(badge));

const panel = await page.evaluate(() =>
  [...document.querySelectorAll('#rightpanel .sec-title')].some(t => /design doctor/i.test(t.textContent)));
check('findings live in the panel, not behind a dialog', panel);

/* --------------------------------------- 2. a real defect is found and fixed */
await page.evaluate(() => {
  const { store, makeFeature } = window.M.doc;
  store.edit('test tube', (doc) => {
    doc.features.push(makeFeature('tube', { name: 'Thin tube', params: { ro: 20, ri: 19.9, h: 40 } }));
  });
});
await page.waitForTimeout(900);
const thin = await page.evaluate(() => {
  const i = window.tesserCAD.report.issues.find(x => x.check === 'thin-wall');
  return i ? { title: i.title, hasFix: !!i.fix, whyLen: i.why.length } : null;
});
check('a wall under the process minimum is caught', !!thin, JSON.stringify(thin));
check('the finding explains why, not just what', !!thin && thin.whyLen > 40);
check('the finding carries a repair', !!thin && thin.hasFix);

const fixed = await page.evaluate(() => {
  const app = window.tesserCAD;
  const f = () => window.M.doc.store.doc.features.find(x => x.name === 'Thin tube').params.ri;
  const before = f();
  app.applyFix(app.report.issues.find(x => x.check === 'thin-wall'));
  return { before, after: f(), canUndo: window.M.doc.store.canUndo() };
});
check('the repair opens the wall', fixed.after < fixed.before, JSON.stringify(fixed));
check('the repair is undoable', fixed.canUndo);

await page.waitForTimeout(800);
const gone = await page.evaluate(() => !window.tesserCAD.report.issues.some(x => x.check === 'thin-wall'));
check('the finding clears once repaired', gone);
check('applying a repair writes to the decision log',
  await page.evaluate(() => window.M.studio.decisions().length) > 0);

/* --------------------------------------------- 3. a failed feature self-heals */
await page.evaluate(() => {
  const { store, makeFeature } = window.M.doc;
  store.edit('broken boolean', (doc) => {
    doc.features = doc.features.filter(f => f.name !== 'Thin tube');
    doc.features.push(makeFeature('boolean', { name: 'Orphan', params: { op: 'union' }, inputs: [] }));
  });
});
await page.waitForTimeout(900);
const heal = await page.evaluate(() => {
  const i = window.tesserCAD.report.issues.find(x => x.check === 'feature-failed');
  return i ? { title: i.title, whyLen: i.why.length, fix: i.fix?.label || null } : null;
});
check('a failed feature is diagnosed, not just reported', !!heal && heal.whyLen > 40, JSON.stringify(heal));
check('the diagnosis proposes a named repair', !!heal && !!heal.fix, JSON.stringify(heal && heal.fix));

const healed = await page.evaluate(() => {
  const app = window.tesserCAD;
  app.applyFix(app.report.issues.find(x => x.check === 'feature-failed'));
  return window.M.doc.store.doc.features.find(f => f.name === 'Orphan').inputs.length;
});
check('the repair reconnects the lost inputs', healed === 2, String(healed));
await page.evaluate(() => { window.M.doc.store.undo(); window.M.doc.store.undo(); });
await page.waitForTimeout(900);

/* ----------------------------------------------------------- 4. the cost model */
const cost = await page.evaluate(() => {
  const app = window.tesserCAD;
  const { parts, batch, rates } = app.costInputs();
  const { costDocument, compare, crossovers } = window.M.cost;
  const one = compare(parts[0], { batch: 1, rates });
  const many = compare(parts[0], { batch: 10000, rates });
  return {
    parts: parts.length,
    doc: costDocument(parts, { batch, rates }).each,
    eachOne: one.best.each, eachMany: many.best.each,
    rows: one.rows.length,
    crossings: crossovers(parts[0], { rates }).changes.length,
    driver: one.best.drivers[0].key,
  };
});
check('the cost model prices every body', cost.parts > 0 && cost.doc > 0, JSON.stringify(cost));
check('it compares more than one process', cost.rows >= 2, String(cost.rows));
check('unit cost falls with quantity', cost.eachMany < cost.eachOne, `${cost.eachOne.toFixed(2)} to ${cost.eachMany.toFixed(2)}`);
check('it names the dominant cost driver', !!cost.driver, cost.driver);

// A process has to suit the shape, not just the material: sheet is cheap per
// kilogram and would otherwise win for parts that are not sheet parts at all.
const shape = await page.evaluate(() => {
  const { compare } = window.M.cost;
  const { processFitsShape, processFitsEnvelope } = window.M.process;
  const flat = { material: 'aluminium', volume: 140 * 90 * 6 * 0.9, area: 0, box: { x: 140, y: 90, z: 6 } };
  const round = { material: 'aluminium', volume: 40000, area: 0, box: { x: 36, y: 36, z: 50 } };
  const huge = { material: 'aluminium', volume: 5e8, area: 0, box: { x: 900, y: 900, z: 700 } };
  return {
    flatSheet: processFitsShape('sheet', flat),
    roundSheet: processFitsShape('sheet', round),
    roundBest: compare(round, { batch: 1 }).best.processId,
    hugeCnc: processFitsEnvelope('cnc3', huge),
    hugeRows: compare(huge, { batch: 1 }).rows.length,
    hugeFallback: compare(huge, { batch: 1 }).constrained,
  };
});
check('a flat plate may be laser cut', shape.flatSheet);
check('a round sleeve may not', !shape.roundSheet && shape.roundBest !== 'sheet', JSON.stringify(shape));
check('a part too big for a machine is excluded', !shape.hugeCnc);
check('an impossible part still gets an answer, flagged', shape.hugeRows > 0 && shape.hugeFallback === false, JSON.stringify(shape));

// .modal-body is a flex column, so a tall .sec is a flex item that gets shrunk
// below its content and clipped by its own overflow:hidden. Every dialog with a
// long section was losing its bottom rows to this.
const clipping = await page.evaluate(() => {
  window.tesserCAD.showCostReport();
  const bad = [];
  for (const sec of document.querySelectorAll('.modal .sec')) {
    if (!sec.open) continue;
    const body = sec.querySelector('.sec-body');
    const head = sec.querySelector('summary');
    const want = body.getBoundingClientRect().height + head.getBoundingClientRect().height;
    const got = sec.getBoundingClientRect().height;
    if (got + 1 < want) bad.push(`${sec.querySelector('.sec-title')?.textContent}: ${Math.round(got)} of ${Math.round(want)}`);
  }
  document.querySelectorAll('.modal-back').forEach(n => n.remove());
  return bad;
});
check('no dialog section is clipped by the flex layout', clipping.length === 0, JSON.stringify(clipping));

/* ------------------------------------------------- 5. the release package */
const rel = await page.evaluate(() => {
  window.__dl = [];
  const out = window.M.release.releasePackage(window.tesserCAD, { force: true });
  return { ok: out.ok, name: out.name, files: out.files, downloaded: window.__dl };
});
check('release builds one archive', rel.ok && /\.zip$/.test(rel.name || ''), rel.name);
for (const want of ['model.stl', 'model.obj', 'design-intent.json', 'bom.csv', 'checks.csv', 'cost-estimate.csv', 'README.md', 'preview.png']) {
  check(`the package contains ${want}`, rel.files.includes(want));
}
check('the package contains the editable source', rel.files.some(f => f.endsWith('.tcad')), JSON.stringify(rel.files));
check('exactly one file is handed to the browser', rel.downloaded.length === 1, JSON.stringify(rel.downloaded));

const zipOK = await page.evaluate(async () => {
  const u8 = new Uint8Array(await window.__lastBlob.arrayBuffer());
  const at = (i) => u8[i];
  const tail = u8.length - 22;
  return {
    size: u8.length,
    local: at(0) === 0x50 && at(1) === 0x4b && at(2) === 3 && at(3) === 4,
    eocd: at(tail) === 0x50 && at(tail + 1) === 0x4b && at(tail + 2) === 5 && at(tail + 3) === 6,
    count: at(tail + 10) | (at(tail + 11) << 8),
    type: window.__lastBlob.type,
  };
});
check('the archive is a structurally valid zip', zipOK.local && zipOK.eocd, JSON.stringify(zipOK));
check('its directory counts every file', zipOK.count === rel.files.length, `${zipOK.count} vs ${rel.files.length}`);

// A blocking finding must stop a release that has not been forced.
await page.evaluate(() => {
  const { store, makeFeature } = window.M.doc;
  store.edit('break it', (d) => { d.features.push(makeFeature('boolean', { name: 'Broken', params: { op: 'union' }, inputs: [] })); });
});
await page.waitForTimeout(900);
const refused = await page.evaluate(() => {
  const out = window.M.release.releasePackage(window.tesserCAD, { force: false });
  return { ok: out.ok, blocked: out.blocked?.length || 0 };
});
check('a blocking finding refuses the release', !refused.ok && refused.blocked > 0, JSON.stringify(refused));
await page.evaluate(() => window.M.doc.store.undo());
await page.waitForTimeout(900);

/* ------------------------------------------------------- 6. design intent */
const intent = await page.evaluate(() => {
  const app = window.tesserCAD;
  const di = window.M.release.designIntent(window.M.doc.store.doc, app.build);
  return {
    format: di.format,
    params: di.parameters.length,
    resolved: di.parameters.every(p => p.resolved !== null),
    features: di.features.length,
    driven: di.features.filter(f => f.drivenBy.length).length,
    consumes: di.features.some(f => f.consumes.length),
    hasMass: di.measured.massKg > 0,
    units: !!di.document.unitDefinition,
  };
});
check('design intent carries parameters with resolved values', intent.params > 0 && intent.resolved, JSON.stringify(intent));
check('design intent records which parameter drives each feature', intent.driven > 0, String(intent.driven));
check('design intent records feature relationships by name', intent.consumes);
check('design intent states its units explicitly', intent.units);

/* --------------------------------------------------------------- 7. macros */
const macro = await page.evaluate(() => {
  const app = window.tesserCAD;
  app.macro.start('Test macro');
  app.run('add.box');
  app.run('add.cylinder');
  app.run('file.open');          // unrecordable: opens a picker
  const rec = app.macro.recording.steps.length;
  const skipped = app.macro.recording.skipped.length;
  const m = app.macro.stop();
  return { rec, skipped, saved: m && m.steps.length, name: m && m.name };
});
check('the recorder captures commands from any surface', macro.rec === 2, JSON.stringify(macro));
check('it refuses commands that cannot replay', macro.skipped === 1, String(macro.skipped));
check('stopping saves the macro', macro.saved === 2 && macro.name === 'Test macro', JSON.stringify(macro));

const replay = await page.evaluate(() => {
  const app = window.tesserCAD;
  const store = window.M.doc.store;
  const before = store.doc.features.length;
  const depth = store.depth;
  const out = app.macro.run(app.macro.list.at(-1));
  const after = store.doc.features.length;
  store.undo();
  return { before, after, added: after - before, ran: out.ran, grew: store.depth + 1 - depth, restored: store.doc.features.length };
});
check('replaying a macro re-runs its commands', replay.added === 2 && replay.ran === 2, JSON.stringify(replay));
check('a whole macro is one undo step', replay.grew === 1, String(replay.grew));
check('undoing a macro restores the model', replay.restored === replay.before, JSON.stringify(replay));
await page.waitForTimeout(700);

/* ----------------------------------------------------------- 8. standards */
const std = await page.evaluate(() => {
  const S = window.M.studio;
  S.setStandard('minWall', 5);
  S.setStandard('process', 'fdm');
  const lim = S.limits(window.M.process.processOf('fdm'));
  const round = JSON.parse(S.exportStudio());
  S.setStandard('minWall', null);
  return { minWall: lim.minWall, minFeature: lim.minFeature, exported: round.kind, hasStandards: !!round.standards };
});
check('a house minimum overrides the process default', std.minWall === 5, JSON.stringify(std));
check('an unset limit falls back to the process', std.minFeature === 0.8, String(std.minFeature));
check('the studio exports as one portable file', std.exported === 'studio' && std.hasStandards);

const persisted = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tessercad.studio.v1'));
  return { process: raw.standards.process, decisions: raw.decisions.length, macros: raw.macros.length };
});
check('standards, decisions and macros all persist', persisted.process === 'fdm' && persisted.decisions > 0 && persisted.macros > 0, JSON.stringify(persisted));

/* ------------------------------------------------------- 9. the design brief */
const brief = await page.evaluate(() => {
  const B = window.M.brief;
  const out = {};
  for (const id of B.ARCHETYPE_IDS) {
    const defs = Object.fromEntries(B.ARCHETYPES[id].fields.map(f => [f.key, f.def]));
    const r = B.synthesise(id, defs, { material: 'aluminium', process: 'cnc3' });
    out[id] = { params: r.params.length, feats: r.features.length, rationale: r.rationale.length };
  }
  const grab = (load) => Number(B.synthesise('bracket', { load, arm: 80, width: 40, sf: 2.5, bolt: 'M6' }, { material: 'aluminium' })
    .rationale.join(' ').match(/Required thickness ([\d.]+)/)[1]);
  const lt = grab(100), ht = grab(1600);
  return { out, lt, ht, ratio: ht / lt };
});
check('every archetype synthesises', Object.values(brief.out).every(o => o.params >= 5 && o.feats >= 1 && o.rationale >= 3), JSON.stringify(brief.out));
// bending thickness goes as the square root of load, so 16x load is 4x thickness
check('sizing follows the requirement, not a template', Math.abs(brief.ratio - 4) < 0.05,
  `${brief.lt} to ${brief.ht} (x${brief.ratio.toFixed(2)}, expected x4)`);

const built = await page.evaluate(() => {
  const app = window.tesserCAD;
  const B = window.M.brief;
  const defs = Object.fromEntries(B.ARCHETYPES.bracket.fields.map(f => [f.key, f.def]));
  app.applyBrief(B.synthesise('bracket', defs, { material: 'aluminium', process: 'cnc3' }), defs);
  const doc = window.M.doc.store.doc;
  return {
    params: doc.params.length,
    features: doc.features.length,
    expressions: doc.features.filter(f => Object.values(f.params).some(v => typeof v === 'string' && /[a-z_]/i.test(v))).length,
    notes: (doc.meta.notes || '').includes('not a substitute for analysis'),
    linked: doc.features.filter(f => f.inputs.length).length,
  };
});
await page.waitForTimeout(1600);
check('the brief produces a real parametric tree', built.params >= 6 && built.features >= 4, JSON.stringify(built));
check('its dimensions are expressions, not baked numbers', built.expressions >= 3, String(built.expressions));
check('its features are linked into a history', built.linked >= 2, String(built.linked));
check('the caveat is written into the document, not just a dialog', built.notes);

const briefBuilds = await page.evaluate(() => {
  const app = window.tesserCAD;
  return {
    bodies: app.build.stats.bodies,
    errs: [...app.build.results.values()].filter(r => r.error).map(r => r.error),
    mass: app.build.stats.mass,
  };
});
check('the generated model actually builds', briefBuilds.bodies > 0 && briefBuilds.errs.length === 0, JSON.stringify(briefBuilds));

/* ------------------------------------------------------- 10. the why-tutor */
const why = await page.evaluate(() => {
  const W = window.M.why;
  W.resetSeen();
  const app = window.tesserCAD;
  const doc = window.M.doc.store.doc;
  const first = W.nextLesson(doc, app.build, app.report);
  W.dismissLesson(first.id);
  const second = W.nextLesson(doc, app.build, app.report);
  return {
    first: first && { id: first.id, kind: first.kind, len: first.body.length },
    second: second && second.id,
    repeats: !!second && second.id === first.id,
    total: W.allLessons().length,
  };
});
check('the tutor offers a lesson bound to the model', !!why.first && why.first.len > 80, JSON.stringify(why.first));
check('a dismissed lesson does not come back', !why.repeats, JSON.stringify(why));
check('lessons are browsable as a set', why.total >= 8, String(why.total));

console.log('\n' + R.join('\n'));
console.log('\nCONSOLE ERRORS: ' + errs.length);
for (const e of [...new Set(errs)].slice(0, 10)) console.log('  - ' + e);
const failed = R.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${R.length - failed}/${R.length} checks passed`);
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
