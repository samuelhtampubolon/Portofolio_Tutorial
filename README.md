# TesserCAD

**A free, open-source CAD studio that runs entirely in your browser.**
Parametric 3D solid modelling, 2D drafting, and 4D — three dimensions plus time — simulation.
No installation, no account, no server. Your model never leaves your machine.

> **▶ Live app:** https://samuelhtampubolon.github.io/portofolio_tutorial/
>
> Published automatically by the [deploy workflow](../../actions/workflows/pages.yml) on every
> push to `main`.

![The Model workspace: a parametric bracket built from booleans and patterns](docs/images/model.png)

---

## What it is

TesserCAD is an attempt at the parts of SolidWorks and AutoCAD that most people actually
reach for, rebuilt as a single static web page:

| | SolidWorks-style | AutoCAD-style | The fourth dimension |
|---|---|---|---|
| **Workspace** | **Model** | **Draft** | **Simulate** |
| Parametric feature history | ✔ | | |
| Solid primitives + booleans | ✔ | | |
| Extrude / revolve a sketch | ✔ | ✔ (draw it here) | |
| Patterns, mirror, transforms | ✔ | ✔ | |
| Layers, object snap, dimensions | | ✔ | |
| DXF / SVG exchange | | ✔ | |
| Timeline, keyframes, easing | | | ✔ |
| Construction sequencing (4D BIM) | | | ✔ |
| Rigid-body dynamics & motors | | | ✔ |
| Video capture of the animation | | | ✔ |

Everything is driven by **named parameters**. Type `plate_w / 2 - clearance` into any
dimension field and the whole model rebuilds when the parameter changes — that is what makes
it CAD rather than a 3D drawing program.

<table>
<tr>
<td width="50%"><img src="docs/images/draft.png" alt="The Draft workspace: a dimensioned 2D profile on layers"></td>
<td width="50%"><img src="docs/images/simulate.png" alt="The Simulate workspace: a build sequence part-way along the timeline"></td>
</tr>
<tr>
<td><b>Draft</b> — snapping, layers and dimensions, ready to extrude.</td>
<td><b>Simulate</b> — the model assembling itself along a Gantt timeline.</td>
</tr>
</table>

## Highlights

**Modelling**
- 11 parametric primitives: box, cylinder, sphere, cone/frustum, torus, tube, wedge, prism,
  pyramid, rounded plate, helix/spring — each with partial sweeps where it makes sense.
- Real constructive solid geometry: **union, subtract and intersect** on closed meshes,
  implemented with BSP trees.
- **Linear and circular patterns** (up to 2 000 instances) and **mirroring** with correct
  winding, all as live history features.
- **Extrude** with draft angle, twist and midplane option; **revolve** with partial sweeps.
- A drag-to-reorder **feature tree**, per-feature suppression, visibility and materials.
- **Mass properties** — volume, surface area, centre of mass, bounding box and mass for
  15 built-in materials.
- Move / rotate / scale gizmos, section clipping, measuring tools, four shading modes.

**Drafting**
- Line, polyline, rectangle, circle, arc (3-point), ellipse, polygon, spline, point and text.
- Linear, aligned, radial and angular **dimensions** rendered with real arrowheads.
- **Object snapping**: endpoint, midpoint, centre, quadrant, intersection, nearest and grid,
  with ortho and polar tracking.
- **Typed coordinate entry** just like the AutoCAD command line: `50,30`, `@40,0`,
  `@60<30`, or a bare length along the cursor direction.
- Layers with colour, visibility, lock and line style.
- **DXF import and export** (AutoCAD R12 — readable by every CAD/CAM package), plus SVG.
- Any closed profile becomes a solid with one click.

**Simulation (the 4D part)**
- A real timeline: play, pause, scrub, step, loop, speed control, adjustable frame rate.
- **Keyframes** on eleven properties per body (position, rotation, scale, opacity,
  visibility) with eleven easing curves including bounce and elastic.
- **Build sequencing** — give every body a start time and duration and watch the model
  assemble itself. One click auto-sequences the whole tree. This is the classic 4D-BIM
  construction simulation.
- **Rigid-body dynamics** — gravity, restitution, friction, air drag, ground-plane and
  body-to-body collision, baked deterministically so scrubbing backwards always replays
  identically.
- **Analytic motors** for mechanisms: continuous spin, rotary oscillation, linear
  reciprocation and orbit.
- **Bake dynamics to keyframes** to hand-edit a physics result.
- **Record the timeline to video** (WebM) using the browser's own encoder.

**Files**
- Projects are plain JSON (`.tcad`) — diffable, scriptable, future-proof.
- Export **STL** (binary or ASCII), **OBJ**, **glTF/GLB**, **PLY**, **DXF**, **SVG**,
  **PNG** and a **bill-of-materials CSV**.
- Import **STL**, **OBJ**, **DXF** and `.tcad` — drag and drop onto the viewport.
- Autosave to local storage, with a full undo/redo history.

## Getting started

Open the [live app](https://samuelhtampubolon.github.io/portofolio_tutorial/) and it loads a
demo bracket. Then:

1. **Model** — click the bracket, and on the right change `plate_w` from `120` to `180`.
   Everything downstream, including the bolt pattern, rebuilds.
2. **Draft** — press `R` for a rectangle and `C` for a circle inside it, select both,
   and press **Extrude →**. You now have a plate with a hole in the Model workspace.
3. **Simulate** — press **Sequence**, then space. The model builds itself along the timeline.
   Press **Drop test** to watch the same bodies fall under gravity instead.

Press `F1` for the full keyboard map, or `Ctrl`+`K` for the command palette.

There is a longer walkthrough in **[docs/USER-GUIDE.md](docs/USER-GUIDE.md)**.

## Running it locally

The app is static ES modules with no build step. Any static file server works:

```bash
git clone https://github.com/samuelhtampubolon/Portofolio_Tutorial.git
cd Portofolio_Tutorial
npm run serve          # or: python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` straight off the disk (`file://`) will **not** work, because ES modules
and import maps require an HTTP origin. Any local server is fine.

### Tests

```bash
npm test
```

This runs 51 headless assertions over the expression evaluator, the CSG kernel, the geometry
builders, the rebuild engine and the DXF codec. It shims `node_modules/three` from the
vendored copy first; nothing is downloaded.

## Deploying your own copy

1. Fork this repository.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** This one-time toggle
   cannot be automated: creating a Pages site needs repository-admin rights, and a workflow's
   `GITHUB_TOKEN` never has them. If GitHub offers to add a sample workflow during that step,
   decline it — this repository already has one, and a second workflow in the same
   `concurrency: pages` group just cancels the first at random.
3. Push to `main`. The [workflow](.github/workflows/pages.yml) runs the tests and publishes.

That is the whole deployment: free hosting, public URL, no server to run. Pages is free on
public repositories; a private fork needs a paid plan. The app is a static
site, so it works equally well on Netlify, Vercel, Cloudflare Pages, or any web host you can
copy files to.

## How it works

```
index.html            import map + the application shell
styles/app.css        design tokens, light & dark themes, responsive layout
vendor/               three.js r169 and its addons, vendored (MIT)
src/
  core/
    bus.js            a tiny event bus — the only coupling between modules
    expr.js           safe arithmetic evaluator (no eval) for parametric fields
    doc.js            document model, feature catalogue, undo/redo, autosave
    csg.js            BSP-tree constructive solid geometry
    geometry.js       Z-up primitives, profile extraction, extrude, revolve
    rebuild.js        the feature-evaluation engine, caching and mass properties
  view/viewport.js    WebGL viewport: cameras, lighting, picking, gizmos, clipping
  draft/
    draft.js          the 2D drafting board (Canvas2D), tools, snapping, dimensions
    dxf.js            DXF reader/writer and SVG writer
  sim/
    sim.js            the 4D engine: schedule, keyframes, dynamics, motors
    recorder.js       canvas → WebM video capture
  io/io.js            import, export, project save/load
  ui/                 shell widgets, feature tree, inspector, timeline
  main.js             the application controller and command registry
tools/                dev shim + the headless test suite
```

Some decisions worth knowing about:

- **The world is Z-up**, matching mechanical CAD, not three.js' default Y-up. Primitives are
  rotated once at construction so every downstream consumer speaks the same language.
- **Lengths are always millimetres internally.** Units only change display and export.
- **The document is plain JSON at all times** — no class instances anywhere in it. That makes
  `structuredClone` a complete undo system and `JSON.stringify` a complete save format.
- **Rebuilds are cached per feature** by a content key that includes the resolved parameters
  and the keys of a feature's inputs, so editing one dimension only re-evaluates what depends
  on it.
- **Dynamics are baked**, not stepped live, so scrubbing the timeline backwards is instant and
  the simulation is reproducible frame for frame.
- **No `eval`.** Parametric expressions go through a hand-written tokeniser and
  recursive-descent parser that can only ever produce a number.

## Honest limitations

It is worth being clear about what this is not, so you can decide whether it fits your work:

- **Mesh kernel, not B-rep.** Booleans operate on triangle meshes. There are no true fillets
  or chamfers on arbitrary edges, no NURBS surfaces, and no STEP/IGES exchange. Round corners
  are available as primitive parameters (the rounded plate, tube, torus and helix), not as an
  edge operation.
- **Boolean performance.** CSG is O(n log n)-ish on triangle count but constant factors are
  real; the engine refuses inputs above 90 000 triangles rather than freezing your tab. Lower
  the segment counts on the operands if you hit it.
- **Sketch constraints are not solved.** The Draft workspace gives you snapping, ortho, polar
  tracking and typed coordinates — not a geometric constraint solver, so no
  "make these two lines perpendicular and drive it from a dimension".
- **Collisions use bounding spheres.** That is the right tool for drop tests, packing studies
  and sequencing, and the wrong tool for precise contact mechanics. There is no FEA, no CFD
  and no stress analysis.
- **Assemblies are flat.** Bodies are a single ordered list; there are no sub-assemblies or
  mates. Patterns and booleans give you most of the structure you need in practice.
- **Video recording depends on the browser's encoder** (`MediaRecorder`), so the output is
  WebM in Chrome and Firefox; Safari support varies.

Requires a browser with WebGL 2 and ES modules — Chrome, Edge, Firefox and Safari from
roughly 2021 onwards. It works on a phone, but a mouse and a keyboard make it far nicer.

## Contributing

Issues and pull requests are welcome. `npm test` must pass; the source has no build step and
no dependencies to install, so a clone and a static server is the whole development setup.

## About this repository

`Portofolio_Tutorial` is a portfolio repository; alongside TesserCAD it holds a set of
machine-learning Colab notebooks (`*.ipynb` in the root). They are unrelated to the CAD app
and are kept here as part of the same portfolio.

## Licence

MIT — see [LICENSE](LICENSE). Bundles [three.js](https://threejs.org) r169, also MIT.
