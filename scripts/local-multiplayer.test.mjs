import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the production controls and fixed-step engine without a browser.
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
const {
  playDriveInput,
  playDriveKeys,
  playerKeys,
  isPlayControlTarget,
  withPlayTeamControl,
} = await import('../lib/simulator/play-controls.ts');
const { RCJ_FIELD_SPEC_2026: SPEC, RCJ_SIMULATOR_GUIDES: GUIDES } =
  await import('../lib/simulator/field-spec.ts');

const idle = { ...NO_DRIVE, dribble: false };
const input = (codes, scheme, dribble = false) =>
  playDriveInput((code) => codes.includes(code), scheme, dribble);
const initialPoses = () => ({
  'blue-1': { x: -0.4, z: -0.45, yaw: 0 },
  'blue-2': { x: -0.6, z: -0.85, yaw: 0 },
  'yellow-1': { x: 0.4, z: 0.45, yaw: Math.PI },
  'yellow-2': { x: 0.6, z: 0.85, yaw: Math.PI },
  ball: { x: 0, z: 0, yaw: 0 },
});
const freshMatch = (poses = initialPoses()) => {
  const match = new SoccerMatch();
  match.place(poses);
  return match;
};
const multiplayer = (codes = [], options = {}) => {
  const manualRobots = options.manualRobots ?? {
    blue: 'blue-1',
    yellow: 'yellow-1',
  };
  return {
    controls: { blue: 'manual', yellow: 'manual' },
    selectedRobot: 'blue-1',
    duration: 120,
    disabledRobots: ['blue-2', 'yellow-2'],
    ...options,
    manualRobots,
    robotCommands: {
      [manualRobots.blue]: input(codes, 'blue'),
      [manualRobots.yellow]: input(codes, 'yellow'),
    },
  };
};
const advance = (match, seconds, settings, manualInput = idle) => {
  for (let step = 0; step < Math.round(seconds / MATCH_STEP); step += 1)
    match.step(settings, manualInput);
};
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, message);

test('single-player bindings retain arrows, WASD, Q/E and Space aliases', () => {
  assert.deepEqual(input(['KeyW', 'KeyD', 'KeyE', 'Space'], 'single'), {
    forward: 1,
    strafe: 1,
    turn: 1,
    kick: true,
    dribble: false,
  });
  assert.deepEqual(
    input(['ArrowUp', 'ArrowRight', 'KeyE', 'Space'], 'single'),
    input(['KeyW', 'KeyD', 'KeyE', 'Space'], 'single'),
  );
  assert.deepEqual(input(['KeyS', 'KeyA', 'KeyQ'], 'single', true), {
    forward: -1,
    strafe: -1,
    turn: -1,
    kick: false,
    dribble: true,
  });
  assert.deepEqual(input(['Enter', 'Comma', 'Period'], 'single'), idle);
});

test('player key groups cannot drive, turn or kick for the other player', () => {
  const blueKeys = ['KeyW', 'KeyA', 'KeyQ', 'Space'];
  const yellowKeys = ['ArrowDown', 'ArrowRight', 'Period', 'Enter'];
  assert.deepEqual(input(blueKeys, 'yellow'), idle);
  assert.deepEqual(input(yellowKeys, 'blue'), idle);
  assert.deepEqual(input([...blueKeys, ...yellowKeys], 'blue'), {
    forward: 1,
    strafe: -1,
    turn: -1,
    kick: true,
    dribble: false,
  });
  assert.deepEqual(input([...blueKeys, ...yellowKeys], 'yellow'), {
    forward: -1,
    strafe: 1,
    turn: 1,
    kick: true,
    dribble: false,
  });
});

test('opposite keys cancel per player without affecting the other player', () => {
  const keys = [
    'KeyW',
    'KeyS',
    'KeyA',
    'KeyD',
    'KeyQ',
    'KeyE',
    'ArrowUp',
    'ArrowLeft',
    'Comma',
  ];
  assert.deepEqual(input(keys, 'blue', true), { ...idle, dribble: true });
  assert.deepEqual(input(keys, 'yellow'), {
    forward: 1,
    strafe: -1,
    turn: -1,
    kick: false,
    dribble: false,
  });
  assert.deepEqual(
    input(
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Comma', 'Period'],
      'yellow',
    ),
    idle,
  );
});

test('drive-key capture and per-player clearing use disjoint multiplayer key groups', () => {
  const blue = playerKeys('blue');
  const yellow = playerKeys('yellow');
  assert.deepEqual(
    [...blue].filter((code) => yellow.has(code)),
    [],
  );
  assert.ok(blue.has('KeyC') && !blue.has('Slash'));
  assert.ok(yellow.has('Slash') && !yellow.has('KeyC'));
  assert.ok(blue.has('Space') && !blue.has('Enter'));
  assert.ok(yellow.has('Enter') && !yellow.has('Space'));
  assert.deepEqual(playDriveKeys(true), new Set([...blue, ...yellow]));
  const solo = playDriveKeys(false);
  for (const code of [
    ...blue,
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ])
    assert.ok(solo.has(code), code);
  for (const code of ['Enter', 'Comma', 'Period', 'Slash'])
    assert.equal(solo.has(code), false, code);
  for (const code of ['KeyP', 'KeyR', 'Tab', 'Escape']) {
    assert.equal(solo.has(code), false, code);
    assert.equal(playDriveKeys(true).has(code), false, code);
  }
});

test('control-target guard protects form controls, native activation and editable ancestors', () => {
  const protectedSelectors = [
    'input',
    'select',
    'textarea',
    'button',
    'a',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="switch"]',
    '[role="slider"]',
    '[role="combobox"]',
  ];
  for (const protectedSelector of protectedSelectors) {
    // A nested event target delegates ancestor matching to DOM closest().
    const ancestor = {};
    const target = {
      closest(selector) {
        return selector.split(', ').includes(protectedSelector)
          ? ancestor
          : null;
      },
    };
    assert.equal(isPlayControlTarget(target), true, protectedSelector);
  }
  assert.equal(isPlayControlTarget({ closest: () => null }), false);
  assert.equal(isPlayControlTarget(null), false);
  assert.equal(isPlayControlTarget({}), false);
  assert.equal(isPlayControlTarget({ closest: undefined }), false);
  assert.equal(isPlayControlTarget({ closest: 'not a function' }), false);
});

test('leaving multiplayer for AI or stationary opponents keeps the remaining human playable', () => {
  const humanRobots = { blue: 'blue-2', yellow: 'yellow-2' };
  for (const changed of ['blue', 'yellow']) {
    const remaining = changed === 'blue' ? 'yellow' : 'blue';
    for (const control of ['ai', 'off']) {
      const original = {
        controls: { blue: 'manual', yellow: 'manual' },
        selectedRobot: humanRobots[changed],
        duration: 120,
      };
      const before = structuredClone(original);
      const next = withPlayTeamControl(original, humanRobots, changed, control);
      assert.equal(next.selectedRobot, humanRobots[remaining]);
      assert.equal(next.controls[remaining], 'manual');
      assert.equal(next.controls[changed], control);
      assert.deepEqual(original, before, 'settings are not mutated');
      assert.deepEqual(humanRobots, { blue: 'blue-2', yellow: 'yellow-2' });
      const match = freshMatch();
      const initial = match.snapshot().actors;
      advance(
        match,
        0.1,
        {
          ...next,
          disabledRobots: MATCH_ROBOTS.filter(
            (robot) => robot.id !== next.selectedRobot,
          ).map((robot) => robot.id),
        },
        input(['KeyW'], 'single'),
      );
      close(
        match.state.actors[next.selectedRobot].z,
        initial[next.selectedRobot].z + (remaining === 'blue' ? 0.068 : -0.068),
      );
      const restored = withPlayTeamControl(
        next,
        humanRobots,
        changed,
        'manual',
      );
      assert.equal(restored.selectedRobot, humanRobots[changed]);
      assert.deepEqual(restored.controls, { blue: 'manual', yellow: 'manual' });
    }
  }
});

test('changing the other team does not replace an already selected human robot', () => {
  const humanRobots = { blue: 'blue-2', yellow: 'yellow-2' };
  for (const selected of ['blue', 'yellow']) {
    const changed = selected === 'blue' ? 'yellow' : 'blue';
    for (const control of ['ai', 'off']) {
      const original = {
        controls: { blue: 'manual', yellow: 'manual' },
        selectedRobot: humanRobots[selected],
        duration: 120,
      };
      const next = withPlayTeamControl(original, humanRobots, changed, control);
      assert.equal(next.selectedRobot, humanRobots[selected]);
      assert.equal(next.controls[selected], 'manual');
    }
  }
});

test('two humans move simultaneously in their own robot-relative directions', () => {
  const match = freshMatch();
  advance(match, 0.2, multiplayer(['KeyW', 'ArrowUp']));
  close(match.state.actors['blue-1'].z, -0.45 + 0.68 * 0.2);
  close(match.state.actors['yellow-1'].z, 0.45 - 0.68 * 0.2);
  close(match.state.actors['blue-1'].x, -0.4);
  close(match.state.actors['yellow-1'].x, 0.4);
  assert.deepEqual(match.state.actors['blue-2'], initialPoses()['blue-2']);
  assert.deepEqual(match.state.actors['yellow-2'], initialPoses()['yellow-2']);
});

test('releasing one player stops only that robot; clearing all input stops both', () => {
  for (const continuing of ['blue', 'yellow']) {
    const match = freshMatch();
    advance(match, 0.15, multiplayer(['KeyW', 'ArrowUp']));
    const stoppedId = continuing === 'blue' ? 'yellow-1' : 'blue-1';
    const movingId = `${continuing}-1`;
    const before = match.snapshot().actors;
    advance(
      match,
      0.15,
      multiplayer([continuing === 'blue' ? 'KeyW' : 'ArrowUp']),
    );
    assert.deepEqual(match.state.actors[stoppedId], before[stoppedId]);
    assert.notDeepEqual(match.state.actors[movingId], before[movingId]);
    const released = match.snapshot().actors;
    advance(match, 0.2, multiplayer());
    assert.deepEqual(match.state.actors, released);
  }
});

test('strafing and turning remain independent for Blue and Yellow', () => {
  const match = freshMatch();
  advance(match, 0.2, multiplayer(['KeyD', 'ArrowLeft']));
  close(match.state.actors['blue-1'].x, -0.4 + 0.68 * 0.2);
  close(match.state.actors['yellow-1'].x, 0.4 + 0.68 * 0.2);
  const positions = match.snapshot().actors;
  advance(match, 0.2, multiplayer(['KeyE', 'Comma']));
  close(match.state.actors['blue-1'].yaw, 3.8 * 0.2);
  close(match.state.actors['yellow-1'].yaw, Math.PI - 3.8 * 0.2);
  for (const id of ['blue-1', 'yellow-1']) {
    close(match.state.actors[id].x, positions[id].x);
    close(match.state.actors[id].z, positions[id].z);
  }
});

test('Space and Enter kick only the owning player’s reachable ball', () => {
  for (const team of ['blue', 'yellow']) {
    const match = freshMatch();
    advance(match, 0.36, multiplayer());
    const id = `${team}-1`;
    const pose = match.state.actors[id];
    match.state.actors.ball = {
      x: pose.x + Math.sin(pose.yaw) * 0.125,
      z: pose.z + Math.cos(pose.yaw) * 0.125,
      yaw: 0,
    };
    const otherKey = team === 'blue' ? 'Enter' : 'Space';
    match.step(multiplayer([otherKey]));
    assert.deepEqual(match.state.ballVelocity, { x: 0, z: 0 }, team);
    const ownKey = team === 'blue' ? 'Space' : 'Enter';
    match.step(multiplayer([ownKey]));
    assert.equal(match.lastBallTouch, id);
    assert.equal(match.state.ballOwner, null);
    assert.ok(
      match.state.ballVelocity.z * (team === 'blue' ? 1 : -1) > 2.9,
      team,
    );
  }
});

test('each player can select robot 2 independently of the legacy selectedRobot', () => {
  for (const blue of ['blue-1', 'blue-2']) {
    for (const yellow of ['yellow-1', 'yellow-2']) {
      const match = freshMatch();
      const configuration = multiplayer(['KeyW', 'ArrowUp'], {
        selectedRobot: 'blue-1',
        manualRobots: { blue, yellow },
        disabledRobots: MATCH_ROBOTS.filter(
          (robot) => robot.id !== blue && robot.id !== yellow,
        ).map((robot) => robot.id),
      });
      const before = match.snapshot().actors;
      advance(match, 0.1, configuration);
      close(match.state.actors[blue].z, before[blue].z + 0.068, blue);
      close(match.state.actors[yellow].z, before[yellow].z - 0.068, yellow);
      for (const id of configuration.disabledRobots)
        assert.deepEqual(match.state.actors[id], before[id]);
    }
  }
});

test('both human-controlled teams retain an autonomous defending teammate', () => {
  const match = freshMatch({
    'blue-1': { x: -0.5, z: -0.1, yaw: 0 },
    'blue-2': { x: 0.45, z: -0.3, yaw: 0 },
    'yellow-1': { x: 0.5, z: 0.1, yaw: Math.PI },
    'yellow-2': { x: -0.45, z: 0.3, yaw: Math.PI },
    ball: { x: 0, z: 0, yaw: 0 },
  });
  const before = match.snapshot().actors;
  advance(match, 0.2, multiplayer([], { disabledRobots: [] }));
  assert.deepEqual(match.state.actors['blue-1'], before['blue-1']);
  assert.deepEqual(match.state.actors['yellow-1'], before['yellow-1']);
  assert.ok(match.state.actors['blue-2'].z < before['blue-2'].z - 0.05);
  assert.ok(match.state.actors['yellow-2'].z > before['yellow-2'].z + 0.05);
});

test('switching Blue’s robot leaves Yellow’s selection and controls unchanged', () => {
  const match = freshMatch();
  const configuration = multiplayer(['KeyW', 'ArrowUp'], {
    manualRobots: { blue: 'blue-2', yellow: 'yellow-1' },
    disabledRobots: ['blue-1', 'yellow-2'],
  });
  const before = match.snapshot().actors;
  advance(match, 0.1, configuration);
  assert.deepEqual(match.state.actors['blue-1'], before['blue-1']);
  close(match.state.actors['blue-2'].z, before['blue-2'].z + 0.068);
  close(match.state.actors['yellow-1'].z, before['yellow-1'].z - 0.068);
});

test('disabled robots ignore even explicitly supplied multiplayer commands', () => {
  const match = freshMatch();
  const before = match.snapshot().actors;
  const configuration = multiplayer(
    ['KeyW', 'ArrowUp', 'KeyE', 'Period', 'Space', 'Enter'],
    {
      disabledRobots: MATCH_ROBOTS.map((robot) => robot.id),
    },
  );
  advance(match, 0.5, configuration);
  assert.deepEqual(match.state.actors, before);
});

test('two humans driving head-on cannot tunnel through each other', () => {
  for (const visual of ['lab', 'xlc-open-2020', 'xlc-innovation-2021']) {
    const match = freshMatch();
    match.setRobotVisual(visual);
    match.state.actors['blue-1'] = { x: 0, z: -0.35, yaw: 0 };
    match.state.actors['yellow-1'] = { x: 0, z: 0.35, yaw: Math.PI };
    match.state.actors.ball = { x: 0.6, z: 0, yaw: 0 };
    const configuration = multiplayer(['KeyW', 'ArrowUp']);
    for (let step = 0; step < 240; step += 1) {
      match.step(configuration);
      const blue = match.state.actors['blue-1'];
      const yellow = match.state.actors['yellow-1'];
      assert.ok(
        Math.hypot(blue.x - yellow.x, blue.z - yellow.z) >=
          2 * GUIDES.robotCollisionRadius - 1e-8,
        `${visual}: step ${step}`,
      );
      assert.ok(
        blue.z < yellow.z,
        `${visual}: players crossed at step ${step}`,
      );
    }
  }
});

test('ball collisions remain active against both moving human robots', () => {
  const minimumDistance = GUIDES.robotCollisionRadius + SPEC.ball.diameter / 2;
  for (const team of ['blue', 'yellow']) {
    const match = freshMatch();
    const direction = team === 'blue' ? 1 : -1;
    match.state.actors[`${team}-1`] = {
      x: 0,
      z: direction * 0.22,
      yaw: direction === 1 ? Math.PI : 0,
    };
    match.state.actors.ball = { x: 0, z: -direction * 0.2, yaw: 0 };
    match.state.ballVelocity = { x: 0, z: direction * 3.2 };
    const configuration = multiplayer(['KeyW', 'ArrowUp']);
    for (let step = 0; step < 40; step += 1) {
      match.step(configuration);
      const ball = match.state.actors.ball;
      for (const id of ['blue-1', 'yellow-1']) {
        const pose = match.state.actors[id];
        assert.ok(
          Math.hypot(ball.x - pose.x, ball.z - pose.z) >=
            minimumDistance - 1e-6,
          `${team}: ${id}, step ${step}`,
        );
      }
    }
  }
});

test('omitting manualRobots preserves the legacy single-human command path', () => {
  const legacy = freshMatch();
  const explicit = freshMatch();
  const configuration = {
    controls: { blue: 'manual', yellow: 'ai' },
    selectedRobot: 'blue-1',
    duration: 120,
  };
  const keySequence = [
    ['KeyW'],
    ['KeyW', 'KeyD'],
    ['KeyE'],
    ['Space'],
    [],
    ['KeyS', 'KeyQ'],
  ];
  for (let step = 0; step < 720; step += 1) {
    const drive = input(keySequence[Math.floor(step / 120)], 'single', true);
    legacy.step(configuration, drive);
    explicit.step({
      ...configuration,
      manualRobots: { blue: 'blue-1' },
      robotCommands: { 'blue-1': drive },
    });
    assert.deepEqual(explicit.snapshot(), legacy.snapshot(), `step ${step}`);
  }
});
