"""Render the shape-library icons as actual 3D clay renders.

Each icon models the real height-field shape the engine evaluates, so the palette previews
what you actually get. One builder per registered shape type. Run headless:

    blender --background --python blender/render_icons.py

Outputs transparent 128x128 PNGs into src/ui/icons/ (consumed by Library.tsx).
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
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue


def add_clay_material(obj: bpy.types.Object) -> None:
    mat = bpy.data.materials.new("clay")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.52, 0.53, 0.55, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
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

    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun_data.energy = 5.5
    sun = bpy.data.objects.new("sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(25))

    fill_data = bpy.data.lights.new("fill", type="SUN")
    fill_data.energy = 0.35
    fill = bpy.data.objects.new("fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(60), 0.0, math.radians(205))

    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs[1].default_value = 0.15
    bpy.context.scene.world = world

    eevee = bpy.context.scene.eevee
    for flag in ("use_gtao", "use_fast_gi"):
        try:
            setattr(eevee, flag, True)
        except (AttributeError, TypeError):
            pass


# ── geometry helpers ──────────────────────────────────────────────

def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def box(sx: float, sy: float, sz: float, z: float | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.location.z = z if z is not None else sz / 2
    return o


def cyl(r: float, h: float, verts: int = 48, z: float | None = None) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h)
    o = bpy.context.active_object
    o.location.z = z if z is not None else h / 2
    if verts > 8:
        smooth(o)
    return o


def difference(target: bpy.types.Object, cutter: bpy.types.Object) -> bpy.types.Object:
    m = target.modifiers.new("cut", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(cutter)
    return target


# ── shape builders (one per registered ShapeType) ─────────────────

def build_dome() -> bpy.types.Object:
    # hemisphere: spherical-cap height profile
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.2)
    obj = bpy.context.active_object
    for v in obj.data.vertices:
        if v.co.z < 0:
            v.co.z = 0
    return smooth(obj)


def build_cone() -> bpy.types.Object:
    # circular cone: linear slope to a central apex
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=1.1, radius2=0.0, depth=1.5)
    o = bpy.context.active_object
    o.location.z = 0.75
    return smooth(o)


def build_pyramid() -> bpy.types.Object:
    # square pyramid: linear slope to apex over a square footprint
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.35, radius2=0.0, depth=1.3)
    o = bpy.context.active_object
    o.rotation_euler = (0.0, 0.0, math.radians(45))
    o.location.z = 0.65
    return o


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
    return obj


def build_capsule() -> bpy.types.Object:
    # rounded bar: a cylinder body with hemispherical caps, laid horizontal
    r = 0.55
    body_len = 1.5  # body + two r-caps = 2.6 total, matching the cylinder
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


def build_cylinder() -> bpy.types.Object:
    # flat-ended bar: a plain cylinder laid horizontal (square caps)
    obj = cyl(0.55, 2.6, z=0.32)
    obj.rotation_euler = (0.0, math.radians(90), math.radians(20))
    return obj


def build_frustum() -> bpy.types.Object:
    # tapered bar: a truncated cone laid horizontal (wide end -> narrow end), flat caps
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.62, radius2=0.3, depth=2.6)
    o = bpy.context.active_object
    o.rotation_euler = (0.0, math.radians(90), math.radians(20))
    o.location.z = 0.32
    return smooth(o)


def build_groove() -> bpy.types.Object:
    # slab with a rounded channel carved through it
    slab = box(1.5, 1.5, 0.56, z=0.28)
    cutter = cyl(0.42, 4.0, z=0.56)
    cutter.rotation_euler = (0.0, math.radians(90), math.radians(20))
    return difference(slab, cutter)


def build_wedge() -> bpy.types.Object:
    # ramp: a block with its +x top edge dropped to the floor
    o = box(1.4, 1.6, 0.9)
    for v in o.data.vertices:
        if v.co.x > 0 and v.co.z > 0:
            v.co.z = -0.5
    return o


def build_fillet() -> bpy.types.Object:
    # concave cove: a quarter-round carved from a block's top-front edge
    blk = box(1.5, 2.4, 1.0, z=0.5)
    cutter = cyl(0.95, 3.2, z=1.0)
    cutter.rotation_euler = (math.radians(90), 0.0, 0.0)
    cutter.location.x = 0.75
    return difference(blk, cutter)


def build_cable() -> bpy.types.Object:
    # an S-curve tube: a bezier path with a round bevel (a cable routed around)
    curve = bpy.data.curves.new("cable", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.34
    curve.bevel_resolution = 6
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(2)
    for bp, co in zip(spline.bezier_points, [(-1.35, -0.6, 0.34), (0.0, 0.7, 0.34), (1.35, -0.6, 0.34)]):
        bp.co = co
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new("cable", curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return smooth(bpy.context.active_object)


def build_plane() -> bpy.types.Object:
    # a flat polygon tilted into a slope (what the `tilt` control produces) — a thin square sheet
    o = box(1.6, 1.6, 0.1)
    o.rotation_euler = (math.radians(22), 0.0, 0.0)
    o.location.z = 0.5
    return o


def build_mesh() -> bpy.types.Object:
    # a free triangulated height surface: a subdivided grid sculpted into bumps, left faceted (flat
    # shaded + triangulated) so the triangle mesh reads vs the smooth primitives
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
    # Primitives
    "dome": build_dome,
    "cone": build_cone,
    "pyramid": build_pyramid,
    "torus": build_torus,
    "plateau": build_plateau,
    "plane": build_plane,
    "mesh": build_mesh,
    # Profiles
    "capsule": build_capsule,
    "cylinder": build_cylinder,
    "frustum": build_frustum,
    "groove": build_groove,
    "wedge": build_wedge,
    "fillet": build_fillet,
    "cable": build_cable,
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # optional shape filter after `--`: `blender -b -P render_icons.py -- mesh plane` renders only those
    import sys

    only = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    builders = {k: v for k, v in BUILDERS.items() if not only or k in only}
    ok, failed = 0, []
    for name, build in builders.items():
        try:
            reset_scene()
            setup_camera_and_light()
            obj = build()
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
