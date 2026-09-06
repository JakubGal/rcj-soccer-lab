import { CERTIFICATION_POLICY } from '@/lib/certification/policy';
import {
  CERTIFICATION_QUESTION_IDS,
  gradeCaseAnswerPrefix,
  gradeRuleAnswer,
  scoreGame,
} from '@/lib/certification/scoring';
import { verifyMatchReplay } from '@/lib/certification/replay';
import type { RuleLearningEvent } from '@/lib/certification/client-types';
import type { GitHubSubmission } from './protocol';
import { certificationSeed } from './seeds';
import { unpackReplay } from './transport';

const fail = (message: string): never => {
  throw new Error(message);
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function cleanText(value: unknown, max: number, minimum = 0) {
  if (
    typeof value !== 'string' ||
    value.trim().length < minimum ||
    value.length > max ||
    /\p{Cc}/u.test(value)
  )
    return fail(
      'Invalid public profile. Use an alias and an optional country, without control characters.',
    );
  return value.trim();
}
function canonical(
  event: Extract<RuleLearningEvent, { type: 'answer' | 'complete' }>,
) {
  if (
    !event.answer ||
    !['clip', 'scenario', 'case'].includes(event.answer.kind)
  )
    return fail('Invalid rule answer.');
  if (event.answer.kind === 'clip') return event.answer.selectedIndex;
  if (event.answer.kind === 'scenario') return event.answer.choiceId;
  return event.answer.calls;
}

/** First observed answers/steps win. Claimed scores and firstAnswer flags never do. */
export function summarizeRuleEvidence(
  events: RuleLearningEvent[],
  roundId: string,
) {
  if (!Array.isArray(events) || events.length > 12000)
    return fail('Invalid rules evidence.');
  const answers = new Map<
    string,
    {
      correct: boolean;
      complete: boolean;
      assisted: boolean;
      steps?: Map<number, boolean>;
    }
  >();
  for (const event of events) {
    if (
      !event ||
      !CERTIFICATION_QUESTION_IDS.has(event.questionId) ||
      event.mode !== 'certification' ||
      event.certificationRunId !== roundId
    )
      return fail(
        'The rules evidence belongs to a different round or question.',
      );
    if (!['answer', 'complete', 'assistance'].includes(event.type))
      return fail('Invalid rule event.');
    const id = event.questionId;
    const entry = answers.get(id) ?? {
      correct: false,
      complete: false,
      assisted: false,
    };
    if (event.type === 'assistance') {
      entry.assisted = true;
      answers.set(id, entry);
      continue;
    }
    entry.assisted ||= event.assisted === true;
    const value = canonical(event);
    if (id.startsWith('case:')) {
      const prefix = gradeCaseAnswerPrefix(id, value);
      if (!prefix?.valid) return fail('Invalid case answer.');
      entry.steps ??= new Map();
      for (const step of prefix.steps)
        if (!entry.steps.has(step.index))
          entry.steps.set(step.index, step.correct);
      entry.complete = entry.steps.size === prefix.totalSteps;
      entry.correct =
        entry.complete && [...entry.steps.values()].every(Boolean);
    } else if (!entry.complete) {
      const grade = gradeRuleAnswer(id, value);
      if (!grade.valid) return fail('Invalid rule answer.');
      entry.correct = grade.correct;
      entry.complete = true;
    }
    answers.set(id, entry);
  }
  const completed = [...answers.entries()].filter(
    ([, answer]) => answer.complete,
  );
  const correctFirstTry = completed.filter(
    ([, answer]) => answer.correct && !answer.assisted,
  ).length;
  return {
    answered: completed.length,
    total: CERTIFICATION_POLICY.ruleQuestionCount,
    correctFirstTry,
    accuracy: completed.length
      ? Math.round((10000 * correctFirstTry) / completed.length) / 100
      : null,
    requiredAccuracy: 95,
    passed:
      completed.length === CERTIFICATION_POLICY.ruleQuestionCount &&
      correctFirstTry >= CERTIFICATION_POLICY.ruleFirstTryRequired,
    answeredQuestionIds: completed.map(([id]) => id),
  };
}

/** Runs only trusted code against untrusted data; never accept client summary counters. */
export async function validateSubmission(input: unknown) {
  if (!input || typeof input !== 'object') return fail('Invalid submission.');
  const submission = input as GitHubSubmission;
  if (
    submission.schema !== 1 ||
    typeof submission.requestId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(submission.requestId) ||
    !['connect', 'certify'].includes(submission.kind)
  )
    return fail('Unsupported submission version or request.');
  if (
    !submission.profile ||
    typeof submission.profile.publicProfile !== 'boolean'
  )
    return fail('Choose whether to list your profile publicly.');
  const profile = {
    displayName: cleanText(submission.profile.displayName, 60, 2),
    country: cleanText(submission.profile.country, 80),
    publicProfile: submission.profile.publicProfile,
  };
  if (submission.kind === 'connect') return { profile };
  const round = submission.round;
  if (
    !round ||
    !uuid.test(round.id) ||
    !Number.isSafeInteger(round.number) ||
    round.number < 1 ||
    !Number.isFinite(Date.parse(round.startedAt))
  )
    return fail('Invalid certification round.');
  const rules = summarizeRuleEvidence(round.ruleEvents, round.id);
  if (!rules.passed)
    return fail(
      'The rules examination did not meet 70 of 73 correct first answers.',
    );
  if (!Array.isArray(round.games) || round.games.length > 13)
    return fail('Too many game attempts.');
  const uniqueIds = new Set<string>();
  const used = { step: 0, continuous: 0 };
  const qualifying = { step: 0, continuous: 0 };
  const results: {
    id: string;
    mode: string;
    accuracy: number;
    qualifying: boolean;
  }[] = [];
  for (const game of round.games) {
    if (
      !game ||
      !uuid.test(game.id) ||
      uniqueIds.has(game.id) ||
      !['step', 'continuous'].includes(game.mode) ||
      !Number.isSafeInteger(game.seed) ||
      game.seed < 0 ||
      game.seed > 0xffffffff
    )
      return fail('Invalid or duplicated game attempt.');
    uniqueIds.add(game.id);
    used[game.mode]++;
    if (used[game.mode] > CERTIFICATION_POLICY.games[game.mode].maxAttempts)
      return fail('The attempt limit was exceeded.');
    if (
      game.seed !==
      (await certificationSeed(round.id, game.mode, used[game.mode]))
    )
      return fail('The game seed does not match its assigned attempt.');
    if (
      !Number.isFinite(Date.parse(game.startedAt)) ||
      Date.parse(game.startedAt) < Date.parse(round.startedAt)
    )
      return fail('Invalid attempt start.');
    if (!game.replay) continue; // Started but abandoned attempts still consume a slot.
    const verified = verifyMatchReplay(unpackReplay(game.replay));
    if (verified.mode !== game.mode || verified.seed !== game.seed)
      return fail('The replay does not match its attempt.');
    const result = scoreGame(
      game.mode,
      verified.report,
      verified.elapsedSeconds,
    );
    if (verified.complete && result.qualifying) qualifying[game.mode]++;
    results.push({
      id: game.id,
      mode: game.mode,
      accuracy: result.accuracy,
      qualifying: verified.complete && result.qualifying,
    });
  }
  if (qualifying.step < 5 || qualifying.continuous < 2)
    return fail(
      'The replayed games did not meet the certification requirements.',
    );
  return {
    profile,
    summary: {
      rulesCorrect: rules.correctFirstTry,
      rulesTotal: rules.total,
      stepQualifying: qualifying.step,
      continuousQualifying: qualifying.continuous,
      stepAttempts: used.step,
      continuousAttempts: used.continuous,
      games: results,
      policyVersion: CERTIFICATION_POLICY.policyVersion,
    },
  };
}
