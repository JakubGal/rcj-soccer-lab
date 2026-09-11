import {
  RCJ_FIELD_DERIVED,
  RCJ_FIELD_SPEC_2026,
} from '../simulator/field-spec';
import {
  ACTOR_IDS,
  type Clip,
  type ReconstructionEvent,
  type TrackId,
  TRACK_LABELS,
} from './project';

/** Re-running analysis must neither duplicate nor undo a human review. */
export function mergeSuggestions(
  existing: ReconstructionEvent[],
  clipId: string,
  suggestions: ReconstructionEvent[],
): ReconstructionEvent[] {
  const kept = existing.filter(
    (e) => e.clipId !== clipId || e.status !== 'suggested',
  );
  const reviewed = new Set(kept.map((e) => e.id));
  return [...kept, ...suggestions.filter((e) => !reviewed.has(e.id))];
}

/** Deliberately proposes observations only; never awards a goal or certifies a ruling. */
export function suggestEvents(clip: Clip): ReconstructionEvent[] {
  const events: ReconstructionEvent[] = [];
  const last = new Map<string, number>();
  const emit = (
    kind: ReconstructionEvent['kind'],
    time: number,
    note: string,
    actor?: TrackId,
    team?: 'blue' | 'yellow',
  ) => {
    const key = `${kind}:${actor ?? team ?? ''}`;
    if (time - (last.get(key) ?? -Infinity) < 8) return;
    last.set(key, time);
    events.push({
      id: `${clip.id}:${kind}:${actor ?? team ?? ''}:${time.toFixed(3)}`,
      clipId: clip.id,
      time,
      kind,
      status: 'suggested',
      actor,
      team,
      note,
    });
  };
  const missing = new Map<TrackId, number>();
  for (let i = 1; i < clip.frames.length; i++) {
    const a = clip.frames[i - 1],
      b = clip.frames[i];
    for (const id of ACTOR_IDS) {
      if (!clip.seeds[id]) continue;
      if (!b.actors[id]) {
        if (!missing.has(id)) missing.set(id, b.time);
        if (b.time - missing.get(id)! >= 0.5)
          emit(
            'tracking-gap',
            missing.get(id)!,
            `${TRACK_LABELS[id]} is not reliably visible. Review or add a correction; disappearance does not prove removal or damage.`,
            id,
          );
      } else missing.delete(id);
    }
    const ball = b.actors.ball,
      previous = a.actors.ball;
    if (
      ball &&
      previous &&
      ball.confidence >= 0.7 &&
      previous.confidence >= 0.7 &&
      b.time - a.time < 0.6
    ) {
      const threshold =
        RCJ_FIELD_DERIVED.goalBackInnerFaceZ - Number(clip.ballDiameter) / 2000;
      if (
        Math.abs(ball.x) < RCJ_FIELD_SPEC_2026.goal.innerWidth / 2 &&
        Math.abs(previous.z) < threshold &&
        Math.abs(ball.z) >= threshold &&
        Math.abs(ball.z) < threshold + 0.12
      ) {
        const team =
          ball.z > 0 === clip.blueAttacksPositive ? 'blue' : 'yellow';
        emit(
          'goal',
          b.time,
          'Possible goal-back-wall contact. Check the original footage and any preceding infringement before confirming this goal.',
          undefined,
          team,
        );
      }
    }
    for (const id of ACTOR_IDS) {
      if (id === 'ball') continue;
      const p = a.actors[id],
        q = b.actors[id];
      if (!p || !q || q.confidence < 0.7) continue;
      const nearWall = (x: number, z: number) =>
        Math.abs(x) > 0.8 || Math.abs(z) > 1.12;
      if (!nearWall(p.x, p.z) && nearWall(q.x, q.z))
        emit(
          'out',
          b.time,
          'Possible wall contact, not just crossing the white line. Confirm contact and check whether an opponent pushed the robot out.',
          id,
        );
    }
  }
  return events;
}
