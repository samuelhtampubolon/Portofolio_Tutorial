# TesserCAD user guide

A walkthrough of the three workspaces, written so you can follow along in the app.

- [1. The basics](#1-the-basics)
- [2. Model — parametric solids](#2-model--parametric-solids)
- [3. Draft — 2D drawing](#3-draft--2d-drawing)
- [4. Simulate — the fourth dimension](#4-simulate--the-fourth-dimension)
- [5. Files and exchange](#5-files-and-exchange)
- [6. Keyboard reference](#6-keyboard-reference)
- [7. Worked examples](#7-worked-examples)

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

**Command palette.** `Ctrl`+`K` finds any of the 69 commands by fuzzy name. If you cannot
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

Use the **Move / Rotate / Scale** gizmo (`G` / `R` / `T`), or type exact numbers into the
Transform section. The transform fields accept expressions too, so a boss can sit at
`plate_h + boss_h/2` and follow the plate when it gets thicker.

Two helpers worth knowing: **Drop to floor** sits the body on Z = 0, and **Centre on origin**
moves its bounding-box centre to the world origin.

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

## 6. Keyboard reference

### Everywhere

| | |
|---|---|
| `Ctrl`+`K` | command palette |
| `Ctrl`+`S` / `Ctrl`+`O` / `Ctrl`+`N` | save / open / new |
| `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` | undo / redo |
| `Ctrl`+`D` | duplicate |
| `Ctrl`+`A` | select all |
| `Del` | delete selection |
| `Esc` | cancel, then deselect |
| `F1` | this help |

### Model and Simulate

| | |
|---|---|
| `G` / `R` / `T` | move / rotate / scale gizmo |
| `F` | zoom to fit |
| `O` | orthographic camera |
| `1`–`6` | front, back, right, left, top, bottom |
| `0` | isometric |
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
