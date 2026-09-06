import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const { rulesForDecision } = await import('../lib/simulator/referee-rules.ts');
const {
  robotPenaltyOverlap,
  robotFootprint,
  penaltyEvidenceSegments,
  penaltyAreaOutline,
} = await import('../lib/simulator/referee-geometry.ts');
const { ROBOT_VISUALS } = await import('../lib/simulator/robot-models.ts');
const {
  REFEREE_CASES,
  REFEREE_FAMILIES,
  IncidentBag,
  caseScene,
  evidenceClip,
  requiresStoppage,
  transformId,
} = await import('../lib/simulator/referee-cases.ts');
const { SoccerMatch, MATCH_ROBOTS, MATCH_STEP } =
  await import('../lib/simulator/match.ts');
const { RCJ_FIELD_DERIVED: FIELD } =
  await import('../lib/simulator/field-spec.ts');
const { RULE_SECTIONS } = await import('../lib/rulebook/catalog.ts');
const { ruleUrl } = await import('../lib/simulator/referee-cases.ts');
const { SituationRecorder, sampleSituation } =
  await import('../lib/simulator/situation-replay.ts');
const { KickoffMeeting, randomKickoff } =
  await import('../lib/simulator/kickoff.ts');
const variant = { swap: false, reflect: false };
const definition = (id) => REFEREE_CASES.find((item) => item.id === id);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function advance(session, seconds) {
  for (let i = 0; i < Math.ceil(seconds / MATCH_STEP); i++) session.step();
}
function prepare(id, transform = variant, robotVisual) {
  const session = new RefereeMatch(2026, { robotVisual });
  assert.equal(session.beginCase(definition(id), transform), true);
  for (let i = 0; i < 1200 && session.phase === 'evidence'; i++) session.step();
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
  assert.ok(
    result.appliedRules.length > 0,
    `${action} must explain its source after success`,
  );
  for (const rule of result.appliedRules) {
    const section = RULE_SECTIONS.find(
      (section) => section.id === rule.sectionId,
    );
    assert.ok(section, `${rule.id} needs a real indexed section`);
    assert.equal(rule.number, section.number);
    assert.equal(new URL(rule.url).hash, `#${section.anchor}`);
    assert.equal(
      new URL(
        rule.lessonUrl,
        'https://example.test/rcj-soccer-lab/',
      ).searchParams.get('rule'),
      section.id,
    );
  }
  return result;
}
function frozenState(session) {
  const {
    actors,
    heights,
    ballVelocity,
    ballOwner,
    simulationTime,
    elapsed,
    score,
    bench,
  } = session.snapshot();
  return {
    actors,
    heights,
    ballVelocity,
    ballOwner,
    simulationTime,
    elapsed,
    score,
    bench,
  };
}
function assertFrozen(session, seconds = 10) {
  const before = frozenState(session);
  assert.deepEqual(before.ballVelocity, { x: 0, z: 0 });
  advance(session, seconds);
  assert.deepEqual(frozenState(session), before);
}
// Exercise event arbitration directly: simulation ticks must not run through a
// trainer pause, even when a test injects another event into the same frame.
function deliverGoal(session, team) {
  session.match.state.pendingEvent = { kind: 'goal', team };
  session.match.state.phase = 'referee';
  session.detectLiveIncident();
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
  const incident = session.snapshot().actors;
  session.continue();
  assertFrozen(session, 30);
  assert.deepEqual(session.snapshot().actors, incident);
  assert.equal(session.snapshot().canArrangeKickoff, true);
  assert.equal(session.nextCase(), false);
  assert.equal(session.beginCase(definition('wall')), false);
  assert.equal(session.arrangeKickoff(), true);
  assert.match(session.match.state.message, /Yellow kickoff/);
  assertFrozen(session);
  correct(session, 'start');
  assert.equal(session.motionHeld, false);
  session.continue();
  advance(session, 0.02);
  assert.equal(session.snapshot().kickoffDue, false);
  assert.ok(session.match.state.elapsed > 0);
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

test('a ball above the wall freezes the entire incident until the kicker is removed', () => {
  const session = new RefereeMatch(2);
  session.beginCase(definition('ball-out'), variant);
  advance(session, 159 * MATCH_STEP);
  assert.ok(session.snapshot().heights.ball < 0.22);
  session.step();
  assert.ok(session.snapshot().heights.ball > 0.22);
  assertFrozen(session);
  correct(session, 'ball-out', 'blue-1');
  assertFrozen(session);
  session.continue();
  const before = session.snapshot();
  advance(session, 0.2);
  assert.equal(session.match.state.actors['blue-1'], undefined);
  assert.ok(session.match.state.elapsed > before.elapsed);
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

test('lack-of-progress counts run live and cancel when progress resumes', () => {
  const session = prepare('deadlock');
  assert.equal(submit(session, 'lack-progress').verdict, 'incorrect');
  session.continue();
  correct(session, 'count');
  const elapsed = session.match.state.elapsed;
  advance(session, 0.2);
  assert.equal(session.motionHeld, false);
  assert.ok(session.match.state.elapsed > elapsed);
  session.continue();
  assert.equal(submit(session, 'lack-progress').verdict, 'premature');
  session.continue();
  session.match.state.actors.ball.x += 0.3;
  session.step();
  assert.equal(session.snapshot().count, null);
  assert.match(session.snapshot().facts, /progress has resumed/);
  assert.equal(submit(session, 'lack-progress').verdict, 'incorrect');
  session.continue();
  correct(session, 'play-on');
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

test('body footprints match current GLBs and preserve the shapes that a circle or hull loses', () => {
  const asset = JSON.parse(
    readFileSync(
      new URL('../lib/simulator/robot-footprints.json', import.meta.url),
      'utf8',
    ),
  );
  for (const visual of ROBOT_VISUALS.filter((model) => model.assetPath)) {
    const source = readFileSync(
      new URL(`../public/${visual.assetPath}`, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(source).digest('hex'),
      asset.models[visual.id].sha256,
      `${visual.id}: regenerate footprints after changing the mesh`,
    );
    if ('assetRevision' in visual)
      assert.equal(
        visual.assetRevision,
        asset.models[visual.id].sha256.slice(0, 12),
        'invalidate browser caches when the body asset changes',
      );
    assert.ok(
      robotFootprint(visual.id).some((polygon) => polygon.holes.length),
    );
  }
  const fixtures = JSON.parse(
    readFileSync(
      new URL('./robot-footprints.regressions.json', import.meta.url),
      'utf8',
    ),
  );
  for (const fixture of fixtures)
    for (const end of [-1, 1]) {
      const pose =
        end === 1
          ? fixture.pose
          : {
              x: -fixture.pose.x,
              z: -fixture.pose.z,
              yaw: fixture.pose.yaw + Math.PI,
            };
      assert.equal(
        robotPenaltyOverlap(pose, end, fixture.model),
        fixture.partialOverlap,
        `${fixture.model} ${fixture.id} end ${end}`,
      );
      const red = penaltyEvidenceSegments(pose, fixture.model).some(
        (segment) => segment.inside,
      );
      assert.equal(
        red,
        fixture.partialOverlap,
        `visual evidence: ${fixture.model} ${fixture.id} end ${end}`,
      );
    }
});

test('both imported robot bodies are centered, equally wide and fit their collision circle', () => {
  for (const visual of ROBOT_VISUALS.filter((model) => model.assetPath)) {
    const file = readFileSync(
      new URL(`../public/${visual.assetPath}`, import.meta.url),
    );
    assert.equal(file.readUInt32LE(8), file.length, 'valid GLB length');
    const jsonLength = file.readUInt32LE(12);
    const document = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
    const binary = file.subarray(28 + jsonLength);
    const read = (index) => {
      const accessor = document.accessors[index];
      const view = document.bufferViews[accessor.bufferView];
      const columns = accessor.type === 'VEC3' ? 3 : 1;
      const size = accessor.componentType === 5123 ? 2 : 4;
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const stride = view.byteStride ?? columns * size;
      return Array.from({ length: accessor.count }, (_, row) =>
        Array.from({ length: columns }, (_, column) => {
          const at = offset + row * stride + column * size;
          return accessor.componentType === 5126
            ? binary.readFloatLE(at)
            : size === 2
              ? binary.readUInt16LE(at)
              : binary.readUInt32LE(at);
        }),
      );
    };
    const points = [];
    for (const node of document.nodes)
      for (const key of ['matrix', 'translation', 'rotation', 'scale'])
        assert.equal(
          node[key],
          undefined,
          'normalization is baked into vertices',
        );
    for (const mesh of document.meshes)
      for (const primitive of mesh.primitives) {
        const positionId = primitive.attributes.POSITION;
        const positions = read(positionId);
        const indices = read(primitive.indices).flat();
        assert.equal(indices.length % 3, 0);
        for (const index of new Set(indices)) {
          assert.ok(index >= 0 && index < positions.length);
          points.push(positions[index]);
        }
        for (let axis = 0; axis < 3; axis++) {
          const coordinates = positions
            .map((point) => point[axis])
            .sort((a, b) => a - b);
          assert.equal(
            document.accessors[positionId].min[axis],
            coordinates[0],
          );
          assert.equal(
            document.accessors[positionId].max[axis],
            coordinates.at(-1),
          );
        }
      }
    const axes = [0, 1, 2].map((axis) =>
      points.map((point) => point[axis]).sort((a, b) => a - b),
    );
    const low = axes.map((values) => values[0]);
    const high = axes.map((values) => values.at(-1));
    assert.ok(
      Math.abs(high[0] - low[0] - 0.176) < 1e-7,
      visual.id + ': 176 mm body width',
    );
    for (const axis of [0, 2])
      assert.ok(
        Math.abs(high[axis] + low[axis]) < 1e-7,
        visual.id + ': centered body',
      );
    assert.ok(Math.abs(low[1]) < 1e-7, 'wheels sit on the ground');
    assert.ok(
      visual.markerHeight > high[1] + 0.01,
      'number badge clears the body',
    );
    assert.ok(
      points.every(([x, , z]) => Math.hypot(x, z) <= 0.1),
      'visible body fits physics clearance',
    );
    // A single distant CAD vertex must not determine the model's size.
    const trim = Math.floor(points.length * 0.001);
    const substantialWidth = axes[0][points.length - 1 - trim] - axes[0][trim];
    assert.ok(
      substantialWidth > 0.176 * 0.9,
      visual.id + ': full-size body, not an outlier-sized envelope',
    );
    const outline = robotFootprint(visual.id).flatMap(
      (polygon) => polygon.outer,
    );
    for (const [coordinate, axis] of [
      [0, 0],
      [1, 2],
    ]) {
      const values = outline
        .map((point) => point[coordinate])
        .sort((a, b) => a - b);
      assert.ok(Math.abs(values[0] - low[axis]) < 0.00002);
      assert.ok(Math.abs(values.at(-1) - high[axis]) < 0.00002);
    }
  }
});

test('a visible gap does not stop live play as multiple defense; actual entry does and remains frozen', () => {
  const session = new RefereeMatch(2026, {
    robotVisual: 'xlc-innovation-2021',
  });
  const poses = {
    'blue-1': { x: -0.12, z: 0.732, yaw: 0 },
    'blue-2': { x: 0.12, z: 0.79, yaw: 0 },
    'yellow-1': { x: -0.4, z: -0.4, yaw: 0 },
    'yellow-2': { x: 0.4, z: -0.4, yaw: 0 },
    ball: { x: 0, z: 0, yaw: 0 },
  };
  assert.ok(
    penaltyOverlap(poses['blue-1'], 1),
    'old physics circle produced a false call',
  );
  assert.equal(
    robotPenaltyOverlap(poses['blue-1'], 1, session.robotVisual),
    false,
  );
  session.match.place(poses);
  session.detectLiveIncident();
  assert.equal(session.phase, 'live');
  assert.equal(session.snapshot().decisionPaused, false);
  poses['blue-1'].z = 0.752;
  session.match.place(poses);
  session.detectLiveIncident();
  assert.equal(session.phase, 'decision');
  assert.match(session.snapshot().facts, /Blue 1 and Blue 2/);
  assert.equal(session.snapshot().penaltyEvidence, true);
  assertFrozen(session);
  correct(session, 'multiple', 'blue-2');
  assertFrozen(session);
});

test('white-line contact counts, and rendered area shares the referee boundary', () => {
  assert.equal(
    robotPenaltyOverlap(
      { x: 0.4154728583240673, z: 0.8095271416759326, yaw: -2.176384462121452 },
      1,
      'lab',
    ),
    true,
    'exact contact with the rounded white edge counts',
  );
  assert.equal(
    robotPenaltyOverlap({ x: 0.512, z: 1, yaw: -2.08834158862025 }, 1, 'lab'),
    true,
    'the protruding lab dribbler also counts',
  );
  for (const visual of ROBOT_VISUALS)
    for (const end of [-1, 1]) {
      const maxForward = Math.max(
        ...robotFootprint(visual.id).flatMap((polygon) =>
          polygon.outer.map((point) => point[1]),
        ),
      );
      const touching = {
        x: 0,
        z: end * (0.825 - maxForward),
        yaw: end === 1 ? 0 : Math.PI,
      };
      assert.equal(
        robotPenaltyOverlap(touching, end, visual.id),
        true,
        visual.id,
      );
      assert.equal(
        robotPenaltyOverlap(
          { ...touching, z: touching.z - end * 0.0001 },
          end,
          visual.id,
        ),
        false,
        visual.id,
      );
      assert.equal(
        robotPenaltyOverlap(
          { x: 0, z: end * 0.95, yaw: touching.yaw },
          end,
          visual.id,
          true,
        ),
        true,
      );
      assert.ok(
        penaltyAreaOutline(end).every(([x, z]) => insidePenalty({ x, z }, end)),
      );
      assert.equal(penaltyAreaOutline(end)[0][1], end * FIELD.penaltyBackEdgeZ);
    }
});

test('penalty exercises show actual body entry for every model, team, reflection and goal end', () => {
  for (const visual of ROBOT_VISUALS)
    for (const swap of [false, true])
      for (const reflect of [false, true])
        for (const direction of [-1, 1]) {
          for (const id of [
            'multiple',
            'repeat-defense',
            'combined',
            'full-area',
          ]) {
            const session = new RefereeMatch(2026, { robotVisual: visual.id });
            session.match.blueAttackDirection = direction;
            session.beginCase(definition(id), { swap, reflect });
            for (let i = 0; i < 1200 && session.phase === 'evidence'; i++)
              session.step();
            const poses = session.snapshot().actors;
            const team = swap ? 'yellow' : 'blue';
            if (id === 'full-area') {
              const target = transformId('blue-1', { swap, reflect });
              assert.ok(
                [-1, 1].some((end) =>
                  robotPenaltyOverlap(poses[target], end, visual.id, true),
                ),
                `${visual.id} full entry`,
              );
            } else {
              const robots = MATCH_ROBOTS.filter(
                (robot) => robot.team === team,
              );
              assert.ok(
                [-1, 1].some((end) =>
                  robots.every((robot) =>
                    robotPenaltyOverlap(poses[robot.id], end, visual.id),
                  ),
                ),
                `${visual.id} ${id} must visibly support multiple defense`,
              );
              assert.ok(
                robots.every((robot) =>
                  [-1, 1].every(
                    (end) =>
                      !robotPenaltyOverlap(
                        poses[robot.id],
                        end,
                        visual.id,
                        true,
                      ),
                  ),
                ),
                `${visual.id} ${id} must not instead be full entry`,
              );
            }
            assertFrozen(session);
          }
        }
});

test('actual live multiple defense is graded from geometry', () => {
  const session = new RefereeMatch(1);
  session.match.place(caseScene(definition('multiple'), 999, variant).poses);
  session.whistle();
  assert.match(session.snapshot().facts, /Blue 1 and Blue 2/);
  correct(session, 'multiple', 'blue-2');
});

test('correct-answer rule cards are withheld on retries and cite both partial entry and the white line', () => {
  const session = prepare('multiple');
  assert.equal(session.snapshot().feedback, null);
  const wrong = submit(session, 'goal', 'blue');
  assert.deepEqual(wrong.appliedRules, []);
  session.continue();
  const result = correct(session, 'multiple', 'blue-2');
  assert.deepEqual(
    result.appliedRules.map((rule) => rule.id),
    ['multiple', 'penalty-line'],
  );
  assert.equal(result.appliedRules[0].number, '2.6');
  assert.equal(result.appliedRules[1].number, '7');
  assert.match(result.appliedRules[1].quote, /line is part of the area/);
  result.appliedRules[0].number = 'changed outside the session';
  assert.equal(session.snapshot().feedback.appliedRules[0].number, '2.6');
  assertFrozen(session);
});

test('compound decisions cite the completed action and do not reuse the next step or a generic scoring rule', () => {
  const combined = prepare('combined');
  const first = correct(combined, 'pushing');
  assert.deepEqual(
    first.appliedRules.map((rule) => rule.id),
    ['pushing', 'order', 'penalty-line'],
  );
  combined.continue();
  assert.equal(combined.snapshot().feedback, null);
  const second = correct(combined, 'multiple', 'blue-1');
  assert.deepEqual(
    second.appliedRules.map((rule) => rule.id),
    ['multiple', 'order', 'penalty-line'],
  );
  assert.equal(first.appliedRules[0].id, 'pushing');
  const penalizedGoal = prepare('out-goal');
  assert.equal(correct(penalizedGoal, 'no-goal').appliedRules[0].id, 'outGoal');
  penalizedGoal.continue();
  assert.equal(
    correct(penalizedGoal, 'out', 'blue-2').appliedRules[0].id,
    'out',
  );
  assert.equal(
    correct(prepare('both-damaged'), 'goal', 'yellow').appliedRules[0].number,
    '2.9',
  );
  assert.equal(
    correct(prepare('goal'), 'goal', 'blue').appliedRules[0].number,
    '2.4',
  );
});

test('equivalent accepted calls and return requests retain their actual rule basis', () => {
  assert.deepEqual(
    correct(prepare('early'), 'damaged', 'blue-1').appliedRules.map(
      (rule) => rule.id,
    ),
    ['early', 'damage'],
  );
  assert.deepEqual(
    correct(prepare('ball-out'), 'damaged', 'blue-1').appliedRules.map(
      (rule) => rule.id,
    ),
    ['ballOut', 'damage'],
  );
  assert.deepEqual(
    correct(prepare('inspection'), 'inspect', 'blue-1').appliedRules.map(
      (rule) => rule.id,
    ),
    ['marker', 'compliance'],
  );
  const returned = rulesForDecision(definition('return-ready'), 'return', {
    returnReason: 'Out of bounds',
    kickoffDue: true,
  });
  assert.deepEqual(
    returned.map((rule) => rule.id),
    ['kickoffReturn', 'outReturn', 'out', 'damage'],
  );
  assert.deepEqual(
    rulesForDecision(definition('return-ready'), 'return', {
      returnReason: 'Inspection',
    }).map((rule) => rule.id),
    ['compliance'],
  );
});

test('live full entry identifies the penalty-area rule and restart decisions cite the chosen continuation', () => {
  const session = new RefereeMatch(2026);
  session.match.place(caseScene(definition('full-area'), 999, variant).poses);
  session.detectLiveIncident();
  assert.equal(session.active.definition.id, 'live-full-area');
  assert.deepEqual(
    correct(session, 'out', 'blue-1').appliedRules.map((rule) => rule.id),
    ['fullArea', 'out', 'penalty-line'],
  );
  const stopped = prepare('spectator');
  assert.deepEqual(
    correct(stopped, 'pause').appliedRules.map((rule) => rule.id),
    ['spectator', 'interruption'],
  );
  stopped.continue();
  assert.deepEqual(
    correct(stopped, 'neutral').appliedRules.map((rule) => rule.id),
    ['interruption', 'neutral', 'kickoff'],
  );
});

test('every allowed authored answer has a clause-specific rule reference', () => {
  for (const item of REFEREE_CASES)
    for (const choice of item.steps.flat()) {
      const refs = rulesForDecision(item, choice.action);
      assert.ok(refs.length, `${item.id}: ${choice.action}`);
      assert.ok(
        refs.every(
          (rule) =>
            rule.provision &&
            RULE_SECTIONS.some((section) => section.id === rule.sectionId),
        ),
      );
    }
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
        assertFrozen(session);
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
          correct(
            session,
            session.active.progressResumed ? 'play-on' : expected.action,
            session.active.progressResumed ? undefined : target,
          );
          if (session.motionHeld) assertFrozen(session);
          if (index < item.steps.length - 1) {
            session.continue();
            if (expected.action === 'count') {
              for (let i = 0; i < 400 && session.snapshot().count !== null; i++)
                session.step();
            }
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

test('the next random drill becomes available without stopping or teleporting play', () => {
  const session = new RefereeMatch(1);
  let previous = session.snapshot().actors;
  for (let i = 0; i < 400; i++) {
    session.step();
    const current = session.snapshot().actors;
    for (const id of Object.keys(previous))
      assert.ok(distance(current[id], previous[id]) < 0.1);
    previous = current;
  }
  assert.equal(session.phase, 'live');
  assert.equal(session.snapshot().drillReady, true);
  assert.equal(session.snapshot().caseNumber, 0);
  const before = session.match.state.elapsed;
  advance(session, 0.1);
  assert.ok(session.match.state.elapsed > before);
  assert.equal(session.nextCase(), true);
  assert.equal(session.snapshot().caseNumber, 1);
});

test('wrong early calls and retries hold exactly until explicit observation resume', () => {
  const session = new RefereeMatch(2);
  session.beginCase(definition('wall'), variant);
  advance(session, 0.3);
  session.whistle();
  const incident = frozenState(session);
  assertFrozen(session);
  assert.equal(submit(session, 'goal', 'blue').verdict, 'premature');
  assertFrozen(session);
  session.continue();
  assert.equal(session.phase, 'decision');
  assertFrozen(session);
  assert.deepEqual(frozenState(session), incident);
  assert.equal(session.resumeEvidence(), true);
  advance(session, 3);
  assert.equal(session.phase, 'decision');
  correct(session, 'out', 'blue-1');
});

test('recordings and paused decisions keep the exact incident endpoints', () => {
  for (const id of [
    'pushing',
    'multiple',
    'combined',
    'repeat-defense',
    'full-area',
    'ball-out',
    'early',
  ]) {
    for (const swap of [false, true])
      for (const reflect of [false, true]) {
        const v = { swap, reflect },
          session = prepare(id, v),
          item = definition(id);
        const replay = session.getLastReplay();
        assert.deepEqual(
          replay.frames.at(-1).actors,
          caseScene(item, 999, v).poses,
          id,
        );
        assertFrozen(session);
      }
  }
});

test('a live whistle freezes engine physics and preserves shot momentum for explicit resume', () => {
  const session = new RefereeMatch(1);
  session.match.state.ballVelocity = { x: 0.5, z: 1 };
  session.whistle();
  const held = frozenState(session);
  for (let i = 0; i < 100; i++)
    session.match.step({
      controls: { blue: 'ai', yellow: 'ai' },
      selectedRobot: 'blue-1',
      duration: 120,
      referee: true,
    });
  assert.deepEqual(frozenState(session), held);
  correct(session, 'play-on');
  assert.equal(session.motionHeld, false);
  session.continue();
  assert.deepEqual(session.match.state.ballVelocity, { x: 0.5, z: 1 });
  assert.deepEqual(session.snapshot().actors, held.actors);
});

test('waiving an opponent-caused wall contact corrects only the selected robot', () => {
  const session = prepare('pushed-out');
  const before = session.snapshot().actors;
  correct(session, 'waive-out', 'blue-1');
  const after = session.snapshot().actors;
  for (const id of Object.keys(before)) {
    if (id === 'blue-1') continue;
    assert.deepEqual(after[id], before[id], id);
  }
  assert.ok(distance(before['blue-1'], after['blue-1']) < 0.02);
  assertFrozen(session);
  session.continue();
  assert.equal(session.motionHeld, false);
});

test('damage freezes every robot and keeps its cue anchored through removal', () => {
  for (const swap of [false, true])
    for (const reflect of [false, true]) {
      const v = { swap, reflect },
        session = prepare('damaged', v);
      const id = transformId('blue-1', v),
        before = session.snapshot();
      assertFrozen(session);
      assert.deepEqual(session.snapshot().actors[id], before.actors[id]);
      assert.deepEqual(
        session.snapshot().damage.position,
        before.damage.position,
      );
      assert.deepEqual(session.snapshot().actors, before.actors);
      correct(session, 'damaged', id);
      assert.equal(session.snapshot().actors[id], undefined);
      assert.equal(session.snapshot().damage.removed, true);
      assert.deepEqual(
        session.snapshot().damage.position,
        before.damage.position,
      );
      assertFrozen(session);
      session.continue();
      advance(session, 0.1);
      assert.ok(session.match.state.elapsed > before.elapsed);
      assert.equal(session.snapshot().actors[id], undefined);
    }
});

test('natural out, multiple defense and pushing freeze before another physics tick', () => {
  for (const id of ['wall', 'full-area', 'multiple', 'pushing']) {
    const session = new RefereeMatch(1);
    session.match.place(caseScene(definition(id), 999, variant).poses);
    const initial = session.snapshot().actors;
    session.step();
    assert.equal(session.phase, 'decision', id);
    assert.equal(session.motionHeld, true);
    assert.deepEqual(session.snapshot().actors, initial);
    assertFrozen(session);
    if (id === 'multiple') correct(session, 'multiple', 'blue-2');
    else if (id === 'wall' || id === 'full-area')
      correct(session, 'out', 'blue-1');
    else correct(session, 'play-on');
    if (id !== 'pushing') assertFrozen(session);
    session.continue();
    const time = session.match.state.elapsed;
    advance(session, 0.1);
    assert.ok(session.match.state.elapsed > time);
  }
});

test('every judge decision freezes training, independently of official stoppage rules', () => {
  const stopped = new Set([
    'goal',
    'own-goal',
    'return-kickoff',
    'both-damaged',
    'damage-exception',
    'early',
    'setup',
    'ready',
    'interruption',
    'spectator',
    'preflight',
  ]);
  for (const item of REFEREE_CASES) {
    const session = prepare(item.id);
    assert.equal(requiresStoppage(item), stopped.has(item.id), item.id);
    assert.equal(session.motionHeld, true, item.id);
    assertFrozen(session, 1);
  }
});

test('wrong calls and correction feedback stay frozen while preserving shot momentum', () => {
  const session = new RefereeMatch(2026);
  session.match.place(caseScene(definition('multiple'), 999, variant).poses);
  session.match.state.ballVelocity = { x: 0.2, z: 0.1 };
  session.step();
  assert.equal(submit(session, 'out', 'blue-1').verdict, 'incorrect');
  assertFrozen(session);
  session.continue();
  assertFrozen(session);
  const state = session.snapshot();
  correct(session, 'multiple', 'blue-2');
  assert.deepEqual(session.match.state.ballVelocity, state.ballVelocity);
  for (const id of ['ball', 'blue-1', 'yellow-1', 'yellow-2'])
    assert.deepEqual(session.snapshot().actors[id], state.actors[id]);
  assertFrozen(session);
  session.continue();
  assert.equal(session.motionHeld, false);
  assert.deepEqual(session.match.state.ballVelocity, { x: 0.2, z: 0.1 });
});

test('start and resume signals release play immediately, even while feedback is open', () => {
  for (const scenario of ['ready', 'interruption', 'spectator']) {
    const session = prepare(scenario);
    if (scenario !== 'ready') {
      correct(session, 'pause');
      session.continue();
    }
    correct(session, scenario === 'ready' ? 'start' : 'resume');
    assert.equal(session.motionHeld, false, scenario);
    const elapsed = session.match.state.elapsed;
    session.step();
    assert.ok(session.match.state.elapsed > elapsed, scenario);
  }
});

test('authored incidents do not queue natural duplicates or request a second correction', () => {
  for (const [id, action, target] of [
    ['wall', 'out', 'blue-1'],
    ['multiple', 'multiple', 'blue-2'],
    ['return-ready', 'return', 'blue-1'],
  ]) {
    const session = prepare(id);
    session.step();
    assert.equal(session.snapshot().pendingDecisions, 0, id);
    correct(session, action, target);
    session.continue();
    assert.equal(session.phase, 'live', id);
    assert.equal(session.snapshot().pendingDecisions, 0, id);
    assert.equal(session.snapshot().assessed, 1, id);
  }
});

test('a valid goal preserves an outstanding official inspection obligation', () => {
  const session = prepare('inspection');
  deliverGoal(session, 'blue');
  assert.equal(session.motionHeld, true);
  assert.equal(session.snapshot().pendingDecisions, 1);
  assertFrozen(session);
  correct(session, 'goal', 'blue');
  session.continue();
  correct(session, 'inspect', 'blue-1');
  session.continue();
  assert.equal(session.snapshot().canArrangeKickoff, true);
});

test('pending pushing is judged before its possible resulting goal is awarded', () => {
  for (const call of ['goal', 'no-goal']) {
    const session = prepare('pushing');
    deliverGoal(session, 'yellow');
    assert.equal(session.motionHeld, true);
    assert.match(session.snapshot().facts, /whether pushing caused/);
    correct(session, call, call === 'goal' ? 'yellow' : undefined);
    if (call === 'no-goal') {
      assertFrozen(session);
      session.continue();
      correct(session, 'pushing');
      assert.equal(session.snapshot().score.yellow, 0);
    } else assert.equal(session.snapshot().score.yellow, 1);
  }
});

test('resolving a completed lack-of-progress count does not reopen the finished decision', () => {
  const session = prepare('deadlock');
  session.match.removeRobot('blue-2');
  session.match.removeRobot('yellow-2');
  correct(session, 'count');
  for (let i = 0; i < 400 && session.snapshot().count !== null; i++)
    session.step();
  assert.equal(session.active.progressResumed, undefined);
  correct(session, 'lack-progress');
  const feedback = session.snapshot().feedback;
  session.step();
  assert.deepEqual(session.snapshot().feedback, feedback);
  assert.equal(session.snapshot().assessed, 1);
});

test('replay after a completed incident cannot alter scoring, bench timers or future physics', () => {
  for (const scenario of ['goal', 'wall', 'damaged', 'deadlock']) {
    const reviewed = prepare(scenario),
      control = prepare(scenario);
    if (scenario === 'wall' || scenario === 'damaged') {
      for (const session of [reviewed, control]) {
        correct(session, scenario === 'wall' ? 'out' : 'damaged', 'blue-1');
        session.continue();
      }
    }
    const recording = reviewed.getLastReplay();
    assert.ok(recording);
    for (let t = 0; t <= recording.duration; t += 0.1) {
      const view = sampleSituation(recording, t);
      view.actors.ball.x += 100;
      view.score.blue += 100;
    }
    recording.frames[0].actors.ball.x += 100;
    assert.deepEqual(reviewed, control, scenario);
    for (let tick = 0; tick < 30; tick++) {
      reviewed.step();
      control.step();
    }
    assert.deepEqual(reviewed, control, scenario);
  }
});

test('natural incidents preserve a replay with their lead-up after their decision is finished', () => {
  const session = new RefereeMatch(7);
  advance(session, 0.5);
  session.match.state.pendingEvent = { kind: 'goal', team: 'blue' };
  session.match.state.phase = 'referee';
  session.step();
  const replay = session.getLastReplay();
  assert.ok(replay.frames.length > 2);
  const final = structuredClone(replay.frames.at(-1));
  assert.deepEqual(final.actors, session.snapshot().actors);
  correct(session, 'goal', 'blue');
  session.continue();
  assert.deepEqual(session.getLastReplay(), replay);
  assert.equal(sampleSituation(replay, replay.duration).score.blue, 0);
  assert.equal(session.snapshot().score.blue, 1);
});

test('recording is bounded, detached and keeps removals as discrete frames', () => {
  const recorder = new SituationRecorder();
  const makeFrame = (at) => ({
    at,
    actors: { ball: { x: 0, z: 0, yaw: 0 }, 'blue-1': { x: at, z: 0, yaw: 0 } },
    heights: {},
    score: { blue: 0, yellow: 0 },
    elapsed: at,
    damage: null,
  });
  for (let i = 0; i <= 360; i++) recorder.capture(makeFrame(i / 30));
  const recent = recorder.seal('Recent play', 'Observe');
  assert.ok(recent.frames.length <= 250);
  assert.ok(recent.duration <= 8);
  recorder.resetBuffer();
  recorder.capture(makeFrame(0));
  const removed = makeFrame(1);
  delete removed.actors['blue-1'];
  recorder.capture(removed);
  recorder.capture(makeFrame(2));
  const cut = recorder.seal('Removal', 'Observe the robot');
  assert.ok(sampleSituation(cut, 0.99).actors['blue-1']);
  assert.equal(sampleSituation(cut, 1.5).actors['blue-1'], undefined);
  assert.equal(sampleSituation(cut, 2).actors['blue-1'].x, 2);
});

test('accepted goals expire earlier geometry decisions without moving the scene', () => {
  for (const id of ['multiple', 'repeat-defense', 'deadlock']) {
    const session = prepare(id);
    deliverGoal(session, 'blue');
    const actors = session.snapshot().actors;
    correct(session, 'goal', 'blue');
    session.continue();
    assert.deepEqual(session.snapshot().actors, actors);
    assert.equal(session.snapshot().pendingDecisions, 0, id);
    assert.equal(session.active, null, id);
    assert.equal(session.snapshot().canArrangeKickoff, true, id);
    assert.equal(session.snapshot().score.blue, 1);
    assert.match(session.getLastReplay().title, /goal/i);
  }
});

test('natural Yellow combined defense keeps its target through goal adjudication', () => {
  const session = new RefereeMatch(2026);
  session.match.place(
    caseScene(definition('combined'), 999, { ...variant, swap: true }).poses,
  );
  session.step();
  assert.equal(session.active.definition.id, 'live-combined');
  deliverGoal(session, 'blue');
  correct(session, 'no-goal');
  session.continue();
  correct(session, 'pushing');
  session.continue();
  const relocation = session
    .expected()
    .find((choice) => choice.action === 'multiple');
  assert.match(relocation.target, /^yellow-/);
  correct(session, 'multiple', relocation.target);
});

test('a resolved pushing call cannot disallow a later goal', () => {
  const session = prepare('combined');
  correct(session, 'pushing');
  session.continue();
  deliverGoal(session, 'blue');
  assert.equal(session.active.definition.id, 'live-goal');
  assert.equal(
    session.expected().some((call) => call.action === 'no-goal'),
    false,
  );
  correct(session, 'goal', 'blue');
  session.continue();
  assert.equal(session.snapshot().canArrangeKickoff, true);
});

test('a goal supersedes an ordinary whistle assessment with a resume alternative', () => {
  const session = new RefereeMatch(2026);
  session.whistle();
  deliverGoal(session, 'blue');
  correct(session, 'goal', 'blue');
  session.continue();
  assert.equal(session.active, null);
  assert.equal(session.snapshot().canArrangeKickoff, true);
});

test('return checks stay frozen while paused and revalidate updated bench state', () => {
  for (const [id, seconds] of [
    ['return-early', 36],
    ['return-broken', 13],
  ]) {
    const session = prepare(id);
    session.requestHint(true);
    assert.equal(session.snapshot().help.choices[0].action, 'keep-out');
    const bench = structuredClone(session.bench);
    assertFrozen(session, seconds);
    assert.deepEqual(session.bench, bench);
    // Revalidation still uses present state if eligibility changes between calls.
    session.clock += seconds;
    session.bench['blue-1'].ready = true;
    assert.equal(session.canReturn('blue-1'), true, id);
    assert.equal(session.snapshot().help.choices[0].action, 'return', id);
    assert.match(session.snapshot().facts, /repaired, eligible/);
    correct(session, 'return', 'blue-1');
    assert.match(session.snapshot().feedback.detail, /now repaired/);
    assert.ok(session.match.state.actors['blue-1']);
  }
});

test('progress before the initial count and cleared defense accept play on', () => {
  const session = new RefereeMatch(2026);
  session.match.state.pendingEvent = { kind: 'lack-progress' };
  session.match.state.phase = 'referee';
  session.step();
  session.match.state.actors.ball.x += 0.2;
  session.refreshProgress();
  assert.match(session.snapshot().facts, /progress has resumed/);
  assert.equal(correct(session, 'play-on').final, true);
  const defense = prepare('multiple');
  defense.match.state.actors['blue-2'] = { x: 0.4, z: 0.3, yaw: 0 };
  const before = defense.snapshot().actors;
  assert.match(defense.snapshot().facts, /arrangement has cleared/);
  assert.equal(correct(defense, 'play-on').final, true);
  assert.deepEqual(defense.snapshot().actors, before);
});

test('hints are unlimited, disclose exact targets and never change the match', () => {
  const session = prepare('multiple');
  const before = frozenState(session);
  for (let i = 0; i < 25; i++) assert.equal(session.requestHint(), true);
  assert.equal(session.snapshot().help.level, 3);
  assert.deepEqual(frozenState(session), before);
  assert.equal(session.snapshot().assessed, 0);
  assert.equal(session.active.mistakes, false);
  const answer = session.snapshot().help.choices[0];
  assert.equal(answer.target, 'blue-2');
  correct(session, answer.action, answer.target);
  assert.equal(session.snapshot().assisted, 1);
  assert.equal(session.snapshot().correct, 0);
});

test('resolve for me completes every exercise across teams, reflections and ends', () => {
  for (const direction of [-1, 1])
    for (const swap of [false, true])
      for (const reflect of [false, true])
        for (const item of REFEREE_CASES) {
          const session = new RefereeMatch(2026);
          session.match.blueAttackDirection = direction;
          session.beginCase(item, { swap, reflect });
          assert.equal(session.resolveForMe(), true, item.id);
          for (let i = 0; i < 1500 && session.snapshot().resolving; i++)
            session.step();
          assert.equal(
            session.snapshot().assessed,
            1,
            `${item.id}/${direction}/${swap}/${reflect}`,
          );
          assert.equal(session.snapshot().assisted, 1, item.id);
          assert.equal(session.snapshot().correct, 0, item.id);
          assert.ok(
            session.history.every((call) =>
              ['correct', 'supported'].includes(call.verdict),
            ),
            item.id,
          );
          assert.equal(session.snapshot().feedback.final, true, item.id);
        }
});

test('automatic help resumes a whistled count and cancels on a new goal', () => {
  const session = prepare('deadlock');
  session.match.removeRobot('blue-2');
  session.match.removeRobot('yellow-2');
  correct(session, 'count');
  session.continue();
  session.whistle();
  assert.equal(session.canAdvance, false);
  session.resolveForMe();
  advance(session, 3.1);
  assert.equal(session.snapshot().assisted, 1);
  assert.equal(session.snapshot().resolving, false);
  const interrupted = prepare('deadlock');
  interrupted.resolveForMe();
  interrupted.match.state.pendingEvent = { kind: 'goal', team: 'blue' };
  interrupted.match.state.phase = 'referee';
  interrupted.step();
  assert.equal(interrupted.snapshot().resolving, false);
  assert.equal(interrupted.snapshot().score.blue, 0);
  assert.equal(interrupted.snapshot().help.choices[0].action, 'goal');
});

test('coin toss locks setup, allocates the remaining choice and waits for the signal', () => {
  const winners = new Set();
  for (const takeKickoff of [false, true])
    for (const end of ['blue', 'yellow'])
      for (const seed of [1, 2026, 4294967295, 7654321]) {
        const session = new RefereeMatch(seed, { preMatch: true });
        assertFrozen(session);
        assert.equal(session.beginCase(definition('goal')), false);
        assert.equal(session.chooseOpeningEnd(end), false);
        assert.equal(
          session.submit(session.decisionKey, { action: 'start' }),
          false,
        );
        assert.equal(session.tossCoin(), true);
        assert.equal(session.tossCoin(), false);
        const winner = session.snapshot().opening.winner;
        winners.add(winner);
        if (takeKickoff) assert.equal(session.chooseFirstKickoff(), true);
        const choosing = session.snapshot().opening.choosingTeam;
        assert.equal(session.chooseOpeningEnd(end), true);
        const opening = session.snapshot().opening;
        assert.match(session.getLastReplay().title, /^(Blue|Yellow) kickoff$/);
        assert.ok(session.snapshot().help.rule.endsWith('#kick-off'));
        assert.equal(opening.firstKickoff === winner, takeKickoff);
        assert.equal(
          session.match.attackDirection(choosing),
          end === 'yellow' ? 1 : -1,
        );
        assert.equal(session.chooseOpeningEnd(end), false);
        assertFrozen(session);
        const poses = session.snapshot().actors;
        correct(session, 'start');
        assert.deepEqual(session.snapshot().actors, poses);
        assert.equal(session.snapshot().opening, null);
        assert.equal(session.canAdvance, true);
        session.step();
        assert.ok(session.match.state.elapsed > 0);
      }
  assert.equal(winners.size, 2);
});

test('random kickoff footprints remain legal for all teams, ends, and missing robots', () => {
  const ids = MATCH_ROBOTS.map((robot) => robot.id);
  const assertLayout = (poses, kickoff, direction) => {
    assert.deepEqual(poses.ball, { x: 0, z: 0, yaw: 0 });
    for (const [id, pose] of Object.entries(poses)) {
      if (id === 'ball') continue;
      const team = id.startsWith('blue') ? 'blue' : 'yellow';
      const ownSide = team === 'blue' ? -direction : direction;
      assert.ok(pose.z * ownSide >= 0.1);
      assert.ok(Math.abs(pose.x) <= 0.69 && Math.abs(pose.z) <= 0.995);
      assert.ok([-1, 1].every((end) => !penaltyOverlap(pose, end)));
      if (team !== kickoff) assert.ok(Math.hypot(pose.x, pose.z) >= 0.4);
      for (const [other, p] of Object.entries(poses))
        if (other !== id)
          assert.ok(distance(pose, p) >= (other === 'ball' ? 0.123 : 0.2));
    }
  };
  for (const direction of [-1, 1])
    for (const team of ['blue', 'yellow', 'neutral']) {
      const rng = new KickoffMeeting(19);
      for (let i = 0; i < 500; i++) {
        const liveIds = i % 2 ? ids : ids.filter((id) => id !== 'blue-1');
        const poses = randomKickoff(liveIds, team, direction, () =>
          rng.random(),
        );
        assertLayout(poses, team, direction);
        assert.deepEqual(
          Object.keys(poses).sort(),
          ['ball', ...liveIds].sort(),
        );
      }
      for (const constant of [0, 0.5, 0.9, 0.999999])
        assertLayout(
          randomKickoff(ids, team, direction, () => constant),
          team,
          direction,
        );
    }
});

test('reversing ends maps both back-wall goals to the correct attacking team', () => {
  for (const direction of [-1, 1])
    for (const end of [-1, 1]) {
      const match = new SoccerMatch();
      match.blueAttackDirection = direction;
      match.place({
        ball: { x: 0, z: end * (FIELD.goalMouthZ - 0.04), yaw: 0 },
      });
      match.state.ballVelocity = { x: 0, z: end * 1.5 };
      for (let i = 0; i < 90 && !match.state.pendingEvent; i++)
        match.step({
          controls: { blue: 'off', yellow: 'off' },
          selectedRobot: 'blue-1',
          duration: 600,
          referee: true,
        });
      assert.deepEqual(match.state.pendingEvent, {
        kind: 'goal',
        team: end === direction ? 'blue' : 'yellow',
      });
    }
});

test('neither Run, observation resume nor hints bypass an outstanding referee action', () => {
  for (const id of ['wall', 'multiple', 'damaged', 'inspection']) {
    const session = prepare(id);
    const before = frozenState(session);
    session.whistle();
    session.requestHint(true);
    session.resumeMotion();
    assert.equal(session.snapshot().canResumeEvidence, false, id);
    assert.equal(session.resumeEvidence(), false, id);
    assert.equal(session.canAdvance, false, id);
    session.continue();
    assertFrozen(session);
    assert.deepEqual(frozenState(session), before, id);
  }
});

test('multi-step corrections stay paused between every required judge action', () => {
  for (const [id, first, target, second] of [
    ['combined', 'pushing', undefined, 'multiple'],
    ['out-goal', 'no-goal', undefined, 'out'],
    ['interruption', 'pause', undefined, 'resume'],
  ]) {
    const session = prepare(id);
    correct(session, first, target);
    assertFrozen(session);
    const corrected = frozenState(session);
    session.continue();
    assert.equal(session.expected()[0].action, second);
    assertFrozen(session);
    assert.deepEqual(frozenState(session), corrected);
  }
});

test('wrong calls during a count pause both the count and physics until explicit continuation', () => {
  const session = prepare('deadlock');
  correct(session, 'count');
  session.continue();
  advance(session, 0.1);
  assert.equal(submit(session, 'lack-progress').verdict, 'premature');
  const count = session.countFor;
  assertFrozen(session);
  assert.equal(session.countFor, count);
  session.continue();
  assert.equal(session.canAdvance, true);
  advance(session, 0.1);
  assert.ok(session.countFor > count);
});

test('new out or multiple defense interrupts a running count at the exact incident', () => {
  for (const id of ['wall', 'multiple']) {
    const session = prepare('deadlock');
    correct(session, 'count');
    session.continue();
    const scene = caseScene(definition(id), 999, variant).poses;
    session.match.place(scene);
    session.step();
    assert.equal(session.active.definition.id, `live-${id}`);
    assert.deepEqual(session.snapshot().actors, scene);
    assert.equal(session.snapshot().count, null);
    assert.equal(session.snapshot().pendingDecisions, 1);
    assertFrozen(session);
    const answer = session.expected()[0];
    correct(session, answer.action, answer.target);
    assertFrozen(session);
    session.continue();
    assert.equal(session.active.definition.id, 'deadlock');
    assert.equal(session.expected()[0].action, 'count');
    assert.equal(session.snapshot().pendingDecisions, 0);
    assertFrozen(session);
  }
});

test('completed assisted removal waits for Resume and does not advance bench timers', () => {
  const session = prepare('wall');
  session.resolveForMe();
  assert.equal(session.snapshot().feedback.final, true);
  assert.equal(session.snapshot().resolving, false);
  const bench = structuredClone(session.bench);
  const replay = session.getLastReplay();
  sampleSituation(replay, replay.duration);
  assertFrozen(session);
  assert.deepEqual(session.bench, bench);
  session.continue();
  assert.equal(session.canAdvance, true);
  advance(session, 0.1);
  assert.ok(session.snapshot().bench[0].remaining < 60);
  assert.equal(session.snapshot().actors['blue-1'], undefined);
});

test('progress ending a count freezes the actual engine and clears visible velocity', () => {
  const session = prepare('deadlock');
  correct(session, 'count');
  session.continue();
  session.match.state.actors.ball.x += 0.2;
  session.match.state.ballVelocity = { x: 1, z: 0.1 };
  session.step();
  assert.equal(session.phase, 'decision');
  assert.equal(session.snapshot().count, null);
  assert.equal(session.match.state.phase, 'referee');
  assertFrozen(session);
});

test('fresh contact pauses even when earlier Play on feedback is still open', () => {
  const session = new RefereeMatch(2026);
  const contact = caseScene(definition('pushing'), 999, variant).poses;
  session.match.place(contact);
  session.step();
  correct(session, 'play-on');
  const number = session.snapshot().caseNumber;
  session.step();
  assert.equal(session.snapshot().caseNumber, number);
  assert.equal(session.motionHeld, false);
  session.match.restart('neutral');
  session.step();
  assert.equal(session.snapshot().caseNumber, number);
  session.match.place(contact);
  session.step();
  assert.ok(session.snapshot().caseNumber > number);
  assert.equal(session.phase, 'decision');
  assert.deepEqual(session.snapshot().actors, contact);
  assertFrozen(session);
});
