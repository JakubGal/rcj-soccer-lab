import { LEARNING_SITUATIONS } from '@/lib/rulebook/learning';
import { RULE_CLIPS } from '@/lib/rulebook/animations';
import { RULE_QUESTIONS } from '@/lib/rulebook/questions';
import { SCENARIOS } from '@/lib/simulator/scenarios';
import { CERTIFICATION_POLICY, type CertificationMode } from './policy';
import { gradeCaseEvidence } from './case-evidence';

export const CERTIFICATION_QUESTION_IDS = new Set(
  LEARNING_SITUATIONS.map((item) => item.id),
);

export type RuleAnswerGrade = {
  valid: boolean;
  correct: boolean;
  answerKey: string;
};

function boundedAnswerKey(answer: unknown) {
  const serialized = JSON.stringify(answer);
  return serialized && serialized.length <= 64 * 1024 ? serialized : null;
}

export type CaseAnswerPrefixGrade = {
  valid: boolean;
  complete: boolean;
  correct: boolean;
  answerKey: string;
  totalSteps: number;
  steps: { index: number; answerKey: string; correct: boolean }[];
};

/**
 * Validates an ordered prefix of a multi-step case. Each step can be inserted
 * once server-side, so navigating away cannot reset an incorrect first call.
 */
export function gradeCaseAnswerPrefix(
  questionId: string,
  answer: unknown,
): CaseAnswerPrefixGrade | null {
  return gradeCaseEvidence(questionId, answer);
}

/** Grades all rule answers from the canonical rule content, never a client boolean. */
export function gradeRuleAnswer(
  questionId: string,
  answer: unknown,
): RuleAnswerGrade {
  const answerKey = boundedAnswerKey(answer);
  if (!answerKey || !CERTIFICATION_QUESTION_IDS.has(questionId))
    return { valid: false, correct: false, answerKey: '' };

  const [kind, sourceId] = questionId.split(':', 2);
  if (kind === 'clip' || kind === 'question') {
    const clip = (kind === 'clip' ? RULE_CLIPS : RULE_QUESTIONS).find(
      (item) => item.id === sourceId,
    );
    let selected = -1;
    if (typeof answer === 'number') selected = answer;
    else if (typeof answer === 'string')
      selected = clip?.options.indexOf(answer) ?? -1;
    else if (answer && typeof answer === 'object') {
      const selectedIndex = (answer as Record<string, unknown>).selectedIndex;
      if (typeof selectedIndex === 'number') selected = selectedIndex;
    }
    return {
      valid:
        Boolean(clip) &&
        Number.isInteger(selected) &&
        selected >= 0 &&
        selected < clip!.options.length,
      correct: Boolean(clip) && selected === clip!.answer,
      answerKey,
    };
  }

  if (kind === 'scenario') {
    const scenario = SCENARIOS.find((item) => item.id === sourceId);
    const choiceId =
      typeof answer === 'string'
        ? answer
        : answer && typeof answer === 'object'
          ? (answer as Record<string, unknown>).choiceId
          : null;
    const choice = scenario?.choices.find((item) => item.id === choiceId);
    return {
      valid: Boolean(choice),
      correct: choice?.grade === 'correct' || choice?.grade === 'acceptable',
      answerKey,
    };
  }

  if (kind === 'case') {
    const prefix = gradeCaseAnswerPrefix(questionId, answer);
    return {
      valid: Boolean(prefix?.valid && prefix.complete),
      correct: prefix?.correct ?? false,
      answerKey: prefix?.answerKey ?? answerKey,
    };
  }

  return { valid: false, correct: false, answerKey: '' };
}

export type GameCounters = {
  correct: number;
  wrong: number;
  missed: number;
  assisted: number;
};

export function scoreGame(
  mode: CertificationMode,
  counters: GameCounters,
  elapsedSeconds: number,
) {
  const assessed = counters.correct + counters.wrong + counters.missed;
  const accuracy =
    assessed > 0 ? Math.round((100 * counters.correct) / assessed) : 0;
  const rules = CERTIFICATION_POLICY.games[mode];
  return {
    assessed,
    accuracy,
    complete: elapsedSeconds >= rules.durationSeconds,
    qualifying:
      elapsedSeconds >= rules.durationSeconds &&
      assessed > 0 &&
      counters.assisted === 0 &&
      counters.correct * 100 >= rules.minimumAccuracy * assessed,
  };
}

export function isGameCounters(value: unknown): value is GameCounters {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['correct', 'wrong', 'missed', 'assisted'].every(
    (key) =>
      Number.isSafeInteger(record[key]) &&
      (record[key] as number) >= 0 &&
      (record[key] as number) <= 100_000,
  );
}
