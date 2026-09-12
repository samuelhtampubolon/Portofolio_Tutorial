# TesserCAD user guide

A walkthrough of the three workspaces, written so you can follow along in the app.

- [0. The interface](#0-the-interface)
- [0.5 On a phone](#05-on-a-phone)
- [0.6 On a tablet](#06-on-a-tablet)
- [1. The basics](#1-the-basics)
- [2. Model — parametric solids](#2-model--parametric-solids)
- [3. Draft — 2D drawing](#3-draft--2d-drawing)
- [4. Simulate — the fourth dimension](#4-simulate--the-fourth-dimension)
- [5. Files and exchange](#5-files-and-exchange)
- [5.5 Studio: checking, costing and shipping](#55-studio-checking-costing-and-shipping)
- [5.6 Analyse: sections, clashes, variants and versions](#56-analyse-sections-clashes-variants-and-versions)
- [6. Keyboard reference](#6-keyboard-reference)
- [7. Worked examples](#7-worked-examples)

---

## 0. The interface

**Menu bar.** Thirteen menus across the top: File, Edit, Create, Modify, View, Measure, Draft,
Simulate, Export, Window, Studio, Analyse, Help. Submenus open on hover, toggles show a checkmark, and anything
that doesn't apply right now is greyed rather than hidden — so you can always see that it
exists and work out why it is unavailable.

**Ribbon.** The second row is a contextual toolbar that changes with the workspace, grouped and
labelled (Create, Combine, Repeat, Transform…). It scrolls sideways when the window is narrow.

**Command palette — `Ctrl K`.** Ranked fuzzy search over all 188 commands. Your recent commands
appear first when the box is empty. This is the fastest way to reach anything you haven't
memorised a shortcut for.

**Quick menu — `Q`.** Eight numbered favourites at the cursor, different in each workspace.
Press `Q` then `1`–`8` without moving the mouse.

**Context menus.** Right-click a body in the viewport, or a row in the feature tree, for exactly
the operations that apply to it.

**Panels.** `T` toggles the left outline panel, `N` the right properties panel. Both collapse
to give the viewport the whole window; on a tablet one is docked at a time, and on a phone they
slide up as bottom sheets.

**Status bar.** The left side tells you what the current tool wants next. The right side shows
the live mouse-button map for the workspace you are in, the selection count, the units and the
model statistics including how long the last rebuild took.

**Learning card.** A small checklist in the corner of the viewport tracks the eight things
worth trying first and ticks them off as you do them. Close it with its ✕, or bring it back
from **Help → Show the learning card**.

**Preferences — `Ctrl ,`.** Theme, gizmo size, snap increment, edge-display angle, autosave
interval and whether deletes ask first. Stored in the browser, not in the document.

### Modal transform operators

This is the fastest way to move anything, and it is worth learning first.

1. Select a body.
2. Press **`G`** (move), **`R`** (rotate) or **`S`** (scale). The selection now follows the pointer.
3. Optionally press **`X`**, **`Y`** or **`Z`** to lock to that axis — press the same key again
   to unlock, or **`⇧X`** to lock the *plane* perpendicular to X instead.
4. Optionally **type a number** for an exact value — `G` `X` `25` `⏎` moves exactly 25 mm in X.
5. Hold **`⇧`** for precision (a tenth of the movement) or **`Ctrl`** to snap to the increment
   set in preferences.
6. **`⏎`** or a click confirms. **`esc`** cancels and puts everything back exactly as it was.

A readout above the viewport shows the live value and the keys available at each moment. The
result is written into the feature's transform, so it stays parametric and undoable.

### Starter templates

**File → New from template** offers six documents, and every one is a working parametric model
rather than a picture:

| Template | What it demonstrates |
|---|---|
| Blank document | An empty model with millimetres and one example parameter |
| Bolted plate | A rounded plate with a parametric 2×2 bolt pattern cut through it |
| Flanged pipe | Two flanges unioned onto a tube, then a bore and two bolt rings subtracted |
| Enclosure shell | A hollow box made by subtracting an inset copy of itself |
| Stepped shaft | Three concentric diameters driven by one length parameter |
| 4D build sequence | A stack of floors pre-sequenced on the timeline — press play |

Open one and change its parameters; that is the quickest way to see what a feature history does.

---

## 0.5 On a phone

Below 700px TesserCAD swaps its whole chrome for a touch layout. Everything the desktop can do
is still reachable — it just gets there differently.

**Bottom bar.** Model, Draft, Simulate, Panels, More. The first three switch workspace; Panels
opens the outline and properties; More opens every menu.

**Panels sheet.** A bottom sheet with an Outline / Properties switch. Drag the grey handle to
resize between half and full height, or flick it downwards to dismiss. It hosts exactly the same
panels as the desktop sidebars, so nothing is missing or simplified.

**More sheet.** A search row that opens the command palette, six quick actions, then all eleven
menus as accordions — 192 commands in total, each with its icon and keyboard shortcut.

**Floating cluster**, bottom right of the viewport: zoom-to-fit, a views-and-display sheet
(standard views, shading, ortho, grid, isolate, section, theme) and undo. In Draft the middle
button toggles object snap instead.

**Gestures.**

| | 3D (Model / Simulate) | 2D (Draft) |
|---|---|---|
| One finger | orbit | draw with the active tool |
| Two fingers | pan and pinch-zoom | pan and pinch-zoom |
| Tap | select | place a point |
| Long-press | context menu | context menu |

In Draft a drawing tool commits when you **lift** your finger, not when you press — so putting a
second finger down turns the gesture into a pan without leaving a stray point behind.

**What still needs a keyboard.** The modal `G`/`R`/`S` transform operators and the shortcut map.
On a phone, use the gizmo from **Modify → Gizmo** and the numeric fields in Properties instead;
both are fully touch-sized.

---

## 0.6 On a tablet

From 700px to 1279px you get the desktop chrome with one change: **one side panel is docked at
a time** instead of two. Two 280px panels on an iPad in portrait would leave roughly 200px of
viewport, so the tablet trades the second panel for a usable model view.

**The dock switch.** The segmented control at the top of the docked panel swaps between Outline
(Layers in Draft, Bodies in Simulate) and Properties. Swapping does not change the viewport
width, so nothing jumps. Your choice is remembered the next time you open the app.

**Putting the dock away.** The top button of the floating cluster hides and shows the whole dock
and hands the full width to the viewport. It is the only control that can bring the dock back
once it is gone, which is why it sits in the viewport rather than in a menu.

**The Menu button** at the top left holds all eleven menus as submenus, in the same order and
with the same items as the desktop menu bar. Tap a menu to open its submenu; tapping back into
the parent list keeps everything open.

**Floating cluster**, bottom right: dock toggle, zoom-to-fit, views and display, undo. In Draft
the views button becomes object snap. The views button opens a popover beside itself rather
than a bottom sheet, since sheets are phone chrome.

**Gestures** are the same as on a phone: one finger orbits or draws, two fingers pan and pinch,
long-press is the context menu, and a Draft tool commits on lift.

**With a keyboard attached** everything behaves as it does on the desktop, including the modal
`G`/`R`/`S` operators. `T` and `N` dock the outline and properties panels; pressing the same key
again puts the dock away.

---

## 1. The basics

**Three workspaces, one document.** The tabs at the top switch between Model, Draft and
Simulate. They all edit the same file: a profile you draw in Draft can become a solid in
Model, and every solid in Model gets a track in Simulate.

**Units.** Internally every length is a millimetre. Choosing a different unit in
*Properties → Document* changes only how numbers are displayed and exported, so switching
units never moves your geometry.

**Saving.** The app autosaves to your browser's local storage every 20 seconds and when you
close the tab, and restores that on the next visit. That is a convenience, not a backup —
use **File → Save project** (`Ctrl`+`S`) for anything you care about. A `.tcad` file is
plain JSON.

**Undo.** `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z`, 120 steps deep, covering everything: geometry,
drawing, parameters, animation and view settings.

**Command palette.** `Ctrl`+`K` finds any of the 188 commands by fuzzy name. If you cannot
find a button, look here first.

### Navigating the 3D view

| Action | Mouse |
|---|---|
| Orbit | left-drag on empty space |
| Pan | right-drag, or middle-drag |
| Zoom | wheel |
| Select | click a body |
| Add to selection | `Shift`-click or `Ctrl`-click |
| Frame the selection | double-click |
| Fit everything | `F` |
| Standard views | `1`–`6`, isometric `0`, or the cube in the corner |

---

## 2. Model — parametric solids

### Adding a solid

Pick any shape from the **Solids** group in the toolbar. It appears standing on the ground
plane (Z = 0) and is selected, so its parameters are already showing on the right.

The eleven primitives:

| Shape | Notable parameters |
|---|---|
| Box | width, depth, height |
| Cylinder | radius, height, **sweep angle** (a pie slice, properly capped) |
| Sphere | radius, segments |
| Cone / frustum | bottom radius, top radius (0 for a true cone), height |
| Torus | ring radius, tube radius, **sweep angle** |
| Tube / pipe | outer radius, inner radius, height |
| Wedge | width, depth, height |
| Prism | radius, height, number of sides |
| Pyramid | base radius, height, number of sides |
| Rounded plate | width, depth, thickness, **corner radius**, optional centre hole |
| Helix / spring | coil radius, wire radius, pitch, turns |

### Making it parametric

Open **Parameters** at the bottom of the right panel and add one, for example
`wall = 4`. Now type `wall * 3` into any length field. The field shows the resolved value
underneath, and the model rebuilds whenever `wall` changes.

Expressions support `+ - * / % ^`, parentheses, and the functions
`sin cos tan asin acos atan atan2 hypot sqrt cbrt abs exp ln log log2 floor ceil round sign
min max pow deg rad clamp lerp`, plus the constants `pi`, `e`, `tau` and `phi`. Trigonometric
functions take radians, so write `cos(rad(30))`.

Parameters may reference earlier parameters, so `plate_area = plate_w * plate_d` works.

### Combining bodies

Select two or more bodies — in the viewport with `Shift`-click, or in the feature tree — then
press **Union**, **Subtract** or **Intersect**.

Order matters for subtraction: **the first body selected is the one that survives**, and every
other selected body is cut out of it. The order used is the order the features appear in the
tree, not the order you clicked.

A boolean becomes a new feature that *consumes* its inputs. Consumed features stay in the tree,
dimmed, and remain fully editable — change the radius of a cutting cylinder and the hole in the
result changes. That is the whole point of a feature history.

### Patterns and mirroring

Select exactly one body and press **Linear**, **Circular** or **Mirror**.

- **Linear pattern** has two independent directions, so it makes grids as well as rows. Set
  *Count 2* to 1 for a simple row.
- **Circular pattern** takes an axis, a centre point, a total angle and a count, and can
  either rotate the copies or keep them all facing the same way.
- **Mirror** reflects across the YZ, XZ or XY plane at an offset, with an option to keep the
  original. Mirrored geometry is re-wound so its faces stay outward.

Patterns share one copy of the geometry between instances, so a 200-instance pattern costs
almost nothing in memory.

### Moving things

Three ways, in rough order of speed:

1. **Modal operators** — `G`, `R`, `S`, described in [section 0](#0-the-interface). Fastest.
2. **Gizmos** — `W` for move, `⇧E` rotate, `⇧R` scale. Best when you want to drag along a
   visible handle.
3. **Typing into the Transform section** on the right, which also accepts expressions. The transform fields accept expressions too, so a boss can sit at
`plate_h + boss_h/2` and follow the plate when it gets thicker.

Helpers worth knowing: **Drop to floor** (`D`) sits the body on Z = 0, **Centre on origin**
moves its bounding-box centre to the world origin, **Align on X/Y/Z** brings several bodies to a
shared centre on that axis, and **Distribute evenly** spaces three or more bodies along whichever
axis they already span most.

### Seeing only what you need

**Isolate** (`/`) hides everything except the selection and shows a banner until you press `/`
again. **Hide** (`H`) hides the selection; **`Alt H`** shows everything. All three are
non-destructive and independent of a feature's suppressed state.

### Reading the model

**Mass properties** (per feature) and **Model summary** (whole document) report volume,
surface area, mass for the chosen material, bounding box, centre of mass and whether the mesh
is watertight. If a body reports *Watertight: no*, its booleans and its volume are not
trustworthy — usually it came in from a damaged STL.

**Measure** in the toolbar gives distance between two picked points, the angle between three,
or the coordinates of one. Press `Esc` to stop measuring.

**Section view** in *Properties → View* slices the model on any axis so you can see inside.

### When something fails

A feature that cannot build turns red in the tree and shows the reason in the right panel —
"Boolean needs at least two input bodies", "Revolve profile must stay on one side of the
axis", and so on. The rest of the model keeps building; fix the parameter and it recovers.

---

## 3. Draft — 2D drawing

The Draft workspace is a drafting board. Drawing happens on the XY plane; the red and green
lines are the X and Y axes.

### Drawing

Pick a tool (or press its letter) and click. The status bar tells you what the tool wants
next. `Esc` cancels the current operation, then deselects, then returns to the Select tool.

| Tool | Key | How it works |
|---|---|---|
| Line | `L` | two clicks; keeps going from the last point |
| Polyline | `P` | click points; `Enter` or double-click finishes, `C` closes |
| Rectangle | `R` | two opposite corners |
| Circle | `C` | centre, then a point on the circle |
| Arc | `A` | start, a point along the arc, end |
| Ellipse | `E` | centre, X radius, Y radius |
| Polygon | `G` | centre, then a vertex (sets both radius and rotation) |
| Spline | `S` | click fit points; `Enter` finishes |
| Point | | a single node — useful purely as a snap target |
| Text | `X` | click, then type |
| Offset | `O` | pick an object, then click the side to offset towards |
| Measure | `M` | two points; reports distance, ΔX, ΔY and angle |

### Typing exact coordinates

While a tool has a rubber band active you can type instead of clicking, then press `Enter`:

| You type | It means |
|---|---|
| `50,30` | the absolute point X = 50, Y = 30 |
| `@40,0` | 40 mm in +X from the last point |
| `@60<30` | 60 mm at 30° from the last point |
| `25` | 25 mm along the direction the cursor is pointing |

### Snapping and constraints

**Object snap** (`F3`) latches onto real geometry, with a marker showing which kind:

| Marker | Snap |
|---|---|
| □ | endpoint |
| △ | midpoint |
| ○ | centre |
| ◇ | quadrant |
| ✕ | intersection |

Individual snap types can be switched off in the right panel. **Ortho** (`F8`) locks new
segments to horizontal or vertical; **polar tracking** (`F10`) locks them to a settable angle
step. Grid snapping follows the grid, which changes density as you zoom.

### Dimensions

Linear, aligned, radial and angular dimensions are entities like any other: they live on a
layer, they scale, and they export. Pick the two measurement points, then a third click
places the dimension line. Their text height is set by *Tool settings → Text / dim size*, in
drawing units, so a dimension stays the right size relative to the part.

### Layers

Layers carry a colour, visibility, a lock and a line style. Click a layer to make it active;
double-click to rename; the pill shows how many objects are on it. New objects land on the
active layer. Locked layers are ignored by both selection and snapping.

### Turning a drawing into a solid

Select the geometry that forms your profile and press **Extrude →** or **Revolve →**.

What counts as a profile:

- Anything already closed — a rectangle, circle, ellipse, polygon or closed polyline.
- **Separate open segments that meet end to end.** Four lines drawn as a box are chained
  into one loop automatically, exactly like AutoCAD's `BOUNDARY`.
- Loops **inside** other loops become holes automatically, nested to any depth.

**Extrude** options: distance, midplane (symmetrical about the sketch plane), which plane to
build on (XY / XZ / YZ), a plane offset, a **draft angle** (the profile is genuinely offset
per layer, mitred at the corners — not just scaled) and a **twist**.

**Revolve** options: angle (partial revolves get flat end caps), which sketch axis to spin
around, and the sketch plane. The profile must stay entirely on one side of the axis; if it
crosses, the feature reports that rather than producing a self-intersecting mess.

The link is live. The solid stays connected to the drawing objects, so editing the drawing
rebuilds the solid. Select the feature in Model and press **Show in Draft** to jump back to
its profile, or **Link draft selection** to point it at different geometry.

---

## 4. Simulate — the fourth dimension

Three layers stack up, evaluated in this order. Use one, or all three together.

### Layer 1 — the build sequence

This is 4D in the construction-planning sense: geometry plus schedule.

Press **Sequence** (or *Simulate → Auto-sequence the build*) and every body is given a start
time and a duration in tree order. Scrub the timeline and the model assembles itself: bodies
are invisible before their slot, animate in during it, and stay put afterwards.

Per body you can set the start, the duration and how it appears: pop in, fade, grow from the
centre, rise, drop, slide in from X or Y, or **build up** (a Z sweep, which reads like
pouring or 3D printing). Drag the green bars directly on the timeline to reschedule.

### Layer 2 — keyframes

Select a body and expand its track in the timeline. Eleven properties can be keyed:
position X/Y/Z, rotation X/Y/Z, scale X/Y/Z, opacity and visibility.

- Set the playhead, type a value in the right panel and press **◆** — or double-click an
  empty spot on a property row to drop a key there.
- **◆ Key pose** writes the body's entire current pose as keyframes at once.
- Drag a key to move it in time; `Alt`-click or right-click deletes it.
- Each key carries an easing curve for the segment that follows it: `linear`, `step`,
  `smooth`, `easeIn/Out/InOut`, `cubicIn/Out/InOut`, `back`, `elastic`, `bounce`.

Position and rotation values are **offsets from where the body is modelled**, so a key of
`0` always means "at rest". Scale values are multipliers.

### Layer 3 — dynamics

Switch on **rigid-body dynamics** to get gravity, restitution, friction, air drag, a ground
plane and body-to-body collision. Per body you set mass, whether it is static (immovable),
bounciness, friction, an initial velocity and an initial spin.

The solution is **baked**: the whole timeline is integrated once with substepping and stored
as a pose per frame. Scrubbing backwards is therefore instant, and the same setup always
produces exactly the same motion. Changing any physics setting re-solves automatically.

**Drop test** in the toolbar is a one-click setup: every body becomes dynamic with a small
tumble and falls onto Z = 0.

For mechanisms, use a **motor** instead of physics. Motors are analytic — they follow their
schedule exactly regardless of forces, which is what you want for a gear, a crank or a
conveyor:

| Motor | Parameters |
|---|---|
| Continuous spin | axis, rate in °/s |
| Rotary oscillation | axis, amplitude in °, frequency, phase |
| Linear reciprocation | axis, amplitude in mm, frequency, phase |
| Orbit a point | axis, radius, frequency, phase, optionally facing the travel direction |

**Bake dynamics to keyframes** converts a physics solution into editable keys, which is the
usual way to art-direct a simulation: let physics find the motion, then fix the bits you
did not like by hand.

### Recording

**● Record** replays the timeline frame by frame, rendering each one, and encodes the result
with the browser's own video encoder. You get a `.webm` file. Keep the tab in the foreground
while it runs.

---

## 5. Files and exchange

### Project files

`.tcad` files are plain JSON containing the whole document: parameters, features, the
drawing, the timeline and the view state. They are diffable, so they work well in git, and
because they are JSON you can generate them from a script.

Documents carry a schema version and are migrated on load, so older files keep opening.

### Exporting

| Format | Use it for |
|---|---|
| **STL** (binary or ASCII) | 3D printing, mesh workflows |
| **OBJ** | general interchange, keeps body names |
| **glTF / GLB** | Blender, Unity, Unreal, web viewers; keeps colours and materials |
| **PLY** | point/mesh tools; keeps per-vertex colour |
| **DXF** | AutoCAD, LibreCAD, laser cutters, CAM |
| **SVG** | documentation, plotting, vector editors |
| **PNG** | screenshots at 2× resolution |
| **CSV** | bill of materials: feature, type, material, body count, volume, mass |

Mesh exports capture the bodies as they are *currently posed*, so exporting mid-simulation
gives you that frame.

### Importing

Drag a file onto the viewport, or use **File → Import**:

- **STL** and **OBJ** arrive as mesh features with an import scale you can adjust. They take
  part in booleans like anything else, as long as they are watertight.
- **DXF** merges into the drawing, matching layers by name. LINE, LWPOLYLINE, POLYLINE,
  CIRCLE, ARC, ELLIPSE, POINT, TEXT, MTEXT, SOLID and 3DFACE are understood.
- **.tcad** replaces the current document.

---

## 5.5 Studio: checking, costing and shipping

Everything in the **Studio** menu is about the work around the model rather than the model
itself. None of it needs an account, a server or a network call.

### The Design Doctor

Sixteen checks run after every rebuild. Findings appear in the right panel, and the status bar
carries the worst one so you can see the verdict without looking for it. `F8` opens the full
report.

The first control in the section is **Making it by**, and it matters more than it looks: every
limit the Doctor measures against comes from the process you pick. A 0.4mm wall passes for
injection-moulded ABS and fails for sand casting.

Each finding has three parts: what is wrong, what it means for the part, and *why it matters*.
Where a repair is unambiguous, there is a button for it — thicken the wall, reconnect a
boolean whose inputs were deleted, unsuppress an input that was switched off, relink a lost
profile. Repairs are never applied on their own, and each is a single undo.

A few checks are honest proxies rather than exact analyses. Interference compares bounding
boxes, not solids, so a diagonal part will report an overlap it does not have. The finding
says so in its own text; it is there to make you look.

### Cost estimate

Compares every process that suits both the material and the shape, and shows how the answer
changes with quantity — usually the only part of the estimate worth acting on. A part that is
cheapest printed at ten is rarely cheapest printed at ten thousand.

Read the **largest cost driver** line: if it says machine time and "97% of the stock block is
cut away", the fix is a smaller bounding box, not a cheaper supplier.

These are order-of-magnitude figures from a generic rate model. They will not match your
quote. They will tell you which process to ask for one from.

### Design brief

`Studio → New from a design brief`. Pick an archetype, state what you know — the load, the
span, the fixings, the material — and it sizes the part from first principles and shows the
calculation before it builds anything.

| Archetype | Sized by |
|---|---|
| L-bracket | Cantilever bending: `t = sqrt(6FL / bσ)` |
| Bolted plate | Simply-supported strip at mid-span |
| Shaft | Torsion of a round section, shear yield at 0.577 of tensile |
| Pressure tube | Thin-wall hoop stress, `t = pD / 2σ` |
| Enclosure | Walls at 1.5× the process minimum, cavity driven by the contents |

The sizing is written into the model as expressions, not baked numbers, so the model is a
description of the family rather than a drawing of one part: change `load` and the geometry
follows. Every assumption lands in **Document → notes**, where it outlives the dialog.

These are closed-form calculations on idealised sections. No stress concentrations, no fatigue,
no buckling, no real boundary conditions. They are a starting point for analysis, not a
replacement for it.

### Release design

`Ctrl`+`Shift`+`R`. Runs the checks, then builds one ZIP containing the mesh, the drawing, the
BOM, the cost basis, a preview, the editable source, a README explaining all of it, and
`design-intent.json`.

A blocking finding stops the release. That is deliberate: shipping is the moment an error costs
the most, so it is the moment to be least convenient about it. You can override it, and the
override is labelled as one.

**`design-intent.json`** is worth knowing about on its own (`Studio → Export design intent`).
Mesh formats carry geometry with the reasoning stripped out. This carries the parameters with
their resolved values, the feature history, which parameter drives which dimension, what
consumes what, and the material — in plain JSON that anything can read. It is not STEP and does
not claim to be; it is what STL throws away, written down beside it.

### Macros

`Studio → Record a macro`. Do the workflow once; press stop. Replaying it is a single undo step.

Only commands from the registry are captured, so a drag in the viewport is not recorded, and
commands that open a file picker are refused while recording rather than stalling the replay.
If a macro uses commands that act on the selection, it says so, and you select something first.

### Studio standards

The settings you should only have to give once: units, default material, your shop's real
minimum wall and tolerance, your rates, your batch size. They seed every new document and are
what the Doctor measures against. They are never applied to a document that arrived from
somebody else.

The same dialog holds the **decision log** — what was chosen and why, written whenever you
accept a repair or build from a brief — and exports the whole studio as one file to move
between machines.

### Engineering notes

Once you have finished the eight-step tour, the card in the corner of the viewport becomes a
tutor: it explains the engineering reason behind whatever the model is currently doing, one at
a time, and never repeats one you have read. `Studio → Engineering notes` shows them all at
once.

---

## 5.6 Analyse: sections, clashes, variants and versions

Where **Studio** is about the work around the design, **Analyse** is about getting real numbers out
of the geometry you have.

### Section properties  `Ctrl`+`Shift`+`A`

Select a body and cut it. The dialog draws the true cross-section to scale, marks its centroid, and
draws its principal axes, then reports:

| | |
|---|---|
| Area | Exact, holes subtracted |
| Iₓₓ, I_yy, Iₓᵧ | Second moments about the centroid |
| I₁, I₂ | Principal moments: the strongest and weakest directions |
| Principal axis | The angle those directions sit at, which is rarely the one you would guess |
| S₁ | Section modulus, the number that turns a bending moment into a stress |
| r₁ | Radius of gyration, for buckling |

Then give it a load case — cantilever, simply supported, built in at both ends, or pure axial — with
a force, a span and a safety factor, and it reports the bending stress and the utilisation against
the material's yield.

**Read the principal axis line.** A section is usually far stronger one way than the other, and the
whole point of the drawing is to show you which way that is before you orient the part.

This is exact section geometry and a first-order stress from it: the calculation an engineer does on
paper before deciding whether a part is worth analysing properly. It knows nothing about stress
concentrations, how the load is introduced, fatigue, or anything three-dimensional. **It is not
finite element analysis**, and the dialog says so every time.

### Clash check

Reports the volume two bodies genuinely share, and where its centre is. Not "their bounding boxes
overlap" but "these two parts occupy 412 mm³ of the same space, centred here."

Bounding boxes are still used as the first pass, because box overlap is a necessary condition for a
clash and discarding the rest is free. Only the survivors get an exact intersection.

The Design Doctor runs the same test continuously but with a time budget, since an exact
intersection is a full boolean. Anything it could not reach in time is reported as *not yet
checked*, and this command runs it without the hurry.

When nothing clashes, it tells you the closest approach instead.

### Inspect imported mesh

For a mesh that arrived with no feature tree. It measures rather than reconstructs:

- **Holes**, with diameter, centre, axis, depth and roundness, matched against standard metric
  clearance sizes. A hole drilled at an angle is found with its axis recovered from the geometry,
  not assumed to be along Z.
- **Flat faces**, with area, normal and position.
- A **unit sanity check**: nothing in an STL states its units, so if the model is implausibly small
  or large the dialog says what size it would be under each interpretation and leaves the decision
  to you.

**Roundness** is worth reading. A drilled hole is over 99%. Anything lower is a rounded pocket that
is nearly circular, and the figure is shown so you can tell them apart.

Press **Make a cut** on a hole and it becomes a real parametric cylinder at exactly the measured
position and diameter, subtracted from the mesh. The mesh stays opaque; the hole is now a feature
you can move, resize and drive from a parameter.

### Configurations

A configuration is a named set of parameter values inside this document. One feature tree, many
sizes.

Add one, switch to it, change a parameter: the change is recorded against that variant and nothing
else. **Only the parameters a variant overrides are stored**, so a change to the shared design
reaches every variant instead of needing to be applied to each.

`Analyse → Export the family table` writes one CSV row per configuration, which is what a parts
catalogue wants.

### Versions  `Ctrl`+`Shift`+`S`

Snapshots, branches and a real diff, all in this browser. No account, no server, no check-in.

The diff is the part worth having. Not "the file changed" but `plate_w 140 → 180`,
`added Bolt hole`, `Bolt pattern count 4 → 6`. Features are matched by id first and by name second,
so renaming one reads as a rename rather than a delete plus an add.

**Branches** are for trying something without risking what works. A branch starts from where you
are, and the trunk is untouched by anything you save on it.

Storage is finite: versions are whole documents, and when the browser's allowance runs out the
oldest are dropped and you are told how many. If a version matters, save the `.tcad` file too.

### Export quality

Segment counts are set per feature while modelling, when what matters on export is the tolerance of
the thing being exported. So export has its own setting, stated as a **chord tolerance**: no point
on the exported mesh is further than that from the surface it represents.

| Quality | Tolerance | For |
|---|---|---|
| Draft | 0.25 mm | A quick look, a small file |
| Standard | 0.05 mm | Most 3D printing and visualisation |
| Fine | 0.01 mm | Close-range rendering, machining setup |
| As modelled | — | Whatever the features already carry |

One tolerance gives a 3mm bolt hole and a 200mm flange each exactly the segments they need, which is
the fix for meshes that arrive with a thousand triangles on a flat face and a visibly faceted
cylinder beside it. The dialog shows the before and after per feature. It applies to export only:
the document you are editing keeps its own counts.

---

## 5.7 Drawings, tolerance and text

Everything in this section is in the **Studio** and **Analyse** menus, and all of it is reachable
from the command palette with `Ctrl`+`K`.

### Shop drawing  `Ctrl`+`Shift`+`D`

Projects the model onto a real paper size as an orthographic drawing: views, dimensions, hole
callouts, centre marks and a filled title block.

| Control | What it does |
|---|---|
| Paper | A4, A3 or A2 landscape. The scale is chosen from the standard series so every view fits its cell. |
| Views | Front, top, right and an isometric. Turn off what you do not need and the rest are re-laid out. |
| Projection | First angle (ISO) or third angle (ASME). This moves the views *and* changes the symbol, so the two can never disagree. |
| Remove hidden lines | On, edges behind material are dashed. Off draws every edge, which is faster and sometimes clearer on a simple part. |

**Save SVG** writes a print-ready sheet. **Save DXF** writes the same drawing on five layers, so
visible, hidden, centre, dimension and text lines arrive separately in CAM or another CAD package.

What it gives you is a starting drawing rather than a finished one: overall extents per view, and a
diameter callout with the nearest standard size for each recognised hole. Datums, geometric
tolerance and anything a functional surface needs are still yours to add. If a drawing takes more
than a second or two, turn off the isometric view: it is the one that cannot share hidden-line work
with the others.

### Tolerance stack-up

A stack is a chain of dimensions and a requirement they have to add up to. The dialog seeds one from
the model along the X axis; delete what is not in the chain and add what is missing.

Per link: a **direction** (`+` adds to the gap, `−` subtracts from it, so a shaft length and a bore
depth can be in one chain), a **nominal**, a **tolerance**, and a **distribution**.

| Distribution | Use it for |
|---|---|
| Normal (±3σ) | A centred process held inside its band. The usual assumption. |
| Capable (±6σ) | A process you have capability data for. |
| Triangular | Some central tendency, no data to back it. |
| Uniform | No central tendency at all: a sorted bin, a shim, a clearance. |

The **lock** marks a dimension you cannot change, such as a bought-in bearing, so the advice never
suggests tightening it. The bar shows each link's share of the total variance.

Three answers appear together, because they disagree and the disagreement is the useful part:

- **Worst case** is what a drawing promises, and assumes every part is at its worst limit at once.
- **Root sum square** is what a run of parts actually does, if the processes are centred and independent.
- **Monte Carlo** samples 20,000 assemblies and shows where the failures actually land.

Below them, **Cp and Cpk**. Cp asks whether the chain is tight enough; Cpk asks whether it is also
aimed at the middle. A high Cp with a low Cpk is a good process pointed at the wrong number, which
is a different fix from a bad process, and the dialog says which.

Then **what to change**, priced, with each option as a button that applies it:

- Scale every open tolerance by one factor. Simple, and usually the most expensive.
- Tighten one link. One tighter operation instead of five, which is what a shop would quote.
- Re-centre, when the chain is tight enough but aimed off target. Moving a nominal is free.
- Allocate from the requirement backwards, sizing every band at once.

If the nominals themselves sum to a number outside the requirement, it says so and stops: no
tolerance is small enough to reach a number the dimensions never add up to, and that is a design
change. Stacks are stored in the document, so they travel with the design.

### Fits and limits

ISO 286 hole-basis fits resolved at a real size, in millimetres rather than micrometres of
deviation. Type a nominal, or select a body with a recognised hole and the dialog opens at its
diameter.

| Fit | For |
|---|---|
| H11/c11 | Loose running: dirt, paint, heat. Nothing has to locate. |
| H9/d9 | Free running: rotating at speed with generous lubrication. |
| H8/f7 | Close running: the default plain-bearing fit. |
| H7/g6 | Sliding: moves by hand, locates accurately. |
| H7/h6 | Locational clearance: assembles by hand and stays put. The safe default. |
| H7/k6 | Locational transition: light tap to assemble. |
| H7/n6 | Locational interference: press to assemble, still separable. |
| H7/p6 | Press fit: torque through the joint only with a key. |
| H7/s6 | Driving fit: permanent. |

The hole is the H member because a reamer or a drill is a fixed size and a shaft can be turned to
anything. Values are the published tables, not interpolations.

### Compare with a mesh

Answers "is this my part?" for an incoming STL, a scan or a re-export from another package. It
measures the exact distance from every sampled point on the mesh to the nearest surface of the
model, signed: positive is outside the model, negative is a gouge.

Read the histogram for the *kind* of difference. A symmetric spread around zero is tessellation.
One tall bar off centre is a mis-sized feature. Two separated humps usually mean a fillet or a
chamfer present in one and not the other. Before any of that, check the two lines above it: if the
**size ratio** is near 25.4 the file is in inches, and if the **position offset** is not near zero
the two are not registered and nothing else in the report means much yet. The dialog names both
cases outright rather than reporting them as shape differences.

### Design as code  `Ctrl`+`Shift`+`C`

The document as editable text. Not an export: the text is generated from the live document, and
applying it rewrites that document.

```
part "Mounting plate"
units mm

param plate_w = 120
param thick = 8
param bolt = 6.6      # M6 clearance

feature box "Plate"
  w = plate_w
  d = 80
  h = thick
  material = aluminium

feature cylinder "Bolt hole"
  r = bolt / 2
  h = thick * 2
  pos = plate_w / 2 - 12, 34, 0
```

One fact per line, two spaces of indent inside a feature. `#` followed by a space starts a comment;
`#` followed by anything else is a feature id, which is why ids are written `#f3` and comments
`# note`. Expressions go in verbatim and are checked against the parameters you declared, so a
mistyped name is reported with its line number instead of failing quietly at rebuild.

**What this would do** shows the effect before anything happens: which features would be added,
removed or changed, and a line diff. **Apply** is refused outright while there is a syntax error,
and the dialog stays open with the line numbers so the typo can be fixed. A successful apply is one
undo step.

Imported mesh payloads are the one thing the text cannot carry. They stay attached to the document
and are reattached when the text is applied, and the dialog says which features that affects.

### Merge a branch

Brings another branch's work into the document that is open now. It needs a version both branches
share; if there is none, it says so rather than guessing, because a three-way merge without a common
ancestor is not a merge.

Most of the time nothing is asked of you: two people who changed different parameters, or different
features, get both changes. What does get asked:

- **The same parameter changed on both branches.** Both values are offered. Nothing is averaged, because two numbers a person chose deliberately are a question, not a calculation.
- **A feature deleted on one branch and edited on the other.** Also a question, rather than a silent drop.
- **The same features put in a different order.** Order changes the part, so this one cannot be answered automatically.

Unanswered conflicts fall back to whichever side you pick at the bottom, and the whole merge is one
undo step, so it is safe to merge and look.

Colours, opacity and the viewport never block a merge. They are not design intent.

### Import design intent

Reads a design-intent JSON file back into a live parametric document, which is the half of
interoperability that usually goes missing. The dialog reports what survived the trip before you
open it, and opening it replaces the document you have, so save first.

---

## 5.8 History, speed, intent and ownership

### History  `Shift`+`H`

Three groups: what you can go back to, where you are, and what is ahead. Then a fourth that no
other package offers, because a linear undo stack cannot: **Branches you left**.

Undo a few steps and then make an edit, and everywhere else the states you undid are gone forever.
Here they become a branch. They stay named and one click away for as long as the tab is open, and
jumping back to one leaves the branch you were on equally reachable. Nothing you have done in a
session is ever unreachable.

Two things follow from that:

- Undo from a branch walks **that** branch, not the one you abandoned.
- Redo retraces the path you actually took, not an arbitrary sibling.

**Changing the view is never an undo step.** The grid, the shading, the camera, the section plane:
none of them is a change to the model, so none of them costs you an undo or clears what you can
redo. If you want a *model* state back, undo gives you exactly that.

History lives for the session. For something you want to keep, save a version (`Ctrl`+`Shift`+`S`).

### Why a heavy rebuild no longer freezes the window

Booleans run in worker threads, one per core minus one, so the thread that draws the interface is
free while they compute. Independent booleans run at the same time on different cores, which is
what makes a document of several parts scale rather than add up.

You do not configure any of it. What you will notice is that the window keeps responding during a
rebuild that used to lock it, and that a document with four independent booleans finishes in
roughly the time of the slowest one rather than the sum of all four.

If your browser cannot start workers, every boolean runs on the main thread instead, on the same
code, with the same result. The only difference is the freeze.

### Say what you want  `Ctrl`+`Shift`+`B`

Type an instruction and get real features.

```
a 120 by 80 plate 8 thick in aluminium
4 M6 clearance holes 40 apart
a tube 40 across with a 3 wall, 50 long
6 M8 tapped holes in a circle
a 2 inch shaft 3 inches long
```

**This is a grammar, not a language model.** It knows shapes (box, plate, cylinder, tube, sphere,
cone, torus, wedge, prism, pyramid, helix), units (mm, cm, m, inches, feet), thread callouts (M1.6
to M36, clearance or tapped), counts, spacings and materials. It does not understand English, and
when you write something outside that vocabulary it says so rather than guessing.

Before anything is built you get a readback: every fact it took, in the app's own words, plus any
word it could not act on. `a 60 box with chamfered corners` builds the box and tells you plainly
that *chamfered* had no effect, because a silently ignored word is how you end up with the wrong
part.

Two things it does that matter afterwards:

- **A count becomes a pattern**, not four separate holes, so you can change the number later.
- **A standard size becomes a parameter.** `4 M6 clearance holes` declares `clear_m6 = 6.6` with
  ISO 273 cited in its note, and drives the hole from it. Change the bolt size in one place and
  every hole that uses it follows.

Select a body first and a hole is cut from it. Select nothing and the hole arrives as a body for
you to subtract yourself, which the dialog says at the time.

### Fasteners

Pick a size and a property class and you get what the standards say, not just a diameter.

| | |
|---|---|
| Thread pitch, tensile stress area | ISO 724, ISO 898-1 |
| Clearance hole, close / medium / free | ISO 273 |
| Tapping drill | standard coarse thread |
| Head, nut across-flats and height | ISO 4762, ISO 4032 |
| Proof stress and tensile strength | ISO 898-1 by class |

Note that **A2 stainless is weaker than 8.8**, not stronger. That one catches people.

The tightening torque is the only modelled figure rather than a tabulated one, so it comes with its
assumptions attached: `T = K·F·d` with K = 0.2 for a plain dry thread and F at 90% of proof load.
Published torque tables are that same formula. Tick "lubricated" and K drops to 0.15, which is why
the same torque gives more preload on an oiled thread.

"Will the joint hold?" takes a load, a bolt count and a direction, and answers in tension or in
shear at 0.6 Rm. It will also tell you the smallest bolt in the class that carries the load at
safety factor 2, and clicking that sets it. Every answer carries the caveat that a real bolted
joint usually fails at the thread, the clamped material or in fatigue long before the bolt reaches
proof load.

**Add to the model** gives you a shank and a head unioned into one body, so a bolt is something you
can move and clash-check rather than a symbol.

### Document health

The problems that do not show up as modelling errors and do show up as a file that crashes, draws
imprecisely, or takes forty megabytes to describe a bracket.

**Geometry at survey coordinates.** A 32-bit float keeps about seven significant digits, so at
500 km from the origin the smallest distance it can represent is 32 mm. A 0.1 mm feature cannot be
positioned at all out there, and the symptom is a model that looks subtly wrong in ways nothing in
the feature tree explains. The dialog quotes the real step at your distance. **Move the design to
the origin** shifts every leaf feature by one vector, so relative positions are untouched and the
geometry is computed near zero where precision is good; the coordinate you came from goes into the
document notes so it is not lost. A position written as an expression is left alone and reported
rather than rewritten.

**Duplicated meshes.** Two imports with identical triangles are two copies of the same megabytes.
Sharing one copy leaves every body exactly where it is: the transforms stay separate, only the
triangles are shared.

**Degenerate features.** A zero dimension, a pattern of one, a boolean with nothing to combine.
Each produces nothing and costs a rebuild, and each is something you meant to finish.

**Where the weight is.** Parametric features cost a couple of hundred bytes each however complex
the shape; imported triangles cost what they weigh. That is usually the whole answer.

### Offline and ownership

Under **Help**. After one visit the whole application is on your machine: turn the network off,
reload, and it opens. There is no account, no activation and no licence check, so there is nothing
that can refuse to start.

The panel lists what is kept here, named and sized, and every byte of it is in this browser on this
machine. It offers to delete all of it. And it tells you how to check the network claim yourself
rather than asking you to believe it: open your browser's network panel and reload, and after the
first visit there is nothing to see.

Needs https or localhost, because a service worker does. Clearing your browser data clears the
local storage too, which is why a document you care about belongs in a saved file as well.

---

## 6. Keyboard reference

### Everywhere

| | |
|---|---|
| `Ctrl`+`K` | command palette |
| `Ctrl`+`Shift`+`D` | shop drawing |
| `Ctrl`+`Shift`+`C` | design as code |
| `Ctrl`+`Shift`+`B` | say what you want |
| `Shift`+`H` | history, including branches you left |
| `Q` | quick menu |
| `Ctrl`+`S` / `Ctrl`+`⇧`+`S` | save / save as |
| `Ctrl`+`O` / `Ctrl`+`N` / `Ctrl`+`I` | open / new / import |
| `Ctrl`+`Z` / `Ctrl`+`⇧`+`Z` | undo / redo |
| `Ctrl`+`⇧`+`H` | undo history browser |
| `Ctrl`+`D` | duplicate |
| `Ctrl`+`A` / `Alt`+`A` / `Ctrl`+`⇧`+`I` | select all / none / invert |
| `Del` | delete selection |
| `F2` | rename |
| `Ctrl`+`,` | preferences |
| `T` / `N` | toggle left / right panel |
| `Esc` | cancel, then deselect |
| `F1` | this help |

### Model and Simulate

| | |
|---|---|
| `G` / `R` / `S` | modal move / rotate / scale |
| `W` / `⇧E` / `⇧R` | move / rotate / scale gizmo |
| `F` / `⇧F` | zoom to fit / to selection |
| `5` | orthographic camera |
| `1` / `3` / `7` | front / right / top (add `⇧` for the opposite) |
| `0` | isometric |
| `Z` | cycle shading mode |
| `H` / `Alt`+`H` / `/` | hide / show all / isolate |
| `D` | drop to floor |
| `M` | measure distance |
| `Space` | play / pause the timeline |
| `,` / `.` | step one frame |
| `Home` / `End` | timeline start / end |

### Draft

| | |
|---|---|
| `L` `P` `R` `C` `A` `E` `G` `S` `X` | line, polyline, rectangle, circle, arc, ellipse, polygon, spline, text |
| `D` / `O` / `M` | dimension, offset, measure |
| `F3` / `F8` / `F10` | object snap / ortho / polar tracking |
| `Enter` | finish a polyline or spline |
| `C` | close a polyline |
| `F9` | snap to grid |
| `F` | zoom drawing extents |

---

## 7. Worked examples

### A flanged pipe

1. **Model** → Tube. Set outer 40, inner 32, height 200.
2. Add a **Rounded plate**: width 110, depth 110, thickness 12, corner radius 18,
   centre hole 32. Set its Z position to `6`.
3. Duplicate the plate and set its Z position to `194`.
4. Select the tube and both plates, press **Union**.
5. Add a **Cylinder** radius 6, height 20, at X = 42, Y = 0, Z = 6.
6. Select it and press **Circular** — axis Z, count 4, angle 360.
7. Select the union then the pattern, press **Subtract**.
8. Add a parameter `flange_bolt = 6` and put it in the cylinder's radius field, so the bolt
   holes are now driven by one number.

### A gear train

1. **Draft** → draw one tooth profile as a closed polyline near the origin.
2. Select it, **Extrude →** 10 mm.
3. **Circular** pattern the tooth: axis Z, count 24, angle 360.
4. Add a cylinder for the hub and **Union** it with the pattern.
5. Duplicate the gear, move it along X by the centre distance, and set its Z rotation to half
   a tooth pitch.
6. **Simulate** → give each gear a **continuous spin** motor about Z, with rates in the
   inverse ratio of their tooth counts and opposite signs. Press play.

### A construction sequence

1. Model the structure as separate bodies — foundation, columns, beams, deck, cladding.
2. **Simulate** → **Sequence**, which gives every body a slot in tree order.
3. Reorder the feature tree by dragging so the sequence matches the real build order.
4. Set each body's *Appear as* — `build` (Z sweep) for concrete pours, `riseZ` for lifted
   steel, `fade` for glazing.
5. Drag the green bars on the timeline to match your programme, and stretch the timeline
   length so one second reads as one week.
6. **● Record** to hand the client a video.
