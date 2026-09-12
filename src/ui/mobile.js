/**
 * The phone shell.
 *
 * A CAD interface designed for a mouse does not survive being squeezed onto a
 * 390-point screen: the menu bar disappears, every control lands under the
 * 44-point touch minimum, and everything sits at the top of a screen held from
 * the bottom. Rather than scale the desktop chrome down, this module swaps in
 * a layout built for a thumb:
 *
 *   · a bottom navigation bar — workspaces, panels and the full menu, all in
 *     thumb reach;
 *   · bottom sheets that host the *same* panel DOM as the desktop side panels,
 *     so every render path stays shared;
 *   · long-press in place of right-click;
 *   · a floating view cluster instead of the desktop view cube.
 *
 * A tablet is a different problem: it has the width for a menu bar and a real
 * panel, just not for two of them beside a usable viewport. That tier keeps the
 * desktop chrome and docks a single switchable panel; it shares the floating
 * cluster from here and nothing else.
 *
 * Desktop behaviour is untouched: everything here activates only below the
 * desktop breakpoint and tears itself down cleanly above it.
 */
import { el, clear, icon, dropdown, closeDropdown, closeQuickMenu } from './shell.js';
import { menuDefs } from './menus.js';
import { store } from '../core/doc.js';

/*
 * These must stay in lockstep with the breakpoint header in styles/app.css.
 *
 * The phone tier stops at 699px so every iPad in portrait gets the tablet shell,
 * the 744pt mini included; the widest phone in portrait is around 430pt, so the
 * gap is comfortable. The second clause catches a phone held in landscape, which
 * is wide enough to clear 700px but far too short for a desktop layout, and
 * `pointer: coarse` keeps a short desktop window out of it.
 */
export const PHONE_QUERY = '(max-width: 699px), (max-height: 460px) and (pointer: coarse)';
export const TABLET_QUERY = '(min-width: 700px) and (max-width: 1279px) and (min-height: 461px)';
export const isPhone = () => matchMedia(PHONE_QUERY).matches;
export const isTablet = () => matchMedia(TABLET_QUERY).matches;
/** True where the pointer cannot hover: submenus must open on tap, not hover. */
export const isCoarse = () => matchMedia('(pointer: coarse)').matches;

const WS = [
  ['model', 'Model', 'cube3d'],
  ['draft', 'Draft', 'sketch'],
  ['sim', 'Simulate', 'timeline'],
];

export class MobileShell {
  constructor(app) {
    this.app = app;
    this.sheet = null;
    this.sheetKind = null;
    this.homes = new Map();     // panel id -> its desktop parent, for restoring
    this._build();
    this.mq = matchMedia(PHONE_QUERY);
    this.mq.addEventListener('change', () => this.onBreakpoint());
    matchMedia(TABLET_QUERY).addEventListener('change', () => this.onBreakpoint());
    // A MediaQueryList change event is not reliably delivered in every engine
    // and headless configuration, and missing it leaves the desktop chrome on
    // a phone-sized screen. Re-checking on resize costs nothing: onBreakpoint
    // is a no-op unless the breakpoint actually crossed.
    addEventListener('resize', () => {
      clearTimeout(this._rt);
      this._rt = setTimeout(() => this.onBreakpoint(), 60);
    });
    // Rotating the device changes the aspect ratio enough that the previous
    // framing is meaningless, so re-fit rather than leave the model off-screen.
    matchMedia('(orientation: portrait)').addEventListener('change', () => {
      if (isPhone() || isTablet()) setTimeout(() => { this.app.vp.resize(); this.app.draft.resize(); this.app.zoomFit(); }, 180);
    });
    this.onBreakpoint();
  }

  /* ---------------------------------------------------------- chrome */

  _build() {
    this.bar = el('nav', { id: 'bottombar', role: 'tablist', 'aria-label': 'Workspace and panels' });
    document.body.appendChild(this.bar);

    this.fab = el('div', { id: 'mobFab' });
    document.getElementById('stage').appendChild(this.fab);

    this.backdrop = el('div', { id: 'sheetBack', hidden: true });
    this.backdrop.addEventListener('pointerdown', (e) => { if (e.target === this.backdrop) this.closeSheet(); });
    document.body.appendChild(this.backdrop);

    this.renderBar();
    this.renderFab();
  }

  /**
   * Build the bar once, then only update state. Re-creating these nodes on
   * every UI refresh churns the DOM under the user's thumb — it flickers, it
   * loses an in-flight tap, and it is entirely avoidable.
   */
  renderBar() {
    if (!this.barItems) {
      this.barItems = new Map();
      const bar = clear(this.bar);
      const add = (key, label, ic, run) => {
        const node = el('button', {
          class: 'bb-item', role: 'tab', 'aria-label': label, onclick: run,
        }, [
          el('span', { class: 'bb-icon' }, [icon(ic, { size: 21 })]),
          el('span', { class: 'bb-label', text: label }),
        ]);
        bar.appendChild(node);
        this.barItems.set(key, node);
      };
      for (const [id, label, ic] of WS) {
        add(id, label, ic, () => {
          this.closeSheet();
          this.app.setWorkspace(id);
        });
      }
      add('panels', 'Panels', 'panel-bottom', () => this.togglePanelSheet());
      add('more', 'More', 'dots', () => this.toggleMenuSheet());
    }

    for (const [key, node] of this.barItems) {
      const on = key === 'panels' ? this.sheetKind === 'panel'
        : key === 'more' ? this.sheetKind === 'menu'
          : this.app.workspace === key && !this.sheetKind;
      node.classList.toggle('on', on);
      node.setAttribute('aria-selected', String(on));
    }
  }

  /**
   * The view cube and axis gizmo are unusable at this size; this replaces them.
   *
   * On a tablet the same cluster also carries the dock toggle, because that is
   * the only way back to the panels once the dock is collapsed.
   */
  renderFab() {
    const base = this.app.workspace === 'draft' ? 'draft' : '3d';
    const tablet = isTablet();
    const mode = tablet ? `${base}+dock` : base;
    if (this.fabMode !== mode) {
      this.fabMode = mode;
      this.fabBtns = new Map();
      const f = clear(this.fab);
      const add = (key, ic, label, run) => {
        const b = el('button', { class: 'fab-btn', title: label, 'aria-label': label, onclick: run }, [icon(ic, { size: 19 })]);
        f.appendChild(b);
        this.fabBtns.set(key, b);
      };
      if (tablet) add('dock', 'panel-right', 'Show or hide the side panel', () => this.app.toggleDock());
      if (base === 'draft') {
        add('fit', 'fit', 'Zoom to the drawing extents', () => this.app.draft.zoomExtents());
        add('snap', 'magnet', 'Object snap', () => { this.app.toggleDraft('snap'); this.renderFab(); });
        add('undo', 'undo', 'Undo', () => store.undo());
      } else {
        add('fit', 'fit', 'Zoom to fit', () => this.app.zoomFit());
        // Bottom sheets are phone chrome and are styled only at that breakpoint,
        // so the tablet gets the same controls as a popover on the button.
        add('view', 'view-iso', 'Views and display', () => (isTablet()
          ? this.openViewMenu(this.fabBtns.get('view'))
          : this.openViewSheet()));
        add('undo', 'undo', 'Undo', () => store.undo());
      }
    }
    this.fabBtns.get('snap')?.classList.toggle('on', this.app.draft.snap.on);
    this.fabBtns.get('dock')?.classList.toggle('on', !document.getElementById('workarea').classList.contains('dock-collapsed'));
    const undo = this.fabBtns.get('undo');
    if (undo) undo.disabled = !store.canUndo();
  }

  onBreakpoint() {
    const phone = isPhone();
    const tablet = !phone && isTablet();
    const changed = this._wasPhone !== phone || this._wasTablet !== tablet;
    this._wasPhone = phone;
    this._wasTablet = tablet;
    // The layouts themselves come from media queries, never from these classes:
    // a MediaQueryList change event is not delivered reliably enough to hang a
    // layout on. They are kept only so that other code and the test suites can
    // ask which tier is live without re-deriving the queries.
    document.documentElement.classList.toggle('phone', phone);
    document.documentElement.classList.toggle('tablet', tablet);
    if (!phone) {
      this.closeSheet();
      this.restorePanels();
    }
    // A dock collapsed on a tablet must not follow you up to the desktop, where
    // the class would hide both panels with nothing on screen to bring back.
    if (!tablet) document.getElementById('workarea')?.classList.remove('dock-collapsed');
    this.renderBar();
    this.renderFab();
    // The canvas changes shape when the chrome swaps, so anything framed
    // against the old layout is now wrong — re-fit once the CSS has settled.
    setTimeout(() => {
      this.app.vp.resize();
      this.app.draft.resize();
      if (changed) this.app.zoomFit();
    }, 80);
  }

  refresh() {
    if (!isPhone() && !isTablet()) return;
    this.renderBar();
    this.renderFab();
  }

  /* ---------------------------------------------------------- sheets */

  /**
   * Open a bottom sheet. `content` is appended to the sheet body; when it is
   * one of the real panel elements it is moved, not cloned, so the existing
   * render functions keep writing to the same nodes.
   */
  openSheet({ kind, title, content, tabs = null, tall = false }) {
    this.closeSheet({ keepBackdrop: true });
    this.sheetKind = kind;

    const handle = el('div', { class: 'sheet-handle', 'aria-hidden': 'true' }, [el('i')]);
    const head = el('div', { class: 'sheet-head' }, [
      tabs || el('h3', { text: title }),
      el('button', { class: 'sheet-close', 'aria-label': 'Close', onclick: () => this.closeSheet() }, [icon('close', { size: 18 })]),
    ]);
    const body = el('div', { class: 'sheet-body' });
    body.appendChild(content);

    const sheet = el('div', { class: `sheet${tall ? ' tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [handle, head, body]);
    this.sheet = sheet;
    this.backdrop.hidden = false;
    this.backdrop.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('in'));
    this._bindDrag(sheet, handle, head);
    this.renderBar();
    return body;
  }

  /** Drag the handle to resize between two snap heights, or fling down to close. */
  _bindDrag(sheet, handle, head) {
    let drag = null;
    const grab = (e) => {
      if (e.target.closest('button, input, select, .segmented')) return;
      drag = { y: e.clientY, h: sheet.getBoundingClientRect().height, t: performance.now() };
      sheet.classList.add('dragging');
      try { handle.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    };
    const move = (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      const h = Math.max(120, Math.min(innerHeight * 0.92, drag.h - dy));
      sheet.style.height = `${h}px`;
      drag.last = dy;
    };
    const up = () => {
      if (!drag) return;
      sheet.classList.remove('dragging');
      const dy = drag.last || 0;
      const fast = performance.now() - drag.t < 320;
      drag = null;
      if (dy > 90 || (fast && dy > 45)) { this.closeSheet(); return; }
      // settle onto the nearer snap point
      const h = sheet.getBoundingClientRect().height;
      const half = innerHeight * 0.52, full = innerHeight * 0.9;
      sheet.style.height = `${Math.abs(h - half) < Math.abs(h - full) ? half : full}px`;
    };
    for (const n of [handle, head]) {
      n.addEventListener('pointerdown', grab);
      n.addEventListener('pointermove', move);
      n.addEventListener('pointerup', up);
      n.addEventListener('pointercancel', up);
    }
  }

  closeSheet({ keepBackdrop = false } = {}) {
    if (!this.sheet) {
      if (!keepBackdrop) this.backdrop.hidden = true;
      this.sheetKind = null;
      return;
    }
    this.restorePanels();
    this.sheet.remove();
    this.sheet = null;
    this.sheetKind = null;
    if (!keepBackdrop) this.backdrop.hidden = true;
    this.renderBar();
    setTimeout(() => { this.app.vp.resize(); this.app.draft.resize(); }, 40);
  }

  /**
   * Put any borrowed panel elements back where the desktop layout expects them.
   *
   * The `.in-sheet` class must come off at the same time: it forces the panel
   * visible, and a visible panel back inside #workarea claims a grid row and
   * collapses #stage — which leaves the viewport with no height at all.
   */
  restorePanels() {
    if (!this.homes.size) return;
    for (const [id, home] of this.homes) {
      const node = document.getElementById(id);
      if (!node) continue;
      node.classList.remove('in-sheet');
      if (node.parentElement !== home) home.appendChild(node);
    }
    this.homes.clear();
    // #stage must sit between the two panels for the desktop three-column grid
    const wa = document.getElementById('workarea');
    const stage = document.getElementById('stage');
    const left = document.getElementById('leftpanel');
    const right = document.getElementById('rightpanel');
    if (left && stage && right && wa) wa.append(left, stage, right);
  }

  /* -------------------------------------------------- the panel sheet */

  togglePanelSheet(which) {
    if (this.sheetKind === 'panel' && !which) { this.closeSheet(); return; }
    this.openPanelSheet(which || this._lastPanel || 'right');
  }

  openPanelSheet(which) {
    this._lastPanel = which;
    const id = which === 'left' ? 'leftpanel' : 'rightpanel';
    const node = document.getElementById(id);
    if (!this.homes.has(id)) this.homes.set(id, node.parentElement);

    const tabs = el('div', { class: 'sheet-tabs' }, [
      el('button', {
        class: which === 'left' ? 'on' : '', onclick: () => this.openPanelSheet('left'),
      }, [icon('workspace', { size: 15 }), el('span', { text: this.app.workspace === 'draft' ? 'Layers' : 'Outline' })]),
      el('button', {
        class: which === 'right' ? 'on' : '', onclick: () => this.openPanelSheet('right'),
      }, [icon('settings', { size: 15 }), el('span', { text: 'Properties' })]),
    ]);

    this.openSheet({ kind: 'panel', title: 'Panels', content: node, tabs });
    node.classList.add('in-sheet');
    this.app.refreshUI();
  }

  /* --------------------------------------------------- the menu sheet */

  toggleMenuSheet() {
    if (this.sheetKind === 'menu') { this.closeSheet(); return; }
    this.openMenuSheet();
  }

  openMenuSheet() {
    const app = this.app;
    const wrap = el('div', { class: 'menu-sheet' });

    wrap.appendChild(el('button', {
      class: 'sheet-search', onclick: () => { this.closeSheet(); app.openPalette(); },
    }, [icon('search', { size: 17 }), el('span', { text: `Search all ${app.commands.length} commands…` }), el('kbd', { text: '⌘K' })]));

    const quick = ['edit.undo', 'edit.redo', 'file.save', 'file.template', 'edit.prefs', 'help.quickstart'];
    wrap.appendChild(el('div', { class: 'sheet-quick' }, quick.map(id => {
      const c = app.commandMap.get(id);
      if (!c) return null;
      return el('button', {
        class: 'sq-item', disabled: c.enabled ? !c.enabled() : false,
        onclick: () => { this.closeSheet(); app.run(id); },
      }, [icon(c.icon, { size: 19 }), el('span', { text: SHORT[id] || c.label })]);
    }).filter(Boolean)));

    for (const [label, itemsFn] of menuDefs(app, (id) => app.menuItem(id))) {
      const items = itemsFn().filter(Boolean);
      const det = el('details', { class: 'msec' });
      det.appendChild(el('summary', {}, [
        el('span', { text: label }),
        el('span', { class: 'pill', text: String(items.filter(i => i && i !== '-' && !i.header).length) }),
      ]));
      const list = el('div', { class: 'msec-body' });
      this._renderItems(list, items, 0);
      det.appendChild(list);
      wrap.appendChild(det);
    }

    this.openSheet({ kind: 'menu', title: 'All commands', content: wrap, tall: true });
  }

  _renderItems(host, items, depth) {
    for (const it of items) {
      if (!it || it === '-') continue;
      if (it.header) { host.appendChild(el('div', { class: 'msec-head', text: it.header })); continue; }
      if (Array.isArray(it.sub) && it.sub.length) {
        const sub = el('details', { class: 'msub' });
        sub.appendChild(el('summary', {}, [
          it.icon ? icon(it.icon, { size: 16 }) : null,
          el('span', { text: it.label }),
        ]));
        const inner = el('div', { class: 'msub-body' });
        this._renderItems(inner, it.sub, depth + 1);
        sub.appendChild(inner);
        host.appendChild(sub);
        continue;
      }
      host.appendChild(el('button', {
        class: `m-item${it.checked ? ' checked' : ''}${it.danger ? ' danger' : ''}`,
        disabled: !!it.disabled,
        onclick: () => { this.closeSheet(); it.run?.(); },
      }, [
        el('span', { class: 'mi-icon' }, [it.checked ? icon('check', { size: 16 }) : (it.icon ? icon(it.icon, { size: 16 }) : null)]),
        el('span', { class: 'mi-label', text: it.label }),
        it.key ? el('span', { class: 'kbd', text: it.key }) : null,
      ]));
    }
  }

  /** The view sheet's contents, anchored to the floating cluster on a tablet. */
  openViewMenu(anchor) {
    if (!anchor) return;
    if (anchor.classList.contains('open')) { closeDropdown(); return; }
    const grp = (header, ids) => [{ header }, ...ids.map(id => this.app.menuItem(id))];
    dropdown(anchor, [
      ...grp('Standard views', ['view.iso', 'view.front', 'view.right', 'view.top', 'view.back', 'view.left']),
      '-',
      ...grp('Display', ['shade.shaded-edges', 'shade.shaded', 'shade.wire', 'shade.xray', 'view.ortho', 'view.grid']),
      '-',
      ...grp('Framing', ['view.fit', 'view.selection', 'mod.isolate', 'mod.showAll', 'view.section', 'view.theme']),
    ], { align: 'right', below: false });
  }

  /* --------------------------------------------------- the view sheet */

  openViewSheet() {
    const app = this.app;
    const wrap = el('div', { class: 'menu-sheet' });
    const grid = (title, ids) => {
      wrap.appendChild(el('div', { class: 'msec-head', text: title }));
      wrap.appendChild(el('div', { class: 'sheet-quick' }, ids.map(id => {
        const c = app.commandMap.get(id);
        if (!c) return null;
        const on = c.checked ? c.checked() : false;
        return el('button', {
          class: `sq-item${on ? ' on' : ''}`, disabled: c.enabled ? !c.enabled() : false,
          onclick: () => { app.run(id); this.closeSheet(); },
        }, [icon(c.icon, { size: 19 }), el('span', { text: SHORT[id] || c.label })]);
      }).filter(Boolean)));
    };
    grid('Standard views', ['view.iso', 'view.front', 'view.right', 'view.top', 'view.back', 'view.left']);
    grid('Display', ['shade.shaded-edges', 'shade.shaded', 'shade.wire', 'shade.xray', 'view.ortho', 'view.grid']);
    grid('Framing', ['view.fit', 'view.selection', 'mod.isolate', 'mod.showAll', 'view.section', 'view.theme']);
    this.openSheet({ kind: 'view', title: 'View', content: wrap });
  }
}

const SHORT = {
  'edit.undo': 'Undo', 'edit.redo': 'Redo', 'file.save': 'Save', 'file.template': 'Templates',
  'edit.prefs': 'Settings', 'help.quickstart': 'Help',
  'view.iso': 'Iso', 'view.front': 'Front', 'view.right': 'Right', 'view.top': 'Top',
  'view.back': 'Back', 'view.left': 'Left',
  'shade.shaded-edges': 'Edges', 'shade.shaded': 'Solid', 'shade.wire': 'Wire', 'shade.xray': 'X-ray',
  'view.ortho': 'Ortho', 'view.grid': 'Grid', 'view.fit': 'Fit all', 'view.selection': 'Fit sel',
  'mod.isolate': 'Isolate', 'mod.showAll': 'Show all', 'view.section': 'Section', 'view.theme': 'Theme',
};

/**
 * Long-press as a stand-in for right-click.
 * Cancels on movement so it never fires in the middle of a drag or an orbit.
 */
export function attachLongPress(node, handler, { ms = 480, slop = 12 } = {}) {
  let timer = null, start = null;
  const cancel = () => { clearTimeout(timer); timer = null; start = null; };

  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = null;
      if (!start) return;
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* ignore */ } }
      handler({ clientX: start.x, clientY: start.y, preventDefault() {} });
      start = null;
    }, ms);
  }, { passive: true });

  node.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > slop) cancel();
  }, { passive: true });

  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'wheel']) {
    node.addEventListener(ev, cancel, { passive: true });
  }
  return cancel;
}

export function closeAllOverlays() { closeDropdown(); closeQuickMenu(); }
