"""Repair the verified stray triangle in the original XLC Open 2020 web GLB.

Usage: python scripts/repair-2020-robot.py ORIGINAL.glb REPAIRED.glb
Requires numpy. The original SHA guards this one-time asset repair; materials,
normals, real body triangles, and all other buffer data remain intact.
Regenerate robot-footprints.json after replacing the public asset.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

ORIGINAL_SHA = '42fc3dc91281d4c6a7006221434c36cc9d704d1206462cc9f4b56f5987e31415'
TARGET_WIDTH = 0.176


def repair(source, destination):
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ORIGINAL_SHA:
        raise ValueError('Expected the original 2020 asset; do not normalize a repaired asset twice.')
    json_size, kind = struct.unpack_from('<II', raw, 12)
    assert kind == 0x4e4f534a
    document = json.loads(raw[20:20 + json_size])
    binary_start = 20 + json_size
    binary_size, kind = struct.unpack_from('<II', raw, binary_start)
    assert kind == 0x004e4942
    binary = bytearray(raw[binary_start + 8:binary_start + 8 + binary_size])
    assert all(not any(key in node for key in ['matrix', 'translation', 'rotation', 'scale'])
               for node in document['nodes'])

    def values(index):
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        count = 3 if accessor['type'] == 'VEC3' else 1
        dtype = np.dtype({5126: '<f4', 5123: '<u2', 5125: '<u4'}[accessor['componentType']])
        return np.ndarray((accessor['count'], count), dtype=dtype, buffer=binary,
                          offset=view.get('byteOffset', 0) + accessor.get('byteOffset', 0),
                          strides=(view.get('byteStride', dtype.itemsize * count), dtype.itemsize))

    primitives = document['meshes'][0]['primitives']
    primitive = primitives[0]
    indices = values(primitive['indices']).ravel()
    triangles = indices.reshape(-1, 3)
    assert triangles[43535].tolist() == [57541, 57542, 57540]
    assert np.count_nonzero(indices == 57542) == 1
    kept = np.delete(triangles.copy(), 43535, axis=0).ravel()
    indices[:len(kept)] = kept
    document['accessors'][primitive['indices']]['count'] = len(kept)
    # The unused vertex must not pollute accessor/culling bounds either.
    positions = values(primitive['attributes']['POSITION'])
    positions[57542] = positions[57541]

    position_ids = {p['attributes']['POSITION'] for p in primitives}
    body = np.concatenate([values(index).astype(np.float64) for index in position_ids])
    minimum, maximum = body.min(axis=0), body.max(axis=0)
    center = (minimum + maximum) / 2
    center[1] = minimum[1]
    scale = TARGET_WIDTH / (maximum[0] - minimum[0])
    for index in position_ids:
        vertices = values(index)
        vertices[:] = (vertices.astype(np.float64) - center) * scale
        document['accessors'][index]['min'] = vertices.min(axis=0).tolist()
        document['accessors'][index]['max'] = vertices.max(axis=0).tolist()

    encoded = json.dumps(document, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    data = (struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(binary))
            + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
            + struct.pack('<II', len(binary), 0x004e4942) + binary)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    print(json.dumps({'removedTriangles': 1, 'bodyCenterBefore': center.tolist(),
                      'scale': scale, 'targetWidthMetres': TARGET_WIDTH,
                      'heightMetres': float((maximum[1] - minimum[1]) * scale),
                      'sha256': hashlib.sha256(data).hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    arguments = parser.parse_args()
    repair(arguments.source, arguments.destination)
