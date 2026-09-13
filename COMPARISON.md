# How this compares to the projects it was measured against

Thirteen open-source 3D and CAD projects shaped the briefs behind this work.
This page says, as precisely as it can, where TesserCAD is genuinely ahead of
them, where it is genuinely behind, and which comparisons are not meaningful at
all.

It is written to be *useful*, which means it is written to be honest. A page
claiming a 23,000-line browser application beats Blender would tell you nothing
except that its author could not be trusted on anything else, and if this
repository is ever put in front of a reviewer, an examiner, or an engineer
deciding whether to rely on it, an overstated claim is the fastest way to lose
all of them.

So: **TesserCAD is not "better than" FreeCAD, Blender or BRL-CAD.** It is not
trying to be, and could not be. It leads them decisively on a specific set of
properties, and trails them decisively on another. Both lists are below.

| | |
|---|---|
| Source | 23,147 lines across 51 modules |
| Tests | 898 headless in 16 suites, 394 across 11 browser suites, 17 in the real desktop shell |
| Runtime dependencies | 1 (three.js, vendored, unmodified, 924 KB) |
| Build step | None |
| `npm test`, cold | 3.7 seconds, downloads nothing |

---

## 1. Where TesserCAD genuinely leads

These are claims anyone can check in a few minutes, which is the point.

### Zero-friction access

Open a URL. There is no install, no account, no licence server, no download and
no build. None of the thirteen can be used this way except chili3d, which is
also browser-based. FreeCAD, Blender, BRL-CAD, MeshLab, SolveSpace, LibreCAD,
QCAD, OpenSCAD, Bforartists and dust3d are all installed applications;
CadQuery and build123d are Python libraries needing an environment.

### Verifiability of the artefact you run

There is no build step, so **the code you audit is the code that runs**. There
is no bundler output, no compiled binary and no artefact in which something
could differ from the source. Every other project on the list ships a compiled
binary or a wheel built from source you are trusting someone else to have
compiled faithfully.

The desktop build, which *is* a binary, carries a signed build-provenance
attestation naming the commit and workflow that produced it. That is stronger
provenance than most of the thirteen publish.

### Enforced structure rather than documented structure

The layering, the acyclic import graph, the 1200-line module ceiling, the
absence of DOM access in the engineering layer, and the fact that every
identifier resolves are **asserted by tests that fail the build**. Most large
codebases document conventions and rely on review to hold them. This one cannot
drift without going red.

This is the one place where the comparison to a large C++ project is meaningful
in this project's favour, and it is a consequence of being small. A 23,000-line
codebase can afford to assert properties of its own import graph. A
several-million-line one cannot, and it is not a failing on their part.

### Security posture

A Content-Security-Policy of `default-src 'none'` with a SHA-256-pinned import
map, no `eval` or `Function` anywhere in the project, validation enforced at the
document's trust boundary rather than in a widget, prototype pollution closed at
every parse boundary, and a desktop shell that opens **no listening socket** and
denies every Electron permission. 76 security checks run attacks, not
assertions, and the CSP is verified in a real browser with zero violations.

Several of the thirteen have scripting engines that execute untrusted model
files as code by design. That is a legitimate trade for their use case; it is
simply a different risk position from this one.

### Engineering output most of them do not attempt

Cost and process-crossover analysis, tolerance stack-up with Cp/Cpk and ISO 286
fits, second moments of area with load cases, ISO fastener data with torque and
clearance holes, automatic orthographic drawings with hidden-line removal, and a
continuous validation Doctor. These sit *inside* the modeller rather than in a
separate tool. FreeCAD reaches much of this through workbenches; the others
mostly do not attempt it.

### Four things that appear to be genuinely novel here

Stated narrowly enough to be argued with:

- **History as a tree.** An edit after an undo branches rather than truncating,
  so no state reached in a session becomes unreachable. None of the thirteen
  does this, nor do the three commercial packages the design notes quote.
- **A worker pool driven by the document's own dependency depth**, with no
  scheduler: features at equal depth are independent by construction.
- **The document and its text as one object**, either editable, with the
  round-trip checked on the user's own document. OpenSCAD makes the text
  primary; this makes them the same object.
- **A three-way merge over a feature tree**, including the rule that disjoint
  insertions compose while a reordering is the one question a merge cannot
  answer.

---

## 2. Where TesserCAD is definitively behind

This list matters more than the one above, because it is what decides whether
the tool fits your work.

### No B-rep kernel. This is the big one.

TesserCAD's booleans operate on **triangle meshes**. That means:

- No NURBS or analytic surfaces
- No true fillets or chamfers on arbitrary edges
- No STEP or IGES exchange
- No exact geometry: a cylinder is a faceted approximation, not a cylinder

**FreeCAD, BRL-CAD, CadQuery, build123d and chili3d all have real B-rep
kernels** (OpenCascade, or BRL-CAD's own). For any workflow that needs exact
geometry, a STEP handoff to a manufacturer, or a fillet on an edge you select,
those tools are not merely better here, they are the only option. This is a
foundational difference, not a missing feature that could be added.

### No geometric constraint solver

**SolveSpace's** entire premise — sketch relationships that a solver satisfies,
so a dimension drives the geometry — is absent. The Draft workspace has
snapping, ortho, polar tracking and typed coordinates. It cannot make two lines
perpendicular and hold them that way.

### No mesh processing of consequence

**MeshLab** does remeshing, simplification, Poisson reconstruction, alignment
and a large library of filters. TesserCAD reads a mesh, recognises some
features in it, and measures deviation. It does not repair or reprocess.

### No rendering, sculpting, animation system or asset pipeline

**Blender** and **Bforartists** are in a different category of software.
Cycles, EEVEE, the modifier stack, sculpting, UV unwrapping, rigging, the
compositor, the video sequencer, geometry nodes — none of it has a counterpart
here, and the 4D timeline is keyframes and simple dynamics, not an animation
system. **dust3d**'s organic node-based modelling is likewise absent.

### No plugin, scripting or extension system

Every one of the thirteen can be extended by a third party. TesserCAD has a
macro recorder that replays command ids and no way to load external code. That
is deliberate — loading external code is exactly what the CSP forbids — but it
is a real limitation and it means the tool cannot grow the way theirs do.

### Scale, maturity and standing

FreeCAD, Blender, BRL-CAD, LibreCAD and QCAD have **decades** of development,
large contributor communities, translations, accessibility work, professional
users with production workflows, and years of accumulated bug fixes against
real-world files. BRL-CAD has been in continuous development since 1979.

This project is one person's work over a short period. No amount of test
coverage substitutes for that kind of exposure, and anyone choosing a tool for
production work should weigh it heavily.

### Simulation

No FEA, no CFD, no stress analysis. Collision uses bounding spheres, which is
right for drop tests and packing studies and wrong for contact mechanics.

---

## 3. Comparisons that are not meaningful

Some axes get compared in READMEs where the comparison means nothing, and
saying so is more useful than producing a number:

- **"Lines of code."** Fewer is not better, and more is not better. They are
  different projects solving different problems.
- **"Features."** A count across tools of different kinds measures nothing. One
  B-rep fillet is worth more to a machinist than a dozen features here.
- **Architecture in the abstract.** FreeCAD and Blender are structured as they
  are because they support plugin systems, multiple kernels, scripting
  bindings, and a dozen platforms over decades. Comparing a single-target
  browser application to that on "architecture" would be meaningless. What is
  fair to compare is properties a reader gets — no build step, one dependency,
  enforced layering — and those are in section 1.
- **Performance.** No benchmark has been run against any of them. No claim is
  made.

---

## 4. So when should you use this, and when should you not

**Use TesserCAD when:** you want to model something parametric in a browser
with nothing installed; you want the engineering output (cost, tolerance,
fasteners, drawings, section properties) alongside the model; you are working
offline or on a locked-down machine; you want to read every line that runs; or
you want your work to stay on your machine with a policy the browser enforces
rather than a promise.

**Use something else when:** you need exact geometry, fillets on selected
edges, or a STEP file for a manufacturer — **FreeCAD, chili3d, CadQuery or
build123d**. You need sketch constraints — **SolveSpace**. You need mesh
repair — **MeshLab**. You need rendering, sculpting or animation —
**Blender**. You need a mature 2D drafting package with a deep user base —
**LibreCAD** or **QCAD**. You need a plugin ecosystem — any of them but this.

Those are good tools and the right answer to real questions. This one answers a
different question.

---

## 5. Licence separation

Ten of the thirteen are GPL, LGPL or AGPL. Copying from them into an
MIT-licensed project would be a licence violation, not a style issue. **No
code, data, asset or interface resource from any of them is present here**, and
that is enforced rather than asserted: `tools/tests/architecture.mjs` checks
that exactly five lines in `src/` mention any of the thirteen by name — three
prose comments explaining a design decision, and two palette search keywords —
and fails the build on a sixth. See [ATTRIBUTION.md](ATTRIBUTION.md) for the
full accounting, including the one algorithm that *is* derived from an
MIT-licensed source and is credited for it.

---

```bash
npm test                            # 898 checks, 16 suites, 3.7 seconds
node tools/tests/architecture.mjs   # includes the originality check above
```
