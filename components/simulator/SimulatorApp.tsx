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
  Move3D,
  MousePointer2,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  RotateCw,
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
import {
  DEFAULT_ROBOT_VISUAL_ID,
  isRobotVisualId,
  ROBOT_VISUALS,
  type RobotVisualId,
} from '@/lib/simulator/robot-models';
import { clonePoses, moveManualActor } from '@/lib/simulator/manual-layout';
import { getScenario, SCENARIOS } from '@/lib/simulator/scenarios';
import type {
  ActorDefinition,
  Pose,
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
  if (mode === 'manual') return Move3D;
  return GraduationCap;
}

function actorColor(actor: ActorDefinition) {
  if (actor.team === 'blue') return 'bg-sky-400';
  if (actor.team === 'yellow') return 'bg-amber-300';
  return 'bg-orange-400';
}

function formatCoordinate(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)} m`;
}

function wrapYaw(yaw: number) {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
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

function RobotVisualPicker({
  value,
  onChange,
  className,
}: {
  value: RobotVisualId;
  onChange: (value: RobotVisualId) => void;
  className?: string;
}) {
  return (
    <NativeSelect
      size="sm"
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (isRobotVisualId(nextValue)) onChange(nextValue);
      }}
      aria-label="Robot visual style"
      className={cn('robot-select', className)}
    >
      {ROBOT_VISUALS.map((visual) => (
        <NativeSelectOption key={visual.id} value={visual.id}>
          {visual.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function SimulatorApp() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [mode, setMode] = useState<SimulatorMode>('learn');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('broadcast');
  const [robotVisual, setRobotVisual] = useState<RobotVisualId>(
    DEFAULT_ROBOT_VISUAL_ID,
  );
  const [showRuleGeometry, setShowRuleGeometry] = useState(true);
  const [showBallTrail, setShowBallTrail] = useState(true);
  const [showContactEvidence, setShowContactEvidence] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isEmbed, setIsEmbed] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [manualPoses, setManualPoses] = useState<Record<string, Pose> | null>(
    null,
  );
  const [manualBaseline, setManualBaseline] = useState<Record<
    string,
    Pose
  > | null>(null);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [manualAnnouncement, setManualAnnouncement] = useState(
    'Manual positioning ready.',
  );
  const manualPosesRef = useRef<Record<string, Pose> | null>(null);
  const previousFrameRef = useRef<number | null>(null);

  const scenario = useMemo(() => getScenario(scenarioId), [scenarioId]);
  const scriptedFrame = useMemo(() => scenario.sample(time), [scenario, time]);
  const frame = useMemo(
    () =>
      mode === 'manual' && manualPoses
        ? {
            ...scriptedFrame,
            actors: manualPoses,
            ballPossession: null,
            phaseLabel: 'Manual positioning',
            metrics: {},
            evidence: [],
            evidenceDetails: [],
          }
        : scriptedFrame,
    [manualPoses, mode, scriptedFrame],
  );
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
    if (mode === 'manual' && manualBaseline) {
      const resetLayout = clonePoses(manualBaseline);
      manualPosesRef.current = resetLayout;
      setManualPoses(resetLayout);
      setManualAnnouncement('Manual layout reset.');
      previousFrameRef.current = null;
      return;
    }
    setTime(0);
    previousFrameRef.current = null;
  }, [manualBaseline, mode]);

  const selectScenario = useCallback(
    (id: string) => {
      const nextScenario = getScenario(id);
      setScenarioId(id);
      setPlaying(false);
      setTime(0);
      setCameraPreset(
        mode === 'manual'
          ? 'overhead'
          : normalizeCamera(nextScenario.defaultCamera),
      );
      setShowContactEvidence(false);
      if (mode === 'manual') {
        const nextLayout = clonePoses(nextScenario.sample(0).actors);
        setManualBaseline(nextLayout);
        const editableLayout = clonePoses(nextLayout);
        manualPosesRef.current = editableLayout;
        setManualPoses(editableLayout);
        setSelectedActorId(nextScenario.actors[0]?.id ?? null);
        setManualAnnouncement(
          `${nextScenario.shortTitle} starting layout loaded.`,
        );
      }
      previousFrameRef.current = null;
    },
    [mode],
  );

  const selectMode = useCallback(
    (nextMode: SimulatorMode) => {
      if (nextMode === 'manual' && mode !== 'manual') {
        const nextLayout = clonePoses(scriptedFrame.actors);
        setPlaying(false);
        setManualBaseline(nextLayout);
        const editableLayout = clonePoses(nextLayout);
        manualPosesRef.current = editableLayout;
        setManualPoses(editableLayout);
        setSelectedActorId(scenario.actors[0]?.id ?? null);
        setCameraPreset('overhead');
        setManualAnnouncement('Manual positioning ready.');
      } else if (nextMode !== 'manual' && mode === 'manual') {
        setSelectedActorId(null);
        setCameraPreset(normalizeCamera(scenario.defaultCamera));
      }
      setMode(nextMode);
    },
    [mode, scenario, scriptedFrame.actors],
  );

  const selectManualActor = useCallback(
    (actorId: string | null) => {
      setSelectedActorId(actorId);
      const actor = actorId
        ? scenario.actors.find((item) => item.id === actorId)
        : null;
      setManualAnnouncement(
        actor ? `${actor.label} selected.` : 'Selection cleared.',
      );
    },
    [scenario.actors],
  );

  const updateManualActor = useCallback(
    (actorId: string, position: { x: number; z: number }) => {
      const current = manualPosesRef.current;
      if (!current) return;
      const nextPose = moveManualActor(
        scenario.actors,
        current,
        actorId,
        position,
      );
      if (!nextPose) return;
      const nextLayout = { ...current, [actorId]: nextPose };
      manualPosesRef.current = nextLayout;
      setManualPoses(nextLayout);
    },
    [scenario.actors],
  );

  const finishMovingManualActor = useCallback(
    (actorId: string) => {
      const actor = scenario.actors.find((item) => item.id === actorId);
      const actorPose = manualPosesRef.current?.[actorId];
      if (!actor || !actorPose) return;
      setManualAnnouncement(
        `${actor.label} placed at X ${formatCoordinate(actorPose.x)}, Z ${formatCoordinate(actorPose.z)}.`,
      );
    },
    [scenario.actors],
  );

  const rotateSelectedActor = useCallback(
    (direction: -1 | 1) => {
      if (!selectedActorId) return;
      const actor = scenario.actors.find((item) => item.id === selectedActorId);
      if (!actor || actor.kind !== 'robot') return;
      const current = manualPosesRef.current;
      const currentPose = current?.[selectedActorId];
      if (!current || !currentPose) return;
      const nextLayout = {
        ...current,
        [selectedActorId]: {
          ...currentPose,
          yaw: wrapYaw(currentPose.yaw + direction * (Math.PI / 12)),
        },
      };
      manualPosesRef.current = nextLayout;
      setManualPoses(nextLayout);
      setManualAnnouncement(
        `${actor.label} rotated ${direction < 0 ? 'left' : 'right'} 15 degrees.`,
      );
    },
    [scenario.actors, selectedActorId],
  );

  const nudgeSelectedActor = useCallback(
    (deltaX: number, deltaZ: number) => {
      if (!selectedActorId) return;
      const current = manualPosesRef.current;
      const currentPose = current?.[selectedActorId];
      if (!current || !currentPose) return;
      const nextPose = moveManualActor(
        scenario.actors,
        current,
        selectedActorId,
        {
          x: currentPose.x + deltaX,
          z: currentPose.z + deltaZ,
        },
      );
      if (!nextPose) return;
      const nextLayout = { ...current, [selectedActorId]: nextPose };
      manualPosesRef.current = nextLayout;
      setManualPoses(nextLayout);
      const actor = scenario.actors.find((item) => item.id === selectedActorId);
      if (actor) {
        setManualAnnouncement(
          `${actor.label} moved to X ${formatCoordinate(nextPose.x)}, Z ${formatCoordinate(nextPose.z)}.`,
        );
      }
    },
    [scenario.actors, selectedActorId],
  );

  const handleRendererReady = useCallback(() => {
    setRendererReady(true);
  }, []);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const query = new URLSearchParams(window.location.search);
      const requestedRobotVisual = query.get('robot');
      if (isRobotVisualId(requestedRobotVisual)) {
        setRobotVisual(requestedRobotVisual);
      }
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
      } else if (queryMode === 'manual' && !embeddedScenario) {
        const initialLayout = clonePoses(SCENARIOS[0].sample(0).actors);
        setMode('manual');
        setPlaying(false);
        setManualBaseline(initialLayout);
        const editableLayout = clonePoses(initialLayout);
        manualPosesRef.current = editableLayout;
        setManualPoses(editableLayout);
        setSelectedActorId(SCENARIOS[0].actors[0]?.id ?? null);
        setCameraPreset('overhead');
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    if (!playing || mode === 'manual') {
      previousFrameRef.current = null;
      return;
    }
    let animationFrame = 0;
    const animate = (now: number) => {
      const previous = previousFrameRef.current ?? now;
      previousFrameRef.current = now;
      const delta = Math.min((now - previous) / 1000, 0.08) * speed;
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
  }, [mode, playing, scenario.duration, speed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea')) return;
      const targetIsButton = Boolean(target?.matches('button'));
      if (/^[1-7]$/.test(event.key)) {
        setCameraPreset(CAMERA_OPTIONS[Number(event.key) - 1].value);
        return;
      }
      if (mode === 'manual') {
        if (targetIsButton && (event.code === 'Space' || event.key === 'Enter'))
          return;
        const step = event.shiftKey ? 0.05 : 0.01;
        if (event.key === 'Escape') {
          setSelectedActorId(null);
          setManualAnnouncement('Selection cleared.');
        } else if (event.key.toLowerCase() === 'r') {
          reset();
        } else if (event.key.toLowerCase() === 'q') {
          rotateSelectedActor(-1);
        } else if (event.key.toLowerCase() === 'e') {
          rotateSelectedActor(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          nudgeSelectedActor(-step, 0);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          nudgeSelectedActor(step, 0);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          nudgeSelectedActor(0, step);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          nudgeSelectedActor(0, -step);
        } else if (event.code === 'Space') {
          event.preventDefault();
        }
        return;
      }
      if (targetIsButton) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (time >= scenario.duration) setTime(0);
        setPlaying((value) => !value);
      } else if (event.key.toLowerCase() === 'r') {
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    mode,
    nudgeSelectedActor,
    reset,
    rotateSelectedActor,
    scenario.duration,
    time,
  ]);

  const ballTrail = useMemo(() => {
    if (mode === 'manual') return [];
    const ball = scenario.actors.find((actor) => actor.kind === 'ball');
    if (!ball) return [];
    const length = Math.min(time, 2.8);
    return Array.from({ length: 30 }, (_, index) => {
      const sampleTime = Math.max(0, time - length + (length * index) / 29);
      return scenario.sample(sampleTime).actors[ball.id];
    }).filter(Boolean);
  }, [mode, scenario, time]);

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
      robotVisual,
      phase: frame.phaseLabel,
      physics: mode === 'manual' ? 'manual-layout' : 'scripted',
      motion:
        mode === 'manual' ? 'direct-manipulation' : 'deterministic-possession',
      ballOwner: frame.ballPossession?.ownerId ?? null,
      selectedActor: mode === 'manual' ? selectedActorId : null,
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
    playing,
    robotVisual,
    scenario,
    selectedActorId,
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
    url.searchParams.set('robot', robotVisual);
    const snippet = `<iframe src="${url.toString()}" title="${scenario.title} — RCJ Soccer Lab" loading="lazy" allowfullscreen></iframe>`;
    await navigator.clipboard.writeText(snippet);
    setEmbedCopied(true);
    window.setTimeout(() => setEmbedCopied(false), 1800);
  };

  const ballOwner = frame.ballPossession
    ? scenario.actors.find(
        (actor) => actor.id === frame.ballPossession?.ownerId,
      )
    : null;
  const ballStatusLabel = ballOwner
    ? `Ball attached · ${ballOwner.label}`
    : 'Ball · free';
  const selectedManualActor = selectedActorId
    ? (scenario.actors.find((actor) => actor.id === selectedActorId) ?? null)
    : null;
  const selectedManualPose = selectedManualActor
    ? frame.actors[selectedManualActor.id]
    : null;

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
          <div className="embed-toolbar-actions">
            <RobotVisualPicker
              value={robotVisual}
              onChange={setRobotVisual}
              className="embed-robot-select"
            />
            <a
              href="./"
              target="_blank"
              rel="noreferrer"
              className="embed-open-link text-[11px] text-sky-300 hover:text-sky-200"
            >
              Open lab ↗
            </a>
          </div>
        </div>
        <section className="relative min-h-0 flex-1">
          <PlayCanvasViewport
            actors={scenario.actors}
            poses={frame.actors}
            cameraPreset={cameraPreset}
            robotVisual={robotVisual}
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
          {(['explore', 'learn', 'manual', 'referee'] as SimulatorMode[]).map(
            (item) => {
              const Icon = modeIcon(item);
              return (
                <Button
                  key={item}
                  size="sm"
                  variant={mode === item ? 'secondary' : 'ghost'}
                  onClick={() => selectMode(item)}
                  aria-pressed={mode === item}
                  aria-label={`${item[0].toUpperCase()}${item.slice(1)} mode`}
                  className="capitalize"
                >
                  <Icon aria-hidden="true" />
                  <span className="hidden sm:inline">{item}</span>
                </Button>
              );
            },
          )}
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
            {mode === 'manual' ? (
              <Move3D className="size-3.5" aria-hidden="true" />
            ) : (
              <BookOpen className="size-3.5" aria-hidden="true" />
            )}
            {mode === 'manual' ? 'Starting layouts' : 'Situation library'}
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
            {mode === 'manual' ? (
              <p className="text-[10px] leading-4 text-muted-foreground">
                Choose any situation as a starting arrangement. Your edits stay
                local to Manual mode.
              </p>
            ) : (
              <>
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
              </>
            )}
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
                <span className="live-3d-label">Live 3D</span>
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'border-white/10 bg-black/35 backdrop-blur-md',
                  ballOwner?.team === 'blue'
                    ? 'text-sky-300'
                    : ballOwner?.team === 'yellow'
                      ? 'text-amber-300'
                      : 'text-white/60',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    ballOwner?.team === 'blue'
                      ? 'bg-sky-400'
                      : ballOwner?.team === 'yellow'
                        ? 'bg-amber-400'
                        : 'bg-white/45',
                  )}
                />
                {ballStatusLabel}
              </Badge>
            </div>
            <div className="viewport-selects">
              <RobotVisualPicker
                value={robotVisual}
                onChange={setRobotVisual}
              />
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
          </div>

          <PlayCanvasViewport
            actors={scenario.actors}
            poses={frame.actors}
            cameraPreset={cameraPreset}
            robotVisual={robotVisual}
            showRuleGeometry={showRuleGeometry}
            showBallTrail={mode !== 'manual' && showBallTrail}
            showContactEvidence={mode !== 'manual' && showContactEvidence}
            ballTrail={ballTrail}
            phaseLabel={frame.phaseLabel}
            editable={mode === 'manual'}
            selectedActorId={selectedActorId}
            onActorSelect={selectManualActor}
            onActorMove={updateManualActor}
            onActorMoveEnd={finishMovingManualActor}
            onReady={handleRendererReady}
          />

          <div className="viewport-phase">
            <span className="phase-pulse" aria-hidden="true" />
            <span>{frame.phaseLabel}</span>
          </div>
          <div className="viewport-help">
            {mode === 'manual'
              ? 'Drag object · empty space orbits · wheel zooms'
              : 'Drag to orbit · wheel to zoom · keys 1–7 cameras'}
          </div>
          {!rendererReady ? (
            <div className="renderer-loader">Preparing field…</div>
          ) : null}

          {mode === 'manual' ? (
            <div className="transport-panel manual-transport">
              <Button
                size="sm"
                variant="outline"
                onClick={reset}
                aria-label="Reset manual layout"
              >
                <RefreshCcw /> Reset layout
              </Button>
              <div className="manual-transport-copy">
                <MousePointer2 className="size-4 text-cyan-300" />
                <span>
                  Select and drag an object. Drag empty turf to move the camera.
                </span>
              </div>
              <span className="manual-selection-readout">
                {selectedManualActor && selectedManualPose
                  ? `${selectedManualActor.label} · ${formatCoordinate(selectedManualPose.x)}, ${formatCoordinate(selectedManualPose.z)}`
                  : 'No object selected'}
              </span>
            </div>
          ) : (
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
                    setTime(
                      typeof value === 'number' ? value : (value[0] ?? 0),
                    );
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
          )}
        </section>

        <aside className="context-panel">
          <div className="context-scroll">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">
                  {mode === 'referee'
                    ? 'Referee decision'
                    : mode === 'manual'
                      ? 'Manual positioning'
                      : mode === 'explore'
                        ? 'Scenario controls'
                        : 'Rule context'}
                </p>
                <h1 className="mt-2 text-xl font-semibold tracking-tight">
                  {mode === 'manual'
                    ? 'Arrange robots and ball'
                    : scenario.title}
                </h1>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 border-sky-400/25 text-sky-300"
              >
                {mode === 'manual' ? 'Sandbox' : scenario.ruleRef.section}
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

            {mode === 'manual' ? (
              <>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  Drag a robot or the ball directly on the field. Objects stop
                  at the field edge and cannot pass through one another.
                </p>
                <div className="manual-tip">
                  <MousePointer2 className="size-4 shrink-0 text-cyan-300" />
                  <p>
                    Drag empty turf to orbit the view. The object list below is
                    also useful when two objects are close together.
                  </p>
                </div>
                <div className="section-divider" />
                <h2 className="panel-title flex items-center gap-2">
                  <Move3D className="size-4 text-sky-400" /> Field objects
                </h2>
                <div className="mt-3 space-y-2">
                  {scenario.actors.map((actor) => {
                    const actorPose = frame.actors[actor.id];
                    const active = actor.id === selectedActorId;
                    return (
                      <Button
                        key={actor.id}
                        variant="outline"
                        className={cn(
                          'manual-actor-button',
                          active && 'manual-actor-button-active',
                        )}
                        aria-pressed={active}
                        onClick={() => selectManualActor(actor.id)}
                      >
                        <span
                          className={cn('manual-actor-dot', actorColor(actor))}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-xs font-medium">
                            {actor.label}
                          </span>
                          <span className="block text-[9px] capitalize text-muted-foreground">
                            {actor.kind}
                          </span>
                        </span>
                        {actorPose ? (
                          <span className="manual-mini-coordinates">
                            {actorPose.x.toFixed(2)} / {actorPose.z.toFixed(2)}
                          </span>
                        ) : null}
                      </Button>
                    );
                  })}
                </div>

                {selectedManualActor && selectedManualPose ? (
                  <div className="manual-object-card">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {selectedManualActor.label}
                        </p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                          Selected {selectedManualActor.kind}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'manual-actor-dot size-3',
                          actorColor(selectedManualActor),
                        )}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="manual-coordinate-grid">
                      <div className="manual-coordinate">
                        <span>X position</span>
                        <strong>
                          {formatCoordinate(selectedManualPose.x)}
                        </strong>
                      </div>
                      <div className="manual-coordinate">
                        <span>Z position</span>
                        <strong>
                          {formatCoordinate(selectedManualPose.z)}
                        </strong>
                      </div>
                    </div>
                    {selectedManualActor.kind === 'robot' ? (
                      <div className="manual-rotation-row">
                        <Button
                          size="icon-sm"
                          variant="outline"
                          onClick={() => rotateSelectedActor(-1)}
                          aria-label={`Rotate ${selectedManualActor.label} left 15 degrees`}
                        >
                          <RotateCcw />
                        </Button>
                        <span>
                          Heading{' '}
                          <strong>
                            {Math.round(
                              (selectedManualPose.yaw * 180) / Math.PI,
                            )}
                            °
                          </strong>
                        </span>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          onClick={() => rotateSelectedActor(1)}
                          aria-label={`Rotate ${selectedManualActor.label} right 15 degrees`}
                        >
                          <RotateCw />
                        </Button>
                      </div>
                    ) : null}
                    <p className="mt-3 text-[9px] leading-4 text-muted-foreground">
                      Arrow keys move 1 cm · Shift moves 5 cm · Q/E rotates · R
                      resets
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Select an object on the field or from the list.
                  </p>
                )}

                <div className="section-divider" />
                <div className="toggle-row">
                  <label htmlFor="manual-rule-geometry">
                    <strong>Rule geometry</strong>
                    <small>Penalty areas and 15 mm plane</small>
                  </label>
                  <Switch
                    id="manual-rule-geometry"
                    checked={showRuleGeometry}
                    onCheckedChange={setShowRuleGeometry}
                  />
                </div>
                <p className="sr-only" aria-live="polite">
                  {manualAnnouncement}
                </p>
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
            {mode === 'manual' ? (
              <p className="text-[10px] leading-4 text-muted-foreground">
                Manual edits are a private sandbox and do not change the
                authored rule situations.
              </p>
            ) : (
              <>
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Repeatable animation supplies observations; the rubric keeps
                  objective facts, referee judgment, and committee
                  interpretation separate.
                </p>
                <a
                  href={scenario.ruleRef.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-sky-300 hover:text-sky-200"
                >
                  Open official 2026 rules <ChevronRight className="size-3" />
                </a>
              </>
            )}
          </footer>
        </aside>
      </div>
    </main>
  );
}
