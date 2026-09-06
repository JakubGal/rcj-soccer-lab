"""Extract real GLB triangle-union X/Z footprints, including concavity and holes.

Dependencies (temporary environment): numpy>=1.21, shapely>=2.1.
Run from the repository root:
python scripts/extract-robot-footprints.py --source-root public/models/robots --output lib/simulator/robot-footprints.json
Both input assets currently have identity node transforms; generic glTF node
matrix/TRS transforms are nevertheless applied before projection. Virtual
renderer markers/halos are intentionally excluded. Rigid actor yaw is applied
at runtime as worldX = x*cos(yaw) + z*sin(yaw),
worldZ = -x*sin(yaw) + z*cos(yaw), then actor translation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import struct
import time
from pathlib import Path
import numpy as np
import shapely
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
from shapely.geometry.polygon import orient

TOLERANCE = 0.00002
UNION_GRID = 0.00000001  # 0.01 micrometre snap grid for stable union.
DTYPES = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
SIZES = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546c67 and version == 2 and length == len(data)
    offset, document, binary = 12, None, None
    while offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == 0x4e4f534a:
            document = json.loads(chunk)
        elif kind == 0x004e4942:
            binary = chunk
        offset += 8 + size
    assert document is not None and binary is not None
    return data, document, binary


def accessor(document, binary, index):
    a = document['accessors'][index]
    assert 'sparse' not in a, 'Sparse accessors need explicit handling'
    view = document['bufferViews'][a['bufferView']]
    assert view.get('buffer', 0) == 0
    dtype = np.dtype(DTYPES[a['componentType']])
    count = SIZES[a['type']]
    offset = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = view.get('byteStride', dtype.itemsize * count)
    values = np.ndarray((a['count'], count), dtype=dtype, buffer=binary,
                        offset=offset, strides=(stride, dtype.itemsize)).copy()
    assert not a.get('normalized', False), 'Normalized accessor needs explicit handling'
    return values


def node_transform(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=float).reshape((4, 4), order='F')
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    rotation = np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
        [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
        [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y],
    ])
    matrix = np.eye(4)
    matrix[:3, :3] = rotation @ np.diag(node.get('scale', [1, 1, 1]))
    matrix[:3, 3] = node.get('translation', [0, 0, 0])
    return matrix


def polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, (MultiPolygon, GeometryCollection)):
        return [part for g in geometry.geoms for part in polygon_parts(g)]
    return []


def rings(geometry):
    result = []
    for p in sorted(polygon_parts(geometry), key=lambda p: (-p.area, p.bounds)):
        p = orient(p, sign=1.0)
        ring = lambda r: [[round(x, 9), round(z, 9)] for x, z in list(r.coords)[:-1]]
        result.append({'outer': ring(p.exterior), 'holes': [ring(r) for r in p.interiors]})
    return result


def extract(path):
    started = time.monotonic()
    raw, document, binary = read_glb(path)
    partials, stats = [], {'triangles': 0, 'projectedNonzeroTriangles': 0, 'meshInstances': 0}
    def walk(index, parent):
        node = document['nodes'][index]
        transform = parent @ node_transform(node)
        if 'mesh' in node:
            stats['meshInstances'] += 1
            for primitive in document['meshes'][node['mesh']]['primitives']:
                assert primitive.get('mode', 4) == 4, 'Only TRIANGLES primitives supported'
                vertices = accessor(document, binary, primitive['attributes']['POSITION']).astype(float)
                vertices = (vertices @ transform[:3, :3].T) + transform[:3, 3]
                indices = (accessor(document, binary, primitive['indices']).ravel()
                           if 'indices' in primitive else np.arange(len(vertices)))
                assert len(indices) % 3 == 0
                points = vertices[indices].reshape((-1, 3, 3))[:, :, [0, 2]]
                stats['triangles'] += len(points)
                u, v = points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]
                nonzero = (u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]) != 0
                points = points[nonzero]
                stats['projectedNonzeroTriangles'] += len(points)
                chunks = []
                for first in range(0, len(points), 4000):
                    triangles = shapely.polygons(points[first:first + 4000])
                    chunks.append(shapely.union_all(triangles, grid_size=UNION_GRID))
                if chunks:
                    partials.append(shapely.union_all(chunks, grid_size=UNION_GRID))
                print(f'{path.stem}: primitive {len(partials)} processed', flush=True)
        for child in node.get('children', []):
            walk(child, transform)
    scene = document['scenes'][document.get('scene', 0)]
    for root in scene['nodes']:
        walk(root, np.eye(4))
    union = shapely.union_all(partials, grid_size=UNION_GRID)
    exact = shapely.union_all(polygon_parts(union), grid_size=UNION_GRID)
    assert exact.is_valid, shapely.is_valid_reason(exact)
    simplification_tolerance = TOLERANCE
    simplified = exact.simplify(simplification_tolerance, preserve_topology=True)
    hausdorff = shapely.hausdorff_distance(exact.boundary, simplified.boundary, densify=0.25)
    while hausdorff + UNION_GRID > TOLERANCE:
        simplification_tolerance *= 0.5
        simplified = exact.simplify(simplification_tolerance, preserve_topology=True)
        hausdorff = shapely.hausdorff_distance(exact.boundary, simplified.boundary, densify=0.25)
    assert simplified.is_valid, shapely.is_valid_reason(simplified)
    exact_parts, simple_parts = polygon_parts(exact), polygon_parts(simplified)
    assert len(exact_parts) == len(simple_parts)
    assert sum(len(p.interiors) for p in exact_parts) == sum(len(p.interiors) for p in simple_parts)
    result = {'source': f'public/models/robots/{path.name}',
              'sha256': hashlib.sha256(raw).hexdigest(),
              'polygons': rings(simplified)}
    stats.update({
        'polygonCount': len(simple_parts),
        'holeCount': sum(len(p.interiors) for p in simple_parts),
        'outerVertices': sum(len(p['outer']) for p in result['polygons']),
        'holeVertices': sum(len(h) for p in result['polygons'] for h in p['holes']),
        'unionAreaSquareMetres': exact.area,
        'simplifiedAreaSquareMetres': simplified.area,
        'symmetricDifferenceAreaSquareMetres': exact.symmetric_difference(simplified).area,
        'simplificationToleranceMetres': simplification_tolerance,
        'hausdorffDistanceMetres': hausdorff,
        'bounds': list(simplified.bounds),
        'elapsedSeconds': time.monotonic() - started,
        'sourceSha256': result['sha256'],
    })
    print(json.dumps({'model': path.stem, **stats}), flush=True)
    return result, stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    artifact = {'revision': 1, 'toleranceMetres': TOLERANCE, 'models': {}}
    report = {'unionSnapGridMetres': UNION_GRID, 'coordinateDecimalPlaces': 9,
              'winding': 'CCW outer, CW holes in model-local X/Z, no repeated closing vertex',
              'simplification': 'Douglas-Peucker preserve_topology=True; all polygon and hole counts preserved',
              'projection': 'Every nonzero-area rendered triangle, all mesh primitives and node transforms; excludes virtual markers',
              'shapelyVersion': shapely.__version__, 'models': {}}
    for name in ['xlc-open-2020', 'xlc-innovation-2021']:
        artifact['models'][name], report['models'][name] = extract(args.source_root / f'{name}.glb')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, separators=(',', ':')) + '\n', encoding='utf-8')
    args.output.with_suffix('.report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {args.output}: {args.output.stat().st_size} bytes', flush=True)

if __name__ == '__main__':
    main()
