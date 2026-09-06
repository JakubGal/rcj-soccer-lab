import type { Pose } from './types';
export type DamagePlayback = { elapsed: number; removedFor: number };

/** Cosmetic cue: a copied incident location, independent of physics and bench timers. */
export type DamageCue = {
  id: string;
  robot: string;
  position: Pose;
  removed: boolean;
};
