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
// Half-width of the goal mouth itself, narrower than the marked area.
const goalHalfWidth = SPEC.goal.innerWidth / 2;
// Outermost extent of the adjudicated region: the goal's back inner face.
// Used only for cheap bounding checks, never as a real boundary edge.
const back = FIELD.goalBackInnerFaceZ;

/**
 * Outer edge of the white marking; the line itself belongs to the area.
 *
 * The adjudicated region is a union of three parts glued end to end along
 * z, all sharing the same outer half-width until the goal narrows it:
 *  - the marked 25 cm penalty area, with its rounded front corners
 *    (unchanged, z from `front` to `penaltyBackEdgeZ`);
 *  - the 20 mm goal-line stripe immediately behind it, still as wide as the
 *    penalty area (z from `penaltyBackEdgeZ` to `playingHalfLength`, the
 *    outer edge of that stripe);
 *  - the goal interior beyond the stripe, only as wide as the goal mouth
 *    (z from `playingHalfLength` to `goalBackInnerFaceZ`).
 * The unmarked 12 cm outer lane running alongside the goal (|x| between the
 * goal mouth and the outer wall, past `playingHalfLength`) is deliberately
 * excluded: it carries no marking and is not part of the penalty area.
 */
export function insidePenalty(point: Pick<Pose, 'x' | 'z'>, end: number) {
  const x = Math.abs(point.x),
    z = point.z * end;
  if (z < front - EPS || z > back + EPS) return false;
  if (z <= FIELD.playingHalfLength + EPS) {
    if (x > halfWidth + EPS) return false;
    // The arc formula alone already covers the widened stripe: its rounded
    // corner only clips the front of the area (z < penaltyArcCenterZ), so
    // for every z from penaltyBackEdgeZ up to playingHalfLength the
    // `z >= penaltyArcCenterZ` branch is always true.
    return (
      x <= FIELD.penaltyArcCenterX ||
      z >= FIELD.penaltyArcCenterZ ||
      Math.hypot(x - FIELD.penaltyArcCenterX, z - FIELD.penaltyArcCenterZ) <=
        radius + EPS
    );
  }
  // Past the stripe: only the goal interior counts, narrower than the area.
  return x <= goalHalfWidth + EPS;
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

const goalPanelThickness = SPEC.goal.constructionPanelThickness;
type AxisRect = { minX: number; maxX: number; minZ: number; maxZ: number };
/**
 * The three solid goal panels at one end: two side panels flanking the
 * mouth and a back panel behind it. Matches the construction rectangles
 * built for ball collision in `match.ts`'s `GOAL_PANELS`, derived here from
 * the same field-spec constants rather than imported (match.ts imports
 * from this module, not the other way around).
 */
function goalPanels(end: number): AxisRect[] {
  const mouth = end * FIELD.goalMouthZ;
  const back = end * FIELD.goalBackInnerFaceZ;
  const outer = end * (FIELD.goalBackInnerFaceZ + goalPanelThickness);
  const minZ = Math.min(mouth, outer),
    maxZ = Math.max(mouth, outer);
  return [
    {
      minX: -goalHalfWidth - goalPanelThickness,
      maxX: -goalHalfWidth,
      minZ,
      maxZ,
    },
    {
      minX: goalHalfWidth,
      maxX: goalHalfWidth + goalPanelThickness,
      minZ,
      maxZ,
    },
    {
      minX: -goalHalfWidth - goalPanelThickness,
      maxX: goalHalfWidth + goalPanelThickness,
      minZ: Math.min(back, outer),
      maxZ: Math.max(back, outer),
    },
  ];
}

function rectCorners(rect: AxisRect): PointXZ[] {
  return [
    [rect.minX, rect.minZ],
    [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ],
    [rect.minX, rect.maxZ],
  ];
}
function pointInRect(p: PointXZ, rect: AxisRect, tolerance: number) {
  return (
    p[0] >= rect.minX - tolerance &&
    p[0] <= rect.maxX + tolerance &&
    p[1] >= rect.minZ - tolerance &&
    p[1] <= rect.maxZ + tolerance
  );
}
function distPointSeg(p: PointXZ, a: PointXZ, b: PointXZ) {
  const abx = b[0] - a[0],
    abz = b[1] - a[1];
  const len2 = abx * abx + abz * abz;
  let t = len2 > EPS ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t));
}
// Standard segment/segment intersection test (Cormen et al.), including the
// colinear-touching cases so a segment merely grazing another still counts.
function segmentsIntersect(a: PointXZ, b: PointXZ, c: PointXZ, d: PointXZ) {
  const cross = (o: PointXZ, p: PointXZ, q: PointXZ) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const onSegment = (p: PointXZ, q: PointXZ, r: PointXZ) =>
    Math.min(p[0], q[0]) - EPS <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) + EPS &&
    Math.min(p[1], q[1]) - EPS <= r[1] &&
    r[1] <= Math.max(p[1], q[1]) + EPS;
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d);
  if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) return true;
  if (Math.abs(d1) < EPS && onSegment(c, d, a)) return true;
  if (Math.abs(d2) < EPS && onSegment(c, d, b)) return true;
  if (Math.abs(d3) < EPS && onSegment(a, b, c)) return true;
  if (Math.abs(d4) < EPS && onSegment(a, b, d)) return true;
  return false;
}
/** Minimum distance between two closed segments; 0 if they cross or touch. */
function segmentDistance(a: PointXZ, b: PointXZ, c: PointXZ, d: PointXZ) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distPointSeg(a, c, d),
    distPointSeg(b, c, d),
    distPointSeg(c, a, b),
    distPointSeg(d, a, b),
  );
}
/**
 * Exact footprint-vs-rectangle contact: true if a footprint vertex lands
 * inside the rectangle (expanded by tolerance), a rectangle corner lands
 * inside the footprint (holes ignored — a body panel over a cutout is still
 * the robot's silhouette for contact purposes), or the closest approach
 * between any footprint edge and any rectangle edge is within tolerance.
 * An axis-aligned bounding-box test alone is not exact here: unlike the
 * outer floor walls (infinite half-planes, where the AABB gap is exact),
 * a goal panel is a small rectangle, so a yaw-rotated robot whose AABB
 * corner overlaps the panel's corner can be flagged while its actual body
 * is still centimetres away.
 */
function polygonTouchesRect(
  polygons: readonly Polygon[],
  rect: AxisRect,
  tolerance: number,
) {
  const corners = rectCorners(rect);
  for (const polygon of polygons) {
    const ring = polygon.outer;
    if (ring.some((v) => pointInRect(v, rect, tolerance))) return true;
    if (corners.some((c) => pointInRing(c, ring))) return true;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      for (let j = 0; j < corners.length; j++) {
        const c = corners[j],
          d = corners[(j + 1) % corners.length];
        if (segmentDistance(a, b, c, d) <= tolerance) return true;
      }
    }
  }
  return false;
}

/**
 * Footprint-vs-goal-panel contact. The goal is part of the field enclosure
 * (rule 2.8's "touches a wall"), so pressing against a goal post or the
 * goal's back panel counts the same as touching the outer floor wall, even
 * though `robotTouchesFieldWall` alone never fires there (the goal
 * structure stops a camping robot from ever reaching the outer wall). The
 * actual projected polygons are tested against each panel; the axis-aligned
 * body bounds only serve as a cheap early-out reject (see
 * `polygonTouchesRect` for why the AABB alone would be inexact here).
 */
export function robotTouchesGoal(
  pose: Pose,
  visual: RobotVisualId = DEFAULT_ROBOT_VISUAL_ID,
  tolerance = 0.0002,
) {
  const body = projectedBodyBounds(pose.yaw, visual);
  const minX = pose.x + body.minX,
    maxX = pose.x + body.maxX;
  const minZ = pose.z + body.minZ,
    maxZ = pose.z + body.maxZ;
  let polygons: Polygon[] | undefined;
  for (const end of [-1, 1] as const)
    for (const panel of goalPanels(end)) {
      const gapX = Math.max(panel.minX - maxX, minX - panel.maxX);
      const gapZ = Math.max(panel.minZ - maxZ, minZ - panel.maxZ);
      if (gapX > tolerance || gapZ > tolerance) continue;
      polygons ??= projectRobotFootprint(pose, visual);
      if (polygonTouchesRect(polygons, panel, tolerance)) return true;
    }
  return false;
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
    for (const x of [-halfWidth, halfWidth, -goalHalfWidth, goalHalfWidth])
      add((x - a[0]) / dx);
  if (Math.abs(dz) > EPS)
    for (const edge of [front, FIELD.playingHalfLength, back])
      add((edge - z) / dz);
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
    pose.z * end > back + bound + EPS
  )
    return false;
  const c = Math.cos(pose.yaw),
    s = Math.sin(pose.yaw);
  const transform = ([x, z]: PointXZ): PointXZ => [
    pose.x + x * c + z * s,
    pose.z - x * s + z * c,
  ];
  const polygons = robotFootprint(visual);
  // The adjudicated region is not globally convex any more: it steps in by
  // 0.1 m at playingHalfLength, where the wide stripe narrows to the goal
  // mouth. A footprint vertex can only land past that step (|x| >
  // goalHalfWidth) while still being "inside" if its z is still at or
  // before playingHalfLength, i.e. still in the wide part; the region is
  // convex within |x| <= goalHalfWidth (a single z-interval) and within
  // goalHalfWidth < |x| <= halfWidth (another single z-interval that ends
  // at the step), so a footprint spanning both — one vertex in the stripe,
  // one in the goal mouth — can have both vertices individually inside
  // while an edge between them dips out through the unmarked outer lane.
  // Guard against exactly that: split every edge at its candidate crossings
  // (the same technique `penaltyEvidenceSegments` uses to paint the body)
  // and require every resulting midpoint to still test inside, not just
  // the two endpoints.
  if (full)
    return polygons.every((p) => {
      if (!p.outer.every((v) => contains(transform(v), end))) return false;
      for (let i = 0; i < p.outer.length; i++) {
        const v = transform(p.outer[i]),
          w = transform(p.outer[(i + 1) % p.outer.length]);
        const times = crossings(v, w, end);
        for (let k = 1; k < times.length; k++)
          if (!contains(interpolate(v, w, (times[k - 1] + times[k]) / 2), end))
            return false;
      }
      return true;
    });
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
    const worldZ = (end * (front + back)) / 2 - pose.z;
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
