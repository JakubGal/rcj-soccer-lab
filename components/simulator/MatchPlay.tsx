'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scale,
  Timer,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { PlayCanvasViewport, type CameraPreset } from './PlayCanvasViewport';
import {
  MATCH_ACTORS,
  MATCH_ROBOTS,
  MATCH_STEP,
  SoccerMatch,
  type MatchSettings,
  type MatchTeam,
  type TeamControl,
} from '@/lib/simulator/match';
import {
  ROBOT_VISUALS,
  isRobotVisualId,
  type RobotVisualId,
} from '@/lib/simulator/robot-models';
import { cn } from '@/lib/utils';
import { RefereePlay } from './RefereePlay';

const DRIVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyQ',
  'KeyE',
  'Space',
]);
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
type Props = {
  robotVisual: RobotVisualId;
  onRobotVisualChange: (value: RobotVisualId) => void;
};

export function MatchPlay({ robotVisual, onRobotVisualChange }: Props) {
  const [referee, setReferee] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() =>
      setReferee(
        new URLSearchParams(window.location.search).get('referee') === '1',
      ),
    );
    return () => cancelAnimationFrame(raf);
  }, []);
  const selectReferee = (enabled: boolean) => {
    setReferee(enabled);
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set('referee', '1');
    else url.searchParams.delete('referee');
    window.history.replaceState(null, '', url);
  };
  return referee ? (
    <RefereePlay
      robotVisual={robotVisual}
      onExit={() => selectReferee(false)}
    />
  ) : (
    <StandardMatchPlay
      robotVisual={robotVisual}
      onRobotVisualChange={onRobotVisualChange}
      onReferee={() => selectReferee(true)}
    />
  );
}

function StandardMatchPlay({
  robotVisual,
  onRobotVisualChange,
  onReferee,
}: Props & { onReferee: () => void }) {
  const [engine, setEngine] = useState(() => new SoccerMatch());
  const [frame, setFrame] = useState(() => engine.snapshot());
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<MatchSettings>({
    controls: { blue: 'manual', yellow: 'ai' },
    selectedRobot: 'blue-1',
    duration: 120,
  });
  const [camera, setCamera] = useState<CameraPreset>('overhead');
  const [dribble, setDribble] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [ready, setReady] = useState(false);
  const keyboard = useRef(new Set<string>());
  const pointers = useRef(new Map<number, string>());
  const fieldRef = useRef<HTMLElement>(null);
  const selected = MATCH_ROBOTS.find(
    (robot) => robot.id === settings.selectedRobot,
  )!;
  const manual = settings.controls[selected.team as MatchTeam] === 'manual';
  const onReady = useCallback(() => setReady(true), []);
  const clearInput = useCallback(() => {
    keyboard.current.clear();
    pointers.current.clear();
  }, []);
  const focusField = useCallback(
    () => fieldRef.current?.focus({ preventScroll: true }),
    [],
  );

  const reset = useCallback(() => {
    clearInput();
    setRunning(false);
    const next = new SoccerMatch();
    setEngine(next);
    setFrame(next.snapshot());
  }, [clearInput]);

  const toggleRunning = useCallback(() => {
    clearInput();
    if (engine.state.phase === 'finished') {
      const next = new SoccerMatch();
      setEngine(next);
      setFrame(next.snapshot());
    }
    setRunning((value) => !value);
    focusField();
  }, [clearInput, engine, focusField]);

  const selectRobot = useCallback(
    (id: string) => {
      clearInput();
      const robot = MATCH_ROBOTS.find((actor) => actor.id === id)!;
      setSettings((current) => ({
        ...current,
        selectedRobot: id,
        controls: { ...current.controls, [robot.team]: 'manual' },
      }));
      focusField();
    },
    [clearInput, focusField],
  );

  const setControl = (team: MatchTeam, control: TeamControl) => {
    clearInput();
    setSettings((current) => ({
      ...current,
      controls: { ...current.controls, [team]: control },
      selectedRobot: control === 'manual' ? `${team}-1` : current.selectedRobot,
    }));
  };

  const preset = (blue: TeamControl, yellow: TeamControl) => {
    clearInput();
    setSettings((current) => ({
      ...current,
      controls: { blue, yellow },
      selectedRobot: 'blue-1',
    }));
    focusField();
  };

  useEffect(() => {
    if (!running) return;
    let animationFrame = 0;
    let previous = 0;
    let accumulator = 0;
    let publishElapsed = 0;
    const animate = (now: number) => {
      const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      previous = now;
      accumulator += elapsed;
      publishElapsed += elapsed;
      const down = (code: string) =>
        keyboard.current.has(code) ||
        [...pointers.current.values()].includes(code);
      while (accumulator >= MATCH_STEP) {
        engine.step(settings, {
          forward:
            Number(down('KeyW') || down('ArrowUp')) -
            Number(down('KeyS') || down('ArrowDown')),
          strafe:
            Number(down('KeyD') || down('ArrowRight')) -
            Number(down('KeyA') || down('ArrowLeft')),
          turn: Number(down('KeyE')) - Number(down('KeyQ')),
          kick: down('Space'),
          dribble,
        });
        accumulator -= MATCH_STEP;
      }
      if (publishElapsed >= 1 / 30 || engine.state.phase === 'finished') {
        setFrame(engine.snapshot());
        publishElapsed = 0;
      }
      if (engine.state.phase === 'finished') {
        setRunning(false);
        clearInput();
        return;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      clearInput();
    };
  }, [clearInput, dribble, engine, running, settings]);

  useEffect(() => {
    const stop = () => {
      clearInput();
      setRunning(false);
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('input, select, textarea, [contenteditable="true"]') ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      if (event.code === 'Space' && target?.closest('button, a')) return;
      if (DRIVE_KEYS.has(event.code)) {
        event.preventDefault();
        if (running && manual) keyboard.current.add(event.code);
      } else if (!event.repeat && event.code === 'KeyP') {
        event.preventDefault();
        toggleRunning();
      } else if (!event.repeat && event.code === 'KeyR') {
        event.preventDefault();
        reset();
      } else if (!event.repeat && event.code === 'KeyC') {
        event.preventDefault();
        selectRobot(`${selected.team}-${selected.number === 1 ? 2 : 1}`);
      }
    };
    const keyup = (event: KeyboardEvent) => keyboard.current.delete(event.code);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInput();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [
    clearInput,
    manual,
    reset,
    running,
    selectRobot,
    selected.number,
    selected.team,
    toggleRunning,
  ]);

  useEffect(() => {
    const target = window as Window & { snapshot?: () => unknown };
    const snapshot = () => ({
      app: 'RCJ Soccer Lab',
      mode: 'play',
      physics: 'fixed-step-planar-match',
      ...engine.snapshot(),
      playing: running,
      controls: settings.controls,
      selectedActor: settings.selectedRobot,
      duration: settings.duration,
      camera,
      robotVisual,
    });
    target.snapshot = snapshot;
    return () => {
      if (target.snapshot === snapshot) delete target.snapshot;
    };
  }, [camera, engine, frame, robotVisual, running, settings]);

  const heldButton = (code: string, label: string, icon: React.ReactNode) => (
    <Button
      variant="outline"
      className="drive-button"
      aria-label={label}
      title={label}
      disabled={!running || !manual}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, code);
      }}
      onPointerUp={(event) => pointers.current.delete(event.pointerId)}
      onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
      onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          keyboard.current.add(code);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          keyboard.current.delete(code);
        }
      }}
      onBlur={() => keyboard.current.delete(code)}
    >
      {icon}
      <span>{code === 'Space' ? 'Kick' : code.slice(-1)}</span>
    </Button>
  );

  return (
    <div className="match-workspace">
      <section
        className="viewport-panel match-field"
        ref={fieldRef}
        tabIndex={-1}
        aria-label="Live match field and controls"
      >
        <PlayCanvasViewport
          actors={MATCH_ACTORS}
          poses={frame.actors}
          cameraPreset={camera}
          showRuleGeometry={false}
          showBallTrail={showTrail}
          showContactEvidence={false}
          ballTrail={engine.ballTrail()}
          phaseLabel={frame.message}
          robotVisual={robotVisual}
          selectedActorId={manual ? selected.id : null}
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
            <Timer className="size-3.5" aria-hidden="true" />
            {clock(settings.duration - frame.elapsed)}
            <small>
              {frame.phase === 'finished'
                ? 'FULL TIME'
                : running
                  ? '2 vs 2'
                  : 'PAUSED'}
            </small>
          </div>
          <span className="text-amber-300">
            <strong>{frame.score.yellow}</strong> YELLOW
          </span>
        </div>
        <div className="match-camera">
          <NativeSelect
            size="sm"
            value={camera}
            onChange={(event) => setCamera(event.target.value as CameraPreset)}
            aria-label="Match camera"
          >
            <NativeSelectOption value="overhead">Overhead</NativeSelectOption>
            <NativeSelectOption value="broadcast">Broadcast</NativeSelectOption>
            <NativeSelectOption value="ball">Follow ball</NativeSelectOption>
            <NativeSelectOption value="blue">Blue robot</NativeSelectOption>
            <NativeSelectOption value="yellow">Yellow robot</NativeSelectOption>
            <NativeSelectOption value="free">Free orbit</NativeSelectOption>
          </NativeSelect>
        </div>
        <output className="match-event">{frame.message}</output>
        {!ready && <div className="renderer-loader">Loading match field…</div>}
        <div className="transport-panel match-transport">
          <Button
            onClick={toggleRunning}
            disabled={!ready}
            className="match-start"
          >
            {running ? <Pause /> : <Play />}
            {running
              ? 'Pause'
              : frame.phase === 'finished'
                ? 'Play again'
                : frame.elapsed === 0
                  ? 'Start match'
                  : 'Resume'}
          </Button>
          <Button variant="outline" onClick={reset} aria-label="Reset match">
            <RotateCcw />
            <span className="hidden sm:inline">Reset</span>
          </Button>
          <span>
            {manual
              ? `Driving ${selected.label} · C switches teammate`
              : 'Autonomous match · Pick a robot to take control'}
          </span>
        </div>
      </section>

      <aside
        className="context-panel match-panel"
        aria-label="Match setup and robot controls"
      >
        <div className="context-scroll">
          <h1 className="text-xl font-semibold">Play a match</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Drive a robot or let both teams play.
          </p>
          <div className="match-presets">
            <Button size="sm" onClick={onReferee}>
              <Scale />
              Referee AI match
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => preset('manual', 'ai')}
            >
              <Gamepad2 />
              You vs AI
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => preset('ai', 'ai')}
            >
              <Bot />
              AI vs AI
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => preset('manual', 'off')}
            >
              Free practice
            </Button>
          </div>
          <div className="match-team-settings">
            {(['blue', 'yellow'] as const).map((team) => (
              <label
                key={team}
                htmlFor={`match-control-${team}`}
                className="match-setting"
              >
                <span
                  className={
                    team === 'blue' ? 'text-sky-300' : 'text-amber-300'
                  }
                >
                  {team === 'blue' ? 'Blue team' : 'Yellow team'}
                </span>
                <NativeSelect
                  id={`match-control-${team}`}
                  value={settings.controls[team]}
                  onChange={(event) =>
                    setControl(team, event.target.value as TeamControl)
                  }
                  aria-label={`${team === 'blue' ? 'Blue' : 'Yellow'} team control`}
                >
                  <NativeSelectOption value="manual">
                    Manual + AI teammate
                  </NativeSelectOption>
                  <NativeSelectOption value="ai">Autonomous</NativeSelectOption>
                  <NativeSelectOption value="off">
                    Stationary
                  </NativeSelectOption>
                </NativeSelect>
              </label>
            ))}
            <label className="match-setting" htmlFor="match-length">
              <span>Match length</span>
              <NativeSelect
                id="match-length"
                value={settings.duration}
                onChange={(event) => {
                  setSettings((current) => ({
                    ...current,
                    duration: Number(event.target.value),
                  }));
                  reset();
                }}
                aria-label="Match length"
              >
                <NativeSelectOption value={60}>1 minute</NativeSelectOption>
                <NativeSelectOption value={120}>2 minutes</NativeSelectOption>
                <NativeSelectOption value={300}>5 minutes</NativeSelectOption>
              </NativeSelect>
            </label>
          </div>

          <div className="section-divider" />
          <h2 className="text-sm font-semibold">Robot controls</h2>
          <div className="match-robot-grid">
            {MATCH_ROBOTS.map((robot) => (
              <Button
                key={robot.id}
                variant="outline"
                aria-pressed={manual && selected.id === robot.id}
                onClick={() => selectRobot(robot.id)}
                className={cn(
                  'match-robot',
                  robot.team === 'blue' ? 'text-sky-300' : 'text-amber-300',
                  manual && selected.id === robot.id && 'match-robot-active',
                )}
              >
                <span
                  className={cn(
                    'size-2 rounded-full',
                    robot.team === 'blue' ? 'bg-sky-400' : 'bg-amber-300',
                  )}
                />
                {robot.label}
              </Button>
            ))}
          </div>
          <p className="match-hint">
            {manual
              ? `${selected.label} is yours. Its teammate defends.`
              : 'Pick a robot to switch its team to manual.'}
          </p>
          <div className="drive-pad">
            {heldButton('KeyQ', 'Turn left (Q)', <RotateCcw />)}
            {heldButton('KeyW', 'Drive forward (W or Up)', <ArrowUp />)}
            {heldButton('KeyE', 'Turn right (E)', <RotateCw />)}
            {heldButton('KeyA', 'Strafe left (A or Left)', <ArrowLeft />)}
            {heldButton('KeyS', 'Drive backward (S or Down)', <ArrowDown />)}
            {heldButton('KeyD', 'Strafe right (D or Right)', <ArrowRight />)}
            {heldButton('Space', 'Kick ball (Space)', <Zap />)}
          </div>
          <p className="match-hint">
            Hold WASD / arrows to drive relative to the robot. Q / E turns;
            Space kicks a ball in front. P pauses, R resets.
          </p>
          <label className="match-toggle" htmlFor="match-dribbler">
            <span>Manual robot dribbler</span>
            <Switch
              id="match-dribbler"
              checked={dribble}
              onCheckedChange={setDribble}
            />
          </label>
          <label className="match-toggle" htmlFor="match-trail">
            <span>Ball trail</span>
            <Switch
              id="match-trail"
              checked={showTrail}
              onCheckedChange={setShowTrail}
            />
          </label>
          <label className="match-setting mt-4" htmlFor="match-design">
            <span>Robot design</span>
            <NativeSelect
              id="match-design"
              value={robotVisual}
              aria-label="Match robot design"
              onChange={(event) => {
                if (isRobotVisualId(event.target.value))
                  onRobotVisualChange(event.target.value);
              }}
            >
              {ROBOT_VISUALS.map((visual) => (
                <NativeSelectOption key={visual.id} value={visual.id}>
                  {visual.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <p className="match-hint mt-5">
            Practice simulation with robot and ball collisions. Goals count at
            the back wall; kickoffs restart automatically. Stalled AI play
            resets after 8 seconds. Use Referee AI match to judge randomized
            incidents and control penalties, goals and restarts.
          </p>
        </div>
      </aside>
    </div>
  );
}
