import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const refereeProfiles = sqliteTable(
  'referee_profiles',
  {
    refereeNumber: integer('referee_number').primaryKey({
      autoIncrement: true,
    }),
    userId: text('user_id').notNull().unique(),
    displayName: text('display_name').notNull(),
    displayNameSearch: text('display_name_search').notNull(),
    countryCode: text('country_code'),
    publicListing: integer('public_listing', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('profile_name_search_idx').on(table.displayNameSearch),
    check(
      'profile_public_listing_boolean',
      sql`${table.publicListing} IN (0, 1)`,
    ),
  ],
);

export const practiceRuleProgress = sqliteTable(
  'practice_rule_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => refereeProfiles.userId, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    firstAnswerKey: text('first_answer_key').notNull(),
    firstCorrect: integer('first_correct', { mode: 'boolean' }).notNull(),
    firstAssisted: integer('first_assisted', { mode: 'boolean' }).notNull(),
    completed: integer('completed', { mode: 'boolean' }).notNull(),
    answerCount: integer('answer_count').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.questionId] }),
    check(
      'practice_first_correct_boolean',
      sql`${table.firstCorrect} IN (0, 1)`,
    ),
    check(
      'practice_first_assisted_boolean',
      sql`${table.firstAssisted} IN (0, 1)`,
    ),
    check('practice_completed_boolean', sql`${table.completed} IN (0, 1)`),
  ],
);

export const certificationRounds = sqliteTable(
  'certification_rounds',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => refereeProfiles.userId, { onDelete: 'cascade' }),
    rulesetVersion: text('ruleset_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    roundNumber: integer('round_number').notNull(),
    status: text('status', {
      enum: ['active', 'restarted', 'certified', 'failed'],
    }).notNull(),
    createdAt: integer('created_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (table) => [
    index('certification_round_user_idx').on(table.userId, table.createdAt),
    uniqueIndex('one_active_certification_round_per_user')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('certification_round_number_unique').on(
      table.userId,
      table.roundNumber,
    ),
    check(
      'certification_round_status_valid',
      sql`${table.status} IN ('active', 'restarted', 'certified', 'failed')`,
    ),
  ],
);

export const certificationRuleProgress = sqliteTable(
  'certification_rule_progress',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => certificationRounds.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    firstAnswerKey: text('first_answer_key').notNull(),
    firstCorrect: integer('first_correct', { mode: 'boolean' }).notNull(),
    firstAssisted: integer('first_assisted', { mode: 'boolean' }).notNull(),
    completed: integer('completed', { mode: 'boolean' }).notNull(),
    capturedSteps: integer('captured_steps').notNull().default(1),
    answerCount: integer('answer_count').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.questionId] }),
    index('certification_rule_round_idx').on(table.roundId),
    check(
      'cert_rule_first_correct_boolean',
      sql`${table.firstCorrect} IN (0, 1)`,
    ),
    check(
      'cert_rule_first_assisted_boolean',
      sql`${table.firstAssisted} IN (0, 1)`,
    ),
    check('cert_rule_completed_boolean', sql`${table.completed} IN (0, 1)`),
    check('cert_rule_captured_steps_valid', sql`${table.capturedSteps} >= 1`),
  ],
);

export const certificationCaseSteps = sqliteTable(
  'certification_case_steps',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => certificationRounds.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    answerKey: text('answer_key').notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    assisted: integer('assisted', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.questionId, table.stepIndex] }),
    index('certification_case_step_round_idx').on(
      table.roundId,
      table.questionId,
    ),
    check('cert_case_step_index_valid', sql`${table.stepIndex} >= 0`),
    check('cert_case_correct_boolean', sql`${table.correct} IN (0, 1)`),
    check('cert_case_assisted_boolean', sql`${table.assisted} IN (0, 1)`),
  ],
);

export const gameAttempts = sqliteTable(
  'game_attempts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => refereeProfiles.userId, { onDelete: 'cascade' }),
    roundId: text('round_id').references(() => certificationRounds.id, {
      onDelete: 'cascade',
    }),
    purpose: text('purpose', { enum: ['practice', 'certification'] }).notNull(),
    mode: text('mode', { enum: ['step', 'continuous'] }).notNull(),
    attemptNo: integer('attempt_no'),
    seed: integer('seed').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    policyVersion: text('policy_version').notNull(),
    engineVersion: text('engine_version').notNull(),
    status: text('status', {
      enum: ['active', 'completed', 'abandoned'],
    }).notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    elapsedSeconds: integer('elapsed_seconds'),
    correct: integer('correct'),
    wrong: integer('wrong'),
    missed: integer('missed'),
    assisted: integer('assisted'),
    assessed: integer('assessed'),
    accuracy: integer('accuracy'),
    qualifying: integer('qualifying', { mode: 'boolean' }),
    transcriptJson: text('transcript_json'),
  },
  (table) => [
    uniqueIndex('certification_attempt_number_unique').on(
      table.roundId,
      table.mode,
      table.attemptNo,
    ),
    index('game_attempt_user_idx').on(table.userId, table.startedAt),
    index('game_attempt_round_idx').on(table.roundId, table.mode),
    check(
      'game_attempt_purpose_valid',
      sql`${table.purpose} IN ('practice', 'certification')`,
    ),
    check(
      'game_attempt_mode_valid',
      sql`${table.mode} IN ('step', 'continuous')`,
    ),
    check(
      'game_attempt_status_valid',
      sql`${table.status} IN ('active', 'completed', 'abandoned')`,
    ),
    check(
      'game_attempt_qualifying_boolean',
      sql`${table.qualifying} IS NULL OR ${table.qualifying} IN (0, 1)`,
    ),
    check(
      'game_attempt_round_binding_valid',
      sql`(${table.purpose} = 'practice' AND ${table.roundId} IS NULL AND ${table.attemptNo} IS NULL)
          OR (${table.purpose} = 'certification' AND ${table.roundId} IS NOT NULL AND ${table.attemptNo} > 0)`,
    ),
    check(
      'game_attempt_duration_valid',
      sql`${table.durationSeconds} BETWEEN 60 AND 3600`,
    ),
  ],
);

export const certificates = sqliteTable(
  'certificates',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => refereeProfiles.userId, { onDelete: 'cascade' }),
    roundId: text('round_id')
      .notNull()
      .unique()
      .references(() => certificationRounds.id, { onDelete: 'restrict' }),
    refereeNumber: integer('referee_number')
      .notNull()
      .references(() => refereeProfiles.refereeNumber, {
        onDelete: 'restrict',
      }),
    displayName: text('display_name').notNull(),
    displayNameSearch: text('display_name_search').notNull(),
    countryCode: text('country_code'),
    rulesetVersion: text('ruleset_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    verificationCode: text('verification_code').notNull().unique(),
    issuedAt: integer('issued_at').notNull(),
    revokedAt: integer('revoked_at'),
    revocationReason: text('revocation_reason'),
  },
  (table) => [
    index('certificate_user_idx').on(table.userId, table.issuedAt),
    index('certificate_public_name_idx').on(table.displayNameSearch),
    index('certificate_public_number_idx').on(table.refereeNumber),
  ],
);

export const schema = {
  refereeProfiles,
  practiceRuleProgress,
  certificationRounds,
  certificationRuleProgress,
  certificationCaseSteps,
  gameAttempts,
  certificates,
};
