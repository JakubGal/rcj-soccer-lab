import type { MatchReplay, MatchReplayEvent } from '@/lib/certification/replay';

/** Lossless wire-only encoding. Deltas and implicit sequence numbers reduce
 * issue size; the verifier still receives the complete action history. */
export function packReplay(replay: MatchReplay) {
  let previousTick = 0;
  const events = replay.events.map((event) => {
    const delta = event.tick - previousTick;
    previousTick = event.tick;
    const base: unknown[] = [delta, event.op];
    switch (event.op) {
      case 'call':
        return [
          ...base,
          event.decisionKey,
          event.call.action,
          event.call.target ?? null,
        ];
      case 'choose-end':
        return [...base, event.end];
      case 'hint':
        return [...base, event.reveal];
      case 'set-robot-visual':
        return [...base, event.robotVisual];
      default:
        return base;
    }
  });
  const { claimedReport: _report, ...header } = replay;
  return { ...header, wire: 'delta-tuples-v1', events };
}

export function unpackReplay(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('wire' in value)) return value;
  const packed = value as Record<string, unknown>;
  if (
    packed.wire !== 'delta-tuples-v1' ||
    !Array.isArray(packed.events) ||
    packed.events.length > 4096
  )
    throw new Error('Unsupported game recording transport.');
  let tick = 0;
  const events = packed.events.map((tuple: unknown, seq: number) => {
    if (
      !Array.isArray(tuple) ||
      tuple.length < 2 ||
      !Number.isSafeInteger(tuple[0]) ||
      tuple[0] < 0 ||
      tuple[0] > 72000 ||
      typeof tuple[1] !== 'string'
    )
      throw new Error('Invalid compact game event.');
    tick += tuple[0];
    const op = tuple[1];
    let fields: Record<string, unknown> = {};
    let length = 2;
    switch (op) {
      case 'call':
        length = 5;
        fields = {
          decisionKey: tuple[2],
          call: {
            action: tuple[3],
            ...(tuple[4] === null ? {} : { target: tuple[4] }),
          },
        };
        break;
      case 'choose-end':
        length = 3;
        fields = { end: tuple[2] };
        break;
      case 'hint':
        length = 3;
        fields = { reveal: tuple[2] };
        break;
      case 'set-robot-visual':
        length = 3;
        fields = { robotVisual: tuple[2] };
        break;
    }
    if (tuple.length !== length) throw new Error('Invalid compact game event.');
    return { seq, tick, op, ...fields } as MatchReplayEvent;
  });
  const { wire: _wire, ...header } = packed;
  return { ...header, events };
}
