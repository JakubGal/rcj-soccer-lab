import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
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

const {
  REFMATE_ROBOTS,
  REFMATE_MAIN_ACTIONS,
  refMateTileCall,
  refMateStartCall,
  RefMateTapGuard,
} = await import('../lib/simulator/refmate-controls.ts');
const { RefereeMatch } = await import('../lib/simulator/referee-match.ts');
const { MATCH_ROBOTS, MATCH_STEP } = await import('../lib/simulator/match.ts');
const { REFEREE_ACTIONS } = await import('../lib/simulator/referee-cases.ts');
const { clampRobotToField } =
  await import('../lib/simulator/referee-geometry.ts');
const { RCJ_FIELD_DERIVED: FIELD } =
  await import('../lib/simulator/field-spec.ts');
const { makeMatchReplay, hydrateMatchReplay } =
  await import('../lib/certification/replay.ts');
const { TRAINING_TOPICS } =
  await import('../lib/simulator/referee-training.ts');

const advance = (session, seconds) => {
  for (let step = 0; step < Math.round(seconds / MATCH_STEP); step++)
    session.step();
};
const submit = (session, call) => {
  assert.equal(session.submit(session.decisionKey, call), true);
  return session.snapshot();
};
const continuous = () => {
  const session = new RefereeMatch(73, { mode: 'continuous', duration: 180 });
  // Isolate the user controls from injected training faults in these unit tests.
  session.director.delay = Infinity;
  return session;
};

test('RefMate presents A1/B1 then A2/B2 with exact simulator targets', () => {
  assert.deepEqual(
    REFMATE_ROBOTS.map(({ id, slot }) => [id, slot]),
    [
      ['blue-1', 'A1'],
      ['yellow-1', 'B1'],
      ['blue-2', 'A2'],
      ['yellow-2', 'B2'],
    ],
  );
  for (const robot of REFMATE_ROBOTS) {
    const matchRobot = MATCH_ROBOTS.find(({ id }) => id === robot.id);
    assert.equal(robot.team, matchRobot.team);
    assert.equal(robot.label, matchRobot.label);
  }
});

test('only the remote main actions are removed from the supplemental calls', () => {
  assert.deepEqual([...REFMATE_MAIN_ACTIONS].sort(), [
    'damaged',
    'goal',
    'out',
    'pause',
    'resume',
    'return',
    'start',
  ]);
  for (const action of REFMATE_MAIN_ACTIONS)
    assert.ok(REFEREE_ACTIONS.some(({ id }) => id === action));
  for (const action of [
    'waive-out',
    'multiple',
    'pushing',
    'no-goal',
    'early-start',
    'ball-out',
    'neutral',
    'correct-setup',
    'count',
    'lack-progress',
    'keep-out',
    'inspect',
  ])
    assert.equal(REFMATE_MAIN_ACTIONS.has(action), false, action);
});

test('each on-field tile issues the chosen penalty without changing state', () => {
  const bench = Object.freeze([Object.freeze({ robot: 'yellow-2' })]);
  for (const penalty of ['out', 'damaged'])
    for (const robot of REFMATE_ROBOTS) {
      const call = refMateTileCall(robot.id, penalty, bench);
      assert.deepEqual(call, {
        action: robot.id === 'yellow-2' ? 'return' : penalty,
        target: robot.id,
      });
    }
  assert.deepEqual(bench, [{ robot: 'yellow-2' }]);
});

test('benched tiles offer return regardless of remaining time or repair readiness', () => {
  for (const robot of REFMATE_ROBOTS)
    for (const penalty of ['out', 'damaged'])
      assert.deepEqual(
        refMateTileCall(robot.id, penalty, [
          {
            robot: robot.id,
            remaining: 60,
            eligible: false,
            ready: false,
            reason: 'Damaged',
          },
        ]),
        { action: 'return', target: robot.id },
      );
});

test('invalid targets and unknown modes fail instead of penalizing another robot', () => {
  for (const robot of ['', 'blue', 'blue-3', 'A1', '__proto__'])
    assert.throws(() => refMateTileCall(robot, 'out', []), RangeError);
  assert.throws(() => refMateTileCall('blue-1', 'holding', []), RangeError);
  assert.throws(() => refMateStartCall('guess'), RangeError);
});

test('kickoff and same-position restart remain distinct recorded referee calls', () => {
  assert.deepEqual(refMateStartCall('kickoff'), { action: 'start' });
  assert.deepEqual(refMateStartCall('resume'), { action: 'resume' });
});

test('double-tap controls fire only on a matching second tap within 300 ms', () => {
  const guard = new RefMateTapGuard();
  assert.equal(guard.activate('out:blue-1', 1000, 'double'), false);
  assert.equal(guard.activate('out:blue-1', 1300, 'double'), true);
  assert.equal(guard.activate('return:blue-1', 1400, 'double'), false);
  assert.equal(guard.activate('return:blue-1', 1500, 'double'), false);
  // Suppressed reflex taps must not count as a new first tap.
  assert.equal(guard.activate('return:blue-1', 1700, 'double'), false);
  assert.equal(guard.activate('return:blue-1', 1800, 'double'), true);
});

test('a late second tap starts a fresh pair instead of executing a queued action', () => {
  const guard = new RefMateTapGuard();
  assert.equal(guard.activate('out:blue-1', 0, 'double'), false);
  assert.equal(guard.activate('out:blue-1', 301, 'double'), false);
  assert.equal(guard.activate('out:blue-1', 601, 'double'), true);
});

test('changing reason, target or action cannot complete an earlier tap pair', () => {
  const guard = new RefMateTapGuard();
  assert.equal(guard.activate('out:blue-1', 0, 'double'), false);
  assert.equal(guard.activate('damaged:blue-1', 100, 'double'), false);
  assert.equal(guard.activate('damaged:blue-2', 200, 'double'), false);
  assert.equal(guard.activate('return:blue-2', 300, 'double'), false);
  assert.equal(guard.activate('return:blue-2', 400, 'double'), true);
});

test('single-tap controls suppress reflex reversals even when the label changes', () => {
  const guard = new RefMateTapGuard();
  assert.equal(guard.activate('start', 0, 'single'), true);
  assert.equal(guard.activate('stop', 100, 'single'), false);
  assert.equal(guard.activate('stop', 300, 'single'), false);
  assert.equal(guard.activate('stop', 301, 'single'), true);
});

test('intentional keyboard activation is immediate in double mode with repeat protection', () => {
  const guard = new RefMateTapGuard();
  assert.equal(guard.activate('out:yellow-2', 1000, 'double', true), true);
  assert.equal(guard.activate('return:yellow-2', 1010, 'double', true), false);
  assert.equal(guard.activate('return:yellow-2', 1400, 'double', true), true);
});

test('tap guards are independent and reset clears both pending taps and cooldown', () => {
  const blue = new RefMateTapGuard();
  const yellow = new RefMateTapGuard();
  assert.equal(blue.activate('out:blue-1', 1000, 'double'), false);
  assert.equal(yellow.activate('out:yellow-1', 1100, 'double'), false);
  assert.equal(blue.activate('out:blue-1', 1150, 'double'), true);
  assert.equal(yellow.activate('out:yellow-1', 1200, 'double'), true);
  blue.reset();
  assert.equal(blue.activate('return:blue-1', 1250, 'single'), true);
  yellow.reset();
  assert.equal(yellow.activate('return:yellow-1', 1300, 'double'), false);
  yellow.reset();
  assert.equal(yellow.activate('return:yellow-1', 1350, 'double'), false);
  assert.equal(yellow.activate('return:yellow-1', 1400, 'double'), true);
});

test('remote wrong-robot removal and early return are enacted and reviewed at full time', () => {
  const session = continuous();
  session.match.state.actors['blue-1'] = clampRobotToField(
    { x: FIELD.floorHalfWidth, z: -0.2, yaw: 0 },
    session.robotVisual,
  );
  session.detectLiveIncident();

  const removed = submit(
    session,
    refMateTileCall('yellow-1', 'out', session.snapshot().bench),
  );
  assert.equal(removed.feedback.verdict, 'wrong-target');
  assert.equal(removed.actors['yellow-1'], undefined);
  assert.ok(removed.actors['blue-1']);
  assert.equal(removed.bench[0].remaining, 60);
  assert.equal(removed.bench[0].eligible, false);
  assert.deepEqual(removed.review, []);

  const returned = submit(
    session,
    refMateTileCall('yellow-1', 'out', removed.bench),
  );
  assert.ok(returned.actors['yellow-1']);
  assert.equal(returned.bench.length, 0);
  assert.equal(returned.report.wrong, 2);
  assert.deepEqual(returned.review, []);

  session.endSession();
  const events = session.snapshot().review;
  assert.equal(events[0].assessment, 'wrong-target');
  assert.deepEqual(events[0].actual, { action: 'out', target: 'yellow-1' });
  assert.deepEqual(events[0].expected, [{ action: 'out', target: 'blue-1' }]);
  assert.deepEqual(events[1].actual, { action: 'return', target: 'yellow-1' });
  assert.deepEqual(events[1].expected, [
    { action: 'keep-out', target: 'yellow-1' },
  ]);
});

test('a damaged tile can return an unrepaired robot in permissive continuous mode', () => {
  const session = continuous();
  const removed = submit(session, refMateTileCall('blue-2', 'damaged', []));
  assert.equal(removed.bench[0].robot, 'blue-2');
  assert.equal(removed.bench[0].reason, 'Damaged');
  assert.equal(removed.bench[0].ready, false);
  assert.equal(removed.bench[0].eligible, false);
  const returned = submit(
    session,
    refMateTileCall('blue-2', 'damaged', removed.bench),
  );
  assert.ok(returned.actors['blue-2']);
  assert.equal(returned.bench.length, 0);
});

test('STOP and START preserve the penalty and use only advancing simulation time', () => {
  const session = continuous();
  const removed = submit(session, refMateTileCall('blue-1', 'out', []));
  const original = removed.bench[0];
  submit(session, { action: 'pause' });
  advance(session, 10);
  assert.deepEqual(session.snapshot().bench[0], original);

  const resumed = submit(session, refMateStartCall('resume'));
  assert.equal(resumed.actors['blue-1'], undefined);
  assert.deepEqual(resumed.bench[0], original);
  advance(session, 2);
  const elapsed = session.snapshot();
  assert.equal(elapsed.bench[0].eligibleAt, original.eligibleAt);
  assert.ok(Math.abs(elapsed.bench[0].remaining - 58) < 1e-8);
  assert.equal(elapsed.actors['blue-1'], undefined);
});

test('the same adapter and classic calls hydrate to identical certification evidence', () => {
  const trace = (adapter) => {
    const topics = TRAINING_TOPICS.map(({ id }) => id);
    const session = new RefereeMatch(73, {
      preMatch: true,
      mode: 'continuous',
      duration: 600,
      robotVisual: 'lab',
      lockRobotVisual: true,
      recordMatchReplay: false,
      topics,
    });
    const events = [];
    const record = (operation, apply) => {
      const event = {
        ...operation,
        seq: events.length,
        tick: session.trainingTick,
      };
      assert.notEqual(apply(), false);
      events.push(event);
    };
    const call = (value) => {
      const decisionKey = session.decisionKey;
      record({ op: 'call', decisionKey, call: value }, () =>
        session.submit(decisionKey, value),
      );
    };
    const tile = (robot, penalty, classicAction = penalty) =>
      call(
        adapter
          ? refMateTileCall(robot, penalty, session.snapshot().bench)
          : { action: classicAction, target: robot },
      );
    const start = (signal) =>
      call(
        adapter
          ? refMateStartCall(signal)
          : { action: signal === 'kickoff' ? 'start' : 'resume' },
      );

    record({ op: 'toss' }, () => session.tossCoin());
    record({ op: 'choose-end', end: 'yellow' }, () =>
      session.chooseOpeningEnd('yellow'),
    );
    start('kickoff');
    advance(session, 1);
    tile('yellow-1', 'out');
    call({ action: 'pause' });
    start('resume');
    advance(session, 1);
    tile('yellow-1', 'out', 'return');
    start('resume');
    advance(session, 1);
    tile('blue-2', 'damaged');
    call({ action: 'goal', target: 'blue' });
    record({ op: 'arrange-kickoff' }, () => session.arrangeKickoff());
    start('kickoff');
    assert.ok(session.bench['blue-2'], 'START ALL must not clear penalties');
    record({ op: 'end' }, () => session.endSession());

    const replay = makeMatchReplay({
      mode: 'continuous',
      seed: 73,
      robotVisual: 'lab',
      topics,
      events,
      terminal: { tick: session.trainingTick, reason: 'ended-early' },
    });
    const restored = hydrateMatchReplay(replay);
    assert.deepEqual(restored.snapshot(), session.snapshot());
    return { replay, frame: session.snapshot() };
  };
  assert.deepEqual(trace(true), trace(false));
});
