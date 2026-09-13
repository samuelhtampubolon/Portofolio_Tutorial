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

## 3. The thirteen projects this one is measured against

The briefs that shaped several rounds of this work named thirteen open-source
3D and CAD projects. It is worth being precise about the relationship, because
"inspired by" is doing a lot of work in most READMEs.

**No code, no data, no asset and no interface resource from any of these has
been read, copied, ported, or adapted into this repository.** Twelve are C++,
Python, Qt, Rust and Tcl codebases; this is browser JavaScript with no build
step. A line-level comparison would find nothing to compare.

The thirteenth, **chili3d**, is the one that needs saying explicitly, because
it is the only one that could plausibly be confused with this work: it is also
a browser CAD application in TypeScript. It is not an ancestor of this one and
no part of it is present here. The two differ at the foundation — chili3d
compiles OpenCascade to WebAssembly and is therefore a real BREP kernel with
NURBS surfaces and exact geometry; TesserCAD has a mesh/BSP kernel written in
plain JavaScript and no BREP at all. That is a capability gap in chili3d's
favour and it is recorded as such under Honest limitations, not glossed.

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
| [build123d](https://github.com/gumyr/build123d) | Apache-2.0 | That a scripted CAD API reads better as a builder with explicit context than as a chained selector. `src/intel/spec.js` takes the opposite route — declarative text rather than a host language — but the argument for legibility over terseness is build123d's |
| [chili3d](https://github.com/xiangechen/chili3d) | AGPL-3.0 | Proof that a browser is a serious place to put a CAD application, and the clearest available demonstration of what a real BREP kernel buys that a mesh kernel cannot. Named in Honest limitations for exactly that reason |
| [MeshLab](https://github.com/cnr-isti-vclab/meshlab) | GPL-3.0 | That mesh repair and inspection deserve to be first-class operations with reported numbers, not a silent preprocessing step. `src/intel/hygiene.js` and `src/intel/deviation.js` report what they found and by how much, which is MeshLab's habit |
| [Bforartists](https://github.com/Bforartists/Bforartists) | GPL-3.0 | That a capable tool's interface is a legitimate thing to rework on its own, and that discoverability is a feature rather than a concession. The single command registry generating six surfaces is this project's answer to the same problem |
| [dust3d](https://github.com/huxingyi/dust3d) | MIT | That a modeller can start from intent rather than from geometry. `src/intel/brief.js` and `src/intel/speak.js` go from a requirement or a sentence to a feature tree, which is dust3d's premise applied to engineering rather than to organic form |

**Licence note.** Ten of the thirteen are GPL, LGPL or AGPL. That is precisely
why nothing from them could be used here even if it were technically
convenient: copying GPL code into an MIT-licensed project is a licence
violation, and "it was only a small function" is not a defence. chili3d is
AGPL-3.0, which is stricter still, and it is also the project closest in kind
to this one — so the separation there is not merely observed but worth being
able to demonstrate, which is what the file-level originality check in section
5 is for. Keeping this repository at arm's length from those codebases is a
legal requirement and not only good manners. Every algorithm above is either original, from a permissively licensed
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
npm test                       # 892 checks, including the security suite
node tools/check-csp.mjs       # the policy's import-map hash is current
grep -rniE "freecad|librecad|openscad|solvespace|brlcad|qcad|cadquery|blender|build123d|chili3d|meshlab|bforartists|dust3d" src/
```

That last command returns **five lines**, and it returns them because the
originality check in `tools/tests/architecture.mjs` asserts exactly which five,
so the claim on this page fails the build rather than quietly going stale:

| File | What it is |
|---|---|
| `src/ui/operators.js:9` | A header comment crediting Blender for modal transforms |
| `src/intel/drawing.js:4` | A comment contrasting this approach with Blender's |
| `src/intel/spec.js:4` | A comment arguing with OpenSCAD's premise |
| `src/ui/commands.js:49`, `:347` | Two search keywords, so typing "blender" or "openscad" in the palette finds the glTF export and the text editor |

Three prose comments and two search keywords. No vendored code, no copied file,
no generated port, and not one line from any of the thirteen. The csg.js
derivation is credited in `src/core/csg-core.js` and in section 1 above; it is
not one of the thirteen.

The security suite asserts separately that no file in the project executes a
string as code and that none references a third-party origin.
