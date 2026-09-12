/**
 * A small, dependency-free arithmetic expression evaluator.
 *
 * Every numeric field in a TesserCAD feature may hold either a plain number or
 * an expression string that references named document parameters, e.g.
 *   width * 2        wall + clearance      sqrt(area)      cos(rad(30)) * r
 *
 * This is what makes the model parametric: change one parameter and every
 * feature that references it rebuilds.
 *
 * Deliberately NOT using eval()/Function(): the parser below only ever
 * produces numbers, so a malicious project file cannot execute code.
 */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, hypot: Math.hypot,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max,
  pow: Math.pow,
  deg: (r) => r * 180 / Math.PI,
  rad: (d) => d * Math.PI / 180,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  lerp: (a, b, t) => a + (b - a) * t,
};

const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };

const NUM = /^[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?/i;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = NUM.exec(rest))) { out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if ((m = IDENT.exec(rest))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    if ('+-*/%^(),'.includes(ch)) { out.push({ t: ch }); i++; continue; }
    throw new Error(`Unexpected character "${ch}"`);
  }
  return out;
}

/* Recursive-descent parser. Grammar (lowest precedence first):
     expr   := term (('+'|'-') term)*
     term   := unary (('*'|'/'|'%') unary)*
     unary  := ('-'|'+') unary | power
     power  := atom ('^' unary)?           (right associative)
     atom   := number | ident | ident '(' args ')' | '(' expr ')'
*/
function parse(tokens, scope) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (!tokens[p] || tokens[p].t !== t) throw new Error(`Expected "${t}"`); return tokens[p++]; };

  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[p++].t;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    while (peek() && (peek().t === '*' || peek().t === '/' || peek().t === '%')) {
      const op = tokens[p++].t;
      const r = unary();
      if (op === '*') v = v * r;
      else if (op === '/') { if (r === 0) throw new Error('Division by zero'); v = v / r; }
      else { if (r === 0) throw new Error('Modulo by zero'); v = v % r; }
    }
    return v;
  }
  function unary() {
    if (peek() && peek().t === '-') { p++; return -unary(); }
    if (peek() && peek().t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() && peek().t === '^') { p++; return Math.pow(base, unary()); }
    return base;
  }
  function atom() {
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of expression');
    if (tk.t === 'num') { p++; return tk.v; }
    if (tk.t === '(') { p++; const v = expr(); eat(')'); return v; }
    if (tk.t === 'id') {
      p++;
      const name = tk.v;
      if (peek() && peek().t === '(') {
        p++;
        const args = [];
        if (peek() && peek().t !== ')') {
          args.push(expr());
          while (peek() && peek().t === ',') { p++; args.push(expr()); }
        }
        eat(')');
        const fn = FUNCS[name];
        if (!fn) throw new Error(`Unknown function "${name}"`);
        const v = fn(...args);
        if (!Number.isFinite(v)) throw new Error(`"${name}" produced a non-finite result`);
        return v;
      }
      if (Object.prototype.hasOwnProperty.call(scope, name)) {
        const v = scope[name];
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Parameter "${name}" is not a finite number`);
        return v;
      }
      if (Object.prototype.hasOwnProperty.call(CONSTS, name)) return CONSTS[name];
      throw new Error(`Unknown name "${name}"`);
    }
    throw new Error(`Unexpected token "${tk.t}"`);
  }

  const value = expr();
  if (p !== tokens.length) throw new Error('Trailing characters in expression');
  return value;
}

/** Evaluate `src` (number or string) against a { name: number } scope. */
export function evaluate(src, scope = {}) {
  if (typeof src === 'number') {
    if (!Number.isFinite(src)) throw new Error('Value is not finite');
    return src;
  }
  if (src == null || src === '') throw new Error('Empty value');
  const v = parse(tokenize(String(src)), scope);
  if (!Number.isFinite(v)) throw new Error('Expression produced a non-finite result');
  return v;
}

/** Evaluate, falling back to `fallback` when the expression is invalid. */
export function evalSafe(src, scope = {}, fallback = 0) {
  try { return evaluate(src, scope); } catch { return fallback; }
}

/**
 * `{ ok, value, error }` — used by inputs that show inline validation.
 *
 * A deeply nested expression exhausts the recursive-descent parser's stack,
 * and the engine's own message for that is "Maximum call stack size exceeded",
 * which tells a user nothing they can act on. It is translated here, because
 * this is the boundary where an error stops being a fact about the program and
 * starts being something a person has to read.
 */
export function tryEval(src, scope = {}) {
  try { return { ok: true, value: evaluate(src, scope), error: null }; }
  catch (e) {
    const message = e instanceof RangeError || /call stack/i.test(e.message || '')
      ? 'Expression is nested too deeply to evaluate. Split it across two parameters.'
      : e.message;
    return { ok: false, value: NaN, error: message };
  }
}

/**
 * Resolve the document parameter list into a flat scope, allowing parameters
 * to reference earlier parameters. Cycles resolve to an error on that entry.
 */
export function buildScope(params = []) {
  // A null prototype, so a parameter can never be named after something on
  // Object.prototype and so an expression can never reach one. The parser
  // already guards its lookups with hasOwnProperty; this removes the question
  // a second time, at the other end, where a parameter name arrives from a
  // file somebody else wrote.
  const scope = Object.create(null);
  const errors = {};
  // Two passes so order-independence works for simple chains.
  for (let pass = 0; pass < 4; pass++) {
    let progressed = false;
    for (const p of params) {
      if (!p.name || Object.prototype.hasOwnProperty.call(scope, p.name)) continue;
      try { scope[p.name] = evaluate(p.value, scope); progressed = true; delete errors[p.name]; }
      catch (e) { errors[p.name] = e.message; }
    }
    if (!progressed) break;
  }
  return { scope, errors };
}

export const EXPR_HELP = Object.keys(FUNCS).sort();
