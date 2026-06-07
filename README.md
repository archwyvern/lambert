# Flatland

Shape-based height field authoring for normal maps. 3D but not 3D, done the hard way.

Place parametric shapes (domes, plateaus, ridges, grooves) over a reference image; Flatland
composites them into a height field and derives a normal map from it. You never paint a
normal color: heights are easy to author and the derived normals are correct by construction.

Status: pre-alpha. The CPU evaluation core and exporters work headlessly; the editor UI
(Electron + WebGPU) is being built on top — see `docs/specs/` and `docs/plans/`.

## Try it

```bash
pnpm install
pnpm test
pnpm eval path/to/file.flatland   # writes {stem}.nx.png + debug height/normal maps
```

A `.flatland` document is JSON: a source image reference plus an ordered list of shape
instances (type, transform, params, control points, combine op). See
`tests/golden/fixture.ts` for a worked example.

## Development

```bash
pnpm dev        # the editor (open an image, place shapes, export NX)
pnpm selftest   # GPU drift test vs the CPU reference (exit 0 = pass)
pnpm test       # node suite (math, packing, codegen, store, exporters, golden)
```

The GPU fold is drift-tested against the CPU reference implementation in
`src/field/evalCpu.ts` — see `src/renderer/selftest.ts`. Tolerances live in
`src/field/compare.ts`.

Harness routes (after `electron-vite build`):
`electron . --query harness=1` (fixture normal+lit views),
`electron . --query "demo=1&mode=lit&select=ridge"` (editor with the golden fixture),
`--capture out.png` screenshots any route for automated visual checks.

Editor basics (godot-style tools): Q select, W move, E rotate, R scale. Select mode has
the full gizmo (corner rotate/scale handles, vertex dots) plus godot's drag overrides
(Alt = move, Ctrl = rotate, Ctrl+Alt = scale); explicit modes drag anywhere on the
selection. Shift = axis-lock while moving, 15-degree snap while rotating, uniform while
scaling. Wheel zooms, middle-drag or Space-drag pans, V cycles view modes, arrows nudge,
Delete removes. File/Edit/View live in the application menu (Ctrl+O/S/E, Ctrl+Z/Y/D,
Ctrl+0 fit, Ctrl+1 100%). The light pad sits in the viewport corner in lit view.

Layers panel: click selects (the only selection surface for W/E/R), drag reorders,
double-click or F2 renames, right-click for rename/duplicate/front/back/delete; the
eye toggles visibility and the lock makes a layer inert on canvas (the inspector can
still edit it). The +/- marker flags add/carve compositing. Both sidebars resize by
dragging their edge; widths persist across launches.

## Shape icons

The library palette icons are clay renders of the actual shapes, generated headlessly:

```bash
blender --background --python blender/render_icons.py   # writes src/ui/icons/*.png
```

Add a builder to `blender/render_icons.py` when a new shape type lands.

## Exporters

- Heightmap PNG (16-bit grayscale)
- Tangent-space normal map PNG (y-up or y-down green)
- Skyrat `.nx.png` override preset (y-down, full-range blue, authored-mask alpha)

License: MIT
