"""Render the object-library icons as actual 3D clay renders.

Each icon models the real height-field object the engine evaluates, so the palette previews
what you actually get. One builder per registered object type — Shapes are placed forms, Paths
show their pen-drawn curved geometry (an S-curve sweep / organic outline, so they read as
"drawn" next to their straight Shape cousins). Run headless:

    blender --background --python blender/render_icons.py
    blender --background --python blender/render_icons.py -- cable mesa   # subset

Outputs transparent 128x128 PNGs into src/ui/icons/ (consumed by objectIcons.ts).
"""

import math
from pathlib import Path

import bpy

OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "ui" / "icons"
SIZE = 128


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.film_transparent = True
    # Cycles: the only engine with a true shadow catcher, which puts a soft CONTACT SHADOW into the
    # icon's alpha — it grounds the shape on any tile background and defines the silhouette far
    # better than shading alone. 128px + denoise keeps it fast.
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"


def add_clay_material(obj: bpy.types.Object) -> None:
    mat = bpy.data.materials.new("clay")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    # warm clay-gray: reads on the dark palette tiles without disappearing into them
    bsdf.inputs["Base Color"].default_value = (0.56, 0.545, 0.52, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.5
    obj.data.materials.append(mat)


def setup_camera_and_light() -> None:
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 3.4
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (4.0, -4.0, 3.2)
    cam.rotation_euler = (math.radians(60), 0.0, math.radians(45))
    bpy.context.scene.camera = cam

    # three-point clay lighting: warm key, cool fill, and a rim from behind-left so every
    # silhouette pops against the dark tile background
    key_data = bpy.data.lights.new("key", type="SUN")
    key_data.energy = 3.8
    key_data.angle = math.radians(8)
    key = bpy.data.objects.new("key", key_data)
    bpy.context.collection.objects.link(key)
    # azimuth -60: the cast shadow pools screen-right of the shape (visible past the silhouette)
    # instead of hiding directly behind it; the form still keys from screen-left
    key.rotation_euler = (math.radians(50), 0.0, math.radians(-60))

    fill_data = bpy.data.lights.new("fill", type="SUN")
    fill_data.energy = 0.55
    fill_data.color = (0.85, 0.9, 1.0)
    fill_data.use_shadow = False  # only the key throws the contact shadow, so it stays DARK
    fill = bpy.data.objects.new("fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(60), 0.0, math.radians(205))

    rim_data = bpy.data.lights.new("rim", type="SUN")
    rim_data.energy = 2.2
    rim_data.use_shadow = False
    rim = bpy.data.objects.new("rim", rim_data)
    bpy.context.collection.objects.link(rim)
    rim.rotation_euler = (math.radians(70), 0.0, math.radians(150))

    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs[1].default_value = 0.12
    bpy.context.scene.world = world


# ── geometry helpers ──────────────────────────────────────────────

def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def bevel(obj: bpy.types.Object, width: float = 0.035) -> bpy.types.Object:
    """Tiny edge bevel so hard edges catch a highlight (render-time modifier)."""
    m = obj.modifiers.new("bev", "BEVEL")
    m.width = width
    m.segments = 2
    return obj


def box(sx: float, sy: float, sz: float, z: float | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.location.z = z if z is not None else sz / 2
    return o


def s_curve(points: list[tuple[float, float, float]], name: str = "path") -> bpy.types.Curve:
    """A smooth (auto-handle) open Bézier through the given points — the 'pen-drawn' motif every
    Path icon is built around."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    spline = cu.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bp, co in zip(spline.bezier_points, points):
        bp.co = co
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    return cu


def blob_spline(cu: bpy.types.Curve, radii: list[float], cx: float = 0.0, cy: float = 0.0) -> None:
    """Add a closed organic Bézier loop: points on a circle at varying radii, auto-smoothed."""
    spline = cu.splines.new("BEZIER")
    spline.bezier_points.add(len(radii) - 1)
    for i, (bp, r) in enumerate(zip(spline.bezier_points, radii)):
        a = 2 * math.pi * i / len(radii)
        bp.co = (cx + r * math.cos(a), cy + r * math.sin(a), 0.0)
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    spline.use_cyclic_u = True


# ── Shapes (placed parametric forms) ──────────────────────────────

def build_sphere() -> bpy.types.Object:
    # hemisphere: spherical-cap height profile
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.2)
    obj = bpy.context.active_object
    for v in obj.data.vertices:
        if v.co.z < 0:
            v.co.z = 0
    return smooth(obj)


def build_ramp() -> bpy.types.Object:
    # directional slope: a block with its +x top edge dropped to the floor (the linear "wedge" default)
    o = box(1.4, 1.6, 0.9)
    for v in o.data.vertices:
        if v.co.x > 0 and v.co.z > 0:
            v.co.z = -0.5
    return bevel(o)


def build_pipe() -> bpy.types.Object:
    # straight bar with round caps (the default capsule form), laid at a slight angle
    r = 0.55
    body_len = 1.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=body_len, location=(0.0, 0.0, 0.0))
    body = smooth(bpy.context.active_object)
    parts = [body]
    for zc in (body_len / 2, -body_len / 2):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=r, location=(0.0, 0.0, zc))
        parts.append(smooth(bpy.context.active_object))
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.rotation_euler = (0.0, math.radians(90), math.radians(20))
    body.location.z = 0.32
    return body


def build_berm() -> bpy.types.Object:
    # straight flat-topped embankment bar (trapezoid section)
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    bar = bpy.context.active_object
    for v in bar.data.vertices:
        if v.co.z > 0:
            v.co.y *= 0.4  # pull the top edges in -> sloped sides + a flat top
    bar.scale = (2.6, 1.0, 0.7)
    bar.location.z = 0.35
    bar.rotation_euler = (0.0, 0.0, math.radians(20))
    return bar


def build_torus() -> bpy.types.Object:
    # raised ring with a rounded tube cross-section
    bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.34)
    o = bpy.context.active_object
    o.location.z = 0.34
    return smooth(o)


def build_plateau() -> bpy.types.Object:
    # square frustum: polygon footprint, linear slope to a flat top
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.5, radius2=0.95, depth=0.85)
    obj = bpy.context.active_object
    obj.rotation_euler = (0.0, 0.0, math.radians(45))
    obj.location.z = 0.425
    return bevel(obj)


def build_plate() -> bpy.types.Object:
    # flat filled polygon, tilted (what the tilt params produce): a thin square sheet
    o = box(1.6, 1.6, 0.1)
    o.rotation_euler = (math.radians(22), 0.0, 0.0)
    o.location.z = 0.5
    return bevel(o, 0.02)


# ── Paths (pen-drawn forms — every icon carries the S-curve/organic-outline motif) ──

def build_cable() -> bpy.types.Object:
    # a round tube swept along a drawn S-curve. Points run along the camera's screen-x diagonal
    # (world x=y) so the S reads unforeshortened from the 45-degree view.
    pts = [(-0.95, -0.95, 0.0), (-0.25, -0.75, 0.0), (0.25, 0.75, 0.0), (0.95, 0.95, 0.0)]
    diag = [((x - y) * 0.7071, (x + y) * 0.7071, z) for (x, y, z) in pts]  # rotate 45 into the view plane
    cu = s_curve(diag, "cable")
    cu.bevel_depth = 0.26
    cu.bevel_resolution = 8
    cu.use_fill_caps = True
    o = bpy.data.objects.new("cable", cu)
    bpy.context.collection.objects.link(o)
    o.location.z = 0.26
    return o


def build_ridge() -> bpy.types.Object:
    # a flat-topped embankment swept along a drawn S-curve: trapezoid profile, curve sweep
    prof = bpy.data.curves.new("ridge_prof", "CURVE")
    prof.dimensions = "2D"
    ps = prof.splines.new("POLY")
    pts = [(-0.62, 0.0), (-0.24, 0.5), (0.24, 0.5), (0.62, 0.0)]
    ps.points.add(len(pts) - 1)
    for p, (x, y) in zip(ps.points, pts):
        p.co = (x, y, 0.0, 1.0)
    prof_obj = bpy.data.objects.new("ridge_prof", prof)
    bpy.context.collection.objects.link(prof_obj)
    prof_obj.hide_render = True

    pts = [(-0.95, -0.9, 0.0), (-0.25, -0.7, 0.0), (0.25, 0.7, 0.0), (0.95, 0.9, 0.0)]
    diag = [((x - y) * 0.7071, (x + y) * 0.7071, z) for (x, y, z) in pts]  # face the 45-degree camera
    cu = s_curve(diag, "ridge")
    cu.bevel_mode = "OBJECT"
    cu.bevel_object = prof_obj
    cu.twist_mode = "Z_UP"
    cu.use_fill_caps = True
    o = bpy.data.objects.new("ridge", cu)
    bpy.context.collection.objects.link(o)
    return o


def build_contour() -> bpy.types.Object:
    # a filled drawn outline (with a hole — the type supports up to 6): a thin organic 2D fill
    cu = bpy.data.curves.new("contour", "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = 0.06
    blob_spline(cu, [1.5, 1.15, 1.45, 1.2, 1.5, 1.1])  # organic outer loop
    blob_spline(cu, [0.42, 0.36, 0.45, 0.38], cx=0.35, cy=-0.15)  # the hole
    o = bpy.data.objects.new("contour", cu)
    bpy.context.collection.objects.link(o)
    o.location.z = 0.06
    return o


def build_pillow() -> bpy.types.Object:
    # an inflated cushion: a flattened cube with heavy rounded bevels — the balloon relief
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.scale = (1.35, 1.35, 0.5)
    o.location.z = 0.5
    m = o.modifiers.new("bev", "BEVEL")
    m.width = 0.42
    m.segments = 12
    return smooth(o)


def build_mesa() -> bpy.types.Object:
    # a flat-topped organic landform: rounded drawn rim, sloped sides, level top
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.45)
    o = bpy.context.active_object
    for v in o.data.vertices:
        # squash, clamp the top level, and give the rim a gentle drawn wobble
        z = v.co.z * 0.5
        a = math.atan2(v.co.y, v.co.x)
        wobble = 1.0 + 0.08 * math.sin(3 * a)
        v.co.x *= wobble
        v.co.y *= wobble
        v.co.z = max(0.0, min(z, 0.42))
    return smooth(o)


# ── Effects ───────────────────────────────────────────────────────

def build_gradient() -> bpy.types.Object:
    # the directional gradient effect: a low full-tile wedge rising smoothly across the region
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    for v in o.data.vertices:
        if v.co.z > 0:
            v.co.z = -0.5 + (v.co.y + 0.5)  # top face ramps 0 -> full across y
    o.scale = (1.7, 1.7, 0.55)
    o.location.z = 0.275
    o.rotation_euler = (0.0, 0.0, math.radians(90))
    return bevel(o, 0.02)


# ── Mesh ──────────────────────────────────────────────────────────

def build_mesh() -> bpy.types.Object:
    # a free triangulated height surface: a subdivided grid sculpted into bumps, left faceted (flat
    # shaded + triangulated) so the triangle mesh reads vs the smooth forms
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=5, y_subdivisions=5, size=2.8)
    o = bpy.context.active_object
    for v in o.data.vertices:
        x, y = v.co.x, v.co.y
        v.co.z = 0.95 * math.exp(-(x * x + y * y)) + 0.45 * math.exp(-2.5 * ((x - 0.8) ** 2 + (y + 0.7) ** 2))
    m = o.modifiers.new("tri", "TRIANGULATE")
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)
    return o  # no smooth() — keep the facets visible


BUILDERS = {
    # Shapes
    "sphere": build_sphere,
    "ramp": build_ramp,
    "pipe": build_pipe,
    "berm": build_berm,
    "torus": build_torus,
    "plateau": build_plateau,
    "plate": build_plate,
    # Paths
    "cable": build_cable,
    "ridge": build_ridge,
    "contour": build_contour,
    "mesa": build_mesa,
    "pillow": build_pillow,
    # Effects
    "gradient": build_gradient,
    # Mesh
    "mesh": build_mesh,
}


def normalize(obj: bpy.types.Object) -> None:
    """Uniform tile framing: scale the built object so its footprint fills the same share of the
    tile regardless of how the builder sized it, centre it, and sit it on the ground plane."""
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = obj.evaluated_get(dg).to_mesh()
    pts = [(obj.matrix_world @ v.co)[:] for v in mesh.vertices]
    obj.evaluated_get(dg).to_mesh_clear()
    xs, ys, zs = zip(*pts)
    # frame in SCREEN space: project onto the ortho camera's right/up axes (rot 60/0/45 in
    # setup_camera), so diagonal shapes fill the tile the same as axis-aligned ones
    rx, ry = 0.7071, 0.7071
    ux, uy, uz = -0.3536, 0.3536, 0.866
    rs = [x * rx + y * ry for x, y, z in pts]
    us = [x * ux + y * uy + z * uz for x, y, z in pts]
    f = min(2.5 / max(max(rs) - min(rs), 1e-6), 2.1 / max(max(us) - min(us), 1e-6))
    obj.scale = tuple(c * f for c in obj.scale)
    # scaling happens about the object ORIGIN (location fixed): a world point p lands at
    # loc + (p - loc)*f. Solve location so the bbox centres in x/y and its min sits on z=0.
    lx, ly, lz = obj.location
    obj.location = (
        -((min(xs) + max(xs)) / 2 - lx) * f,
        -((min(ys) + max(ys)) / 2 - ly) * f,
        -(min(zs) - lz) * f,
    )


def add_shadow_catcher() -> None:
    bpy.ops.mesh.primitive_plane_add(size=40.0)
    plane = bpy.context.active_object
    plane.is_shadow_catcher = True


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # optional shape filter after `--`: `blender -b -P render_icons.py -- cable mesa` renders only those
    import sys

    only = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    builders = {k: v for k, v in BUILDERS.items() if not only or k in only}
    ok, failed = 0, []
    for name, build in builders.items():
        try:
            reset_scene()
            setup_camera_and_light()
            obj = build()
            normalize(obj)
            add_shadow_catcher()
            add_clay_material(obj)
            bpy.context.scene.render.filepath = str(OUT_DIR / f"{name}.png")
            bpy.ops.render.render(write_still=True)
            ok += 1
            print(f"rendered {name}.png")
        except Exception as exc:  # one bad builder must not kill the batch
            failed.append(name)
            print(f"FAILED {name}: {exc}")
    print(f"\ndone: {ok} rendered, {len(failed)} failed: {failed}")


if __name__ == "__main__":
    main()
