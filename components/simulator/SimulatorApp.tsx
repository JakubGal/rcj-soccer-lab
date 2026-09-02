'use client';

import {
  AlertTriangle,
  BookOpen,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Code2,
  Eye,
  Gauge,
  GraduationCap,
  Layers3,
  Pause,
  Play,
  RefreshCcw,
  Scale,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  PlayCanvasViewport,
  type CameraPreset,
} from '@/components/simulator/PlayCanvasViewport';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { getScenario, SCENARIOS } from '@/lib/simulator/scenarios';
import type {
  RcjJoltWorld,
  RcjPhysicsSnapshot,
} from '@/lib/simulator/jolt-world';
import type {
  RefereeChoice,
  ScenarioDefinition,
  SimulatorMode,
} from '@/lib/simulator/types';

const CAMERA_OPTIONS: Array<{ value: CameraPreset; label: string }> = [
  { value: 'broadcast', label: 'Broadcast' },
  { value: 'referee', label: 'Referee sideline' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'ball', label: 'Follow ball' },
  { value: 'blue', label: 'Blue robot' },
  { value: 'yellow', label: 'Yellow robot' },
  { value: 'free', label: 'Free orbit' },
];

const SPEEDS = [0.5, 1, 2] as const;

type PhysicsStatus = 'loading' | 'ready' | 'fallback';

type SnapshotWindow = Window & {
  snapshot?: () => unknown;
};

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function normalizeCamera(
  camera: ScenarioDefinition['defaultCamera'],
): CameraPreset {
  if (camera === 'blue-robot') return 'blue';
  if (camera === 'yellow-robot') return 'yellow';
  return camera ?? 'broadcast';
}

function modeIcon(mode: SimulatorMode) {
  if (mode === 'explore') return Eye;
  if (mode === 'referee') return Scale;
  return GraduationCap;
}

function gradePresentation(grade: RefereeChoice['grade']) {
  if (grade === 'correct') {
    return {
      label: 'Correct',
      className: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
      Icon: CheckCircle2,
    };
  }
  if (grade === 'acceptable') {
    return {
      label: 'Acceptable discretion',
      className: 'text-sky-300 border-sky-400/30 bg-sky-400/10',
      Icon: CheckCircle2,
    };
  }
  if (grade === 'partial') {
    return {
      label: 'Partly correct',
      className: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
      Icon: AlertTriangle,
    };
  }
  return {
    label: 'Incorrect',
    className: 'text-red-300 border-red-400/30 bg-red-400/10',
    Icon: XCircle,
  };
}

function MetricStatus({
  status,
}: {
  status: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <span
      className={cn(
        'size-1.5 rounded-full',
        status === 'good' && 'bg-emerald-400',
        status === 'warn' && 'bg-amber-400',
        status === 'bad' && 'bg-red-400',
        status === 'neutral' && 'bg-slate-500',
      )}
      aria-hidden="true"
    />
  );
}

export function SimulatorApp() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [mode, setMode] = useState<SimulatorMode>('learn');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('broadcast');
  const [showRuleGeometry, setShowRuleGeometry] = useState(true);
  const [showBallTrail, setShowBallTrail] = useState(true);
  const [showContactEvidence, setShowContactEvidence] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isEmbed, setIsEmbed] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [physicsStatus, setPhysicsStatus] = useState<PhysicsStatus>('loading');
  const [physicsSnapshot, setPhysicsSnapshot] =
    useState<RcjPhysicsSnapshot | null>(null);
  const previousFrameRef = useRef<number | null>(null);
  const physicsWorldRef = useRef<RcjJoltWorld | null>(null);

  const scenario = useMemo(() => getScenario(scenarioId), [scenarioId]);
  const authoredFrame = useMemo(() => scenario.sample(time), [scenario, time]);
  const frame = useMemo(() => {
    if (
      scenario.id !== 'legal-dribbler-backspin' ||
      !physicsSnapshot ||
      time >= 7.15
    ) {
      return authoredFrame;
    }

    const robotPose = authoredFrame.actors['blue-1'];
    if (!robotPose) return authoredFrame;
    const relativeX =
      physicsSnapshot.ball.position.x - physicsSnapshot.robot.position.x;
    const relativeZ =
      physicsSnapshot.ball.position.z - physicsSnapshot.robot.position.z;
    const cosine = Math.cos(robotPose.yaw);
    const sine = Math.sin(robotPose.yaw);
    const physicalBallPose = {
      x: robotPose.x + relativeX * cosine + relativeZ * sine,
      z: robotPose.z - relativeX * sine + relativeZ * cosine,
      yaw:
        physicsSnapshot.simulationTime *
        physicsSnapshot.dribbler.ballBackspinRadPerSec,
    };
    const withinLimit = physicsSnapshot.dribbler.within15MmCaptureLimit;
    const hasBackspin =
      Math.abs(physicsSnapshot.dribbler.ballBackspinRadPerSec) > 2;

    return {
      ...authoredFrame,
      actors: {
        ...authoredFrame.actors,
        ball: physicalBallPose,
      },
      metrics: {
        ...authoredFrame.metrics,
        roller: {
          label: 'Powered roller',
          value: `${physicsSnapshot.dribbler.surfaceSpeedMps.toFixed(1)} m/s · Jolt`,
          status: 'neutral' as const,
        },
        capture: {
          label: 'Capture depth',
          value: `${physicsSnapshot.dribbler.captureDepthMm.toFixed(1)} mm`,
          status: withinLimit ? ('good' as const) : ('bad' as const),
        },
        spin: {
          label: 'Ball backspin',
          value: `${physicsSnapshot.dribbler.ballBackspinRadPerSec.toFixed(1)} rad/s`,
          status: hasBackspin ? ('good' as const) : ('warn' as const),
        },
      },
      evidence: [
        'FACT — A 120 Hz Jolt contact model is driving the ball/roller relationship.',
        ...authoredFrame.evidence,
      ],
    };
  }, [authoredFrame, physicsSnapshot, scenario.id, time]);
  const selectedChoice = useMemo(
    () =>
      scenario.choices.find((choice) => choice.id === answers[scenario.id]) ??
      null,
    [answers, scenario],
  );

  const sessionResults = useMemo(
    () =>
      Object.entries(answers)
        .map(([id, answerId]) =>
          getScenario(id).choices.find((choice) => choice.id === answerId),
        )
        .filter((choice): choice is RefereeChoice => Boolean(choice)),
    [answers],
  );
  const sessionScore = sessionResults.length
    ? Math.round(
        (sessionResults.reduce((sum, result) => sum + result.score, 0) /
          sessionResults.length) *
          100,
      )
    : 0;

  const reset = useCallback(() => {
    setPlaying(false);
    setTime(0);
    previousFrameRef.current = null;
    const world = physicsWorldRef.current;
    if (world) setPhysicsSnapshot(world.resetDribblerDemo());
  }, []);

  const selectScenario = useCallback((id: string) => {
    const nextScenario = getScenario(id);
    setScenarioId(id);
    setPlaying(false);
    setTime(0);
    setCameraPreset(normalizeCamera(nextScenario.defaultCamera));
    setShowContactEvidence(false);
    previousFrameRef.current = null;
    const world = physicsWorldRef.current;
    if (world) setPhysicsSnapshot(world.resetDribblerDemo());
  }, []);

  const handleRendererReady = useCallback(() => {
    setRendererReady(true);
  }, []);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const query = new URLSearchParams(window.location.search);
      const embeddedScenario = query.get('embed');
      if (
        embeddedScenario &&
        SCENARIOS.some((item) => item.id === embeddedScenario)
      ) {
        setScenarioId(embeddedScenario);
        setCameraPreset(
          normalizeCamera(getScenario(embeddedScenario).defaultCamera),
        );
        setIsEmbed(true);
        setMode('learn');
      }
      const queryMode = query.get('mode');
      if (
        queryMode === 'explore' ||
        queryMode === 'learn' ||
        queryMode === 'referee'
      ) {
        setMode(queryMode);
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    import('@/lib/simulator/jolt-world')
      .then(async (physics) => {
        const world = await physics.createRcjJoltWorld();
        if (cancelled) {
          world.dispose();
          return;
        }
        physicsWorldRef.current = world;
        setPhysicsSnapshot(world.resetDribblerDemo());
        setPhysicsStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setPhysicsStatus('fallback');
      });
    return () => {
      cancelled = true;
      physicsWorldRef.current?.dispose();
      physicsWorldRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!playing) {
      previousFrameRef.current = null;
      return;
    }
    let animationFrame = 0;
    const animate = (now: number) => {
      const previous = previousFrameRef.current ?? now;
      previousFrameRef.current = now;
      const delta = Math.min((now - previous) / 1000, 0.08) * speed;
      if (
        scenario.id === 'legal-dribbler-backspin' &&
        physicsWorldRef.current
      ) {
        setPhysicsSnapshot(physicsWorldRef.current.step(delta));
      }
      setTime((current) => {
        const next = current + delta;
        if (next >= scenario.duration) {
          setPlaying(false);
          previousFrameRef.current = null;
          return scenario.duration;
        }
        return next;
      });
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [playing, scenario.duration, scenario.id, speed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea, button')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (time >= scenario.duration) setTime(0);
        setPlaying((value) => !value);
      } else if (event.key.toLowerCase() === 'r') {
        reset();
      } else if (/^[1-7]$/.test(event.key)) {
        setCameraPreset(CAMERA_OPTIONS[Number(event.key) - 1].value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reset, scenario.duration, time]);

  const ballTrail = useMemo(() => {
    const ball = scenario.actors.find((actor) => actor.kind === 'ball');
    if (!ball) return [];
    const length = Math.min(time, 2.8);
    return Array.from({ length: 30 }, (_, index) => {
      const sampleTime = Math.max(0, time - length + (length * index) / 29);
      return scenario.sample(sampleTime).actors[ball.id];
    }).filter(Boolean);
  }, [scenario, time]);

  useEffect(() => {
    const snapshotWindow = window as SnapshotWindow;
    snapshotWindow.snapshot = () => ({
      app: 'RCJ Soccer Lab',
      mode,
      scenario: scenario.id,
      title: scenario.title,
      time: Number(time.toFixed(3)),
      playing,
      speed,
      camera: cameraPreset,
      phase: frame.phaseLabel,
      physics: physicsStatus,
      actors: frame.actors,
      metrics: frame.metrics,
      answer: selectedChoice
        ? {
            id: selectedChoice.id,
            grade: selectedChoice.grade,
            score: selectedChoice.score,
          }
        : null,
    });
    return () => {
      delete snapshotWindow.snapshot;
    };
  }, [
    cameraPreset,
    frame,
    mode,
    physicsStatus,
    playing,
    scenario,
    selectedChoice,
    speed,
    time,
  ]);

  const chooseAnswer = (choice: RefereeChoice) => {
    setAnswers((current) => ({ ...current, [scenario.id]: choice.id }));
    setPlaying(false);
  };

  const showNextScenario = () => {
    const index = SCENARIOS.findIndex((item) => item.id === scenario.id);
    selectScenario(SCENARIOS[(index + 1) % SCENARIOS.length].id);
  };

  const copyEmbed = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('embed', scenario.id);
    const snippet = `<iframe src="${url.toString()}" title="${scenario.title} — RCJ Soccer Lab" loading="lazy" allowfullscreen></iframe>`;
    await navigator.clipboard.writeText(snippet);
    setEmbedCopied(true);
    window.setTimeout(() => setEmbedCopied(false), 1800);
  };

  const physicsLabel =
    physicsStatus === 'ready'
      ? 'Jolt · 120 Hz'
      : physicsStatus === 'loading'
        ? 'Physics loading'
        : 'Replay fallback';

  if (isEmbed) {
    return (
      <main className="embed-shell">
        <div className="embed-toolbar">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sky-400 text-[#071016]">
              <CircleDot className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{scenario.title}</p>
              <p className="truncate text-[10px] text-white/45">
                {scenario.ruleRef.section} · interactive rule example
              </p>
            </div>
          </div>
          <a
            href="/"
            target="_blank"
            className="text-[11px] text-sky-300 hover:text-sky-200"
          >
            Open lab ↗
          </a>
        </div>
        <section className="relative min-h-0 flex-1">
          <PlayCanvasViewport
            actors={scenario.actors}
            poses={frame.actors}
            cameraPreset={cameraPreset}
            showRuleGeometry={showRuleGeometry}
            showBallTrail={showBallTrail}
            showContactEvidence={showContactEvidence}
            ballTrail={ballTrail}
            phaseLabel={frame.phaseLabel}
          />
          <div className="viewport-chip left-3 top-3">{frame.phaseLabel}</div>
          <div className="viewport-chip right-3 top-3">
            Drag · orbit / Wheel · zoom
          </div>
        </section>
        <div className="embed-transport">
          <Button
            size="icon-sm"
            variant="secondary"
            onClick={() => {
              if (time >= scenario.duration) setTime(0);
              setPlaying((value) => !value);
            }}
            aria-label={playing ? 'Pause scenario' : 'Play scenario'}
          >
            {playing ? <Pause /> : <Play className="fill-current" />}
          </Button>
          <Slider
            value={[time]}
            min={0}
            max={scenario.duration}
            step={0.01}
            onValueChange={(value) => {
              setPlaying(false);
              setTime(typeof value === 'number' ? value : (value[0] ?? 0));
            }}
            aria-label="Scenario timeline"
            className="flex-1"
          />
          <span className="w-24 text-right font-mono text-[11px] text-white/55">
            {formatClock(time)} / {formatClock(scenario.duration)}
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="simulator-app">
      <header className="app-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="brand-mark">
            <CircleDot className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              RCJ Soccer Lab
            </p>
            <p className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              2026 interactive rules
            </p>
          </div>
        </div>

        <nav className="mode-switcher" aria-label="Simulator mode">
          {(['explore', 'learn', 'referee'] as SimulatorMode[]).map((item) => {
            const Icon = modeIcon(item);
            return (
              <Button
                key={item}
                size="sm"
                variant={mode === item ? 'secondary' : 'ghost'}
                onClick={() => setMode(item)}
                aria-pressed={mode === item}
                className="capitalize"
              >
                <Icon aria-hidden="true" />
                <span className="hidden sm:inline">{item}</span>
              </Button>
            );
          })}
        </nav>

        <div className="flex items-center justify-end gap-2">
          {mode === 'referee' ? (
            <Badge
              variant="outline"
              className="hidden border-sky-400/25 bg-sky-400/8 text-sky-300 sm:flex"
            >
              Score {sessionScore}%
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={copyEmbed}>
            {embedCopied ? <Check /> : <Code2 />}
            <span className="hidden md:inline">
              {embedCopied ? 'Copied' : 'Embed'}
            </span>
          </Button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="scenario-rail" aria-label="Situation library">
          <div className="rail-heading">
            <BookOpen className="size-3.5" aria-hidden="true" />
            Situation library
            <span className="ml-auto font-mono text-[10px] text-white/35">
              {SCENARIOS.length}
            </span>
          </div>
          <div className="scenario-list">
            {SCENARIOS.map((item, index) => {
              const active = item.id === scenario.id;
              const answered = answers[item.id];
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => selectScenario(item.id)}
                  className={cn(
                    'scenario-card',
                    active && 'scenario-card-active',
                  )}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="scenario-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {item.shortTitle}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                      {item.category.replace('-', ' ')} · {item.ruleRef.section}
                    </span>
                  </span>
                  {answered ? (
                    <CheckCircle2
                      className="size-3.5 text-emerald-400"
                      aria-label="Answered"
                    />
                  ) : (
                    <ChevronRight
                      className="size-3.5 text-white/25"
                      aria-hidden="true"
                    />
                  )}
                </Button>
              );
            })}
          </div>

          <div className="rail-footer">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Lesson progress</span>
              <span className="font-mono">
                {Object.keys(answers).length}/{SCENARIOS.length}
              </span>
            </div>
            <Progress
              value={(Object.keys(answers).length / SCENARIOS.length) * 100}
              className="mt-2 h-1"
            />
          </div>
        </aside>

        <section className="viewport-panel" aria-label="3D situation viewer">
          <div className="viewport-toolbar">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-white/10 bg-black/35 text-white/70 backdrop-blur-md"
              >
                <Box className="size-3" aria-hidden="true" />
                Live 3D
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'border-white/10 bg-black/35 text-white/60 backdrop-blur-md',
                  physicsStatus === 'ready' && 'text-emerald-300',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full bg-amber-300',
                    physicsStatus === 'ready' && 'bg-emerald-400',
                  )}
                />
                {physicsLabel}
              </Badge>
            </div>
            <NativeSelect
              size="sm"
              value={cameraPreset}
              onChange={(event) =>
                setCameraPreset(event.target.value as CameraPreset)
              }
              aria-label="Camera preset"
              className="camera-select"
            >
              {CAMERA_OPTIONS.map((camera) => (
                <NativeSelectOption key={camera.value} value={camera.value}>
                  {camera.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <PlayCanvasViewport
            actors={scenario.actors}
            poses={frame.actors}
            cameraPreset={cameraPreset}
            showRuleGeometry={showRuleGeometry}
            showBallTrail={showBallTrail}
            showContactEvidence={showContactEvidence}
            ballTrail={ballTrail}
            phaseLabel={frame.phaseLabel}
            onReady={handleRendererReady}
          />

          <div className="viewport-phase">
            <span className="phase-pulse" aria-hidden="true" />
            <span>{frame.phaseLabel}</span>
          </div>
          <div className="viewport-help">
            Drag to orbit · wheel to zoom · keys 1–7 cameras
          </div>
          {!rendererReady ? (
            <div className="renderer-loader">Preparing field…</div>
          ) : null}

          <div className="transport-panel">
            <div className="flex items-center gap-2">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={reset}
                aria-label="Reset scenario"
              >
                <RefreshCcw />
              </Button>
              <Button
                size="icon"
                onClick={() => {
                  if (time >= scenario.duration) setTime(0);
                  setPlaying((value) => !value);
                }}
                aria-label={playing ? 'Pause scenario' : 'Play scenario'}
                className="bg-white text-[#071016] hover:bg-white/90"
              >
                {playing ? <Pause /> : <Play className="fill-current" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const index = SPEEDS.indexOf(speed);
                  setSpeed(SPEEDS[(index + 1) % SPEEDS.length]);
                }}
                aria-label={`Playback speed ${speed} times. Activate to change.`}
                className="w-12 font-mono text-xs"
              >
                {speed}×
              </Button>
            </div>
            <div className="min-w-0 flex-1">
              <Slider
                value={[time]}
                min={0}
                max={scenario.duration}
                step={0.01}
                onValueChange={(value) => {
                  setPlaying(false);
                  setTime(typeof value === 'number' ? value : (value[0] ?? 0));
                }}
                aria-label="Scenario timeline"
              />
              <div className="mt-1.5 flex justify-between font-mono text-[9px] text-white/35">
                <span>OBSERVE</span>
                <span>CONTACT</span>
                <span>DECIDE</span>
              </div>
            </div>
            <span className="w-[116px] text-right font-mono text-[11px] text-white/55">
              {formatClock(time)} / {formatClock(scenario.duration)}
            </span>
          </div>
        </section>

        <aside className="context-panel">
          <div className="context-scroll">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">
                  {mode === 'referee'
                    ? 'Referee decision'
                    : mode === 'explore'
                      ? 'Scenario controls'
                      : 'Rule context'}
                </p>
                <h1 className="mt-2 text-xl font-semibold tracking-tight">
                  {scenario.title}
                </h1>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 border-sky-400/25 text-sky-300"
              >
                {scenario.ruleRef.section}
              </Badge>
            </div>

            {mode === 'learn' ? (
              <>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {scenario.publicSummary}
                </p>
                <div className="section-divider" />
                <div className="flex items-center gap-2">
                  <Gauge className="size-4 text-sky-400" aria-hidden="true" />
                  <h2 className="panel-title">Live evidence</h2>
                </div>
                <div className="mt-3 space-y-2">
                  {Object.entries(frame.metrics).map(([id, metric]) => (
                    <div key={id} className="metric-row">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <MetricStatus status={metric.status} />
                        {metric.label}
                      </span>
                      <span className="font-mono text-[12px] text-foreground">
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="evidence-card">
                  <p className="flex items-center gap-2 text-[11px] font-medium text-amber-200">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    What to notice
                  </p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-5 text-amber-50/65">
                    {frame.evidence.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}

            {mode === 'explore' ? (
              <>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  Scrub the event, move around the field, and isolate the
                  evidence a referee can actually observe.
                </p>
                <div className="section-divider" />
                <h2 className="panel-title flex items-center gap-2">
                  <Layers3 className="size-4 text-sky-400" /> Evidence layers
                </h2>
                <div className="mt-3 space-y-2">
                  <div className="toggle-row">
                    <label htmlFor="rule-geometry">
                      <strong>Rule geometry</strong>
                      <small>Penalty areas and 15 mm plane</small>
                    </label>
                    <Switch
                      id="rule-geometry"
                      checked={showRuleGeometry}
                      onCheckedChange={setShowRuleGeometry}
                    />
                  </div>
                  <div className="toggle-row">
                    <label htmlFor="ball-path">
                      <strong>Ball path</strong>
                      <small>Recent trajectory samples</small>
                    </label>
                    <Switch
                      id="ball-path"
                      checked={showBallTrail}
                      onCheckedChange={setShowBallTrail}
                    />
                  </div>
                  <div className="toggle-row">
                    <label htmlFor="contact-evidence">
                      <strong>Contact evidence</strong>
                      <small>Highlight current ball contact</small>
                    </label>
                    <Switch
                      id="contact-evidence"
                      checked={showContactEvidence}
                      onCheckedChange={setShowContactEvidence}
                    />
                  </div>
                </div>
                <div className="section-divider" />
                <h2 className="panel-title flex items-center gap-2">
                  <Target className="size-4 text-sky-400" /> Observations
                </h2>
                <div className="mt-3 space-y-2">
                  {Object.entries(frame.metrics).map(([id, metric]) => (
                    <div key={id} className="metric-row">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <MetricStatus status={metric.status} />
                        {metric.label}
                      </span>
                      <span className="font-mono text-[12px]">
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {mode === 'referee' ? (
              <>
                <div className="decision-prompt">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-400/12 text-sky-300">
                    <Scale className="size-4" />
                  </span>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-300">
                      Your call
                    </p>
                    <p className="mt-1 text-sm leading-5 text-foreground">
                      {scenario.refereeCue}
                    </p>
                  </div>
                </div>
                <fieldset className="mt-3 space-y-2">
                  <legend className="sr-only">Referee decision choices</legend>
                  {scenario.choices.map((choice, index) => (
                    <Button
                      key={choice.id}
                      variant="outline"
                      className={cn(
                        'decision-button',
                        selectedChoice?.id === choice.id &&
                          'border-sky-400/50 bg-sky-400/10',
                      )}
                      onClick={() => chooseAnswer(choice)}
                    >
                      <span className="decision-key">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="flex-1 text-left whitespace-normal">
                        {choice.label}
                      </span>
                    </Button>
                  ))}
                </fieldset>
                {selectedChoice ? (
                  (() => {
                    const grade = gradePresentation(selectedChoice.grade);
                    return (
                      <div
                        className={cn('feedback-card', grade.className)}
                        aria-live="polite"
                      >
                        <p className="flex items-center gap-2 text-xs font-semibold">
                          <grade.Icon className="size-4" />
                          {grade.label} ·{' '}
                          {Math.round(selectedChoice.score * 100)}%
                        </p>
                        <p className="mt-2 text-xs leading-5 text-current/75">
                          {selectedChoice.feedback}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={showNextScenario}
                          className="mt-3 w-full border-current/20 bg-black/10"
                        >
                          Next situation <ChevronRight />
                        </Button>
                      </div>
                    );
                  })()
                ) : (
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                    Watch the whole sequence or make the call in real time. Some
                    situations deliberately allow referee discretion.
                  </p>
                )}
              </>
            ) : null}
          </div>

          <footer className="context-footer">
            <p className="text-[10px] leading-4 text-muted-foreground">
              Physics supplies observations; the rubric keeps objective facts,
              referee judgment, and committee interpretation separate.
            </p>
            <a
              href={scenario.ruleRef.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-sky-300 hover:text-sky-200"
            >
              Open official 2026 rules <ChevronRight className="size-3" />
            </a>
          </footer>
        </aside>
      </div>
    </main>
  );
}
