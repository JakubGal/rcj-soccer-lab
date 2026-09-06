import footprints from './robot-footprints.json';
import {
  RCJ_FIELD_DERIVED as FIELD,
  RCJ_FIELD_SPEC_2026 as SPEC,
} from './field-spec';
import { DEFAULT_ROBOT_VISUAL_ID, type RobotVisualId } from './robot-models';
import type { Pose } from './types';

export type PointXZ = [number, number];
type Polygon = { outer: PointXZ[]; holes: PointXZ[][] };
const EPS = 1e-10;
const halfWidth = SPEC.penaltyArea.width / 2;
const front = FIELD.penaltyBackEdgeZ - SPEC.penaltyArea.depth;
const radius = SPEC.penaltyArea.outerCornerRadius;

/** Outer edge of the white marking; the line itself belongs to the area. */
export function insidePenalty(point: Pick<Pose, 'x' | 'z'>, end: number) {
  const x = Math.abs(point.x),
    z = point.z * end;
  if (
    x > halfWidth + EPS ||
    z > FIELD.penaltyBackEdgeZ + EPS ||
    z < front - EPS
  )
    return false;
  return (
    x <= FIELD.penaltyArcCenterX ||
    z >= FIELD.penaltyArcCenterZ ||
    Math.hypot(x - FIELD.penaltyArcCenterX, z - FIELD.penaltyArcCenterZ) <=
      radius + EPS
  );
}

export function penaltyAreaOutline(end: number, arcSegments = 32): PointXZ[] {
  const points: PointXZ[] = [
    [-halfWidth, end * FIELD.penaltyBackEdgeZ],
    [-halfWidth, end * FIELD.penaltyArcCenterZ],
  ];
  for (let i = 1; i <= arcSegments; i++) {
    const angle = ((i / arcSegments) * Math.PI) / 2;
    points.push([
      -FIELD.penaltyArcCenterX - radius * Math.cos(angle),
      end * (FIELD.penaltyArcCenterZ - radius * Math.sin(angle)),
    ]);
  }
  points.push([FIELD.penaltyArcCenterX, end * front]);
  for (let i = arcSegments - 1; i >= 0; i--) {
    const angle = ((i / arcSegments) * Math.PI) / 2;
    points.push([
      FIELD.penaltyArcCenterX + radius * Math.cos(angle),
      end * (FIELD.penaltyArcCenterZ - radius * Math.sin(angle)),
    ]);
  }
  points.push([halfWidth, end * FIELD.penaltyBackEdgeZ]);
  return points;
}

// Match the procedural mesh's 20-sided chassis and horizontal dribbler.
// Team halos, number badges, selection rings and shadows are not robot bodies.
const lab: Polygon[] = [
  {
    outer: Array.from(
      { length: 20 },
      (_, i) =>
        [
          Math.cos((i * Math.PI) / 10) * 0.085,
          Math.sin((i * Math.PI) / 10) * 0.085,
        ] as PointXZ,
    ),
    holes: [],
  },
  {
    outer: [
      [-0.0575, 0.075],
      [0.0575, 0.075],
      [0.0575, 0.101],
      [-0.0575, 0.101],
    ],
    holes: [],
  },
];
export function robotFootprint(visual: RobotVisualId): readonly Polygon[] {
  return visual === 'lab'
    ? lab
    : (footprints.models[visual].polygons as Polygon[]);
}
const bounds = new Map<RobotVisualId, number>();
function footprintRadius(visual: RobotVisualId) {
  let value = bounds.get(visual);
  if (value === undefined) {
    value = Math.max(
      ...robotFootprint(visual).flatMap((polygon) =>
        polygon.outer.map(([x, z]) => Math.hypot(x, z)),
      ),
    );
    bounds.set(visual, value);
  }
  return value;
}
export function projectRobotFootprint(
  pose: Pose,
  visual: RobotVisualId,
): Polygon[] {
  const c = Math.cos(pose.yaw),
    s = Math.sin(pose.yaw);
  const transform = ([x, z]: PointXZ): PointXZ => [
    pose.x + x * c + z * s,
    pose.z - x * s + z * c,
  ];
  return robotFootprint(visual).map((polygon) => ({
    outer: polygon.outer.map(transform),
    holes: polygon.holes.map((ring) => ring.map(transform)),
  }));
}

export type RobotWallClearance = {
  /** Signed body-to-wall gap. Zero is contact; negative means penetration. */
  gap: number;
  /** Outward unit normal of the nearest field wall. */
  x: -1 | 0 | 1;
  z: -1 | 0 | 1;
};

function projectedBodyBounds(yaw: number, visual: RobotVisualId) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const polygon of robotFootprint(visual))
    for (const [x, z] of polygon.outer) {
      const projectedX = x * c + z * s;
      const projectedZ = -x * s + z * c;
      minX = Math.min(minX, projectedX);
      maxX = Math.max(maxX, projectedX);
      minZ = Math.min(minZ, projectedZ);
      maxZ = Math.max(maxZ, projectedZ);
    }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Clamp a robot centre so its actual rendered body, at its current yaw, stays
 * inside the four field walls. Marker rings and shadows are deliberately not
 * part of this physical boundary.
 */
export function clampRobotToField(
  pose: Pose,
  visual: RobotVisualId = DEFAULT_ROBOT_VISUAL_ID,
  clearance = 0,
): Pose {
  const body = projectedBodyBounds(pose.yaw, visual);
  return {
    ...pose,
    x: Math.min(
      FIELD.floorHalfWidth - body.maxX - clearance,
      Math.max(-FIELD.floorHalfWidth - body.minX + clearance, pose.x),
    ),
    z: Math.min(
      FIELD.floorHalfLength - body.maxZ - clearance,
      Math.max(-FIELD.floorHalfLength - body.minZ + clearance, pose.z),
    ),
  };
}

/** Nearest physical wall measured from the actual projected robot body. */
export function robotWallClearance(
  pose: Pose,
  visual: RobotVisualId = DEFAULT_ROBOT_VISUAL_ID,
): RobotWallClearance {
  const body = projectedBodyBounds(pose.yaw, visual);
  return [
    {
      gap: FIELD.floorHalfWidth - (pose.x + body.maxX),
      x: 1 as const,
      z: 0 as const,
    },
    {
      gap: pose.x + body.minX + FIELD.floorHalfWidth,
      x: -1 as const,
      z: 0 as const,
    },
    {
      gap: FIELD.floorHalfLength - (pose.z + body.maxZ),
      x: 0 as const,
      z: 1 as const,
    },
    {
      gap: pose.z + body.minZ + FIELD.floorHalfLength,
      x: 0 as const,
      z: -1 as const,
    },
  ].sort((first, second) => first.gap - second.gap)[0];
}

export function robotTouchesFieldWall(
  pose: Pose,
  visual: RobotVisualId = DEFAULT_ROBOT_VISUAL_ID,
  tolerance = 0.0002,
) {
  return robotWallClearance(pose, visual).gap <= tolerance;
}
const interpolate = (a: PointXZ, b: PointXZ, t: number): PointXZ => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const contains = ([x, z]: PointXZ, end: number) => insidePenalty({ x, z }, end);

/** Candidate crossings of the straight edges and exact quarter-circle edges. */
function crossings(a: PointXZ, b: PointXZ, end: number) {
  const dx = b[0] - a[0],
    dz = (b[1] - a[1]) * end,
    z = a[1] * end;
  const times = [0, 1];
  const add = (t: number) => {
    if (t > 0 && t < 1) times.push(t);
  };
  if (Math.abs(dx) > EPS)
    for (const x of [-halfWidth, halfWidth]) add((x - a[0]) / dx);
  if (Math.abs(dz) > EPS)
    for (const edge of [front, FIELD.penaltyBackEdgeZ]) add((edge - z) / dz);
  const length2 = dx * dx + dz * dz;
  if (length2 > EPS * EPS)
    for (const center of [-FIELD.penaltyArcCenterX, FIELD.penaltyArcCenterX]) {
      const x = a[0] - center,
        y = z - FIELD.penaltyArcCenterZ;
      const dot = x * dx + y * dz;
      // Keep a tangent contact even if its discriminant rounds below zero.
      add(-dot / length2);
      const discriminant =
        dot * dot - length2 * (x * x + y * y - radius * radius);
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        add((-dot - root) / length2);
        add((-dot + root) / length2);
      }
    }
  return times.sort((a, b) => a - b);
}
function pointInRing([x, z]: PointXZ, ring: PointXZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

/** Actual projected mesh, with yaw and concavities; never the physics circle. */
export function robotPenaltyOverlap(
  pose: Pose,
  end: number,
  visual: RobotVisualId = DEFAULT_ROBOT_VISUAL_ID,
  full = false,
) {
  // Reject distant actors using their actual outermost physical part.
  const bound = footprintRadius(visual);
  if (
    Math.abs(pose.x) > halfWidth + bound + EPS ||
    pose.z * end < front - bound - EPS ||
    pose.z * end > FIELD.penaltyBackEdgeZ + bound + EPS
  )
    return false;
  const c = Math.cos(pose.yaw),
    s = Math.sin(pose.yaw);
  const transform = ([x, z]: PointXZ): PointXZ => [
    pose.x + x * c + z * s,
    pose.z - x * s + z * c,
  ];
  const polygons = robotFootprint(visual);
  // The penalty area is convex, so all outer vertices inside implies full entry.
  if (full)
    return polygons.every((p) =>
      p.outer.every((v) => contains(transform(v), end)),
    );
  for (const polygon of polygons) {
    const ring = polygon.outer.map(transform);
    if (ring.some((p) => contains(p, end))) return true;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      if (crossings(a, b, end).some((t) => contains(interpolate(a, b, t), end)))
        return true;
    }
    // Containment with no crossing, respecting empty spaces inside the body.
    const worldZ = (end * (front + FIELD.penaltyBackEdgeZ)) / 2 - pose.z;
    const local: PointXZ = [-pose.x * c - worldZ * s, -pose.x * s + worldZ * c];
    if (
      pointInRing(local, polygon.outer) &&
      !polygon.holes.some((hole) => pointInRing(local, hole))
    )
      return true;
  }
  return false;
}

/** Split the actual body outline at the same boundary used by the referee. */
export function penaltyEvidenceSegments(pose: Pose, visual: RobotVisualId) {
  const segments: { a: PointXZ; b: PointXZ; inside: boolean }[] = [];
  for (const polygon of projectRobotFootprint(pose, visual)) {
    for (let i = 0; i < polygon.outer.length; i++) {
      const a = polygon.outer[i],
        b = polygon.outer[(i + 1) % polygon.outer.length];
      const times = [
        ...new Set([...crossings(a, b, -1), ...crossings(a, b, 1)]),
      ].sort((a, b) => a - b);
      for (let j = 1; j < times.length; j++) {
        if (times[j] - times[j - 1] < EPS) continue;
        const midpoint = interpolate(a, b, (times[j - 1] + times[j]) / 2);
        segments.push({
          a: interpolate(a, b, times[j - 1]),
          b: interpolate(a, b, times[j]),
          inside: contains(midpoint, -1) || contains(midpoint, 1),
        });
      }
    }
  }
  return segments;
}
