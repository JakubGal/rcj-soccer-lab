import { RefereeMatch } from '../simulator/referee-match';
import {
  REFEREE_ACTIONS,
  REFEREE_CASES,
  type RefereeCall,
} from '../simulator/referee-cases';
import { isRobotVisualId, type RobotVisualId } from '../simulator/robot-models';
import {
  CASE_EVIDENCE_SCHEMA,
  CASE_LESSON_SEED,
  CERTIFICATION_ENGINE_VERSION,
} from './versions';

export { CASE_EVIDENCE_SCHEMA, CASE_LESSON_SEED } from './versions';
export const MAX_CASE_EVIDENCE_OPERATIONS = 256;
const MAX_CASE_EVIDENCE_TICKS = 120 * 180;
export type CaseEvidenceOperation =
  | { tick: number; op: 'call'; decisionKey: string; call: RefereeCall }
  | { tick: number; op: 'continue' | 'restart' };
export type CaseEvidence = {
  schema: typeof CASE_EVIDENCE_SCHEMA;
  engineVersion: typeof CERTIFICATION_ENGINE_VERSION;
  seed: typeof CASE_LESSON_SEED;
  robotVisual: RobotVisualId;
  operations: CaseEvidenceOperation[];
};
export type CaseAnswerPrefixGrade = {
  valid: boolean;
  complete: boolean;
  correct: boolean;
  answerKey: string;
  totalSteps: number;
  steps: { index: number; answerKey: string; correct: boolean }[];
};
const invalid = (): CaseAnswerPrefixGrade => ({
  valid: false,
  complete: false,
  correct: false,
  answerKey: '',
  totalSteps: 0,
  steps: [],
});
const cache = new Map<string, CaseAnswerPrefixGrade>();
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const actions = new Set(REFEREE_ACTIONS.map((action) => action.id));
const targets = new Set([
  'blue',
  'yellow',
  'blue-1',
  'blue-2',
  'yellow-1',
  'yellow-2',
]);

export function newCaseEvidence(robotVisual: RobotVisualId): CaseEvidence {
  return {
    schema: CASE_EVIDENCE_SCHEMA,
    engineVersion: CERTIFICATION_ENGINE_VERSION,
    seed: CASE_LESSON_SEED,
    robotVisual,
    operations: [],
  };
}

/** Replays exactly the observed lesson operations, including wrong retries and restarts.
 * No claimed correctness, symbolic target, firstAnswer flag, or static answer is trusted. */
export function gradeCaseEvidence(
  questionId: string,
  value: unknown,
): CaseAnswerPrefixGrade | null {
  if (!questionId.startsWith('case:')) return null;
  const definition = REFEREE_CASES.find(
    (item) => `case:${item.id}` === questionId,
  );
  if (!definition || !record(value) || !record(value.evidence))
    return invalid();
  const evidence = value.evidence;
  if (
    !exactKeys(evidence, [
      'schema',
      'engineVersion',
      'seed',
      'robotVisual',
      'operations',
    ]) ||
    evidence.schema !== CASE_EVIDENCE_SCHEMA ||
    evidence.engineVersion !== CERTIFICATION_ENGINE_VERSION ||
    evidence.seed !== CASE_LESSON_SEED ||
    !isRobotVisualId(evidence.robotVisual) ||
    !Array.isArray(evidence.operations) ||
    evidence.operations.length === 0 ||
    evidence.operations.length > MAX_CASE_EVIDENCE_OPERATIONS
  )
    return invalid();
  const answerKey = JSON.stringify(evidence);
  if (answerKey.length > 64 * 1024) return invalid();
  const cacheKey = `${questionId}:${answerKey}`;
  const cached = cache.get(cacheKey);
  if (cached) return structuredClone(cached);
  const robotVisual = evidence.robotVisual;
  const create = () => {
    const session = new RefereeMatch(CASE_LESSON_SEED, {
      robotVisual,
      lockRobotVisual: true,
      recordMatchReplay: false,
    });
    session.beginCase(definition);
    return session;
  };
  let session = create(),
    work = 0,
    complete = false;
  const firstSteps = new Map<number, CaseAnswerPrefixGrade['steps'][number]>();
  for (const operation of evidence.operations) {
    if (
      !record(operation) ||
      !Number.isSafeInteger(operation.tick) ||
      (operation.tick as number) < session.trainingTick ||
      (operation.tick as number) > MAX_CASE_EVIDENCE_TICKS
    )
      return invalid();
    while (session.trainingTick < (operation.tick as number)) {
      if (!session.canAdvance || ++work > MAX_CASE_EVIDENCE_TICKS)
        return invalid();
      session.step();
    }
    if (operation.op === 'restart') {
      if (!exactKeys(operation, ['tick', 'op'])) return invalid();
      session = create();
      continue;
    }
    const before = session.snapshot();
    if (operation.op === 'continue') {
      if (
        !exactKeys(operation, ['tick', 'op']) ||
        !before.feedback ||
        before.feedback.final
      )
        return invalid();
      session.continue();
      continue;
    }
    if (
      operation.op !== 'call' ||
      !exactKeys(operation, ['tick', 'op', 'decisionKey', 'call']) ||
      operation.decisionKey !== session.decisionKey ||
      !record(operation.call) ||
      !exactKeys(operation.call, ['action', 'target']) ||
      !actions.has(operation.call.action as RefereeCall['action']) ||
      (operation.call.target !== undefined &&
        !targets.has(operation.call.target as string)) ||
      before.feedback ||
      before.phase === 'evidence' ||
      before.count !== null ||
      !before.help?.choices.length
    )
      return invalid();
    const call = operation.call as RefereeCall;
    const index = before.help.step - 1;
    if (!session.submit(session.decisionKey, call)) return invalid();
    const after = session.snapshot();
    const correct = Boolean(
      after.feedback &&
      ['correct', 'supported'].includes(after.feedback.verdict),
    );
    if (!firstSteps.has(index))
      firstSteps.set(index, {
        index,
        answerKey: JSON.stringify(call),
        correct,
      });
    complete ||= Boolean(after.feedback?.final && correct);
  }
  const steps = [...firstSteps.values()];
  if (!steps.length) return invalid();
  const result: CaseAnswerPrefixGrade = {
    valid: true,
    complete,
    correct: complete && steps.every((step) => step.correct),
    answerKey,
    totalSteps: definition.steps.length,
    steps,
  };
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, result);
  return structuredClone(result);
}
