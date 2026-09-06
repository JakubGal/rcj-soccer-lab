'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TRAINING_TOPICS,
  trainingTopic,
  type TrainingMode,
  type TrainingTopic,
} from '@/lib/simulator/referee-training';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  Flag,
  Flame,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  Scale,
  Shuffle,
  Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { PlayCanvasViewport, type CameraPreset } from './PlayCanvasViewport';
import { MATCH_ACTORS, MATCH_ROBOTS, MATCH_STEP } from '@/lib/simulator/match';
import { RefereeMatch } from '@/lib/simulator/referee-match';
import { PreMatchToss } from './PreMatchToss';
import {
  sampleSituation,
  type SituationReplay,
} from '@/lib/simulator/situation-replay';
import {
  REFEREE_ACTIONS,
  REFEREE_CASES,
  REFEREE_FAMILIES,
  type RefereeCall,
} from '@/lib/simulator/referee-cases';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import { robotPenaltyOverlap } from '@/lib/simulator/referee-geometry';
import { cn } from '@/lib/utils';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const randomSeed = () => Math.floor(Math.random() * 4294967295) + 1;
const COMMON = new Set([
  'play-on',
  'no-goal',
  'out',
  'damaged',
  'pushing',
  'multiple',
  'count',
  'lack-progress',
  'pause',
]);

export function RefereePlay({
  robotVisual,
  onExit,
  active = true,
  onOpenRule,
}: {
  robotVisual: RobotVisualId;
  onExit: () => void;
  active?: boolean;
  onOpenRule?: (sectionId: string) => void;
}) {
  const [session, setSession] = useState(
    () =>
      new RefereeMatch(randomSeed(), {
        preMatch: true,
        robotVisual,
        duration: 180,
      }),
  );
  const [mode, setMode] = useState<TrainingMode>('step');
  const [duration, setDuration] = useState(180);
  const [trainingTopics, setTrainingTopics] = useState<TrainingTopic[]>(
    TRAINING_TOPICS.map((t) => t.id),
  );
  const [frame, setFrame] = useState(() => session.snapshot());
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState('blue-1');
  const [camera, setCamera] = useState<CameraPreset>('overhead');
  const [speed, setSpeed] = useState(1);
  const [group, setGroup] = useState('common');
  const [topic, setTopic] = useState('random');
  const [seed, setSeed] = useState(String(session.seed));
  const [replay, setReplay] = useState<SituationReplay | null>(null);
  const [replayTime, setReplayTime] = useState(0);
  const [replayRunning, setReplayRunning] = useState(false);
  const replayCursor = useRef(0);
  const seekReplay = useCallback((time: number) => {
    replayCursor.current = time;
    setReplayTime(time);
  }, []);
  const toggleReplay = useCallback(() => {
    if (!replay) return;
    const finished = replayCursor.current >= replay.duration;
    if (finished) seekReplay(0);
    setReplayRunning((value) => finished || !value);
  }, [replay, seekReplay]);
  const field = useRef<HTMLElement>(null);
  const onReady = useCallback(() => setReady(true), []);
  const sync = useCallback(() => setFrame(session.snapshot()), [session]);
  useEffect(() => {
    session.setRobotVisual(robotVisual);
    const update = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(update);
  }, [session, robotVisual, sync]);
  const pause = useCallback(() => {
    if (replay) {
      setReplayRunning(false);
      setRunning(false);
      return;
    }
    session.pauseForDecision();
    setRunning(false);
    sync();
  }, [session, sync, replay]);
  useEffect(() => {
    if (active) return;
    const update = requestAnimationFrame(() => {
      pause();
      setReady(false);
    });
    return () => cancelAnimationFrame(update);
  }, [active, pause]);
  const toggleRunning = useCallback(() => {
    if (!ready) return;
    if (running) {
      pause();
      return;
    }
    session.resumeMotion();
    setRunning(session.canAdvance);
    sync();
  }, [ready, running, pause, session, sync]);
  const reset = useCallback(
    (value: number) => {
      setReplay(null);
      const next = new RefereeMatch(value, {
        preMatch: true,
        robotVisual,
        mode,
        duration,
        topics: trainingTopics,
      });
      setSession(next);
      setFrame(next.snapshot());
      setSeed(String(value));
      setTopic('random');
      setRunning(false);
    },
    [robotVisual, mode, duration, trainingTopics],
  );
  const whistle = useCallback(() => {
    if (replay) return;
    session.whistle();
    setRunning(false);
    sync();
  }, [session, sync, replay]);
  const submit = (call: RefereeCall) => {
    session.submit(frame.decisionKey, call);
    setRunning(session.canAdvance);
    sync();
  };

  useEffect(() => {
    if (!active || !running || replay) return;
    let raf = 0,
      previous = 0,
      accumulator = 0,
      publish = 0;
    const animate = (now: number) => {
      if (!session.canAdvance) {
        sync();
        setRunning(false);
        return;
      }
      const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      previous = now;
      accumulator += delta * speed;
      publish += delta;
      while (accumulator >= MATCH_STEP) {
        session.step();
        accumulator -= MATCH_STEP;
        if (!session.canAdvance) {
          sync();
          setRunning(false);
          return;
        }
      }
      if (publish >= 1 / 30) {
        sync();
        publish = 0;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [active, running, session, speed, sync, replay]);

  useEffect(() => {
    if (!active || !replay || !replayRunning) return;
    let raf = 0,
      previous = 0;
    const animate = (now: number) => {
      const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      previous = now;
      const time = Math.min(replay.duration, replayCursor.current + delta);
      seekReplay(time);
      if (time >= replay.duration) {
        setReplayRunning(false);
        return;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [active, replay, replayRunning, seekReplay]);

  useEffect(() => {
    if (!active) return;
    const stop = pause;
    const visibility = () => {
      if (document.hidden) stop();
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target as HTMLElement)?.closest(
          'input, select, textarea, button, a, [contenteditable="true"]',
        )
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        whistle();
      }
      if (event.code === 'KeyP') {
        event.preventDefault();
        if (replay) toggleReplay();
        else toggleRunning();
      }
    };
    window.addEventListener('blur', stop);
    window.addEventListener('keydown', keydown);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', stop);
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, whistle, pause, toggleRunning, replay, toggleReplay]);

  useEffect(() => {
    if (!active) return;
    const host = window as Window & { snapshot?: () => unknown };
    const snapshot = () => ({
      app: 'RCJ Soccer Lab',
      mode: 'referee',
      referee: true,
      ...session.snapshot(),
      playing: !replay && running && !session.motionHeld,
      replaying: Boolean(replay),
      speed,
      seed: session.seed,
      selectedActor: target,
    });
    host.snapshot = snapshot;
    return () => {
      if (host.snapshot === snapshot) delete host.snapshot;
    };
  }, [active, session, running, speed, target, replay]);

  const canNext = frame.canStartCase;
  const replayPlaying = Boolean(
    replay && replayRunning && replayTime < replay.duration,
  );
  const moving = replay ? replayPlaying : running && !frame.motionHeld;
  const replayView = replay ? sampleSituation(replay, replayTime) : null;
  const view = replayView ?? { ...frame, ballTrail: session.match.ballTrail() };
  const blocked =
    frame.sessionFinished ||
    !ready ||
    Boolean(replay) ||
    Boolean(frame.opening) ||
    frame.resolving ||
    frame.phase === 'feedback';
  const supported =
    frame.feedback && ['correct', 'supported'].includes(frame.feedback.verdict);
  const revealReplay = frame.trainingMode === 'step' || frame.sessionFinished;
  const remainingSeconds = Math.ceil(frame.trainingRemaining);
  const actions = REFEREE_ACTIONS.filter(
    (action) =>
      action.id !== 'goal' &&
      (group === 'all' || group === 'common'
        ? group === 'all' || COMMON.has(action.id)
        : group === 'robot'
          ? action.group === 'Robot'
          : ['Restart', 'Field', 'Score'].includes(action.group)),
  );
  const startNext = () => {
    const definition = REFEREE_CASES.find(
      (item) => item.id === topic && frame.topics.includes(trainingTopic(item)),
    );
    if (definition ? session.beginCase(definition) : session.nextCase()) {
      sync();
      setRunning(session.canAdvance);
    }
  };

  if (!active) return null;
  return (
    <div className="match-workspace referee-workspace">
      <section
        ref={field}
        tabIndex={-1}
        className={cn(
          'viewport-panel match-field referee-field',
          replay && 'referee-field-replay',
        )}
        aria-label="AI match for referee training"
      >
        <PlayCanvasViewport
          actors={MATCH_ACTORS}
          poses={view.actors}
          actorHeights={view.heights}
          damageCue={view.damage}
          damagePlayback={replayView?.damagePlayback ?? null}
          motionStopped={!moving}
          cameraPreset={camera}
          showRuleGeometry
          showBallTrail
          showContactEvidence={false}
          showPenaltyEvidence={frame.penaltyEvidence && !replay}
          ballTrail={view.ballTrail}
          phaseLabel={
            replay
              ? revealReplay
                ? replay.facts
                : 'Review the recorded play and make your own assessment.'
              : frame.facts
          }
          robotVisual={robotVisual}
          selectedActorId={view.actors[target] ? target : null}
          onReady={onReady}
        />
        {frame.opening && !replay && (
          <PreMatchToss
            key={session.seed}
            meeting={frame.opening}
            ready={ready}
            onToss={() => {
              session.tossCoin();
              sync();
            }}
            onKickoff={() => {
              session.chooseFirstKickoff();
              sync();
            }}
            onEnd={(end) => {
              session.chooseOpeningEnd(end);
              sync();
            }}
            onStart={() => submit({ action: 'start' })}
          />
        )}
        <div
          className="match-scoreboard"
          aria-label={`Blue ${view.score.blue}, Yellow ${view.score.yellow}`}
        >
          <span className="text-sky-300">
            BLUE <strong>{view.score.blue}</strong>
          </span>
          <div>
            <Timer className="size-3.5" />
            {clock(view.elapsed)}
            <small>
              {frame.sessionFinished && !replay
                ? 'FULL TIME'
                : replay
                  ? 'REPLAY'
                  : moving && frame.phase !== 'evidence'
                    ? 'AI vs AI'
                    : frame.phase === 'decision'
                      ? 'YOUR CALL'
                      : frame.phase === 'feedback'
                        ? 'REVIEW'
                        : !moving
                          ? 'STOPPED'
                          : 'PRACTICE'}
            </small>
          </div>
          <span className="text-amber-300">
            <strong>{view.score.yellow}</strong> YELLOW
          </span>
        </div>
        <div className="match-camera">
          <NativeSelect
            size="sm"
            aria-label="Referee camera"
            value={camera}
            onChange={(e) => setCamera(e.target.value as CameraPreset)}
          >
            <NativeSelectOption value="overhead">
              Overhead evidence
            </NativeSelectOption>
            <NativeSelectOption value="broadcast">3D view</NativeSelectOption>
            <NativeSelectOption value="referee">
              Referee sideline
            </NativeSelectOption>
            <NativeSelectOption value="ball">Follow ball</NativeSelectOption>
            <NativeSelectOption value="free">Free orbit</NativeSelectOption>
          </NativeSelect>
        </div>
        {!replay && frame.count !== null && (
          <output className="referee-count" aria-live="polite">
            <strong>{frame.count}</strong>Visible count · watch for progress
          </output>
        )}
        {!frame.opening && (
          <div
            className={cn(
              'referee-observation',
              !moving && 'referee-observation-held',
            )}
          >
            <span>
              <Flag className="size-3.5" />
              {replay
                ? revealReplay
                  ? `Replay · ${replay.title}`
                  : 'Replay recent play'
                : frame.sessionFinished
                  ? 'Match complete'
                  : frame.trainingMode === 'continuous' &&
                      !frame.feedback &&
                      !frame.kickoffDue
                    ? frame.motionHeld
                      ? 'Paused for your decision'
                      : 'Continuous observation'
                    : frame.phase === 'live' && frame.kickoffDue
                      ? 'Awaiting kickoff'
                      : frame.phase === 'live'
                        ? 'Live passage of play'
                        : frame.phase === 'evidence'
                          ? 'Watch the evidence'
                          : frame.phase === 'feedback'
                            ? 'Decision review'
                            : frame.motionHeld
                              ? 'Your decision · training paused'
                              : 'Your decision · play continues'}
            </span>
            <p>
              {replay
                ? revealReplay
                  ? replay.facts
                  : 'Review the recorded play and make your own assessment.'
                : frame.sessionFinished
                  ? 'Review your referee results, replay the final passage, or start a new match from Match setup.'
                  : frame.facts}
            </p>
            {frame.penaltyEvidence && !replay && (
              <div
                className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                aria-label="Penalty area body evidence"
              >
                <span className="text-white/85">
                  Body outline ·{' '}
                  <b className="text-rose-300">red = inside the area</b>
                </span>
                {MATCH_ROBOTS.filter((robot) => view.actors[robot.id]).map(
                  (robot) => {
                    const overlaps = [-1, 1].some((end) =>
                      robotPenaltyOverlap(
                        view.actors[robot.id],
                        end,
                        robotVisual,
                      ),
                    );
                    return (
                      <span
                        key={robot.id}
                        className={overlaps ? 'text-rose-300' : 'text-white/65'}
                      >
                        {robot.label}: {overlaps ? 'overlapping' : 'outside'}
                      </span>
                    );
                  },
                )}
              </div>
            )}
            {replay ? (
              <small>
                Recorded situation. Back to match returns to the unchanged live
                game.
              </small>
            ) : (
              !moving && (
                <small>
                  All robots and the ball are stopped in place.{' '}
                  {frame.decisionPaused
                    ? 'Training timers are paused while you complete the decision.'
                    : 'Movement resumes only after your action.'}
                </small>
              )
            )}
            {view.damage && !view.damage.removed && (
              <small className="referee-damage-note">
                <Flame className="size-3.5" />
                {
                  MATCH_ROBOTS.find((robot) => robot.id === view.damage?.robot)
                    ?.label
                }{' '}
                · damage effect
              </small>
            )}
          </div>
        )}
        {!ready && (
          <div className="renderer-loader">Loading referee field…</div>
        )}
        <div className="transport-panel referee-transport">
          {replay ? (
            <>
              <Button onClick={toggleReplay}>
                {replayPlaying ? <Pause /> : <Play />}
                {replayPlaying ? 'Pause replay' : 'Play replay'}
              </Button>
              <input
                className="referee-replay-timeline"
                type="range"
                min="0"
                max={replay.duration}
                step="0.033333"
                value={replayTime}
                aria-label="Replay timeline"
                onChange={(e) => seekReplay(Number(e.target.value))}
              />
              <output className="referee-replay-time">
                {replayTime.toFixed(1)} / {replay.duration.toFixed(1)} s
              </output>
              <Button
                variant="outline"
                onClick={() => {
                  setReplay(null);
                  setReplayRunning(false);
                  sync();
                }}
              >
                <ArrowLeft /> Back to match
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={
                  !ready ||
                  frame.sessionFinished ||
                  Boolean(frame.opening) ||
                  (!running && !frame.canAdvance && !frame.canResumeMotion)
                }
                onClick={() => {
                  toggleRunning();
                  field.current?.focus({ preventScroll: true });
                }}
              >
                {running ? <Pause /> : <Play />}
                {frame.sessionFinished
                  ? 'Finished'
                  : running
                    ? 'Pause for decision'
                    : frame.canResumeMotion &&
                        (frame.userPaused || frame.motionHeld)
                      ? 'Resume observation'
                      : !frame.canAdvance
                        ? 'Stopped'
                        : 'Run'}
              </Button>
              <Button variant="outline" disabled={blocked} onClick={whistle}>
                <Flag />
                Whistle <kbd>Space</kbd>
              </Button>
              <NativeSelect
                size="sm"
                value={speed}
                aria-label="Simulation speed"
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <NativeSelectOption value={0.5}>0.5×</NativeSelectOption>
                <NativeSelectOption value={1}>1×</NativeSelectOption>
                <NativeSelectOption value={2}>2×</NativeSelectOption>
                <NativeSelectOption value={4}>4×</NativeSelectOption>
              </NativeSelect>
            </>
          )}
        </div>
      </section>

      <aside
        className="context-panel match-panel referee-panel"
        aria-label="Live referee console"
      >
        <div className="context-scroll" inert={Boolean(replay)}>
          <div className="referee-heading">
            <div>
              <p className="rule-kicker">AI MATCH / REFEREE</p>
              <h1>Make the call</h1>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onExit}
              aria-label="Back to normal Play"
            >
              <ArrowLeft />
              Play
            </Button>
          </div>
          <div className="referee-stats">
            <span>
              <strong>
                {frame.report.correct} / {frame.report.assessed}
              </strong>
              Correct / assessed ·{' '}
              {frame.report.accuracy === null
                ? '—'
                : `${frame.report.accuracy}%`}
            </span>
            <span>
              <strong>
                {frame.trainingMode === 'continuous'
                  ? `${frame.report.topics.filter((t) => t.assessed || t.assisted).length} / ${frame.topics.length}`
                  : `${frame.coverage.length} / ${REFEREE_CASES.filter((item) => frame.topics.includes(trainingTopic(item))).length}`}
              </strong>
              {frame.trainingMode === 'continuous'
                ? 'Topics assessed'
                : 'Different situations'}
            </span>
          </div>
          <p className="referee-assistance-note">
            {frame.report.wrong} wrong · {frame.report.missed} missed ·{' '}
            {frame.report.assisted} assisted
          </p>
          <details
            className="referee-details referee-session-setup"
            open={Boolean(frame.opening)}
          >
            <summary>
              Match setup ·{' '}
              {frame.trainingMode === 'continuous' ? 'Continuous' : 'Step mode'}
            </summary>
            <label htmlFor="referee-mode">Refereeing mode</label>
            <NativeSelect
              id="referee-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as TrainingMode)}
            >
              <NativeSelectOption value="step">
                Step · pause at each decision
              </NativeSelectOption>
              <NativeSelectOption value="continuous">
                Continuous · you decide when to stop
              </NativeSelectOption>
            </NativeSelect>
            <label htmlFor="referee-duration">
              Match length · simulated play time
            </label>
            <NativeSelect
              id="referee-duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              <NativeSelectOption value={60}>1 minute</NativeSelectOption>
              <NativeSelectOption value={180}>3 minutes</NativeSelectOption>
              <NativeSelectOption value={300}>5 minutes</NativeSelectOption>
              <NativeSelectOption value={600}>10 minutes</NativeSelectOption>
            </NativeSelect>
            <fieldset className="my-3 grid gap-2">
              <legend className="mb-2 font-semibold">
                Situations to train
              </legend>
              {TRAINING_TOPICS.map((t) => (
                <label key={t.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={trainingTopics.includes(t.id)}
                    onChange={(e) =>
                      setTrainingTopics((current) =>
                        e.target.checked
                          ? [...current, t.id]
                          : current.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.label}
                </label>
              ))}
            </fieldset>
            <p>
              {mode === 'continuous'
                ? 'Selected faults develop during AI play. Other natural incidents can still happen, but only your selected topics affect your score. Restarts and returns follow actual match events; administrative exercises remain in Step mode.'
                : 'The next practice drill comes from your selected topics. Each decision pauses in place.'}
            </p>
            <Button
              disabled={!trainingTopics.length}
              onClick={() => reset(randomSeed())}
            >
              <Shuffle /> Start new match with these settings
            </Button>
            {!trainingTopics.length && <p>Select at least one topic.</p>}
          </details>
          <div className="my-3 flex flex-wrap items-center justify-between gap-2">
            <strong>
              {Math.floor(remainingSeconds / 60)}:
              {String(remainingSeconds % 60).padStart(2, '0')} remaining
            </strong>
            <Button
              size="sm"
              variant="outline"
              disabled={frame.sessionFinished || Boolean(frame.opening)}
              onClick={() => {
                session.endSession();
                setRunning(false);
                sync();
              }}
            >
              End match & see results
            </Button>
          </div>
          {frame.sessionFinished && (
            <section
              className="referee-feedback referee-feedback-good"
              aria-label="Referee match results"
            >
              <h2>
                Match complete ·{' '}
                {frame.report.accuracy === null
                  ? 'No unaided decisions yet'
                  : `${frame.report.accuracy}% accuracy`}
              </h2>
              <p>
                {frame.report.correct} correct · {frame.report.wrong} wrong ·{' '}
                {frame.report.missed} missed · {frame.report.assisted} assisted
              </p>
              <p>
                Each situation counts once. Accuracy = correct ÷ (correct +
                wrong + missed). Hints are unlimited; assisted situations are
                listed separately.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs [&_th]:px-1 [&_td]:px-1">
                  <thead>
                    <tr>
                      <th className="w-[42%] py-2">Situation</th>
                      <th title="Correct decisions">OK</th>
                      <th>Wrong</th>
                      <th title="Missed decisions">Miss</th>
                      <th>Help</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frame.report.topics
                      .filter((t) => frame.topics.includes(t.id))
                      .map((t) => (
                        <tr key={t.id}>
                          <th className="py-2 pr-2 font-normal">{t.label}</th>
                          <td>{t.correct}</td>
                          <td>{t.wrong}</td>
                          <td>{t.missed}</td>
                          <td>{t.assisted}</td>
                          <td>{t.accuracy ?? '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p>
                Unseen situations have no percentage. A last-second incident
                without enough reaction time is excluded. Reasonable pushing /
                play-on judgments are supported.
              </p>
            </section>
          )}
          {frame.trainingMode === 'continuous' &&
            !frame.opening &&
            !frame.sessionFinished && (
              <p className="referee-assistance-note">
                Use Pause or Space to think; the clock and all motion freeze.
                You can start a visible count after one second of sustained
                little ball movement. Placement still needs the full count.
              </p>
            )}
          {!frame.opening && (
            <p className="referee-end-note">
              Blue → {frame.blueAttackDirection === 1 ? 'yellow' : 'blue'} goal
              · Yellow → {frame.blueAttackDirection === 1 ? 'blue' : 'yellow'}{' '}
              goal
            </p>
          )}

          <Button
            className="referee-replay-button"
            variant="outline"
            disabled={!ready || !frame.canReplayLast}
            onClick={() => {
              const recording = session.getLastReplay();
              if (recording) {
                setReplay(recording);
                seekReplay(0);
                setReplayRunning(true);
              }
            }}
          >
            <RotateCcw /> Replay last situation
          </Button>

          {frame.trainingMode === 'continuous' &&
            !frame.help &&
            !frame.opening &&
            !frame.sessionFinished && (
              <Button
                variant="outline"
                onClick={() => {
                  session.pauseForDecision();
                  session.whistle();
                  session.requestHint();
                  setRunning(false);
                  sync();
                }}
              >
                <Lightbulb /> Pause & get a hint
              </Button>
            )}
          {frame.help && !frame.opening && !frame.sessionFinished && (
            <section className="referee-help" aria-label="Decision help">
              <div className="referee-help-heading">
                <Lightbulb className="size-4" />
                <strong>{frame.help.title}</strong>
                <small>
                  Step {frame.help.step} / {frame.help.steps}
                </small>
              </div>
              <div className="referee-help-actions">
                <Button
                  variant="outline"
                  disabled={!ready || frame.resolving}
                  onClick={() => {
                    session.requestHint();
                    sync();
                  }}
                >
                  <Lightbulb /> {frame.help.level ? 'More help' : 'Hint'}
                </Button>
                <Button
                  variant="outline"
                  disabled={!ready || frame.resolving}
                  onClick={() => {
                    session.requestHint(true);
                    sync();
                  }}
                >
                  Show answer
                </Button>
                <Button
                  disabled={!ready || frame.resolving}
                  onClick={() => {
                    session.resolveForMe();
                    sync();
                    setRunning(session.canAdvance);
                  }}
                >
                  {frame.resolving ? 'Resolving…' : 'Resolve for me'}
                </Button>
              </div>
              {frame.resolving && (
                <output>
                  I’ll finish this situation’s decisions for you. Watching the
                  evidence or count…
                </output>
              )}
              {frame.help.level > 0 && (
                <div className="referee-hint-content" aria-live="polite">
                  <p>{frame.help.clue}</p>
                  <a
                    href={frame.help.rule}
                    onClick={(event) => {
                      if (
                        onOpenRule &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.shiftKey
                      ) {
                        event.preventDefault();
                        pause();
                        onOpenRule(
                          'soccer:' + new URL(frame.help!.rule).hash.slice(1),
                        );
                      }
                    }}
                  >
                    Read the relevant rule <ExternalLink className="size-3" />
                  </a>
                  {frame.help.level >= 2 && <p>{frame.help.explanation}</p>}
                  {frame.help.level >= 3 &&
                    frame.help.choices.map((choice, i) => (
                      <Button
                        key={`${choice.action}:${choice.target}`}
                        variant="outline"
                        disabled={blocked || frame.resolving}
                        onClick={() => submit(choice)}
                      >
                        {i > 0 ? 'Or: ' : ''}
                        {choice.label}
                      </Button>
                    ))}
                </div>
              )}
            </section>
          )}

          {((frame.drillReady && canNext) ||
            frame.canArrangeKickoff ||
            frame.kickoffReturns.length > 0) && (
            <section className="referee-checkpoint" aria-live="polite">
              <h2>
                {frame.kickoffReturns.length > 0
                  ? 'Return ready robots before kickoff'
                  : frame.canArrangeKickoff
                    ? 'Kickoff needs your signal'
                    : 'Next practice situation is ready'}
              </h2>
              <p>
                {frame.kickoffReturns.length > 0
                  ? 'Use Return in Off the field for each eligible robot. Then arrange the kickoff and give the start signal.'
                  : frame.canArrangeKickoff
                    ? 'Check any return requests, then arrange the kickoff. The field stays here until you press the button.'
                    : 'The match keeps playing. Start another situation when you want to load a new practice layout.'}
              </p>
              <Button
                disabled={!ready || frame.kickoffReturns.length > 0}
                onClick={() => {
                  if (frame.canArrangeKickoff) {
                    if (session.arrangeKickoff()) {
                      sync();
                      setRunning(false);
                      setGroup('restart');
                    }
                  } else startNext();
                }}
              >
                {frame.kickoffDue ? <Flag /> : <Shuffle />}
                {frame.kickoffDue
                  ? `Arrange ${frame.kickoffTeam} kickoff`
                  : 'Start next situation'}
              </Button>
            </section>
          )}

          {frame.canResumeEvidence && (
            <section className="referee-checkpoint">
              <h2>Observation paused</h2>
              <p>
                The scene is held at your whistle. Resume to continue observing
                from this exact point.
              </p>
              <Button
                variant="outline"
                disabled={!ready}
                onClick={() => {
                  if (session.resumeEvidence()) {
                    sync();
                    setRunning(true);
                  }
                }}
              >
                <Play /> Resume observation
              </Button>
            </section>
          )}

          {frame.feedback && !frame.sessionFinished && (
            <section
              className={cn(
                'referee-feedback',
                supported ? 'referee-feedback-good' : 'referee-feedback-retry',
              )}
              aria-live="polite"
            >
              <h2>
                {supported ? <Check /> : <Scale />}
                {frame.feedback.title}
              </h2>
              <p>{frame.feedback.detail}</p>
              <div>{frame.feedback.effect}</div>
              {supported && frame.feedback.appliedRules?.length > 0 ? (
                <div className="referee-applied-rules">
                  <h3>
                    <BookOpen className="size-4" /> Rules applied to this answer
                  </h3>
                  <ul>
                    {frame.feedback.appliedRules.map((rule) => (
                      <li key={rule.id}>
                        <small>
                          {rule.document} · §{rule.number}
                        </small>
                        <h4>{rule.provision}</h4>
                        <span>{rule.title}</span>
                        {rule.quote && <blockquote>“{rule.quote}”</blockquote>}
                        {rule.note && <p>{rule.note}</p>}
                        <div className="referee-rule-links">
                          <a
                            href={rule.lessonUrl}
                            onClick={(event) => {
                              if (
                                onOpenRule &&
                                !event.ctrlKey &&
                                !event.metaKey &&
                                !event.shiftKey
                              ) {
                                event.preventDefault();
                                pause();
                                onOpenRule(rule.sectionId);
                              }
                            }}
                          >
                            Open rule & situations{' '}
                            <BookOpen className="size-3" />
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <a
                  href={frame.feedback.rule}
                  onClick={(event) => {
                    if (
                      onOpenRule &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      pause();
                      onOpenRule(
                        'soccer:' + new URL(frame.feedback!.rule).hash.slice(1),
                      );
                    }
                  }}
                >
                  Read the official rule <ExternalLink className="size-3" />
                </a>
              )}
              <Button
                onClick={() => {
                  session.continue();
                  sync();
                  setRunning(session.canAdvance);
                }}
              >
                {frame.feedback.final
                  ? frame.trainingMode === 'continuous' && !frame.kickoffDue
                    ? 'Resume match'
                    : frame.pendingDecisions > 0
                      ? 'Next referee decision'
                      : frame.kickoffDue
                        ? 'Continue to kickoff'
                        : frame.motionHeld
                          ? 'Resume match'
                          : 'Dismiss feedback'
                  : supported
                    ? frame.count !== null
                      ? 'Resume count'
                      : 'Continue decision'
                    : 'Try again'}
                <ChevronRight />
              </Button>
            </section>
          )}

          <div className="referee-goals">
            <Button
              disabled={blocked}
              variant="outline"
              className="text-sky-300"
              onClick={() => submit({ action: 'goal', target: 'blue' })}
            >
              Blue goal +1
            </Button>
            <Button
              disabled={blocked}
              variant="outline"
              className="text-amber-300"
              onClick={() => submit({ action: 'goal', target: 'yellow' })}
            >
              Yellow goal +1
            </Button>
          </div>
          <div className="referee-target">
            <span>Robot for your call</span>
            <div>
              {MATCH_ROBOTS.map((robot) => (
                <Button
                  key={robot.id}
                  size="sm"
                  variant={target === robot.id ? 'secondary' : 'outline'}
                  aria-pressed={target === robot.id}
                  onClick={() => setTarget(robot.id)}
                  className={
                    robot.team === 'blue' ? 'text-sky-300' : 'text-amber-300'
                  }
                >
                  {robot.label}
                  {frame.bench.some((item) => item.robot === robot.id) && (
                    <small>OFF</small>
                  )}
                </Button>
              ))}
            </div>
          </div>
          <NativeSelect
            aria-label="Referee action category"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <NativeSelectOption value="common">Common calls</NativeSelectOption>
            <NativeSelectOption value="robot">
              Robot penalties & returns
            </NativeSelectOption>
            <NativeSelectOption value="restart">
              Restarts & other decisions
            </NativeSelectOption>
            <NativeSelectOption value="all">
              All referee actions
            </NativeSelectOption>
          </NativeSelect>
          <div className="referee-actions">
            {actions.map((action) => (
              <Button
                key={action.id}
                variant="outline"
                disabled={blocked}
                onClick={() =>
                  submit({
                    action: action.id,
                    ...(action.target ? { target } : {}),
                  })
                }
              >
                {action.label}
              </Button>
            ))}
          </div>

          {frame.bench.length > 0 && (
            <section className="referee-bench">
              <h2>Off the field</h2>
              {frame.bench.map((entry) => (
                <div key={entry.robot}>
                  <span>
                    <strong>
                      {
                        MATCH_ROBOTS.find((robot) => robot.id === entry.robot)
                          ?.label
                      }
                    </strong>
                    <small>
                      {entry.reason} · {entry.ready ? 'Ready' : 'Repairing'}
                    </small>
                  </span>
                  <output>
                    {entry.eligible
                      ? 'Eligible'
                      : `${Math.ceil(entry.remaining)} s`}
                  </output>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !ready ||
                      Boolean(replay) ||
                      frame.sessionFinished ||
                      Boolean(frame.opening) ||
                      frame.resolving
                    }
                    aria-label={`Return ${MATCH_ROBOTS.find((robot) => robot.id === entry.robot)?.label}`}
                    onClick={() =>
                      submit({ action: 'return', target: entry.robot })
                    }
                  >
                    Return
                  </Button>
                </div>
              ))}
              <p>
                Return needs your permission. Timers use simulated play time; a
                new kickoff can allow an earlier return.
              </p>
            </section>
          )}

          {frame.trainingMode === 'step' && (
            <details className="referee-details">
              <summary>Practice setup & coverage</summary>
              <p>
                The whole field pauses for every referee decision. AI play
                continues while the next drill is ready. Goals, kickoffs and
                official interruptions stop the game. Press Start next situation
                to load a practice layout. Each round includes every drill
                before repeating, with mirrored layouts and swapped teams.
                Evidence notes supply facts that motion alone cannot show.
              </p>
              <label htmlFor="referee-topic">Next situation</label>
              <NativeSelect
                id="referee-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                <NativeSelectOption value="random">
                  Random · full coverage
                </NativeSelectOption>
                {REFEREE_CASES.filter((item) =>
                  frame.topics.includes(trainingTopic(item)),
                ).map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                disabled={!canNext || !ready}
                onClick={startNext}
              >
                <Shuffle />
                Next situation
              </Button>
              {!canNext && (
                <small>
                  Finish the current decision and return waiting robots first.
                </small>
              )}
              <div className="referee-seed">
                <label htmlFor="referee-seed">Repeatable shuffle seed</label>
                <input
                  id="referee-seed"
                  type="number"
                  min="1"
                  max="4294967295"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    reset(
                      Math.min(
                        4294967295,
                        Math.max(1, Math.floor(Number(seed) || 1)),
                      ),
                    )
                  }
                >
                  Restart seed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reset(randomSeed())}
                >
                  New shuffle
                </Button>
              </div>
              <div className="referee-coverage">
                {REFEREE_FAMILIES.map((family) => {
                  const all = REFEREE_CASES.filter(
                    (item) => item.family === family,
                  );
                  const seen = all.filter((item) =>
                    frame.coverage.includes(item.id),
                  ).length;
                  return (
                    <div key={family}>
                      <span>
                        {family}
                        <small>
                          {seen} / {all.length}
                        </small>
                      </span>
                      <Progress
                        value={(seen / all.length) * 100}
                        aria-label={`${family} coverage`}
                      />
                    </div>
                  );
                })}
              </div>
              <p>
                This trainer covers the main Soccer match situations, with
                inspection prompts where needed. Physical judgment, event
                amendments and organizer decisions still require the official
                rules. It is not an automatic referee for real competitions.
              </p>
            </details>
          )}
          <details className="referee-details">
            <summary>Recent calls ({frame.history.length})</summary>
            {!frame.history.length && <p>Your decisions will appear here.</p>}
            {frame.history.slice(0, 12).map((item, index) => (
              <div key={index} className="referee-history">
                <strong>{item.call}</strong>
                <small>{item.verdict.replace('-', ' ')}</small>
                <p>{item.detail}</p>
              </div>
            ))}
          </details>
        </div>
      </aside>
    </div>
  );
}
