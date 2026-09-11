import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith('./') &&
      context.parentURL?.includes('/lib/committee/') &&
      !specifier.endsWith('.ts')
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts') && url.includes('/lib/committee/'))
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

const { CHARACTERS, DIALOGUE } = await import('../lib/committee/catalog.ts');
const {
  COMMITTEE_EVENT_NAME,
  COMMITTEE_RESET_EVENT_NAME,
  committeeTopic,
  createCommitteeHistory,
  emitCommitteeEvent,
  emitCommitteeReset,
  isCommitteeEvent,
  selectCommitteeDialogue,
} = await import('../lib/committee/events.ts');

const topics = [
  'out',
  'damaged',
  'goal',
  'own-goal',
  'pushed-out',
  'restart',
  'technical',
  'interference',
  'progress',
  'general',
];
const outcomes = ['correct', 'retry', 'recorded', 'study', 'complete'];
const event = (overrides = {}) => ({
  id: 'visible-event-1',
  surface: 'rules',
  context: 'practice',
  outcome: 'correct',
  topic: 'out',
  ...overrides,
});
const select = (overrides = {}, history = createCommitteeHistory()) =>
  selectCommitteeDialogue(event(overrides), history);

test('known event values validate while malformed payloads are rejected', () => {
  assert.equal(isCommitteeEvent(event()), true);
  assert.equal(isCommitteeEvent(event({ id: 'a'.repeat(256) })), true);
  for (const value of [
    null,
    undefined,
    42,
    'event',
    [],
    {},
    event({ id: '' }),
    event({ id: 'a'.repeat(257) }),
    event({ id: 5 }),
    event({ surface: 'engine' }),
    event({ context: 'live-secret' }),
    event({ outcome: 'passed' }),
    event({ topic: 'hidden-incident' }),
  ]) {
    assert.equal(isCommitteeEvent(value), false);
    assert.equal(
      selectCommitteeDialogue(value, createCommitteeHistory()),
      null,
    );
  }
});

test('a correct out-of-bounds event chooses Marek and an appropriate celebratory line', () => {
  const result = select();
  assert.ok(result);
  assert.equal(result.dialogue.character, 'marek');
  assert.equal(result.dialogue.topic, 'out');
  assert.ok(result.dialogue.outcomes.includes('correct'));
  assert.equal(result.dialogue.pose, 'celebrate');
  assert.equal(result.history.turns.marek, 1);
});

test('correct general and technical checks have a non-silent celebration fallback', () => {
  for (const topic of ['general', 'technical', 'progress', 'interference']) {
    const result = select({ topic });
    assert.ok(result, `a correct ${topic} answer needs a celebration`);
    assert.ok(result.dialogue.outcomes.includes('correct'));
    assert.equal(result.dialogue.pose, 'celebrate');
    assert.ok([topic, 'general'].includes(result.dialogue.topic));
  }
});

test('eight general speakers rotate with equal speaking turns, not equal paired appearances', () => {
  assert.equal(CHARACTERS.length, 8);
  for (const outcome of outcomes) {
    let history = createCommitteeHistory();
    const speakers = [];
    for (let index = 0; index < 32; index++) {
      const result = select(
        { topic: 'general', outcome, id: String(index) },
        history,
      );
      assert.ok(result);
      speakers.push(result.dialogue.character);
      history = result.history;
    }
    assert.equal(new Set(speakers.slice(0, 8)).size, 8);
    for (const character of CHARACTERS)
      assert.equal(
        history.turns[character.id],
        4,
        `${outcome}: ${character.id}`,
      );
    assert.equal(history.appearances.caroline, 8);
    assert.equal(history.appearances.jakub, 4);
  }
});

test('damage always belongs to Isa even after frequent prior appearances', () => {
  let history = createCommitteeHistory();
  for (let index = 0; index < 30; index++) {
    const outcome = outcomes[index % outcomes.length];
    const result = select({ topic: 'damaged', outcome }, history);
    assert.ok(result);
    assert.equal(result.dialogue.character, 'isa', outcome);
    assert.deepEqual(
      result.characters.map(({ id }) => id),
      ['isa'],
    );
    history = result.history;
  }
  assert.equal(history.turns.isa, 30);
});

test('Jakub always appears with Caroline while Caroline may speak on her own', () => {
  let history = createCommitteeHistory();
  let jakubTurns = 0,
    carolineTurns = 0;
  for (let index = 0; index < 32; index++) {
    const result = select({ outcome: 'recorded', topic: 'general' }, history);
    assert.ok(result);
    if (result.dialogue.character === 'jakub') {
      jakubTurns++;
      assert.deepEqual(
        result.characters.map(({ id }) => id),
        ['jakub', 'caroline'],
      );
    } else if (result.dialogue.character === 'caroline') {
      carolineTurns++;
      assert.deepEqual(
        result.characters.map(({ id }) => id),
        ['caroline'],
      );
    }
    history = result.history;
  }
  assert.equal(jakubTurns, 4);
  assert.equal(carolineTurns, 4);
});

test('returning speakers vary their recorded line before repeating it', () => {
  let history = createCommitteeHistory();
  const seen = new Map();
  for (let index = 0; index < 16; index++) {
    const result = select({ topic: 'general', outcome: 'recorded' }, history);
    assert.ok(result);
    const previous = seen.get(result.dialogue.character);
    if (previous) assert.notEqual(result.dialogue.id, previous);
    seen.set(result.dialogue.character, result.dialogue.id);
    history = result.history;
  }
  assert.equal(seen.size, 8);
});

test('selection creates immutable history updates and bounds recent lines to 96', () => {
  const original = Object.freeze({
    appearances: Object.freeze({}),
    turns: Object.freeze({}),
    lines: Object.freeze([]),
    lastCharacter: null,
  });
  const first = select({ topic: 'general', outcome: 'recorded' }, original);
  assert.ok(first);
  assert.deepEqual(original, {
    appearances: {},
    turns: {},
    lines: [],
    lastCharacter: null,
  });
  assert.notEqual(first.history, original);
  assert.notEqual(first.history.appearances, original.appearances);
  assert.notEqual(first.history.turns, original.turns);
  assert.notEqual(first.history.lines, original.lines);
  let history = first.history;
  for (let index = 1; index < 200; index++) {
    const result = select({ topic: 'general', outcome: 'recorded' }, history);
    history = result.history;
    assert.ok(history.lines.length <= 96);
  }
  assert.equal(history.lines.length, 96);
  assert.equal(
    Object.values(history.turns).reduce((sum, count) => sum + count, 0),
    200,
  );
  assert.equal(history.lines.at(-1).split('-')[0], history.lastCharacter);
});

test('selection is deterministic and does not consume global simulation randomness', () => {
  const original = Math.random;
  try {
    Math.random = () => {
      throw new Error('must not consume gameplay randomness');
    };
    assert.deepEqual(
      select({ topic: 'technical', outcome: 'study' }),
      select({ topic: 'technical', outcome: 'study' }),
    );
  } finally {
    Math.random = original;
  }
});

test('live continuous contexts suppress correct, retry and study commentary', () => {
  for (const topic of topics)
    for (const outcome of ['correct', 'retry', 'study'])
      assert.equal(select({ context: 'continuous', topic, outcome }), null);
  assert.ok(select({ context: 'continuous', outcome: 'recorded' }));
  assert.ok(select({ context: 'continuous', outcome: 'complete' }));
});

test('certification permits only neutral recorded lines for every topic', () => {
  for (const topic of topics) {
    for (const outcome of ['correct', 'retry', 'study', 'complete'])
      assert.equal(select({ context: 'certification', topic, outcome }), null);
    const result = select({
      context: 'certification',
      topic,
      outcome: 'recorded',
    });
    assert.ok(result);
    assert.equal(result.dialogue.topic, 'general');
    assert.deepEqual(result.dialogue.outcomes, ['recorded']);
    assert.notEqual(result.dialogue.pose, 'celebrate');
  }
});

test('replaying a review never produces character commentary', () => {
  for (const outcome of outcomes)
    for (const topic of topics)
      assert.equal(select({ context: 'review', outcome, topic }), null);
});

test('every recorded line is neutral and contains no rule verdict or instructions', () => {
  const recorded = DIALOGUE.filter((line) =>
    line.outcomes.includes('recorded'),
  );
  assert.ok(recorded.length >= 16);
  for (const line of recorded) {
    assert.equal(line.topic, 'general', line.id);
    assert.deepEqual(line.outcomes, ['recorded'], line.id);
    assert.notEqual(line.pose, 'celebrate', line.id);
    assert.doesNotMatch(
      line.text,
      /\b(?:correct|incorrect|wrong|penalty|penalize|damaged|goal|kickoff|out of bounds|pushed out|should|must|sixty|60 seconds)\b/i,
      line.id,
    );
  }
  for (const context of ['practice', 'continuous', 'certification']) {
    let history = createCommitteeHistory();
    for (const topic of topics) {
      const result = select({ context, topic, outcome: 'recorded' }, history);
      assert.ok(recorded.some(({ id }) => id === result.dialogue.id));
      history = result.history;
    }
  }
});

test('topic mapping distinguishes pushed out, own goals, damage and technical checks', () => {
  for (const [text, expected] of [
    ['out', 'out'],
    ['wall', 'out'],
    ['OUT OF BOUNDS', 'out'],
    ['waive-out', 'pushed-out'],
    ['pushed-out', 'pushed-out'],
    ['pushed out', 'pushed-out'],
    ['own-goal', 'own-goal'],
    ['own goal', 'own-goal'],
    ['goal', 'goal'],
    ['damaged', 'damaged'],
    ['non-responsive', 'damaged'],
    ['repair', 'damaged'],
    ['kickoff', 'restart'],
    ['early-start', 'restart'],
    ['return', 'restart'],
    ['resume', 'restart'],
    ['lack-progress', 'progress'],
    ['count', 'progress'],
    ['team intervention', 'interference'],
    ['audience', 'interference'],
    ['inspect', 'technical'],
    ['radio', 'technical'],
    ['ball-capture', 'technical'],
    ['communication-module', 'technical'],
    ['kicker', 'technical'],
    ['infrared', 'technical'],
    ['', 'general'],
    ['lesson introduction', 'general'],
  ])
    assert.equal(committeeTopic(text), expected, text);
});

test('topic matching uses complete out/wall words and does not mislabel penalty-area reading', () => {
  for (const text of [
    'without',
    'without holding',
    'layout',
    'shout',
    'timeout',
    'outstanding',
    'soccer:inside-penalty-area',
    'entry:penalty-areas',
    'Inside the Penalty Area (Pushing and Multiple Defense)',
  ])
    assert.equal(committeeTopic(text), 'general', text);
  for (const text of [
    'out',
    'out-of-bounds',
    'soccer:out_of_bounds',
    'case:wall',
    'field:field-walls',
  ])
    assert.equal(committeeTopic(text), 'out', text);
  assert.equal(committeeTopic('pushed_out'), 'pushed-out');
  assert.equal(committeeTopic('own_goal'), 'own-goal');
});

test('plain rule section anchors classify interruptions and physical robot checks', () => {
  for (const text of [
    'soccer:interruption-of-game-ref-interruption',
    'entry:interruption-of-game-ref-interruption',
    'Interruption of Game',
  ])
    assert.equal(committeeTopic(text), 'restart', text);
  for (const text of [
    'soccer:dimensions',
    'entry:dimensions',
    'soccer:handle',
    'soccer:top-markers',
    'soccer:_safety_and_power_requirements',
    'Safety and power requirements',
    'robot-dimension',
    'top_marker',
  ])
    assert.equal(committeeTopic(text), 'technical', text);
});

test('dispatch is safe without a browser and rejects malformed data', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Reflect.deleteProperty(globalThis, 'window');
    assert.doesNotThrow(() => emitCommitteeEvent(event()));
    assert.doesNotThrow(() => emitCommitteeEvent(null));
    let dispatches = 0;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: () => {
          dispatches++;
        },
      },
    });
    emitCommitteeEvent(null);
    emitCommitteeEvent(event({ outcome: 'secret' }));
    assert.equal(dispatches, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('dispatch sends one actual custom event and isolates listener failures', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const sent = [];
  const detail = event();
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { dispatchEvent: (message) => sent.push(message) },
    });
    emitCommitteeEvent(detail);
    assert.equal(sent.length, 1);
    assert.ok(sent[0] instanceof CustomEvent);
    assert.equal(sent[0].type, COMMITTEE_EVENT_NAME);
    assert.equal(sent[0].detail, detail);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: () => {
          throw new Error('optional listener');
        },
      },
    });
    assert.doesNotThrow(() => emitCommitteeEvent(detail));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('cosmetic lifecycle reset emits only its surface and is safe without a browser or listener', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const sent = [];
  try {
    Reflect.deleteProperty(globalThis, 'window');
    assert.doesNotThrow(() => emitCommitteeReset('referee'));
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { dispatchEvent: (message) => sent.push(message) },
    });
    for (const surface of ['rules', 'referee', 'play'])
      emitCommitteeReset(surface);
    emitCommitteeReset('hidden-engine');
    assert.equal(sent.length, 3);
    sent.forEach((message, index) => {
      assert.equal(message.type, COMMITTEE_RESET_EVENT_NAME);
      assert.deepEqual(message.detail, {
        surface: ['rules', 'referee', 'play'][index],
      });
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: () => {
          throw new Error('optional listener');
        },
      },
    });
    assert.doesNotThrow(() => emitCommitteeReset('referee'));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
