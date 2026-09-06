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
const { RULE_DOCUMENTS, RULE_SECTIONS, guideFor, sectionUrl, findSections } =
  await import('../lib/rulebook/catalog.ts');
const { RULE_CLIPS, sampleClip, clipsFor, neutralPlacement, NEUTRAL_SPOTS } =
  await import('../lib/rulebook/animations.ts');
const { inspectionResults, DEFAULT_MEASUREMENTS } =
  await import('../lib/rulebook/inspection.ts');
const { tournamentPoints } = await import('../lib/rulebook/scoring.ts');
const { SCENARIOS } = await import('../lib/simulator/scenarios.ts');
const clip = (id) => RULE_CLIPS.find((item) => item.id === id);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('all six verified source documents and every indexed heading remain reachable', () => {
  assert.deepEqual(
    RULE_DOCUMENTS.map((document) => document.id),
    ['soccer', 'field', 'ball', 'scoring', 'superteam', 'entry'],
  );
  assert.equal(
    RULE_SECTIONS.length,
    new Set(RULE_SECTIONS.map((section) => section.id)).size,
  );
  for (const document of RULE_DOCUMENTS) {
    const sections = RULE_SECTIONS.filter(
      (section) => section.document === document.id,
    );
    assert.equal(
      sections.length,
      document.headingCount + Number(document.footnoteCount > 0),
    );
    assert.ok(document.paragraphCount > 0);
    for (const section of sections) {
      assert.ok(sectionUrl(section).startsWith(`${document.url}#`));
      assert.ok(
        section.anchor.length && section.title.length && guideFor(section),
      );
    }
  }
  assert.equal(RULE_DOCUMENTS[0].headingCount, 68);
  assert.equal(RULE_DOCUMENTS[0].footnoteCount, 29);
  for (let chapter = 1; chapter <= 8; chapter += 1)
    assert.ok(
      RULE_SECTIONS.some(
        (section) =>
          section.document === 'soccer' && section.number === String(chapter),
      ),
    );
  assert.ok(
    RULE_SECTIONS.some(
      (section) => section.id === 'soccer:kicker-power-measuring',
    ),
  );
  assert.ok(
    RULE_SECTIONS.some((section) => section.id === 'entry:motor-whitelist'),
  );
});

test('every main gameplay subsection has multiple distinct animations', () => {
  const sections = RULE_SECTIONS.filter(
    (section) =>
      section.document === 'soccer' && section.number.startsWith('2.'),
  );
  assert.equal(sections.length, 12);
  for (const section of sections) {
    assert.equal(guideFor(section), 'animation');
    assert.ok(clipsFor(section.anchor).length >= 2, section.id);
  }
  assert.equal(
    RULE_CLIPS.length,
    new Set(RULE_CLIPS.map((item) => item.id)).size,
  );
});

test('match-halves is anchored to its actual §2.2 side-swap content but also covers §2.1', () => {
  const halves = clip('match-halves');
  assert.equal(halves.anchor, 'pre-match-meeting');
  assert.deepEqual(halves.alsoAnchors, ['game-procedure-and-length-of-a-game']);
  assert.ok(
    clipsFor('pre-match-meeting').some((item) => item.id === 'match-halves'),
  );
  assert.ok(
    clipsFor('game-procedure-and-length-of-a-game').some(
      (item) => item.id === 'match-halves',
    ),
  );
  // A clip never counts twice toward the same section's coverage.
  assert.equal(
    clipsFor('pre-match-meeting').filter((item) => item.id === 'match-halves')
      .length,
    1,
  );
});

test('every animation has a valid source, answer, ordered timeline and finite poses', () => {
  for (const item of RULE_CLIPS) {
    assert.ok(
      RULE_SECTIONS.some(
        (section) =>
          section.document === 'soccer' && section.anchor === item.anchor,
      ),
    );
    for (const anchor of item.alsoAnchors ?? [])
      assert.ok(
        RULE_SECTIONS.some(
          (section) =>
            section.document === 'soccer' && section.anchor === anchor,
        ),
        `${item.id}: alsoAnchors entry ${anchor}`,
      );
    assert.ok(item.answer >= 0 && item.answer < item.options.length);
    for (let i = 1; i < item.frames.length; i += 1)
      assert.ok(item.frames[i].at > item.frames[i - 1].at, item.id);
    for (let time = 0; time <= item.frames.at(-1).at; time += 0.1) {
      const frame = sampleClip(item, time);
      assert.ok(frame.label);
      for (const pose of Object.values(frame.poses))
        assert.ok(Number.isFinite(pose.x + pose.z + pose.yaw), item.id);
      assert.deepEqual(
        sampleClip(item, time),
        frame,
        'scrubbing is deterministic',
      );
    }
  }
});

test('robots hold their positions until kickoff and resume signals', () => {
  for (const [id, from, until] of [
    ['kickoff-valid', 2, 5],
    ['neutral-start', 0, 4],
    ['pause-resume', 2, 5],
  ]) {
    const initial = sampleClip(clip(id), from).poses;
    for (let time = from; time < until; time += 0.1)
      assert.deepEqual(
        sampleClip(clip(id), time).poses,
        initial,
        `${id} at ${time}`,
      );
    assert.notDeepEqual(sampleClip(clip(id), until + 0.5).poses, initial);
  }
});

test('called pushing scenes depict accessible contact rather than interpenetration', () => {
  for (const id of ['pushing-call', 'contact-midfield']) {
    const frame = sampleClip(clip(id), id === 'pushing-call' ? 2.5 : 3);
    assert.ok(
      Math.abs(distance(frame.poses['blue-1'], frame.poses['yellow-1']) - 0.2) <
        0.001,
    );
    for (const robot of ['blue-1', 'yellow-1']) {
      assert.ok(distance(frame.poses[robot], frame.poses.ball) >= 0.121);
      assert.ok(distance(frame.poses[robot], frame.poses.ball) <= 0.124);
    }
  }
});

test('neutral relocation examples end on unoccupied spots', () => {
  for (const [id, actor] of [
    ['deadlock', 'ball'],
    ['repair-clock', 'blue-1'],
    ['wall-touch', 'blue-1'],
    ['two-defenders', 'blue-2'],
  ]) {
    const frame = sampleClip(clip(id), 100);
    const moved = frame.poses[actor];
    assert.ok(
      NEUTRAL_SPOTS.some((spot) => distance(spot, moved) < 1e-6),
      id,
    );
    for (const [otherId, other] of Object.entries(frame.poses)) {
      if (otherId === actor || otherId === 'ball') continue;
      assert.ok(
        distance(moved, other) >= (actor === 'ball' ? 0.121 : 0.2),
        `${id}: ${otherId}`,
      );
    }
  }
});

test('neutral-spot selector skips occupied sites and distinguishes nearest from farthest', () => {
  const ball = { x: -0.15, z: -0.745, yaw: 0 };
  const robots = [{ x: -0.39, z: -0.645, yaw: 0 }];
  const near = neutralPlacement(ball, robots, false);
  const far = neutralPlacement(ball, robots, true);
  assert.ok(distance(far, ball) > distance(near, ball));
  assert.ok(distance(near, robots[0]) >= 0.21);
  assert.equal(neutralPlacement(ball, NEUTRAL_SPOTS, true), null);
});

test('inspection boundaries are inclusive and league-specific', () => {
  for (const league of ['vision', 'infrared']) {
    const size = league === 'vision' ? 180 : 220;
    const atLimit = {
      ...DEFAULT_MEASUREMENTS,
      diameter: size,
      height: size,
      mass: 1500,
      capture: 15,
      handle: 50,
      marker: 40,
      voltage: 48,
      radio: 100,
    };
    assert.ok(inspectionResults(league, atLimit).every((item) => item.pass));
    for (const field of ['diameter', 'height', 'capture', 'voltage', 'radio'])
      assert.equal(
        inspectionResults(league, {
          ...atLimit,
          [field]: atLimit[field] + 0.1,
        }).find((item) => item.id === field).pass,
        false,
        `${league} ${field}`,
      );
    for (const field of ['handle', 'marker'])
      assert.equal(
        inspectionResults(league, {
          ...atLimit,
          [field]: atLimit[field] - 0.1,
        }).find((item) => item.id === field).pass,
        false,
      );
    assert.equal(
      inspectionResults(league, { ...atLimit, mass: 1501 }).find(
        (item) => item.id === 'mass',
      ).pass,
      league === 'vision',
    );
  }
  assert.equal(
    inspectionResults('vision', {
      ...DEFAULT_MEASUREMENTS,
      supply: 'ac',
      voltage: 25,
    }).find((item) => item.id === 'voltage').pass,
    true,
  );
  assert.equal(
    inspectionResults('vision', {
      ...DEFAULT_MEASUREMENTS,
      supply: 'ac',
      voltage: 25.1,
    }).find((item) => item.id === 'voltage').pass,
    false,
  );
  assert.equal(
    inspectionResults('vision', {
      ...DEFAULT_MEASUREMENTS,
      diameter: NaN,
    }).find((item) => item.id === 'diameter').pass,
    false,
  );
});

test('award placement conversion matches the boundary ranks', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 27, 28, 29].map(tournamentPoints),
    [30, 27, 25, 24, 1, 0, 0],
  );
});

test('Entry and SuperTeam keep their own guides rather than inheriting main limits', () => {
  for (const section of RULE_SECTIONS.filter((section) =>
    ['entry', 'superteam'].includes(section.document),
  ))
    assert.equal(guideFor(section), 'companion');
  for (const section of RULE_SECTIONS.filter(
    (section) => section.document === 'scoring' && /-(2)$/.test(section.id),
  ))
    assert.equal(section.anchor, 'score-criteria-and-rubrics');
});

test('search finds rule numbers and technical inspection across documents', () => {
  assert.ok(
    findSections('2.6', 'ball').some(
      (section) => section.id === 'soccer:inside-penalty-area',
    ),
  );
  assert.ok(
    findSections('technical inspection', 'ball').some(
      (section) => section.id === 'soccer:regulations-inspections',
    ),
  );
  assert.equal(
    findSections('unlikely-nonexistent-section', 'soccer').length,
    0,
  );
});

test('existing multiple-defense lesson uses the far unoccupied spot and valid source anchor', () => {
  const scenario = SCENARIOS.find(
    (item) => item.id === 'multiple-defense-basic',
  );
  assert.ok(scenario.ruleRef.url.endsWith('#inside-penalty-area'));
  const frame = scenario.sample(scenario.duration);
  assert.ok(frame.actors['blue-2'].z > 0);
  assert.ok(distance(frame.actors['blue-2'], frame.actors.ball) > 1.3);
  assert.ok(scenario.sample(0).actors['blue-1'].z > -0.945);
});
