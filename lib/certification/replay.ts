import { REFEREE_ACTIONS, type RefereeCall } from '../simulator/referee-cases';
import { RefereeMatch } from '../simulator/referee-match';
import {
  TRAINING_TOPICS,
  type TrainingMode,
  type TrainingTopic,
} from '../simulator/referee-training';
import { isRobotVisualId, type RobotVisualId } from '../simulator/robot-models';
import { CERTIFICATION_ENGINE_VERSION } from './versions';

export const MATCH_REPLAY_SCHEMA = 'rcj-match-replay/v1' as const;
export const MATCH_REPLAY_ENGINE_VERSION = CERTIFICATION_ENGINE_VERSION;
export const MATCH_REPLAY_TICK_RATE = 120 as const;
export const MATCH_REPLAY_DURATION_SECONDS = 600 as const;
export const MATCH_REPLAY_DURATION_TICKS =
  MATCH_REPLAY_DURATION_SECONDS * MATCH_REPLAY_TICK_RATE;
export const MAX_MATCH_REPLAY_EVENTS = 4_096 as const;
export const MAX_MATCH_REPLAY_JSON_BYTES = 512 * 1_024;

export type MatchReplayReport = {
  correct: number;
  wrong: number;
  missed: number;
  assisted: number;
  assessed: number;
  accuracy: number | null;
};

export type MatchReplayOperation =
  | { op: 'toss' }
  | { op: 'take-kickoff' }
  | { op: 'choose-end'; end: 'blue' | 'yellow' }
  | { op: 'pause' }
  | { op: 'resume' }
  | { op: 'whistle' }
  | { op: 'next-case' }
  | { op: 'arrange-kickoff' }
  | { op: 'resume-evidence' }
  | { op: 'continue' }
  | { op: 'call'; decisionKey: string; call: RefereeCall }
  | { op: 'hint'; reveal: boolean }
  | { op: 'resolve' }
  | { op: 'set-robot-visual'; robotVisual: RobotVisualId }
  | { op: 'end' };

export type MatchReplayEvent = MatchReplayOperation & {
  /** Contiguous order for multiple actions taken on the same simulation tick. */
  seq: number;
  /** Fixed 120 Hz certification clock; wall time is deliberately not recorded. */
  tick: number;
};

export type MatchReplay = {
  schema: typeof MATCH_REPLAY_SCHEMA;
  engineVersion: typeof MATCH_REPLAY_ENGINE_VERSION;
  mode: TrainingMode;
  seed: number;
  robotVisual: RobotVisualId;
  durationSeconds: typeof MATCH_REPLAY_DURATION_SECONDS;
  topics: TrainingTopic[];
  events: MatchReplayEvent[];
  terminal: {
    tick: number;
    reason: 'full-time' | 'ended-early';
  };
  /** Display-only client claim. Verification always recomputes the report. */
  claimedReport?: MatchReplayReport;
};

export type MatchReplayInput = Omit<
  MatchReplay,
  'schema' | 'engineVersion' | 'durationSeconds'
>;
/** Device-local recovery only. A checkpoint is never accepted as a completed game. */
export type MatchReplayCheckpoint = Omit<
  MatchReplay,
  'terminal' | 'claimedReport'
> & {
  terminal: { tick: number; reason: 'checkpoint' };
};
export type MatchReplayCheckpointInput = Omit<
  MatchReplayCheckpoint,
  'schema' | 'engineVersion' | 'durationSeconds'
>;

export type VerifiedMatchReplay = {
  mode: TrainingMode;
  seed: number;
  elapsedSeconds: number;
  report: MatchReplayReport;
  complete: boolean;
};

export type MatchReplayErrorCode =
  | 'invalid_replay'
  | 'unsupported_schema'
  | 'unsupported_engine'
  | 'too_many_events'
  | 'replay_too_large'
  | 'unknown_operation'
  | 'nonmonotonic_ticks'
  | 'state_diverged';

export class MatchReplayError extends Error {
  constructor(
    readonly code: MatchReplayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MatchReplayError';
  }
}

const allTopics = TRAINING_TOPICS.map((topic) => topic.id);
const actionIds = new Set<string>(REFEREE_ACTIONS.map((action) => action.id));
const callTargets = new Set([
  'blue',
  'yellow',
  'blue-1',
  'blue-2',
  'yellow-1',
  'yellow-2',
]);

const fail = (code: MatchReplayErrorCode, message: string): never => {
  throw new MatchReplayError(code, message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (!isRecord(value))
    return fail('invalid_replay', `${label} must be an object.`);
  return value;
};

const requireKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value))
    if (!allowedSet.has(key))
      fail('invalid_replay', `${label} contains an unknown ${key} field.`);
};

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
) => {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
    fail(
      'invalid_replay',
      `${label} must be an integer from ${minimum} through ${maximum}.`,
    );
  return value as number;
};

const validateReport = (value: unknown): MatchReplayReport => {
  const report = requireRecord(value, 'claimedReport');
  requireKeys(
    report,
    ['correct', 'wrong', 'missed', 'assisted', 'assessed', 'accuracy'],
    'claimedReport',
  );
  const count = (key: keyof MatchReplayReport) =>
    boundedInteger(report[key], 0, 10_000, `claimedReport.${key}`);
  const accuracy = report.accuracy;
  if (
    accuracy !== null &&
    (typeof accuracy !== 'number' ||
      !Number.isInteger(accuracy) ||
      accuracy < 0 ||
      accuracy > 100)
  )
    return fail(
      'invalid_replay',
      'claimedReport.accuracy must be null or an integer from 0 through 100.',
    );
  return {
    correct: count('correct'),
    wrong: count('wrong'),
    missed: count('missed'),
    assisted: count('assisted'),
    assessed: count('assessed'),
    accuracy: accuracy as number | null,
  };
};

const validateCall = (value: unknown, label: string): RefereeCall => {
  const call = requireRecord(value, label);
  requireKeys(call, ['action', 'target'], label);
  const action = call.action;
  const target = call.target;
  if (typeof action !== 'string' || !actionIds.has(action))
    return fail(
      'invalid_replay',
      `${label}.action is not a known referee action.`,
    );
  if (
    target !== undefined &&
    (typeof target !== 'string' || !callTargets.has(target))
  )
    return fail(
      'invalid_replay',
      `${label}.target is not a known team or robot.`,
    );
  return {
    action: action as RefereeCall['action'],
    ...(target === undefined ? {} : { target }),
  };
};

const eventKeys = ['seq', 'tick', 'op'] as const;
const validateEvent = (value: unknown, index: number): MatchReplayEvent => {
  const event = requireRecord(value, `events[${index}]`);
  const op = event.op;
  if (typeof op !== 'string')
    return fail('unknown_operation', `events[${index}].op is not known.`);
  const base = {
    seq: boundedInteger(
      event.seq,
      0,
      MAX_MATCH_REPLAY_EVENTS - 1,
      `events[${index}].seq`,
    ),
    tick: boundedInteger(
      event.tick,
      0,
      MATCH_REPLAY_DURATION_TICKS,
      `events[${index}].tick`,
    ),
  };
  const simple = new Set([
    'toss',
    'take-kickoff',
    'pause',
    'resume',
    'whistle',
    'next-case',
    'arrange-kickoff',
    'resume-evidence',
    'continue',
    'resolve',
    'end',
  ]);
  if (simple.has(op)) {
    requireKeys(event, eventKeys, `events[${index}]`);
    return { ...base, op } as MatchReplayEvent;
  }
  if (op === 'choose-end') {
    requireKeys(event, [...eventKeys, 'end'], `events[${index}]`);
    const end = event.end;
    if (end !== 'blue' && end !== 'yellow')
      return fail('invalid_replay', `events[${index}].end is invalid.`);
    return { ...base, op, end };
  }
  if (op === 'call') {
    requireKeys(
      event,
      [...eventKeys, 'decisionKey', 'call'],
      `events[${index}]`,
    );
    const decisionKey = event.decisionKey;
    if (
      typeof decisionKey !== 'string' ||
      decisionKey.length > 32 ||
      !/^\d+:\d+$/.test(decisionKey)
    )
      return fail('invalid_replay', `events[${index}].decisionKey is invalid.`);
    return {
      ...base,
      op,
      decisionKey,
      call: validateCall(event.call, `events[${index}].call`),
    };
  }
  if (op === 'hint') {
    requireKeys(event, [...eventKeys, 'reveal'], `events[${index}]`);
    const reveal = event.reveal;
    if (typeof reveal !== 'boolean')
      return fail('invalid_replay', `events[${index}].reveal must be boolean.`);
    return { ...base, op, reveal };
  }
  if (op === 'set-robot-visual') {
    return fail(
      'invalid_replay',
      'The robot model is locked for the whole certification attempt.',
    );
  }
  return fail('unknown_operation', `events[${index}].op is not known.`);
};

/** Parse, bound and canonicalize untrusted replay JSON before simulation. */
function validateReplay(
  value: unknown,
  allowCheckpoint = false,
): MatchReplay | MatchReplayCheckpoint {
  let jsonBytes: number;
  try {
    jsonBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return fail('invalid_replay', 'Replay must be JSON serializable.');
  }
  if (jsonBytes > MAX_MATCH_REPLAY_JSON_BYTES)
    fail(
      'replay_too_large',
      'Replay exceeds the certification evidence limit.',
    );

  const replay = requireRecord(value, 'replay');
  requireKeys(
    replay,
    [
      'schema',
      'engineVersion',
      'mode',
      'seed',
      'robotVisual',
      'durationSeconds',
      'topics',
      'events',
      'terminal',
      'claimedReport',
    ],
    'replay',
  );
  if (replay.schema !== MATCH_REPLAY_SCHEMA)
    fail('unsupported_schema', 'Replay schema is not supported.');
  if (replay.engineVersion !== MATCH_REPLAY_ENGINE_VERSION)
    fail('unsupported_engine', 'Replay engine version is not supported.');
  const mode = replay.mode;
  if (mode !== 'step' && mode !== 'continuous')
    return fail('invalid_replay', 'Replay mode is invalid.');
  const seed = boundedInteger(replay.seed, 1, 0xffffffff, 'seed');
  const robotVisual = replay.robotVisual;
  if (!isRobotVisualId(robotVisual))
    return fail('invalid_replay', 'Replay robotVisual is invalid.');
  if (replay.durationSeconds !== MATCH_REPLAY_DURATION_SECONDS)
    fail(
      'invalid_replay',
      'Certification replay duration must be 600 seconds.',
    );
  const topics = replay.topics;
  if (
    !Array.isArray(topics) ||
    topics.length !== allTopics.length ||
    topics.some((topic, index) => topic !== allTopics[index])
  )
    return fail(
      'invalid_replay',
      'Certification replay must include every topic.',
    );
  const rawEvents = replay.events;
  if (!Array.isArray(rawEvents))
    return fail('invalid_replay', 'Replay events must be an array.');
  if (rawEvents.length > MAX_MATCH_REPLAY_EVENTS)
    fail('too_many_events', 'Replay contains too many actions.');

  const events = rawEvents.map(validateEvent);
  let previousTick = -1;
  events.forEach((event, index) => {
    if (event.seq !== index)
      fail(
        'invalid_replay',
        'Replay event sequence must be contiguous from zero.',
      );
    if (event.tick < previousTick)
      fail('nonmonotonic_ticks', 'Replay event ticks must not go backwards.');
    previousTick = event.tick;
  });

  const terminal = requireRecord(replay.terminal, 'terminal');
  requireKeys(terminal, ['tick', 'reason'], 'terminal');
  const terminalTick = boundedInteger(
    terminal.tick,
    0,
    MATCH_REPLAY_DURATION_TICKS,
    'terminal.tick',
  );
  const reason = terminal.reason;
  if (
    reason !== 'full-time' &&
    reason !== 'ended-early' &&
    !(allowCheckpoint && reason === 'checkpoint')
  )
    return fail('invalid_replay', 'terminal.reason is invalid.');
  if (events.some((event) => event.tick > terminalTick))
    fail('invalid_replay', 'Replay contains an event after its terminal tick.');
  const endEvents = events.filter((event) => event.op === 'end');
  if (reason === 'full-time') {
    if (terminalTick !== MATCH_REPLAY_DURATION_TICKS || endEvents.length)
      fail(
        'invalid_replay',
        'A full-time replay must reach exactly 600 seconds without an early end event.',
      );
  } else if (reason === 'checkpoint') {
    if (terminalTick >= MATCH_REPLAY_DURATION_TICKS || endEvents.length)
      fail(
        'invalid_replay',
        'A checkpoint must be unfinished and contain no end event.',
      );
  } else {
    const last = events.at(-1);
    if (
      terminalTick >= MATCH_REPLAY_DURATION_TICKS ||
      endEvents.length !== 1 ||
      last?.op !== 'end' ||
      last.tick !== terminalTick
    )
      fail(
        'invalid_replay',
        'An early replay must finish with one end event at its terminal tick.',
      );
  }

  return {
    schema: MATCH_REPLAY_SCHEMA,
    engineVersion: MATCH_REPLAY_ENGINE_VERSION,
    mode,
    seed,
    robotVisual,
    durationSeconds: MATCH_REPLAY_DURATION_SECONDS,
    topics: [...allTopics],
    events,
    terminal: { tick: terminalTick, reason } as
      | MatchReplay['terminal']
      | MatchReplayCheckpoint['terminal'],
    ...(replay.claimedReport === undefined
      ? {}
      : { claimedReport: validateReport(replay.claimedReport) }),
  } as MatchReplay | MatchReplayCheckpoint;
}

export function validateMatchReplay(value: unknown): MatchReplay {
  return validateReplay(value) as MatchReplay;
}
export function validateMatchReplayCheckpoint(
  value: unknown,
): MatchReplayCheckpoint {
  const replay = validateReplay(value, true);
  if (replay.terminal.reason !== 'checkpoint')
    fail('invalid_replay', 'Expected an unfinished checkpoint.');
  return replay as MatchReplayCheckpoint;
}
export function makeMatchReplayCheckpoint(
  input: MatchReplayCheckpointInput,
): MatchReplayCheckpoint {
  return validateMatchReplayCheckpoint({
    schema: MATCH_REPLAY_SCHEMA,
    engineVersion: MATCH_REPLAY_ENGINE_VERSION,
    durationSeconds: MATCH_REPLAY_DURATION_SECONDS,
    ...input,
  });
}

/** Create canonical bounded evidence from a browser-side capture. */
export function makeMatchReplay(input: MatchReplayInput): MatchReplay {
  return validateMatchReplay({
    schema: MATCH_REPLAY_SCHEMA,
    engineVersion: MATCH_REPLAY_ENGINE_VERSION,
    durationSeconds: MATCH_REPLAY_DURATION_SECONDS,
    ...input,
  });
}

const divergence = (event: MatchReplayEvent, detail: string): never =>
  fail(
    'state_diverged',
    `Replay diverged at event ${event.seq} (${event.op}, tick ${event.tick}): ${detail}`,
  );

const applyEvent = (session: RefereeMatch, event: MatchReplayEvent) => {
  switch (event.op) {
    case 'toss':
      if (!session.tossCoin()) divergence(event, 'coin toss was unavailable');
      return;
    case 'take-kickoff':
      if (!session.chooseFirstKickoff())
        divergence(event, 'kickoff choice was unavailable');
      return;
    case 'choose-end':
      if (!session.chooseOpeningEnd(event.end))
        divergence(event, 'end choice was unavailable');
      return;
    case 'pause':
      if (session.snapshot().sessionFinished)
        divergence(event, 'session had already finished');
      session.pauseForDecision();
      return;
    case 'resume':
      if (!session.canResumeMotion)
        divergence(event, 'motion could not resume');
      session.resumeMotion();
      return;
    case 'whistle':
      if (session.snapshot().sessionFinished)
        divergence(event, 'session had already finished');
      session.whistle();
      return;
    case 'next-case':
      if (!session.nextCase()) divergence(event, 'next case could not start');
      return;
    case 'arrange-kickoff':
      if (!session.arrangeKickoff())
        divergence(event, 'kickoff could not be arranged');
      return;
    case 'resume-evidence':
      if (!session.resumeEvidence())
        divergence(event, 'evidence could not resume');
      return;
    case 'continue':
      if (
        session.snapshot().sessionFinished ||
        (session.mode === 'step' && session.phase !== 'feedback')
      )
        divergence(event, 'there was no feedback to continue');
      session.continue();
      return;
    case 'call':
      if (session.decisionKey !== event.decisionKey)
        divergence(event, 'decision key does not match the engine state');
      if (!session.submit(event.decisionKey, event.call))
        divergence(event, 'referee call was rejected');
      return;
    case 'hint':
      if (!session.requestHint(event.reveal))
        divergence(event, 'assistance was unavailable');
      return;
    case 'resolve':
      if (!session.resolveForMe())
        divergence(event, 'automatic resolution was unavailable');
      return;
    case 'set-robot-visual':
      session.setRobotVisual(event.robotVisual);
      return;
    case 'end':
      if (session.snapshot().sessionFinished)
        divergence(event, 'session had already finished');
      session.endSession();
  }
};

/**
 * Re-run untrusted evidence with the pinned deterministic engine. Client score
 * counters are intentionally ignored; only the replayed engine report is used.
 */
export function hydrateMatchReplay(
  value: MatchReplay | MatchReplayCheckpoint,
  options: { recordMatchReplay?: boolean } = {},
): RefereeMatch {
  const replay =
    value.terminal.reason === 'checkpoint'
      ? validateMatchReplayCheckpoint(value)
      : validateMatchReplay(value);
  const session = new RefereeMatch(replay.seed, {
    preMatch: true,
    robotVisual: replay.robotVisual,
    lockRobotVisual: true,
    mode: replay.mode,
    duration: MATCH_REPLAY_DURATION_SECONDS,
    topics: replay.topics,
    recordMatchReplay: options.recordMatchReplay ?? false,
  });

  for (const event of replay.events) {
    while (session.trainingTick < event.tick) {
      if (!session.canAdvance)
        divergence(event, 'simulation stopped before the recorded tick');
      session.step();
    }
    if (session.trainingTick !== event.tick)
      divergence(event, 'simulation passed the recorded tick');
    applyEvent(session, event);
  }

  while (session.trainingTick < replay.terminal.tick) {
    const synthetic: MatchReplayEvent = {
      seq: replay.events.length,
      tick: replay.terminal.tick,
      op: 'end',
    };
    if (!session.canAdvance)
      divergence(synthetic, 'simulation stopped before the terminal tick');
    session.step();
  }

  const frame = session.snapshot();
  if (
    session.trainingTick !== replay.terminal.tick ||
    (replay.terminal.reason === 'checkpoint'
      ? frame.sessionFinished
      : !frame.sessionFinished)
  )
    fail(
      'state_diverged',
      'Replay did not finish at its declared terminal tick.',
    );
  return session;
}

export function verifyMatchReplay(value: unknown): VerifiedMatchReplay {
  const replay = validateMatchReplay(value);
  const session = hydrateMatchReplay(replay);
  const report = session.snapshot().report;
  return {
    mode: replay.mode,
    seed: replay.seed,
    elapsedSeconds: session.trainingTick / MATCH_REPLAY_TICK_RATE,
    report: {
      correct: report.correct,
      wrong: report.wrong,
      missed: report.missed,
      assisted: report.assisted,
      assessed: report.assessed,
      accuracy: report.accuracy,
    },
    complete:
      replay.terminal.reason === 'full-time' &&
      session.trainingTick === MATCH_REPLAY_DURATION_TICKS,
  };
}
