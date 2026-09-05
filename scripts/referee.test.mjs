import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
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
const { RefereeMatch, insidePenalty, penaltyOverlap } =
  await import('../lib/simulator/referee-match.ts');
const {
  REFEREE_CASES,
  REFEREE_FAMILIES,
  IncidentBag,
  caseScene,
  evidenceClip,
  transformId,
} = await import('../lib/simulator/referee-cases.ts');
const { SoccerMatch, MATCH_ROBOTS, MATCH_STEP } =
  await import('../lib/simulator/match.ts');
const { RCJ_FIELD_DERIVED: FIELD } =
  await import('../lib/simulator/field-spec.ts');
const { RULE_SECTIONS } = await import('../lib/rulebook/catalog.ts');
const { ruleUrl } = await import('../lib/simulator/referee-cases.ts');
const variant = { swap: false, reflect: false };
const definition = (id) => REFEREE_CASES.find((item) => item.id === id);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function advance(session, seconds) {
  for (let i = 0; i < Math.ceil(seconds / MATCH_STEP); i++) session.step();
}
function prepare(id, transform = variant) {
  const session = new RefereeMatch(2026);
  assert.equal(session.beginCase(definition(id), transform), true);
  advance(session, 10);
  assert.equal(session.phase, 'decision');
  return session;
}
function submit(session, action, target) {
  assert.equal(session.submit(session.decisionKey, { action, target }), true);
  return session.snapshot().feedback;
}
function correct(session, action, target) {
  const result = submit(session, action, target);
  assert.ok(
    ['correct', 'supported'].includes(result.verdict),
    `${action} ${target}: ${result.detail}`,
  );
  return result;
}

test('shuffle rounds cover all 35 cases without repeats and reproduce by seed', () => {
  assert.equal(REFEREE_CASES.length, 35);
  assert.equal(REFEREE_FAMILIES.length, 9);
  const sequence = (seed) => {
    const bag = new IncidentBag(seed);
    return Array.from({ length: 70 }, () => ({
      id: bag.next().id,
      variant: bag.variant(),
    }));
  };
  const a = sequence(7);
  assert.deepEqual(a, sequence(7));
  assert.notDeepEqual(a, sequence(99));
  for (const offset of [0, 35])
    assert.equal(
      new Set(a.slice(offset, offset + 35).map((item) => item.id)).size,
      35,
    );
});

test('assessment sources resolve and evidence stops before authored intervention', () => {
  for (const item of REFEREE_CASES) {
    assert.ok(
      RULE_SECTIONS.some(
        (section) =>
          section.document === 'soccer' &&
          ruleUrl(item).endsWith(`#${section.anchor}`),
      ),
      item.id,
    );
    assert.ok(evidenceClip(item).frames.every((frame) => frame.at <= item.end));
    const scene = caseScene(item, 999, variant);
    assert.equal(scene.label, '');
    assert.equal(scene.readout, '');
    assert.equal(scene.focus, null);
    for (const p of Object.values(scene.poses))
      assert.ok([p.x, p.z, p.yaw].every(Number.isFinite));
  }
  assert.ok(caseScene(definition('wall'), 999, variant).poses['blue-1']);
  assert.ok(
    caseScene(definition('multiple'), 999, variant).poses['blue-2'].z < 0,
  );
});

test('goal decisions award the correct team once, with duplicate protection', () => {
  const session = prepare('goal');
  assert.deepEqual(session.snapshot().score, { blue: 0, yellow: 0 });
  const key = session.decisionKey;
  correct(session, 'goal', 'blue');
  assert.equal(session.submit(key, { action: 'goal', target: 'blue' }), false);
  assert.deepEqual(session.snapshot().score, { blue: 1, yellow: 0 });
  session.continue();
  advance(session, 0.02);
  assert.match(session.match.state.message, /Yellow kickoff/);
});

test('wrong team is explained and a corrected retry does not earn first-try credit', () => {
  const session = prepare('own-goal');
  assert.equal(submit(session, 'goal', 'blue').verdict, 'wrong-target');
  assert.equal(session.snapshot().score.blue, 0);
  session.continue();
  correct(session, 'goal', 'yellow');
  assert.equal(session.snapshot().assessed, 1);
  assert.equal(session.snapshot().correct, 0);
});

test('pushing and multiple defense use the updated ball position and correct order', () => {
  const session = prepare('combined');
  assert.equal(submit(session, 'multiple', 'blue-2').verdict, 'incorrect');
  session.continue();
  correct(session, 'pushing');
  session.continue();
  assert.equal(submit(session, 'multiple', 'blue-2').verdict, 'wrong-target');
  session.continue();
  correct(session, 'multiple', 'blue-1');
  assert.equal(session.snapshot().bench.length, 0);
  assert.ok(
    distance(
      session.match.state.actors['blue-1'],
      session.match.state.actors.ball,
    ) > 1,
  );
});

test('discretionary waivers and equivalent damaged calls are accepted', () => {
  assert.equal(
    correct(prepare('pushed-out'), 'waive-out', 'blue-1').verdict,
    'supported',
  );
  assert.equal(
    correct(prepare('pushed-out'), 'out', 'blue-1').verdict,
    'supported',
  );
  for (const id of ['early', 'ball-out']) {
    const session = prepare(id);
    correct(session, 'damaged', 'blue-1');
    assert.equal(session.match.state.actors['blue-1'], undefined);
    assert.ok(session.bench['blue-1']);
  }
});

test('high ball can be called as soon as it exceeds the enclosure height', () => {
  const session = new RefereeMatch(2);
  session.beginCase(definition('ball-out'), variant);
  advance(session, 2);
  assert.ok(session.snapshot().heights.ball > 0.22);
  correct(session, 'ball-out', 'blue-1');
});

test('early whistle does not expose the future and early play-on resumes evidence', () => {
  const session = new RefereeMatch(2);
  session.beginCase(definition('wall'), variant);
  advance(session, 0.2);
  session.whistle();
  assert.ok(!session.snapshot().facts.includes('reaches the physical wall'));
  assert.equal(
    session.submit(session.decisionKey, { action: 'play-on' }),
    true,
  );
  assert.equal(session.phase, 'evidence');
  assert.equal(session.snapshot().assessed, 0);
});

test('lack of progress requires the count; pausing and premature calls preserve it', () => {
  const session = prepare('deadlock');
  const time = session.clock;
  advance(session, 5);
  assert.equal(session.clock, time);
  assert.equal(submit(session, 'lack-progress').verdict, 'incorrect');
  session.continue();
  correct(session, 'count');
  session.continue();
  advance(session, 0.5);
  assert.equal(submit(session, 'lack-progress').verdict, 'premature');
  session.continue();
  advance(session, 4);
  correct(session, 'lack-progress');
  assert.ok(distance(session.match.state.actors.ball, { x: 0, z: 0 }) > 0.5);
});

test('removed robots stay absent and early return is refused while play continues', () => {
  const session = prepare('wall');
  correct(session, 'out', 'blue-1');
  session.continue();
  const elapsed = session.match.state.elapsed;
  advance(session, 0.5);
  assert.ok(session.match.state.elapsed > elapsed);
  assert.equal(session.match.state.actors['blue-1'], undefined);
  assert.equal(session.nextCase(), false);
  assert.equal(session.beginCase(definition('goal')), false);
  const old = session.bench['blue-1'].eligibleAt;
  assert.equal(submit(session, 'return', 'blue-1').verdict, 'incorrect');
  assert.equal(session.bench['blue-1'].eligibleAt, old);
  session.continue();
  correct(session, 'keep-out', 'blue-1');
});

test('return eligibility respects time, readiness and kickoff; returned robot faces goal', () => {
  for (const swap of [false, true]) {
    const v = { swap, reflect: true },
      id = transformId('blue-1', v);
    for (const scenario of ['return-ready', 'return-kickoff']) {
      const session = prepare(scenario, v);
      assert.equal(session.canReturn(id), true);
      correct(session, 'return', id);
      const p = session.match.state.actors[id],
        goalZ = (swap ? 1 : -1) * FIELD.goalBackInnerFaceZ;
      assert.ok(Math.abs(Math.atan2(-p.x, goalZ - p.z) - p.yaw) < 1e-8);
      assert.equal(session.bench[id], undefined);
    }
    assert.equal(prepare('return-early', v).canReturn(id), false);
    assert.equal(prepare('return-broken', v).canReturn(id), false);
  }
});

test('early starter is not immediately eligible at that same kickoff', () => {
  const session = prepare('early');
  correct(session, 'early-start', 'blue-1');
  assert.equal(session.canReturn('blue-1'), false);
});

test('waiting goals and opponent-caused damage exception are distinct', () => {
  const waiting = prepare('both-damaged');
  correct(waiting, 'goal', 'yellow');
  assert.equal(waiting.snapshot().score.yellow, 1);
  assert.equal(waiting.snapshot().kickoffDue, true);
  const exception = prepare('damage-exception');
  correct(exception, 'wait');
  assert.deepEqual(exception.snapshot().score, { blue: 0, yellow: 0 });
});

test('rounded penalty geometry agrees with the shared field at both ends', () => {
  for (const end of [-1, 1]) {
    assert.equal(insidePenalty({ x: 0, z: end * 0.826 }, end), true);
    assert.equal(insidePenalty({ x: 0.39, z: end * 0.83 }, end), false);
    assert.equal(penaltyOverlap({ x: 0, z: end * 0.935 }, end, true), true);
    assert.equal(penaltyOverlap({ x: 0, z: end * 0.87 }, end, true), false);
    assert.equal(penaltyOverlap({ x: 0.18, z: end * 0.87 }, end), true);
  }
});

test('actual live multiple defense is graded from geometry', () => {
  const session = new RefereeMatch(1);
  session.match.place(caseScene(definition('multiple'), 999, variant).poses);
  session.whistle();
  assert.match(session.snapshot().facts, /Two teammates/);
  correct(session, 'multiple', 'blue-2');
});

test('lack-of-progress placement keeps a nearby free center spot eligible', () => {
  const session = new RefereeMatch(1);
  session.match.state.actors.ball = { x: 0.03, z: 0, yaw: 0 };
  assert.deepEqual(session.neutralSpot(false, 'ball', true), {
    x: 0,
    z: 0,
    yaw: 0,
  });
});

test('live goal feedback identifies the current end and guards every scoring-team offender', () => {
  const session = new RefereeMatch(1);
  session.match.state.phase = 'referee';
  session.match.state.pendingEvent = { kind: 'goal', team: 'yellow' };
  session.step();
  assert.match(session.snapshot().facts, /Blue defended/);
  const result = correct(session, 'goal', 'yellow');
  assert.ok(!result.detail.includes('awards Blue'));
  const blocked = new RefereeMatch(1);
  blocked.match.state.actors['blue-1'] = { x: 0.81, z: -0.2, yaw: 0 };
  blocked.match.state.actors['yellow-1'] = { x: 0.81, z: 0.2, yaw: 0 };
  blocked.match.state.phase = 'referee';
  blocked.match.state.pendingEvent = { kind: 'goal', team: 'yellow' };
  blocked.step();
  correct(blocked, 'no-goal');
  blocked.continue();
  correct(blocked, 'out', 'yellow-1');
  assert.equal(blocked.snapshot().score.yellow, 0);
});

test('a supported live play-on preserves an in-flight shot and the incident schedule', () => {
  const session = new RefereeMatch(1);
  session.match.state.ballVelocity = { x: 0.5, z: 1 };
  for (let i = 0; i < 10; i++) {
    session.whistle();
    correct(session, 'play-on');
    session.continue();
  }
  assert.deepEqual(session.match.state.ballVelocity, { x: 0.5, z: 1 });
  assert.equal(session.untilIncident, 3);
});

test('engine referee hooks hold goals without auto-awarding or auto-restarting', () => {
  const match = new SoccerMatch();
  const actors = { ball: { x: 0, z: FIELD.goalMouthZ - 0.04, yaw: 0 } };
  match.place(actors);
  match.state.ballVelocity = { x: 0, z: 2 };
  const settings = {
    controls: { blue: 'ai', yellow: 'ai' },
    selectedRobot: 'blue-1',
    duration: 120,
    referee: true,
  };
  for (let i = 0; i < 300; i++) match.step(settings);
  assert.equal(match.state.pendingEvent?.kind, 'goal');
  assert.equal(match.state.phase, 'referee');
  assert.deepEqual(match.state.score, { blue: 0, yellow: 0 });
});

test('engine can play with zero or one robot per team; removal preserves ball velocity', () => {
  const match = new SoccerMatch();
  match.state.ballVelocity = { x: 0.3, z: 0.6 };
  match.removeRobot('blue-1');
  assert.deepEqual(match.state.ballVelocity, { x: 0.3, z: 0.6 });
  for (const id of ['blue-2', 'yellow-1', 'yellow-2']) {
    match.removeRobot(id);
    for (let i = 0; i < 100; i++)
      match.step({
        controls: { blue: 'ai', yellow: 'ai' },
        selectedRobot: 'blue-1',
        duration: 120,
      });
    assert.ok(Number.isFinite(match.state.actors.ball.x));
    assert.equal(match.state.actors[id], undefined);
  }
});

test('every drill completes in all four symmetric variants without resurrecting benched robots', () => {
  for (const swap of [false, true])
    for (const reflect of [false, true])
      for (const item of REFEREE_CASES) {
        const v = { swap, reflect },
          session = prepare(item.id, v);
        for (let index = 0; index < item.steps.length; index++) {
          const expected = item.steps[index][0];
          let target = expected.target
            ? transformId(expected.target, v)
            : undefined;
          if (expected.target === 'farther') {
            const team = swap ? 'yellow' : 'blue';
            target = MATCH_ROBOTS.filter((r) => r.team === team).sort(
              (a, b) =>
                distance(
                  session.match.state.actors[b.id],
                  session.match.state.actors.ball,
                ) -
                distance(
                  session.match.state.actors[a.id],
                  session.match.state.actors.ball,
                ),
            )[0].id;
          }
          correct(session, expected.action, target);
          if (index < item.steps.length - 1) {
            session.continue();
            advance(session, 4);
          }
          for (const entry of session.snapshot().bench)
            assert.equal(
              session.match.state.actors[entry.robot],
              undefined,
              item.id,
            );
        }
        assert.equal(session.snapshot().assessed, 1, item.id);
        assert.equal(session.snapshot().correct, 1, item.id);
      }
});
