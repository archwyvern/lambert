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

## Exporters

- Heightmap PNG (16-bit grayscale)
- Tangent-space normal map PNG (y-up or y-down green)
- Skyrat `.nx.png` override preset (y-down, full-range blue, authored-mask alpha)

License: MIT
