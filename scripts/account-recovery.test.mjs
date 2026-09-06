import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerTrustedTypes } from './github-academy.mjs';
registerTrustedTypes();
const {
  emptyProgress, enableProfile, newRound, startLocalGame, finishLocalGame,
  accountSnapshot, resumeLocalGame, saveLocalCheckpoint, savedLocalReplay,
  validateBackup,
} = await import('../lib/account/local.ts');
const {
  hydrateMatchReplay, makeMatchReplay, makeMatchReplayCheckpoint,
  verifyMatchReplay,
} = await import('../lib/certification/replay.ts');
const { createResultSaveTracker } = await import('../lib/account/result-save.ts');
const { CERTIFICATION_POLICY } = await import('../lib/certification/policy.ts');
const dataForTest = async () => {
  const data = emptyProgress();
  enableProfile(data);
  await newRound(data);
  return data;
};
const start = (data, mode = 'continuous') => startLocalGame(data, {
  roundId: data.round.id, mode, robotVisual: 'xlc-innovation-2021',
});
function ended(checkpoint) {
  const session = hydrateMatchReplay(checkpoint);
  session.endSession();
  return makeMatchReplay({
    mode: checkpoint.mode, seed: checkpoint.seed, robotVisual: checkpoint.robotVisual,
    topics: checkpoint.topics,
    events: [...checkpoint.events, { op: 'end', seq: checkpoint.events.length, tick: checkpoint.terminal.tick }],
    terminal: { tick: checkpoint.terminal.tick, reason: 'ended-early' },
  });
}
function finish(data, id) {
  const replay = ended(resumeLocalGame(data, id).checkpoint);
  const verified = verifyMatchReplay(replay);
  finishLocalGame(data, id, { replay, elapsedSeconds: verified.elapsedSeconds, ...verified.report });
  return replay;
}

function openingCheckpoint(initial, end = 'yellow', ticks = 60, pause = true) {
  const session = hydrateMatchReplay(initial);
  const events = [...initial.events];
  const record = (op, action) => {
    const tick = session.trainingTick;
    action();
    events.push({ ...op, tick, seq: events.length });
  };
  record({ op: 'toss' }, () => session.tossCoin());
  record({ op: 'choose-end', end }, () => session.chooseOpeningEnd(end));
  record({ op: 'call', decisionKey: session.decisionKey, call: { action: 'start' } },
    () => session.submit(session.decisionKey, { action: 'start' }));
  for (let tick = 0; tick < ticks; tick++) session.step();
  if (pause) record({ op: 'pause' }, () => session.pauseForDecision());
  return makeMatchReplayCheckpoint({ ...initial, events,
    terminal: { tick: session.trainingTick, reason: 'checkpoint' } });
}

function finalPayload(checkpoint) {
  const replay = ended(checkpoint);
  const verified = verifyMatchReplay(replay);
  return { replay, elapsedSeconds: verified.elapsedSeconds, ...verified.report };
}

for (const mode of ['step', 'continuous']) test(`${mode}: the fourth active attempt remains viable after three failed games`, async () => {
  const data = await dataForTest();
  for (let failed = 0; failed < 3; failed++) {
    const launch = await start(data, mode);
    finish(data, launch.attemptId);
  }
  assert.equal((await accountSnapshot(data)).certification.status, 'in-progress');
  const fourth = await start(data, mode);
  const snapshot = await accountSnapshot(data);
  assert.equal(snapshot.certification.status, 'in-progress');
  assert.equal(snapshot.certification[mode].attempts[3].inProgress, true);
  assert.equal(snapshot.certification[mode].attempts[3].durationSeconds, 0);
  await assert.rejects(() => start(data, mode), /Resume or end/);
  assert.equal(resumeLocalGame(data, fourth.attemptId).attemptId, fourth.attemptId);
  assert.equal(data.round.games.length, 4);
  finish(data, fourth.attemptId);
  assert.equal((await accountSnapshot(data)).certification.status, 'failed');
});

test('checkpoint survives serialization, restores exact decisions, and keeps one attempt', async () => {
  const data = await dataForTest();
  const launch = await start(data);
  const initial = resumeLocalGame(data, launch.attemptId).checkpoint;
  assert.equal(initial.robotVisual, 'xlc-innovation-2021');
  const session = hydrateMatchReplay(initial);
  const events = [];
  const record = (op, action) => {
    const tick = session.trainingTick;
    action();
    events.push({ ...op, tick, seq: events.length });
  };
  record({ op: 'toss' }, () => session.tossCoin());
  record({ op: 'choose-end', end: 'yellow' }, () => session.chooseOpeningEnd('yellow'));
  record({ op: 'call', decisionKey: session.decisionKey, call: { action: 'start' } },
    () => session.submit(session.decisionKey, { action: 'start' }));
  for (let i = 0; i < 60; i++) session.step();
  record({ op: 'pause' }, () => session.pauseForDecision());
  const checkpoint = makeMatchReplayCheckpoint({ ...initial, events,
    terminal: { tick: session.trainingTick, reason: 'checkpoint' } });
  saveLocalCheckpoint(data, launch.attemptId, checkpoint);
  saveLocalCheckpoint(data, launch.attemptId, initial); // stale write cannot rewind
  const recovered = await validateBackup(JSON.parse(JSON.stringify(data)));
  const resumed = resumeLocalGame(recovered, launch.attemptId);
  const restored = hydrateMatchReplay(resumed.checkpoint, { recordMatchReplay: true });
  assert.equal(recovered.round.games.length, 1);
  assert.equal(restored.trainingTick, session.trainingTick);
  for (const key of ['actors', 'report', 'score', 'decisionKey', 'phase', 'userPaused'])
    assert.deepEqual(restored.snapshot()[key], session.snapshot()[key], key);
  assert.equal(verifyMatchReplay(ended(resumed.checkpoint)).complete, false);
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId,
    { ...checkpoint, robotVisual: 'lab' }), /Another tab/);
});

test('competing resumed tabs cannot silently discard divergent older checkpoints', async () => {
  const data = await dataForTest();
  const launch = await start(data);
  const initial = resumeLocalGame(data, launch.attemptId).checkpoint;
  const tabA = openingCheckpoint(initial, 'yellow', 120);
  const tabB = openingCheckpoint(initial, 'blue', 60);
  saveLocalCheckpoint(data, launch.attemptId, tabA);
  const saved = structuredClone(data);

  // Both tabs resumed the same save, but made different opening decisions.
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId, tabB), /Another tab/);
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId,
    { ...tabB, events: tabB.events.slice(0, 2), terminal: { tick: 0, reason: 'checkpoint' } }), /Another tab/);
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId,
    { ...initial, robotVisual: 'lab' }), /Another tab/);
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId,
    { ...initial, seed: initial.seed === 0xffffffff ? 1 : initial.seed + 1 }), /different game/);
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId,
    { ...initial, mode: 'step' }), /different game/);

  // Genuine delayed writes from the winning tab are compatible and cannot rewind it.
  saveLocalCheckpoint(data, launch.attemptId, initial);
  saveLocalCheckpoint(data, launch.attemptId,
    { ...tabA, events: tabA.events.slice(0, 2), terminal: { tick: 0, reason: 'checkpoint' } });
  assert.deepEqual(data, saved);
});

test('checkpoint extensions cannot insert decisions before already saved simulation time', async () => {
  const data = await dataForTest();
  const launch = await start(data);
  const initial = resumeLocalGame(data, launch.attemptId).checkpoint;
  const earlier = openingCheckpoint(initial, 'yellow', 60, false);
  const later = { ...earlier, terminal: { tick: 120, reason: 'checkpoint' } };
  saveLocalCheckpoint(data, launch.attemptId, later);
  const saved = structuredClone(data);
  const divergent = { ...later,
    events: [...later.events, { op: 'pause', tick: 100, seq: later.events.length }],
    terminal: { tick: 180, reason: 'checkpoint' } };
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId, divergent), /Another tab/);
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId,
    { ...divergent, terminal: { tick: 100, reason: 'checkpoint' } }), /Another tab/);
  saveLocalCheckpoint(data, launch.attemptId, earlier);
  assert.deepEqual(data, saved);

  // More actions at the current tick are normal, not a competing past history.
  const sameTick = { ...later,
    events: [...later.events, { op: 'pause', tick: 120, seq: later.events.length }] };
  saveLocalCheckpoint(data, launch.attemptId, sameTick);
  assert.equal(data.checkpoints[launch.attemptId].events.length, later.events.length + 1);
});

test('finalization must extend the latest saved checkpoint and retries must match the saved result', async () => {
  const data = await dataForTest();
  const launch = await start(data);
  const initial = resumeLocalGame(data, launch.attemptId).checkpoint;
  const tabA = openingCheckpoint(initial, 'yellow', 120);
  const tabB = openingCheckpoint(initial, 'blue', 180);
  saveLocalCheckpoint(data, launch.attemptId, tabA);
  const saved = structuredClone(data);
  const accepted = finalPayload(tabA);
  const stale = finalPayload(initial);
  const divergent = finalPayload(tabB);
  assert.throws(() => finishLocalGame(data, launch.attemptId, stale), /Another tab/);
  assert.throws(() => finishLocalGame(data, launch.attemptId, divergent), /Another tab/);
  assert.throws(() => finishLocalGame(data, launch.attemptId,
    { ...accepted, replay: { ...accepted.replay, robotVisual: 'lab' } }), /Another tab/);
  assert.throws(() => finishLocalGame(data, launch.attemptId,
    { ...accepted, replay: { ...accepted.replay, mode: 'step' } }), /different game/);
  assert.throws(() => finishLocalGame(data, launch.attemptId,
    { ...accepted, replay: { ...accepted.replay, seed: initial.seed === 0xffffffff ? 1 : initial.seed + 1 } }), /different game/);
  assert.deepEqual(data, saved);

  finishLocalGame(data, launch.attemptId, accepted);
  const completed = structuredClone(data);
  finishLocalGame(data, launch.attemptId, accepted); // idempotent save retry
  saveLocalCheckpoint(data, launch.attemptId, tabA); // delayed compatible checkpoint
  assert.deepEqual(data, completed);
  assert.equal(data.practiceGames.length, 1);
  assert.throws(() => finishLocalGame(data, launch.attemptId, divergent), /Another tab/);
  assert.throws(() => finishLocalGame(data, launch.attemptId, stale), /Another tab/);
  assert.throws(() => saveLocalCheckpoint(data, launch.attemptId, tabB), /Another tab/);
  assert.deepEqual(data, completed);
});

test('completed recordings remain reviewable across certification restarts and backups', async () => {
  const data = await dataForTest();
  const launch = await start(data);
  const replay = finish(data, launch.attemptId);
  assert.equal(data.checkpoints[launch.attemptId], undefined);
  assert.deepEqual(savedLocalReplay(data, launch.attemptId), replay);
  await newRound(data);
  const restored = await validateBackup(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(savedLocalReplay(restored, launch.attemptId), replay);
  assert.equal((await accountSnapshot(restored)).recentGames[0].canReview, true);
});

test('legacy rounds remain readable, require explicit restart, and retain old evidence', async () => {
  const data = await dataForTest();
  const launch = await start(data);
  finish(data, launch.attemptId);
  delete data.round.policyVersion;
  data.round.games[0].replay.engineVersion = 'referee-match-2026-v1';
  const backup = JSON.parse(JSON.stringify(data));
  const restored = await validateBackup(backup);
  assert.equal((await accountSnapshot(restored)).certification.status, 'upgrade-required');
  assert.equal(restored.round.games.length, 1);
  assert.equal(restored.round.games[0].replay.engineVersion, 'referee-match-2026-v1');
  assert.throws(() => resumeLocalGame(restored, launch.attemptId), /cannot be resumed/);
  await newRound(restored);
  assert.equal(restored.round.policyVersion, CERTIFICATION_POLICY.policyVersion);
  assert.equal(restored.archivedReplays[launch.attemptId].engineVersion, 'referee-match-2026-v1');
});

test('failed final saves can retry; concurrent and completed saves are deduplicated', async () => {
  const tracker = createResultSaveTracker();
  let calls = 0;
  await assert.rejects(tracker.save('attempt', () => { calls++; throw new Error('storage full'); }), /storage full/);
  assert.equal(tracker.has('attempt'), false);
  const first = tracker.save('attempt', () => { calls++; });
  const concurrent = tracker.save('attempt', () => { calls++; });
  assert.equal(first, concurrent);
  await first;
  await tracker.save('attempt', () => { calls++; });
  assert.equal(calls, 2);
  assert.equal(tracker.isSaved('attempt'), true);
});
