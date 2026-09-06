import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';

// Exercise the actual application modules without a second build or dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      /^\.\.?\//.test(specifier) &&
      context.parentURL?.includes('/lib/') &&
      !/\.(ts|json)$/.test(specifier)
    )
      return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json') && url.includes('/lib/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default ' + readFileSync(new URL(url), 'utf8'),
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
  LEARNING_SITUATIONS,
  lessonChoices,
  validLearningProgress,
  situationCoversSection,
} = await import('../lib/rulebook/learning.ts');
const { RULE_DOCUMENTS, RULE_SECTIONS, sectionUrl, sectionReference } =
  await import('../lib/rulebook/catalog.ts');
const { RULE_CLIPS, sampleClip } =
  await import('../lib/rulebook/animations.ts');
const { RULE_QUESTIONS } = await import('../lib/rulebook/questions.ts');
const { SCENARIOS } = await import('../lib/simulator/scenarios.ts');
const { robotPenaltyOverlap } =
  await import('../lib/simulator/referee-geometry.ts');
const { REFEREE_CASES, ruleUrl } =
  await import('../lib/simulator/referee-cases.ts');
const { RefereeMatch } = await import('../lib/simulator/referee-match.ts');
const { MATCH_ACTORS, MATCH_STEP, NO_DRIVE, SoccerMatch } =
  await import('../lib/simulator/match.ts');
const {
  RCJ_FIELD_DERIVED: FIELD,
  RCJ_FIELD_SPEC_2026: SPEC,
  RCJ_SIMULATOR_GUIDES: GUIDES,
} = await import('../lib/simulator/field-spec.ts');
const { INITIAL_NAVIGATION, readNavigation, navigationSearch } =
  await import('../lib/simulator/navigation.ts');
const { practiceLayout, preparePracticeMatch } =
  await import('../lib/simulator/practice-layout.ts');

const callKey = (call) => call.action + ':' + (call.target ?? '');
test('secondary rule sources appear in the real lesson selector without duplicate exam questions', () => {
  const item = LEARNING_SITUATIONS.find(
    (entry) => entry.id === 'clip:match-halves',
  );
  assert.equal(item.sectionId, 'soccer:pre-match-meeting');
  for (const section of [
    'soccer:pre-match-meeting',
    'soccer:game-procedure-and-length-of-a-game',
  ])
    assert.equal(
      LEARNING_SITUATIONS.filter(
        (entry) =>
          entry.id === item.id && situationCoversSection(entry, section),
      ).length,
      1,
    );
  assert.equal(situationCoversSection(item, 'soccer:scoring'), false);
  assert.equal(LEARNING_SITUATIONS.length, 105);
});
const accepted = (feedback) =>
  feedback && ['correct', 'supported'].includes(feedback.verdict);
const settings = (duration = 120) => ({
  controls: { blue: 'off', yellow: 'off' },
  selectedRobot: 'blue-1',
  duration,
});

test('all 105 situations retain their source and correct official section', () => {
  assert.equal(RULE_DOCUMENTS.length, 6);
  assert.equal(RULE_SECTIONS.length, 259);
  assert.equal(LEARNING_SITUATIONS.length, 105);
  assert.equal(new Set(LEARNING_SITUATIONS.map((item) => item.id)).size, 105);
  const groups = [
    { kind: 'case', sources: REFEREE_CASES, sourceUrl: ruleUrl, count: 35 },
    {
      kind: 'clip',
      sources: RULE_CLIPS,
      sourceUrl: (clip) =>
        ruleUrl(REFEREE_CASES[0]).split('#')[0] + '#' + clip.anchor,
      count: 32,
    },
    {
      kind: 'scenario',
      sources: SCENARIOS,
      sourceUrl: (scenario) => scenario.ruleRef.url,
      count: 6,
    },
    {
      kind: 'question',
      sources: RULE_QUESTIONS,
      sourceUrl: (question) =>
        ruleUrl(REFEREE_CASES[0]).split('#')[0] + '#' + question.anchor,
      count: 32,
    },
  ];
  for (const { kind, sources, sourceUrl, count } of groups) {
    const entries = LEARNING_SITUATIONS.filter((item) => item.kind === kind);
    assert.equal(entries.length, count, kind);
    assert.deepEqual(
      entries.map((item) => item.sourceId).sort(),
      sources.map((item) => item.id).sort(),
      kind + ' must neither omit nor duplicate a source',
    );
    for (const source of sources) {
      const entry = entries.find((item) => item.sourceId === source.id);
      assert.equal(entry.id, kind + ':' + source.id);
      assert.ok(entry.title.trim());
      const section = RULE_SECTIONS.find((item) => item.id === entry.sectionId);
      assert.ok(section, entry.id + ' has an indexed section');
      assert.equal(sectionUrl(section), sourceUrl(source), entry.id);
    }
  }
});

test('technical, safety and administration checks have distinct valid answer keys', () => {
  const ids = new Set();
  for (const item of RULE_QUESTIONS) {
    assert.ok(item.question.trim() && item.feedback.trim(), item.id);
    assert.equal(item.options.length, 3, item.id);
    assert.equal(new Set(item.options).size, 3, item.id);
    assert.ok(
      Number.isInteger(item.answer) && item.answer >= 0 && item.answer < 3,
      item.id,
    );
    assert.ok(!ids.has(item.id), item.id);
    ids.add(item.id);
  }
  for (const id of [
    'vision-dimensions',
    'infrared-dimensions',
    'electrical-safety',
    'infrared-emitters',
    'kicker-test-result',
    'repeated-out-damage',
    'neutral-capability',
    'neutral-obstruction',
    'result-disputes',
    'event-scope',
  ])
    assert.ok(ids.has(id), id);
  assert.equal(
    LEARNING_SITUATIONS.filter((item) => !item.sectionId.startsWith('soccer:'))
      .length,
    0,
  );
});

test('knowledge-check section labels include an actual appendix reference, never a bare section sign', () => {
  for (const item of LEARNING_SITUATIONS.filter(
    (entry) => entry.kind === 'question',
  )) {
    const section = RULE_SECTIONS.find((entry) => entry.id === item.sectionId);
    const reference = sectionReference(section);
    assert.ok(reference.trim() && reference !== '§', item.id);
    if (['kicker-test-setup', 'kicker-test-result'].includes(item.sourceId))
      assert.equal(reference, 'Appendix A');
  }
});

test('published pushing criteria and selected committee policy are distinguished', () => {
  const pushing = SCENARIOS.find((item) => item.id === 'pushing-discretion');
  assert.match(pushing.refereeCue, /not additional rule conditions/);
  const combined = SCENARIOS.find(
    (item) => item.id === 'pushing-and-multiple-defense',
  );
  assert.match(combined.choices[0].feedback, /does not require proving/);
  const waiver = REFEREE_CASES.find((item) => item.id === 'pushed-out');
  assert.match(waiver.facts, /committee training policy v1/i);
  assert.match(waiver.explanation, /referee discretion/);
  assert.match(
    REFEREE_CASES.find((item) => item.id === 'out-goal').explanation,
    /after-removal extension is a training interpretation/,
  );
});

test('case-specific source overrides are retained despite shared clips', () => {
  for (const [id, anchor] of [
    ['out-goal', 'out-of-bounds'],
    ['spectator', 'robots-interference'],
    ['preflight', 'pre-match-meeting'],
    ['inspection', 'top-markers'],
  ]) {
    assert.equal(
      LEARNING_SITUATIONS.find((item) => item.id === 'case:' + id).sectionId,
      'soccer:' + anchor,
    );
  }
});

test('all replay questions and detailed referee rubrics remain answerable', () => {
  for (const clip of RULE_CLIPS) {
    assert.ok(clip.question.trim() && clip.feedback.trim(), clip.id);
    assert.ok(clip.options.length >= 2, clip.id);
    assert.ok(Number.isInteger(clip.answer), clip.id);
    assert.ok(clip.answer >= 0 && clip.answer < clip.options.length, clip.id);
    assert.ok(clip.options[clip.answer].trim(), clip.id);
  }
  for (const scenario of SCENARIOS) {
    assert.equal(scenario.choices.length, 4, scenario.id);
    assert.equal(new Set(scenario.choices.map((choice) => choice.id)).size, 4);
    assert.ok(scenario.choices.some((choice) => choice.grade === 'correct'));
    for (const choice of scenario.choices) {
      assert.ok(choice.label.trim() && choice.feedback.trim(), choice.id);
      assert.ok(
        ['correct', 'acceptable', 'partial', 'incorrect'].includes(
          choice.grade,
        ),
      );
      assert.ok(choice.score >= 0 && choice.score <= 1, choice.id);
    }
  }
  const pushing = SCENARIOS.find((item) => item.id === 'pushing-discretion');
  assert.equal(
    pushing.choices.find((choice) => choice.id === 'play-on').grade,
    'acceptable',
  );
  assert.equal(
    pushing.choices.find((choice) => choice.id === 'play-on').score,
    1,
  );
  const holding = SCENARIOS.find((item) => item.id === 'illegal-ball-holding');
  assert.equal(
    holding.choices.find((choice) => choice.id === 'brief-observation').grade,
    'acceptable',
  );
  assert.equal(
    holding.choices.find((choice) => choice.id === 'brief-observation').score,
    0.85,
  );
});

test('checking choices retain every accepted alternative and its metadata', () => {
  for (const item of REFEREE_CASES) {
    for (const [index, step] of item.steps.entries()) {
      const expected = Object.freeze(
        step.map((call) => Object.freeze({ ...call })),
      );
      const before = structuredClone(expected);
      const choices = lessonChoices(expected, item.id + ':' + index);
      assert.equal(new Set(choices.map(callKey)).size, choices.length, item.id);
      for (const call of expected)
        assert.deepEqual(
          choices.find((choice) => callKey(choice) === callKey(call)),
          call,
        );
      assert.deepEqual(
        expected,
        before,
        'constructing choices must not mutate the rubric',
      );
      assert.deepEqual(lessonChoices(expected, item.id + ':' + index), choices);
    }
  }
  const many = ['play-on', 'pause', 'resume', 'count', 'neutral'].map(
    (action) => ({ action }),
  );
  assert.equal(lessonChoices(many, 'many').length, many.length);
  assert.ok(lessonChoices([], 'waiting').every((choice) => choice.action));
});

test('saved checks are sanitized without losing valid completed situations', () => {
  for (const invalid of [
    null,
    undefined,
    0,
    true,
    'case:goal',
    {},
    { length: 1 },
  ])
    assert.deepEqual(validLearningProgress(invalid), []);
  const saved = [
    'case:goal',
    null,
    'removed-case',
    123,
    'clip:goal-contact',
    'case:goal',
    {},
    'scenario:pushing-discretion',
    'clip:goal-contact',
  ];
  const before = structuredClone(saved);
  assert.deepEqual(validLearningProgress(saved), [
    'case:goal',
    'clip:goal-contact',
    'scenario:pushing-discretion',
  ]);
  assert.deepEqual(saved, before);
  const all = LEARNING_SITUATIONS.map((item) => item.id);
  assert.deepEqual(validLearningProgress([...all, ...all]), all);
});

for (const item of REFEREE_CASES) {
  test('lesson completes its own decisions: ' + item.id, () => {
    const session = new RefereeMatch(2026, {
      robotVisual: 'xlc-innovation-2021',
    });
    assert.equal(session.beginCase(item), true);
    let countTicks = 0;
    let completed = false;
    // Match CaseLesson's watch, answer, continue flow. Do not skip evidence or counts.
    for (let tick = 0; tick < Math.ceil(90 / MATCH_STEP); tick++) {
      const frame = session.snapshot();
      if (frame.feedback) {
        assert.ok(accepted(frame.feedback), frame.feedback.detail);
        if (frame.feedback.final) {
          assert.equal(frame.completed.at(-1)?.id, item.id);
          assert.ok(frame.coverage.includes(item.id));
          assert.ok(frame.feedback.appliedRules.length > 0);
          completed = true;
          break;
        }
        session.continue();
        continue;
      }
      if (frame.phase === 'evidence' || frame.count !== null) {
        assert.ok(
          session.canAdvance,
          item.id + ': observation must be playable',
        );
        if (frame.count !== null) countTicks++;
        session.step();
        continue;
      }
      const expected = frame.help?.choices ?? [];
      assert.ok(
        expected.length > 0,
        item.id + ': decision has an accepted answer',
      );
      const choices = lessonChoices(
        expected,
        item.id + ':' + frame.decisionKey,
      );
      for (const call of expected)
        assert.ok(
          choices.some((choice) => callKey(choice) === callKey(call)),
          callKey(call),
        );
      const choice = choices.find(
        (candidate) => callKey(candidate) === callKey(expected[0]),
      );
      assert.equal(session.submit(frame.decisionKey, choice), true);
      assert.ok(accepted(session.snapshot().feedback), item.id);
    }
    assert.ok(
      completed,
      item.id + ': lesson stalled or exceeded the 90-second bound',
    );
    if (['deadlock', 'repeat-progress'].includes(item.id))
      assert.ok(
        countTicks >= 120,
        item.id + ': visible count must actually run',
      );
  });
}

test('legacy modes preserve learning intent and live referee routes', () => {
  assert.deepEqual(readNavigation(''), INITIAL_NAVIGATION);
  for (const mode of ['explore', 'learn']) {
    const nav = readNavigation('?mode=' + mode);
    assert.equal(nav.mode, 'rules');
    assert.equal(nav.situationId, 'scenario:legal-dribbler-backspin');
  }
  const legacyReferee = readNavigation(
    '?mode=referee&scenario=pushing-discretion',
  );
  assert.equal(legacyReferee.mode, 'rules');
  assert.equal(legacyReferee.situationId, 'scenario:pushing-discretion');
  assert.equal(readNavigation('?mode=referee').mode, 'referee');
  assert.equal(readNavigation('?mode=play&referee=1').mode, 'referee');
  assert.equal(readNavigation('?mode=play').mode, 'play');
  assert.equal(readNavigation('?mode=manual').mode, 'play');
  assert.equal(readNavigation('?mode=manual').arrange, true);
  assert.equal(readNavigation('?mode=unknown').mode, 'rules');
  assert.equal(readNavigation('?mode=academy').mode, 'academy');
  assert.equal(
    readNavigation('?mode=academy&academy=referees').academyPage,
    'referees',
  );
  assert.equal(
    readNavigation('?mode=referee&cert=continuous').certificationTrack,
    'continuous',
  );
  assert.equal(
    readNavigation('?mode=rules&cert=unknown').certificationTrack,
    null,
  );
});

test('explicit lesson selection and embeds survive navigation round trips', () => {
  const nav = readNavigation(
    '?mode=learn&rule=soccer:scoring&scenario=goal-back-wall&situation=clip:own-goal',
  );
  assert.equal(nav.situationId, 'clip:own-goal');
  assert.equal(nav.sectionId, 'soccer:scoring');
  assert.deepEqual(readNavigation(navigationSearch(nav, 'lab')), nav);
  const embed = readNavigation('?embed=pushing-discretion&robot=lab');
  assert.equal(embed.embed, 'pushing-discretion');
  assert.deepEqual(readNavigation(navigationSearch(embed, 'lab')), embed);
  const query = new URLSearchParams(navigationSearch(nav, 'xlc-open-2020'));
  assert.equal(query.get('robot'), 'xlc-open-2020');
  assert.equal(query.has('scenario'), false);
});

test('canonical routes discard obsolete flags and inactive lesson parameters', () => {
  for (const search of [
    '?mode=manual&rule=soccer:scoring&situation=clip:own-goal',
    '?mode=play&referee=1&scenario=goal-back-wall',
    '?mode=explore&scenario=goal-back-wall',
  ]) {
    const first = navigationSearch(readNavigation(search), 'lab');
    assert.equal(navigationSearch(readNavigation(first), 'lab'), first);
    const query = new URLSearchParams(first);
    assert.equal(query.has('referee'), false);
    assert.equal(query.has('scenario'), false);
    if (query.get('mode') !== 'rules') {
      assert.equal(query.has('rule'), false);
      assert.equal(query.has('situation'), false);
    }
    assert.equal(
      query.has('arrange'),
      query.get('mode') === 'play' && search.includes('manual'),
    );
  }
});

function assertPracticeLayout(poses, label) {
  const input = Object.freeze(
    Object.fromEntries(
      Object.entries(poses).map(([id, pose]) => [
        id,
        Object.freeze({ ...pose }),
      ]),
    ),
  );
  const before = structuredClone(input);
  const layout = practiceLayout(input);
  assert.deepEqual(input, before, label + ': source arrangement is untouched');
  for (const actor of MATCH_ACTORS) {
    const pose = layout[actor.id];
    assert.ok(
      pose && ['x', 'z', 'yaw'].every((key) => Number.isFinite(pose[key])),
      label + ': ' + actor.id,
    );
    if (input[actor.id]) {
      assert.deepEqual(pose, input[actor.id]);
      assert.notEqual(
        pose,
        input[actor.id],
        label + ': existing poses are detached',
      );
    } else if (actor.kind === 'robot') {
      assert.ok(
        Math.abs(pose.x) <= FIELD.floorHalfWidth - GUIDES.robotCollisionRadius,
      );
      assert.ok(
        Math.abs(pose.z) <= FIELD.floorHalfLength - GUIDES.robotCollisionRadius,
      );
      for (const [id, other] of Object.entries(layout)) {
        if (id === actor.id) continue;
        const required =
          GUIDES.robotCollisionRadius +
          (id === 'ball'
            ? SPEC.ball.diameter / 2
            : GUIDES.robotCollisionRadius);
        assert.ok(
          Math.hypot(other.x - pose.x, other.z - pose.z) >= required - 1e-9,
          label + ': added ' + actor.id + ' overlaps ' + id,
        );
      }
    }
  }
  return layout;
}

test('practice layouts complete every actor subset without moving existing actors', () => {
  for (let mask = 0; mask < 1 << MATCH_ACTORS.length; mask++) {
    const poses = Object.fromEntries(
      MATCH_ACTORS.filter((_, index) => mask & (1 << index)).map((actor) => [
        actor.id,
        { ...actor.initial },
      ]),
    );
    const layout = assertPracticeLayout(poses, 'actor subset ' + mask);
    assert.deepEqual(
      Object.keys(layout).sort(),
      MATCH_ACTORS.map((actor) => actor.id).sort(),
    );
  }
});

test('all detailed and guided lesson arrangements can become playable layouts', () => {
  for (const scenario of SCENARIOS)
    for (const time of [0, scenario.duration / 2, scenario.duration])
      assertPracticeLayout(
        scenario.sample(time).actors,
        scenario.id + ' at ' + time,
      );
  for (const clip of RULE_CLIPS)
    for (const time of [0, clip.frames.at(-1).at])
      assertPracticeLayout(
        sampleClip(clip, time).poses,
        clip.id + ' at ' + time,
      );
});

test('no scenario robot is ever fully inside a penalty area (rule 2.6/2.8)', () => {
  const visuals = ['lab', 'xlc-innovation-2021', 'xlc-open-2020'];
  // Scenario ids that deliberately teach a full-entry violation belong here,
  // exempted explicitly rather than silently. None currently need it.
  const teachesFullEntry = new Set();
  for (const scenario of SCENARIOS) {
    if (teachesFullEntry.has(scenario.id)) continue;
    for (let time = 0; time <= scenario.duration + 1e-9; time += 0.25) {
      const frame = scenario.sample(Math.min(time, scenario.duration));
      for (const [actorId, pose] of Object.entries(frame.actors)) {
        if (actorId === 'ball') continue;
        for (const visual of visuals)
          for (const end of [-1, 1])
            assert.equal(
              robotPenaltyOverlap(pose, end, visual, true),
              false,
              `${scenario.id} at t=${time.toFixed(2)}: ${actorId} (${visual}, end=${end}) is fully inside the penalty area`,
            );
      }
    }
  }
});

test('returned layouts and their added poses are independent between launches', () => {
  const input = { ball: { x: 0.2, z: 0.1, yaw: 0 } };
  const first = practiceLayout(input);
  const second = practiceLayout(input);
  first.ball.x = -0.7;
  first['blue-1'].z = 0.6;
  assert.deepEqual(input.ball, { x: 0.2, z: 0.1, yaw: 0 });
  assert.equal(second.ball.x, 0.2);
  assert.notEqual(first['blue-1'].z, second['blue-1'].z);
});

test('starting after full time resets the match while preserving the edited layout', () => {
  const duration = MATCH_STEP * 3;
  const match = new SoccerMatch();
  match.awardGoal('blue', false);
  match.awardGoal('yellow', false);
  for (let tick = 0; tick < 4; tick++) match.step(settings(duration));
  assert.equal(match.state.phase, 'finished');
  const edited = practiceLayout({
    ball: { x: 0.12, z: 0.04, yaw: 0.2 },
    'blue-1': { x: -0.42, z: -0.32, yaw: 0.7 },
  });
  match.place(edited);
  assert.equal(
    match.state.phase,
    'playing',
    'placing after full time already clears the phase',
  );
  assert.equal(
    match.state.elapsed,
    duration,
    'the exhausted clock still needs resetting',
  );
  const next = preparePracticeMatch(match, duration);
  assert.notEqual(next, match);
  assert.equal(next.state.elapsed, 0);
  assert.deepEqual(next.state.score, { blue: 0, yellow: 0 });
  assert.deepEqual(next.state.actors, edited);
  for (const id of Object.keys(edited)) {
    assert.notEqual(next.state.actors[id], edited[id]);
    assert.notEqual(next.state.actors[id], match.state.actors[id]);
  }
  const before = next.state.elapsed;
  next.step(settings(duration), NO_DRIVE);
  assert.ok(next.state.elapsed > before);
  assert.equal(next.state.phase, 'playing');
});

test('preparing an unfinished match preserves its engine, clock and score', () => {
  const match = new SoccerMatch();
  match.awardGoal('blue', false);
  match.step(settings());
  const before = match.snapshot();
  assert.equal(preparePracticeMatch(match, 120), match);
  assert.deepEqual(match.snapshot(), before);
});
