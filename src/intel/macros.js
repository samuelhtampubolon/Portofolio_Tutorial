/**
 * Macros: automation for people who are not going to write code.
 *
 * Every CAD package answers repetitive work with an API — Python, VBA, a node
 * graph — and every one of them puts a programming task between a designer and
 * their own workflow. The result is that the people with the most repetitive
 * work are the least able to automate it.
 *
 * The command registry makes a much smaller answer possible. Every action in
 * this application is already an id in one list, and every surface — menus,
 * ribbon, palette, keyboard — runs commands through the same function. So
 * recording a workflow is just remembering which ids went past, and replaying
 * it is running them again. No scripting, no API surface, nothing to learn
 * beyond a record button.
 *
 * The deliberate limits, because they are what keep this honest:
 *
 *   Only registry commands are captured. A mouse drag in the viewport is not a
 *   command and cannot be replayed; the recorder says so rather than producing
 *   a macro that silently misses half of what you did.
 *
 *   Replay is a single undo step. A macro that goes wrong must come back in one
 *   press, or nobody will risk running one.
 *
 *   Commands that open a dialog, touch a file, or ask a question are refused at
 *   record time. A macro that stops halfway waiting for a file picker is worse
 *   than no macro.
 */
import { store } from '../core/doc.js';
import { macros as loadMacros, saveMacro, deleteMacro } from './standards.js';

/**
 * Commands that cannot meaningfully replay: they open a picker, need a
 * selection made by hand, or are themselves about recording.
 */
const UNRECORDABLE = new Set([
  'file.new', 'file.open', 'file.import', 'file.revert', 'file.sample',
  'file.clearAutosave', 'help.guide', 'help.source', 'help.issue',
  'view.fullscreen', 'add.import', 'sim.record',
  'macro.record', 'macro.stop', 'macro.manage', 'macro.run',
  'edit.undo', 'edit.redo',
]);

/** Prefixes whose commands only make sense against a live selection. */
const NEEDS_SELECTION = /^(mod\.|edit\.delete|edit\.duplicate|op\.)/;

export class MacroRecorder {
  constructor(app) {
    this.app = app;
    this.recording = null;
    this.onChange = () => {};
  }

  get isRecording() { return !!this.recording; }
  get list() { return loadMacros(); }

  start(name) {
    this.recording = { name: name || 'New macro', steps: [], startedAt: Date.now(), skipped: [] };
    this.onChange();
  }

  /** Called by App.run for every command that executes. */
  capture(id) {
    if (!this.recording) return;
    if (UNRECORDABLE.has(id)) { this.recording.skipped.push(id); return; }
    this.recording.steps.push({ id });
    this.onChange();
  }

  cancel() {
    this.recording = null;
    this.onChange();
  }

  /**
   * Stop and store. Returns the saved macro, or null when nothing replayable
   * was captured — which is a real outcome worth reporting rather than saving
   * an empty macro the user will later wonder about.
   */
  stop() {
    const rec = this.recording;
    this.recording = null;
    this.onChange();
    if (!rec || !rec.steps.length) return null;
    const macro = {
      id: `m${Date.now().toString(36)}`,
      name: rec.name,
      steps: rec.steps,
      created: new Date().toISOString(),
      runs: 0,
      needsSelection: rec.steps.some(s => NEEDS_SELECTION.test(s.id)),
    };
    saveMacro(macro);
    return macro;
  }

  /**
   * Replay a macro as one undoable edit.
   *
   * store.batch swallows the history entry that each command opens for itself
   * and pushes one in their place, so a macro that does twelve things still
   * costs one undo. A failing step does not abandon the run: the rest still
   * execute and the result reports what was skipped.
   */
  run(macro) {
    const cmds = macro.steps.map(s => this.app.commandMap.get(s.id)).filter(Boolean);
    if (!cmds.length) return { ok: false, ran: 0, failed: [], reason: 'None of its commands still exist.' };

    const failed = [];
    let ran = 0;
    store.batch(`Macro: ${macro.name}`, () => {
      for (const c of cmds) {
        try {
          if (c.enabled && !c.enabled()) { failed.push({ id: c.id, why: 'not available here' }); continue; }
          // Bypass App.run so the macro's own steps are not re-captured.
          c.run();
          ran++;
        } catch (e) {
          failed.push({ id: c.id, why: e.message || String(e) });
        }
      }
    });

    const saved = { ...macro, runs: (macro.runs || 0) + 1, lastRun: new Date().toISOString() };
    saveMacro(saved);
    return { ok: ran > 0, ran, failed, total: cmds.length };
  }

  rename(id, name) {
    const m = loadMacros().find(x => x.id === id);
    if (!m) return null;
    const next = { ...m, name };
    saveMacro(next);
    return next;
  }

  remove(id) { return deleteMacro(id); }
}

export { UNRECORDABLE };
