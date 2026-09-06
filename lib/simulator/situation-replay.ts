import type { Pose } from './types';
import type { DamageCue } from './damage-effects';

export type ReplayFrame = {
  at: number;
  actors: Record<string, Pose>;
  heights: Record<string, number>;
  score: { blue: number; yellow: number };
  elapsed: number;
  damage: DamageCue | null;
};
export type SituationReplay = {
  id: number;
  title: string;
  facts: string;
  duration: number;
  frames: ReplayFrame[];
};

/** Only render data is recorded. Nothing here can mutate or restore the engine. */
export class SituationRecorder {
  private recent: ReplayFrame[] = [];
  private serial = 0;
  last: SituationReplay | null = null;

  resetBuffer() {
    this.recent = [];
  }
  capture(frame: ReplayFrame) {
    if (this.recent.at(-1)?.at === frame.at) this.recent.pop();
    this.recent.push(structuredClone(frame));
    this.recent = this.recent
      .filter((item) => item.at >= frame.at - 8)
      .slice(-250);
  }
  seal(title: string, facts: string) {
    if (!this.recent.length) return null;
    const start = this.recent[0].at;
    const frames = this.recent.map((frame) => ({
      ...structuredClone(frame),
      at: frame.at - start,
    }));
    const duration = Math.max(1, frames.at(-1)!.at);
    if (frames.at(-1)!.at < duration)
      frames.push({ ...structuredClone(frames.at(-1)!), at: duration });
    this.last = { id: ++this.serial, title, facts, duration, frames };
    return structuredClone(this.last);
  }
  getLast() {
    return this.last ? structuredClone(this.last) : null;
  }
}

/** Recorded 30 Hz frames are discrete: removals and corrections never interpolate. */
export function sampleSituation(replay: SituationReplay, at: number) {
  const time = Math.max(0, Math.min(at, replay.duration));
  const frame =
    replay.frames.findLast((item) => item.at <= time) ?? replay.frames[0];
  return {
    ...structuredClone(frame),
    damagePlayback: {
      elapsed: frame.damage
        ? Math.max(
            0,
            time -
              (replay.frames.find(
                (item) => item.damage?.id === frame.damage!.id,
              )?.at ?? time),
          )
        : 0,
      removedFor: frame.damage?.removed
        ? Math.max(
            0,
            time -
              (replay.frames.find(
                (item) =>
                  item.damage?.id === frame.damage!.id && item.damage.removed,
              )?.at ?? time),
          )
        : 0,
    },
    ballTrail: replay.frames
      .filter((item) => item.at <= time && item.at > time - 1.5)
      .map((item) => ({ ...item.actors.ball })),
  };
}
