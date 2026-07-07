# Lambert — artist guide

Lambert builds normal maps by *authoring heights*, not painting colors. You place shapes over
your diffuse texture; every shape contributes height; the composited height field is converted
to a tangent-space normal map on export. Because normals are derived, they are always
internally consistent — no seams, no hand-painted lighting errors.

## The mental model

- Every object is a **height contribution** over the image: a dome raises a bump, a carve-mode
  pipe cuts a groove, a plateau raises a flat slab.
- Objects fold **in layer order** (bottom of the Layers panel first). Later objects clip into
  earlier ones like solids — heights never stack additively.
- The **combine op** per object: *raise* (default — solid union), *carve* (subtracts its shape),
  *replace* (stencil — its surface wins outright inside its footprint). Cable/Ridge expose
  this as the `invert` param.
- The export is `{image}.nx.png`: RGB = the derived normal, alpha = the *authored mask* (where
  your shapes actually are), so the game engine can blend it over baseline normals.

## Projects and documents

**File ▸ New Project** picks a folder; Lambert writes `project.lambert` (project settings:
normal-channel directions, saved presets). Every image you author gets a `.lmb` document next
to it (JSON — friendly to git). The Explorer (left panel, below Layers — drag the divider to
resize) lists the project's documents; double-click to open. Sessions restore your open tabs.

The diffuse is referenced by URI (`file://` or `http(s)://`) and is never copied; use
**File ▸ Reload Diffuse** after editing it elsewhere.

## Placing and editing objects

**+ Add object** opens the palette — one tile per shape type (see the
[shape reference](docs/shapes.md)). Drag a tile onto the canvas, or double-click to add at the
origin. Form variants (cone, crater, capsule, frustum…) are *parameters*: place the base type
and switch its `profile`/`cap` in the Inspector.

Tools (Godot-style):

| Key | Tool | Notes |
|---|---|---|
| Q | Select | full gizmo: move body, corner/edge scale, rotate arm. Alt-drag duplicates; Shift-click multi-selects; empty drag box-selects; empty click deselects |
| W / E / R | Move / Rotate / Scale | drag anywhere; Shift = axis-lock / 15° snap / uniform |
| T | Vertex | edit control points / Bézier anchors; drag empty = vertex box-select |
| P | Mask pen | draw a trim mask on the selected object (see Masks) |
| M | Measure | drag between two points: length, Δx/Δy, angle |

View: wheel zooms, middle-drag or **hold Space + drag** pans, **V** cycles
Diffuse/Normal/Lit/Coverage (coverage paints red wherever the diffuse is opaque but no shape has
touched — the "what haven't I covered yet" audit), **X** swaps the 2D/3D views, Ctrl+0 fit,
Ctrl+Shift+0 fit selection, Ctrl+1 100%. Past ~800% zoom a faint pixel grid fades in (View menu
toggles it). In normal view, the encode is hidden where the diffuse is transparent by default —
matching what the export ships; the checker-square toggle next to the opacity field shows the
raw field instead. Arrows nudge (Shift ×10), Esc cancels a drag in progress (reverting it) or
deselects. The `?  Shortcuts` pill (bottom-right) shows the full contextual list.

Every menu action is a **command**: Ctrl+Shift+P opens the palette (fuzzy search, Enter runs),
and Preferences ▸ Shortcuts rebinds any of them (click a row, press the new chord).

Edit: Ctrl+C/V copies objects (works across tabs), Ctrl+D duplicates, Ctrl+G groups,
Ctrl+Shift+G ungroups, Delete removes. The **Arrange** menu aligns (left/center/right,
top/middle/bottom) and distributes a multi-selection.

Per object (Inspector): position (x, y, **z = elevation**), rotation, scale (x, y,
**z = tallness multiplier**), **opacity** (fold-contribution weight — 50% = half-strength
contribution, works with carve/replace too), plus the type's own params.

## Path strokes and the taper

Cable and Ridge sweep a cross-section along a Bézier path. In the vertex tool:
drag anchors/tangent handles, click the curve to insert an anchor (and keep dragging it),
right-click an anchor for verbs (extend, smooth/corner, delete). Each selected anchor shows a
teal diamond — the **anchor scale** handle. Drag it to taper the whole cross-section at that
anchor (radius for cables; width+slope+height together for ridges), interpolated along the path.
It snaps back to 100% when close; the Inspector's "anchor scale" field sets it numerically.

## Masks

Masks trim an object's influence with a closed Bézier loop: **keep** (only inside survives) or
**cut** (inside is removed). Draw one with the pen tool (P) or the Masks section in the
Inspector. Per mask: the link icon = *follow* (the mask rides the object's transform vs stays
pinned to the world), the blur icon = anti-aliased edge vs hard. Click a mask's anchor to edit
it; then dragging inside the loop moves the whole mask. Group masks trim everything inside the
group.

## Groups

Groups nest, transform their children together, and can **mirror** (X / Y / quad) for symmetric
detail. Group masks apply to all children. Rename anything with F2 or double-click in Layers.

## Adjustment layers

**Adjustment** (in the palette's Special section) filters everything below it inside a region
(full-canvas by default; reshape it with the vertex tool). It hosts an ordered list of height
transforms — raise/lower, multiply, clamp, curve, ramp, and **Emboss/Detail**, which lifts
surface detail out of the diffuse's own luminance (scrub `strength`; negative inverts to
dark-high). Each entry has a blend slider and a bypass eye. See the
[shape reference](shapes.md#adjustment-layers) for every kind.

## Settings

Three dialogs under the File menu, each searchable and instant-apply (the canvas peeks around
the modal): **Preferences** (**Ctrl+,**) holds the per-machine application settings — the
shortcut editor and the update check; **Project Settings** holds the normal-channel directions
(a visual ball editor, with rotation presets for engine conventions) and the default output
format, stored in `project.lambert`; **Document Settings** overrides both per-`.lmb`, plus the
canvas origin.

## Presets

Tuned an object you'll reuse? **Edit ▸ Save as Preset** stores it in the project; it appears in
the palette's *Project* section (right-click a tile to delete). **File ▸ Import/Export
Presets…** moves a preset library between projects as a JSON file.

## The 3D view

The corner 3D panel shows the displaced height field with the same lighting as the lit view.
It is **off by default** (it is the most expensive view in the app) — click the pane to enable
it, and the power button in its corner turns it back off. Swap it big with **X**. Right-drag
orbits, left/middle-drag pans, wheel dollies. Use it to judge height *relationships*; the lit
2D view is ground truth for the final look (the game only ever sees the normal map).

## Export

**Ctrl+E** exports the active document's normal map; **Ctrl+Shift+E** exports every open saved
document; **File ▸ Export Height Map** writes a 16-bit grayscale height PNG. The normal map's
alpha channel is the authored mask — pixels your shapes never touched stay transparent so the
engine keeps its baseline normals there. Normal channel directions (red/green orientation,
plus rotation for engine conventions) and the output format (RGB/RGBA/RG/RGA channels, 8/16-bit
depth, PNG / EXR / Radiance HDR) live in **Project Settings**, with per-document overrides in
**Document Settings** — so exports are reproducible from the project files alone.
