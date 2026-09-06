import {
  RCJ_FIELD_DERIVED as FIELD,
  RCJ_FIELD_SPEC_2026 as SPEC,
  RCJ_SIMULATOR_GUIDES,
} from './field-spec';
import { moveManualActor } from './manual-layout';
import type { ActorDefinition, Pose } from './types';

export type MatchTeam = 'blue' | 'yellow';
export type TeamControl = 'manual' | 'ai' | 'off';
export type DriveInput = {
  forward: number;
  strafe: number;
  turn: number;
  kick: boolean;
  dribble: boolean;
};
export type MatchSettings = {
  controls: Record<MatchTeam, TeamControl>;
  selectedRobot: string;
  duration: number;
  referee?: boolean;
  observeReferee?: boolean;
  robotCommands?: Record<string, DriveInput>;
  disabledRobots?: string[];
};
export type MatchEvent =
  | { kind: 'goal'; team: MatchTeam }
  | { kind: 'lack-progress' };
export type MatchState = {
  actors: Record<string, Pose>;
  score: Record<MatchTeam, number>;
  elapsed: number;
  phase: 'playing' | 'goal' | 'referee' | 'finished';
  pendingEvent: MatchEvent | null;
  message: string;
  ballOwner: string | null;
  ballVelocity: { x: number; z: number };
};

export const MATCH_STEP = 1 / 120;
export const NO_DRIVE: DriveInput = {
  forward: 0,
  strafe: 0,
  turn: 0,
  kick: false,
  dribble: true,
};
const ROBOT_RADIUS = RCJ_SIMULATOR_GUIDES.robotCollisionRadius;
const BALL_RADIUS = SPEC.ball.diameter / 2;
const ATTACHMENT = ROBOT_RADIUS + BALL_RADIUS + 0.003;
const MAX_SPEED = 0.68;
const TURN_SPEED = 3.8;
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const distance = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.z - b.z);

export const MATCH_ACTORS: ActorDefinition[] = [
  {
    id: 'blue-1',
    label: 'Blue 1',
    kind: 'robot',
    team: 'blue',
    number: 1,
    poweredDribbler: true,
    initial: { x: -0.13, z: -0.34, yaw: 0 },
  },
  {
    id: 'blue-2',
    label: 'Blue 2',
    kind: 'robot',
    team: 'blue',
    number: 2,
    poweredDribbler: true,
    initial: { x: 0.24, z: -0.78, yaw: 0 },
  },
  {
    id: 'yellow-1',
    label: 'Yellow 1',
    kind: 'robot',
    team: 'yellow',
    number: 1,
    poweredDribbler: true,
    initial: { x: 0.18, z: 0.42, yaw: Math.PI },
  },
  {
    id: 'yellow-2',
    label: 'Yellow 2',
    kind: 'robot',
    team: 'yellow',
    number: 2,
    poweredDribbler: true,
    initial: { x: -0.24, z: 0.78, yaw: Math.PI },
  },
  {
    id: 'ball',
    label: 'Ball',
    kind: 'ball',
    team: 'neutral',
    initial: { x: 0, z: 0, yaw: 0 },
  },
];
export const MATCH_ROBOTS = MATCH_ACTORS.filter(
  (actor) => actor.kind === 'robot',
);

// The same solid goal panels drawn by the viewport. Live play is planar;
// ramps, ball height, and the referee's discretionary rules are not simulated.
const GOAL_PANELS = ([-1, 1] as const).flatMap((end) => {
  const mouth = end * FIELD.goalMouthZ;
  const back = end * FIELD.goalBackInnerFaceZ;
  const outer =
    end * (FIELD.goalBackInnerFaceZ + SPEC.goal.constructionPanelThickness);
  const halfWidth = SPEC.goal.innerWidth / 2;
  const thickness = SPEC.goal.constructionPanelThickness;
  return [
    {
      minX: -halfWidth - thickness,
      maxX: -halfWidth,
      minZ: Math.min(mouth, outer),
      maxZ: Math.max(mouth, outer),
    },
    {
      minX: halfWidth,
      maxX: halfWidth + thickness,
      minZ: Math.min(mouth, outer),
      maxZ: Math.max(mouth, outer),
    },
    {
      minX: -halfWidth - thickness,
      maxX: halfWidth + thickness,
      minZ: Math.min(back, outer),
      maxZ: Math.max(back, outer),
    },
  ];
});

/** Small fixed-step match model, independent of React, rendering, and wall time. */
export class SoccerMatch {
  state: MatchState;
  blueAttackDirection: 1 | -1 = 1;
  attackDirection(team: MatchTeam) {
    return team === 'blue'
      ? this.blueAttackDirection
      : -this.blueAttackDirection;
  }
  private cooldown = 0;
  private goalPause = 0;
  private kickoffTeam: MatchTeam = 'blue';
  private stalledFor = 0;
  get stationarySeconds() {
    return this.stalledFor;
  }
  private observedGoal = false;
  private ballAnchor: Pose = { x: 0, z: 0, yaw: 0 };
  private trail: Pose[] = [];
  private trailTick = 0;
  private goalEntry: -1 | 1 | null = null;
  private lastBoundaryPushers = new Map<string, string>();
  private lastTouchedBall: string | null = null;

  constructor() {
    this.state = {
      actors: Object.fromEntries(
        MATCH_ACTORS.map((actor) => [actor.id, { ...actor.initial }]),
      ),
      score: { blue: 0, yellow: 0 },
      elapsed: 0,
      phase: 'playing',
      pendingEvent: null,
      message: 'Kickoff · Blue attacks the yellow goal',
      ballOwner: null,
      ballVelocity: { x: 0, z: 0 },
    };
    this.kickoff('blue');
  }

  snapshot(): MatchState {
    return {
      ...this.state,
      actors: Object.fromEntries(
        Object.entries(this.state.actors).map(([id, pose]) => [
          id,
          { ...pose },
        ]),
      ),
      score: { ...this.state.score },
      ballVelocity: { ...this.state.ballVelocity },
      pendingEvent: this.state.pendingEvent
        ? { ...this.state.pendingEvent }
        : null,
    };
  }

  /** Opponent whose outward drive caused this robot's current wall contact. */
  opponentPusher(robot: string) {
    return this.lastBoundaryPushers.get(robot) ?? null;
  }

  /** Robot that most recently touched the ball during the last physics step. */
  get lastBallTouch() {
    return this.lastTouchedBall;
  }

  ballTrail() {
    return this.trail.map((pose) => ({ ...pose }));
  }

  /** Referee/training placements reset the physics caches as one operation. */
  place(actors: Record<string, Pose>) {
    this.heldVelocity = null;
    this.state.actors = Object.fromEntries(
      Object.entries(actors).map(([id, value]) => [id, { ...value }]),
    );
    this.state.ballOwner = null;
    this.state.ballVelocity = { x: 0, z: 0 };
    this.state.pendingEvent = null;
    this.state.phase = 'playing';
    this.goalEntry = null;
    this.observedGoal = false;
    this.goalPause = 0;
    this.cooldown = 0.35;
    this.stalledFor = 0;
    this.ballAnchor = { ...this.state.actors.ball };
    this.trail = [];
    this.lastBoundaryPushers.clear();
    this.lastTouchedBall = null;
  }

  removeRobot(id: string) {
    if (
      !MATCH_ROBOTS.some((robot) => robot.id === id) ||
      !this.state.actors[id]
    )
      return false;
    delete this.state.actors[id];
    if (this.state.ballOwner === id) this.state.ballOwner = null;
    this.releaseReferee();
    return true;
  }

  restart(team: MatchTeam | 'neutral') {
    this.place(this.state.actors);
    if (team === 'neutral') {
      for (const robot of MATCH_ROBOTS) {
        if (!this.state.actors[robot.id]) continue;
        this.state.actors[robot.id] = {
          x: robot.number === 1 ? -0.28 : 0.28,
          z: -this.attackDirection(robot.team as MatchTeam) * 0.38,
          yaw:
            this.attackDirection(robot.team as MatchTeam) === 1 ? 0 : Math.PI,
        };
      }
    } else this.kickoff(team);
    this.state.actors.ball = { x: 0, z: 0, yaw: 0 };
    this.state.message = `${team === 'neutral' ? 'Neutral' : team === 'blue' ? 'Blue' : 'Yellow'} kickoff`;
  }

  awardGoal(team: MatchTeam, restart = true) {
    this.state.score[team] += 1;
    if (restart) this.restart(team === 'blue' ? 'yellow' : 'blue');
    this.state.message = `${team === 'blue' ? 'Blue' : 'Yellow'} +1`;
  }

  private heldVelocity: { x: number; z: number } | null = null;

  /** Hold physics at its exact current pose, retaining momentum only for resume. */
  holdMotion() {
    this.heldVelocity ??= { ...this.state.ballVelocity };
    this.state.ballVelocity = { x: 0, z: 0 };
    this.state.phase = 'referee';
  }

  releaseReferee() {
    if (this.state.pendingEvent?.kind === 'lack-progress') {
      this.stalledFor = 0;
      this.ballAnchor = { ...this.state.actors.ball };
    }
    if (this.heldVelocity) this.state.ballVelocity = this.heldVelocity;
    this.heldVelocity = null;
    this.state.pendingEvent = null;
    this.state.phase = 'playing';
  }

  private kickoff(team: MatchTeam) {
    const mirror = team === 'blue' ? 1 : -1;
    for (const robot of MATCH_ROBOTS) {
      if (!this.state.actors[robot.id]) continue;
      const sourceTeam =
        mirror === 1 ? robot.team : robot.team === 'blue' ? 'yellow' : 'blue';
      const source = MATCH_ROBOTS.find(
        (actor) => actor.team === sourceTeam && actor.number === robot.number,
      )!;
      this.state.actors[robot.id] = {
        x: source.initial.x * mirror * this.blueAttackDirection,
        z: source.initial.z * mirror * this.blueAttackDirection,
        yaw: this.attackDirection(robot.team as MatchTeam) === 1 ? 0 : Math.PI,
      };
    }
    const kicker = this.state.actors[`${team}-1`] ??
      this.state.actors[`${team}-2`] ?? { x: 0, z: -mirror * 0.14 };
    this.state.actors.ball = {
      x: kicker.x,
      z: kicker.z + mirror * this.blueAttackDirection * 0.14,
      yaw: 0,
    };
    this.state.ballVelocity = { x: 0, z: 0 };
    this.state.ballOwner = null;
    this.cooldown = 0.35;
    this.stalledFor = 0;
    this.ballAnchor = { ...this.state.actors.ball };
    this.trail = [];
    this.goalEntry = null;
  }

  private aiInput(robot: ActorDefinition, striker: string): DriveInput {
    const pose = this.state.actors[robot.id];
    const ball = this.state.actors.ball;
    const direction = this.attackDirection(robot.team as MatchTeam);
    const goal = {
      x: -ball.x * 0.12,
      z: direction * FIELD.goalBackInnerFaceZ,
      yaw: 0,
    };
    let target: Pose;
    let desiredYaw = Math.atan2(ball.x - pose.x, ball.z - pose.z);
    let kick = false;
    if (robot.id !== striker) {
      target = {
        x: clamp(ball.x * 0.65, -0.48, 0.48),
        z: -direction * 0.76,
        yaw: 0,
      };
      if (ball.z * direction < -0.58 && distance(pose, ball) < 0.32) {
        target = { x: ball.x, z: ball.z - direction * 0.1, yaw: 0 };
        desiredYaw = Math.atan2(goal.x - pose.x, goal.z - pose.z);
        kick = true;
      }
    } else {
      const goalDistance = distance(ball, goal);
      const dx = (goal.x - ball.x) / goalDistance;
      const dz = (goal.z - ball.z) / goalDistance;
      const behind = { x: ball.x - dx * 0.14, z: ball.z - dz * 0.14, yaw: 0 };
      const aligned = (ball.x - pose.x) * dx + (ball.z - pose.z) * dz > 0.07;
      target = behind;
      // Go around the ball when approaching from the goal side.
      if (!aligned && distance(pose, ball) < 0.42) {
        const side = pose.x >= ball.x ? 1 : -1;
        target = {
          x: clamp(ball.x + side * 0.28, -0.72, 0.72),
          z: behind.z,
          yaw: 0,
        };
      }
      if (
        (aligned && distance(pose, behind) < 0.09) ||
        this.state.ballOwner === robot.id
      ) {
        target = goal;
        desiredYaw = Math.atan2(goal.x - pose.x, goal.z - pose.z);
        kick =
          distance(pose, ball) < 0.17 &&
          Math.abs(angle(desiredYaw - pose.yaw)) < 0.18;
      }
    }
    target.x = clamp(target.x, -0.76, 0.76);
    target.z = clamp(target.z, -0.96, 0.96);
    let vx = (target.x - pose.x) * 3;
    let vz = (target.z - pose.z) * 3;
    // Steer around other robots before the swept collision solver stops us.
    for (const other of MATCH_ROBOTS) {
      if (other.id === robot.id) continue;
      const obstacle = this.state.actors[other.id];
      if (!obstacle) continue;
      const dx = pose.x - obstacle.x;
      const dz = pose.z - obstacle.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.3 && length > 0) {
        const force = (0.3 - length) * 5;
        vx += (dx / length) * force;
        vz += (dz / length) * force;
      }
    }
    const magnitude = Math.max(1, Math.hypot(vx, vz) / MAX_SPEED);
    vx /= magnitude * MAX_SPEED;
    vz /= magnitude * MAX_SPEED;
    return {
      forward: vx * Math.sin(pose.yaw) + vz * Math.cos(pose.yaw),
      strafe: vx * Math.cos(pose.yaw) - vz * Math.sin(pose.yaw),
      turn: clamp((angle(desiredYaw - pose.yaw) * 3) / TURN_SPEED, -1, 1),
      kick,
      dribble: true,
    };
  }

  private observeBoundaryPushes(
    activeRobots: ActorDefinition[],
    intendedVelocities: Record<string, { x: number; z: number }>,
  ) {
    this.lastBoundaryPushers.clear();
    const limitX = FIELD.floorHalfWidth - ROBOT_RADIUS;
    const limitZ = FIELD.floorHalfLength - ROBOT_RADIUS;
    for (const victim of activeRobots) {
      const pose = this.state.actors[victim.id];
      const walls = [
        { gap: limitX - pose.x, x: 1, z: 0 },
        { gap: limitX + pose.x, x: -1, z: 0 },
        { gap: limitZ - pose.z, x: 0, z: 1 },
        { gap: limitZ + pose.z, x: 0, z: -1 },
      ].sort((first, second) => first.gap - second.gap);
      const wall = walls[0];
      if (wall.gap > 0.0002) continue;

      const victimVelocity = intendedVelocities[victim.id] ?? { x: 0, z: 0 };
      const victimOutward =
        victimVelocity.x * wall.x + victimVelocity.z * wall.z;
      let strongest: { id: string; pressure: number } | null = null;
      for (const candidate of activeRobots) {
        if (candidate.team === victim.team) continue;
        const pusher = this.state.actors[candidate.id];
        const deltaX = pose.x - pusher.x;
        const deltaZ = pose.z - pusher.z;
        const separation = Math.hypot(deltaX, deltaZ);
        if (separation > ROBOT_RADIUS * 2 + 0.0005) continue;

        // The opponent must be behind the boundary robot and actively drive
        // through it toward the wall. Nearby or tangential contact is not a push.
        const outwardAlignment = deltaX * wall.x + deltaZ * wall.z;
        const lateralAlignment = Math.abs(deltaX * wall.z - deltaZ * wall.x);
        if (
          outwardAlignment < ROBOT_RADIUS * 1.45 ||
          lateralAlignment > ROBOT_RADIUS * 0.8
        )
          continue;
        const velocity = intendedVelocities[candidate.id] ?? { x: 0, z: 0 };
        const pusherOutward = velocity.x * wall.x + velocity.z * wall.z;
        const pressure = pusherOutward - victimOutward;
        if (pusherOutward < 0.08 || pressure < 0.06) continue;
        if (!strongest || pressure > strongest.pressure)
          strongest = { id: candidate.id, pressure };
      }
      if (strongest) this.lastBoundaryPushers.set(victim.id, strongest.id);
    }
  }

  private constrainBall(previous: Pose, keepMoving = false): MatchTeam | null {
    let scored: MatchTeam | null = null;
    const ball = this.state.actors.ball;
    const velocity = this.state.ballVelocity;
    const clearWidth = SPEC.goal.innerWidth / 2 - BALL_RADIUS;
    for (const end of [-1, 1] as const) {
      if (
        previous.z * end < FIELD.goalMouthZ &&
        ball.z * end >= FIELD.goalMouthZ
      ) {
        const t = (end * FIELD.goalMouthZ - previous.z) / (ball.z - previous.z);
        const entryX = previous.x + (ball.x - previous.x) * t;
        if (Math.abs(entryX) <= clearWidth) this.goalEntry = end;
      }
    }
    if (
      this.goalEntry &&
      (ball.z * this.goalEntry < FIELD.goalMouthZ - BALL_RADIUS ||
        Math.abs(ball.x) > SPEC.goal.innerWidth / 2)
    )
      this.goalEntry = null;
    // Crossing from behind the goal must hit the outside panel, never score.
    if (
      this.goalEntry &&
      ball.z * this.goalEntry > 0 &&
      previous.z * this.goalEntry < FIELD.goalBackContactBallCenterZ &&
      Math.abs(ball.x) <= clearWidth &&
      Math.abs(ball.z) >= FIELD.goalBackContactBallCenterZ &&
      Math.abs(ball.z) < FIELD.goalBackInnerFaceZ + BALL_RADIUS
    ) {
      scored = ball.z * this.blueAttackDirection > 0 ? 'blue' : 'yellow';
      if (!keepMoving) return scored;
    }
    const width = FIELD.floorHalfWidth - BALL_RADIUS;
    const length = FIELD.floorHalfLength - BALL_RADIUS;
    if (Math.abs(ball.x) > width) {
      ball.x = clamp(ball.x, -width, width);
      velocity.x = -Math.sign(ball.x) * Math.abs(velocity.x) * 0.65;
    }
    if (Math.abs(ball.z) > length) {
      ball.z = clamp(ball.z, -length, length);
      velocity.z = -Math.sign(ball.z) * Math.abs(velocity.z) * 0.65;
    }
    for (const panel of GOAL_PANELS) {
      // Sweep the full displacement, including robot pushes, against each
      // expanded panel. Resolve the entry face even if the endpoint is inside
      // or beyond the solid panel (nearest-face correction could tunnel).
      const motionX = ball.x - previous.x;
      const motionZ = ball.z - previous.z;
      let enter = -Infinity;
      let leave = Infinity;
      let normalX = 0;
      let normalZ = 0;
      for (const axis of [
        {
          from: previous.x,
          delta: motionX,
          min: panel.minX - BALL_RADIUS,
          max: panel.maxX + BALL_RADIUS,
          x: 1,
          z: 0,
        },
        {
          from: previous.z,
          delta: motionZ,
          min: panel.minZ - BALL_RADIUS,
          max: panel.maxZ + BALL_RADIUS,
          x: 0,
          z: 1,
        },
      ]) {
        if (Math.abs(axis.delta) < 1e-12) {
          if (axis.from < axis.min || axis.from > axis.max) {
            leave = -Infinity;
            break;
          }
          continue;
        }
        const first = (axis.min - axis.from) / axis.delta;
        const second = (axis.max - axis.from) / axis.delta;
        const near = Math.min(first, second);
        if (near > enter) {
          enter = near;
          normalX = -Math.sign(axis.delta) * axis.x;
          normalZ = -Math.sign(axis.delta) * axis.z;
        }
        leave = Math.min(leave, Math.max(first, second));
      }
      if (enter >= -1e-9 && enter <= 1 && enter <= leave) {
        ball.x = previous.x + motionX * Math.max(0, enter) + normalX * 1e-7;
        ball.z = previous.z + motionZ * Math.max(0, enter) + normalZ * 1e-7;
        const inward = velocity.x * normalX + velocity.z * normalZ;
        if (inward < 0) {
          velocity.x -= 1.65 * inward * normalX;
          velocity.z -= 1.65 * inward * normalZ;
        }
        this.state.ballOwner = null;
      }
      const closestX = clamp(ball.x, panel.minX, panel.maxX);
      const closestZ = clamp(ball.z, panel.minZ, panel.maxZ);
      const dx = ball.x - closestX;
      const dz = ball.z - closestZ;
      const length = Math.hypot(dx, dz);
      if (length >= BALL_RADIUS) continue;
      let nx = length > 1e-9 ? dx / length : 0;
      let nz = length > 1e-9 ? dz / length : 0;
      let penetration = BALL_RADIUS - length;
      if (length < 1e-9) {
        const edges = [
          { d: ball.x - panel.minX, x: -1, z: 0 },
          { d: panel.maxX - ball.x, x: 1, z: 0 },
          { d: ball.z - panel.minZ, x: 0, z: -1 },
          { d: panel.maxZ - ball.z, x: 0, z: 1 },
        ].sort((a, b) => a.d - b.d);
        nx = edges[0].x;
        nz = edges[0].z;
        penetration = BALL_RADIUS + edges[0].d;
      }
      ball.x += nx * penetration;
      ball.z += nz * penetration;
      const inward = velocity.x * nx + velocity.z * nz;
      if (inward < 0) {
        velocity.x -= 1.65 * inward * nx;
        velocity.z -= 1.65 * inward * nz;
      }
      this.state.ballOwner = null;
    }
    return scored;
  }

  step(settings: MatchSettings, manualInput: DriveInput = NO_DRIVE) {
    if (settings.observeReferee) {
      this.state.pendingEvent = null;
      if (Math.abs(this.state.actors.ball.z) < FIELD.goalMouthZ - 0.03)
        this.observedGoal = false;
    }
    const dt = MATCH_STEP;
    if (this.state.phase === 'finished' || this.state.phase === 'referee')
      return;
    if (this.state.phase === 'goal') {
      this.goalPause -= dt;
      if (this.goalPause <= 0) {
        this.kickoff(this.kickoffTeam);
        this.state.phase = 'playing';
        this.state.message = `${this.kickoffTeam === 'blue' ? 'Blue' : 'Yellow'} kickoff`;
      }
      return;
    }
    this.lastBoundaryPushers.clear();
    this.lastTouchedBall = null;
    this.state.elapsed = Math.min(settings.duration, this.state.elapsed + dt);
    if (this.state.elapsed >= settings.duration) {
      this.state.phase = 'finished';
      const { blue, yellow } = this.state.score;
      this.state.message =
        blue === yellow
          ? 'Full time · Draw'
          : `Full time · ${blue > yellow ? 'Blue' : 'Yellow'} wins`;
      this.state.ballOwner = null;
      this.state.ballVelocity = { x: 0, z: 0 };
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    const activeRobots = MATCH_ROBOTS.filter(
      (robot) => this.state.actors[robot.id],
    );
    const ball = this.state.actors.ball;
    const strikers = {} as Record<MatchTeam, string>;
    for (const team of ['blue', 'yellow'] as const) {
      const robots = activeRobots.filter(
        (robot) =>
          robot.team === team && !settings.disabledRobots?.includes(robot.id),
      );
      strikers[team] =
        settings.controls[team] === 'manual' &&
        robots.some((robot) => robot.id === settings.selectedRobot)
          ? settings.selectedRobot
          : ([...robots].sort(
              (a, b) =>
                distance(this.state.actors[a.id], ball) -
                distance(this.state.actors[b.id], ball),
            )[0]?.id ?? '');
    }
    const commands: Record<string, DriveInput> = {};
    const velocities: Record<string, { x: number; z: number }> = {};
    const intendedVelocities: Record<string, { x: number; z: number }> = {};
    for (const robot of activeRobots) {
      if (settings.disabledRobots?.includes(robot.id)) {
        commands[robot.id] = { ...NO_DRIVE, dribble: false };
        velocities[robot.id] = { x: 0, z: 0 };
        intendedVelocities[robot.id] = { x: 0, z: 0 };
        continue;
      }
      const team = robot.team as MatchTeam;
      const control = settings.controls[team];
      const command =
        control === 'off' || settings.disabledRobots?.includes(robot.id)
          ? { ...NO_DRIVE, dribble: false }
          : control === 'manual' && robot.id === settings.selectedRobot
            ? manualInput
            : this.aiInput(robot, strikers[team]);
      // A manual team's unselected striker waits; its teammate defends.
      if (
        control === 'manual' &&
        !settings.selectedRobot.startsWith(team) &&
        robot.id === strikers[team]
      ) {
        commands[robot.id] = { ...NO_DRIVE, dribble: false };
      } else {
        commands[robot.id] = settings.robotCommands?.[robot.id] ?? command;
      }
      const input = commands[robot.id];
      const pose = this.state.actors[robot.id];
      const yaw = angle(pose.yaw + clamp(input.turn, -1, 1) * TURN_SPEED * dt);
      const scale =
        MAX_SPEED / Math.max(1, Math.hypot(input.forward, input.strafe));
      const vx =
        (Math.sin(yaw) * input.forward + Math.cos(yaw) * input.strafe) * scale;
      const vz =
        (Math.cos(yaw) * input.forward - Math.sin(yaw) * input.strafe) * scale;
      intendedVelocities[robot.id] = { x: vx, z: vz };
      const next = moveManualActor(activeRobots, this.state.actors, robot.id, {
        x: pose.x + vx * dt,
        z: pose.z + vz * dt,
      })!;
      velocities[robot.id] = {
        x: (next.x - pose.x) / dt,
        z: (next.z - pose.z) / dt,
      };
      this.state.actors[robot.id] = { ...next, yaw };
    }
    this.observeBoundaryPushes(activeRobots, intendedVelocities);
    this.state.ballOwner = null;
    for (const robot of activeRobots) {
      const pose = this.state.actors[robot.id];
      const input = commands[robot.id];
      const dx = ball.x - pose.x;
      const dz = ball.z - pose.z;
      const forward = dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw);
      const lateral = dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw);
      const inReach =
        forward > 0.075 && forward < 0.17 && Math.abs(lateral) < 0.065;
      if (inReach && input.kick && this.cooldown <= 0) {
        this.state.ballVelocity = {
          x: Math.sin(pose.yaw) * 3,
          z: Math.cos(pose.yaw) * 3,
        };
        this.lastTouchedBall = robot.id;
        this.cooldown = 0.32;
        break;
      }
      const challenged = activeRobots.some(
        (other) =>
          other.team !== robot.team &&
          distance(this.state.actors[other.id], ball) < 0.145,
      );
      if (
        inReach &&
        input.dribble &&
        this.cooldown <= 0 &&
        !challenged &&
        Math.hypot(this.state.ballVelocity.x, this.state.ballVelocity.z) < 1.8
      ) {
        const targetX = pose.x + Math.sin(pose.yaw) * ATTACHMENT;
        const targetZ = pose.z + Math.cos(pose.yaw) * ATTACHMENT;
        this.state.ballVelocity = {
          x: velocities[robot.id].x + (targetX - ball.x) * 18,
          z: velocities[robot.id].z + (targetZ - ball.z) * 18,
        };
        this.state.ballOwner = robot.id;
        this.lastTouchedBall = robot.id;
        break;
      }
    }
    const velocity = this.state.ballVelocity;
    const previousBall = { ...ball };
    // Bound shot speed; swept panel collisions also handle contact corrections.
    const velocityScale = Math.max(1, Math.hypot(velocity.x, velocity.z) / 3.2);
    velocity.x /= velocityScale;
    velocity.z /= velocityScale;
    ball.x += velocity.x * dt;
    ball.z += velocity.z * dt;
    ball.yaw += (Math.hypot(velocity.x, velocity.z) * dt) / BALL_RADIUS;
    velocity.x *= Math.exp(-0.85 * dt);
    velocity.z *= Math.exp(-0.85 * dt);
    for (let pass = 0; pass < 3; pass += 1) {
      for (const robot of activeRobots) {
        const pose = this.state.actors[robot.id];
        const dx = ball.x - pose.x;
        const dz = ball.z - pose.z;
        const length = Math.hypot(dx, dz);
        if (length >= ROBOT_RADIUS + BALL_RADIUS) continue;
        this.lastTouchedBall = robot.id;
        const nx = length > 1e-9 ? dx / length : Math.sin(pose.yaw);
        const nz = length > 1e-9 ? dz / length : Math.cos(pose.yaw);
        const correction = ROBOT_RADIUS + BALL_RADIUS - length;
        ball.x += nx * correction;
        ball.z += nz * correction;
        const inward =
          (velocity.x - velocities[robot.id].x) * nx +
          (velocity.z - velocities[robot.id].z) * nz;
        if (inward < 0) {
          velocity.x -= 1.35 * inward * nx;
          velocity.z -= 1.35 * inward * nz;
        }
      }
      const scored = this.constrainBall(previousBall, settings.observeReferee);
      if (scored) {
        if (settings.observeReferee) {
          if (!this.observedGoal)
            this.state.pendingEvent = { kind: 'goal', team: scored };
          this.observedGoal = true;
          continue;
        }
        if (settings.referee) {
          this.state.phase = 'referee';
          this.state.pendingEvent = { kind: 'goal', team: scored };
          this.state.ballOwner = null;
          this.state.ballVelocity = { x: 0, z: 0 };
          this.state.message = 'Back-wall contact · referee decision';
          return;
        }
        this.state.score[scored] += 1;
        this.state.phase = 'goal';
        this.state.message = `Goal · ${scored === 'blue' ? 'Blue' : 'Yellow'} scores!`;
        this.state.ballOwner = null;
        this.state.ballVelocity = { x: 0, z: 0 };
        this.goalPause = 1.8;
        this.kickoffTeam = scored === 'blue' ? 'yellow' : 'blue';
        return;
      }
    }
    this.trailTick += 1;
    if (this.trailTick % 6 === 0) {
      this.trail.push({ ...ball });
      this.trail = this.trail.slice(-30);
    }
    if (distance(ball, this.ballAnchor) > 0.07) {
      this.stalledFor = 0;
      this.ballAnchor = { ...ball };
    } else {
      this.stalledFor += dt;
    }
    if (
      this.stalledFor > 8 &&
      (settings.controls.blue === 'ai' || settings.controls.yellow === 'ai')
    ) {
      if (settings.observeReferee) {
        this.state.pendingEvent ??= { kind: 'lack-progress' };
        return;
      }
      if (settings.referee) {
        this.state.phase = 'referee';
        this.state.pendingEvent = { kind: 'lack-progress' };
        this.state.message = 'Stationary contest · referee assessment';
        return;
      }
      this.kickoffTeam = this.kickoffTeam === 'blue' ? 'yellow' : 'blue';
      this.kickoff(this.kickoffTeam);
      this.state.message = 'Stalled play · Ball reset for kickoff';
    }
  }
}
