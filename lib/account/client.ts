import type {
  AccountActionResult,
  AccountProfile,
  AccountProfilePatch,
  AccountSnapshot,
  CertificationGameAttempt,
  CertificationGameLaunch,
  CertificationHistoryEntry,
  CertificationMode,
  CertificationRound,
  CertificationStatus,
  CertifiedReferee,
  CertifiedRefereeDirectory,
  FinishGamePayload,
  GameCertificationProgress,
  PracticeGame,
  PracticeStats,
  RulesCertificationProgress,
  StartGamePayload,
} from './types';
import type { RuleLearningEvent } from '@/lib/certification/client-types';

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const strings = (value: unknown) =>
  array(value).filter((entry): entry is string => typeof entry === 'string');
const first = (source: JsonRecord, ...keys: string[]) => {
  for (const key of keys) if (source[key] !== undefined) return source[key];
  return undefined;
};
const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;
const finite = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const count = (value: unknown, fallback = 0) =>
  Math.max(0, Math.floor(finite(value, fallback)));
const percent = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = finite(value, Number.NaN);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed));
};
const truthy = (value: unknown, fallback = false) =>
  typeof value === 'boolean'
    ? value
    : value == null
      ? fallback
      : Boolean(value);
const iso = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
};
const mode = (value: unknown): CertificationMode =>
  value === 'continuous' ? 'continuous' : 'step';
const status = (value: unknown): CertificationStatus => {
  if (value === 'qualified' || value === 'certified' || value === 'passed')
    return 'qualified';
  if (value === 'failed' || value === 'exhausted') return 'failed';
  if (value === 'restarted') return 'restarted';
  if (value === 'in-progress' || value === 'active' || value === 'started')
    return 'in-progress';
  return 'not-started';
};

function nested(source: JsonRecord, ...keys: string[]) {
  return record(first(source, ...keys));
}

function normalizeProfile(value: unknown): AccountProfile | null {
  const source = record(value);
  const id = text(first(source, 'id', 'userId', 'user_id'));
  const email = text(first(source, 'email', 'emailAddress', 'email_address'));
  const refereeNumber = text(
    first(
      source,
      'refereeNumber',
      'referee_number',
      'refereeId',
      'publicId',
      'public_id',
    ),
  );
  const displayName = text(
    first(source, 'displayName', 'display_name', 'name', 'username'),
  );
  if (!id && !email && !refereeNumber && !displayName) return null;
  return {
    id,
    email,
    displayName: displayName || refereeNumber || 'Referee',
    country: text(first(source, 'country', 'countryCode', 'country_code')),
    refereeNumber,
    publicProfile: truthy(
      first(source, 'publicProfile', 'public_profile', 'listed'),
      false,
    ),
    createdAt: iso(first(source, 'createdAt', 'created_at')),
  };
}

function normalizePractice(value: unknown): PracticeStats {
  const source = record(value);
  const rules = nested(source, 'rules', 'ruleProgress', 'rule_progress');
  const step = nested(source, 'step', 'stepMode', 'step_mode');
  const continuous = nested(
    source,
    'continuous',
    'continuousMode',
    'continuous_mode',
  );
  const stepGames = count(
    first(step, 'gamesPlayed', 'games_played', 'games'),
    count(first(source, 'stepGamesPlayed', 'step_games_played', 'stepGames')),
  );
  const continuousGames = count(
    first(continuous, 'gamesPlayed', 'games_played', 'games'),
    count(
      first(
        source,
        'continuousGamesPlayed',
        'continuous_games_played',
        'continuousGames',
      ),
    ),
  );
  return {
    ruleChecksCompleted: count(
      first(rules, 'completed', 'answered', 'passed'),
      count(
        first(
          source,
          'ruleChecksCompleted',
          'rule_checks_completed',
          'rulesCompleted',
        ),
      ),
    ),
    ruleChecksTotal: count(
      first(rules, 'total', 'available'),
      count(
        first(
          source,
          'ruleChecksTotal',
          'rule_checks_total',
          'ruleQuestionCount',
        ),
      ),
    ),
    refereeGamesPlayed: count(
      first(
        source,
        'refereeGamesPlayed',
        'referee_games_played',
        'gamesPlayed',
      ),
      stepGames + continuousGames,
    ),
    stepGamesPlayed: stepGames,
    continuousGamesPlayed: continuousGames,
    stepAccuracy: percent(
      first(step, 'accuracy', 'averageAccuracy', 'average_accuracy') ??
        first(source, 'stepAccuracy', 'step_accuracy', 'averageAccuracy'),
    ),
    continuousAccuracy: percent(
      first(continuous, 'accuracy', 'averageAccuracy', 'average_accuracy') ??
        first(
          source,
          'continuousAccuracy',
          'continuous_accuracy',
          'averageAccuracy',
        ),
    ),
    completedQuestionIds: strings(
      first(
        rules,
        'completedQuestionIds',
        'completed_question_ids',
        'completedSituationIds',
        'completed_situation_ids',
        'questionIds',
      ) ??
        first(
          source,
          'completedQuestionIds',
          'completed_question_ids',
          'completedSituationIds',
          'completed_situation_ids',
        ),
    ),
  };
}

function normalizeRules(value: unknown): RulesCertificationProgress {
  const source = record(value);
  const answered = count(first(source, 'answered', 'attempted', 'completed'));
  const total = count(
    first(source, 'total', 'questionCount', 'question_count'),
  );
  const correctFirstTry = count(
    first(source, 'correctFirstTry', 'correct_first_try', 'correct'),
  );
  const accuracy = percent(first(source, 'accuracy', 'firstTryAccuracy'));
  const requiredAccuracy =
    percent(
      first(source, 'requiredAccuracy', 'required_accuracy', 'threshold'),
    ) ?? 95;
  return {
    answered,
    total,
    correctFirstTry,
    accuracy:
      accuracy ?? (answered ? (correctFirstTry / answered) * 100 : null),
    requiredAccuracy,
    passed: truthy(
      first(source, 'passed', 'qualified'),
      total > 0 &&
        answered >= total &&
        correctFirstTry / total >= requiredAccuracy / 100,
    ),
    answeredQuestionIds: strings(
      first(
        source,
        'answeredQuestionIds',
        'answered_question_ids',
        'questionIds',
        'question_ids',
        'answeredIds',
      ),
    ),
  };
}

function normalizeAttempt(
  value: unknown,
  fallbackMode: CertificationMode,
  index: number,
): CertificationGameAttempt {
  const source = record(value);
  const accuracy = percent(first(source, 'accuracy', 'score'));
  const completedAt = iso(
    first(source, 'completedAt', 'completed_at', 'endedAt'),
  );
  return {
    id: text(
      first(source, 'id', 'attemptId', 'attempt_id'),
      `${fallbackMode}-${index + 1}`,
    ),
    mode: mode(first(source, 'mode', 'trainingMode') ?? fallbackMode),
    attemptNumber: count(
      first(source, 'attemptNumber', 'attempt_number', 'number'),
      index + 1,
    ),
    durationSeconds: count(
      first(source, 'durationSeconds', 'duration_seconds', 'duration'),
      600,
    ),
    accuracy,
    correct: count(first(source, 'correct')),
    wrong: count(first(source, 'wrong')),
    missed: count(first(source, 'missed')),
    assisted: count(first(source, 'assisted')),
    completed: truthy(
      first(source, 'completed', 'finished'),
      Boolean(completedAt),
    ),
    qualifying: truthy(
      first(source, 'qualifying', 'qualified', 'passed'),
      false,
    ),
    startedAt: iso(first(source, 'startedAt', 'started_at')),
    completedAt,
  };
}

function normalizeGameProgress(
  value: unknown,
  fallbackMode: CertificationMode,
): GameCertificationProgress {
  const source = record(value);
  const attempts = array(first(source, 'attempts', 'games', 'history')).map(
    (entry, index) => normalizeAttempt(entry, fallbackMode, index),
  );
  const defaults =
    fallbackMode === 'step'
      ? { requiredGames: 5, attemptsAllowed: 8, requiredAccuracy: 90 }
      : { requiredGames: 2, attemptsAllowed: 5, requiredAccuracy: 80 };
  const qualifyingGames = count(
    first(source, 'qualifyingGames', 'qualifying_games', 'completedGames'),
    attempts.filter((entry) => entry.qualifying).length,
  );
  const requiredGames = count(
    first(source, 'requiredGames', 'required_games'),
    defaults.requiredGames,
  );
  return {
    mode: fallbackMode,
    requiredGames,
    qualifyingGames,
    attemptsUsed: count(
      first(source, 'attemptsUsed', 'attempts_used', 'started'),
      attempts.length,
    ),
    attemptsAllowed: count(
      first(source, 'attemptsAllowed', 'attempts_allowed', 'maxAttempts'),
      defaults.attemptsAllowed,
    ),
    requiredAccuracy:
      percent(
        first(
          source,
          'requiredAccuracy',
          'required_accuracy',
          'threshold',
          'minAccuracy',
        ),
      ) ?? defaults.requiredAccuracy,
    durationSeconds: count(
      first(source, 'durationSeconds', 'duration_seconds', 'duration'),
      600,
    ),
    passed: truthy(
      first(source, 'passed', 'qualified'),
      qualifyingGames >= requiredGames,
    ),
    attempts,
  };
}

function normalizeRound(value: unknown): CertificationRound | null {
  const envelope = record(value);
  if (!Object.keys(envelope).length) return null;
  const embeddedRound = first(envelope, 'round');
  const certificate = nested(envelope, 'certificate');
  if (
    embeddedRound == null &&
    'round' in envelope &&
    !Object.keys(certificate).length
  )
    return null;
  const source = embeddedRound === undefined ? envelope : record(embeddedRound);
  const progress = nested(envelope, 'progress');
  const policy = nested(envelope, 'policy');
  const attempts = array(first(envelope, 'attempts'));
  const flatRules = {
    answered: first(progress, 'rulesAnswered', 'rules_answered'),
    total: first(
      progress,
      'ruleQuestionCount',
      'rulesRequired',
      'rules_required',
    ),
    correctFirstTry: first(
      progress,
      'rulesFirstCorrect',
      'rules_first_correct',
    ),
    accuracy: first(progress, 'rulesAccuracy', 'rules_accuracy'),
    requiredAccuracy: first(
      policy,
      'rulesAccuracy',
      'rules_accuracy',
      'rulesMinAccuracy',
      'ruleFirstTryPercent',
    ),
    passed: first(progress, 'rulesPassed', 'rules_passed'),
    answeredQuestionIds: first(
      progress,
      'answeredQuestionIds',
      'answered_question_ids',
      'rulesAnsweredQuestionIds',
    ),
  };
  const stepSource = {
    ...record(first(progress, 'step')),
    attempts: attempts.filter(
      (entry) => mode(first(record(entry), 'mode')) === 'step',
    ),
  };
  const continuousSource = {
    ...record(first(progress, 'continuous')),
    attempts: attempts.filter(
      (entry) => mode(first(record(entry), 'mode')) === 'continuous',
    ),
  };
  const roundStatus = Object.keys(certificate).length
    ? 'qualified'
    : status(first(source, 'status', 'state'));
  return {
    id: text(first(source, 'id', 'roundId', 'round_id')),
    number: count(first(source, 'number', 'roundNumber', 'round_number'), 1),
    season: text(
      first(source, 'season', 'rulesVersion', 'rules_version'),
      '2026',
    ),
    status: roundStatus,
    startedAt: iso(first(source, 'startedAt', 'started_at')),
    completedAt: iso(first(source, 'completedAt', 'completed_at')),
    rules: normalizeRules(
      first(source, 'rules', 'ruleProgress', 'rule_progress') ??
        (Object.keys(progress).length ? flatRules : undefined),
    ),
    step: normalizeGameProgress(
      first(source, 'step', 'stepMode', 'step_mode') ??
        (Object.keys(progress).length ? stepSource : undefined),
      'step',
    ),
    continuous: normalizeGameProgress(
      first(source, 'continuous', 'continuousMode', 'continuous_mode') ??
        (Object.keys(progress).length ? continuousSource : undefined),
      'continuous',
    ),
  };
}

function normalizePracticeGame(value: unknown, index: number): PracticeGame {
  const source = record(value);
  return {
    id: text(first(source, 'id', 'gameId', 'game_id'), `game-${index + 1}`),
    mode: mode(first(source, 'mode', 'trainingMode', 'training_mode')),
    durationSeconds: count(
      first(source, 'durationSeconds', 'duration_seconds', 'duration'),
    ),
    accuracy: percent(first(source, 'accuracy', 'score')),
    completedAt: iso(first(source, 'completedAt', 'completed_at', 'playedAt')),
  };
}

function normalizeHistory(
  value: unknown,
  index: number,
): CertificationHistoryEntry {
  const source = record(value);
  return {
    id: text(first(source, 'id', 'roundId', 'round_id'), `round-${index + 1}`),
    roundNumber: count(
      first(source, 'roundNumber', 'round_number', 'number'),
      index + 1,
    ),
    season: text(
      first(source, 'season', 'rulesVersion', 'rules_version'),
      '2026',
    ),
    status: status(first(source, 'status', 'state')),
    startedAt: iso(first(source, 'startedAt', 'started_at')),
    completedAt: iso(first(source, 'completedAt', 'completed_at')),
  };
}

export function normalizeAccountResponse(value: unknown): AccountSnapshot {
  const root = record(value);
  const payload = nested(root, 'data');
  const source = Object.keys(payload).length ? payload : root;
  const account = nested(source, 'account', 'user');
  const user = nested(source, 'user');
  const profileRecord = record(
    first(source, 'profile') ?? first(account, 'profile'),
  );
  const profileSource = {
    ...account,
    ...user,
    ...profileRecord,
    displayName:
      first(profileRecord, 'displayName', 'display_name', 'name') ??
      first(user, 'displayName', 'display_name', 'fullName', 'name'),
    publicProfile:
      first(
        profileRecord,
        'publicProfile',
        'public_profile',
        'publicListing',
        'public_listing',
        'listed',
      ) ?? false,
  };
  const profile = normalizeProfile(profileSource);
  const authenticated = truthy(
    first(source, 'authenticated', 'signedIn', 'signed_in'),
    Boolean(profile),
  );
  const certification =
    first(source, 'certification', 'currentRound', 'current_round') ??
    first(account, 'certification', 'currentRound', 'current_round');
  const recentGames =
    first(source, 'recentGames', 'recent_games', 'games') ??
    first(account, 'recentGames', 'recent_games', 'games');
  const certificationHistory =
    first(source, 'certificationHistory', 'certification_history', 'rounds') ??
    first(account, 'certificationHistory', 'certification_history', 'rounds');
  const links = nested(source, 'links', 'authLinks', 'auth_links');
  return {
    authenticated,
    profile: authenticated ? profile : null,
    practice: normalizePractice(
      first(
        source,
        'practice',
        'practiceStats',
        'practice_stats',
        'progress',
        'stats',
      ) ??
        first(
          account,
          'practice',
          'practiceStats',
          'practice_stats',
          'progress',
          'stats',
        ),
    ),
    certification: normalizeRound(certification),
    recentGames: array(recentGames).map(normalizePracticeGame),
    certificationHistory: array(certificationHistory).map(normalizeHistory),
    links: {
      signIn: text(first(links, 'signIn', 'sign_in')) || null,
      signOut: text(first(links, 'signOut', 'sign_out')) || null,
    },
  };
}

export function normalizeCertificationResponse(value: unknown) {
  const root = record(value);
  const data = nested(root, 'data');
  const source = Object.keys(data).length ? data : root;
  const state = nested(source, 'state');
  return normalizeRound(Object.keys(state).length ? state : source);
}

function normalizeReferee(value: unknown): CertifiedReferee | null {
  const source = record(value);
  const refereeNumber = text(
    first(source, 'refereeNumber', 'referee_number', 'refereeId', 'publicId'),
  );
  const displayName = text(
    first(source, 'displayName', 'display_name', 'name', 'username'),
  );
  if (!refereeNumber && !displayName) return null;
  const rawStatus = text(first(source, 'status', 'state')).toLowerCase();
  return {
    refereeNumber,
    displayName: displayName || 'Certified referee',
    country: text(first(source, 'country', 'countryCode', 'country_code')),
    season: text(
      first(
        source,
        'season',
        'rulesVersion',
        'rules_version',
        'rulesetVersion',
        'ruleset_version',
      ),
      '2026',
    ),
    certifiedAt: iso(
      first(
        source,
        'certifiedAt',
        'certified_at',
        'issuedAt',
        'issued_at',
        'completedAt',
      ),
    ),
    status:
      rawStatus === 'expired'
        ? 'expired'
        : rawStatus === 'certified' || rawStatus === 'qualified' || !rawStatus
          ? 'certified'
          : 'unknown',
    verificationCode: text(
      first(source, 'verificationCode', 'verification_code'),
    ),
  };
}

export function normalizeDirectoryResponse(
  value: unknown,
): CertifiedRefereeDirectory {
  const root = record(value);
  const payload = nested(root, 'data');
  const source = Object.keys(payload).length ? payload : root;
  const rows = array(first(source, 'referees', 'results', 'items', 'data'));
  const referees = rows
    .map(normalizeReferee)
    .filter((entry): entry is CertifiedReferee => Boolean(entry));
  return {
    referees,
    total: count(first(source, 'total', 'count'), referees.length),
    nextCursor: text(first(source, 'nextCursor', 'next_cursor')) || null,
  };
}

export class AccountApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'AccountApiError';
  }
}

function endpoint(baseUrl: string, path: string) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function request(baseUrl: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(endpoint(baseUrl, path), {
    credentials: 'include',
    ...init,
    headers,
  });
  let body: unknown = null;
  if (response.status !== 204) {
    const contentType = response.headers.get('content-type') ?? '';
    body = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);
  }
  if (!response.ok) {
    const details = record(body);
    const nestedError = nested(details, 'error');
    throw new AccountApiError(
      text(
        first(details, 'message') ?? first(nestedError, 'message'),
        `Request failed (${response.status})`,
      ),
      response.status,
      text(first(details, 'code') ?? first(nestedError, 'code')) || null,
    );
  }
  return body;
}

function actionResult(value: unknown): AccountActionResult {
  const source = record(value);
  return {
    data: normalizeAccountResponse(value),
    message: text(first(source, 'message')) || null,
  };
}

export async function getAccount(baseUrl = '', signal?: AbortSignal) {
  return normalizeAccountResponse(
    await request(baseUrl, '/api/account', { signal }),
  );
}

export async function getCertificationState(
  baseUrl = '',
  signal?: AbortSignal,
) {
  return normalizeCertificationResponse(
    await request(baseUrl, '/api/certification/state', { signal }),
  );
}

export async function patchAccount(patch: AccountProfilePatch, baseUrl = '') {
  return actionResult(
    await request(baseUrl, '/api/account', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: patch.displayName,
        countryCode: patch.country,
        publicListing: patch.publicProfile,
      }),
    }),
  );
}

export async function startCertification(baseUrl = '') {
  return actionResult(
    await request(baseUrl, '/api/certification/start', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );
}

export async function restartCertification(baseUrl = '') {
  return actionResult(
    await request(baseUrl, '/api/certification/restart', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  );
}

type PersistableRuleEvent = Extract<
  RuleLearningEvent,
  { type: 'answer' | 'complete' }
>;

function canonicalRuleAnswer(event: PersistableRuleEvent) {
  if (event.answer.kind === 'clip') return event.answer.selectedIndex;
  if (event.answer.kind === 'scenario') return event.answer.choiceId;
  return event.answer.calls;
}

export async function submitRuleLearningEvent(
  event: PersistableRuleEvent,
  baseUrl = '',
) {
  return request(baseUrl, '/api/certification/rules/answer', {
    method: 'POST',
    body: JSON.stringify({
      ...(event.certificationRunId
        ? { roundId: event.certificationRunId }
        : {}),
      purpose: event.mode,
      questionId: event.questionId,
      answer: canonicalRuleAnswer(event),
      assisted: event.assisted,
      completed: event.type === 'complete' || event.completed,
    }),
  });
}

export async function startCertificationGame(
  payload: StartGamePayload,
  baseUrl = '',
): Promise<CertificationGameLaunch> {
  const value = await request(baseUrl, '/api/certification/games/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const root = record(value);
  const data = nested(root, 'data');
  const envelope = Object.keys(data).length ? data : root;
  const attempt = nested(envelope, 'attempt');
  const source = Object.keys(attempt).length ? attempt : envelope;
  return {
    attemptId: text(first(source, 'attemptId', 'attempt_id', 'id')),
    roundId: text(first(source, 'roundId', 'round_id'), payload.roundId ?? ''),
    mode: mode(first(source, 'mode') ?? payload.mode),
    seed: count(first(source, 'seed')),
    durationSeconds: count(
      first(source, 'durationSeconds', 'duration_seconds', 'duration'),
      600,
    ),
    topics: array(first(source, 'topics')).filter(
      (entry): entry is string => typeof entry === 'string',
    ),
    startedAt: iso(first(source, 'startedAt', 'started_at')),
    clientSessionId:
      text(
        first(source, 'clientSessionId', 'client_session_id') ??
          first(envelope, 'clientSessionId', 'client_session_id'),
      ) || null,
  };
}

export async function finishCertificationGame(
  attemptId: string,
  payload: FinishGamePayload,
  baseUrl = '',
) {
  return actionResult(
    await request(
      baseUrl,
      `/api/certification/games/${encodeURIComponent(attemptId)}/finish`,
      {
        method: 'POST',
        body: JSON.stringify({
          elapsedSeconds: Math.round(payload.elapsedSeconds),
          report: {
            correct: payload.correct,
            wrong: payload.wrong,
            missed: payload.missed,
            assisted: payload.assisted,
            accuracy: payload.accuracy,
          },
          ...(payload.decisionLog ? { transcript: payload.decisionLog } : {}),
          ...(payload.purpose ? { purpose: payload.purpose } : {}),
        }),
      },
    ),
  );
}

export async function getCertifiedReferees(
  query = '',
  baseUrl = '',
  signal?: AbortSignal,
  cursor?: string | null,
) {
  const search = new URLSearchParams();
  if (query.trim()) search.set('q', query.trim());
  if (cursor) search.set('cursor', cursor);
  const suffix = search.size ? `?${search}` : '';
  return normalizeDirectoryResponse(
    await request(baseUrl, `/api/referees${suffix}`, {
      signal,
      credentials: 'omit',
    }),
  );
}
