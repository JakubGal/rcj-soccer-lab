import {
  MATCH_ROBOTS,
  MATCH_STEP,
  NO_DRIVE,
  type DriveInput,
  type SoccerMatch,
} from './match';
import { RCJ_FIELD_DERIVED as FIELD } from './field-spec';
import type { Pose } from './types';
import type { TrainingTopic } from './referee-training';

const distance = (a: Pose, b: Pick<Pose, 'x' | 'z'>) =>
  Math.hypot(a.x - b.x, a.z - b.z);
/** Faults affect drive commands, never actor positions or ball momentum. */
export class ContinuousDirector {
  private delay = 4;
  private plan: {
    topic: TrainingTopic;
    robot: string;
    elapsed: number;
    reached: number;
    end: number;
    side: number;
    clearing?: boolean;
  } | null = null;
  private bag: TrainingTopic[] = [];
  constructor(
    private randomSource: { random(): number },
    private topics: readonly TrainingTopic[],
  ) {}
  private random() {
    return this.randomSource.random();
  }
  cancel() {
    this.plan = null;
    this.delay = 5;
  }
  step(match: SoccerMatch, damaged: string | null) {
    const commands: Record<string, DriveInput> = {};
    const poses = match.state.actors;
    const available = MATCH_ROBOTS.filter(
      (r) => poses[r.id] && r.id !== damaged,
    );
    let damage: string | null = null;
    if (!this.plan) {
      this.delay -= MATCH_STEP;
      if (this.delay > 0 || !available.length) return { commands, damage };
      if (!this.bag.length) {
        this.bag = this.topics.filter((t) => t !== 'other');
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      const topic = this.bag.pop();
      if (!topic) {
        this.delay = 5;
        return { commands, damage };
      }
      const robot = available[Math.floor(this.random() * available.length)];
      if (topic === 'damage') {
        // Keep at least one moving robot; a damaged robot stays damaged until removed.
        if (!damaged && available.length > 1) damage = robot.id;
        this.delay = 7 + this.random() * 5;
        return { commands, damage };
      }
      this.plan = {
        topic,
        robot: robot.id,
        elapsed: 0,
        reached: 0,
        end: poses[robot.id].z < 0 ? -1 : 1,
        side: poses[robot.id].x < 0 ? -1 : 1,
      };
    }
    const plan = this.plan;
    plan.elapsed += MATCH_STEP;
    if (!poses[plan.robot] || plan.robot === damaged || plan.elapsed > 22) {
      this.cancel();
      return { commands, damage };
    }
    const drive = (
      id: string,
      target: { x: number; z: number },
      face = poses.ball,
      kick = false,
    ) => {
      const p = poses[id];
      if (!p || id === damaged) return;
      const dx = target.x - p.x,
        dz = target.z - p.z;
      const length = Math.max(0.15, Math.hypot(dx, dz));
      const yaw = Math.atan2(face.x - p.x, face.z - p.z);
      const turn = Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw));
      commands[id] = {
        forward: (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / length,
        strafe: (dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) / length,
        turn: Math.max(-1, Math.min(1, turn * 2)),
        kick,
        dribble: true,
      };
    };
    if (plan.topic === 'out') {
      const destination = {
        x: plan.side * (FIELD.floorHalfWidth - 0.1),
        z: Math.max(-0.65, Math.min(0.65, poses[plan.robot].z)),
      };
      if (distance(poses[plan.robot], destination) < 0.012 && !plan.reached)
        plan.reached = plan.elapsed;
      // The robot touches the wall, hesitates, then drives back if the referee misses it.
      drive(
        plan.robot,
        plan.reached && plan.elapsed - plan.reached > 2.5
          ? { x: plan.side * 0.48, z: destination.z }
          : destination,
      );
      if (plan.reached && plan.elapsed - plan.reached > 4) this.cancel();
    } else if (plan.topic === 'multiple') {
      const team = plan.robot.split('-')[0];
      const ids = available.filter((r) => r.team === team).map((r) => r.id);
      if (ids.length < 2) {
        this.cancel();
        return { commands, damage };
      }
      const targets = ids.map((_, i) => ({
        x: i ? 0.14 : -0.14,
        z: plan.end * (FIELD.penaltyFrontCenterZ + 0.015),
      }));
      if (
        ids.every((id, i) => distance(poses[id], targets[i]) < 0.035) &&
        !plan.reached
      )
        plan.reached = plan.elapsed;
      ids.forEach((id, i) =>
        drive(
          id,
          plan.reached && plan.elapsed - plan.reached > 3
            ? { ...targets[i], z: plan.end * 0.55 }
            : targets[i],
        ),
      );
      if (plan.reached && plan.elapsed - plan.reached > 5) this.cancel();
    } else if (plan.topic === 'progress') {
      // Loss of drive lets the actual ball settle naturally; no artificial ball reset.
      for (const robot of available)
        commands[robot.id] = { ...NO_DRIVE, dribble: false };
      if (plan.elapsed > 13) this.cancel();
    } else {
      const robot = MATCH_ROBOTS.find((r) => r.id === plan.robot)!;
      const end = match.attackDirection(robot.team as 'blue' | 'yellow');
      const goal = { x: 0, z: end * FIELD.goalBackInnerFaceZ, yaw: 0 };
      const p = poses[plan.robot],
        ball = poses.ball;
      const defender =
        plan.topic === 'pushing'
          ? available.find((r) => r.team !== robot.team)
          : null;
      // Teammates spread out and the defense opens a lane, all through normal drives.
      for (const other of available) {
        if (other.id === plan.robot || other.id === defender?.id) continue;
        drive(other.id, {
          x: other.number === 1 ? -0.59 : 0.59,
          z: -match.attackDirection(other.team as 'blue' | 'yellow') * 0.4,
        });
      }
      // Retrieve a ball beside a goal from the open side, then dribble it
      // sideways back into reach. A direct line to the goal hits its side panel.
      if (
        Math.abs(ball.z) > 0.99 &&
        Math.abs(ball.x) > 0.3 &&
        Math.abs(ball.x) < 0.7
      )
        plan.clearing = true;
      if (plan.clearing && Math.abs(ball.z) > 0.62) {
        const endSide = Math.sign(ball.z);
        const grab = {
          x: Math.max(-0.77, Math.min(0.77, ball.x + Math.sign(ball.x) * 0.14)),
          z: Math.max(-1.108, Math.min(1.108, ball.z + endSide * 0.022)),
        };
        drive(
          plan.robot,
          distance(p, ball) < 0.17 ? { x: p.x, z: p.z - endSide * 0.35 } : grab,
          ball,
        );
        if (defender) drive(defender.id, { x: -0.15, z: end * 0.88 });
        return { commands, damage };
      }
      plan.clearing = false;
      if (defender)
        drive(defender.id, {
          x: 0,
          z: end * (FIELD.penaltyFrontCenterZ + 0.075),
        });
      const length = Math.max(0.01, distance(ball, goal));
      const dx = (goal.x - ball.x) / length,
        dz = (goal.z - ball.z) / length;
      const behind = { x: ball.x - dx * 0.145, z: ball.z - dz * 0.145 };
      const aligned = (ball.x - p.x) * dx + (ball.z - p.z) * dz > 0.08;
      let target = behind;
      if (!aligned && distance(p, ball) < 0.4)
        target = {
          x: Math.max(
            -0.74,
            Math.min(0.74, ball.x + (p.x >= ball.x ? 0.28 : -0.28)),
          ),
          z: behind.z,
        };
      const carrying = aligned && distance(p, behind) < 0.075;
      const desiredYaw = Math.atan2(goal.x - p.x, goal.z - p.z);
      const aiming =
        Math.abs(
          Math.atan2(
            Math.sin(desiredYaw - p.yaw),
            Math.cos(desiredYaw - p.yaw),
          ),
        ) < 0.12;
      drive(
        plan.robot,
        carrying ? goal : target,
        goal,
        plan.topic === 'scoring' && carrying && aiming,
      );
    }
    return { commands, damage };
  }
}
