'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Gamepad2,
  Move3D,
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
import { moveManualActor, clonePoses } from '@/lib/simulator/manual-layout';
import type { Pose } from '@/lib/simulator/types';
import { SCENARIOS } from '@/lib/simulator/scenarios';
import {
  practiceLayout,
  preparePracticeMatch,
} from '@/lib/simulator/practice-layout';

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
  active: boolean;
  arrange: boolean;
  onArrangeChange: (value: boolean) => void;
  onReferee: () => void;
};

export function MatchPlay({
  robotVisual,
  onRobotVisualChange,
  active,
  arrange,
  onArrangeChange,
  onReferee,
}: Props) {
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
  const [editingId, setEditingId] = useState<string | null>('blue-1');
  const [showGeometry, setShowGeometry] = useState(true);
  const [layoutName, setLayoutName] = useState('match');
  const baseline = useRef<Record<string, Pose>>(clonePoses(frame.actors));
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
    baseline.current = clonePoses(next.state.actors);
    setLayoutName('match');
    setEngine(next);
    setFrame(next.snapshot());
  }, [clearInput]);

  const toggleRunning = useCallback(() => {
    if (!ready) return;
    clearInput();
    if (arrange) onArrangeChange(false);
    const next = preparePracticeMatch(engine, settings.duration);
    if (next !== engine) {
      setEngine(next);
      setFrame(next.snapshot());
    }
    setRunning((value) => !value);
    focusField();
  }, [
    ready,
    arrange,
    onArrangeChange,
    clearInput,
    engine,
    focusField,
    settings.duration,
  ]);

  useEffect(() => {
    if (active && !arrange) return;
    clearInput();
    const update = requestAnimationFrame(() => {
      setRunning(false);
      if (!active) setReady(false);
    });
    return () => cancelAnimationFrame(update);
  }, [active, arrange, clearInput]);
  const editActor = useCallback(
    (id: string, position: { x: number; z: number }) => {
      if (!arrange) return;
      const pose = moveManualActor(
        MATCH_ACTORS,
        engine.state.actors,
        id,
        position,
      );
      if (!pose) return;
      engine.place({ ...engine.state.actors, [id]: pose });
      setFrame(engine.snapshot());
    },
    [arrange, engine],
  );
  const nudge = useCallback(
    (x: number, z: number) => {
      if (!editingId) return;
      const pose = engine.state.actors[editingId];
      if (pose) editActor(editingId, { x: pose.x + x, z: pose.z + z });
    },
    [editingId, engine, editActor],
  );
  const rotate = useCallback(
    (direction: number) => {
      if (!arrange || !editingId || editingId === 'ball') return;
      const pose = engine.state.actors[editingId];
      engine.place({
        ...engine.state.actors,
        [editingId]: { ...pose, yaw: pose.yaw + (direction * Math.PI) / 12 },
      });
      setFrame(engine.snapshot());
    },
    [arrange, editingId, engine],
  );
  const restoreLayout = useCallback(() => {
    engine.place(baseline.current);
    setFrame(engine.snapshot());
  }, [engine]);
  const editPose = editingId ? frame.actors[editingId] : null;
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
    if (!active || !running || arrange) return;
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
  }, [active, arrange, clearInput, dribble, engine, running, settings]);

  useEffect(() => {
    if (!active) return;
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
      if (arrange) {
        if (target?.closest('button, a')) return;
        const step = event.shiftKey ? 0.05 : 0.01;
        if (event.code.startsWith('Arrow')) {
          event.preventDefault();
          nudge(
            event.code === 'ArrowLeft'
              ? -step
              : event.code === 'ArrowRight'
                ? step
                : 0,
            event.code === 'ArrowUp'
              ? step
              : event.code === 'ArrowDown'
                ? -step
                : 0,
          );
        } else if (event.code === 'KeyQ') rotate(-1);
        else if (event.code === 'KeyE') rotate(1);
        else if (event.code === 'KeyR') restoreLayout();
        else if (event.code === 'Escape') setEditingId(null);
        return;
      }
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
    active,
    arrange,
    nudge,
    rotate,
    restoreLayout,
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
    if (!active) return;
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
  }, [active, camera, engine, frame, robotVisual, running, settings]);

  const heldButton = (code: string, label: string, icon: React.ReactNode) => (
    <Button
      variant="outline"
      className="drive-button"
      aria-label={label}
      title={label}
      disabled={!running || !manual || arrange}
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

  if (!active) return null;
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
          showRuleGeometry={arrange && showGeometry}
          showBallTrail={showTrail}
          showContactEvidence={false}
          ballTrail={engine.ballTrail()}
          phaseLabel={frame.message}
          robotVisual={robotVisual}
          selectedActorId={arrange ? editingId : manual ? selected.id : null}
          editable={arrange}
          motionStopped={!running || arrange}
          onActorSelect={setEditingId}
          onActorMove={editActor}
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
            {arrange
              ? 'Arrange robots and ball, then play from this layout'
              : manual
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
          <h1 className="text-xl font-semibold">Play & experiment</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Arrange the field, drive a robot, or let both teams play.
          </p>
          <Button
            className="mt-4 w-full"
            variant={arrange ? 'secondary' : 'outline'}
            aria-pressed={arrange}
            onClick={() => {
              clearInput();
              setRunning(false);
              if (!arrange) baseline.current = clonePoses(frame.actors);
              onArrangeChange(!arrange);
            }}
          >
            <Move3D />
            {arrange ? 'Finish arranging' : 'Arrange field'}
          </Button>
          {arrange && (
            <section
              className="practice-arrange"
              aria-label="Manual field arrangement"
            >
              <p>
                Drag a robot or the ball. Arrow keys move 1 cm; Shift moves 5
                cm. Q/E rotate.
              </p>
              <label>
                Starting layout
                <NativeSelect
                  value={layoutName}
                  onChange={(event) => {
                    const id = event.target.value;
                    setLayoutName(id);
                    const scenario = SCENARIOS.find((item) => item.id === id);
                    const poses = scenario
                      ? practiceLayout(scenario.sample(0).actors)
                      : new SoccerMatch().snapshot().actors;
                    engine.place(poses);
                    baseline.current = clonePoses(poses);
                    setFrame(engine.snapshot());
                  }}
                >
                  <NativeSelectOption value="match">
                    Match kickoff
                  </NativeSelectOption>
                  {SCENARIOS.map((item) => (
                    <NativeSelectOption value={item.id} key={item.id}>
                      {item.shortTitle}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label>
                Selected object
                <NativeSelect
                  value={editingId ?? ''}
                  onChange={(event) => setEditingId(event.target.value || null)}
                >
                  <NativeSelectOption value="">None</NativeSelectOption>
                  {MATCH_ACTORS.map((actor) => (
                    <NativeSelectOption key={actor.id} value={actor.id}>
                      {actor.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {editPose && editingId && (
                <div className="practice-coordinates">
                  {(['x', 'z'] as const).map((axis) => (
                    <label key={axis}>
                      {axis.toUpperCase()} (m)
                      <input
                        type="number"
                        step="0.01"
                        value={Number(editPose[axis].toFixed(3))}
                        onChange={(event) => {
                          const value = event.target.valueAsNumber;
                          if (Number.isFinite(value))
                            editActor(editingId, {
                              x: editPose.x,
                              z: editPose.z,
                              [axis]: value,
                            });
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              <div className="practice-nudges">
                <Button
                  variant="outline"
                  aria-label="Nudge left"
                  onClick={() => nudge(-0.01, 0)}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  variant="outline"
                  aria-label="Nudge forward"
                  onClick={() => nudge(0, 0.01)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="outline"
                  aria-label="Nudge backward"
                  onClick={() => nudge(0, -0.01)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="outline"
                  aria-label="Nudge right"
                  onClick={() => nudge(0.01, 0)}
                >
                  <ArrowRight />
                </Button>
                <Button
                  variant="outline"
                  aria-label="Rotate left 15 degrees"
                  onClick={() => rotate(-1)}
                >
                  <RotateCcw />
                </Button>
                <Button
                  variant="outline"
                  aria-label="Rotate right 15 degrees"
                  onClick={() => rotate(1)}
                >
                  <RotateCw />
                </Button>
              </div>
              <label className="match-toggle" htmlFor="practice-geometry">
                Show rule geometry
                <Switch
                  id="practice-geometry"
                  checked={showGeometry}
                  onCheckedChange={setShowGeometry}
                />
              </label>
              <Button variant="outline" onClick={restoreLayout}>
                <RotateCcw />
                Reset layout
              </Button>
            </section>
          )}
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
