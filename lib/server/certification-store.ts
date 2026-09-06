import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { getD1Database } from '@/db/env';
import {
  CERTIFICATION_POLICY,
  type CertificationMode,
  type GamePurpose,
} from '@/lib/certification/policy';
import {
  CERTIFICATION_QUESTION_IDS,
  gradeCaseAnswerPrefix,
  gradeRuleAnswer,
  isGameCounters,
  scoreGame,
  type GameCounters,
} from '@/lib/certification/scoring';
import { ApiError } from './http';
import {
  ensureProfile,
  formatRefereeNumber,
  searchableName,
  type RefereeProfile,
} from './profile';

type RoundRow = {
  id: string;
  status: 'active' | 'restarted' | 'certified' | 'failed';
  ruleset_version: string;
  policy_version: string;
  round_number: number;
  created_at: number;
  ended_at: number | null;
};

type AttemptRow = {
  id: string;
  round_id: string | null;
  purpose: GamePurpose;
  mode: CertificationMode;
  attempt_no: number | null;
  seed: number;
  duration_seconds: number;
  policy_version: string;
  engine_version: string;
  status: 'active' | 'completed' | 'abandoned';
  started_at: number;
  finished_at: number | null;
  elapsed_seconds: number | null;
  correct: number | null;
  wrong: number | null;
  missed: number | null;
  assisted: number | null;
  assessed: number | null;
  accuracy: number | null;
  qualifying: number | null;
};

type CertificateRow = {
  referee_number: number;
  display_name: string;
  country_code: string | null;
  ruleset_version: string;
  policy_version: string;
  verification_code: string;
  issued_at: number;
};

type ProgressAggregate = {
  answered: number;
  first_correct: number;
};

type GameAggregate = {
  step_started: number;
  step_qualifying: number;
  step_active: number;
  continuous_started: number;
  continuous_qualifying: number;
  continuous_active: number;
};

const ROUND_COLUMNS =
  'id, status, ruleset_version, policy_version, round_number, created_at, ended_at';
const ATTEMPT_COLUMNS = `id, round_id, purpose, mode, attempt_no, seed,
  duration_seconds, policy_version, engine_version, status, started_at,
  finished_at, elapsed_seconds, correct, wrong, missed, assisted, assessed,
  accuracy, qualifying`;

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
  );
}

function iso(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

function publicRound(row: RoundRow | null) {
  return row
    ? {
        id: row.id,
        status: row.status,
        rulesetVersion: row.ruleset_version,
        policyVersion: row.policy_version,
        number: row.round_number,
        createdAt: iso(row.created_at),
        endedAt: iso(row.ended_at),
      }
    : null;
}

function publicAttempt(row: AttemptRow) {
  return {
    id: row.id,
    roundId: row.round_id,
    purpose: row.purpose,
    mode: row.mode,
    attemptNo: row.attempt_no,
    seed: row.seed,
    durationSeconds: row.duration_seconds,
    policyVersion: row.policy_version,
    engineVersion: row.engine_version,
    topics: [...CERTIFICATION_POLICY.topics],
    status: row.status,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    elapsedSeconds: row.elapsed_seconds,
    report:
      row.correct === null
        ? null
        : {
            correct: row.correct,
            wrong: row.wrong,
            missed: row.missed,
            assisted: row.assisted,
          },
    assessed: row.assessed,
    accuracy: row.accuracy,
    qualifying: row.qualifying === null ? null : row.qualifying === 1,
  };
}

function publicCertificate(row: CertificateRow | null) {
  return row
    ? {
        refereeNumber: formatRefereeNumber(row.referee_number),
        displayName: row.display_name,
        countryCode: row.country_code,
        rulesetVersion: row.ruleset_version,
        policyVersion: row.policy_version,
        verificationCode: row.verification_code,
        issuedAt: iso(row.issued_at),
      }
    : null;
}

async function activeRound(userId: string) {
  return getD1Database()
    .prepare(
      `SELECT ${ROUND_COLUMNS} FROM certification_rounds
       WHERE user_id = ? AND status = 'active' ORDER BY round_number DESC LIMIT 1`,
    )
    .bind(userId)
    .first<RoundRow>();
}

async function latestRound(userId: string) {
  return getD1Database()
    .prepare(
      `SELECT ${ROUND_COLUMNS} FROM certification_rounds
       WHERE user_id = ? ORDER BY round_number DESC LIMIT 1`,
    )
    .bind(userId)
    .first<RoundRow>();
}

function requireCurrentPolicy(round: RoundRow) {
  if (
    round.ruleset_version !== CERTIFICATION_POLICY.rulesetVersion ||
    round.policy_version !== CERTIFICATION_POLICY.policyVersion
  )
    throw new ApiError(
      409,
      'certification_policy_changed',
      'The certification policy changed. Restart certification to continue with the current policy.',
    );
}

async function latestCertificate(userId: string) {
  return getD1Database()
    .prepare(
      `SELECT referee_number, display_name, country_code, ruleset_version,
              policy_version, verification_code, issued_at
       FROM certificates
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY issued_at DESC LIMIT 1`,
    )
    .bind(userId)
    .first<CertificateRow>();
}

function gameProgress(mode: CertificationMode, aggregate: GameAggregate) {
  const rules = CERTIFICATION_POLICY.games[mode];
  const started =
    mode === 'step' ? aggregate.step_started : aggregate.continuous_started;
  const qualifying =
    mode === 'step'
      ? aggregate.step_qualifying
      : aggregate.continuous_qualifying;
  const active =
    mode === 'step' ? aggregate.step_active : aggregate.continuous_active;
  return {
    started,
    qualifying,
    active,
    required: rules.requiredQualifying,
    maxAttempts: rules.maxAttempts,
    minAccuracy: rules.minimumAccuracy,
    durationSeconds: rules.durationSeconds,
    remainingAttempts: Math.max(0, rules.maxAttempts - started),
  };
}

export async function readCertificationState(userId: string) {
  const db = getD1Database();
  const round = await latestRound(userId);
  let ruleAggregate: ProgressAggregate = { answered: 0, first_correct: 0 };
  let gameAggregate: GameAggregate = {
    step_started: 0,
    step_qualifying: 0,
    step_active: 0,
    continuous_started: 0,
    continuous_qualifying: 0,
    continuous_active: 0,
  };
  let attempts: AttemptRow[] = [];
  if (round) {
    ruleAggregate =
      (await db
        .prepare(
          `SELECT COALESCE(SUM(completed), 0) AS answered,
                  COALESCE(SUM(CASE WHEN completed = 1
                                    THEN first_correct ELSE 0 END), 0) AS first_correct
           FROM certification_rule_progress WHERE round_id = ?`,
        )
        .bind(round.id)
        .first<ProgressAggregate>()) ?? ruleAggregate;
    gameAggregate =
      (await db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN mode = 'step' THEN 1 ELSE 0 END), 0) AS step_started,
             COALESCE(SUM(CASE WHEN mode = 'step' AND qualifying = 1 THEN 1 ELSE 0 END), 0) AS step_qualifying,
             COALESCE(SUM(CASE WHEN mode = 'step' AND status = 'active' THEN 1 ELSE 0 END), 0) AS step_active,
             COALESCE(SUM(CASE WHEN mode = 'continuous' THEN 1 ELSE 0 END), 0) AS continuous_started,
             COALESCE(SUM(CASE WHEN mode = 'continuous' AND qualifying = 1 THEN 1 ELSE 0 END), 0) AS continuous_qualifying,
             COALESCE(SUM(CASE WHEN mode = 'continuous' AND status = 'active' THEN 1 ELSE 0 END), 0) AS continuous_active
           FROM game_attempts WHERE round_id = ? AND purpose = 'certification'`,
        )
        .bind(round.id)
        .first<GameAggregate>()) ?? gameAggregate;
    attempts = (
      await db
        .prepare(
          `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts
           WHERE round_id = ? ORDER BY started_at DESC LIMIT 20`,
        )
        .bind(round.id)
        .all<AttemptRow>()
    ).results;
  }
  const step = gameProgress('step', gameAggregate);
  const continuous = gameProgress('continuous', gameAggregate);
  const rulesPassed =
    ruleAggregate.answered >= CERTIFICATION_POLICY.ruleQuestionCount &&
    ruleAggregate.first_correct >= CERTIFICATION_POLICY.ruleFirstTryRequired;
  const certificate = await latestCertificate(userId);
  return {
    policy: CERTIFICATION_POLICY,
    round: publicRound(round),
    progress: {
      rulesAnswered: ruleAggregate.answered,
      rulesFirstCorrect: ruleAggregate.first_correct,
      rulesRequired: CERTIFICATION_POLICY.ruleFirstTryRequired,
      ruleQuestionCount: CERTIFICATION_POLICY.ruleQuestionCount,
      ruleFirstTryPercent: CERTIFICATION_POLICY.ruleFirstTryPercent,
      rulesPassed,
      step,
      continuous,
      eligible:
        rulesPassed &&
        step.qualifying >= step.required &&
        continuous.qualifying >= continuous.required,
    },
    attempts: attempts.map(publicAttempt),
    certificate: publicCertificate(certificate),
  };
}

export async function startCertificationRound(
  user: ChatGPTUser,
  restart: boolean,
) {
  await ensureProfile(user);
  const db = getD1Database();
  const existing = await activeRound(user.id);
  if (existing && !restart)
    throw new ApiError(
      409,
      'round_already_active',
      'A certification round is already active.',
    );
  const now = Date.now();
  const id = crypto.randomUUID();
  const roundNumber =
    (
      await db
        .prepare(
          `SELECT COALESCE(MAX(round_number), 0) + 1 AS value
         FROM certification_rounds WHERE user_id = ?`,
        )
        .bind(user.id)
        .first<{ value: number }>()
    )?.value ?? 1;
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(
      db
        .prepare(
          `UPDATE game_attempts SET status = 'abandoned', finished_at = ?
           WHERE round_id = ? AND user_id = ? AND status = 'active'`,
        )
        .bind(now, existing.id, user.id),
    );
    statements.push(
      db
        .prepare(
          `UPDATE certification_rounds SET status = 'restarted', ended_at = ?
           WHERE id = ? AND user_id = ? AND status = 'active'`,
        )
        .bind(now, existing.id, user.id),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO certification_rounds
          (id, user_id, ruleset_version, policy_version, round_number, status, created_at, ended_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, NULL)`,
      )
      .bind(
        id,
        user.id,
        CERTIFICATION_POLICY.rulesetVersion,
        CERTIFICATION_POLICY.policyVersion,
        roundNumber,
        now,
      ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error))
      throw new ApiError(
        409,
        'round_start_conflict',
        'Another certification round operation completed first. Refresh and try again.',
      );
    throw error;
  }
  return readCertificationState(user.id);
}

export async function recordRuleAnswer(
  user: ChatGPTUser,
  input: {
    questionId: string;
    answer: unknown;
    assisted: boolean;
    completed: boolean;
    purpose: GamePurpose;
    roundId?: string;
    reportedCorrect?: boolean;
  },
) {
  await ensureProfile(user);
  const casePrefix = gradeCaseAnswerPrefix(input.questionId, input.answer);
  let grade = gradeRuleAnswer(input.questionId, input.answer);
  if (casePrefix?.valid)
    grade = {
      valid: true,
      correct: casePrefix.correct,
      answerKey: casePrefix.answerKey,
    };
  if (
    !grade.valid &&
    input.purpose === 'practice' &&
    CERTIFICATION_QUESTION_IDS.has(input.questionId) &&
    typeof input.reportedCorrect === 'boolean'
  )
    grade = {
      valid: true,
      correct: input.reportedCorrect,
      answerKey: JSON.stringify(input.answer ?? null).slice(0, 4_096),
    };
  if (!grade.valid)
    throw new ApiError(
      400,
      'invalid_rule_answer',
      'The question or answer is not valid for this ruleset.',
    );
  const db = getD1Database();
  const now = Date.now();
  const completed = input.completed && (casePrefix?.complete ?? grade.correct);
  const firstCorrect = grade.correct && !input.assisted ? 1 : 0;
  let table: 'practice_rule_progress' | 'certification_rule_progress';
  let ownerColumn: 'user_id' | 'round_id';
  let ownerId: string;
  if (input.purpose === 'certification') {
    if (!input.roundId)
      throw new ApiError(
        400,
        'round_required',
        'roundId is required for certification answers.',
      );
    const round = await activeRound(user.id);
    if (!round)
      throw new ApiError(
        409,
        'no_active_round',
        'Start a certification round before submitting certification answers.',
      );
    if (input.roundId !== round.id)
      throw new ApiError(
        409,
        'wrong_round',
        'This answer belongs to another round.',
      );
    requireCurrentPolicy(round);
    table = 'certification_rule_progress';
    ownerColumn = 'round_id';
    ownerId = round.id;
  } else {
    table = 'practice_rule_progress';
    ownerColumn = 'user_id';
    ownerId = user.id;
  }

  if (input.purpose === 'certification' && casePrefix?.valid) {
    const statements = casePrefix.steps.map((step) =>
      db
        .prepare(
          `INSERT INTO certification_case_steps
            (round_id, question_id, step_index, answer_key, correct, assisted, created_at)
           SELECT round.id, ?, ?, ?, ?, ?, ?
           FROM certification_rounds round
           WHERE round.id = ? AND round.user_id = ? AND round.status = 'active'
             AND round.ruleset_version = ? AND round.policy_version = ?
           ON CONFLICT(round_id, question_id, step_index) DO NOTHING`,
        )
        .bind(
          input.questionId,
          step.index,
          step.answerKey,
          step.correct ? 1 : 0,
          input.assisted ? 1 : 0,
          now,
          ownerId,
          user.id,
          CERTIFICATION_POLICY.rulesetVersion,
          CERTIFICATION_POLICY.policyVersion,
        ),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO certification_rule_progress
            (round_id, question_id, first_answer_key, first_correct,
             first_assisted, completed, captured_steps, answer_count,
             created_at, updated_at)
           SELECT round.id, ?,
             COALESCE((
               SELECT '[' || GROUP_CONCAT(ordered.answer_key, ',') || ']'
               FROM (
                 SELECT answer_key FROM certification_case_steps
                 WHERE round_id = round.id AND question_id = ?
                 ORDER BY step_index
               ) ordered
             ), '[]'),
             CASE WHEN
               (SELECT COUNT(*) FROM certification_case_steps
                WHERE round_id = round.id AND question_id = ?) > 0
               AND NOT EXISTS (
                 SELECT 1 FROM certification_case_steps
                 WHERE round_id = round.id AND question_id = ?
                   AND (correct = 0 OR assisted = 1)
               ) THEN 1 ELSE 0 END,
             CASE WHEN EXISTS (
               SELECT 1 FROM certification_case_steps
               WHERE round_id = round.id AND question_id = ? AND assisted = 1
             ) THEN 1 ELSE 0 END,
             CASE WHEN ? = 1 AND
               (SELECT COUNT(*) FROM certification_case_steps
                WHERE round_id = round.id AND question_id = ?) = ?
             THEN 1 ELSE 0 END,
             (SELECT COUNT(*) FROM certification_case_steps
              WHERE round_id = round.id AND question_id = ?),
             1, ?, ?
           FROM certification_rounds round
           WHERE round.id = ? AND round.user_id = ? AND round.status = 'active'
             AND round.ruleset_version = ? AND round.policy_version = ?
           ON CONFLICT(round_id, question_id) DO UPDATE SET
             first_answer_key = CASE
               WHEN excluded.captured_steps > certification_rule_progress.captured_steps
               THEN excluded.first_answer_key
               ELSE certification_rule_progress.first_answer_key END,
             first_correct = excluded.first_correct,
             first_assisted = excluded.first_assisted,
             completed = MAX(certification_rule_progress.completed, excluded.completed),
             captured_steps = MAX(certification_rule_progress.captured_steps, excluded.captured_steps),
             answer_count = certification_rule_progress.answer_count + 1,
             updated_at = excluded.updated_at`,
        )
        .bind(
          input.questionId,
          input.questionId,
          input.questionId,
          input.questionId,
          input.questionId,
          completed ? 1 : 0,
          input.questionId,
          casePrefix.totalSteps,
          input.questionId,
          now,
          now,
          ownerId,
          user.id,
          CERTIFICATION_POLICY.rulesetVersion,
          CERTIFICATION_POLICY.policyVersion,
        ),
    );
    await db.batch(statements);
  } else if (input.purpose === 'certification') {
    await db
      .prepare(
        `INSERT INTO certification_rule_progress
          (round_id, question_id, first_answer_key, first_correct, first_assisted,
           completed, captured_steps, answer_count, created_at, updated_at)
         SELECT round.id, ?, ?, ?, ?, ?, 1, 1, ?, ?
         FROM certification_rounds round
         WHERE round.id = ? AND round.user_id = ? AND round.status = 'active'
           AND round.ruleset_version = ? AND round.policy_version = ?
         ON CONFLICT(round_id, question_id) DO UPDATE SET
           completed = MAX(certification_rule_progress.completed, excluded.completed),
           answer_count = certification_rule_progress.answer_count + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.questionId,
        grade.answerKey,
        firstCorrect,
        input.assisted ? 1 : 0,
        completed ? 1 : 0,
        now,
        now,
        ownerId,
        user.id,
        CERTIFICATION_POLICY.rulesetVersion,
        CERTIFICATION_POLICY.policyVersion,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO practice_rule_progress
          (user_id, question_id, first_answer_key, first_correct, first_assisted,
           completed, answer_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(user_id, question_id) DO UPDATE SET
           completed = MAX(practice_rule_progress.completed, excluded.completed),
           answer_count = practice_rule_progress.answer_count + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(
        ownerId,
        input.questionId,
        grade.answerKey,
        firstCorrect,
        input.assisted ? 1 : 0,
        completed ? 1 : 0,
        now,
        now,
      )
      .run();
  }
  const stored = await db
    .prepare(
      `SELECT first_correct, first_assisted, completed, answer_count
       FROM ${table} WHERE ${ownerColumn} = ? AND question_id = ?
         ${input.purpose === 'certification' ? "AND EXISTS (SELECT 1 FROM certification_rounds round WHERE round.id = certification_rule_progress.round_id AND round.user_id = ? AND round.status = 'active')" : ''}`,
    )
    .bind(
      ownerId,
      input.questionId,
      ...(input.purpose === 'certification' ? [user.id] : []),
    )
    .first<{
      first_correct: number;
      first_assisted: number;
      completed: number;
      answer_count: number;
    }>();
  if (!stored && input.purpose === 'certification')
    throw new ApiError(
      409,
      'round_not_active',
      'The certification round is no longer active.',
    );
  if (!stored) throw new Error('Rule answer was not stored.');
  if (input.purpose === 'certification')
    await finalizeCertificationRound(user.id, ownerId);
  return {
    result: {
      questionId: input.questionId,
      correct: grade.correct,
      assisted: input.assisted,
      firstCorrect: stored.first_correct === 1,
      firstAssisted: stored.first_assisted === 1,
      completed: stored.completed === 1,
      answerCount: stored.answer_count,
    },
    state:
      input.purpose === 'certification'
        ? await readCertificationState(user.id)
        : null,
  };
}

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 1;
}

export async function startGameAttempt(
  user: ChatGPTUser,
  mode: CertificationMode,
  purpose: GamePurpose,
  requestedDurationSeconds?: number,
  requestedRoundId?: string,
) {
  await ensureProfile(user);
  const db = getD1Database();
  const id = crypto.randomUUID();
  const seed = randomSeed();
  const now = Date.now();
  const rules = CERTIFICATION_POLICY.games[mode];
  const durationSeconds =
    purpose === 'certification'
      ? rules.durationSeconds
      : (requestedDurationSeconds ?? rules.durationSeconds);
  if (
    !Number.isSafeInteger(durationSeconds) ||
    durationSeconds < 60 ||
    durationSeconds > 3_600
  )
    throw new ApiError(
      400,
      'invalid_duration',
      'Practice duration must be between 60 and 3600 seconds.',
    );
  let roundId: string | null = null;
  let attemptNo: number | null = null;
  if (purpose === 'certification') {
    const round = await activeRound(user.id);
    if (!round)
      throw new ApiError(
        409,
        'no_active_round',
        'Start a certification round before starting a certification game.',
      );
    if (!requestedRoundId)
      throw new ApiError(
        400,
        'round_required',
        'roundId is required for certification games.',
      );
    if (requestedRoundId !== round.id)
      throw new ApiError(
        409,
        'wrong_round',
        'This game request belongs to another certification round.',
      );
    requireCurrentPolicy(round);
    roundId = round.id;
    const resumable = await db
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts
         WHERE user_id = ? AND round_id = ? AND mode = ? AND status = 'active'
         ORDER BY started_at DESC LIMIT 1`,
      )
      .bind(user.id, round.id, mode)
      .first<AttemptRow>();
    if (resumable) return { attempt: publicAttempt(resumable) };
    const count =
      (
        await db
          .prepare(
            `SELECT COUNT(*) AS value FROM game_attempts
           WHERE round_id = ? AND mode = ? AND purpose = 'certification'`,
          )
          .bind(round.id, mode)
          .first<{ value: number }>()
      )?.value ?? 0;
    if (count >= rules.maxAttempts) {
      await finalizeCertificationRound(user.id);
      throw new ApiError(
        409,
        'attempt_limit_reached',
        `The ${mode} attempt limit has been reached for this round.`,
      );
    }
    attemptNo = count + 1;
  }
  try {
    await db
      .prepare(
        `INSERT INTO game_attempts
          (id, user_id, round_id, purpose, mode, attempt_no, seed,
           duration_seconds, policy_version, engine_version, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .bind(
        id,
        user.id,
        roundId,
        purpose,
        mode,
        attemptNo,
        seed,
        durationSeconds,
        CERTIFICATION_POLICY.policyVersion,
        CERTIFICATION_POLICY.engineVersion,
        now,
      )
      .run();
  } catch (error) {
    if (purpose === 'certification' && isUniqueConstraintError(error)) {
      const raced = await db
        .prepare(
          `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts
           WHERE user_id = ? AND round_id = ? AND mode = ? AND status = 'active'
           ORDER BY attempt_no DESC LIMIT 1`,
        )
        .bind(user.id, roundId, mode)
        .first<AttemptRow>();
      if (raced) return { attempt: publicAttempt(raced) };
      throw new ApiError(
        409,
        'attempt_start_conflict',
        'Another attempt was started at the same time. Refresh and try again.',
      );
    }
    throw error;
  }
  const row = await db
    .prepare(`SELECT ${ATTEMPT_COLUMNS} FROM game_attempts WHERE id = ?`)
    .bind(id)
    .first<AttemptRow>();
  if (!row) throw new Error('Game attempt was not created.');
  return { attempt: publicAttempt(row) };
}

type TranscriptEvent = {
  tick: number;
  kind: string;
  decisionKey?: string;
  action?: string;
  target?: string;
};

function validateTranscript(value: unknown) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 2_000)
    throw new ApiError(
      400,
      'invalid_transcript',
      'The game transcript is invalid.',
    );
  let previousTick = -1;
  const cleaned: TranscriptEvent[] = value.map((entry) => {
    if (!entry || typeof entry !== 'object')
      throw new ApiError(
        400,
        'invalid_transcript',
        'The game transcript is invalid.',
      );
    const event = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(event.tick) ||
      (event.tick as number) < previousTick ||
      (event.tick as number) > 10_000_000 ||
      typeof event.kind !== 'string' ||
      event.kind.length < 1 ||
      event.kind.length > 48
    )
      throw new ApiError(
        400,
        'invalid_transcript',
        'The game transcript is invalid.',
      );
    previousTick = event.tick as number;
    const result: TranscriptEvent = {
      tick: event.tick as number,
      kind: event.kind,
    };
    for (const key of ['decisionKey', 'action', 'target'] as const) {
      const item = event[key];
      if (item !== undefined) {
        if (typeof item !== 'string' || item.length > 96)
          throw new ApiError(
            400,
            'invalid_transcript',
            'The game transcript is invalid.',
          );
        result[key] = item;
      }
    }
    return result;
  });
  const json = JSON.stringify(cleaned);
  if (json.length > 240_000)
    throw new ApiError(
      413,
      'transcript_too_large',
      'The game transcript is too large.',
    );
  return json;
}

export async function finishGameAttempt(
  user: ChatGPTUser,
  attemptId: string,
  elapsedSeconds: number,
  counters: GameCounters,
  transcript: unknown,
) {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId))
    throw new ApiError(
      404,
      'attempt_not_found',
      'The game attempt was not found.',
    );
  if (
    !Number.isSafeInteger(elapsedSeconds) ||
    elapsedSeconds < 0 ||
    elapsedSeconds > 7_200
  )
    throw new ApiError(400, 'invalid_elapsed_time', 'Elapsed time is invalid.');
  if (!isGameCounters(counters))
    throw new ApiError(400, 'invalid_report', 'The game report is invalid.');
  const totalEvents =
    counters.correct + counters.wrong + counters.missed + counters.assisted;
  if (totalEvents > 2_000)
    throw new ApiError(
      400,
      'invalid_report',
      'The game report contains too many events.',
    );
  const transcriptJson = validateTranscript(transcript);
  const db = getD1Database();
  const existing = await db
    .prepare(
      `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts WHERE id = ? AND user_id = ?`,
    )
    .bind(attemptId, user.id)
    .first<AttemptRow>();
  if (!existing)
    throw new ApiError(
      404,
      'attempt_not_found',
      'The game attempt was not found.',
    );
  if (existing.status === 'completed') {
    if (existing.purpose === 'certification')
      await finalizeCertificationRound(user.id, existing.round_id ?? undefined);
    return {
      attempt: publicAttempt(existing),
      state: await readCertificationState(user.id),
    };
  }
  if (existing.status !== 'active')
    throw new ApiError(
      409,
      'attempt_not_active',
      'The game attempt is no longer active.',
    );
  const wallSeconds = Math.floor((Date.now() - existing.started_at) / 1_000);
  if (existing.purpose === 'certification' && elapsedSeconds > wallSeconds + 5)
    throw new ApiError(
      422,
      'elapsed_time_not_plausible',
      'Certification time cannot advance faster than real time.',
    );
  const result = scoreGame(existing.mode, counters, elapsedSeconds);
  const now = Date.now();
  const update = await db
    .prepare(
      `UPDATE game_attempts SET
         status = 'completed', finished_at = ?, elapsed_seconds = ?,
         correct = ?, wrong = ?, missed = ?, assisted = ?, assessed = ?,
         accuracy = ?, qualifying = ?, transcript_json = ?
       WHERE id = ? AND user_id = ? AND status = 'active'
         AND (
           purpose = 'practice'
           OR EXISTS (
             SELECT 1 FROM certification_rounds round
             WHERE round.id = game_attempts.round_id
               AND round.user_id = ? AND round.status = 'active'
               AND round.ruleset_version = ? AND round.policy_version = ?
           )
         )`,
    )
    .bind(
      now,
      elapsedSeconds,
      counters.correct,
      counters.wrong,
      counters.missed,
      counters.assisted,
      result.assessed,
      result.accuracy,
      existing.purpose === 'certification' && result.qualifying ? 1 : 0,
      transcriptJson,
      attemptId,
      user.id,
      user.id,
      CERTIFICATION_POLICY.rulesetVersion,
      CERTIFICATION_POLICY.policyVersion,
    )
    .run();
  if (Number(update.meta.changes ?? 0) !== 1) {
    const raced = await db
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts WHERE id = ? AND user_id = ?`,
      )
      .bind(attemptId, user.id)
      .first<AttemptRow>();
    if (raced?.status === 'completed') {
      if (raced.purpose === 'certification')
        await finalizeCertificationRound(user.id, raced.round_id ?? undefined);
      return {
        attempt: publicAttempt(raced),
        state: await readCertificationState(user.id),
      };
    }
    throw new ApiError(
      409,
      'attempt_not_active',
      'The game attempt is no longer active.',
    );
  }
  if (existing.purpose === 'certification')
    await finalizeCertificationRound(user.id, existing.round_id ?? undefined);
  const completed = await db
    .prepare(
      `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts WHERE id = ? AND user_id = ?`,
    )
    .bind(attemptId, user.id)
    .first<AttemptRow>();
  if (!completed) throw new Error('Completed attempt was not found.');
  return {
    attempt: publicAttempt(completed),
    state: await readCertificationState(user.id),
  };
}

async function issueCertificateIfEligible(userId: string) {
  const round = await activeRound(userId);
  if (!round) return null;
  const db = getD1Database();
  const now = Date.now();
  const certificateId = crypto.randomUUID();
  const verificationCode = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  await db.batch([
    db
      .prepare(
        `INSERT INTO certificates
          (id, user_id, round_id, referee_number, display_name,
           display_name_search, country_code, ruleset_version, policy_version,
           verification_code, issued_at)
         SELECT ?, profile.user_id, round.id, profile.referee_number,
                profile.display_name, profile.display_name_search,
                profile.country_code, round.ruleset_version,
                round.policy_version, ?, ?
         FROM certification_rounds round
         INNER JOIN referee_profiles profile ON profile.user_id = round.user_id
         WHERE round.id = ? AND round.user_id = ? AND round.status = 'active'
           AND round.ruleset_version = ? AND round.policy_version = ?
           AND (SELECT COALESCE(SUM(progress.completed), 0)
                FROM certification_rule_progress progress
                WHERE progress.round_id = round.id) >= ?
           AND (SELECT COALESCE(SUM(CASE WHEN progress.completed = 1
                                        THEN progress.first_correct ELSE 0 END), 0)
                FROM certification_rule_progress progress
                WHERE progress.round_id = round.id) >= ?
           AND (SELECT COUNT(*) FROM game_attempts attempt
                WHERE attempt.round_id = round.id
                  AND attempt.purpose = 'certification'
                  AND attempt.mode = 'step' AND attempt.qualifying = 1) >= ?
           AND (SELECT COUNT(*) FROM game_attempts attempt
                WHERE attempt.round_id = round.id
                  AND attempt.purpose = 'certification'
                  AND attempt.mode = 'continuous' AND attempt.qualifying = 1) >= ?
         ON CONFLICT(round_id) DO NOTHING`,
      )
      .bind(
        certificateId,
        verificationCode,
        now,
        round.id,
        userId,
        CERTIFICATION_POLICY.rulesetVersion,
        CERTIFICATION_POLICY.policyVersion,
        CERTIFICATION_POLICY.ruleQuestionCount,
        CERTIFICATION_POLICY.ruleFirstTryRequired,
        CERTIFICATION_POLICY.games.step.requiredQualifying,
        CERTIFICATION_POLICY.games.continuous.requiredQualifying,
      ),
    db
      .prepare(
        `UPDATE game_attempts SET status = 'abandoned', finished_at = ?
         WHERE round_id = ? AND status = 'active'
           AND EXISTS (SELECT 1 FROM certificates WHERE round_id = ?)`,
      )
      .bind(now, round.id, round.id),
    db
      .prepare(
        `UPDATE certification_rounds SET status = 'certified', ended_at = ?
         WHERE id = ? AND user_id = ? AND status = 'active'
           AND EXISTS (SELECT 1 FROM certificates WHERE round_id = ?)`,
      )
      .bind(now, round.id, userId, round.id),
  ]);
  return latestCertificate(userId);
}

async function finalizeCertificationRound(
  userId: string,
  expectedRoundId?: string,
) {
  const round = await activeRound(userId);
  if (!round || (expectedRoundId && round.id !== expectedRoundId)) return;
  const state = await readCertificationState(userId);
  if (state.progress.eligible) {
    await issueCertificateIfEligible(userId);
    return;
  }
  const now = Date.now();
  const db = getD1Database();
  await db.batch([
    db
      .prepare(
        `UPDATE certification_rounds SET status = 'failed', ended_at = ?
         WHERE id = ? AND user_id = ? AND status = 'active'
           AND (
             ((SELECT COALESCE(SUM(progress.first_correct), 0) +
                       (? - COUNT(*))
               FROM certification_rule_progress progress
               WHERE progress.round_id = certification_rounds.id) < ?)
             OR
             ((SELECT COUNT(*) FROM game_attempts attempt
               WHERE attempt.round_id = certification_rounds.id
                 AND attempt.purpose = 'certification'
                 AND attempt.mode = 'step') >= ?
              AND
              (SELECT COUNT(*) FROM game_attempts attempt
               WHERE attempt.round_id = certification_rounds.id
                 AND attempt.mode = 'step' AND attempt.status = 'active') = 0
              AND
              (SELECT COUNT(*) FROM game_attempts attempt
               WHERE attempt.round_id = certification_rounds.id
                 AND attempt.mode = 'step' AND attempt.qualifying = 1) < ?)
             OR
             ((SELECT COUNT(*) FROM game_attempts attempt
               WHERE attempt.round_id = certification_rounds.id
                 AND attempt.purpose = 'certification'
                 AND attempt.mode = 'continuous') >= ?
              AND
              (SELECT COUNT(*) FROM game_attempts attempt
               WHERE attempt.round_id = certification_rounds.id
                 AND attempt.mode = 'continuous' AND attempt.status = 'active') = 0
              AND
              (SELECT COUNT(*) FROM game_attempts attempt
               WHERE attempt.round_id = certification_rounds.id
                 AND attempt.mode = 'continuous' AND attempt.qualifying = 1) < ?)
           )`,
      )
      .bind(
        now,
        round.id,
        userId,
        CERTIFICATION_POLICY.ruleQuestionCount,
        CERTIFICATION_POLICY.ruleFirstTryRequired,
        CERTIFICATION_POLICY.games.step.maxAttempts,
        CERTIFICATION_POLICY.games.step.requiredQualifying,
        CERTIFICATION_POLICY.games.continuous.maxAttempts,
        CERTIFICATION_POLICY.games.continuous.requiredQualifying,
      ),
    db
      .prepare(
        `UPDATE game_attempts SET status = 'abandoned', finished_at = ?
         WHERE round_id = ? AND status = 'active'
           AND EXISTS (
             SELECT 1 FROM certification_rounds
             WHERE id = ? AND status = 'failed'
           )`,
      )
      .bind(now, round.id, round.id),
  ]);
}

export async function accountEnvelope(
  user: ChatGPTUser,
  profile?: RefereeProfile,
) {
  const ensuredProfile = profile ?? (await ensureProfile(user));
  const db = getD1Database();
  const gameStats = (await db
    .prepare(
      `SELECT COUNT(*) AS games_played,
                COALESCE(SUM(CASE WHEN mode = 'step' THEN 1 ELSE 0 END), 0) AS step_games,
                COALESCE(SUM(CASE WHEN mode = 'continuous' THEN 1 ELSE 0 END), 0) AS continuous_games,
                ROUND(AVG(CASE WHEN mode = 'step' THEN accuracy END)) AS step_accuracy,
                ROUND(AVG(CASE WHEN mode = 'continuous' THEN accuracy END)) AS continuous_accuracy
         FROM game_attempts WHERE user_id = ? AND status = 'completed'`,
    )
    .bind(user.id)
    .first<{
      games_played: number;
      step_games: number;
      continuous_games: number;
      step_accuracy: number | null;
      continuous_accuracy: number | null;
    }>()) ?? {
    games_played: 0,
    step_games: 0,
    continuous_games: 0,
    step_accuracy: null,
    continuous_accuracy: null,
  };
  const practiceRules = (
    await db
      .prepare(
        `SELECT question_id FROM practice_rule_progress
         WHERE user_id = ? AND completed = 1 ORDER BY question_id`,
      )
      .bind(user.id)
      .all<{ question_id: string }>()
  ).results.map((row) => row.question_id);
  const certification = await readCertificationState(user.id);
  const round = certification.round;
  const certificationQuestionIds = round
    ? (
        await db
          .prepare(
            `SELECT question_id FROM certification_rule_progress
             WHERE round_id = ? AND completed = 1 ORDER BY question_id`,
          )
          .bind(round.id)
          .all<{ question_id: string }>()
      ).results.map((row) => row.question_id)
    : [];
  const recentPracticeRows = (
    await db
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM game_attempts
         WHERE user_id = ? AND purpose = 'practice' AND status = 'completed'
         ORDER BY finished_at DESC LIMIT 10`,
      )
      .bind(user.id)
      .all<AttemptRow>()
  ).results;
  const historyRows = (
    await db
      .prepare(
        `SELECT ${ROUND_COLUMNS} FROM certification_rounds
          WHERE user_id = ? AND status <> 'active'
          ORDER BY round_number DESC LIMIT 20`,
      )
      .bind(user.id)
      .all<RoundRow>()
  ).results;
  const stateAttempts = certification.attempts;
  const certificationRound = round
    ? {
        id: round.id,
        number: round.number,
        season: '2026',
        status:
          round.status === 'active'
            ? 'in-progress'
            : round.status === 'certified'
              ? 'qualified'
              : 'failed',
        startedAt: round.createdAt,
        completedAt: round.endedAt,
        rules: {
          answered: certification.progress.rulesAnswered,
          total: CERTIFICATION_POLICY.ruleQuestionCount,
          correctFirstTry: certification.progress.rulesFirstCorrect,
          accuracy: certification.progress.rulesAnswered
            ? Math.round(
                (10_000 * certification.progress.rulesFirstCorrect) /
                  certification.progress.rulesAnswered,
              ) / 100
            : null,
          requiredAccuracy: CERTIFICATION_POLICY.ruleFirstTryPercent,
          passed: certification.progress.rulesPassed,
          answeredQuestionIds: certificationQuestionIds,
        },
        step: accountGameProgress(
          'step',
          certification.progress.step,
          stateAttempts,
        ),
        continuous: accountGameProgress(
          'continuous',
          certification.progress.continuous,
          stateAttempts,
        ),
      }
    : null;
  return {
    authenticated: true,
    profile: {
      id: formatRefereeNumber(ensuredProfile.refereeNumber),
      email: '',
      displayName: ensuredProfile.displayName,
      country: ensuredProfile.countryCode ?? '',
      refereeNumber: formatRefereeNumber(ensuredProfile.refereeNumber),
      publicProfile: ensuredProfile.publicListing,
      createdAt: ensuredProfile.createdAt,
    },
    practice: {
      ruleChecksCompleted: practiceRules.length,
      ruleChecksTotal: CERTIFICATION_POLICY.ruleQuestionCount,
      completedQuestionIds: practiceRules,
      refereeGamesPlayed: gameStats.games_played,
      stepGamesPlayed: gameStats.step_games,
      continuousGamesPlayed: gameStats.continuous_games,
      stepAccuracy: gameStats.step_accuracy,
      continuousAccuracy: gameStats.continuous_accuracy,
    },
    certification: certificationRound,
    recentGames: recentPracticeRows.map((attempt) => ({
      id: attempt.id,
      mode: attempt.mode,
      durationSeconds: attempt.duration_seconds,
      accuracy: attempt.accuracy,
      completedAt: iso(attempt.finished_at),
    })),
    certificationHistory: historyRows.map((item) => ({
      id: item.id,
      roundNumber: item.round_number,
      season: '2026',
      status:
        item.status === 'active'
          ? 'in-progress'
          : item.status === 'certified'
            ? 'qualified'
            : item.status === 'restarted'
              ? 'restarted'
              : 'failed',
      startedAt: iso(item.created_at),
      completedAt: iso(item.ended_at),
    })),
    certificate: certification.certificate,
  };
}

function accountGameProgress(
  mode: CertificationMode,
  progress: {
    started: number;
    qualifying: number;
    required: number;
    maxAttempts: number;
    minAccuracy: number;
    durationSeconds: number;
  },
  attempts: ReturnType<typeof publicAttempt>[],
) {
  return {
    mode,
    requiredGames: progress.required,
    qualifyingGames: progress.qualifying,
    attemptsUsed: progress.started,
    attemptsAllowed: progress.maxAttempts,
    requiredAccuracy: progress.minAccuracy,
    durationSeconds: progress.durationSeconds,
    passed: progress.qualifying >= progress.required,
    attempts: attempts
      .filter((attempt) => attempt.mode === mode)
      .map((attempt) => ({
        id: attempt.id,
        mode: attempt.mode,
        attemptNumber: attempt.attemptNo ?? 0,
        durationSeconds: attempt.durationSeconds,
        accuracy: attempt.accuracy,
        correct: attempt.report?.correct ?? 0,
        wrong: attempt.report?.wrong ?? 0,
        missed: attempt.report?.missed ?? 0,
        assisted: attempt.report?.assisted ?? 0,
        completed: attempt.status === 'completed',
        qualifying: attempt.qualifying === true,
        startedAt: attempt.startedAt,
        completedAt: attempt.finishedAt,
      })),
  };
}

export async function listPublicReferees(input: {
  query: string;
  limit: number;
  cursor: number;
}) {
  const db = getD1Database();
  const query = searchableName(input.query).replace(/[%_]/g, '');
  const pattern = `${query}%`;
  const result = await db
    .prepare(
      `SELECT c.referee_number, p.display_name, p.country_code,
              c.ruleset_version, c.verification_code, c.issued_at
       FROM certificates c
       INNER JOIN referee_profiles p ON p.user_id = c.user_id
       WHERE c.revoked_at IS NULL
         AND p.public_listing = 1
         AND c.referee_number > ?
         AND c.issued_at = (
           SELECT MAX(newest.issued_at) FROM certificates newest
           WHERE newest.user_id = c.user_id AND newest.revoked_at IS NULL
         )
          AND (? = '' OR p.display_name_search LIKE ?
              OR LOWER(printf('RCJ-2026-%06d', c.referee_number)) LIKE ?)
       ORDER BY c.referee_number ASC
       LIMIT ?`,
    )
    .bind(input.cursor, query, pattern, pattern, input.limit + 1)
    .all<CertificateRow>();
  const rows = result.results;
  const hasMore = rows.length > input.limit;
  const visible = rows.slice(0, input.limit);
  const mapped = visible.map((row) => ({
    refereeNumber: formatRefereeNumber(row.referee_number),
    displayName: row.display_name,
    country: row.country_code ?? '',
    season: '2026',
    certifiedAt: iso(row.issued_at),
    status: 'certified' as const,
    verificationCode: row.verification_code,
  }));
  const countResult = await db
    .prepare(
      `SELECT COUNT(*) AS value FROM certificates c
       INNER JOIN referee_profiles p ON p.user_id = c.user_id
       WHERE c.revoked_at IS NULL AND p.public_listing = 1
         AND c.issued_at = (
           SELECT MAX(newest.issued_at) FROM certificates newest
           WHERE newest.user_id = c.user_id AND newest.revoked_at IS NULL
         )
          AND (? = '' OR p.display_name_search LIKE ?
              OR LOWER(printf('RCJ-2026-%06d', c.referee_number)) LIKE ?)`,
    )
    .bind(query, pattern, pattern)
    .first<{ value: number }>();
  return {
    referees: mapped,
    items: mapped,
    total: countResult?.value ?? mapped.length,
    nextCursor: hasMore ? String(visible.at(-1)!.referee_number) : null,
  };
}
