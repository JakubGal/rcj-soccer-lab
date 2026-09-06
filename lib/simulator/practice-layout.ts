import { MATCH_ACTORS, SoccerMatch } from './match';
import { clonePoses } from './manual-layout';
import type { Pose } from './types';

/** A new clock after full time must keep the layout the player just arranged. */
export function preparePracticeMatch(match: SoccerMatch, duration: number) {
  if (match.state.elapsed < duration && match.state.phase !== 'finished')
    return match;
  const next = new SoccerMatch();
  next.place(match.state.actors);
  return next;
}

/** Preserve a lesson arrangement while giving omitted teammates clear positions. */
export function practiceLayout(
  poses: Record<string, Pose>,
): Record<string, Pose> {
  const next = clonePoses(poses);
  next.ball ??= { x: 0, z: 0, yaw: 0 };
  for (const actor of MATCH_ACTORS) {
    if (next[actor.id]) continue;
    const spots = [-0.8, 0.8, -0.5, 0.5, 0].flatMap((z) =>
      [-0.6, 0.6, -0.3, 0.3, 0].map((x) => ({ x, z, yaw: actor.initial.yaw })),
    );
    next[actor.id] = spots.find((spot) =>
      Object.entries(next).every(
        ([id, pose]) =>
          Math.hypot(pose.x - spot.x, pose.z - spot.z) >=
          (id === 'ball' ? 0.123 : 0.205),
      ),
    ) ?? { ...actor.initial };
  }
  return next;
}
