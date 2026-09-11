/**
 * Tiny synchronous event bus. Every module talks through this instead of
 * holding references to each other, which keeps the dependency graph a tree.
 */
class Bus {
  constructor() { this.map = new Map(); }

  on(topic, fn) {
    if (!this.map.has(topic)) this.map.set(topic, new Set());
    this.map.get(topic).add(fn);
    return () => this.off(topic, fn);
  }

  once(topic, fn) {
    const off = this.on(topic, (...a) => { off(); fn(...a); });
    return off;
  }

  off(topic, fn) {
    const set = this.map.get(topic);
    if (set) set.delete(fn);
  }

  emit(topic, payload) {
    const set = this.map.get(topic);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); }
      catch (err) { console.error(`[bus] handler for "${topic}" threw`, err); }
    }
  }
}

export const bus = new Bus();

/** Topics used across the app (documented here so they stay discoverable). */
export const T = {
  DOC_CHANGED:    'doc:changed',      // structural change -> rebuild + full UI refresh
  DOC_TOUCHED:    'doc:touched',      // cheap change -> UI refresh only, no rebuild
  DOC_LOADED:     'doc:loaded',       // whole new document
  REBUILT:        'geom:rebuilt',     // feature engine finished
  SELECTION:      'sel:changed',
  WORKSPACE:      'ws:changed',
  TOOL:           'tool:changed',
  TIME:           'sim:time',
  SIM_STATE:      'sim:state',
  STATUS:         'ui:status',
  TOAST:          'ui:toast',
  VIEW:           'view:changed',
  DRAFT_CHANGED:  'draft:changed',
};
