# Architecture

This describes how the code is arranged and, more usefully, *why* each boundary
is where it is. Every structural claim below is enforced by
`tools/tests/architecture.mjs`, because "well structured" is a property of the
import graph and an import graph drifts the moment one convenient shortcut is
taken.

```
index.html ──▶ src/boot.js ──▶ src/main.js          the composition root
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
     src/ui/                    src/intel/                  src/sim/
   widgets, commands,     engineering: doctor, cost,     the 4D timeline
   menus, panels          drawings, tolerance, merge,     and dynamics
        │                 spec, fasteners, hygiene
        │                           │
        └──────────┬────────────────┘
                   ▼
                src/io/            import and export
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
    src/draft/            src/view/
   2D entities,          the 3D viewport
   DXF and SVG
        │                     │
        └──────────┬──────────┘
                   ▼
                src/core/       document model, expressions,
                                geometry, the boolean kernel
```

**The rule is one sentence: a layer may import from any layer below it and from
none above it.** That single constraint buys three things that are hard to get
back once lost, and each is checked:

- `core` imports nothing from this project, so it runs under Node with no
  browser and no DOM. That is what makes the arithmetic testable at all.
- `intel` touches no DOM, which is why all twenty-four engineering modules are
  tested headlessly rather than through a browser.
- `main.js` is the only file that imports `ui`, so the interface layer cannot
  leak into the layers that compute.

The module graph is acyclic, and that is asserted rather than hoped for.

---

## Why the layers sit where they do

### `core` — the foundation, and deliberately dependency-free

| File | What it is |
|---|---|
| `doc.js` | The document model, the feature catalogue, the history tree, persistence |
| `expr.js` | The expression tokeniser and recursive-descent parser |
| `geometry.js` | Primitive builders, extrude, revolve, tessellation |
| `csg-core.js` | The BSP boolean kernel, with **no** three.js |
| `csg.js` | The three.js adapter for that kernel |
| `csg-worker.js` | A module worker holding the kernel |
| `csg-pool.js` | The worker pool and its synchronous fallback |
| `rebuild.js` | Feature evaluation, caching, mass properties |
| `bus.js` | The event bus |

The document is **plain JSON at every instant** — no class instances, no
three.js objects. That one decision is load-bearing for far more than
serialisation:

- `structuredClone` is the whole of undo.
- `JSON.stringify` is the whole of saving.
- The version store can hold whole snapshots rather than fragile deltas.
- The three-way merge can work on records instead of geometry.
- The design-as-code projection can exist at all.

Every one of those features is cheap *because* of that decision, and would be a
project each without it.

#### The one split inside `core` that needs explaining

`csg-core.js` contains the boolean algorithm and imports nothing at all.
`csg.js` sits beside it and does nothing but convert `BufferGeometry` to flat
typed arrays and back.

That looks like an arbitrary division until you try to put a boolean in a
worker. **A module worker does not receive the page's import map**, so a file
containing `import * as THREE from 'three'` cannot be loaded in one, while a
file whose only imports are relative can. Splitting exactly there is what lets
the same arithmetic run on the main thread and in three worker threads with no
second implementation to keep in step — and one implementation is the reason the
fallback cannot silently diverge from the fast path.

Both properties are asserted: the kernel has no imports, and no bare specifier.

### `draft` and `view` — siblings that do not know about each other

`draft` is 2D: entities, snapping, the DXF and SVG codec. `view` is 3D: the
viewport, gizmos, picking. Neither imports the other, which is deliberate. They
are two editors over one document, and the moment one reaches into the other
they become one large editor that has to be understood all at once.

`draft/entity.js` was extracted from `draft/draft.js` when that file passed the
size at which one file stops being one idea. The seam was not arbitrary: those
functions are pure arithmetic on entity records, while the rest of `draft.js` is
interactive canvas code. Splitting on that line means the arithmetic can be
tested directly, and the two modules that only need to measure or format an
entity no longer load a drafting board to do it.

`draft.js` does **not** re-export any of it. A re-export would have kept those
callers working with no edit, and would also have kept the coupling the split
was made to remove, since reaching entity geometry through the canvas engine is
exactly what the old arrangement forced. `main.js` and `ui/inspector.js` import
from `entity.js` directly instead.

That split is also worth recording as the cautionary tale it turned out to be.
It left **ten dangling references** behind — two module constants that stayed in
the old file, two imports never added to the new one, and six helpers the old
file still called after they became private in the new one. None of it is a
syntax error. Every headless suite passed. They emerged one at a time as
`ReferenceError`s in a browser, each from whichever code path was exercised
next, which is the worst way to find out.

Two things came out of that, and both are now permanent:

- `tools/tests/bindings.mjs` checks that every identifier in every module
  resolves to a declaration, an import, or the platform, with real block
  scoping. A name declared inside one function no longer answers for a call in
  another, which is precisely the case that hid the last of the ten.
- `tools/tests/entity.mjs` tests the extracted arithmetic directly, against
  closed-form answers and against the identities it has to satisfy — a full turn
  is the identity, mirroring twice is the identity, scaling a distance scales it
  by the same factor. It calls every export on every entity kind, so a missing
  binding fails there rather than in front of a user. It found a further
  pre-existing bug on its first run: rotating a rectangle built its corners from
  the *already-rotated* diagonal and then rotated them again, which silently
  changed the rectangle's side lengths.

### `io` — one place that knows about file formats

Import and export, plus the file-name sanitiser. It needs `core` for the
document and `draft` for the DXF codec, and it is below `intel` so that the
release packager can use it.

### `intel` and `sim` — the engineering layer

Twenty-four modules, each one job, **none of which touches the DOM**. That is
the property that makes them testable, and it is enforced rather than
encouraged.

| | |
|---|---|
| `doctor.js` | Sixteen continuous checks with repairs |
| `cost.js`, `process.js` | Cost, process selection, crossover quantity |
| `section.js` | Second moments of area, load cases |
| `interfere.js` | Exact clash volume by boolean |
| `recognise.js` | Surface segmentation, hole and cylinder recovery |
| `drawing.js` | Orthographic views, hidden-line removal, title block |
| `tolerance.js` | Stack-up, Cp/Cpk, ISO 286 fits |
| `merge.js` | Three-way merge over the feature tree |
| `spec.js` | The document as editable text, both directions |
| `deviation.js` | Signed point-to-triangle deviation, intent import |
| `fasteners.js` | ISO metric fasteners with engineering data |
| `hygiene.js` | Far-origin precision, duplicate payloads, weight |
| `history.js`, `configs.js` | Version store, configurations |
| `brief.js`, `release.js`, `zip.js` | Sizing from requirements, deliverables |
| `speak.js` | The typed-intent grammar |
| `offline.js`, `standards.js`, `macros.js`, `why.js` | Ownership, memory, automation, teaching |
| `tessellate.js` | Chord-tolerance export |

`sim` sits at the same level and is independent of `intel`.

### `ui` — everything the user touches, and nothing below it depends on this

The load-bearing idea here is the **command registry**. Every action is one
object with an id, a label, an icon, a group, a `run`, and optional
`checked`/`enabled` predicates. From that one list, six surfaces are generated:

menus · ribbon · command palette · quick menu · context menus · keyboard map

Adding an action makes it reachable six ways at once, and **nothing can drift
out of sync** because there is only one place for it to be. It is also what made
the macro recorder small: recording is remembering which ids went past.

### `main.js` — the composition root

The only file that imports `ui`, and the only one that knows about everything.
It holds the application object and the dialogs. It is the largest file in the
project by a wide margin, and that is the correct place for the size to be: a
composition root is *supposed* to know about all the pieces. The architecture
test allows it a higher line limit than anything else for exactly that reason,
and holds every other module to 1200 lines.

---

## How this differs from the projects it is measured against

Not a criticism of them. FreeCAD, BRL-CAD and Blender are decades-old C++
codebases with plugin systems, multiple kernels, scripting bindings and
platform abstraction layers. They are structured the way they are because they
have to be, and comparing a 15,000-line browser application to them on
"architecture" in the abstract would be meaningless.

What is fair to compare is the *properties* a reader gets:

| | Here |
|---|---|
| Build step | None. The code you read is the code that runs; there is no artefact in which something could differ |
| Runtime dependencies | One, vendored and unmodified |
| Time to first test run | `npm test`, about four seconds, downloads nothing |
| Layer violations | Zero, enforced by a test rather than a convention |
| Cyclic imports | Zero, enforced |
| Modules over 1200 lines | One, the composition root, and the limit is asserted |
| Modules with no header comment | Zero, enforced |
| Unresolved identifiers | Zero, enforced with block-scoped analysis |
| Files executing a string as code | Zero, enforced |
| Test checks | 898 headless in 16 suites, 394 in 11 browser suites, 17 in the desktop shell |

The last one is the point of the rest. A structure that cannot be checked is a
structure that erodes, so every claim on this page is a line in
`tools/tests/architecture.mjs` and fails the build when it stops being true.

---

## Data flow through one edit

Worth tracing once, because it explains why the layering pays for itself.

1. A command's `run` mutates the document inside `store.edit(label, fn)`.
2. `commit()` adds a **child** to the history tree — not a truncation, so
   anything you had undone past stays reachable — and emits `DOC_CHANGED`.
3. `main.js` debounces 8 ms, then calls `rebuildAsync`.
4. That walks the features by **dependency depth**. Everything at one depth is
   independent by construction, so a whole depth goes to the worker pool at
   once; the document's own structure says what may overlap, and no scheduler is
   needed. Primitives are built on the main thread, which yields whenever it has
   held the thread longer than a frame.
5. A rebuild superseded while in flight drops its own result rather than drawing
   a model the user has already edited past.
6. The viewport syncs, the Doctor re-runs, the panels re-render.

Steps 2 and 4 are where most of this project's originality sits, and both are
possible only because of step 1's plain-JSON document.

---

## Checking any of it

```bash
npm test                            # everything, including the checks above
node tools/tests/architecture.mjs   # the layering, on its own
node tools/tests/bindings.mjs       # every identifier resolves
node tools/tests/security.mjs       # the attacks
node tools/tests/desktop.mjs        # the desktop shell's surface
```
