"""Print mesh bounds from a GLB to help clean CAD exports before web use."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main() -> int:
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    source = Path(sys.argv[separator + 1]).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    rows = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        size = maximum - minimum
        rows.append((size.x * size.y * size.z, len(obj.data.polygons), obj.name, minimum, maximum))

    for volume, polygons, name, minimum, maximum in sorted(rows, reverse=True)[:80]:
        print(
            f"{polygons:8d} polys | volume {volume:12.1f} | {name} | "
            f"min ({minimum.x:.1f}, {minimum.y:.1f}, {minimum.z:.1f}) "
            f"max ({maximum.x:.1f}, {maximum.y:.1f}, {maximum.z:.1f})"
        )
    for material in bpy.data.materials:
        principled = material.node_tree.nodes.get("Principled BSDF") if material.use_nodes else None
        node_color = (
            tuple(round(value, 4) for value in principled.inputs["Base Color"].default_value)
            if principled
            else None
        )
        print(
            f"MATERIAL {material.name} diffuse="
            f"{tuple(round(value, 4) for value in material.diffuse_color)} node={node_color}"
        )
    print(f"TOTAL {len(rows)} meshes, {sum(row[1] for row in rows):,} polygons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
