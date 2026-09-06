import {
  RCJ_FIELD_DERIVED,
  RCJ_FIELD_SPEC_2026,
  RCJ_SIMULATOR_GUIDES,
} from './field-spec';
import type { ActorDefinition, Pose } from './types';

const EPSILON = 1e-9;
const SWEEP_MARGIN = 1e-6;
const MAX_SLIDE_PASSES = 4;

/**
 * The ball may enter an open dribbler mouth, so its robot clearance follows
 * the visible chassis radius rather than the conservative robot/robot circle.
 */
export const MANUAL_ROBOT_BALL_CENTER_DISTANCE = 0.106;

export function clonePoses(poses: Record<string, Pose>) {
  return Object.fromEntries(
    Object.entries(poses).map(([id, actorPose]) => [id, { ...actorPose }]),
  );
}

function actorRadius(actor: ActorDefinition) {
  return actor.kind === 'ball'
    ? RCJ_FIELD_SPEC_2026.ball.diameter / 2
    : RCJ_SIMULATOR_GUIDES.robotCollisionRadius;
}

export function manualActorSeparation(
  first: ActorDefinition,
  second: ActorDefinition,
) {
  if (first.kind === 'robot' && second.kind === 'robot') {
    return RCJ_SIMULATOR_GUIDES.robotCollisionRadius * 2;
  }
  return MANUAL_ROBOT_BALL_CENTER_DISTANCE;
}

function clampToField(
  actor: ActorDefinition,
  position: { x: number; z: number },
) {
  const radius = actorRadius(actor);
  const maximumX = RCJ_FIELD_DERIVED.floorHalfWidth - radius;
  const maximumZ = RCJ_FIELD_DERIVED.floorHalfLength - radius;
  return {
    x: Math.min(maximumX, Math.max(-maximumX, position.x)),
    z: Math.min(maximumZ, Math.max(-maximumZ, position.z)),
  };
}

type SweepHit = {
  time: number;
  normalX: number;
  normalZ: number;
};

type StaticRect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const GOAL_PANEL_RECTS: StaticRect[] = ([-1, 1] as const).flatMap((end) => {
  const panel = RCJ_FIELD_SPEC_2026.goal.constructionPanelThickness;
  const halfInnerWidth = RCJ_FIELD_SPEC_2026.goal.innerWidth / 2;
  const mouthZ = end * RCJ_FIELD_DERIVED.goalMouthZ;
  const sideEndZ =
    end *
    (RCJ_FIELD_DERIVED.goalMouthZ +
      RCJ_FIELD_SPEC_2026.goal.innerDepth +
      panel);
  const backInnerZ = end * RCJ_FIELD_DERIVED.goalBackInnerFaceZ;
  const backOuterZ = end * (RCJ_FIELD_DERIVED.goalBackInnerFaceZ + panel);
  const sideMinZ = Math.min(mouthZ, sideEndZ);
  const sideMaxZ = Math.max(mouthZ, sideEndZ);
  return [
    {
      minX: -halfInnerWidth - panel,
      maxX: -halfInnerWidth,
      minZ: sideMinZ,
      maxZ: sideMaxZ,
    },
    {
      minX: halfInnerWidth,
      maxX: halfInnerWidth + panel,
      minZ: sideMinZ,
      maxZ: sideMaxZ,
    },
    {
      minX: -halfInnerWidth - panel,
      maxX: halfInnerWidth + panel,
      minZ: Math.min(backInnerZ, backOuterZ),
      maxZ: Math.max(backInnerZ, backOuterZ),
    },
  ];
});

function sweepExpandedRect(
  start: { x: number; z: number },
  end: { x: number; z: number },
  rect: StaticRect,
  radius: number,
): SweepHit | null {
  const minX = rect.minX - radius;
  const maxX = rect.maxX + radius;
  const minZ = rect.minZ - radius;
  const maxZ = rect.maxZ + radius;
  const velocityX = end.x - start.x;
  const velocityZ = end.z - start.z;
  const inside =
    start.x >= minX - EPSILON &&
    start.x <= maxX + EPSILON &&
    start.z >= minZ - EPSILON &&
    start.z <= maxZ + EPSILON;

  if (inside) {
    const nearestFace = [
      { distance: Math.abs(start.x - minX), normalX: -1, normalZ: 0 },
      { distance: Math.abs(maxX - start.x), normalX: 1, normalZ: 0 },
      { distance: Math.abs(start.z - minZ), normalX: 0, normalZ: -1 },
      { distance: Math.abs(maxZ - start.z), normalX: 0, normalZ: 1 },
    ].sort((first, second) => first.distance - second.distance)[0];
    if (
      velocityX * nearestFace.normalX + velocityZ * nearestFace.normalZ >=
      0
    ) {
      return null;
    }
    return {
      time: 0,
      normalX: nearestFace.normalX,
      normalZ: nearestFace.normalZ,
    };
  }

  let enterTime = 0;
  let exitTime = 1;
  let enterNormalX = 0;
  let enterNormalZ = 0;
  for (const axis of [
    { start: start.x, velocity: velocityX, min: minX, max: maxX, x: true },
    { start: start.z, velocity: velocityZ, min: minZ, max: maxZ, x: false },
  ]) {
    if (Math.abs(axis.velocity) < EPSILON) {
      if (axis.start < axis.min || axis.start > axis.max) return null;
      continue;
    }
    const firstTime = (axis.min - axis.start) / axis.velocity;
    const secondTime = (axis.max - axis.start) / axis.velocity;
    const axisEnter = Math.min(firstTime, secondTime);
    const axisExit = Math.max(firstTime, secondTime);
    if (axisEnter > enterTime) {
      enterTime = axisEnter;
      const direction = axis.velocity > 0 ? -1 : 1;
      enterNormalX = axis.x ? direction : 0;
      enterNormalZ = axis.x ? 0 : direction;
    }
    exitTime = Math.min(exitTime, axisExit);
    if (enterTime > exitTime) return null;
  }

  if (enterTime < 0 || enterTime > 1 || exitTime < 0) return null;
  return {
    time: enterTime,
    normalX: enterNormalX,
    normalZ: enterNormalZ,
  };
}

function firstSweepHit(
  movingActor: ActorDefinition,
  actors: ActorDefinition[],
  poses: Record<string, Pose>,
  start: { x: number; z: number },
  end: { x: number; z: number },
): SweepHit | null {
  const velocityX = end.x - start.x;
  const velocityZ = end.z - start.z;
  const speedSquared = velocityX ** 2 + velocityZ ** 2;
  if (speedSquared < EPSILON) return null;

  let earliest: SweepHit | null = null;
  for (const obstacleActor of actors) {
    if (obstacleActor.id === movingActor.id) continue;
    const obstacle = poses[obstacleActor.id];
    if (!obstacle) continue;

    const separation = manualActorSeparation(movingActor, obstacleActor);
    const relativeX = start.x - obstacle.x;
    const relativeZ = start.z - obstacle.z;
    const approach = relativeX * velocityX + relativeZ * velocityZ;
    const clearance = relativeX ** 2 + relativeZ ** 2 - separation ** 2;

    // When already touching, outward and tangential moves are always safe.
    if (clearance <= EPSILON) {
      if (approach >= 0) continue;
      const distance = Math.hypot(relativeX, relativeZ);
      const hit = {
        time: 0,
        normalX: distance > EPSILON ? relativeX / distance : 1,
        normalZ: distance > EPSILON ? relativeZ / distance : 0,
      };
      if (!earliest || hit.time < earliest.time) earliest = hit;
      continue;
    }

    const discriminant = approach ** 2 - speedSquared * clearance;
    if (discriminant < 0) continue;
    const hitTime = (-approach - Math.sqrt(discriminant)) / speedSquared;
    if (hitTime < 0 || hitTime > 1) continue;
    const contactX = start.x + velocityX * hitTime;
    const contactZ = start.z + velocityZ * hitTime;
    const normalLength = Math.hypot(
      contactX - obstacle.x,
      contactZ - obstacle.z,
    );
    const hit = {
      time: hitTime,
      normalX:
        normalLength > EPSILON ? (contactX - obstacle.x) / normalLength : 1,
      normalZ:
        normalLength > EPSILON ? (contactZ - obstacle.z) / normalLength : 0,
    };
    if (!earliest || hit.time < earliest.time) earliest = hit;
  }

  const radius = actorRadius(movingActor);
  for (const panel of GOAL_PANEL_RECTS) {
    const hit = sweepExpandedRect(start, end, panel, radius);
    if (hit && (!earliest || hit.time < earliest.time)) earliest = hit;
  }
  return earliest;
}

/**
 * Moves one selected actor while all other actors remain fixed. Continuous
 * circle sweeps prevent a fast pointer movement from tunnelling through an
 * obstacle; the remaining movement slides along the first contacted body.
 */
export function moveManualActor(
  actors: ActorDefinition[],
  poses: Record<string, Pose>,
  actorId: string,
  requested: { x: number; z: number },
  options: {
    /** Optional body-aware field clamp; the default remains the guide circle. */
    fieldClamp?: (position: { x: number; z: number }) => {
      x: number;
      z: number;
    };
  } = {},
): Pose | null {
  const movingActor = actors.find((actor) => actor.id === actorId);
  const current = poses[actorId];
  if (!movingActor || !current) return null;

  const fieldClamp =
    movingActor.kind === 'robot' && options.fieldClamp
      ? options.fieldClamp
      : (position: { x: number; z: number }) =>
          clampToField(movingActor, position);
  let start = { x: current.x, z: current.z };
  let end = fieldClamp(requested);
  let result = start;
  const initialDistances = new Map(
    actors
      .filter((actor) => actor.id !== movingActor.id && poses[actor.id])
      .map((actor) => {
        const obstacle = poses[actor.id];
        return [
          actor.id,
          Math.hypot(current.x - obstacle.x, current.z - obstacle.z),
        ] as const;
      }),
  );

  for (let pass = 0; pass < MAX_SLIDE_PASSES; pass += 1) {
    const hit = firstSweepHit(movingActor, actors, poses, start, end);
    if (!hit) {
      result = end;
      break;
    }

    const velocityX = end.x - start.x;
    const velocityZ = end.z - start.z;
    const contactX = start.x + velocityX * hit.time;
    const contactZ = start.z + velocityZ * hit.time;
    const { normalX, normalZ } = hit;

    result = { x: contactX, z: contactZ };
    const remainingX = end.x - contactX;
    const remainingZ = end.z - contactZ;
    const inward = Math.min(0, remainingX * normalX + remainingZ * normalZ);
    const slideX = remainingX - normalX * inward;
    const slideZ = remainingZ - normalZ * inward;
    if (slideX ** 2 + slideZ ** 2 < EPSILON) break;

    start = fieldClamp({
      x: contactX + normalX * SWEEP_MARGIN,
      z: contactZ + normalZ * SWEEP_MARGIN,
    });
    end = fieldClamp({
      x: start.x + slideX,
      z: start.z + slideZ,
    });
    result = start;
  }

  // Correct only tiny numerical penetration left by chained slide contacts.
  for (let pass = 0; pass < 8; pass += 1) {
    let corrected = false;
    for (const obstacleActor of actors) {
      if (obstacleActor.id === movingActor.id) continue;
      const obstacle = poses[obstacleActor.id];
      if (!obstacle) continue;
      const separation = manualActorSeparation(movingActor, obstacleActor);
      const deltaX = result.x - obstacle.x;
      const deltaZ = result.z - obstacle.z;
      const distance = Math.hypot(deltaX, deltaZ);
      if (distance >= separation - SWEEP_MARGIN) continue;
      const initialDistance = initialDistances.get(obstacleActor.id);
      if (
        initialDistance !== undefined &&
        initialDistance < separation - SWEEP_MARGIN &&
        distance >= initialDistance - SWEEP_MARGIN
      ) {
        continue;
      }
      const normalX = distance > EPSILON ? deltaX / distance : 1;
      const normalZ = distance > EPSILON ? deltaZ / distance : 0;
      result = fieldClamp({
        x: obstacle.x + normalX * separation,
        z: obstacle.z + normalZ * separation,
      });
      corrected = true;
    }
    if (!corrected) break;
  }

  return { ...current, ...result };
}
