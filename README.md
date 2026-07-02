# Lambert

Shape-based height field authoring for normal maps. 3D but not 3D, done the hard way.

Place parametric shapes (domes, plateaus, pipes, embankments) over a reference image; Lambert
composites them into a height field and derives a normal map from it. You never paint a
normal color: heights are easy to author and the derived normals are correct by construction.

**New here? Read the [artist guide](docs/guide.md)** for the workflow, and the
[shape reference](docs/shapes.md) for every object type and conversion.

## Run it

```bash
pnpm install
pnpm dev        # the editor: open/create a project, place shapes, export NX
```

A project is a folder with a `project.lambert` config; each image gets a `.lmb` document
(JSON: a source-image reference plus an ordered object list). Export produces the
Skyrat-convention `.nx.png` (tangent-space normals, authored-mask alpha) next to the document.

```bash
pnpm eval path/to/file.lmb   # headless export: writes {stem}.nx.png + debug height/normal maps
```

## Development

```bash
pnpm dev        # editor with hot reload
pnpm test       # node suite (field math, packing, codegen, store, exporters, CPU goldens)
pnpm selftest   # GPU drift test vs the CPU reference (exit 0 = pass; needs a Vulkan device)
pnpm typecheck
```

The GPU fold is drift-tested against the CPU reference implementation in
`src/field/evalCpu.ts` — see `src/renderer/selftest.ts`. Tolerances live in
`src/field/compare.ts`. CI runs typecheck + tests on every push; the GPU selftest runs as a
best-effort software-Vulkan job.

Harness routes (after `electron-vite build`):
`electron . --query harness=1` (fixture normal+lit views),
`electron . --query "demo=1&mode=lit&select=ridge"` (editor with the golden fixture),
`--capture out.png` screenshots any route for automated visual checks (each run gets a fresh
profile; pass `--profile <dir>` to use a seeded one).

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
