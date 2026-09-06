import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Load the engine's actual TypeScript without a second build or test dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith('./') &&
      context.parentURL?.includes('/lib/simulator/') &&
      !/\.(ts|json)$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json') && url.includes('/lib/simulator/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
      };
    if (url.endsWith('.ts') && url.includes('/lib/simulator/')) {
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
    }
    return nextLoad(url, context);
  },
});

const { SoccerMatch, MATCH_ROBOTS, MATCH_STEP, NO_DRIVE } =
  await import('../lib/simulator/match.ts');
const { clampRobotToField, robotTouchesFieldWall, robotWallClearance } =
  await import('../lib/simulator/referee-geometry.ts');
const { RCJ_FIELD_DERIVED: FIELD } = await import(
  '../lib/simulator/field-spec.ts'
);
const settings = (controls = { blue: 'manual', yellow: 'off' }) => ({
  controls,
  selectedRobot: 'blue-1',
  duration: 120,
});
const advance = (
  match,
  seconds,
  configuration = settings(),
  input = NO_DRIVE,
) => {
  for (let i = 0; i < Math.round(seconds / MATCH_STEP); i += 1)
    match.step(configuration, input);
};

test('manual drive is continuous, robot-relative, and stops on release', () => {
  const match = new SoccerMatch();
  match.state.actors['blue-1'] = { x: -0.4, z: -0.3, yaw: Math.PI / 2 };
  advance(match, 0.3, settings(), { ...NO_DRIVE, forward: 1 });
  assert.ok(match.state.actors['blue-1'].x > -0.21);
  assert.ok(Math.abs(match.state.actors['blue-1'].z + 0.3) < 1e-6);
  const stopped = { ...match.state.actors['blue-1'] };
  advance(match, 0.2);
  assert.deepEqual(match.state.actors['blue-1'], stopped);
});

test('diagonal movement respects the same speed cap', () => {
  const match = new SoccerMatch();
  match.state.actors['blue-1'] = { x: -0.5, z: -0.5, yaw: 0 };
  advance(match, 0.2, settings(), { ...NO_DRIVE, forward: 1, strafe: 1 });
  const pose = match.state.actors['blue-1'];
  assert.ok(
    Math.abs(Math.hypot(pose.x + 0.5, pose.z + 0.5) - 0.68 * 0.2) < 1e-6,
  );
});

test('stationary teams ignore driving commands and do not move', () => {
  const match = new SoccerMatch();
  const before = match.snapshot().actors;
  advance(match, 1, settings({ blue: 'off', yellow: 'off' }), {
    ...NO_DRIVE,
    forward: 1,
    turn: 1,
    kick: true,
  });
  assert.deepEqual(match.state.actors, before);
});

test('robot collisions prevent driving through a stationary opponent', () => {
  const match = new SoccerMatch();
  match.state.actors['blue-1'] = { x: 0, z: -0.4, yaw: 0 };
  match.state.actors['yellow-1'] = { x: 0, z: 0.1, yaw: Math.PI };
  advance(match, 1, settings(), { ...NO_DRIVE, forward: 1 });
  assert.ok(match.state.actors['blue-1'].z <= -0.0999);
});

test('body-aware wall physics reaches the rendered model and clamps its yawed footprint', () => {
  for (const [visual, yaw] of [
    ['lab', Math.PI / 4],
    ['xlc-innovation-2021', 0],
  ]) {
    const match = new SoccerMatch();
    match.setRobotVisual(visual);
    match.place({
      'blue-1': { x: 0.55, z: 0, yaw },
      ball: { x: -0.4, z: 0, yaw: 0 },
    });
    const towardWall = {
      ...NO_DRIVE,
      forward: Math.sin(yaw),
      strafe: Math.cos(yaw),
      dribble: false,
    };
    advance(match, 1, settings(), towardWall);
    const pose = match.state.actors['blue-1'];
    const expected = clampRobotToField({ x: 2, z: 0, yaw }, visual);
    assert.ok(Math.abs(pose.x - expected.x) < 1e-7, visual);
    assert.equal(robotTouchesFieldWall(pose, visual), true, visual);
    assert.ok(robotWallClearance(pose, visual).gap >= -1e-8, visual);
  }
});

test('a kick works only in front and releases the dribbler', () => {
  const match = new SoccerMatch();
  match.state.actors['blue-1'] = { x: 0, z: -0.3, yaw: 0 };
  match.state.actors.ball = { x: 0, z: -0.175, yaw: 0 };
  advance(match, 0.36, settings({ blue: 'off', yellow: 'off' }));
  match.step(settings(), { ...NO_DRIVE, kick: true });
  assert.ok(match.state.ballVelocity.z > 2.9);
  assert.equal(match.state.ballOwner, null);
  const behind = new SoccerMatch();
  behind.state.actors.ball = { x: -0.13, z: -0.465, yaw: 0 };
  behind.step(settings(), { ...NO_DRIVE, kick: true, dribble: false });
  assert.equal(behind.state.ballVelocity.z, 0);
});

test('a moving robot pushes a free ball', () => {
  const match = new SoccerMatch();
  match.state.actors['blue-1'] = { x: 0, z: -0.3, yaw: 0 };
  match.state.actors.ball = { x: 0, z: -0.16, yaw: 0 };
  advance(match, 0.3, settings(), { ...NO_DRIVE, forward: 1, dribble: false });
  assert.ok(match.state.actors.ball.z > -0.03);
});

for (const end of [-1, 1]) {
  test(`goals require back-wall contact, count once, and restart (end ${end})`, () => {
    const match = new SoccerMatch();
    const config = settings({ blue: 'off', yellow: 'off' });
    match.state.actors.ball = { x: 0.04, z: end * 1.06, yaw: 0 };
    match.state.ballVelocity = { x: 0, z: end * 1.2 };
    advance(match, 0.025, config);
    assert.equal(
      match.state.score.blue + match.state.score.yellow,
      0,
      'mouth crossing alone is not a goal',
    );
    advance(match, 0.1, config);
    assert.equal(match.state.score[end === 1 ? 'blue' : 'yellow'], 1);
    assert.equal(match.state.phase, 'goal');
    advance(match, 2, config);
    assert.equal(match.state.score.blue + match.state.score.yellow, 1);
    assert.equal(match.state.phase, 'playing');
    // Rule 2.3: the restart kickoff places the ball at the field centre.
    assert.equal(match.state.actors.ball.x, 0);
    assert.equal(match.state.actors.ball.z, 0);
  });
  test(`outside back-wall shots do not score (end ${end})`, () => {
    const match = new SoccerMatch();
    match.state.actors.ball = { x: 0, z: end * 1.181, yaw: 0 };
    match.state.ballVelocity = { x: 0, z: -end * 3 };
    advance(match, 0.05, settings({ blue: 'off', yellow: 'off' }));
    assert.equal(match.state.score.blue + match.state.score.yellow, 0);
    assert.ok(match.state.actors.ball.z * end >= 1.17);
  });
}

test('kickoff places the ball at the centre with the non-kickoff team clear of it', () => {
  const assertLegalKickoff = (match, kickoffTeam) => {
    assert.equal(match.state.actors.ball.x, 0);
    assert.equal(match.state.actors.ball.z, 0);
    for (const robot of MATCH_ROBOTS) {
      const pose = match.state.actors[robot.id];
      if (robot.team !== kickoffTeam) {
        assert.ok(
          Math.hypot(pose.x, pose.z) >= 0.4,
          `${robot.id} is within 0.4m of centre at ${kickoffTeam} kickoff`,
        );
      }
      const ownHalfSign = robot.team === 'blue' ? -1 : 1;
      assert.ok(
        pose.z * ownHalfSign >= 0,
        `${robot.id} is not on its own half at ${kickoffTeam} kickoff`,
      );
    }
  };
  const match = new SoccerMatch();
  assertLegalKickoff(match, 'blue');
  const config = settings({ blue: 'off', yellow: 'off' });
  match.state.actors.ball = { x: 0.04, z: 1.06, yaw: 0 };
  match.state.ballVelocity = { x: 0, z: 1.2 };
  advance(match, 0.125, config);
  assert.equal(match.state.score.blue, 1, 'blue scores at the positive end');
  advance(match, 2, config);
  assert.equal(match.state.phase, 'playing');
  assertLegalKickoff(match, 'yellow');
});

test('lack of progress moves only the ball to the nearest neutral spot', () => {
  const match = new SoccerMatch();
  const config = {
    controls: { blue: 'ai', yellow: 'ai' },
    selectedRobot: 'blue-1',
    duration: 120,
    disabledRobots: MATCH_ROBOTS.map((robot) => robot.id),
  };
  match.state.actors.ball = { x: 0.6, z: 0.95, yaw: 0 };
  match.state.ballVelocity = { x: 0, z: 0 };
  const before = Object.fromEntries(
    MATCH_ROBOTS.map((robot) => [robot.id, { ...match.state.actors[robot.id] }]),
  );
  advance(match, 8.5, config);
  assert.equal(match.state.actors.ball.x, FIELD.neutralSpotX);
  assert.equal(match.state.actors.ball.z, FIELD.neutralSpotZ);
  assert.deepEqual(match.state.ballVelocity, { x: 0, z: 0 });
  assert.equal(match.state.ballOwner, null);
  for (const robot of MATCH_ROBOTS) {
    assert.deepEqual(match.state.actors[robot.id], before[robot.id]);
  }
});

test('the match clock keeps advancing during a goal pause and finishes on time', () => {
  const match = new SoccerMatch();
  const config = settings({ blue: 'off', yellow: 'off' });
  match.state.actors.ball = { x: 0.04, z: 1.06, yaw: 0 };
  match.state.ballVelocity = { x: 0, z: 1.2 };
  advance(match, 0.125, config);
  assert.equal(match.state.phase, 'goal');
  let previous = match.state.elapsed;
  let steps = 0;
  while (match.state.phase === 'goal' && steps++ < 500) {
    match.step(config);
    assert.ok(
      Math.abs(match.state.elapsed - previous - MATCH_STEP) < 1e-9,
      `elapsed did not advance by one step at ${match.state.elapsed}`,
    );
    previous = match.state.elapsed;
  }
  assert.equal(match.state.phase, 'playing');
});

test('first lack-of-progress placement can use the current free spot; a repeat uses a different spot', () => {
  const match = new SoccerMatch();
  const config = {
    controls: { blue: 'ai', yellow: 'ai' },
    selectedRobot: 'blue-1',
    duration: 120,
    disabledRobots: MATCH_ROBOTS.map((robot) => robot.id),
  };
  match.state.actors.ball = { x: 0, z: 0, yaw: 0 };
  advance(match, 8.1, config);
  assert.deepEqual(match.state.actors.ball, { x: 0, z: 0, yaw: 0 });
  advance(match, 8.1, config);
  assert.ok(Math.hypot(match.state.actors.ball.x, match.state.actors.ball.z) > 0.1);
  match.place(match.state.actors);
  assert.equal(match.lastProgressRelocation, null);
});

test('goal sides and field walls bounce the ball without awarding a goal', () => {
  const match = new SoccerMatch();
  match.state.actors.ball = { x: 0.35, z: 1.11, yaw: 0 };
  match.state.ballVelocity = { x: -3, z: 0 };
  advance(match, 0.08, settings({ blue: 'off', yellow: 'off' }));
  assert.ok(match.state.ballVelocity.x > 0);
  assert.equal(match.state.score.blue, 0);
  match.state.actors.ball = { x: 0.88, z: 0, yaw: 0 };
  match.state.ballVelocity = { x: 3, z: 0 };
  match.step(settings({ blue: 'off', yellow: 'off' }));
  assert.ok(match.state.ballVelocity.x < 0);
  assert.ok(match.state.actors.ball.x <= 0.889);
});

test('fast balls cannot tunnel from inside the goal through a side panel', () => {
  const match = new SoccerMatch();
  match.state.actors.ball = { x: 0.279, z: 1.11, yaw: 0 };
  match.state.ballVelocity = { x: 3.2, z: 0 };
  match.step(settings({ blue: 'off', yellow: 'off' }));
  assert.ok(match.state.actors.ball.x <= 0.279);
  assert.ok(match.state.ballVelocity.x < 0);
});

test('AI plays a complete repeatable match with goals and valid robot positions', () => {
  const config = settings({ blue: 'ai', yellow: 'ai' });
  config.duration = 60;
  const match = new SoccerMatch();
  let steps = 0;
  while (match.state.phase !== 'finished' && steps++ < 120 * 100) {
    match.step(config);
    for (let i = 0; i < MATCH_ROBOTS.length; i += 1) {
      const pose = match.state.actors[MATCH_ROBOTS[i].id];
      assert.ok(Number.isFinite(pose.x + pose.z + pose.yaw));
      assert.ok(robotWallClearance(pose, match.robotVisual).gap >= -1e-7);
      for (let j = i + 1; j < MATCH_ROBOTS.length; j += 1) {
        const other = match.state.actors[MATCH_ROBOTS[j].id];
        assert.ok(Math.hypot(pose.x - other.x, pose.z - other.z) >= 0.1999);
      }
    }
  }
  assert.equal(match.state.phase, 'finished');
  assert.equal(match.state.elapsed, 60);
  assert.ok(
    match.state.score.blue > 0 && match.state.score.yellow > 0,
    JSON.stringify(match.state.score),
  );
  const finished = match.snapshot();
  advance(match, 1, config);
  assert.deepEqual(match.snapshot(), finished);
  const replay = new SoccerMatch();
  for (let i = 0; i < steps; i += 1) replay.step(config);
  assert.deepEqual(replay.snapshot(), finished);
});

test('snapshots are detached from the live match', () => {
  const match = new SoccerMatch();
  const initialX = match.state.actors.ball.x;
  const snapshot = match.snapshot();
  snapshot.actors.ball.x = 99;
  snapshot.score.blue = 99;
  assert.equal(match.state.actors.ball.x, initialX);
  assert.equal(match.state.score.blue, 0);
});
