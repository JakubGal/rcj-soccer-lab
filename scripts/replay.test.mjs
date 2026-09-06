import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
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

const { TRAINING_TOPICS } =
  await import('../lib/simulator/referee-training.ts');
const {
  MAX_MATCH_REPLAY_EVENTS,
  MatchReplayError,
  makeMatchReplay,
  verifyMatchReplay,
} = await import('../lib/certification/replay.ts');
const { makePerfectReplay } = await import('./replay-fixtures.mjs');

const topics = TRAINING_TOPICS.map((topic) => topic.id);
let continuousFixture;
const continuousReplay = () => {
  continuousFixture ??= makePerfectReplay('continuous', 2026002, {
    recordMatchReplay: true,
  });
  return structuredClone(continuousFixture);
};

const expectReplayError = (code, action) =>
  assert.throws(action, (error) => {
    assert.ok(error instanceof MatchReplayError);
    assert.equal(error.code, code);
    return true;
  });

test('fixed-tick replays reproduce full step and continuous matches', () => {
  for (const [mode, seed, replay] of [
    ['step', 2026001, makePerfectReplay('step', 2026001)],
    ['continuous', 2026002, continuousReplay()],
  ]) {
    const verified = verifyMatchReplay(replay);
    assert.equal(verified.mode, mode);
    assert.equal(verified.seed, seed);
    assert.equal(verified.elapsedSeconds, 600);
    assert.equal(verified.complete, true);
    assert.deepEqual(verified.report, replay.claimedReport);
    assert.ok(gzipSync(JSON.stringify(replay)).byteLength < 60_000);
  }
});

test('state-changing tampering is rejected', () => {
  const tampered = continuousReplay();
  tampered.events[0].op = 'resume';
  expectReplayError('state_diverged', () => verifyMatchReplay(tampered));
});

test('unknown actions and nonmonotonic ticks are rejected before replay', () => {
  const replay = continuousReplay();
  const unknown = structuredClone(replay);
  unknown.events[0].op = 'teleport-score';
  expectReplayError('unknown_operation', () => verifyMatchReplay(unknown));
  const selectedCase = structuredClone(replay);
  selectedCase.events[0] = {
    ...selectedCase.events[0],
    op: 'begin-case',
    caseId: 'goal',
  };
  expectReplayError('unknown_operation', () => verifyMatchReplay(selectedCase));

  const backwards = structuredClone(replay);
  backwards.events[0].tick = 1;
  backwards.events[1].tick = 0;
  expectReplayError('nonmonotonic_ticks', () => verifyMatchReplay(backwards));
});

test('an explicit early finish verifies but is never complete', () => {
  const replay = makeMatchReplay({
    mode: 'continuous',
    seed: 2026005,
    robotVisual: 'lab',
    topics,
    events: [
      { seq: 0, tick: 0, op: 'toss' },
      { seq: 1, tick: 0, op: 'choose-end', end: 'blue' },
      { seq: 2, tick: 0, op: 'end' },
    ],
    terminal: { tick: 0, reason: 'ended-early' },
  });
  const verified = verifyMatchReplay(replay);
  assert.equal(verified.elapsedSeconds, 0);
  assert.equal(verified.complete, false);
});

test('certification duration and action-count bounds are enforced', () => {
  const early = makeMatchReplay({
    mode: 'continuous',
    seed: 2026007,
    robotVisual: 'lab',
    topics,
    events: [{ seq: 0, tick: 0, op: 'end' }],
    terminal: { tick: 0, reason: 'ended-early' },
  });
  expectReplayError('invalid_replay', () =>
    verifyMatchReplay({ ...early, durationSeconds: 599 }),
  );
  const events = Array.from(
    { length: MAX_MATCH_REPLAY_EVENTS + 1 },
    (_, seq) => ({
      seq,
      tick: 0,
      op: seq === MAX_MATCH_REPLAY_EVENTS ? 'end' : 'pause',
    }),
  );
  expectReplayError('too_many_events', () =>
    verifyMatchReplay({ ...early, events }),
  );
});

test('client counters are ignored and the engine report is authoritative', () => {
  const replay = continuousReplay();
  const expected = verifyMatchReplay(replay).report;
  replay.claimedReport = {
    correct: 9999,
    wrong: 0,
    missed: 0,
    assisted: 0,
    assessed: 9999,
    accuracy: 100,
  };
  assert.deepEqual(verifyMatchReplay(replay).report, expected);
});
