import type { MatchTeam } from './match';
import type { Pose } from './types';

const other = (team: MatchTeam): MatchTeam =>
  team === 'blue' ? 'yellow' : 'blue';
export type GoalEnd = 'blue' | 'yellow';

/** Separate seeded randomness keeps match setup independent of the drill shuffle. */
export class KickoffMeeting {
  private state: number;
  stage: 'toss' | 'winner-choice' | 'end-choice' | 'ready' = 'toss';
  winner: MatchTeam | null = null;
  choosingTeam: MatchTeam | null = null;
  firstKickoff: MatchTeam | null = null;
  blueAttackDirection: 1 | -1 = 1;

  constructor(seed: number) {
    this.state = (seed ^ 0x9e3779b9) >>> 0 || 1;
  }
  random() {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 4294967296;
  }
  toss() {
    if (this.stage !== 'toss') return false;
    this.winner = this.random() < 0.5 ? 'blue' : 'yellow';
    this.choosingTeam = this.winner;
    this.stage = 'winner-choice';
    return true;
  }
  takeKickoff() {
    if (this.stage !== 'winner-choice' || !this.winner) return false;
    this.firstKickoff = this.winner;
    this.choosingTeam = other(this.winner);
    this.stage = 'end-choice';
    return true;
  }
  chooseEnd(end: GoalEnd) {
    if (
      !['winner-choice', 'end-choice'].includes(this.stage) ||
      !this.choosingTeam ||
      !this.winner
    )
      return false;
    const direction = end === 'yellow' ? 1 : -1;
    this.blueAttackDirection = (
      this.choosingTeam === 'blue' ? direction : -direction
    ) as 1 | -1;
    this.firstKickoff ??= other(this.winner);
    this.stage = 'ready';
    return true;
  }
  snapshot() {
    return {
      stage: this.stage,
      winner: this.winner,
      choosingTeam: this.choosingTeam,
      firstKickoff: this.firstKickoff,
      blueAttackDirection: this.blueAttackDirection,
    };
  }
}

/** A conservative legal subset: own halves, clear circle, no penalty-area entry. */
export function randomKickoff(
  ids: string[],
  kickoff: MatchTeam | 'neutral',
  blueDirection: 1 | -1,
  random: () => number,
): Record<string, Pose> {
  const poses: Record<string, Pose> = { ball: { x: 0, z: 0, yaw: 0 } };
  // The kickoff team places first, followed by the defending team (§2.3).
  const teams: MatchTeam[] =
    kickoff === 'yellow' ? ['yellow', 'blue'] : ['blue', 'yellow'];
  for (const team of teams) {
    const direction = team === 'blue' ? blueDirection : -blueDirection;
    const robots = ids.filter((id) => id.startsWith(`${team}-`));
    if (random() < 0.5) robots.reverse();
    for (let index = 0; index < robots.length; index++) {
      let pose: Pose | null = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        const close = team === kickoff && index === 0;
        const candidate = {
          x: close ? (random() - 0.5) * 0.2 : (random() - 0.5) * 1.2,
          z:
            -direction *
            (close ? 0.15 + random() * 0.11 : 0.22 + random() * 0.44),
          yaw: random() * Math.PI * 2,
        };
        if (team !== kickoff && Math.hypot(candidate.x, candidate.z) < 0.405)
          continue;
        if (
          Object.entries(poses).some(
            ([id, p]) =>
              Math.hypot(p.x - candidate.x, p.z - candidate.z) <
              (id === 'ball' ? 0.126 : 0.21),
          )
        )
          continue;
        pose = candidate;
        break;
      }
      // Bounded fallback also keeps the entire footprint clear of the circle/areas.
      const fallback = [-0.48, 0.48].flatMap((x) =>
        [0.3, 0.62].map((z) => ({
          x,
          z: -direction * z,
          yaw: direction === 1 ? 0 : Math.PI,
        })),
      );
      poses[robots[index]] =
        pose ??
        fallback.find((candidate) =>
          Object.values(poses).every(
            (p) => Math.hypot(p.x - candidate.x, p.z - candidate.z) >= 0.21,
          ),
        )!;
    }
  }
  return poses;
}
