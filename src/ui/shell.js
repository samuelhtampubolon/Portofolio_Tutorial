/**
 * Shell widgets: DOM helpers, toasts, modals, the menu system, the command
 * palette, the quick menu and the form controls shared by every panel.
 *
 * Nothing here knows about CAD — commands are passed in from the registry in
 * main.js, so the chrome and the application stay independent.
 */
import { bus, T } from '../core/bus.js';
import { icon } from './icons.js';

/* ----------------------------------------------------------- DOM helper */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/** True on a touch device — used to swap pointer-specific wording. */
export const coarse = () => matchMedia('(pointer: coarse)').matches;
/** "Click"/"Tap" and similar, chosen for the pointer actually in use. */
export const verb = (mouse, touch) => (coarse() ? touch : mouse);

/* --------------------------------------------------------------- toasts */

export function toast(msg, kind = 'info', ms = 3200) {
  const root = $('#toastRoot');
  if (!root) return;
  const glyph = { ok: 'check', err: 'warning', warn: 'warning', info: 'info' }[kind] || 'info';
  const node = el('div', { class: `toast ${kind}`, role: 'status' }, [
    icon(glyph, { size: 15 }),
    el('span', { text: msg }),
  ]);
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 260);
  }, ms);
}

bus.on(T.TOAST, (p) => {
  if (typeof p === 'string') toast(p);
  else toast(p.msg, p.kind || 'info', p.ms || 3200);
});

export function status(msg) { const n = $('#statusMsg'); if (n) n.textContent = msg; }
bus.on(T.STATUS, status);

/* --------------------------------------------------------------- modals */

let openModal = null;

export function modal({ title, subtitle, body, actions = [], wide = false, size = '', onClose = null, icon: ic = null }) {
  closeModal();
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: `modal${wide ? ' wide' : ''}${size ? ' ' + size : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const bodyNode = el('div', { class: 'modal-body' }, [].concat(body));
  const foot = el('div', { class: 'modal-foot' });

  for (const a of actions) {
    foot.appendChild(el('button', {
      class: `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`,
      text: a.label,
      onclick: () => { const keep = a.run && a.run(bodyNode); if (!keep) closeModal(); },
    }));
  }
  box.append(
    el('div', { class: 'modal-head' }, [
      el('div', { class: 'modal-title' }, [
        ic ? icon(ic, { size: 18 }) : null,
        el('div', {}, [
          el('h2', { text: title }),
          subtitle ? el('p', { class: 'modal-sub', text: subtitle }) : null,
        ]),
      ]),
      el('button', { class: 'mini-btn', title: 'Close', 'aria-label': 'Close', onclick: () => closeModal() }, [icon('close', { size: 15 })]),
    ]),
    bodyNode,
  );
  if (actions.length) box.appendChild(foot);
  back.appendChild(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) closeModal(); });
  $('#modalRoot').appendChild(back);
  openModal = { back, onClose };
  (box.querySelector('input, select, textarea, button.primary') || box).focus?.();
  return bodyNode;
}

export function closeModal() {
  if (!openModal) return;
  openModal.onClose?.();
  openModal.back.remove();
  openModal = null;
}

export function isModalOpen() {
  // the node can be removed by something other than closeModal; don't lie about it
  if (openModal && !openModal.back.isConnected) openModal = null;
  return !!openModal;
}

export function confirmDialog(title, message, onYes, { danger = false, yes = 'Confirm', icon: ic = 'warning' } = {}) {
  modal({
    title, icon: ic,
    body: [el('p', { text: message })],
    actions: [{ label: 'Cancel' }, { label: yes, primary: !danger, danger, run: () => { onYes(); } }],
  });
}

export function promptDialog(title, label, value, onOk, { placeholder = '', help = '', icon: ic = 'rename' } = {}) {
  const input = el('input', { type: 'text', value: value ?? '', placeholder });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(input.value); closeModal(); } });
  modal({
    title, icon: ic,
    body: [
      el('div', { class: 'row wide' }, [el('label', { text: label }), input]),
      help ? el('div', { class: 'hint', text: help }) : null,
    ],
    actions: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => onOk(input.value) }],
  });
  setTimeout(() => { input.focus(); input.select(); }, 10);
}

/* ------------------------------------------------------------- the menus */

let openDrop = null;
// A stack, not a single node: the compact tablet menu nests one level deeper
// than the desktop menu bar, and tracking only the innermost submenu makes a
// tap back into its parent look like a click outside the menu.
let openSubs = [];

/**
 * A dropdown menu.
 * Item shapes: '-' separator · {header} section label ·
 *   {label, icon, key, run, checked, disabled, danger, sub: [items]}
 */
export function dropdown(anchor, items, { align = 'left', below = true } = {}) {
  closeDropdown();
  const menu = buildMenu(items);
  document.body.appendChild(menu);
  position(menu, anchor, align, below);
  anchor.classList?.add('open');
  openDrop = { menu, anchor };
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  return menu;
}

function buildMenu(items, depth = 0) {
  const menu = el('div', { class: `dropdown${depth ? ' submenu' : ''}`, role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { menu.appendChild(el('hr')); continue; }
    if (it.header) { menu.appendChild(el('div', { class: 'grp', text: it.header })); continue; }

    const hasSub = Array.isArray(it.sub) && it.sub.length;
    const row = el('button', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`,
      role: 'menuitem',
      disabled: it.disabled === true,
      onclick: (e) => {
        // A touch pointer cannot hover, so the tap that lands on a parent row
        // is the only chance to open its submenu. openSubmenu is idempotent at
        // a given depth, so doing it here as well costs a mouse user nothing.
        if (hasSub) { e.stopPropagation(); openSubmenu(row, it.sub, depth + 1); return; }
        closeDropdown();
        it.run?.();
      },
    }, [
      el('span', { class: 'mi-icon' }, [
        it.checked ? icon('check', { size: 14 }) : (it.icon ? icon(it.icon, { size: 15 }) : null),
      ]),
      el('span', { class: 'mi-label', text: it.label }),
      it.key ? el('span', { class: 'kbd', text: it.key }) : null,
      hasSub ? el('span', { class: 'mi-arrow' }, [icon('chevron-right', { size: 13 })]) : null,
    ]);

    if (hasSub) {
      row.addEventListener('pointerenter', () => openSubmenu(row, it.sub, depth + 1));
      row.addEventListener('focus', () => openSubmenu(row, it.sub, depth + 1));
    } else {
      row.addEventListener('pointerenter', () => closeSubmenu(depth + 1));
    }
    menu.appendChild(row);
  }
  return menu;
}

function openSubmenu(row, items, depth) {
  closeSubmenu(depth);
  const sub = buildMenu(items, depth);
  document.body.appendChild(sub);
  const r = row.getBoundingClientRect();
  const w = sub.offsetWidth;
  // Flip to the parent's left edge rather than clamping, which would drop the
  // submenu on top of the menu it came from. Tablet widths hit this often.
  const left = r.right + w > innerWidth - 8 ? Math.max(8, r.left - w + 3) : r.right - 3;
  sub.style.left = `${left}px`;
  sub.style.top = `${Math.max(8, Math.min(r.top - 5, innerHeight - sub.offsetHeight - 8))}px`;
  openSubs.push({ node: sub, depth });
}

function closeSubmenu(depth = 0) {
  while (openSubs.length && openSubs[openSubs.length - 1].depth >= depth) openSubs.pop().node.remove();
}

function position(menu, anchor, align, below) {
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  let left = align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = below ? r.bottom + 4 : r.top - h - 4;
  if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function onDocDown(e) {
  const inMenu = (openDrop && openDrop.menu.contains(e.target)) || openSubs.some(s => s.node.contains(e.target));
  if (inMenu) { document.addEventListener('pointerdown', onDocDown, true); return; }
  closeDropdown();
}

export function closeDropdown() {
  closeSubmenu(0);
  if (!openDrop) return;
  openDrop.anchor.classList?.remove('open');
  openDrop.menu.remove();
  openDrop = null;
  document.removeEventListener('pointerdown', onDocDown, true);
}

export function isDropdownOpen() { return !!openDrop; }

/** A context menu at an arbitrary screen point. */
export function contextMenu(x, y, items) {
  closeDropdown();
  const menu = buildMenu(items);
  document.body.appendChild(menu);
  position(menu, { left: x, right: x, top: y, bottom: y }, 'left', true);
  openDrop = { menu, anchor: { classList: { add() {}, remove() {} } } };
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  return menu;
}

/* -------------------------------------------------- the command palette */

const RECENT_KEY = 'tessercad.recentCommands';

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
export function noteRecent(id) {
  try {
    const list = loadRecent().filter(x => x !== id);
    list.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  } catch { /* ignore */ }
}

export function commandPalette(commands, onRun, { context = '' } = {}) {
  const root = $('#paletteRoot');
  clear(root);
  root.hidden = false;

  const byId = new Map(commands.map(c => [c.id, c]));
  const recent = loadRecent().map(id => byId.get(id)).filter(Boolean);

  const input = el('input', { type: 'text', placeholder: 'Search commands…   try "extrude", "export stl", "dark"', spellcheck: 'false', 'aria-label': 'Search commands' });
  const list = el('ul', { role: 'listbox' });
  const foot = el('div', { class: 'palette-foot' }, [
    el('span', {}, [el('kbd', { text: '↑↓' }), ' navigate']),
    el('span', {}, [el('kbd', { text: '⏎' }), ' run']),
    el('span', {}, [el('kbd', { text: 'esc' }), ' close']),
    el('span', { class: 'palette-ctx', text: context }),
  ]);
  const box = el('div', { class: 'palette' }, [
    el('div', { class: 'palette-search' }, [icon('search', { size: 17 }), input]),
    list, foot,
  ]);
  root.appendChild(box);

  let filtered = recent.length ? recent : commands;
  let heading = recent.length ? 'Recent' : 'All commands';
  let cursor = 0;

  const render = () => {
    clear(list);
    if (heading) list.appendChild(el('li', { class: 'palette-head', text: heading }));
    filtered.slice(0, 80).forEach((c, i) => {
      list.appendChild(el('li', {
        class: i === cursor ? 'on' : '',
        role: 'option',
        onpointerdown: (e) => { e.preventDefault(); pick(c); },
        onmousemove: () => { if (cursor !== i) { cursor = i; render(); } },
      }, [
        el('span', { class: 'pgl' }, [icon(c.icon || 'dots', { size: 16 })]),
        el('span', { class: 'ptxt' }, [
          el('span', { text: c.label }),
          c.group ? el('span', { class: 'pgrp', text: c.group }) : null,
        ]),
        c.key ? el('span', { class: 'psub', text: c.key }) : null,
      ]));
    });
    if (!filtered.length) {
      list.appendChild(el('li', { class: 'palette-empty' }, [
        icon('search', { size: 18 }), el('span', { text: 'No matching command' }),
      ]));
    }
    list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  };

  /**
   * Ranking: a prefix beats a word start, which beats any substring, which
   * beats a subsequence. Subsequence matches are capped so a four-letter query
   * cannot drag in half the registry by matching letters spread across a
   * keyword list.
   */
  const score = (c, q) => {
    const label = c.label.toLowerCase();
    const meta = `${(c.group || '').toLowerCase()} ${c.id.toLowerCase()} ${(c.keywords || '').toLowerCase()}`;
    if (label.startsWith(q)) return 1000 - label.length;
    const wordStart = label.split(/[\s/—-]+/).some(w => w.startsWith(q));
    if (wordStart) return 800 - label.length;
    const inLabel = label.indexOf(q);
    if (inLabel >= 0) return 600 - inLabel;
    const inMeta = meta.indexOf(q);
    if (inMeta >= 0) return 400 - Math.min(inMeta, 200);
    if (q.length < 3) return -1;                    // too short to fuzz safely
    let i = 0, gaps = 0;
    for (const ch of q) {
      const next = label.indexOf(ch, i);
      if (next < 0) return -1;                      // fuzzy over the label only
      gaps += next - i;
      i = next + 1;
    }
    return gaps > 14 ? -1 : 200 - gaps;
  };

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { filtered = recent.length ? recent : commands; heading = recent.length ? 'Recent' : 'All commands'; }
    else {
      filtered = commands
        .map(c => ({ c, s: score(c, q) }))
        .filter(x => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map(x => x.c);
      heading = `${filtered.length} result${filtered.length === 1 ? '' : 's'}`;
    }
    cursor = 0;
    render();
  });

  const pick = (c) => { close(); noteRecent(c.id); onRun(c); };
  const close = () => { root.hidden = true; clear(root); };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { cursor = Math.min(filtered.length - 1, cursor + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (filtered[cursor]) pick(filtered[cursor]); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); }
  });

  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  render();
  input.focus();
}

/* ------------------------------------------------------- the quick menu */

/** A cursor-anchored grid of favourite commands, opened with Q. */
export function quickMenu(x, y, commands, onRun) {
  closeQuickMenu();
  const root = el('div', { class: 'quick-back' });
  const grid = el('div', { class: 'quick' });
  commands.forEach((c, i) => {
    grid.appendChild(el('button', {
      class: 'quick-item',
      title: c.label,
      onclick: () => { closeQuickMenu(); noteRecent(c.id); onRun(c); },
    }, [
      el('span', { class: 'qk', text: String(i + 1) }),
      icon(c.icon || 'dots', { size: 20 }),
      el('span', { class: 'ql', text: c.label }),
    ]));
  });
  root.appendChild(grid);
  document.body.appendChild(root);
  const w = grid.offsetWidth, h = grid.offsetHeight;
  grid.style.left = `${Math.max(8, Math.min(x - w / 2, innerWidth - w - 8))}px`;
  grid.style.top = `${Math.max(8, Math.min(y - h / 2, innerHeight - h - 8))}px`;
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closeQuickMenu(); });

  const onKey = (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= commands.length) { e.preventDefault(); closeQuickMenu(); noteRecent(commands[n - 1].id); onRun(commands[n - 1]); }
    else if (e.key === 'Escape' || e.key.toLowerCase() === 'q') { e.preventDefault(); closeQuickMenu(); }
  };
  addEventListener('keydown', onKey, true);
  quickState = { root, onKey };
  return root;
}

let quickState = null;
export function closeQuickMenu() {
  if (!quickState) return;
  removeEventListener('keydown', quickState.onKey, true);
  quickState.root.remove();
  quickState = null;
}
export function isQuickMenuOpen() { return !!quickState; }

/* ------------------------------------------------------- form controls */

export function field(label, control, { full = false, hint = '', title = '' } = {}) {
  return el('div', { class: `row${full ? ' wide' : ''}` }, [
    el('label', { text: label, title: title || label }),
    hint ? el('div', {}, [control, el('div', { class: 'hint', text: hint })]) : control,
  ]);
}

/**
 * A number input you can also drag sideways to change — the single control
 * that makes parameter tuning feel immediate rather than typed-and-committed.
 */
export function scrubNumber(value, onChange, {
  step = 1, min = -Infinity, max = Infinity, precision = 3, suffix = '', onCommit = null, title = '',
} = {}) {
  const input = el('input', { type: 'text', class: 'scrub', value: fmtNum(value, precision), title: title || 'Drag left/right to change, or type a value' });
  let drag = null;

  const clampSet = (v, live) => {
    const n = Math.max(min, Math.min(max, v));
    input.value = fmtNum(n, precision) + (drag ? suffix : '');
    onChange(n, live);
    return n;
  };

  input.addEventListener('pointerdown', (e) => {
    if (document.activeElement === input) return;     // already editing by keyboard
    e.preventDefault();
    try { input.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const start = parseFloat(input.value) || 0;
    drag = { x: e.clientX, start, moved: false };
    input.classList.add('scrubbing');
  });
  input.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) < 3 && !drag.moved) return;
    drag.moved = true;
    const mult = e.shiftKey ? 0.1 : (e.ctrlKey || e.metaKey ? 10 : 1);
    clampSet(drag.start + dx * step * mult * 0.5, true);
  });
  input.addEventListener('pointerup', () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    input.classList.remove('scrubbing');
    input.value = fmtNum(parseFloat(input.value) || 0, precision);
    if (moved) onCommit?.(parseFloat(input.value));
    else input.focus({ preventScroll: true }), input.select();
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) { clampSet(v, false); onCommit?.(Math.max(min, Math.min(max, v))); }
    else input.value = fmtNum(value, precision);
  });
  input.addEventListener('keydown', (e) => {
    const v = parseFloat(input.value) || 0;
    const k = e.shiftKey ? step * 10 : (e.altKey ? step * 0.1 : step);
    if (e.key === 'ArrowUp') { e.preventDefault(); input.value = fmtNum(clampSet(v + k, false), precision); onCommit?.(parseFloat(input.value)); }
    if (e.key === 'ArrowDown') { e.preventDefault(); input.value = fmtNum(clampSet(v - k, false), precision); onCommit?.(parseFloat(input.value)); }
    if (e.key === 'Enter') input.blur();
  });
  return input;
}

function fmtNum(v, p) {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(p);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function checkbox(label, checked, onChange, { hint = '' } = {}) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  const wrap = el('label', { class: 'chk' }, [input, el('span', { text: label })]);
  return hint ? el('div', {}, [wrap, el('div', { class: 'hint', text: hint })]) : wrap;
}

/** A segmented control — clearer than a <select> for 2–4 exclusive options. */
export function segmented(value, options, onChange, { icons = false } = {}) {
  const wrap = el('div', { class: 'segmented', role: 'radiogroup' });
  for (const opt of options) {
    const [v, label, ic] = opt;
    const b = el('button', {
      class: String(v) === String(value) ? 'on' : '',
      role: 'radio',
      'aria-checked': String(String(v) === String(value)),
      title: label,
      onclick: () => onChange(v),
    }, [
      ic ? icon(ic, { size: 15 }) : null,
      icons && ic ? null : el('span', { text: label }),
    ]);
    wrap.appendChild(b);
  }
  return wrap;
}

export function select(value, options, onChange) {
  const s = el('select');
  for (const [v, label] of options) {
    const o = el('option', { value: v, text: label });
    if (String(v) === String(value)) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function section(title, children, open = true, { icon: ic = null, badge = null, actions = null } = {}) {
  const d = el('details', { class: 'sec' });
  d.open = open;
  d.appendChild(el('summary', {}, [
    ic ? icon(ic, { size: 14, cls: 'sec-icon' }) : null,
    el('span', { class: 'sec-title', text: title }),
    badge != null ? el('span', { class: 'pill', text: String(badge) }) : null,
    actions,
  ]));
  d.appendChild(el('div', { class: 'sec-body' }, [].concat(children)));
  return d;
}

export function kv(pairs) {
  const dl = el('dl', { class: 'kv' });
  for (const [k, v, title] of pairs) {
    dl.appendChild(el('dt', { text: k, title: title || '' }));
    dl.appendChild(el('dd', { text: v }));
  }
  return dl;
}

export function emptyState(title, body, ic = 'bulb') {
  return el('div', { class: 'empty-note' }, [
    icon(ic, { size: 26, cls: 'empty-icon' }),
    el('b', { text: title }),
    el('span', { html: body }),
  ]);
}

export { icon };
