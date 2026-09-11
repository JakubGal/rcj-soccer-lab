import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = (path) => {
  const text = readFileSync(new URL(path, root), 'utf8');
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
};
const find = (tree, predicate) => {
  if (predicate(tree)) return tree;
  let result;
  ts.forEachChild(tree, (child) => {
    result ??= find(child, predicate);
  });
  return result;
};

// Exercise the actual event-boundary handlers, isolated from WebGL rendering.
// Dependency injection makes save timing and hidden-feedback access observable;
// the handler bodies are parsed from production TSX, not duplicated here.
const bind = (expression, tree, bindings) => {
  const compiled = ts.transpileModule(
    `const handler = ${expression.getText(tree)};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  return compileFunction(
    `${compiled}\nreturn handler;`,
    Object.keys(bindings),
  )(...Object.values(bindings));
};
const handler = (path, name, bindings) => {
  const tree = source(path);
  const declaration = find(
    tree,
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(tree) === name,
  );
  assert.ok(declaration?.initializer, `production handler ${name} exists`);
  return bind(declaration.initializer, tree, bindings);
};
const rulesPath = 'components/rulebook/Rulebook.tsx';
const refereePath = 'components/simulator/RefereePlay.tsx';
const playPath = 'components/simulator/MatchPlay.tsx';
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const ruleEvent = (overrides = {}) => ({
  type: 'answer',
  mode: 'practice',
  questionId: 'question:wall',
  sourceId: 'wall',
  accepted: true,
  ...overrides,
});
const ruleBindings = (overrides = {}) => ({
  learning: undefined,
  active: true,
  completedSituationIds: [],
  committeeId: 'rule-instance',
  committeeSequence: { current: 0 },
  committeeScope: {
    current: {
      active: true,
      context: 'practice',
      situationId: 'question:wall',
    },
  },
  learningContextKey: 'practice',
  emitCommitteeEvent: () => {},
  committeeTopic: () => 'out',
  ...overrides,
});

test('all four rule lesson types share the answer-boundary adapter, not a render effect', () => {
  const tree = source(rulesPath);
  const attrs = [];
  const visit = (node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(tree) === 'onLearningEvent'
    )
      attrs.push(node.initializer.getText(tree));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.deepEqual(attrs, Array(4).fill('{onLearningEvent}'));
});

test('plain rules reading emits study only on active practice section changes, not exams, questions or reactivation', () => {
  const tree = source(rulesPath);
  const effect = find(
    tree,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'useEffect' &&
      node.arguments[0]
        ?.getText(tree)
        .includes('const previous = committeeReading.current'),
  );
  assert.ok(effect);
  const emitted = [],
    themes = [];
  const bindings = {
    active: true,
    learningMode: 'practice',
    selected: { id: 'soccer:scoring' },
    situationId: null,
    committeeReading: {
      current: { active: true, mode: 'practice', sectionId: 'soccer:scoring' },
    },
    committeeId: 'reading-instance',
    committeeSequence: { current: 0 },
    emitCommitteeEvent: (event) => emitted.push(event),
    committeeTopic: (sectionId) => {
      themes.push(sectionId);
      return 'out';
    },
  };
  const observe = () => bind(effect.arguments[0], tree, bindings)();
  observe();
  assert.equal(emitted.length, 0, 'initial mount is left to the tour');
  bindings.selected.id = 'soccer:out-of-bounds';
  observe();
  observe();
  assert.deepEqual(emitted, [
    {
      id: 'reading-instance:study:1',
      surface: 'rules',
      context: 'practice',
      outcome: 'study',
      topic: 'out',
    },
  ]);
  assert.deepEqual(themes, ['soccer:out-of-bounds']);

  bindings.situationId = 'question:damaged';
  bindings.selected.id = 'soccer:damaged-robots';
  observe();
  bindings.situationId = null;
  observe();
  assert.equal(emitted.length, 1, 'clearing a question is not a new section');

  bindings.active = false;
  bindings.selected.id = 'soccer:pre-match-meeting';
  observe();
  bindings.active = true;
  bindings.selected.id = 'soccer:neutral-kickoff';
  observe();
  assert.equal(
    emitted.length,
    1,
    'reactivation does not replay cached changes',
  );

  bindings.learningMode = 'certification';
  bindings.selected.id = 'soccer:ball-movement';
  observe();
  bindings.selected.id = 'soccer:inside-penalty-area';
  observe();
  bindings.learningMode = 'practice';
  observe();
  assert.equal(
    emitted.length,
    1,
    'neither exam browsing nor exit supplies hints',
  );
  bindings.selected.id = 'soccer:human-interference';
  observe();
  assert.equal(emitted.length, 2);
  assert.notEqual(emitted[0].id, emitted[1].id);
  bindings.emitCommitteeEvent = () => {
    throw new Error('cosmetic failure');
  };
  bindings.selected.id = 'soccer:lack-of-progress';
  assert.doesNotThrow(observe);
});

test('certification rule notifications wait for the original save and reveal no verdict', async () => {
  for (const accepted of [false, true]) {
    let resolveSave;
    const saved = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const emitted = [];
    const onLearningEvent = handler(
      rulesPath,
      'onLearningEvent',
      ruleBindings({
        learning: { onEvent: () => saved },
        emitCommitteeEvent: (event) => emitted.push(event),
      }),
    );
    assert.equal(
      onLearningEvent(ruleEvent({ mode: 'certification', accepted })),
      saved,
    );
    assert.deepEqual(emitted, []);
    resolveSave();
    await flush();
    assert.deepEqual(emitted, [
      {
        id: 'rule-instance:rules:1',
        surface: 'rules',
        context: 'certification',
        outcome: 'recorded',
        topic: 'out',
      },
    ]);
  }
});

test('practice answer notifications are unique and cosmetic failures never alter saving', async () => {
  const emitted = [];
  const onLearningEvent = handler(
    rulesPath,
    'onLearningEvent',
    ruleBindings({
      emitCommitteeEvent: (event) => emitted.push(event),
    }),
  );
  assert.equal(onLearningEvent(ruleEvent()), undefined);
  assert.equal(onLearningEvent(ruleEvent({ accepted: false })), undefined);
  await flush();
  assert.deepEqual(
    emitted.map(({ outcome }) => outcome),
    ['correct', 'retry'],
  );
  assert.equal(new Set(emitted.map(({ id }) => id)).size, 2);
  const saved = Promise.resolve();
  const throwingListener = handler(
    rulesPath,
    'onLearningEvent',
    ruleBindings({
      learning: { onEvent: () => saved },
      emitCommitteeEvent: () => {
        throw new Error('cosmetic failure');
      },
    }),
  );
  assert.equal(throwingListener(ruleEvent()), saved);
  await flush();
});

test('no rule notifications appear for restored answers, assistance, failed saves or navigated-away lessons', async () => {
  for (const overrides of [
    { active: false },
    { completedSituationIds: ['question:wall'] },
    {
      committeeScope: {
        current: {
          active: false,
          context: 'practice',
          situationId: 'question:wall',
        },
      },
    },
    {
      committeeScope: {
        current: {
          active: true,
          context: 'certification:other',
          situationId: 'question:wall',
        },
      },
    },
    {
      committeeScope: {
        current: {
          active: true,
          context: 'practice',
          situationId: 'question:other',
        },
      },
    },
    { learning: { onEvent: () => Promise.reject(new Error('save failed')) } },
  ]) {
    const emitted = [];
    const onLearningEvent = handler(
      rulesPath,
      'onLearningEvent',
      ruleBindings({
        ...overrides,
        emitCommitteeEvent: (event) => emitted.push(event),
      }),
    );
    void onLearningEvent(ruleEvent())?.catch(() => undefined);
    await flush();
    assert.deepEqual(emitted, []);
  }
  const emitted = [];
  const onLearningEvent = handler(
    rulesPath,
    'onLearningEvent',
    ruleBindings({
      emitCommitteeEvent: (event) => emitted.push(event),
    }),
  );
  onLearningEvent(ruleEvent({ type: 'assistance' }));
  onLearningEvent(ruleEvent({ type: 'complete' }));
  await flush();
  assert.deepEqual(emitted, []);
});

const refereeBindings = (overrides = {}) => ({
  certificationSessionReady: true,
  frame: { decisionKey: 'visible:1' },
  session: {
    mode: 'step',
    decisionKey: 'current:1',
    submit: () => true,
    canAdvance: true,
    snapshot: () => ({ feedback: { verdict: 'correct' } }),
  },
  recordReplayOperation: () => {},
  setRunning: () => {},
  sync: () => {},
  active: true,
  replay: null,
  sessionKind: 'practice',
  certification: undefined,
  committeeId: 'referee-instance',
  committeeSequence: { current: 0 },
  committeeTopic: () => 'out',
  emitCommitteeEvent: () => {},
  ...overrides,
});

test('continuous and certification call receipts never access hidden feedback', () => {
  for (const [mode, certification, context] of [
    ['continuous', undefined, 'continuous'],
    ['step', {}, 'certification'],
    ['continuous', {}, 'certification'],
  ]) {
    const emitted = [],
      operations = [];
    const bindings = refereeBindings({ certification });
    bindings.session.mode = mode;
    bindings.session.snapshot = () => {
      assert.fail('private feedback must not be read');
    };
    bindings.recordReplayOperation = (_, event) => operations.push(event);
    bindings.emitCommitteeEvent = (event) => emitted.push(event);
    const submit = handler(refereePath, 'submit', bindings);
    const call = { action: 'out', target: 'yellow-1' };
    submit(call);
    assert.deepEqual(operations, [
      { op: 'call', decisionKey: 'current:1', call },
    ]);
    assert.deepEqual(emitted, [
      {
        id: 'referee-instance:referee:1',
        surface: 'referee',
        context,
        outcome: 'recorded',
        topic: 'out',
      },
    ]);
  }
});

test('only visible practice feedback may specialize an Award goal call to own goal', () => {
  for (const [mode, certification, topic] of [
    ['step', undefined, 'own-goal'],
    ['continuous', undefined, 'goal'],
    ['step', {}, 'goal'],
    ['continuous', {}, 'goal'],
  ]) {
    const emitted = [],
      themed = [];
    const bindings = refereeBindings({
      certification,
      committeeTopic: (text) => {
        themed.push(text);
        return text === 'Own goal' ? 'own-goal' : 'goal';
      },
      emitCommitteeEvent: (event) => emitted.push(event),
    });
    bindings.session.mode = mode;
    bindings.session.snapshot = () => ({
      feedback: { verdict: 'correct' },
      decisionTitle: 'Own goal',
    });
    handler(
      refereePath,
      'submit',
      bindings,
    )({ action: 'goal', target: 'yellow' });
    assert.equal(emitted[0].topic, topic);
    assert.deepEqual(
      themed,
      topic === 'own-goal' ? ['goal', 'Own goal'] : ['goal'],
    );
  }
});

test('referee commentary resets on lifecycle changes but not initial mount or stable frames', () => {
  const tree = source(refereePath);
  const effect = find(
    tree,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'useEffect' &&
      node.arguments[0]
        ?.getText(tree)
        .includes('const previous = committeeLifecycle.current'),
  );
  assert.ok(effect);
  const session = {};
  const resets = [];
  const bindings = {
    session,
    displayedMode: 'step',
    replay: null,
    active: true,
    committeeLifecycle: {
      current: { session, mode: 'step', replay: null, active: true },
    },
    emitCommitteeReset: (surface) => resets.push(surface),
  };
  const observe = () => bind(effect.arguments[0], tree, bindings)();
  observe();
  assert.deepEqual(resets, []);
  for (const change of [
    { displayedMode: 'continuous' },
    { replay: {} },
    { replay: null },
    { session: {} },
    { active: false },
    { active: true },
  ]) {
    const count = resets.length;
    Object.assign(bindings, change);
    observe();
    observe();
    assert.equal(resets.length, count + 1);
  }
  assert.deepEqual(resets, Array(6).fill('referee'));
});

test('step practice reports only newly visible submitted feedback, never replay or background state', () => {
  for (const [verdict, outcome] of [
    ['correct', 'correct'],
    ['supported', 'correct'],
    ['wrong-target', 'retry'],
  ]) {
    const emitted = [];
    const bindings = refereeBindings({
      emitCommitteeEvent: (event) => emitted.push(event),
    });
    bindings.session.snapshot = () => ({ feedback: { verdict } });
    handler(
      refereePath,
      'submit',
      bindings,
    )({ action: 'out', target: 'blue-1' });
    assert.equal(emitted[0].outcome, outcome);
  }
  for (const overrides of [
    { active: false },
    { replay: {} },
    { sessionKind: 'review' },
    { certificationSessionReady: false },
  ]) {
    const emitted = [];
    handler(
      refereePath,
      'submit',
      refereeBindings({
        ...overrides,
        emitCommitteeEvent: (event) => emitted.push(event),
      }),
    )({ action: 'out', target: 'blue-1' });
    assert.deepEqual(emitted, []);
  }
  let synced = 0;
  const bindings = refereeBindings({
    emitCommitteeEvent: () => {
      throw new Error('cosmetic failure');
    },
    sync: () => {
      synced++;
    },
  });
  assert.doesNotThrow(() =>
    handler(refereePath, 'submit', bindings)({ action: 'out' }),
  );
  assert.equal(synced, 1);
});

test('Play observes public score/finish transitions once and ignores resets, setup and inactive play', () => {
  const tree = source(playPath);
  const effect = find(
    tree,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'useEffect' &&
      node.arguments[0]
        ?.getText(tree)
        .includes('const previous = committeeMatch.current'),
  );
  assert.ok(effect);
  const engine = {};
  const emitted = [];
  const bindings = {
    engine,
    frame: { score: { blue: 0, yellow: 0 }, phase: 'playing' },
    committeeMatch: {
      current: { engine, blue: 0, yellow: 0, phase: 'playing' },
    },
    committeeId: 'play-instance',
    committeeSequence: { current: 0 },
    active: true,
    arrange: false,
    emitCommitteeEvent: (event) => emitted.push(event),
  };
  const observe = () => bind(effect.arguments[0], tree, bindings)();
  observe();
  assert.equal(emitted.length, 0);
  bindings.frame.score.blue = 1;
  observe();
  observe();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].topic, 'goal');
  bindings.frame.phase = 'finished';
  observe();
  observe();
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].outcome, 'complete');
  bindings.engine = {};
  bindings.frame.score.blue = 3;
  observe();
  bindings.arrange = true;
  bindings.frame.score.blue = 4;
  observe();
  bindings.arrange = false;
  bindings.active = false;
  bindings.frame.score.yellow = 1;
  observe();
  bindings.active = true;
  observe();
  assert.equal(emitted.length, 2);
});
