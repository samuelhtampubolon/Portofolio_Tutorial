/**
 * Shell widgets: DOM helpers, toasts, modals, dropdown menus, the command
 * palette and the keyboard map. Everything here is generic — the actual
 * commands live in the command registry built by main.js.
 */
import { bus, T } from '../core/bus.js';

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
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/* --------------------------------------------------------------- toasts */

export function toast(msg, kind = 'info', ms = 3200) {
  const root = $('#toastRoot');
  const node = el('div', { class: `toast ${kind}`, text: msg });
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

export function modal({ title, body, actions = [], wide = false, onClose = null }) {
  closeModal();
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
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
      el('h2', { text: title }),
      el('button', { class: 'mini-btn', text: '✕', title: 'Close', onclick: () => closeModal() }),
    ]),
    bodyNode,
  );
  if (actions.length) box.appendChild(foot);
  back.appendChild(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) closeModal(); });
  $('#modalRoot').appendChild(back);
  openModal = { back, onClose };
  const focusable = box.querySelector('input, select, textarea, button.primary, button');
  focusable?.focus();
  return bodyNode;
}

export function closeModal() {
  if (!openModal) return;
  openModal.onClose?.();
  openModal.back.remove();
  openModal = null;
}

export function isModalOpen() { return !!openModal; }

export function confirmDialog(title, message, onYes, { danger = false, yes = 'Confirm' } = {}) {
  modal({
    title,
    body: [el('p', { text: message })],
    actions: [
      { label: 'Cancel' },
      { label: yes, primary: !danger, danger, run: () => { onYes(); } },
    ],
  });
}

export function promptDialog(title, label, value, onOk, { placeholder = '', help = '' } = {}) {
  const input = el('input', { type: 'text', value: value ?? '', placeholder });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(input.value); closeModal(); } });
  modal({
    title,
    body: [
      el('div', { class: 'row wide' }, [el('label', { text: label }), input]),
      help ? el('div', { class: 'hint', text: help }) : null,
    ],
    actions: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => onOk(input.value) }],
  });
  setTimeout(() => { input.focus(); input.select(); }, 10);
}

/* ------------------------------------------------------------ dropdowns */

let openDrop = null;

export function dropdown(anchor, items) {
  closeDropdown();
  const menu = el('div', { class: 'dropdown' });
  for (const it of items) {
    if (it === '-') { menu.appendChild(el('hr')); continue; }
    if (it.group) { menu.appendChild(el('div', { class: 'grp', text: it.group })); continue; }
    const b = el('button', {
      disabled: it.enabled === false,
      onclick: () => { closeDropdown(); it.run?.(); },
    }, [
      el('span', { style: { width: '16px', textAlign: 'center' }, text: it.glyph || '' }),
      el('span', { text: it.label }),
      it.key ? el('span', { class: 'kbd', text: it.key }) : null,
    ]);
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  anchor.classList.add('open');
  openDrop = { menu, anchor };
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }), 0);
  return menu;
}

function onDocDown(e) {
  if (openDrop && openDrop.menu.contains(e.target)) {
    document.addEventListener('pointerdown', onDocDown, { once: true });
    return;
  }
  closeDropdown();
}

export function closeDropdown() {
  if (!openDrop) return;
  openDrop.anchor.classList.remove('open');
  openDrop.menu.remove();
  openDrop = null;
}

/* ------------------------------------------------------ command palette */

export function commandPalette(commands, onRun) {
  const root = $('#paletteRoot');
  clear(root);
  root.hidden = false;

  const input = el('input', { type: 'text', placeholder: 'Type a command…', spellcheck: 'false' });
  const list = el('ul');
  const box = el('div', { class: 'palette' }, [input, list]);
  root.appendChild(box);

  let filtered = commands;
  let cursor = 0;

  const render = () => {
    clear(list);
    filtered.slice(0, 60).forEach((c, i) => {
      list.appendChild(el('li', {
        class: i === cursor ? 'on' : '',
        onpointerdown: (e) => { e.preventDefault(); pick(c); },
        onmousemove: () => { if (cursor !== i) { cursor = i; render(); } },
      }, [
        el('span', { class: 'pgl', text: c.glyph || '›' }),
        el('span', { text: c.label }),
        c.key ? el('span', { class: 'psub', text: c.key }) : null,
      ]));
    });
    if (!filtered.length) list.appendChild(el('li', { text: 'No matching command', style: { color: 'var(--txt-3)' } }));
  };

  const pick = (c) => { close(); onRun(c); };
  const close = () => { root.hidden = true; clear(root); };

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = !q ? commands : commands.filter(c => {
      const hay = `${c.label} ${c.group || ''} ${c.id}`.toLowerCase();
      let i = 0;
      for (const ch of q) { i = hay.indexOf(ch, i); if (i < 0) return false; i++; }
      return true;
    });
    cursor = 0;
    render();
  });

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

/* --------------------------------------------------------- form widgets */

export function field(label, control, { full = false } = {}) {
  return el('div', { class: `row${full ? ' wide' : ''}` }, [el('label', { text: label }), control]);
}

export function numberInput(value, onChange, { step = 1, min = null, max = null } = {}) {
  const input = el('input', { type: 'number', value, step });
  if (min !== null) input.min = min;
  if (max !== null) input.max = max;
  const commit = () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.blur(); } });
  return input;
}

export function checkbox(label, checked, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'chk' }, [input, el('span', { text: label })]);
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

export function section(title, children, open = true) {
  const d = el('details', { class: 'sec' });
  d.open = open;
  d.appendChild(el('summary', { text: title }));
  d.appendChild(el('div', { class: 'sec-body' }, [].concat(children)));
  return d;
}

export function kv(pairs) {
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of pairs) { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }
  return dl;
}
