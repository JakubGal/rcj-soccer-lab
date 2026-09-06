import type {
  AccountSnapshot,
  AccountProfilePatch,
  CertificationGameAttempt,
  CertificationGameLaunch,
  CertificationHistoryEntry,
  PracticeGame,
  StartGamePayload,
  FinishGamePayload,
} from './types';
import type { RuleLearningEvent } from '@/lib/certification/client-types';
import { CERTIFICATION_POLICY } from '@/lib/certification/policy';
import {
  CERTIFICATION_QUESTION_IDS,
  scoreGame,
} from '@/lib/certification/scoring';
import {
  validateMatchReplay,
  validateMatchReplayCheckpoint,
  makeMatchReplayCheckpoint,
  MATCH_REPLAY_ENGINE_VERSION,
  type MatchReplay,
  type MatchReplayCheckpoint,
} from '@/lib/certification/replay';
import { DEFAULT_ROBOT_VISUAL_ID } from '@/lib/simulator/robot-models';
import { summarizeRuleEvidence } from '@/lib/github/validate';
import { verifyEnvelope } from '@/lib/github/registry';
import { certificationSeed } from '@/lib/github/seeds';
import {
  prepareSubmission,
  type GitHubRoundEvidence,
  type SignedEnvelope,
  type PreparedSubmission,
  type GitHubReceipt,
} from '@/lib/github/protocol';

export type LocalProgress = {
  schema: 1;
  enabled: boolean;
  profile: AccountSnapshot['profile'];
  completedQuestions: string[];
  practiceGames: PracticeGame[];
  round: GitHubRoundEvidence | null;
  attempts: Record<string, CertificationGameAttempt>;
  history: CertificationHistoryEntry[];
  historyReceipts?: Record<string, SignedEnvelope>;
  connection: SignedEnvelope | null;
  certificationReceipt: SignedEnvelope | null;
  request: PreparedSubmission | null;
  receipt: SignedEnvelope | null;
  checkpoints?: Record<string, MatchReplayCheckpoint>;
  archivedReplays?: Record<string, MatchReplay>;
  archivedCheckpoints?: Record<string, MatchReplayCheckpoint>;
};

export function emptyProgress(): LocalProgress {
  return {
    schema: 1,
    enabled: false,
    profile: null,
    completedQuestions: [],
    practiceGames: [],
    round: null,
    attempts: {},
    history: [],
    historyReceipts: {},
    connection: null,
    certificationReceipt: null,
    request: null,
    receipt: null,
    checkpoints: {},
    archivedReplays: {},
    archivedCheckpoints: {},
  };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rcj-soccer-academy', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('progress');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          'Browser storage is unavailable. Enable site storage to save progress.',
        ),
      );
  });
}
export async function loadProgress(): Promise<LocalProgress> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('progress', 'readonly');
      const request = tx.objectStore('progress').get('current');
      request.onsuccess = () => resolve(request.result ?? emptyProgress());
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveProgress(progress: LocalProgress) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('progress', 'readwrite');
      tx.objectStore('progress').put(progress, 'current');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            'Progress could not be saved. Export a backup and check available browser storage.',
          ),
        );
    });
  } finally {
    db.close();
  }
}
let localQueue = Promise.resolve();
export function changeProgress<T>(
  operation: (data: LocalProgress) => Promise<T> | T,
): Promise<{ data: LocalProgress; result: T }> {
  const job = async () => {
    const data = await loadProgress();
    const result = await operation(data);
    await saveProgress(data);
    return { data, result };
  };
  const pending = localQueue.then(async () =>
    navigator.locks
      ? await navigator.locks.request('rcj-academy-write', job)
      : await job(),
  );
  localQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export async function trustedReceipt(envelope: SignedEnvelope | null) {
  if (!envelope) return null;
  try {
    return await verifyEnvelope<GitHubReceipt>(envelope);
  } catch {
    return null;
  } // Imported/local edits cannot grant verified status.
}
export async function accountSnapshot(
  data: LocalProgress,
): Promise<AccountSnapshot> {
  const connection = await trustedReceipt(data.connection);
  const certification = await trustedReceipt(data.certificationReceipt);
  const profile = data.profile
    ? {
        ...data.profile,
        refereeNumber:
          connection?.status === 'accepted' ? connection.refereeNumber : '',
      }
    : null;
  const average = (mode: 'step' | 'continuous') => {
    const scores = data.practiceGames
      .filter((game) => game.mode === mode && game.accuracy !== null)
      .map((game) => game.accuracy!);
    return scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
  };
  const round = data.round;
  const currentPolicy = round?.policyVersion === CERTIFICATION_POLICY.policyVersion;
  const legacyQuestions = [...new Set((round?.ruleEvents ?? [])
    .filter((event) => event.type === 'answer' || event.type === 'complete')
    .map((event) => event.questionId))];
  const rules = round && currentPolicy
    ? summarizeRuleEvidence(round.ruleEvents, round.id)
    : round ? {
      answered: legacyQuestions.length,
      total: 73,
      correctFirstTry: 0,
      accuracy: null,
      requiredAccuracy: 95,
      passed: false,
      answeredQuestionIds: legacyQuestions,
    } : null;
  const track = (mode: 'step' | 'continuous') => {
    const policy = CERTIFICATION_POLICY.games[mode];
    const attempts = (round?.games ?? [])
      .filter((game) => game.mode === mode)
      .map(
        (game, index) => ({
          ...(data.attempts[game.id] ?? {
            id: game.id,
            mode,
            attemptNumber: index + 1,
            durationSeconds: (data.checkpoints?.[game.id]?.terminal.tick ?? 0) / 120,
            accuracy: null,
            correct: 0,
            wrong: 0,
            missed: 0,
            assisted: 0,
            completed: false,
            qualifying: false,
            startedAt: game.startedAt,
            completedAt: null,
          }),
          inProgress: currentPolicy && !game.endedAt,
          canReview: game.replay?.engineVersion === MATCH_REPLAY_ENGINE_VERSION,
        }),
      );
    const qualifyingGames = attempts.filter(
      (attempt) => attempt.qualifying,
    ).length;
    return {
      mode,
      requiredGames: policy.requiredQualifying,
      qualifyingGames,
      attemptsUsed: attempts.length,
      attemptsAllowed: policy.maxAttempts,
      requiredAccuracy: policy.minimumAccuracy,
      durationSeconds: 600,
      passed: qualifyingGames >= policy.requiredQualifying,
      attempts,
    };
  };
  const step = track('step'),
    continuous = track('continuous');
  const passed = rules?.passed && step.passed && continuous.passed;
  const failed =
    rules &&
    (rules.answered - rules.correctFirstTry >
      CERTIFICATION_POLICY.ruleQuestionCount - CERTIFICATION_POLICY.ruleFirstTryRequired ||
      [step, continuous].some(
        (item) =>
          item.qualifyingGames + item.attemptsAllowed - item.attemptsUsed +
          item.attempts.filter((attempt) => attempt.inProgress).length <
          item.requiredGames,
      ));
  const verified =
    certification?.status === 'accepted' &&
    certification.certificate?.roundId === round?.id &&
    certification.githubId === connection?.githubId;
  const history = [...data.history].reverse();
  const certificationHistory = await Promise.all(
    history.map(async (entry, index) => {
      // The profile displays the latest eight rounds. Do not verify thousands of
      // historical signatures on every answer/save, or trust their local labels.
      const proof =
        index < 8
          ? await trustedReceipt(data.historyReceipts?.[entry.id] ?? null)
          : null;
      const historyVerified =
        proof?.status === 'accepted' &&
        proof.certificate?.roundId === entry.id &&
        proof.githubId === connection?.githubId;
      return {
        ...entry,
        status: historyVerified
          ? ('qualified' as const)
          : entry.status === 'qualified'
            ? ('ready' as const)
            : entry.status,
      };
    }),
  );
  return {
    authenticated: data.enabled && profile !== null,
    profile,
    links: { signIn: null, signOut: null },
    practice: {
      ruleChecksCompleted: data.completedQuestions.length,
      ruleChecksTotal: CERTIFICATION_QUESTION_IDS.size,
      refereeGamesPlayed: data.practiceGames.length,
      stepGamesPlayed: data.practiceGames.filter((game) => game.mode === 'step')
        .length,
      continuousGamesPlayed: data.practiceGames.filter(
        (game) => game.mode === 'continuous',
      ).length,
      stepAccuracy: average('step'),
      continuousAccuracy: average('continuous'),
      completedQuestionIds: data.completedQuestions,
    },
    certification:
      round && rules
        ? {
            id: round.id,
            number: round.number,
            season: '2026',
            status: verified
              ? 'qualified'
              : !currentPolicy ? 'upgrade-required'
              : passed
                ? 'ready'
                : failed
                  ? 'failed'
                  : 'in-progress',
            startedAt: round.startedAt,
            completedAt: verified
              ? certification.certificate!.certifiedAt
              : null,
            rules,
            step,
            continuous,
            policyVersion: round.policyVersion,
          }
        : null,
    recentGames: data.practiceGames.slice(-100).reverse().map((game) => ({
      ...game,
      canReview: (round?.games.find((entry) => entry.id === game.id)?.replay ??
        data.archivedReplays?.[game.id])?.engineVersion === MATCH_REPLAY_ENGINE_VERSION,
    })),
    certificationHistory,
  };
}

export function enableProfile(data: LocalProgress) {
  data.enabled = true;
  data.profile ??= {
    id: crypto.randomUUID(),
    email: '',
    displayName: 'Referee',
    country: '',
    refereeNumber: '',
    publicProfile: false,
    createdAt: new Date().toISOString(),
  };
}
export function updateLocalProfile(
  data: LocalProgress,
  patch: AccountProfilePatch,
) {
  if (!data.profile) throw new Error('Create a local profile first.');
  if (
    patch.displayName.trim().length < 2 ||
    patch.displayName.length > 60 ||
    patch.country.length > 80 ||
    /\p{Cc}/u.test(patch.displayName + patch.country)
  )
    throw new Error(
      'Use a display name between 2 and 60 characters and a short country or region.',
    );
  Object.assign(data.profile, {
    displayName: patch.displayName.trim(),
    country: patch.country.trim(),
    publicProfile: patch.publicProfile,
  });
}
export async function assertCanPrepareGitHubRequest(
  data: LocalProgress,
  kind: 'connect' | 'certify',
) {
  if (data.request && data.request.kind !== kind) {
    const previousResult = await trustedReceipt(data.receipt);
    if (previousResult?.requestId !== data.request.requestId)
      throw new Error(
        'Check your pending GitHub submission before preparing a different request. The pending request stays saved with your progress.',
      );
  }
}
export async function acceptGitHubReceipt(
  data: LocalProgress,
  envelope: SignedEnvelope,
) {
  const receipt = await trustedReceipt(envelope);
  if (!receipt)
    throw new Error('This record does not have a valid academy signature.');
  if (!data.request || data.request.requestId !== receipt.requestId)
    throw new Error(
      'The pending submission has changed. Check the new request.',
    );
  if (receipt.kind !== data.request.kind)
    throw new Error('The verification response belongs to another request.');
  if (receipt.status === 'accepted') {
    if (
      receipt.kind === 'certify' &&
      receipt.certificate?.roundId !== data.round?.id
    )
      throw new Error('The certificate belongs to a different round.');
    const previous = await trustedReceipt(data.connection);
    if (previous && previous.githubId !== receipt.githubId)
      data.certificationReceipt = null;
    data.connection = envelope;
    // Connections also carry any certificate already issued for this account.
    if (receipt.certificate && receipt.certificate.roundId === data.round?.id)
      data.certificationReceipt = envelope;
  }
  data.receipt = envelope;
}
export async function newRound(data: LocalProgress) {
  if (!data.enabled || !data.profile)
    throw new Error('Create a local profile first.');
  if (data.round) {
    data.archivedReplays ??= {};
    for (const game of data.round.games)
      if (game.replay) data.archivedReplays[game.id] = game.replay;
    data.archivedCheckpoints ??= {};
    for (const [id, checkpoint] of Object.entries(data.checkpoints ?? {}))
      data.archivedCheckpoints[id] = structuredClone(checkpoint);
    const snapshot = await accountSnapshot(data);
    if (
      snapshot.certification?.status === 'qualified' &&
      data.certificationReceipt
    ) {
      data.historyReceipts ??= {};
      data.historyReceipts[data.round.id] = data.certificationReceipt;
    }
    data.history.push({
      id: data.round.id,
      roundNumber: data.round.number,
      season: '2026',
      status:
        snapshot.certification?.status === 'qualified'
          ? 'qualified'
          : 'restarted',
      startedAt: data.round.startedAt,
      completedAt: new Date().toISOString(),
    });
  }
  data.round = {
    id: crypto.randomUUID(),
    number: (data.round?.number ?? 0) + 1,
    startedAt: new Date().toISOString(),
    ruleEvents: [],
    games: [],
    policyVersion: CERTIFICATION_POLICY.policyVersion,
  };
  data.attempts = {};
  data.checkpoints = {};
  data.certificationReceipt = null;
  data.request = null;
  data.receipt = null;
}
export async function startLocalGame(
  data: LocalProgress,
  payload: StartGamePayload,
): Promise<CertificationGameLaunch> {
  const round = data.round;
  if (!round || payload.roundId !== round.id)
    throw new Error('This certification round is no longer active.');
  const snapshot = await accountSnapshot(data);
  if (snapshot.certification?.status !== 'in-progress')
    throw new Error(
      'Start a new certification round before playing another attempt.',
    );
  const policy = CERTIFICATION_POLICY.games[payload.mode];
  const pending = round.games.find((game) => !game.endedAt);
  if (pending)
    throw new Error('Resume or end the unfinished certification game before starting another attempt.');
  const attempts = round.games.filter((game) => game.mode === payload.mode);
  if (attempts.length >= policy.maxAttempts)
    throw new Error(
      'The attempt limit has been reached. Restart the complete round to try again.',
    );
  const id = crypto.randomUUID(),
    seed = await certificationSeed(round.id, payload.mode, attempts.length + 1);
  const startedAt = new Date().toISOString();
  round.games.push({ id, mode: payload.mode, seed, startedAt });
  saveLocalCheckpoint(data, id, makeMatchReplayCheckpoint({
    mode: payload.mode, seed, robotVisual: payload.robotVisual ?? DEFAULT_ROBOT_VISUAL_ID,
    topics: [...CERTIFICATION_POLICY.topics], events: [],
    terminal: { tick: 0, reason: 'checkpoint' },
  }));
  return {
    attemptId: id,
    roundId: round.id,
    mode: payload.mode,
    seed,
    durationSeconds: 600,
    topics: [...CERTIFICATION_POLICY.topics],
    startedAt,
    clientSessionId: null,
    attemptNumber: attempts.length + 1,
    robotVisual: payload.robotVisual ?? DEFAULT_ROBOT_VISUAL_ID,
  };
}

export function resumeLocalGame(data: LocalProgress, id: string): CertificationGameLaunch {
  const round = data.round;
  const game = round?.games.find((entry) => entry.id === id);
  if (!data.enabled || !round || round.policyVersion !== CERTIFICATION_POLICY.policyVersion ||
    !game || game.endedAt)
    throw new Error('This certification game cannot be resumed.');
  const checkpoint = data.checkpoints?.[id];
  return {
    attemptId: id, roundId: round.id, mode: game.mode, seed: game.seed,
    durationSeconds: 600, topics: [...CERTIFICATION_POLICY.topics],
    startedAt: game.startedAt, clientSessionId: null,
    attemptNumber: round.games.filter((entry) => entry.mode === game.mode)
      .findIndex((entry) => entry.id === id) + 1,
    robotVisual: checkpoint?.robotVisual ?? DEFAULT_ROBOT_VISUAL_ID,
    ...(checkpoint ? { checkpoint: validateMatchReplayCheckpoint(checkpoint) } : {}),
  };
}

type RecordedProgress = MatchReplay | MatchReplayCheckpoint;

/** A later save may append actions, never revise actions or already elapsed time. */
function extendsRecordedProgress(previous: RecordedProgress, next: RecordedProgress) {
  return previous.mode === next.mode && previous.seed === next.seed &&
    previous.robotVisual === next.robotVisual &&
    previous.engineVersion === next.engineVersion &&
    previous.durationSeconds === next.durationSeconds &&
    JSON.stringify(previous.topics) === JSON.stringify(next.topics) &&
    previous.terminal.tick <= next.terminal.tick &&
    previous.events.length <= next.events.length &&
    previous.events.every((event, index) =>
      JSON.stringify(event) === JSON.stringify(next.events[index])) &&
    // A tab cannot append a decision that happened before the saved checkpoint.
    // Equal ticks are allowed: several UI actions may occur between physics ticks.
    (next.events[previous.events.length]?.tick ?? Infinity) >= previous.terminal.tick;
}

function changedAttempt(): never {
  throw new Error('Another tab changed this attempt. Resume its saved checkpoint from Academy.');
}

export function saveLocalCheckpoint(data: LocalProgress, id: string, value: MatchReplayCheckpoint) {
  const game = data.round?.games.find((entry) => entry.id === id);
  if (data.round?.policyVersion !== CERTIFICATION_POLICY.policyVersion || !game)
    throw new Error('This game belongs to a different certification round.');
  const checkpoint = validateMatchReplayCheckpoint(value);
  if (checkpoint.mode !== game.mode || checkpoint.seed !== game.seed)
    throw new Error('The checkpoint belongs to a different game.');
  if (game.endedAt) {
    if (!game.replay || !extendsRecordedProgress(checkpoint, validateMatchReplay(game.replay)))
      changedAttempt();
    return;
  }
  const previous = data.checkpoints?.[id];
  if (previous) {
    const saved = validateMatchReplayCheckpoint(previous);
    // Out-of-order writes are harmless only when they describe the same history.
    if (extendsRecordedProgress(checkpoint, saved)) return;
    if (!extendsRecordedProgress(saved, checkpoint)) changedAttempt();
  }
  data.checkpoints ??= {};
  data.checkpoints[id] = checkpoint;
}

export function savedLocalReplay(data: LocalProgress, id: string): MatchReplay {
  const replay = data.round?.games.find((entry) => entry.id === id)?.replay ??
    data.archivedReplays?.[id];
  if (!replay) throw new Error('No recording is available for this game.');
  return validateMatchReplay(replay);
}
export function finishLocalGame(
  data: LocalProgress,
  id: string,
  payload: FinishGamePayload,
) {
  const game = data.round?.games.find((entry) => entry.id === id);
  if (data.round?.policyVersion !== CERTIFICATION_POLICY.policyVersion || !game)
    throw new Error('This game belongs to a different certification round.');
  if (!payload.replay)
    throw new Error(
      'The game recording is missing. This attempt cannot be submitted for certification.',
    );
  const replay = validateMatchReplay(payload.replay);
  if (replay.mode !== game.mode || replay.seed !== game.seed)
    throw new Error('The recording belongs to a different game.');
  if (game.endedAt) {
    if (!game.replay) changedAttempt();
    const saved = validateMatchReplay(game.replay);
    if (!extendsRecordedProgress(saved, replay) ||
      !extendsRecordedProgress(replay, saved) ||
      saved.terminal.reason !== replay.terminal.reason) changedAttempt();
    return;
  }
  const checkpoint = data.checkpoints?.[id];
  if (checkpoint && !extendsRecordedProgress(validateMatchReplayCheckpoint(checkpoint), replay))
    changedAttempt();
  const grade = scoreGame(game.mode, payload, payload.elapsedSeconds);
  game.replay = replay;
  game.endedAt = new Date().toISOString();
  if (data.checkpoints) delete data.checkpoints[id];
  data.attempts[id] = {
    id,
    mode: game.mode,
    attemptNumber:
      data
        .round!.games.filter((entry) => entry.mode === game.mode)
        .findIndex((entry) => entry.id === id) + 1,
    durationSeconds: Math.min(600, payload.elapsedSeconds),
    accuracy: grade.accuracy,
    correct: payload.correct,
    wrong: payload.wrong,
    missed: payload.missed,
    assisted: payload.assisted,
    completed: grade.complete,
    qualifying: grade.qualifying,
    startedAt: game.startedAt,
    completedAt: game.endedAt,
  };
  data.practiceGames.push({
    id,
    mode: game.mode,
    durationSeconds: payload.elapsedSeconds,
    accuracy: grade.accuracy,
    completedAt: game.endedAt,
  });
}
export function recordLocalRule(data: LocalProgress, event: RuleLearningEvent) {
  if (event.mode === 'practice') {
    if (
      (event.type === 'complete' ||
        (event.type === 'answer' && event.completed)) &&
      !data.completedQuestions.includes(event.questionId)
    )
      data.completedQuestions.push(event.questionId);
    return;
  }
  if (!data.round || event.certificationRunId !== data.round.id)
    throw new Error('This certification round is no longer active.');
  if (data.round.policyVersion !== CERTIFICATION_POLICY.policyVersion)
    throw new Error('This round uses an older grading version. Restart certification to use the corrected examination.');
  const events = [...data.round.ruleEvents, event];
  summarizeRuleEvidence(events, data.round.id);
  data.round.ruleEvents = events;
}

const backupUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalidBackup = (): never => {
  throw new Error('Invalid profile, history or game data in progress backup.');
};
function backupRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalidBackup();
  return value as Record<string, unknown>;
}

function storedReplay(value: unknown): MatchReplay {
  const record = backupRecord(value);
  if (record.engineVersion === MATCH_REPLAY_ENGINE_VERSION)
    return validateMatchReplay(record);
  // Old evidence is retained only as opaque backup/history data. It is never
  // replayed or used to qualify against a different engine version.
  if (!['referee-match-2026-v1', 'referee-match-2026-v2'].includes(String(record.engineVersion)) ||
    record.schema !== 'rcj-match-replay/v1' ||
    JSON.stringify(record).length > 512 * 1024 || !Array.isArray(record.events) ||
    record.events.length > 4096) return invalidBackup();
  backupMode(record.mode);
  backupNumber(record.seed, 0xffffffff, 1, true);
  return structuredClone(record) as MatchReplay;
}
function storedCheckpoint(value: unknown): MatchReplayCheckpoint {
  const record = backupRecord(value);
  if (record.engineVersion === MATCH_REPLAY_ENGINE_VERSION)
    return validateMatchReplayCheckpoint(record);
  if (!['referee-match-2026-v1', 'referee-match-2026-v2'].includes(String(record.engineVersion)))
    return invalidBackup();
  // Validate the unchanged recording format only; never execute old operations
  // or relabel them as new-engine evidence. Legacy checkpoints are backup-only.
  validateMatchReplayCheckpoint({ ...record, engineVersion: MATCH_REPLAY_ENGINE_VERSION });
  return structuredClone(record) as MatchReplayCheckpoint;
}
function backupText(value: unknown, maximum: number, minimum = 0) {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    value.trim().length < minimum ||
    /\p{Cc}/u.test(value)
  )
    return invalidBackup();
  return value;
}
function backupNumber(
  value: unknown,
  maximum: number,
  minimum = 0,
  integer = false,
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isSafeInteger(value))
  )
    return invalidBackup();
  return value;
}
function backupBoolean(value: unknown) {
  if (typeof value !== 'boolean') return invalidBackup();
  return value;
}
function backupDate(value: unknown, nullable = true): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !Number.isFinite(Date.parse(value))
  )
    return invalidBackup();
  return value;
}
function backupMode(value: unknown): 'step' | 'continuous' {
  if (value !== 'step' && value !== 'continuous') return invalidBackup();
  return value;
}
function backupRoundId(value: unknown) {
  if (typeof value !== 'string' || !backupUuid.test(value))
    return invalidBackup();
  return value;
}
function backupArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return invalidBackup();
  return value;
}

/** Validate the entire imported view model before any device data is replaced. */
export async function validateBackup(value: unknown): Promise<LocalProgress> {
  const source = backupRecord(value);
  if (source.schema !== 1)
    throw new Error('This is not a supported progress backup.');
  const data = emptyProgress();
  const profile = backupRecord(source.profile);
  data.profile = {
    id: backupText(profile.id, 128, 1),
    email: backupText(profile.email, 254),
    displayName: backupText(profile.displayName, 60, 2).trim(),
    country: backupText(profile.country, 80).trim(),
    publicProfile: backupBoolean(profile.publicProfile),
    createdAt: backupDate(profile.createdAt),
    refereeNumber: '', // Numbers and qualification labels always come from proofs.
  };
  data.completedQuestions = backupArray(
    source.completedQuestions,
    CERTIFICATION_QUESTION_IDS.size,
  ).map((value) => {
    if (typeof value !== 'string' || !CERTIFICATION_QUESTION_IDS.has(value))
      return invalidBackup();
    return value;
  });
  if (new Set(data.completedQuestions).size !== data.completedQuestions.length)
    invalidBackup();
  data.practiceGames = backupArray(source.practiceGames, 100000).map(
    (value) => {
      const game = backupRecord(value);
      return {
        id: backupText(game.id, 128, 1),
        mode: backupMode(game.mode),
        durationSeconds: backupNumber(game.durationSeconds, 86400),
        accuracy:
          game.accuracy === null ? null : backupNumber(game.accuracy, 100),
        completedAt: backupDate(game.completedAt),
      };
    },
  );
  data.history = backupArray(source.history, 10000).map((value) => {
    const entry = backupRecord(value);
    if (
      typeof entry.status !== 'string' ||
      ![
        'not-started',
        'in-progress',
        'ready',
        'qualified',
        'failed',
        'restarted',
      ].includes(entry.status)
    )
      return invalidBackup();
    return {
      id: backupRoundId(entry.id),
      roundNumber: backupNumber(
        entry.roundNumber,
        Number.MAX_SAFE_INTEGER,
        1,
        true,
      ),
      season: backupText(entry.season, 32, 1),
      status: entry.status as CertificationHistoryEntry['status'],
      startedAt: backupDate(entry.startedAt),
      completedAt: backupDate(entry.completedAt),
    };
  });
  if (
    new Set(data.history.map((entry) => entry.id)).size !== data.history.length
  )
    invalidBackup();
  for (const key of [
    'connection',
    'certificationReceipt',
    'receipt',
  ] as const) {
    const envelope = source[key];
    if (envelope !== undefined && envelope !== null) {
      if (!(await trustedReceipt(envelope as SignedEnvelope)))
        throw new Error(
          'This backup contains an invalid verification signature.',
        );
      data[key] = envelope as SignedEnvelope;
    }
  }
  const historicProofs =
    source.historyReceipts === undefined
      ? {}
      : backupRecord(source.historyReceipts);
  if (Object.keys(historicProofs).length > 10000) invalidBackup();
  for (const [id, value] of Object.entries(historicProofs)) {
    const proof = await trustedReceipt(value as SignedEnvelope);
    if (
      !data.history.some((entry) => entry.id === id) ||
      proof?.status !== 'accepted' ||
      proof.certificate?.roundId !== id
    )
      throw new Error(
        'This backup contains an invalid historical certification proof.',
      );
    data.historyReceipts![id] = value as SignedEnvelope;
  }
  for (const entry of data.history)
    if (entry.status === 'qualified' && !data.historyReceipts![entry.id])
      entry.status = 'ready';

  if (source.round !== null && source.round !== undefined) {
    const round = backupRecord(source.round);
    const id = backupRoundId(round.id);
    const startedAt = backupDate(round.startedAt, false)!;
    const policyVersion = round.policyVersion === undefined ? undefined :
      backupText(round.policyVersion, 80, 1);
    const used = { step: 0, continuous: 0 };
    const ids = new Set<string>();
    const games = backupArray(round.games, 13).map((value) => {
      const game = backupRecord(value);
      const gameId = backupRoundId(game.id),
        mode = backupMode(game.mode);
      if (
        ids.has(gameId) ||
        ++used[mode] > CERTIFICATION_POLICY.games[mode].maxAttempts
      )
        return invalidBackup();
      ids.add(gameId);
      const seed = backupNumber(game.seed, 0xffffffff, 1, true);
      const gameStart = backupDate(game.startedAt, false)!;
      if (Date.parse(gameStart) < Date.parse(startedAt)) return invalidBackup();
      const endedAt =
        game.endedAt === undefined
          ? undefined
          : backupDate(game.endedAt, false)!;
      if (endedAt && Date.parse(endedAt) < Date.parse(gameStart))
        return invalidBackup();
      const replay =
        game.replay === undefined
          ? undefined
          : storedReplay(game.replay);
      if (replay && (replay.mode !== mode || replay.seed !== seed))
        return invalidBackup();
      return {
        id: gameId,
        mode,
        seed,
        startedAt: gameStart,
        ...(endedAt ? { endedAt } : {}),
        ...(replay ? { replay } : {}),
      };
    });
    const ruleEvents = backupArray(
      round.ruleEvents,
      12000,
    ) as RuleLearningEvent[];
    if (policyVersion === CERTIFICATION_POLICY.policyVersion)
      summarizeRuleEvidence(ruleEvents, id);
    else for (const event of ruleEvents) {
      const item = backupRecord(event);
      if (item.certificationRunId !== id || item.mode !== 'certification' ||
        !['answer', 'complete', 'assistance'].includes(String(item.type))) invalidBackup();
      backupText(item.questionId, 160, 1);
    }
    data.round = {
      id,
      number: backupNumber(round.number, Number.MAX_SAFE_INTEGER, 1, true),
      startedAt,
      games,
      ruleEvents,
      ...(policyVersion ? { policyVersion } : {}),
    };
  }
  const checkpoints = source.checkpoints === undefined ? {} : backupRecord(source.checkpoints);
  if (Object.keys(checkpoints).length > 13) invalidBackup();
  for (const [id, value] of Object.entries(checkpoints)) {
    if (data.round?.policyVersion === CERTIFICATION_POLICY.policyVersion)
      saveLocalCheckpoint(data, id, validateMatchReplayCheckpoint(value));
    else {
      const checkpoint = storedCheckpoint(value);
      const game = data.round?.games.find((entry) => entry.id === id);
      if (!game || game.endedAt || game.mode !== checkpoint.mode || game.seed !== checkpoint.seed)
        invalidBackup();
      data.checkpoints![id] = checkpoint;
    }
  }
  const archivedCheckpoints = source.archivedCheckpoints === undefined ? {} : backupRecord(source.archivedCheckpoints);
  if (Object.keys(archivedCheckpoints).length > 10000) invalidBackup();
  for (const [id, value] of Object.entries(archivedCheckpoints)) {
    backupRoundId(id);
    data.archivedCheckpoints![id] = storedCheckpoint(value);
  }
  const archived = source.archivedReplays === undefined ? {} : backupRecord(source.archivedReplays);
  if (Object.keys(archived).length > 10000) invalidBackup();
  for (const [id, value] of Object.entries(archived)) {
    backupRoundId(id);
    data.archivedReplays![id] = storedReplay(value);
  }
  const attempts = backupRecord(source.attempts);
  if (Object.keys(attempts).length > 13) invalidBackup();
  for (const [id, value] of Object.entries(attempts)) {
    const attempt = backupRecord(value),
      game = data.round?.games.find((game) => game.id === id);
    if (!game || attempt.id !== id || attempt.mode !== game.mode)
      invalidBackup();
    const mode = backupMode(attempt.mode);
    const attemptNumber = backupNumber(
      attempt.attemptNumber,
      CERTIFICATION_POLICY.games[mode].maxAttempts,
      1,
      true,
    );
    if (
      data
        .round!.games.filter((game) => game.mode === mode)
        .findIndex((game) => game.id === id) +
        1 !==
      attemptNumber
    )
      invalidBackup();
    data.attempts[id] = {
      id,
      mode,
      attemptNumber,
      durationSeconds: backupNumber(attempt.durationSeconds, 600),
      accuracy:
        attempt.accuracy === null ? null : backupNumber(attempt.accuracy, 100),
      correct: backupNumber(attempt.correct, 100000, 0, true),
      wrong: backupNumber(attempt.wrong, 100000, 0, true),
      missed: backupNumber(attempt.missed, 100000, 0, true),
      assisted: backupNumber(attempt.assisted, 100000, 0, true),
      completed: backupBoolean(attempt.completed),
      qualifying: backupBoolean(attempt.qualifying),
      startedAt: backupDate(attempt.startedAt),
      completedAt: backupDate(attempt.completedAt),
    };
  }
  // Retain only the safe correlation identifier. Rebuild the outgoing URL and
  // payload from validated data, so a pending issued result remains recoverable.
  if (source.request !== undefined && source.request !== null) {
    const request = backupRecord(source.request);
    if (
      typeof request.requestId !== 'string' ||
      !/^[a-f0-9]{32}$/.test(request.requestId) ||
      (request.kind !== 'connect' && request.kind !== 'certify') ||
      (request.kind === 'certify' && !data.round)
    )
      throw new Error('Invalid pending GitHub request in progress backup.');
    data.request = await prepareSubmission({
      schema: 1,
      requestId: request.requestId,
      kind: request.kind,
      profile: {
        displayName: data.profile.displayName,
        country: data.profile.country,
        publicProfile: data.profile.publicProfile,
      },
      ...(request.kind === 'certify' && data.round
        ? { round: data.round }
        : {}),
    });
  }
  data.receipt = null;
  data.enabled = true;
  await accountSnapshot(data);
  return data;
}
