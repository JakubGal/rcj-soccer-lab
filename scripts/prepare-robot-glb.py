"""Normalize an intermediate CAD GLB into a compact web robot asset.

Run with Blender in background mode. The script keeps the overall silhouette and
source colour intent, while reducing CAD-only detail and draw calls.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


PALETTE = (
    ("graphite", (0.035, 0.045, 0.055, 1.0), 0.72, 0.28),
    ("black polymer", (0.075, 0.085, 0.095, 1.0), 0.05, 0.5),
    ("dark metal", (0.19, 0.21, 0.23, 1.0), 0.72, 0.3),
    ("aluminium", (0.57, 0.61, 0.64, 1.0), 0.78, 0.24),
    ("light metal", (0.82, 0.85, 0.87, 1.0), 0.65, 0.22),
    ("white polymer", (0.92, 0.93, 0.92, 1.0), 0.0, 0.52),
    ("pcb green", (0.035, 0.28, 0.12, 1.0), 0.12, 0.42),
    ("signal green", (0.13, 0.68, 0.18, 1.0), 0.05, 0.4),
    ("deep blue", (0.025, 0.12, 0.5, 1.0), 0.22, 0.37),
    ("cyan", (0.03, 0.48, 0.72, 1.0), 0.1, 0.36),
    ("red", (0.64, 0.035, 0.025, 1.0), 0.08, 0.44),
    ("orange", (0.93, 0.23, 0.025, 1.0), 0.05, 0.46),
    ("yellow", (0.91, 0.66, 0.035, 1.0), 0.08, 0.42),
    ("copper", (0.54, 0.22, 0.055, 1.0), 0.64, 0.3),
    ("magenta", (0.56, 0.045, 0.42, 1.0), 0.08, 0.42),
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--front-yaw", type=float, default=0.0)
    parser.add_argument(
        "--source-up",
        choices=("neg-y", "pos-y", "z"),
        default="neg-y",
        help="Vertical axis observed after Blender imports the intermediate CAD GLB.",
    )
    parser.add_argument("--max-size-m", type=float, default=0.176)
    parser.add_argument("--target-triangles", type=int, default=260_000)
    parser.add_argument(
        "--exclude-name",
        action="append",
        default=[],
        help="Case-insensitive substring to omit; may be supplied more than once.",
    )
    parser.add_argument("--preview", type=Path)
    return parser.parse_args(argv)


def color_distance(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    # Weight luminance-bearing green slightly more than blue.
    return (
        (a[0] - b[0]) ** 2 * 0.3
        + (a[1] - b[1]) ** 2 * 0.5
        + (a[2] - b[2]) ** 2 * 0.2
    )


def create_palette_materials() -> list[bpy.types.Material]:
    result: list[bpy.types.Material] = []
    for name, color, metallic, roughness in PALETTE:
        material = bpy.data.materials.new(f"RCJ {name}")
        material.diffuse_color = color
        material.use_nodes = True
        principled = material.node_tree.nodes.get("Principled BSDF")
        if principled:
            principled.inputs["Base Color"].default_value = color
            principled.inputs["Metallic"].default_value = metallic
            principled.inputs["Roughness"].default_value = roughness
        result.append(material)
    return result


def vertex_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    """Return fresh bounds after direct mesh transforms (bound_box can be stale)."""
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_preview(robot: bpy.types.Object, path: Path) -> None:
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("Preview world")
        bpy.context.scene.world = world
    world.color = (0.008, 0.014, 0.02)
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.008, 0.014, 0.02, 1)
        background.inputs["Strength"].default_value = 0.35

    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -0.001))
    ground = bpy.context.object
    ground.name = "Preview ground"
    ground_material = bpy.data.materials.new("Preview turf")
    ground_material.diffuse_color = (0.015, 0.15, 0.075, 1)
    ground_material.use_nodes = True
    ground_principled = ground_material.node_tree.nodes.get("Principled BSDF")
    if ground_principled:
        ground_principled.inputs["Base Color"].default_value = (0.015, 0.15, 0.075, 1)
        ground_principled.inputs["Roughness"].default_value = 0.86
    ground.data.materials.append(ground_material)

    for name, location, energy, size in (
        ("Key", (0.42, 0.58, 0.5), 650.0, 0.36),
        ("Fill", (-0.42, 0.32, 0.24), 330.0, 0.28),
        ("Rim", (0.0, 0.36, -0.42), 420.0, 0.24),
    ):
        light_data = bpy.data.lights.new(name, type="AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light)
        light.location = location
        point_camera(light, Vector((0, 0, 0.07)))

    camera_data = bpy.data.cameras.new("Preview camera")
    camera_data.lens = 58
    camera = bpy.data.objects.new("Preview camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.25, 0.36, 0.19)
    point_camera(camera, Vector((0, 0, 0.075)))
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path.resolve())
    scene.render.film_transparent = False
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def main() -> int:
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    args = parse_args(sys.argv[separator + 1 :])
    source = args.input.resolve()
    target = args.output.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    excluded = tuple(value.casefold() for value in args.exclude_name)
    meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and not any(value in obj.name.casefold() for value in excluded)
    ]
    if not meshes:
        raise RuntimeError("The source GLB contains no renderable meshes")

    palette = create_palette_materials()
    for obj in meshes:
        # CAD assemblies heavily instance repeated components. Make each mesh
        # single-user before baking its occurrence transform or remapping slots;
        # otherwise the same shared mesh is transformed and recoloured repeatedly.
        obj.data = obj.data.copy()
        obj.data.transform(obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        if not obj.data.materials:
            obj.data.materials.append(palette[2])
        else:
            remap: list[int] = []
            for material in obj.data.materials:
                principled = (
                    material.node_tree.nodes.get("Principled BSDF")
                    if material and material.use_nodes
                    else None
                )
                source_color = (
                    principled.inputs["Base Color"].default_value
                    if principled
                    else material.diffuse_color
                    if material
                    else (0.5, 0.5, 0.5, 1)
                )
                index = min(
                    range(len(PALETTE)),
                    key=lambda item: color_distance(source_color, PALETTE[item][1]),
                )
                remap.append(index)
            mapped_indices = [
                remap[min(polygon.material_index, len(remap) - 1)]
                for polygon in obj.data.polygons
            ]
            obj.data.materials.clear()
            for material in palette:
                obj.data.materials.append(material)
            for polygon, material_index in zip(obj.data.polygons, mapped_indices):
                polygon.material_index = material_index

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    robot = bpy.context.object
    robot.name = "Robot visual"
    robot.parent = None
    robot.matrix_world = Matrix.Identity(4)
    print(
        "Joined transform",
        tuple(round(value, 6) for row in robot.matrix_world for value in row),
    )

    palette_lookup = {material.name: index for index, material in enumerate(palette)}
    old_slots = list(robot.data.materials)
    old_to_palette = {
        index: palette_lookup.get(material.name, 2)
        for index, material in enumerate(old_slots)
    }
    used_indices = sorted({
        old_to_palette.get(polygon.material_index, 2)
        for polygon in robot.data.polygons
    })
    palette_to_new = {old: new for new, old in enumerate(used_indices)}
    compact_indices = [
        palette_to_new[old_to_palette.get(polygon.material_index, 2)]
        for polygon in robot.data.polygons
    ]
    robot.data.materials.clear()
    for index in used_indices:
        robot.data.materials.append(palette[index])
    for polygon, material_index in zip(robot.data.polygons, compact_indices):
        polygon.material_index = material_index

    triangles_before = len(robot.data.polygons)
    if triangles_before > args.target_triangles:
        modifier = robot.modifiers.new("Web detail reduction", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = max(0.02, args.target_triangles / triangles_before)
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = robot
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    # CadQuery currently writes the CAD Z-up vertices without converting them to
    # glTF's Y-up convention. Depending on the source assembly, Blender therefore
    # observes either Y direction as vertical. Correct it to Blender's +Z before
    # export; Blender then writes a standards-compliant Y-up GLB for PlayCanvas.
    if args.source_up == "neg-y":
        robot.data.transform(Matrix.Rotation(math.radians(-90), 4, "X"))
    elif args.source_up == "pos-y":
        robot.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))
    yaw = Matrix.Rotation(math.radians(args.front_yaw), 4, "Z")
    robot.data.transform(yaw)
    minimum, maximum = vertex_bounds(robot)
    size = maximum - minimum
    largest_dimension = max(size.x, size.y, size.z)
    scale = args.max_size_m / largest_dimension
    robot.data.transform(Matrix.Scale(scale, 4))
    minimum, maximum = vertex_bounds(robot)
    center = (minimum + maximum) * 0.5
    robot.data.transform(Matrix.Translation((-center.x, -center.y, -minimum.z)))
    minimum, maximum = vertex_bounds(robot)
    print(
        "Normalized bounds",
        tuple(round(value, 6) for value in minimum),
        tuple(round(value, 6) for value in maximum),
        "materials",
        [material.name for material in robot.data.materials],
    )

    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    robot.select_set(True)
    bpy.context.view_layer.objects.active = robot
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
    )

    if args.preview:
        render_preview(robot, args.preview)

    minimum, maximum = vertex_bounds(robot)
    print(
        "Prepared",
        target,
        f"({target.stat().st_size / (1024 * 1024):.1f} MB,",
        f"{triangles_before:,} -> {len(robot.data.polygons):,} triangles,",
        f"size {maximum.x - minimum.x:.3f} x {maximum.y - minimum.y:.3f} x "
        f"{maximum.z - minimum.z:.3f} m)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
