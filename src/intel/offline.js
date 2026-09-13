/**
 * Offline ownership, stated as a fact rather than a promise.
 *
 * "More and more professional 3D software is now only available on
 * subscription. You cannot buy a perpetual licence... tools also phone home
 * every few days." "Perpetual means never ending... will no longer allow me to
 * use my software by refusing to activate it." "This is simple greed. If you
 * have a DWG, you can install your old licence and view it, right?"
 *
 * That is business-model debt, and no feature fixes somebody else's licence
 * server. What this application can do is make its own position checkable
 * instead of asserted: register a service worker so every file is on the
 * machine after the first visit, and then report exactly what is stored,
 * where, and what leaves. A user who wants to verify it can turn the network
 * off and reload, which is the only proof that counts.
 */

const KEYS = [
  ['tessercad.autosave.v3', 'the document you have open'],
  ['tessercad.vcs.v1', 'saved versions and branches'],
  ['tessercad.studio.v1', 'studio standards, decisions and macros'],
  ['tessercad.prefs.v1', 'your preferences'],
  ['tessercad.why.v1', 'which engineering notes you have seen'],
];

/** Register the worker. Silent on failure: offline is a bonus, not a gate. */
export function install() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return Promise.resolve({ ok: false, reason: 'This browser has no service worker support.' });
  }
  // The desktop build already holds every file on disk, so there is nothing
  // for a cache to add and the honest answer is "not needed" rather than a
  // complaint about the origin. Checked before the https test below, which
  // would otherwise report a missing feature as a failure.
  if (typeof location !== 'undefined' && location.protocol === 'app:') {
    return Promise.resolve({ ok: false, reason: 'Already offline: this is the desktop build, and every file is local.' });
  }
  // A service worker needs a secure origin. On plain http it is simply absent,
  // and the app works exactly as before, just without the offline copy.
  if (typeof location !== 'undefined' && location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    return Promise.resolve({ ok: false, reason: 'Offline install needs https, or localhost.' });
  }
  return navigator.serviceWorker.register('./sw.js', { scope: './' })
    .then(reg => ({ ok: true, reason: 'Registered', scope: reg.scope }))
    .catch(err => ({ ok: false, reason: err.message || 'Registration failed.' }));
}

/** Is the app currently being served from the cache rather than the network? */
export async function status() {
  const out = {
    supported: typeof navigator !== 'undefined' && !!navigator.serviceWorker,
    controlled: false, version: null, files: 0, cachedBytes: 0, online: true,
  };
  if (typeof navigator !== 'undefined') out.online = navigator.onLine !== false;
  if (!out.supported) return out;

  const reg = await navigator.serviceWorker.getRegistration?.('./');
  out.registered = !!reg;
  out.controlled = !!navigator.serviceWorker.controller;

  if (typeof caches !== 'undefined') {
    try {
      const keys = (await caches.keys()).filter(k => k.startsWith('tessercad-'));
      out.version = keys[0] || null;
      if (keys[0]) {
        const c = await caches.open(keys[0]);
        const reqs = await c.keys();
        out.files = reqs.length;
        // Reading every response to size it is the only way to know, and at
        // sixty files it is fast enough to do on opening a dialog.
        let bytes = 0;
        for (const r of reqs) {
          const res = await c.match(r);
          if (!res) continue;
          const buf = await res.clone().arrayBuffer().catch(() => null);
          if (buf) bytes += buf.byteLength;
        }
        out.cachedBytes = bytes;
      }
    } catch { /* storage may be blocked; the app does not depend on it */ }
  }
  return out;
}

/** Everything this app keeps on the machine, named, with its size. */
export function localData() {
  const rows = [];
  if (typeof localStorage === 'undefined') return rows;
  for (const [key, what] of KEYS) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { /* blocked */ }
    rows.push({ key, what, bytes: raw ? raw.length : 0, present: !!raw });
  }
  return rows;
}

/** Remove everything stored locally, which is the other half of owning it. */
export function forgetEverything() {
  const removed = [];
  for (const [key] of KEYS) {
    try { if (localStorage.getItem(key) !== null) { localStorage.removeItem(key); removed.push(key); } }
    catch { /* blocked */ }
  }
  return removed;
}

/** Drop the offline copy, so the next load comes from the network. */
export async function uninstall() {
  const out = { caches: 0, worker: false };
  if (typeof caches !== 'undefined') {
    for (const k of await caches.keys()) {
      if (k.startsWith('tessercad-')) { await caches.delete(k); out.caches++; }
    }
  }
  const reg = await navigator.serviceWorker?.getRegistration?.('./');
  if (reg) out.worker = await reg.unregister();
  return out;
}

/**
 * What the app sends, which is nothing.
 *
 * Listed as the specific absences a user would otherwise have to take on
 * trust, each of which is checkable in a browser's network panel in about ten
 * seconds. Saying "we respect your privacy" is worth nothing; saying "there is
 * no fetch to any other origin in the source, and here is how to check"
 * is worth something.
 */
export const NETWORK_FACTS = [
  'No account, no sign-in, and nothing to activate.',
  'No telemetry, no analytics, and no error reporting.',
  'No licence check, so nothing can refuse to start.',
  'No font, map or model fetched from anyone else: three.js is vendored into this repository.',
  'Every document you open or save moves between the page and your disk, and nowhere else.',
  'Open your browser’s network panel and reload: after the first visit there is nothing to see.',
];
