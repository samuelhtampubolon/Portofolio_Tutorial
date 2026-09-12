import * as T from '../../src/intel/tolerance.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  - ' + extra : ''}`);
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ---- ISO 286 against the printed table ---- */
ok('IT7 at 25mm is 21 micron', near(T.itGrade(7, 25), 0.021));
ok('IT6 at 25mm is 13 micron', near(T.itGrade(6, 25), 0.013));
ok('IT11 at 25mm is 130 micron', near(T.itGrade(11, 25), 0.130));
ok('IT grades stop at 500mm', T.itGrade(7, 600) === null);
ok('IT7 grows with size', T.itGrade(7, 10) < T.itGrade(7, 100));

// H7/g6 at 25 -> hole +21/0, shaft -7/-20
let f = T.fitOf('H7', 'g6', 25);
ok('H7 hole at 25 is +0.021/0', near(f.hole.upper, 0.021) && near(f.hole.lower, 0));
ok('g6 shaft at 25 is -0.007/-0.020', near(f.shaft.upper, -0.007) && near(f.shaft.lower, -0.020),
  `${f.shaft.upper}/${f.shaft.lower}`);
ok('H7/g6 clearance is 0.007 to 0.041', near(f.minClearance, 0.007) && near(f.maxClearance, 0.041),
  `${f.minClearance.toFixed(3)}..${f.maxClearance.toFixed(3)}`);
ok('and it classifies as clearance', f.kind === 'clearance');

f = T.fitOf('H7', 'p6', 25);
ok('p6 shaft at 25 is +0.035/+0.022', near(f.shaft.upper, 0.035) && near(f.shaft.lower, 0.022),
  `${f.shaft.upper}/${f.shaft.lower}`);
ok('H7/p6 is interference', f.kind === 'interference', `${f.minClearance.toFixed(3)}..${f.maxClearance.toFixed(3)}`);

f = T.fitOf('H7', 'k6', 25);
ok('k6 shaft at 25 is +0.015/+0.002', near(f.shaft.upper, 0.015) && near(f.shaft.lower, 0.002));
ok('H7/k6 is a transition fit', f.kind === 'transition');

f = T.fitOf('H7', 'n6', 25);
ok('n6 shaft at 25 is +0.028/+0.015', near(f.shaft.upper, 0.028) && near(f.shaft.lower, 0.015));

f = T.fitOf('H7', 's6', 60);
ok('s6 shaft at 60 is +0.072/+0.053', near(f.shaft.upper, 0.072) && near(f.shaft.lower, 0.053),
  `${f.shaft.upper}/${f.shaft.lower}`);

f = T.fitOf('H11', 'c11', 25);
ok('c11 shaft at 25 is -0.110/-0.240', near(f.shaft.upper, -0.110) && near(f.shaft.lower, -0.240),
  `${f.shaft.upper}/${f.shaft.lower}`);

f = T.fitOf('H8', 'f7', 40);
ok('H8/f7 at 40 gives 0.025 to 0.089', near(f.minClearance, 0.025) && near(f.maxClearance, 0.089),
  `${f.minClearance.toFixed(3)}..${f.maxClearance.toFixed(3)}`);

f = T.fitOf('H7', 'h6', 25);
ok('H7/h6 touches zero at the tight end', near(f.minClearance, 0) && near(f.maxClearance, 0.034));

ok('every named fit resolves at 30mm', T.fitTable(30).length === Object.keys(T.FITS).length);
ok('the fit table is ordered loose to tight',
  T.fitTable(30)[0].maxClearance > T.fitTable(30).at(-1).maxClearance);

const sug = T.suggestFit(25, { minClearance: 0.007, maxClearance: 0.041, kind: 'clearance' });
ok('asking for 7 to 41 micron of play suggests H7/g6', sug[0].name === 'H7/g6', sug.slice(0,2).map(s=>s.name).join(', '));

/* ---- capability arithmetic, checked by hand ---- */
// Spec 0.2 wide, sigma 0.02 -> Cp = 0.2/(6*0.02) = 1.6667, centred so Cpk equal.
let cap = T.capability({ mean: 0.5, sigma: 0.02, lower: 0.4, upper: 0.6 });
ok('Cp of a centred 0.2 band at sigma 0.02 is 1.667', near(cap.cp, 5 / 3, 1e-12), cap.cp.toFixed(4));
ok('and Cpk equals Cp when centred', near(cap.cpk, cap.cp, 1e-12));
ok('it reports 5 sigma', near(cap.sigmaLevel, 5, 1e-9), cap.sigmaLevel.toFixed(3));
// Two-sided 5 sigma: 2*(1-Phi(5)) = 5.73e-7 -> 0.573 ppm
ok('and about 0.57 ppm outside', Math.abs(cap.ppm - 0.573) < 0.05, cap.ppm.toFixed(3));

cap = T.capability({ mean: 0.56, sigma: 0.02, lower: 0.4, upper: 0.6 });
ok('a 0.06 offset leaves Cp alone', near(cap.cp, 5 / 3, 1e-12));
ok('but drops Cpk to 0.667', near(cap.cpk, 2 / 3, 1e-12), cap.cpk.toFixed(4));
ok('and the verdict says poor', T.cpkVerdict(cap.cpk).grade === 'poor');
ok('an off-centre chain is flagged as not centred', cap.centred === false);
ok('Cpk 1.33 reads as capable', T.cpkVerdict(1.33).grade === 'capable');
ok('Cpk 0.4 reads as incapable', T.cpkVerdict(0.4).severity === 'block');

// Normal CDF sanity
ok('the normal CDF is 0.5 at zero', near(T.normalCdf(0), 0.5, 1e-9));
ok('and 0.97725 at two sigma', Math.abs(T.normalCdf(2) - 0.977249868) < 1e-6, T.normalCdf(2).toFixed(9));

/* ---- stack-up arithmetic, checked by hand ---- */
// Four links at +/-0.05, one at -1 direction. Classic 5-link chain.
const stack = T.emptyStack({ name: 'Shaft in housing', requirement: 'End float', lower: 0.05, upper: 0.45 });
stack.links = [
  T.makeLink({ label: 'Housing bore depth', nominal: 50, plus: 0.05, minus: 0.05, dir: 1 }),
  T.makeLink({ label: 'Shoulder to face', nominal: -20, plus: 0.05, minus: 0.05, dir: 1 }),
  T.makeLink({ label: 'Bearing width', nominal: 12, plus: 0.05, minus: 0.05, dir: -1 }),
  T.makeLink({ label: 'Spacer', nominal: 17.75, plus: 0.05, minus: 0.05, dir: -1 }),
];
// mean = 50 - 20 - 12 - 17.75 = 0.25
let a = T.analyseStack(stack, { trials: 40000 });
ok('the nominal chain closes at 0.25', near(a.mean, 0.25, 1e-12), a.mean.toFixed(4));
// worst case: +/- 0.2
ok('worst case is 0.05 to 0.45', near(a.worst.min, 0.05, 1e-12) && near(a.worst.max, 0.45, 1e-12),
  `${a.worst.min.toFixed(3)}..${a.worst.max.toFixed(3)}`);
ok('and it exactly fills the requirement', a.worst.fits && Math.abs(a.worst.used - 1) < 1e-9,
  `${(a.worst.used * 100).toFixed(1)}% used`);
// sigma = sqrt(4 * (0.05/3)^2) = 2*0.05/3 = 0.033333
ok('RSS sigma is 0.03333', near(a.rss.sigma, 0.1 / 3, 1e-12), a.rss.sigma.toFixed(5));
// Cp = 0.4/(6*0.033333) = 2.0
ok('Cp is exactly 2.0', near(a.capability.cp, 2, 1e-9), a.capability.cp.toFixed(4));
ok('Cpk matches, the chain is centred', near(a.capability.cpk, 2, 1e-9));
ok('the verdict is six sigma', a.verdict.grade === 'six-sigma');
ok('RSS is far narrower than worst case', a.rss.max - a.rss.min < a.worst.max - a.worst.min,
  `RSS ${(a.rss.max - a.rss.min).toFixed(3)} vs WC ${(a.worst.max - a.worst.min).toFixed(3)}`);
ok('Monte Carlo agrees with the nominal', Math.abs(a.mc.mean - 0.25) < 0.002, a.mc.mean.toFixed(4));
ok('and sees no failures on a 2.0 Cpk chain', a.mc.failures === 0, `${a.mc.failures}/${a.mc.trials}`);
ok('Monte Carlo stays inside the clipped worst case',
  a.mc.min >= a.worst.min - 1e-9 && a.mc.max <= a.worst.max + 1e-9,
  `${a.mc.min.toFixed(3)}..${a.mc.max.toFixed(3)}`);
ok('the run is reproducible',
  T.analyseStack(stack, { trials: 5000 }).mc.p50 === T.analyseStack(stack, { trials: 5000 }).mc.p50);

// four equal links -> each is 25% of the variance
ok('four equal links share the variance evenly',
  a.contributors.every(c => Math.abs(c.varianceShare - 0.25) < 1e-9),
  a.contributors.map(c => (c.varianceShare * 100).toFixed(0) + '%').join(' '));

// Widen one link: it should dominate and the ranking should name it.
const loose = structuredClone(stack);
loose.links[0].plus = loose.links[0].minus = 0.2;
a = T.analyseStack(loose, { trials: 20000 });
ok('a 4x tolerance dominates the variance',
  a.contributors[0].label === 'Housing bore depth' && a.contributors[0].varianceShare > 0.75,
  `${(a.contributors[0].varianceShare * 100).toFixed(1)}%`);
ok('worst case now misses the requirement', !a.worst.fits,
  `${a.worst.min.toFixed(3)}..${a.worst.max.toFixed(3)}`);
ok('Cpk falls below 1.33', a.capability.cpk < 1.33, a.capability.cpk.toFixed(3));
ok('and Monte Carlo finds real failures', a.mc.failures > 0, `${a.mc.ppm.toFixed(0)} ppm`);

/* ---- distributions ---- */
const uni = structuredClone(stack);
uni.links.forEach(l => { l.dist = 'uniform'; });
const au = T.analyseStack(uni, { trials: 20000 });
ok('uniform links give a wider sigma than normal', au.rss.sigma > T.analyseStack(stack, { trials: 200 }).rss.sigma,
  `${au.rss.sigma.toFixed(4)} vs ${(0.1/3).toFixed(4)}`);
ok('uniform sigma is t/sqrt(3) per link', near(au.rss.sigma, Math.sqrt(4 * (0.05 / Math.sqrt(3)) ** 2), 1e-12));
const six = structuredClone(stack);
six.links.forEach(l => { l.dist = 'sixSigma'; });
ok('a capable process halves the sigma', near(T.analyseStack(six, { trials: 200 }).rss.sigma, (0.1 / 3) / 2, 1e-12));

/* ---- levers ---- */
let lv = T.levers(loose, { target: 1.33, trials: 2000 });
ok('levers report the chain is short of target', !lv.met);
ok('uniform scaling offers a factor below 1', lv.uniform.possible && lv.uniform.factor < 1,
  `x${lv.uniform.factor.toFixed(3)}`);
ok('and the single-link fix names the biggest offender first',
  lv.single[0].id === loose.links[0].id, lv.single[0].label);
ok('the suggested tolerance is tighter than the current one',
  lv.single[0].to < lv.single[0].from,
  `±${lv.single[0].from} -> ±${lv.single[0].to.toFixed(4)}`);
// Applying the uniform factor should actually reach the target.
const fixedUp = structuredClone(loose);
fixedUp.links.forEach(l => { l.plus *= lv.uniform.factor; l.minus *= lv.uniform.factor; });
ok('applying the factor lands on the target Cpk',
  Math.abs(T.analyseStack(fixedUp, { trials: 200 }).capability.cpk - 1.33) < 1e-6,
  T.analyseStack(fixedUp, { trials: 200 }).capability.cpk.toFixed(4));
// Applying the single-link tolerance should also reach it.
const fixedOne = structuredClone(loose);
fixedOne.links[0].plus = fixedOne.links[0].minus = lv.single[0].to;
ok('so does the single-link change',
  Math.abs(T.analyseStack(fixedOne, { trials: 200 }).capability.cpk - 1.33) < 1e-6,
  T.analyseStack(fixedOne, { trials: 200 }).capability.cpk.toFixed(4));

// Off-centre but tight: the advice should be to move a nominal, not tighten.
const off = structuredClone(stack);
off.lower = 0.15; off.upper = 0.55;   // mean 0.25 sits low in the band
lv = T.levers(off, { target: 1.33, trials: 2000 });
ok('a tight but off-centre chain is told to re-centre', !!lv.centring, lv.centring?.move.toFixed(3));
ok('and the shift points at the middle of the band', near(lv.centring.move, 0.1, 1e-9));

// A chain whose nominals miss the requirement cannot be fixed by tolerance at
// all, and saying "tighten this" there would be wrong rather than incomplete.
const wontClose = T.emptyStack({ lower: 0.05, upper: 0.45 });
wontClose.links = [T.makeLink({ label: 'A', nominal: 50, plus: 0.05, minus: 0.05 }),
                   T.makeLink({ label: 'B', nominal: -30, plus: 0.05, minus: 0.05 })];
let wc = T.levers(wontClose, { target: 1.33, trials: 500 });
ok('a chain whose nominals miss the spec reports that, not a tolerance fix',
  wc.closes === false && !wc.uniform && !wc.single.length, JSON.stringify({ closes: wc.closes, single: wc.single.length }));
ok('and names the gap and the dimension change that would close it',
  /closes at 20.0000 mm/.test(wc.nominal.note) && /19.5500 mm above the requirement/.test(wc.nominal.note) && /change a dimension by -19.5500 mm/.test(wc.nominal.note),
  wc.nominal.note.slice(0, 90));
ok('a chain that does close still gets tolerance advice',
  T.levers(loose, { target: 1.33, trials: 500 }).closes === true);

// A fixed link too loose to ever work should say so rather than offer a factor.
const stuck = T.emptyStack({ lower: 0, upper: 0.05 });
stuck.links = [T.makeLink({ nominal: 10, plus: 0.5, minus: 0.5, fixed: true }),
               T.makeLink({ nominal: -9.975, plus: 0.01, minus: 0.01 })];
lv = T.levers(stuck, { target: 1.33, trials: 500 });
ok('an untouchable loose link is called out as hopeless',
  lv.uniform && lv.uniform.possible === false, lv.uniform?.note?.slice(0, 40));

/* ---- allocation ---- */
const blank = T.emptyStack({ lower: 0.05, upper: 0.45 });
blank.links = [
  T.makeLink({ label: 'A', nominal: 50, plus: 0, minus: 0 }),
  T.makeLink({ label: 'B', nominal: -20, plus: 0, minus: 0 }),
  T.makeLink({ label: 'C', nominal: 12, plus: 0, minus: 0, dir: -1 }),
  T.makeLink({ label: 'D', nominal: 17.75, plus: 0, minus: 0, dir: -1 }),
];
let alloc = T.allocate(blank, { method: 'equal', target: 1.33 });
ok('equal allocation gives every link the same band',
  alloc.every(x => Math.abs(x.tol - alloc[0].tol) < 1e-12), `±${alloc[0].tol.toFixed(4)}`);
const applied = structuredClone(blank);
applied.links.forEach((l, i) => { l.plus = l.minus = alloc[i].tol; });
ok('and the allocation hits the target it was asked for',
  Math.abs(T.analyseStack(applied, { trials: 200 }).capability.cpk - 1.33) < 1e-6,
  T.analyseStack(applied, { trials: 200 }).capability.cpk.toFixed(4));
alloc = T.allocate(blank, { method: 'proportional', target: 1.33 });
ok('proportional allocation gives the 50mm link more than the 12mm one',
  alloc[0].tol > alloc[2].tol, `${alloc[0].tol.toFixed(4)} vs ${alloc[2].tol.toFixed(4)}`);
const impossible = T.emptyStack({ lower: 0, upper: 0.002 });
impossible.links = [T.makeLink({ nominal: 100, plus: 0, minus: 0 }), T.makeLink({ nominal: -99.999, plus: 0, minus: 0 })];
alloc = T.allocate(impossible, { method: 'equal', target: 1.33, floor: 0.005 });
ok('an unreachable requirement is flagged, not silently rounded',
  alloc.every(x => x.tight && x.note.includes('floor')), alloc[0].note.slice(0, 50));
const misses = T.allocate(T.emptyStack({ lower: 5, upper: 6, links: [T.makeLink({ nominal: 1 })] }), {});
ok('a chain whose nominal misses the spec says fix the nominals first',
  misses[0].tol === null && /nominals/.test(misses[0].note));

/* ---- summary line ---- */
const sum = T.stackSummary(stack);
ok('the summary names the requirement and the verdict',
  sum.requirement === 'End float' && sum.verdict.includes('sigma'), `${sum.spec} | ${sum.verdict}`);
ok('and names the driving dimension', !!sum.driver, `${sum.driver} at ${(sum.driverShare * 100).toFixed(0)}%`);

/* ---- degenerate input ---- */
ok('an empty stack does not throw', (() => { const r = T.analyseStack(T.emptyStack(), { trials: 300 }); return r.links === 0 && Number.isFinite(r.mean); })());
ok('zero tolerance reports infinite capability',
  T.capability({ mean: 0.25, sigma: 0, lower: 0, upper: 1 }).cpk === Infinity);
ok('and out of spec with zero tolerance is 100% scrap',
  T.capability({ mean: 5, sigma: 0, lower: 0, upper: 1 }).ppm === 1e6);
ok('a bad fit designation returns null', T.limitsFor('Q9', 25) === null && T.limitsFor('', 25) === null);
ok('an unknown letter returns null', T.fitOf('H7', 'zz6', 25) === null);

console.log(fails ? `\n${fails} FAILURES` : '\nALL TOLERANCE CHECKS PASS');
process.exit(fails ? 1 : 0);
