import assert from 'node:assert/strict';
import { RefereeMatch } from '../lib/simulator/referee-match.ts';
import { TRAINING_TOPICS } from '../lib/simulator/referee-training.ts';
import {
  MATCH_REPLAY_DURATION_TICKS,
  makeMatchReplay,
} from '../lib/certification/replay.ts';

export const CERTIFICATION_TOPICS = TRAINING_TOPICS.map((topic) => topic.id);

/** Test-only deterministic referee that produces qualifying replay fixtures. */
export function makePerfectReplay(
  mode,
  seed,
  { recordMatchReplay = false, requireQualifying = true } = {},
) {
  const session = new RefereeMatch(seed, {
    preMatch: true,
    robotVisual: 'lab',
    mode,
    duration: 600,
    topics: CERTIFICATION_TOPICS,
    recordMatchReplay,
  });
  const events = [];
  const record = (operation, action) => {
    const applied = action();
    assert.notEqual(applied, false, `${operation.op} should apply`);
    events.push({
      ...operation,
      seq: events.length,
      tick: session.trainingTick,
    });
  };
  const call = (choice) => {
    const decisionKey = session.decisionKey;
    record(
      {
        op: 'call',
        decisionKey,
        call: {
          action: choice.action,
          ...(choice.target ? { target: choice.target } : {}),
        },
      },
      () => session.submit(decisionKey, choice),
    );
  };

  record({ op: 'toss' }, () => session.tossCoin());
  record({ op: 'choose-end', end: 'yellow' }, () =>
    session.chooseOpeningEnd('yellow'),
  );
  call({ action: 'start' });

  let guard = 0;
  while (!session.snapshot().sessionFinished) {
    guard += 1;
    assert.ok(
      guard < 500_000,
      `driver stalled in ${mode} mode at tick ${session.trainingTick}: ${JSON.stringify({ phase: session.snapshot().phase, count: session.snapshot().count, canAdvance: session.canAdvance, canResumeMotion: session.canResumeMotion, active: session.active?.definition?.id, expected: session.expected?.() })}`,
    );
    const frame = session.snapshot();

    if (frame.kickoffReturns.length) {
      call({ action: 'return', target: frame.kickoffReturns[0] });
      continue;
    }
    if (frame.canArrangeKickoff) {
      record({ op: 'arrange-kickoff' }, () => session.arrangeKickoff());
      continue;
    }

    if (mode === 'step') {
      if (frame.phase === 'feedback') {
        record({ op: 'continue' }, () => session.continue());
        continue;
      }
      if (frame.canStartCase) {
        record({ op: 'next-case' }, () => session.nextCase());
        continue;
      }
      if (frame.phase === 'decision' && frame.help?.choices?.length) {
        call(frame.help.choices[0]);
        continue;
      }
    } else if (
      frame.count === null &&
      session.active &&
      session.expected().length
    ) {
      call(session.expected()[0]);
      continue;
    }

    if (!session.canAdvance) {
      if (session.canResumeMotion) {
        record({ op: 'resume' }, () => session.resumeMotion());
        continue;
      }
      assert.fail(
        `driver stopped at tick ${session.trainingTick}: ${JSON.stringify({ phase: frame.phase, kickoffDue: frame.kickoffDue, canArrangeKickoff: frame.canArrangeKickoff, canStartCase: frame.canStartCase, pendingDecisions: frame.pendingDecisions, bench: frame.bench, facts: frame.facts })}`,
      );
    }
    session.step();
  }

  assert.equal(session.trainingTick, MATCH_REPLAY_DURATION_TICKS);
  const frame = session.snapshot();
  const claimedReport = {
    correct: frame.report.correct,
    wrong: frame.report.wrong,
    missed: frame.report.missed,
    assisted: frame.report.assisted,
    assessed: frame.report.assessed,
    accuracy: frame.report.accuracy,
  };
  assert.equal(claimedReport.assisted, 0);
  if (requireQualifying)
    assert.ok(
      claimedReport.accuracy !== null &&
        claimedReport.accuracy >= (mode === 'step' ? 90 : 80),
      `${mode} fixture should meet its qualification threshold`,
    );
  return makeMatchReplay({
    mode,
    seed,
    robotVisual: 'lab',
    topics: CERTIFICATION_TOPICS,
    events,
    terminal: { tick: session.trainingTick, reason: 'full-time' },
    claimedReport,
  });
}
