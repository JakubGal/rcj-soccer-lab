'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  Flag,
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
import {
  REFEREE_ACTIONS,
  REFEREE_CASES,
  REFEREE_FAMILIES,
  type RefereeCall,
} from '@/lib/simulator/referee-cases';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
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
}: {
  robotVisual: RobotVisualId;
  onExit: () => void;
}) {
  const [session, setSession] = useState(() => new RefereeMatch(randomSeed()));
  const [frame, setFrame] = useState(() => session.snapshot());
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState('blue-1');
  const [camera, setCamera] = useState<CameraPreset>('overhead');
  const [speed, setSpeed] = useState(1);
  const [group, setGroup] = useState('common');
  const [topic, setTopic] = useState('random');
  const [seed, setSeed] = useState(String(session.seed));
  const field = useRef<HTMLElement>(null);
  const onReady = useCallback(() => setReady(true), []);
  const sync = useCallback(() => setFrame(session.snapshot()), [session]);
  const reset = useCallback((value: number) => {
    const next = new RefereeMatch(value);
    setSession(next);
    setFrame(next.snapshot());
    setSeed(String(value));
    setRunning(false);
  }, []);
  const whistle = useCallback(() => {
    session.whistle();
    sync();
  }, [session, sync]);
  const submit = (call: RefereeCall) => {
    session.submit(frame.decisionKey, call);
    sync();
  };

  useEffect(() => {
    if (!running) return;
    let raf = 0,
      previous = 0,
      accumulator = 0,
      publish = 0;
    const animate = (now: number) => {
      const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      previous = now;
      accumulator += delta * speed;
      publish += delta;
      while (accumulator >= MATCH_STEP) {
        session.step();
        accumulator -= MATCH_STEP;
      }
      if (publish >= 1 / 30) {
        sync();
        publish = 0;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [running, session, speed, sync]);

  useEffect(() => {
    const stop = () => setRunning(false);
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
        setRunning((value) => !value);
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
  }, [whistle]);

  useEffect(() => {
    const host = window as Window & { snapshot?: () => unknown };
    const snapshot = () => ({
      app: 'RCJ Soccer Lab',
      mode: 'play',
      referee: true,
      ...session.snapshot(),
      playing: running,
      speed,
      seed: session.seed,
      selectedActor: target,
    });
    host.snapshot = snapshot;
    return () => {
      if (host.snapshot === snapshot) delete host.snapshot;
    };
  }, [session, running, speed, target]);

  const canNext =
    frame.phase === 'live' && !frame.bench.length && !frame.kickoffDue;
  const blocked = !ready || frame.phase === 'feedback';
  const supported =
    frame.feedback && ['correct', 'supported'].includes(frame.feedback.verdict);
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
    const definition = REFEREE_CASES.find((item) => item.id === topic);
    if (definition ? session.beginCase(definition) : session.nextCase()) {
      sync();
      setRunning(true);
    }
  };

  return (
    <div className="match-workspace referee-workspace">
      <section
        ref={field}
        tabIndex={-1}
        className="viewport-panel match-field referee-field"
        aria-label="AI match for referee training"
      >
        <PlayCanvasViewport
          actors={MATCH_ACTORS}
          poses={frame.actors}
          actorHeights={frame.heights}
          cameraPreset={camera}
          showRuleGeometry
          showBallTrail
          showContactEvidence={false}
          ballTrail={session.match.ballTrail()}
          phaseLabel={frame.facts}
          robotVisual={robotVisual}
          selectedActorId={frame.actors[target] ? target : null}
          onReady={onReady}
        />
        <div
          className="match-scoreboard"
          aria-label={`Blue ${frame.score.blue}, Yellow ${frame.score.yellow}`}
        >
          <span className="text-sky-300">
            BLUE <strong>{frame.score.blue}</strong>
          </span>
          <div>
            <Timer className="size-3.5" />
            {clock(frame.elapsed)}
            <small>
              {frame.phase === 'live' && running
                ? 'AI vs AI'
                : frame.phase === 'decision'
                  ? 'YOUR CALL'
                  : frame.phase === 'feedback'
                    ? 'REVIEW'
                    : 'PRACTICE'}
            </small>
          </div>
          <span className="text-amber-300">
            <strong>{frame.score.yellow}</strong> YELLOW
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
        {frame.count !== null && (
          <output className="referee-count" aria-live="polite">
            <strong>{frame.count}</strong>Visible count · watch for progress
          </output>
        )}
        <div
          className={cn(
            'referee-observation',
            frame.phase === 'decision' && 'referee-observation-held',
          )}
        >
          <span>
            <Flag className="size-3.5" />
            {frame.phase === 'live'
              ? 'Live passage of play'
              : frame.phase === 'evidence'
                ? 'Watch the evidence'
                : frame.phase === 'feedback'
                  ? 'Decision review'
                  : 'Your decision'}
          </span>
          <p>{frame.facts}</p>
          {frame.phase === 'decision' && (
            <small>
              Training pause: the match and penalty clocks are held while you
              decide.
            </small>
          )}
        </div>
        {!ready && (
          <div className="renderer-loader">Loading referee field…</div>
        )}
        <div className="transport-panel referee-transport">
          <Button
            disabled={!ready || frame.phase === 'feedback'}
            onClick={() => {
              setRunning((value) => !value);
              field.current?.focus({ preventScroll: true });
            }}
          >
            {running ? <Pause /> : <Play />}
            {running ? 'Pause' : 'Run'}
          </Button>
          <Button variant="outline" disabled={blocked} onClick={whistle}>
            <Flag />
            Whistle <kbd>Space</kbd>
          </Button>
          <Button
            variant="ghost"
            disabled={!frame.canReplay}
            onClick={() => {
              if (session.replay()) {
                sync();
                setRunning(true);
              }
            }}
          >
            <RotateCcw />
            Replay
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
        </div>
      </section>

      <aside
        className="context-panel match-panel referee-panel"
        aria-label="Live referee console"
      >
        <div className="context-scroll">
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
                {frame.correct} / {frame.assessed}
              </strong>
              First-try decisions
            </span>
            <span>
              <strong>
                {frame.coverage.length} / {REFEREE_CASES.length}
              </strong>
              Different situations
            </span>
          </div>

          {frame.feedback && (
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
              <a href={frame.feedback.rule} target="_blank" rel="noreferrer">
                Read the official rule <ExternalLink className="size-3" />
              </a>
              <Button
                onClick={() => {
                  session.continue();
                  sync();
                  setRunning(true);
                }}
              >
                {frame.feedback.final
                  ? 'Continue match'
                  : supported
                    ? 'Continue decision'
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
                    disabled={blocked}
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

          <details className="referee-details">
            <summary>Practice setup & coverage</summary>
            <p>
              Live AI play alternates with shuffled drills. Each round includes
              every drill before repeating, with mirrored layouts and swapped
              teams. Evidence notes supply facts that motion alone cannot show.
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
              {REFEREE_CASES.map((item) => (
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
