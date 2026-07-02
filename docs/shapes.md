# Lambert — shape reference

One palette tile per type; the familiar named forms are parameters (usually `profile`).
All heights are in source-image pixels at scale 1; `transform.scale.z` multiplies an object's
height (tallness) and `transform.pos.z` raises its base (elevation).

## Profiles

Four cross-section curves appear on most types as the `profile` param:

| Profile | Curve | Classic form |
|---|---|---|
| `round` | convex quarter-round (bullnose): vertical at the rim, flat on top | hemisphere / bead |
| `linear` | straight ramp | cone / wedge / chamfer |
| `cove` | concave quarter-round | crater / fillet |
| `smooth` | hermite ease: flat at the rim *and* the top | dome / soft bump |

## Shapes

| Type | What it is | Key params / notes |
|---|---|---|
| **Sphere** | radial mound; footprint radius = peak height | `radius`, `profile` (round=sphere, linear=cone, cove=crater, smooth=dome). Per-axis scale makes ellipsoids |
| **Ramp** | directional slope | `profile` (linear=wedge, cove=fillet) |
| **Pipe** | straight bar / tube | `radius`, `radius2` (taper — a frustum), `length`, `cap` (round=capsule, flat=cylinder), `profile` |
| **Berm** | embankment: flat top, sloped sides | `length`, `width`, `slope`, `height`, `cap` |
| **Torus** | ring | `profile` (tube cross-section) |
| **Plateau** | base polygon at ground + independently editable top rim at full height; the sides loft between them | edit both rings with the vertex tool. Single top vertex = a pyramid; top ring == base ring = a box |
| **Plate** | flat filled polygon (SVG `fill`), optionally tilted | `tiltX/Y` ramp the height plane; edit the outline with the vertex tool |

## Paths (pen-drawn Bézier types)

The path lives in pen anchors (vertex tool); the field is evaluated analytically, so it stays
smooth at any zoom.

| Type | What it is | Key params / notes |
|---|---|---|
| **Cable** | tube swept along a path (SVG `stroke`) | `radius`, `profile`, `cap`, `invert` (raise/carve/replace — a carved pipe is a groove). `closed` loops it (an O-ring). **Per-anchor scale** tapers the radius along the path |
| **Ridge** | embankment swept along a path | `width`+`slope`+`height`, `cap`, `invert`. **Per-anchor scale** tapers the whole cross-section as a unit |
| **Contour** | filled Bézier outline | supports up to 6 **holes** (sub-loops); `tiltX/Y` height plane |
| **Mesa** | plateau lofting two Bézier rings (base + top) | the Bézier twin of Plateau |
| **Pillow** | a drawn closed outline INFLATED like a balloon — the fattest part is the tallest, thin necks stay low, no creases | **no params**: the relief comes from the outline itself (+ `transform.scale`). Supports holes. A Sphere converts to this |

## Effects

**Gradient** is the first *effect layer*: adding one drops a region covering the whole image that
contributes a directional height ramp (`angle`, `depth`) — a directional emboss across the region in
the normal map. Resize/reshape the region with the vertex tool; the ramp re-normalises to its extent.

## Mesh

**Mesh** is a free triangulated height surface: vertices carry x/y plus a height, triangles
interpolate between them (`smoothness` blends toward Phong). A fresh Mesh is a flat 2-triangle
quad — start simple, then split edges and move/raise vertices in the vertex tool
(right-click for connect / merge / z-align).

## Conversions (Layers panel, right-click)

- **Convert to Path** — a shape becomes its pen-editable Path twin with the same geometry:
  Pipe → Cable (a frustum's taper becomes per-anchor scales), Berm → Ridge,
  Plate → Contour, Plateau → Mesa, Sphere → Pillow. One-way.
- **Convert to Mesh** — a *flat/faceted* shape becomes a minimal exact triangle mesh: a Plate
  quad → 2 triangles, an n-gon → its ear-clipped triangulation, a Plateau → its facet planes +
  top cap. Curved shapes (spheres, pipes, toruses…) deliberately do **not** offer this — a
  triangulated curve bands visibly under lighting; convert those to Paths instead. One-way.
