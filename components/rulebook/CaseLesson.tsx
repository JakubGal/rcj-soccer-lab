'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Lightbulb, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefereeMatch } from '@/lib/simulator/referee-match';
import {
  REFEREE_ACTIONS,
  type RefereeCase,
  type RefereeCall,
} from '@/lib/simulator/referee-cases';
import { MATCH_ACTORS, MATCH_ROBOTS, MATCH_STEP } from '@/lib/simulator/match';
import { lessonChoices } from '@/lib/rulebook/learning';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import { PlayCanvasViewport } from '@/components/simulator/PlayCanvasViewport';

function startLesson(item: RefereeCase, visual: RobotVisualId) {
  const session = new RefereeMatch(2026, { robotVisual: visual });
  session.beginCase(item);
  return session;
}
export function CaseLesson({
  item,
  robotVisual,
  onPassed,
}: {
  item: RefereeCase;
  robotVisual: RobotVisualId;
  onPassed: () => void;
}) {
  const [session, setSession] = useState(() => startLesson(item, robotVisual));
  const [frame, setFrame] = useState(() => session.snapshot());
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const choices = useMemo(
    () =>
      lessonChoices(
        frame.help?.choices ?? [],
        `${item.id}:${frame.decisionKey}`,
      ),
    [frame.help, frame.decisionKey, item.id],
  );
  useEffect(() => {
    session.setRobotVisual(robotVisual);
  }, [session, robotVisual]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0,
      previous = 0,
      accumulator = 0;
    const animate = (now: number) => {
      accumulator += previous ? Math.min(0.1, (now - previous) / 1000) : 0;
      previous = now;
      while (accumulator >= MATCH_STEP && session.canAdvance) {
        session.step();
        accumulator -= MATCH_STEP;
      }
      const next = session.snapshot();
      setFrame(next);
      if (!session.canAdvance || next.feedback?.final) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [playing, session]);
  const submit = (choice: RefereeCall) => {
    session.submit(frame.decisionKey, choice);
    const next = session.snapshot();
    setFrame(next);
    setPlaying(false);
    if (
      next.feedback?.final &&
      ['correct', 'supported'].includes(next.feedback.verdict)
    )
      onPassed();
  };
  const label = (choice: RefereeCall) =>
    `${REFEREE_ACTIONS.find((action) => action.id === choice.action)?.label}${choice.target ? ` · ${MATCH_ROBOTS.find((robot) => robot.id === choice.target)?.label ?? choice.target}` : ''}`;
  const feedback = frame.feedback;
  const correct =
    feedback && ['correct', 'supported'].includes(feedback.verdict);
  return (
    <div className="rule-animation">
      <div className="rule-animation-stage">
        <PlayCanvasViewport
          actors={MATCH_ACTORS}
          poses={frame.actors}
          actorHeights={frame.heights}
          damageCue={frame.damage}
          motionStopped={!playing}
          cameraPreset="overhead"
          robotVisual={robotVisual}
          showRuleGeometry
          showPenaltyEvidence={frame.penaltyEvidence}
          showBallTrail
          showContactEvidence={false}
          ballTrail={session.match.ballTrail()}
          phaseLabel={frame.facts}
          onReady={onReady}
        />
        <output className="rule-scene-caption">
          <strong>
            {frame.phase === 'evidence'
              ? 'Watch the situation'
              : frame.count !== null
                ? 'Observe the count'
                : 'Make your decision'}
          </strong>
          {frame.penaltyEvidence && (
            <span>Body outline · red marks penalty-area overlap</span>
          )}
        </output>
      </div>
      <div className="rule-player-controls rule-case-controls">
        <Button
          disabled={!ready || !frame.canAdvance || Boolean(feedback)}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? <Pause /> : <Play />}
          {playing
            ? 'Pause'
            : frame.count !== null
              ? 'Watch count'
              : 'Watch situation'}
        </Button>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() => {
            const next = startLesson(item, robotVisual);
            setSession(next);
            setFrame(next.snapshot());
            setPlaying(true);
          }}
        >
          <RotateCcw />
          Replay situation
        </Button>
      </div>
      <p className="lesson-observation">{frame.facts}</p>
      <section
        className="rule-question"
        aria-label="Situation checking question"
      >
        <h3>
          {frame.help && frame.help.steps > 1
            ? `Decision ${frame.help.step} of ${frame.help.steps}: `
            : ''}
          What should the referee do?
        </h3>
        {frame.phase === 'evidence' ? (
          <p>
            Play the situation to its decision point, then choose your call.
          </p>
        ) : frame.count !== null && !feedback ? (
          <p>Watch whether progress resumes before making the next call.</p>
        ) : (
          !feedback && (
            <div>
              {choices.map((choice) => (
                <Button
                  key={`${choice.action}:${choice.target}`}
                  variant="outline"
                  disabled={!ready}
                  onClick={() => submit(choice)}
                >
                  {label(choice)}
                </Button>
              ))}
            </div>
          )
        )}
        {feedback && (
          <div
            className={
              correct
                ? 'lesson-feedback lesson-feedback-good'
                : 'lesson-feedback'
            }
            aria-live="polite"
          >
            <h4>
              {correct && <Check className="size-4" />}
              {feedback.title}
            </h4>
            <p>{feedback.detail}</p>
            <p>{feedback.effect}</p>
            {correct && (
              <ul>
                {feedback.appliedRules.map((rule) => (
                  <li key={rule.id}>
                    {rule.document} §{rule.number} · {rule.provision}
                    {rule.quote && <blockquote>“{rule.quote}”</blockquote>}
                  </li>
                ))}
              </ul>
            )}
            {!feedback.final && (
              <Button
                onClick={() => {
                  session.continue();
                  setFrame(session.snapshot());
                  setPlaying(session.canAdvance);
                }}
              >
                {correct ? 'Next decision' : 'Try again'}
              </Button>
            )}
            {feedback.final && <strong>Situation check complete</strong>}
          </div>
        )}
        {!feedback?.final && (
          <Button
            className="mt-3"
            variant="ghost"
            onClick={() => {
              session.requestHint();
              setFrame(session.snapshot());
            }}
          >
            <Lightbulb />
            {frame.help?.level ? 'More help' : 'Hint'}
          </Button>
        )}
        {frame.help && frame.help.level > 0 && (
          <p className="lesson-hint">
            {frame.help.clue}
            {frame.help.level >= 2 && ` ${frame.help.explanation}`}
          </p>
        )}
      </section>
    </div>
  );
}
