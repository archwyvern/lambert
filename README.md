# Lambert

[![CI](https://github.com/archwyvern/lambert/actions/workflows/ci.yml/badge.svg)](https://github.com/archwyvern/lambert/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/archwyvern/lambert)](https://github.com/archwyvern/lambert/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Shape-based height field authoring for normal maps. 3D but not 3D, done the hard way.

Place parametric shapes (domes, plateaus, pipes, embankments) over a reference image; Lambert
composites them into a height field on the GPU and derives a tangent-space normal map from it.
You never paint a normal color: heights are easy to author and the derived normals are correct
by construction — no seams, no hand-painted lighting errors.

![The Lambert editor: layers, lit preview, inspector, and the 3D height inspection view](docs/screenshot.png)

**New here? Read the [artist guide](docs/guide.md)** for the workflow, and the
[shape reference](docs/shapes.md) for every object type and conversion.

## Features

- **Parametric shapes** — spheres, ramps, pipes, berms, toruses, plateaus, plates — and their
  pen-drawn Bézier twins (cables, ridges, contours, mesas, pillows), plus free triangulated
  meshes. Everything is evaluated analytically on the GPU: crisp at any zoom, live at any size.
- **Adjustment layers** — region-scoped, composable height transforms (raise/lower, multiply,
  clamp, curve, ramp) applied to everything below, each with a blend slider.
- **Emboss/Detail** — lifts surface detail out of the diffuse's own luminance (tolerance-gated
  gradient extraction integrated into height), with radius / strength / blur controls and
  Blender-style progressive preview while you scrub.
- **Four view modes** — diffuse, normal (export-gated by default), lit preview, and a coverage
  audit that flags opaque pixels no shape has touched; plus a displaced-3D inspection view.
- **Editor chrome** — command palette, rebindable shortcuts with an editor, JetBrains-style
  settings, groups with mirror symmetry, trim masks, per-object presets, drag-drop project and
  image opening, git-friendly JSON documents.
- **Exports** — engine-ready `.nx.png` normal maps (derived normals, authored-mask alpha),
  16-bit grayscale height maps, and configurable output: RGB/RGBA/RG/RGA channel layouts,
  8/16-bit depth, PNG / EXR / Radiance HDR.

## Install

Grab the Linux AppImage or the Windows installer from the
[latest release](https://github.com/archwyvern/lambert/releases/latest) (both auto-update in
place). Or run from source:

```bash
pnpm install
pnpm dev        # the editor: open/create a project, place shapes, export NX
```

A project is a folder with a `project.lambert` config; each image gets a `.lmb` document
(JSON: a source-image reference plus an ordered object list). Export produces the
`.nx.png` (tangent-space normals, authored-mask alpha) next to the document.

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

## Credits

Lambert was built for [Pigeon](https://www.instagram.com/sketchy_pigeon/) — who also designed
the logo. We love 2D style but wanted 3D lighting, so this program exists to add real lighting
to his artwork without giving up the 2D. It's open source and for everyone who wants the same.

License: MIT
