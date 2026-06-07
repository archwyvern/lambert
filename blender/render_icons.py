"""Render the shape-library icons as actual 3D clay renders.

Each icon models the real height-field shape the engine evaluates (dome, plateau,
ridge, groove) so the palette previews what you actually get. Run headless:

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
    # EEVEE's identifier varies across versions; fall back gracefully
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue


def add_clay_material(obj: bpy.types.Object) -> None:
    # mid-gray clay with a harder key/fill ratio (set in the lights) so the form's
    # edges read at small sizes; pure white washed out the silhouettes
    mat = bpy.data.materials.new("clay")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.52, 0.53, 0.55, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
    obj.data.materials.append(mat)


def setup_camera_and_light() -> None:
    # orthographic three-quarter view, classic clay-icon framing
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 3.4
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (4.0, -4.0, 3.2)
    cam.rotation_euler = (math.radians(60), 0.0, math.radians(45))
    bpy.context.scene.camera = cam

    # hard key + weak fill + dim ambient = strong facet contrast (edges readable small)
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

    # ambient occlusion deepens creases (engine-dependent flags; best effort)
    eevee = bpy.context.scene.eevee
    for flag in ("use_gtao", "use_fast_gi"):
        try:
            setattr(eevee, flag, True)
        except (AttributeError, TypeError):
            pass


def smooth(obj: bpy.types.Object) -> None:
    for poly in obj.data.polygons:
        poly.use_smooth = True


def build_dome() -> bpy.types.Object:
    # hemisphere: the dome's spherical-cap height profile
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.2)
    obj = bpy.context.active_object
    # flatten the lower half onto z=0 so it reads as a dome on a surface
    for v in obj.data.vertices:
        if v.co.z < 0:
            v.co.z = 0
    smooth(obj)
    return obj


def build_plateau() -> bpy.types.Object:
    # square frustum: polygon footprint, linear slope to a flat top
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.5, radius2=0.95, depth=0.85)
    obj = bpy.context.active_object
    obj.rotation_euler = (0.0, 0.0, math.radians(45))
    obj.location.z = 0.425
    return obj


def build_ridge() -> bpy.types.Object:
    # half-cylinder bar: polyline spine with a round profile
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.55, depth=2.6)
    obj = bpy.context.active_object
    obj.rotation_euler = (0.0, math.radians(90), math.radians(20))
    for v in obj.data.vertices:
        pass  # keep full cylinder; lying on the ground it reads as a rounded ridge
    obj.location.z = 0.32
    smooth(obj)
    return obj


def build_groove() -> bpy.types.Object:
    # slab with a rounded channel carved through it (boolean difference)
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    slab = bpy.context.active_object
    slab.scale = (1.5, 1.5, 0.28)
    slab.location.z = 0.28

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.42, depth=4.0)
    cutter = bpy.context.active_object
    cutter.rotation_euler = (0.0, math.radians(90), math.radians(20))
    cutter.location.z = 0.56

    mod = slab.modifiers.new("groove", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    bpy.context.view_layer.objects.active = slab
    bpy.ops.object.modifier_apply(modifier="groove")
    bpy.data.objects.remove(cutter)
    return slab


BUILDERS = {
    "dome": build_dome,
    "plateau": build_plateau,
    "ridge": build_ridge,
    "groove": build_groove,
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, build in BUILDERS.items():
        reset_scene()
        setup_camera_and_light()
        obj = build()
        add_clay_material(obj)
        bpy.context.scene.render.filepath = str(OUT_DIR / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {name}.png")


if __name__ == "__main__":
    main()
