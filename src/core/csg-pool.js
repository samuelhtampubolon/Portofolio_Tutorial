/**
 * A pool of boolean workers.
 *
 * The complaint this answers is the most-repeated performance complaint about
 * every package this one imitates: "most core functions are single-threaded...
 * can't multi-task", "SINGLE CORE? IN 2021?? COME ON!". Users buy a 5 GHz
 * six-core over a 3 GHz sixteen-core because the software cannot use the
 * cores. That is a software problem, and in a browser it is a solvable one.
 *
 * Two things happen here. A boolean no longer runs on the thread that draws
 * the interface, so the window keeps responding while it computes. And
 * booleans that do not depend on each other run at the same time on different
 * cores, which is what makes a document of independent parts scale.
 *
 * Everything degrades rather than breaks. No Worker constructor, a blocked
 * worker URL, a `file://` origin, a construction error: the pool reports
 * itself unavailable and callers fall back to the identical synchronous
 * kernel. There is one implementation of the maths, so the fallback cannot
 * drift from the fast path.
 */

const MAX_WORKERS = 8;

/** How many workers to start: cores minus one, so the UI thread keeps a core. */
function poolSize() {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

class Pool {
  constructor() {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.jobs = new Map();
    this.seq = 0;
    this.available = null;      // null = not yet probed
    this.reason = '';
    this.stats = { dispatched: 0, completed: 0, failed: 0, fellBack: 0, peakParallel: 0, busy: 0 };
  }

  /**
   * Try to start the pool. Called once, lazily, so a document with no
   * booleans never pays for workers it does not use.
   */
  start() {
    if (this.available !== null) return this.available;
    if (typeof Worker === 'undefined') {
      this.available = false; this.reason = 'This browser has no Worker support.';
      return false;
    }
    try {
      const url = new URL('./csg-worker.js', import.meta.url);
      const n = poolSize();
      for (let i = 0; i < n; i++) {
        const w = new Worker(url, { type: 'module' });
        w.onmessage = (e) => this._finish(w, e.data);
        // A worker that fails to load never answers, so its jobs would hang.
        // Treat any error as the pool being unusable and fall back.
        w.onerror = (err) => { this._collapse(err?.message || 'a worker failed to load'); };
        this.workers.push(w);
        this.idle.push(w);
      }
      this.available = true;
      this.reason = `${n} worker${n === 1 ? '' : 's'}`;
      return true;
    } catch (err) {
      this.available = false;
      this.reason = err.message || 'workers could not be started';
      return false;
    }
  }

  /** Give up on workers entirely and reject outstanding jobs so they retry. */
  _collapse(reason) {
    this.available = false;
    this.reason = reason;
    for (const w of this.workers) { try { w.terminate(); } catch { /* already gone */ } }
    this.workers.length = 0;
    this.idle.length = 0;
    const pending = [...this.jobs.values()];
    this.jobs.clear();
    const queued = this.queue.splice(0);
    for (const j of [...pending, ...queued]) j.reject(new Error(`WORKER_UNAVAILABLE: ${reason}`));
  }

  _finish(worker, data) {
    const job = this.jobs.get(data.id);
    this.jobs.delete(data.id);
    this.stats.busy = Math.max(0, this.stats.busy - 1);
    this.idle.push(worker);
    if (job) {
      if (data.ok) { this.stats.completed++; job.resolve({ position: data.position, normal: data.normal }); }
      else { this.stats.failed++; job.reject(new Error(data.error)); }
    }
    this._pump();
  }

  _pump() {
    while (this.queue.length && this.idle.length) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      this.jobs.set(job.id, job);
      this.stats.dispatched++;
      this.stats.busy++;
      this.stats.peakParallel = Math.max(this.stats.peakParallel, this.stats.busy);
      const transfer = [];
      for (const o of job.operands) { transfer.push(o.position.buffer, o.normal.buffer); }
      worker.postMessage({ id: job.id, op: job.op, operands: job.operands }, transfer);
    }
  }

  /**
   * Run one boolean off-thread.
   * Rejects with a WORKER_UNAVAILABLE error when the pool cannot take it, so
   * the caller knows to use the synchronous kernel instead of showing a
   * failure the user cannot act on.
   */
  run(op, operands) {
    if (!this.start()) {
      this.stats.fellBack++;
      return Promise.reject(new Error(`WORKER_UNAVAILABLE: ${this.reason}`));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.seq, op, operands, resolve, reject });
      this._pump();
    });
  }

  get size() { return this.workers.length; }

  /** For the status panel: what the pool is and what it has done. */
  report() {
    return {
      available: this.available === true,
      size: this.workers.length,
      cores: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || null,
      reason: this.reason,
      ...this.stats,
    };
  }

  dispose() {
    for (const w of this.workers) { try { w.terminate(); } catch { /* already gone */ } }
    this.workers.length = 0; this.idle.length = 0;
    this.available = null;
  }
}

export const pool = new Pool();
export const isWorkerUnavailable = (err) => /^WORKER_UNAVAILABLE/.test(err?.message || '');
