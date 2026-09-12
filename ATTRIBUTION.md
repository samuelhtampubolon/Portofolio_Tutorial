# Attribution, originality and licences

This file exists so that nobody has to guess what in TesserCAD is original, what
is borrowed, and under what terms. It is written to be checkable: every claim
below can be verified against the source, and where something is derived from
someone else's work, that is stated plainly with the licence rather than left to
a similarity in style.

The summary is short. **No source file in this repository is copied from, ported
from, or machine-translated out of any other CAD application.** One algorithm is
structurally derived from an MIT-licensed library and is credited for it in the
file itself. Everything else third-party is either a published mathematical
method with no code lineage, or a vendored dependency with its licence intact.

---

## 1. Third-party code in this repository

### three.js — vendored, MIT

`vendor/` contains three.js r169 and ten of its addons, unmodified, with the
upstream licence preserved at `vendor/THREE-LICENSE.txt`.

They are vendored rather than fetched from a CDN for three reasons that all
matter here: the application must work with no network, the Content-Security
Policy permits no third-party origin, and a pinned copy cannot be changed under
us by someone else's deploy. **The files are kept byte-for-byte as published.**
That is deliberate: a modified dependency is one nobody can diff against
upstream, and the addons import `'three'` as a bare specifier, which is why the
import map in `index.html` is load-bearing and stays.

Nothing else is vendored. There is no build step, no bundler, no package
dependency at runtime, and `npm install` fetches nothing — `node_modules/three`
is a shim pointing at `vendor/`, created by `tools/setup-dev.mjs` so that Node
can run the test suites against the same files the browser uses.

### csg.js — derived from, MIT

`src/core/csg-core.js` implements constructive solid geometry over BSP trees.
The method is the classic one (Thibault and Naylor, *Set operations on polyhedra
using binary space partitioning trees*, SIGGRAPH 1987), but the specific
decomposition — a `Node` with `build` / `invert` / `clipTo` / `allPolygons`, and
above all the numerically careful `splitPolygon` that routes coplanar polygons
by the side their own normal faces — follows **Evan Wallace's csg.js (2011)**.

The arithmetic is rewritten over flat typed arrays rather than a per-vertex
object graph, the tolerance handling and the triangle budget are this project's
own, and the worker split has no counterpart upstream. None of that makes the
shape of the algorithm ours, so the credit is in the file header as well as
here. csg.js is MIT licensed:

```
Copyright (c) 2011 Evan Wallace (http://madebyevan.com/)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

MIT is compatible with this project's MIT licence, and the notice above
satisfies its one condition.

---

## 2. Published methods used, with no code lineage

These are standard results implemented from their mathematical statement. A
formula is not copyrightable, but saying where each one comes from is what makes
the numbers checkable by someone who wants to check them — and each is verified
against an independent reference in the test suites.

| Where | Method | Source |
|---|---|---|
| `src/intel/section.js` | Second moments of area by contour integral | Green's theorem; verified against closed form for a rectangle, circle and tube |
| `src/intel/recognise.js` | Least-squares circle fit | Kåsa's algebraic method (1976) |
| `src/intel/recognise.js` | Axis of a cylinder from normal covariance | Smallest eigenvector by inverse power iteration; standard linear algebra |
| `src/intel/tolerance.js` | Normal CDF | Abramowitz & Stegun 7.1.26, absolute error under 1.5e-7 |
| `src/intel/tolerance.js` | Normal deviates | Box–Muller transform |
| `src/intel/tolerance.js` | `mulberry32` PRNG | Tommy Ettinger's mulberry32, released into the public domain (CC0). Chosen because a reproducible seed makes a Monte Carlo result diffable |
| `src/intel/hygiene.js` | Payload hash | FNV-1a, public domain |
| `src/intel/merge.js`, `src/intel/spec.js` | Longest common subsequence | The classic dynamic-programming formulation |
| `src/core/geometry.js` | Chord tolerance / sagitta for tessellation | `r(1 − cos(θ/2))`, elementary geometry |
| `src/intel/drawing.js` | Hidden-line removal | Projected-triangle depth comparison, a standard image-space approach; no published implementation consulted |

### Engineering data from standards

The dimensional and material tables are **facts published in standards**, not
code. They are transcribed and then cross-checked in the test suites against
the printed values, which is why `tools/tests/fasteners.mjs` reads like a list
of assertions about ISO tables — because that is exactly what it is.

| Data | Standard |
|---|---|
| Thread pitch, tensile stress area | ISO 724, ISO 898-1 |
| Clearance holes, three classes | ISO 273 |
| Property classes, proof stress | ISO 898-1 |
| Socket cap head dimensions | ISO 4762 |
| Hexagon nut dimensions | ISO 4032 |
| Standard tolerance grades IT1–IT13 | ISO 286-1 table 1 |
| Fundamental deviations | ISO 286-1 |
| Projection conventions | ISO 128 (first angle), ASME Y14.3 (third angle) |
| Sheet sizes | ISO 216 |

The standards documents themselves are copyrighted and are not reproduced. The
individual dimensional values are measurements, which is why an engineering
handbook can print them and so can this.

Process rates, material prices and cost figures are **not** from a standard.
They are order-of-magnitude figures drawn from published shop guidance and are
labelled as such everywhere they appear, including in the user interface, which
states that nothing in the cost model should be shown to anyone as a price.

---

## 3. The eight projects this one is measured against

The brief that shaped several rounds of this work named eight open-source CAD
projects. It is worth being precise about the relationship, because
"inspired by" is doing a lot of work in most READMEs.

**No code, no data, no asset and no interface resource from any of these has
been read, copied, ported, or adapted into this repository.** They are C++,
Python, Qt and Tcl codebases; this is browser JavaScript with no build step. A
line-level comparison would find nothing to compare.

What they contributed is **problem framing**, which is both legitimate and worth
acknowledging:

| Project | Licence | What was taken |
|---|---|---|
| [FreeCAD](https://github.com/FreeCAD/FreeCAD) | LGPL-2.0+ | The parametric-feature-tree model as the right centre of a CAD application. An idea, not an implementation |
| [LibreCAD](https://github.com/LibreCAD/LibreCAD) | GPL-2.0 | That 2D drafting deserves first-class treatment rather than being a mode of the 3D view |
| [OpenSCAD](https://github.com/openscad/openscad) | GPL-2.0 | That a design can be text. `src/intel/spec.js` argues with OpenSCAD's premise rather than borrowing from it: there, the text is the only representation; here, the text and the model are one object and either can be edited |
| [SolveSpace](https://github.com/solvespace/solvespace) | GPL-3.0 | What a constraint solver makes possible, and therefore what this application honestly cannot do. Named in Honest limitations |
| [BRL-CAD](https://github.com/BRL-CAD/brlcad) | LGPL-2.1 | That CSG is a durable way to model solids |
| [QCAD](https://github.com/qcad/qcad) | GPL-3.0 / commercial | Layer, linetype and dimension conventions as users expect them, which are themselves ISO conventions |
| [CadQuery](https://github.com/CadQuery/cadquery) | Apache-2.0 | That scripted CAD should produce an editable model and not a mesh |
| [Blender](https://github.com/blender/blender) | GPL-2.0+ | Modal transform operators — press `G`, move, type a number. `src/ui/operators.js` says so in its header. This is the one interaction that was consciously reimplemented because it is better than the CAD convention, and reimplemented from the *behaviour*, not from Blender's source |

**Licence note.** Six of the eight are GPL or LGPL. That is precisely why
nothing from them could be used here even if it were technically convenient:
copying GPL code into an MIT-licensed project is a licence violation, and
"it was only a small function" is not a defence. Keeping this repository at
arm's length from those codebases is a legal requirement and not only good
manners. Every algorithm above is either original, from a permissively licensed
source with its notice reproduced, or implemented from a published mathematical
statement.

---

## 4. What is genuinely original here

Listed not as a boast but because a claim of originality should be specific
enough to be argued with.

- **History as a tree rather than two stacks** (`src/core/doc.js`). An edit after
  an undo branches instead of truncating, so no state reached in a session is
  ever unreachable. None of the eight does this; neither do the three commercial
  packages the design notes quote.
- **A worker pool driven by the document's own dependency depth**
  (`src/core/csg-pool.js`, `rebuildAsync`). No scheduler: features at equal
  depth are independent by construction, so a whole level dispatches at once.
- **The document and its text as one object** (`src/intel/spec.js`), with a
  round-trip check that runs on the user's own document rather than a claim in
  a README.
- **A three-way merge over a feature tree** (`src/intel/merge.js`), including the
  rule that disjoint insertions at one point compose while the same features in
  a different order is the one question a merge cannot answer.
- **Design intent that imports as well as exports** (`src/intel/deviation.js`),
  and a deviation map that names a unit mismatch as a unit mismatch instead of
  reporting it as a 900 mm shape error.
- **Validation at the data boundary** (`sanitiseParams`), making the feature
  catalogue the single authority on what a parameter may be rather than a hint
  to one widget.
- **A typed-intent grammar that refuses what it does not understand** and reports
  every word it ignored (`src/intel/speak.js`), instead of guessing.
- **Cost and process crossover analysis inside the modeller**
  (`src/intel/cost.js`), answering where the cheapest process changes as
  quantity grows.
- **Float32 precision loss reported as the real step at the real distance**
  (`src/intel/hygiene.js`), verified against `Float32Array` rather than a rule
  of thumb.

---

## 5. How to check any of this

```bash
npm test                       # 854 checks, including the security suite
node tools/check-csp.mjs       # the policy's import-map hash is current
grep -rn "freecad\|librecad\|openscad\|solvespace\|brlcad\|qcad\|cadquery\|blender" src/
```

At the time of writing that last command returns five lines: four prose comments
naming Blender or OpenSCAD to explain a design decision, and two command
keywords so that searching the palette for "blender" or "openscad" finds the
glTF export and the text editor. No vendored code, no copied file, no generated
port. The csg.js derivation is credited in `src/core/csg-core.js` and in section
1 above; it is not one of the eight.

The security suite asserts separately that no file in the project executes a
string as code and that none references a third-party origin.
