import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const repositoryUrl = new URL('../', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const path = specifier.slice(2);
      const url = new URL(
        /\.(?:ts|json)$/.test(path) ? path : `${path}.ts`,
        repositoryUrl,
      );
      return nextResolve(url.href, context);
    }
    if (
      /^\.\.?\//.test(specifier) &&
      context.parentURL?.includes('/lib/') &&
      !/\.(ts|json)$/.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json') && url.includes('/lib/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
      };
    if (url.endsWith('.ts') && url.includes('/lib/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});

const { LEARNING_SITUATIONS } = await import('../lib/rulebook/learning.ts');
const { TRAINING_TOPICS } =
  await import('../lib/simulator/referee-training.ts');
const { CERTIFICATION_POLICY } = await import('../lib/certification/policy.ts');
const { CERTIFICATION_QUESTION_IDS, gradeRuleAnswer, scoreGame } =
  await import('../lib/certification/scoring.ts');
const { makeCaseAnswer } = await import('./replay-fixtures.mjs');
const { REFEREE_CASES } = await import('../lib/simulator/referee-cases.ts');
const { ROBOT_VISUALS } = await import('../lib/simulator/robot-models.ts');

test('the versioned 2026 policy covers every current question and exact certification boundaries', () => {
  assert.ok(LEARNING_SITUATIONS.length >= 73);
  assert.equal(CERTIFICATION_QUESTION_IDS.size, LEARNING_SITUATIONS.length);
  assert.deepEqual(
    [...CERTIFICATION_QUESTION_IDS].sort((a, b) => a.localeCompare(b)),
    LEARNING_SITUATIONS.map((item) => item.id).sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  assert.equal(
    CERTIFICATION_POLICY.ruleQuestionCount,
    LEARNING_SITUATIONS.length,
  );
  assert.equal(CERTIFICATION_POLICY.ruleFirstTryPercent, 95);
  assert.equal(CERTIFICATION_POLICY.policyVersion, 'rcj-soccer-2026-v3');
  assert.equal(
    CERTIFICATION_POLICY.ruleFirstTryRequired,
    Math.ceil(
      (CERTIFICATION_POLICY.ruleQuestionCount *
        CERTIFICATION_POLICY.ruleFirstTryPercent) /
        100,
    ),
  );
  assert.deepEqual(
    CERTIFICATION_POLICY.topics,
    TRAINING_TOPICS.map((topic) => topic.id),
  );
  assert.deepEqual(CERTIFICATION_POLICY.games.step, {
    durationSeconds: 600,
    requiredQualifying: 5,
    maxAttempts: 8,
    minimumAccuracy: 90,
  });
  assert.deepEqual(CERTIFICATION_POLICY.games.continuous, {
    durationSeconds: 600,
    requiredQualifying: 2,
    maxAttempts: 5,
    minimumAccuracy: 80,
  });
});

test('game scoring enforces the 600-second, accuracy, assistance and assessed-decision edges', () => {
  assert.deepEqual(scoreGame('step', counter(9, 1), 599.999), {
    assessed: 10,
    accuracy: 90,
    complete: false,
    qualifying: false,
  });
  assert.deepEqual(scoreGame('step', counter(9, 1), 600), {
    assessed: 10,
    accuracy: 90,
    complete: true,
    qualifying: true,
  });
  assert.equal(scoreGame('step', counter(89, 11), 600).accuracy, 89);
  assert.equal(scoreGame('step', counter(89, 11), 600).qualifying, false);
  assert.equal(scoreGame('step', counter(9, 1, 1), 600).qualifying, false);
  assert.equal(scoreGame('step', counter(0, 0), 600).qualifying, false);

  assert.deepEqual(scoreGame('continuous', counter(4, 1), 600), {
    assessed: 5,
    accuracy: 80,
    complete: true,
    qualifying: true,
  });
  assert.equal(scoreGame('continuous', counter(79, 21), 600).qualifying, false);
  assert.equal(
    scoreGame('continuous', counter(4, 1), 599.999).qualifying,
    false,
  );
  assert.equal(
    scoreGame('continuous', counter(4, 1, 1), 600).qualifying,
    false,
  );
});

test('canonical clip answers are graded from their selected index', () => {
  assert.deepEqual(
    verdict('clip:match-halves', { kind: 'clip', selectedIndex: 0 }),
    { valid: true, correct: true },
  );
  assert.deepEqual(
    verdict('clip:match-halves', { kind: 'clip', selectedIndex: 1 }),
    { valid: true, correct: false },
  );
  assert.deepEqual(
    verdict('clip:match-halves', { kind: 'clip', selectedIndex: -1 }),
    { valid: false, correct: false },
  );
});

test('canonical scenario answers accept both correct and officially acceptable choices', () => {
  assert.deepEqual(
    verdict('scenario:legal-dribbler-backspin', {
      kind: 'scenario',
      choiceId: 'play-on',
    }),
    { valid: true, correct: true },
  );
  assert.deepEqual(
    verdict('scenario:illegal-ball-holding', {
      kind: 'scenario',
      choiceId: 'brief-observation',
    }),
    { valid: true, correct: true },
  );
  assert.deepEqual(
    verdict('scenario:legal-dribbler-backspin', {
      kind: 'scenario',
      choiceId: 'call-holding',
    }),
    { valid: true, correct: false },
  );
  assert.deepEqual(
    verdict('scenario:legal-dribbler-backspin', {
      kind: 'scenario',
      choiceId: 'not-a-choice',
    }),
    { valid: false, correct: false },
  );
});

test('canonical case answers require every first call in decision order', () => {
  assert.deepEqual(verdict('case:goal', makeCaseAnswer('goal')), {
    valid: true,
    correct: true,
  });
  assert.deepEqual(verdict('case:combined', makeCaseAnswer('combined')), {
    valid: true,
    correct: true,
  });
  assert.deepEqual(
    verdict('case:combined', makeCaseAnswer('combined', { wrongFirst: true })),
    { valid: true, correct: false },
  );
  assert.deepEqual(
    verdict('case:combined', {
      kind: 'case',
      calls: [{ action: 'pushing' }],
    }),
    { valid: false, correct: false },
  );
});

test('every concrete UI case answer is engine-graded correctly across locked robot models', () => {
  for (const { id: robotVisual } of ROBOT_VISUALS)
    for (const item of REFEREE_CASES)
      assert.deepEqual(
        verdict(`case:${item.id}`, makeCaseAnswer(item.id, { robotVisual })),
        { valid: true, correct: true },
        `${robotVisual}/${item.id}`,
      );
});

test('out-goal retains its original decision ticks under the current assessment version', () => {
  for (const { id: robotVisual } of ROBOT_VISUALS) {
    const calls = [{ action: 'no-goal' }, { action: 'out', target: 'blue-2' }];
    const answer = {
      kind: 'case',
      calls,
      evidence: {
        schema: 'rcj-case-evidence/v2',
        engineVersion: 'referee-match-2026-v3',
        seed: 2026,
        robotVisual,
        operations: [
          { op: 'call', tick: 480, decisionKey: '1:0', call: calls[0] },
          { op: 'continue', tick: 480 },
          { op: 'call', tick: 480, decisionKey: '1:1', call: calls[1] },
        ],
      },
    };
    assert.deepEqual(makeCaseAnswer('out-goal', { robotVisual }), answer);
    assert.deepEqual(verdict('case:out-goal', answer), {
      valid: true,
      correct: true,
    });
  }
});

test('case evidence rejects symbolic-only legacy answers and tampered operations/versions', () => {
  assert.equal(
    verdict('case:multiple', {
      kind: 'case',
      calls: [{ action: 'multiple', target: 'farther' }],
    }).valid,
    false,
  );
  for (const mutate of [
    (answer) => {
      answer.evidence.engineVersion = 'referee-match-2026-v1';
    },
    (answer) => {
      answer.evidence.engineVersion = 'referee-match-2026-v2';
    },
    (answer) => {
      answer.evidence.seed = 7;
    },
    (answer) => {
      answer.evidence.operations[0].decisionKey = '999:999';
    },
    (answer) => {
      answer.evidence.operations[0].tick = 0;
    },
    (answer) => {
      answer.evidence.operations.push({
        tick: 0,
        op: 'set-robot-visual',
        robotVisual: 'lab',
      });
    },
    (answer) => {
      answer.evidence.operations = Array(257).fill(
        answer.evidence.operations[0],
      );
    },
  ]) {
    const answer = makeCaseAnswer('multiple');
    mutate(answer);
    assert.equal(verdict('case:multiple', answer).valid, false);
  }
});

test('display rounding cannot pass a game below the exact required ratio', () => {
  assert.equal(scoreGame('step', counter(26, 3), 600).accuracy, 90);
  assert.equal(scoreGame('step', counter(26, 3), 600).qualifying, false);
  assert.equal(scoreGame('continuous', counter(35, 9), 600).accuracy, 80);
  assert.equal(scoreGame('continuous', counter(35, 9), 600).qualifying, false);
});

test('unknown questions and malformed canonical answers cannot earn credit', () => {
  assert.deepEqual(
    verdict('clip:not-a-question', { kind: 'clip', selectedIndex: 0 }),
    { valid: false, correct: false },
  );
  assert.deepEqual(verdict('case:goal', { kind: 'case', calls: [{}] }), {
    valid: false,
    correct: false,
  });
  assert.deepEqual(verdict('scenario:legal-dribbler-backspin', null), {
    valid: false,
    correct: false,
  });
});

function counter(correct, wrong, assisted = 0, missed = 0) {
  return { correct, wrong, missed, assisted };
}

function verdict(questionId, answer) {
  const { valid, correct } = gradeRuleAnswer(questionId, answer);
  return { valid, correct };
}
