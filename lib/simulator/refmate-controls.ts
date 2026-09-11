import type { RefereeAction, RefereeCall } from './referee-cases';

/** RefMate's two team columns, in visual row order. */
export const REFMATE_ROBOTS = [
  { id: 'blue-1', slot: 'A1', team: 'blue', label: 'Blue 1' },
  { id: 'yellow-1', slot: 'B1', team: 'yellow', label: 'Yellow 1' },
  { id: 'blue-2', slot: 'A2', team: 'blue', label: 'Blue 2' },
  { id: 'yellow-2', slot: 'B2', team: 'yellow', label: 'Yellow 2' },
] as const;

export type RefMatePenalty = 'out' | 'damaged';
export type RefMateStartSignal = 'kickoff' | 'resume';

/** Calls represented directly on the remote; all others remain separate. */
export const REFMATE_MAIN_ACTIONS: ReadonlySet<RefereeAction> = new Set([
  'goal',
  'out',
  'damaged',
  'return',
  'start',
  'pause',
  'resume',
]);

/**
 * This adapter knows operational state only, never the expected answer.
 * A benched robot can always be requested back: the engine grades an early
 * return rather than hiding it from a trainee in continuous mode.
 */
export function refMateTileCall(
  robotId: string,
  penalty: RefMatePenalty,
  bench: readonly { robot: string }[],
): RefereeCall {
  if (!REFMATE_ROBOTS.some((robot) => robot.id === robotId))
    throw new RangeError('Unknown RefMate robot.');
  if (penalty !== 'out' && penalty !== 'damaged')
    throw new RangeError('Unknown RefMate penalty.');
  return {
    action: bench.some((entry) => entry.robot === robotId) ? 'return' : penalty,
    target: robotId,
  };
}

/** Explicit referee signal, distinct from the ungraded simulator pause. */
export function refMateStartCall(signal: RefMateStartSignal): RefereeCall {
  if (signal === 'kickoff') return { action: 'start' };
  if (signal === 'resume') return { action: 'resume' };
  throw new RangeError('Unknown RefMate start signal.');
}

/**
 * One guard belongs to one critical control, not to the whole console.
 * No action is queued: a changed reason/target must start a new tap pair.
 * A short post-activation cooldown prevents a reflex tap undoing a penalty
 * when the same tile immediately changes its action to Return.
 */
export class RefMateTapGuard {
  private pending: { key: string; at: number } | null = null;
  private firedAt: number | null = null;

  activate(
    key: string,
    at: number,
    mode: 'single' | 'double',
    keyboard = false,
  ): boolean {
    if (!Number.isFinite(at)) return false;
    if (this.firedAt !== null && at - this.firedAt <= 300) return false;
    const paired =
      this.pending?.key === key &&
      at >= this.pending.at &&
      at - this.pending.at <= 300;
    if (keyboard || mode === 'single' || paired) {
      this.pending = null;
      this.firedAt = at;
      return true;
    }
    this.pending = { key, at };
    return false;
  }

  reset(): void {
    this.pending = null;
    this.firedAt = null;
  }
}
