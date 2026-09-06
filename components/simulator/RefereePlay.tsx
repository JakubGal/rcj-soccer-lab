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
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import { appendLocaleToSearch } from '@/lib/i18n';
import { createResultSaveTracker } from '@/lib/account/result-save';
import {
  CERTIFICATION_MATCH_DURATION_SECONDS,
  type RefereeCertificationAttempt,
  type RefereeCertificationBridge,
  type RefereeCertificationFinishPayload,
  type RefereePracticeSessionFinishPayload,
  type RefereePracticeTrackingBridge,
} from '@/lib/certification/client-types';
import {
  MAX_MATCH_REPLAY_EVENTS,
  makeMatchReplay,
  makeMatchReplayCheckpoint,
  hydrateMatchReplay,
  type MatchReplay,
  type MatchReplayEvent,
  type MatchReplayOperation,
} from '@/lib/certification/replay';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const callLabel = (call: RefereeCall) => {
  const action =
    REFEREE_ACTIONS.find((entry) => entry.id === call.action)?.label ??
    call.action;
  const target = call.target
    ? (MATCH_ROBOTS.find((robot) => robot.id === call.target)?.label ??
      (call.target === 'blue'
        ? 'Blue'
        : call.target === 'yellow'
          ? 'Yellow'
          : call.target))
    : '';
  return target ? `${action} · ${target}` : action;
};
const assessmentLabel = (assessment: string) =>
  ({
    correct: 'Correct',
    supported: 'Supported judgment',
    'wrong-action': 'Wrong action',
    'wrong-target': 'Wrong target',
    premature: 'Too early',
    correction: 'Corrective action',
    assisted: 'Assisted',
    missed: 'Missed call',
    'not-scored': 'Not scored',
  })[assessment] ?? assessment;
const randomSeed = () => Math.floor(Math.random() * 4294967295) + 1;
const ALL_TRAINING_TOPICS = TRAINING_TOPICS.map((topic) => topic.id);
const practiceSessionId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `practice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  'keep-out',
  'return',
]);
const actionInGroup = (group: string, actionId: string) => {
  const action = REFEREE_ACTIONS.find((entry) => entry.id === actionId);
  if (!action) return false;
  if (group === 'all') return true;
  if (group === 'common') return COMMON.has(actionId);
  if (group === 'robot') return action.group === 'Robot';
  return ['Restart', 'Field', 'Score'].includes(action.group);
};

type ReplayCapture = {
  attemptId: string;
  session: RefereeMatch;
  mode: TrainingMode;
  seed: number;
  initialRobotVisual: RobotVisualId;
  events: MatchReplayEvent[];
  overflow: boolean;
};

const replayCaptureFor = (
  attempt: RefereeCertificationAttempt,
  session: RefereeMatch,
  robotVisual: RobotVisualId,
): ReplayCapture => ({
  attemptId: attempt.attemptId,
  session,
  mode: attempt.mode,
  seed: attempt.seed,
  initialRobotVisual: attempt.checkpoint?.robotVisual ?? robotVisual,
  events: attempt.checkpoint ? structuredClone(attempt.checkpoint.events) : [],
  overflow: false,
});

export function RefereePlay({
  robotVisual,
  onExit,
  active = true,
  onOpenRule,
  tracking,
  certification,
  savedReview,
}: {
  robotVisual: RobotVisualId;
  onExit: () => void;
  active?: boolean;
  onOpenRule?: (sectionId: string) => void;
  tracking?: RefereePracticeTrackingBridge;
  certification?: RefereeCertificationBridge;
  savedReview?: MatchReplay;
}) {
  const { locale } = useLocalization();
  const initialCertificationAttempt = certification?.attempt ?? null;
  const initialMode = savedReview?.mode ?? certification?.mode ?? 'step';
  const initialDuration =
    certification || savedReview ? CERTIFICATION_MATCH_DURATION_SECONDS : 180;
  const initialSeed = initialCertificationAttempt?.seed ?? randomSeed();
  const [certificationAttempt, setCertificationAttempt] =
    useState<RefereeCertificationAttempt | null>(initialCertificationAttempt);
  const [practiceId, setPracticeId] = useState(practiceSessionId);
  const [sessionKind, setSessionKind] = useState<
    'practice' | 'certification' | 'review'
  >(savedReview ? 'review' : certification ? 'certification' : 'practice');
  const [initialSession] = useState(() => {
    const create = () =>
      new RefereeMatch(initialSeed, {
        preMatch: true,
        robotVisual: initialCertificationAttempt?.robotVisual ?? robotVisual,
        mode: initialMode,
        duration: initialDuration,
        topics: ALL_TRAINING_TOPICS,
        lockRobotVisual: Boolean(certification),
      });
    try {
      const evidence = savedReview ?? initialCertificationAttempt?.checkpoint;
      return {
        session: evidence
          ? hydrateMatchReplay(evidence, { recordMatchReplay: true })
          : create(),
        error: null,
      };
    } catch (error) {
      return {
        session: create(),
        error:
          error instanceof Error
            ? error.message
            : 'The recording could not be restored.',
      };
    }
  });
  const [session, setSession] = useState(initialSession.session);
  const [restoreError, setRestoreError] = useState(initialSession.error);
  const replayCapture = useRef<ReplayCapture | null>(
    initialCertificationAttempt
      ? replayCaptureFor(
          initialCertificationAttempt,
          session,
          session.robotVisual,
        )
      : null,
  );
  const [mode, setMode] = useState<TrainingMode>(initialMode);
  const [duration, setDuration] = useState(initialDuration);
  const [trainingTopics, setTrainingTopics] =
    useState<TrainingTopic[]>(ALL_TRAINING_TOPICS);
  const [frame, setFrame] = useState(() => session.snapshot());
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState('blue-1');
  const [camera, setCamera] = useState<CameraPreset>('overhead');
  const [speed, setSpeed] = useState(1);
  const [group, setGroup] = useState('common');
  const [topic, setTopic] = useState('random');
  const [seed, setSeed] = useState(String(initialSeed));
  const [replay, setReplay] = useState<SituationReplay | null>(null);
  const [replayTime, setReplayTime] = useState(0);
  const [replayRunning, setReplayRunning] = useState(false);
  const [replayKind, setReplayKind] = useState<'situation' | 'match' | null>(
    null,
  );
  const [reviewEventId, setReviewEventId] = useState<number | null>(null);
  const replayCursor = useRef(0);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const practiceStartsReported = useRef(new Set<string>());
  const preKickoffGroup = useRef<string | null>(null);
  const wasKickoffDue = useRef(false);
  const practiceFinishesReported = useRef(new Set<string>());
  const certificationFinishesReported = useRef(createResultSaveTracker());
  const [startingCertification, setStartingCertification] = useState(false);
  const [certificationError, setCertificationError] = useState<string | null>(
    null,
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const checkpointSaveRef = useRef<(() => void) | null>(null);
  const recordReplayOperation = useCallback(
    (subject: RefereeMatch, operation: MatchReplayOperation) => {
      const capture = replayCapture.current;
      if (!capture || capture.session !== subject) return;
      if (capture.events.length >= MAX_MATCH_REPLAY_EVENTS) {
        capture.overflow = true;
        return;
      }
      capture.events.push({
        ...operation,
        seq: capture.events.length,
        tick: subject.trainingTick,
      } as MatchReplayEvent);
      if (operation.op !== 'end')
        queueMicrotask(() => checkpointSaveRef.current?.());
    },
    [],
  );
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
  const activeCertificationAttempt =
    certificationAttempt &&
    certification &&
    certificationAttempt.certificationRunId ===
      certification.certificationRunId &&
    certificationAttempt.mode === certification.mode
      ? certificationAttempt
      : null;
  const certificationSessionReady =
    !restoreError && (!certification || Boolean(activeCertificationAttempt));
  const displayedMode = certification?.mode ?? mode;
  const displayedDuration = certification
    ? CERTIFICATION_MATCH_DURATION_SECONDS
    : duration;
  const displayedTopics = certification ? ALL_TRAINING_TOPICS : trainingTopics;
  const effectiveSpeed = certification ? 1 : speed;
  const onCheckpoint = certification?.onCheckpoint;

  const installCertificationAttempt = useCallback(
    (attempt: RefereeCertificationAttempt) => {
      if (!certification) return false;
      if (
        attempt.certificationRunId !== certification.certificationRunId ||
        attempt.mode !== certification.mode ||
        !Number.isInteger(attempt.seed) ||
        attempt.seed < 1 ||
        attempt.seed > 4294967295
      ) {
        setCertificationError(
          'The server returned an invalid certification attempt.',
        );
        return false;
      }
      let next: RefereeMatch;
      try {
        next = attempt.checkpoint
          ? hydrateMatchReplay(attempt.checkpoint, { recordMatchReplay: true })
          : new RefereeMatch(attempt.seed, {
              preMatch: true,
              robotVisual: attempt.robotVisual ?? robotVisual,
              mode: attempt.mode,
              duration: CERTIFICATION_MATCH_DURATION_SECONDS,
              topics: ALL_TRAINING_TOPICS,
              lockRobotVisual: true,
            });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'The recording could not be restored.';
        setRestoreError(message);
        setCertificationError(message);
        setRunning(false);
        return false;
      }
      replayCapture.current = replayCaptureFor(attempt, next, next.robotVisual);
      setReplay(null);
      setReplayKind(null);
      setReviewEventId(null);
      setCertificationAttempt(attempt);
      setSessionKind('certification');
      setSession(next);
      setFrame(next.snapshot());
      setMode(attempt.mode);
      setDuration(CERTIFICATION_MATCH_DURATION_SECONDS);
      setTrainingTopics([...ALL_TRAINING_TOPICS]);
      setSpeed(1);
      setSeed(String(attempt.seed));
      setTopic('random');
      setRunning(false);
      setCertificationError(null);
      setRestoreError(null);
      setSaveFailed(false);
      return true;
    },
    [certification, robotVisual],
  );

  const startCertificationAttempt = useCallback(async () => {
    if (!certification || startingCertification) return;
    setStartingCertification(true);
    setCertificationError(null);
    try {
      const attempt = await certification.onStartAttempt({
        certificationRunId: certification.certificationRunId,
        mode: certification.mode,
        durationSeconds: CERTIFICATION_MATCH_DURATION_SECONDS,
        topics: [...ALL_TRAINING_TOPICS],
      });
      installCertificationAttempt(attempt);
    } catch (error) {
      setCertificationError(
        error instanceof Error
          ? error.message
          : 'The certification attempt could not be started.',
      );
    } finally {
      setStartingCertification(false);
    }
  }, [certification, installCertificationAttempt, startingCertification]);

  useEffect(() => {
    if (sessionKind === 'practice' && session.robotVisual !== robotVisual) {
      session.setRobotVisual(robotVisual);
      recordReplayOperation(session, {
        op: 'set-robot-visual',
        robotVisual,
      });
    }
    const update = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(update);
  }, [session, sessionKind, robotVisual, sync, recordReplayOperation]);

  useEffect(() => {
    if (
      sessionKind !== 'certification' ||
      !activeCertificationAttempt ||
      !onCheckpoint ||
      restoreError
    )
      return;
    let cancelled = false;
    const save = () => {
      const capture = replayCapture.current;
      if (
        !capture ||
        capture.session !== session ||
        capture.overflow ||
        session.snapshot().sessionFinished
      )
        return;
      try {
        const checkpoint = makeMatchReplayCheckpoint({
          mode: capture.mode,
          seed: capture.seed,
          robotVisual: capture.initialRobotVisual,
          topics: [...ALL_TRAINING_TOPICS],
          events: capture.events,
          terminal: { tick: session.trainingTick, reason: 'checkpoint' },
        });
        void Promise.resolve(onCheckpoint(capture.attemptId, checkpoint))
          .then(() => {
            if (!cancelled) setCheckpointError(null);
          })
          .catch((error: unknown) => {
            if (!cancelled)
              setCheckpointError(
                error instanceof Error
                  ? error.message
                  : 'Checkpoint could not be saved.',
              );
          });
      } catch (error) {
        if (!cancelled)
          setCheckpointError(
            error instanceof Error
              ? error.message
              : 'Checkpoint could not be saved.',
          );
      }
    };
    checkpointSaveRef.current = save;
    const interval = window.setInterval(save, 3000);
    save();
    return () => {
      save();
      cancelled = true;
      checkpointSaveRef.current = null;
      window.clearInterval(interval);
    };
  }, [
    session,
    sessionKind,
    onCheckpoint,
    activeCertificationAttempt,
    restoreError,
  ]);

  useEffect(() => {
    const attempt = certification?.attempt;
    if (!attempt || attempt.attemptId === certificationAttempt?.attemptId)
      return;
    const update = requestAnimationFrame(() =>
      installCertificationAttempt(attempt),
    );
    return () => cancelAnimationFrame(update);
  }, [
    certification?.attempt,
    certificationAttempt?.attemptId,
    installCertificationAttempt,
  ]);

  useEffect(() => {
    if (
      sessionKind !== 'practice' ||
      !tracking?.onStartSession ||
      practiceStartsReported.current.has(practiceId)
    )
      return;
    practiceStartsReported.current.add(practiceId);
    const start = {
      clientSessionId: practiceId,
      mode: session.mode,
      seed: session.seed,
      durationSeconds: session.duration,
      topics: [...session.topics],
    };
    void Promise.resolve()
      .then(() => tracking.onStartSession?.(start))
      .catch(() => undefined);
  }, [practiceId, session, sessionKind, tracking]);
  useEffect(() => {
    if (!frame.sessionFinished) return;
    const focus = requestAnimationFrame(() => resultsHeading.current?.focus());
    return () => cancelAnimationFrame(focus);
  }, [frame.sessionFinished]);

  useEffect(() => {
    if (
      sessionKind !== 'practice' ||
      !frame.sessionFinished ||
      !tracking?.onFinishSession ||
      practiceFinishesReported.current.has(practiceId)
    )
      return;
    practiceFinishesReported.current.add(practiceId);
    const simulatedSeconds = Math.max(
      0,
      session.duration - frame.trainingRemaining,
    );
    const result: RefereePracticeSessionFinishPayload = {
      clientSessionId: practiceId,
      mode: session.mode,
      seed: session.seed,
      durationSeconds: session.duration,
      topics: [...session.topics],
      simulatedSeconds,
      completionReason:
        frame.trainingRemaining <= MATCH_STEP / 2 ? 'full-time' : 'ended-early',
      report: {
        correct: frame.report.correct,
        wrong: frame.report.wrong,
        missed: frame.report.missed,
        assisted: frame.report.assisted,
        assessed: frame.report.assessed,
        accuracy: frame.report.accuracy,
      },
    };
    void Promise.resolve()
      .then(() => tracking.onFinishSession?.(result))
      .catch(() => undefined);
  }, [
    frame.report,
    frame.sessionFinished,
    frame.trainingRemaining,
    practiceId,
    session,
    sessionKind,
    tracking,
  ]);

  useEffect(() => {
    if (
      sessionKind !== 'certification' ||
      !certification ||
      !activeCertificationAttempt ||
      !frame.sessionFinished ||
      saveFailed ||
      certificationFinishesReported.current.has(
        activeCertificationAttempt.attemptId,
      )
    )
      return;
    const simulatedSeconds = Math.max(
      0,
      CERTIFICATION_MATCH_DURATION_SECONDS - frame.trainingRemaining,
    );
    const completedAtFullTime = frame.trainingRemaining <= MATCH_STEP / 2;
    const capture = replayCapture.current;
    if (
      !capture ||
      capture.session !== session ||
      capture.attemptId !== activeCertificationAttempt.attemptId ||
      capture.overflow
    ) {
      setSaveFailed(true);
      setCertificationError(
        capture?.overflow
          ? 'This attempt contains too many actions to submit as certification evidence.'
          : 'Certification replay evidence is unavailable for this attempt.',
      );
      return;
    }
    const report = {
      correct: frame.report.correct,
      wrong: frame.report.wrong,
      missed: frame.report.missed,
      assisted: frame.report.assisted,
      assessed: frame.report.assessed,
      accuracy: frame.report.accuracy,
    };
    let replayEvidence;
    try {
      replayEvidence = makeMatchReplay({
        mode: capture.mode,
        seed: capture.seed,
        robotVisual: capture.initialRobotVisual,
        topics: [...ALL_TRAINING_TOPICS],
        events: capture.events,
        terminal: {
          tick: session.trainingTick,
          reason: completedAtFullTime ? 'full-time' : 'ended-early',
        },
        claimedReport: report,
      });
    } catch (error) {
      setSaveFailed(true);
      setCertificationError(
        error instanceof Error
          ? `Certification evidence could not be prepared: ${error.message}`
          : 'Certification evidence could not be prepared.',
      );
      return;
    }
    const result: RefereeCertificationFinishPayload = {
      attemptId: activeCertificationAttempt.attemptId,
      certificationRunId: activeCertificationAttempt.certificationRunId,
      mode: activeCertificationAttempt.mode,
      seed: activeCertificationAttempt.seed,
      durationSeconds: CERTIFICATION_MATCH_DURATION_SECONDS,
      simulatedSeconds,
      completionReason: completedAtFullTime ? 'full-time' : 'ended-early',
      eligibleForScoring: completedAtFullTime && frame.report.assisted === 0,
      topics: [...ALL_TRAINING_TOPICS],
      replay: replayEvidence,
      report,
    };
    void certificationFinishesReported.current
      .save(activeCertificationAttempt.attemptId, () =>
        certification.onFinishAttempt(result),
      )
      .then(() => {
        setSaveFailed(false);
        setCertificationError(null);
      })
      .catch((error: unknown) => {
        setSaveFailed(true);
        setCertificationError(
          error instanceof Error
            ? error.message
            : 'The certification result could not be saved.',
        );
      });
  }, [
    certification,
    activeCertificationAttempt,
    frame.report,
    frame.sessionFinished,
    frame.trainingRemaining,
    session,
    sessionKind,
    saveRetry,
    saveFailed,
  ]);
  useEffect(() => {
    if (sessionKind !== 'certification') return;
    const warn = (event: BeforeUnloadEvent) => {
      if (
        !session.snapshot().sessionFinished ||
        saveFailed ||
        (activeCertificationAttempt &&
          !certificationFinishesReported.current.isSaved(
            activeCertificationAttempt.attemptId,
          ))
      ) {
        checkpointSaveRef.current?.();
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session, sessionKind, saveFailed, activeCertificationAttempt]);
  const pause = useCallback(() => {
    if (replay) {
      setReplayRunning(false);
      setRunning(false);
      return;
    }
    const wasPaused = session.snapshot().userPaused;
    session.pauseForDecision();
    if (!wasPaused && session.snapshot().userPaused)
      recordReplayOperation(session, { op: 'pause' });
    setRunning(false);
    sync();
  }, [session, sync, replay, recordReplayOperation]);
  useEffect(() => {
    if (active) return;
    const update = requestAnimationFrame(() => {
      pause();
      setReady(false);
    });
    return () => cancelAnimationFrame(update);
  }, [active, pause]);
  const toggleRunning = useCallback(() => {
    if (!ready || !certificationSessionReady) return;
    if (running) {
      pause();
      return;
    }
    const canResume = session.canResumeMotion;
    session.resumeMotion();
    if (canResume) recordReplayOperation(session, { op: 'resume' });
    setRunning(session.canAdvance);
    sync();
  }, [
    ready,
    certificationSessionReady,
    running,
    pause,
    session,
    sync,
    recordReplayOperation,
  ]);
  const reset = useCallback(
    (value: number) => {
      if (certification) return;
      setReplay(null);
      setReplayKind(null);
      setReviewEventId(null);
      const next = new RefereeMatch(value, {
        preMatch: true,
        robotVisual,
        mode,
        duration,
        topics: trainingTopics,
      });
      setSession(next);
      setSessionKind('practice');
      setFrame(next.snapshot());
      setPracticeId(practiceSessionId());
      setSeed(String(value));
      setTopic('random');
      setRunning(false);
    },
    [certification, robotVisual, mode, duration, trainingTopics],
  );
  const whistle = useCallback(() => {
    if (replay || !certificationSessionReady) return;
    if (session.snapshot().sessionFinished) return;
    session.whistle();
    recordReplayOperation(session, { op: 'whistle' });
    setRunning(false);
    sync();
  }, [session, sync, replay, certificationSessionReady, recordReplayOperation]);
  const submit = (call: RefereeCall) => {
    if (!certificationSessionReady) return;
    const displayedDecisionKey = frame.decisionKey;
    const replayDecisionKey = session.decisionKey;
    if (session.submit(displayedDecisionKey, call))
      recordReplayOperation(session, {
        op: 'call',
        decisionKey: replayDecisionKey,
        call: {
          action: call.action,
          ...(call.target ? { target: call.target } : {}),
        },
      });
    setRunning(session.canAdvance);
    sync();
  };

  const openMatchReplay = useCallback(
    (at = 0, eventId: number | null = null) => {
      const recording = session.getMatchReplay();
      if (!recording) return;
      setReplay(recording);
      setReplayKind('match');
      setReviewEventId(eventId);
      seekReplay(Math.max(0, Math.min(at, recording.duration)));
      setReplayRunning(false);
      setRunning(false);
    },
    [session, seekReplay],
  );

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
      accumulator += delta * effectiveSpeed;
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
  }, [active, effectiveSpeed, running, session, sync, replay]);

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
      speed: effectiveSpeed,
      seed: session.seed,
      selectedActor: target,
    });
    host.snapshot = snapshot;
    return () => {
      if (host.snapshot === snapshot) delete host.snapshot;
    };
  }, [active, effectiveSpeed, session, running, target, replay]);

  const canNext = frame.canStartCase;
  const replayPlaying = Boolean(
    replay && replayRunning && replayTime < replay.duration,
  );
  const moving = replay ? replayPlaying : running && !frame.motionHeld;
  const replayView = replay ? sampleSituation(replay, replayTime) : null;
  const view = replayView ?? { ...frame, ballTrail: session.match.ballTrail() };
  const selectedReview = frame.review.find(
    (event) => event.id === reviewEventId,
  );
  const selectedReviewIndex = frame.review.findIndex(
    (event) => event.id === reviewEventId,
  );
  const blocked =
    frame.sessionFinished ||
    !ready ||
    !certificationSessionReady ||
    Boolean(replay) ||
    Boolean(frame.opening) ||
    frame.resolving ||
    (frame.trainingMode === 'step' && frame.phase === 'feedback');
  const supported =
    frame.feedback && ['correct', 'supported'].includes(frame.feedback.verdict);
  const revealReplay = frame.trainingMode === 'step' || frame.sessionFinished;
  const remainingSeconds = Math.ceil(frame.trainingRemaining);
  const actions = REFEREE_ACTIONS.filter(
    (action) => action.id !== 'goal' && actionInGroup(group, action.id),
  );

  // Restore the category the referee had chosen before the automatic
  // 'restart' switch for arranging kickoff, once kickoff is no longer due.
  // A manual category change in the meantime (see the select below) clears
  // preKickoffGroup so it never overrides that later choice.
  useEffect(() => {
    const restoreGroup = wasKickoffDue.current && !frame.kickoffDue
      ? preKickoffGroup.current
      : null;
    wasKickoffDue.current = frame.kickoffDue;
    if (!restoreGroup) return;
    const update = requestAnimationFrame(() => {
      if (preKickoffGroup.current !== restoreGroup) return;
      setGroup(restoreGroup);
      preKickoffGroup.current = null;
    });
    return () => cancelAnimationFrame(update);
  }, [frame.kickoffDue]);

  const startNext = () => {
    const definition = REFEREE_CASES.find(
      (item) => item.id === topic && frame.topics.includes(trainingTopic(item)),
    );
    const started = definition
      ? session.beginCase(definition)
      : session.nextCase();
    if (started) {
      if (!definition) recordReplayOperation(session, { op: 'next-case' });
      sync();
      setRunning(session.canAdvance);
    }
  };

  useEffect(() => {
    if (
      sessionKind !== 'certification' ||
      !activeCertificationAttempt ||
      activeCertificationAttempt.mode !== 'step' ||
      !ready ||
      !frame.canStartCase ||
      frame.sessionFinished
    )
      return;
    const update = requestAnimationFrame(() => {
      if (session.nextCase()) {
        recordReplayOperation(session, { op: 'next-case' });
        sync();
        setRunning(session.canAdvance);
      }
    });
    return () => cancelAnimationFrame(update);
  }, [
    activeCertificationAttempt,
    frame.canStartCase,
    frame.sessionFinished,
    ready,
    session,
    sessionKind,
    sync,
    recordReplayOperation,
  ]);

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
            replay && selectedReview
              ? `${selectedReview.situation}. ${selectedReview.detail}`
              : replay
                ? revealReplay
                  ? replay.facts
                  : 'Review the recorded play and make your own assessment.'
                : frame.facts
          }
          robotVisual={session.robotVisual}
          selectedActorId={view.actors[target] ? target : null}
          onReady={onReady}
        />
        {frame.opening && !replay && certificationSessionReady && (
          <PreMatchToss
            key={session.seed}
            meeting={frame.opening}
            ready={ready}
            onToss={() => {
              if (session.tossCoin())
                recordReplayOperation(session, { op: 'toss' });
              sync();
            }}
            onKickoff={() => {
              if (session.chooseFirstKickoff())
                recordReplayOperation(session, { op: 'take-kickoff' });
              sync();
            }}
            onEnd={(end) => {
              if (session.chooseOpeningEnd(end))
                recordReplayOperation(session, { op: 'choose-end', end });
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
                ? selectedReview
                  ? `${clock(selectedReview.at)} · ${selectedReview.assessment.replace('-', ' ')}`
                  : revealReplay
                    ? `Replay · ${replay.title}`
                    : 'Replay recent play'
                : frame.sessionFinished
                  ? 'Match complete'
                  : frame.trainingMode === 'continuous' && !frame.kickoffDue
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
                ? selectedReview
                  ? selectedReview.actual
                    ? `${selectedReview.effect} The expected decision is shown in the review timeline.`
                    : `${selectedReview.detail} Select another event or continue replaying the match.`
                  : revealReplay
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
                        session.robotVisual,
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
                {replayKind === 'match'
                  ? 'Full-match recording. Timeline selections change only the replay view.'
                  : 'Recorded situation. Back to match returns to the unchanged live game.'}
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
              <div className="referee-replay-track">
                <input
                  className="referee-replay-timeline"
                  type="range"
                  min="0"
                  max={replay.duration}
                  step="0.002"
                  value={replayTime}
                  aria-label="Replay timeline"
                  aria-valuetext={
                    selectedReview
                      ? `${clock(replayTime)}, ${selectedReview.assessment.replace('-', ' ')}: ${selectedReview.situation}`
                      : clock(replayTime)
                  }
                  onChange={(e) => {
                    setReviewEventId(null);
                    seekReplay(Number(e.target.value));
                  }}
                />
                {replayKind === 'match' && (
                  <div className="referee-replay-markers" aria-hidden="true">
                    {frame.review.map((event) => (
                      <i
                        key={event.id}
                        className={`referee-replay-marker referee-replay-marker-${event.assessment}`}
                        style={{
                          left: `${Math.min(100, (100 * event.replayAt) / replay.duration)}%`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <output className="referee-replay-time">
                {replayTime.toFixed(1)} / {replay.duration.toFixed(1)} s
              </output>
              {replayKind === 'match' && frame.review.length > 0 && (
                <div className="referee-replay-stepper">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedReviewIndex <= 0}
                    onClick={() => {
                      const event = frame.review[selectedReviewIndex - 1];
                      if (event) openMatchReplay(event.replayAt, event.id);
                    }}
                  >
                    <ArrowLeft /> Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      selectedReviewIndex < 0 ||
                      selectedReviewIndex >= frame.review.length - 1
                    }
                    onClick={() => {
                      const event = frame.review[selectedReviewIndex + 1];
                      if (event) openMatchReplay(event.replayAt, event.id);
                    }}
                  >
                    Next <ChevronRight />
                  </Button>
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setReplay(null);
                  setReplayKind(null);
                  setReviewEventId(null);
                  setReplayRunning(false);
                  sync();
                }}
              >
                <ArrowLeft />{' '}
                {frame.sessionFinished ? 'Back to results' : 'Back to match'}
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={
                  !ready ||
                  !certificationSessionReady ||
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
                value={effectiveSpeed}
                disabled={Boolean(certification)}
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
        <div
          className="context-scroll"
          inert={Boolean(replay) && !frame.sessionFinished}
        >
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
            {frame.trainingMode === 'continuous' && !frame.sessionFinished ? (
              <>
                <span>
                  <strong>{frame.callsMade}</strong>
                  Decisions recorded
                </span>
                <span>
                  <strong>{frame.bench.length}</strong>
                  Robots off field
                </span>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
          {frame.trainingMode !== 'continuous' || frame.sessionFinished ? (
            <p className="referee-assistance-note">
              {frame.report.wrong} wrong · {frame.report.missed} missed ·{' '}
              {frame.report.assisted} assisted
            </p>
          ) : (
            <p className="referee-assistance-note">
              Calls are applied exactly as made. Evaluation stays hidden until
              full time.
            </p>
          )}
          <details
            className="referee-details referee-session-setup"
            open={Boolean(frame.opening)}
            hidden={sessionKind === 'review'}
          >
            <summary>
              {certification ? 'Certification attempt' : 'Match setup'} ·{' '}
              {frame.trainingMode === 'continuous' ? 'Continuous' : 'Step mode'}
            </summary>
            <label htmlFor="referee-mode">Refereeing mode</label>
            <NativeSelect
              id="referee-mode"
              value={displayedMode}
              disabled={Boolean(certification)}
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
              value={displayedDuration}
              disabled={Boolean(certification)}
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
                    disabled={Boolean(certification)}
                    checked={displayedTopics.includes(t.id)}
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
              {certification
                ? 'Certification uses all topics, a reproducible shuffle, 10:00 of simulated play and 1× speed. The robot model is locked. Starting consumes one attempt; saved games can be resumed from Academy. Hints and answer assistance are unavailable.'
                : displayedMode === 'continuous'
                  ? 'Selected faults develop during AI play. Every call you make is applied—even a wrong removal, goal, placement or early return—and evaluated privately after the match. Other natural incidents can still happen, but only selected topics affect your score.'
                  : 'The next practice drill comes from your selected topics. Each decision pauses in place.'}
            </p>
            {certification ? (
              <>
                {activeCertificationAttempt && !frame.sessionFinished ? (
                  <p>
                    Attempt {activeCertificationAttempt.attemptNumber ?? '—'} is
                    in progress.
                  </p>
                ) : (
                  <Button
                    disabled={startingCertification}
                    onClick={() => void startCertificationAttempt()}
                  >
                    <Shuffle />
                    {startingCertification
                      ? 'Starting certification attempt…'
                      : frame.sessionFinished
                        ? 'Start next certification attempt'
                        : 'Start certification attempt'}
                  </Button>
                )}
                {certificationError && <p role="alert">{certificationError}</p>}
              </>
            ) : (
              <>
                <Button
                  disabled={!trainingTopics.length}
                  onClick={() => reset(randomSeed())}
                >
                  <Shuffle /> Start new match with these settings
                </Button>
                {!trainingTopics.length && <p>Select at least one topic.</p>}
              </>
            )}
          </details>
          {restoreError && <p role="alert">{restoreError}</p>}
          {checkpointError && (
            <p role="alert">
              {checkpointError} Keep this tab open and check browser storage.
            </p>
          )}
          {saveFailed && (
            <div
              role="alert"
              className="my-3 rounded-lg border border-amber-400/40 p-3"
            >
              <p>
                {certificationError} Your result is still here. Retry saving
                before leaving this page.
              </p>
              <Button
                onClick={() => {
                  setSaveFailed(false);
                  setSaveRetry((value) => value + 1);
                }}
              >
                Retry saving result
              </Button>
            </div>
          )}
          {sessionKind === 'review' && (
            <p className="my-3 text-sm text-sky-200">
              Saved game review. Replaying does not change your result or
              consume an attempt.
            </p>
          )}
          <div className="my-3 flex flex-wrap items-center justify-between gap-2">
            <strong>
              {Math.floor(remainingSeconds / 60)}:
              {String(remainingSeconds % 60).padStart(2, '0')} remaining
            </strong>
            <Button
              size="sm"
              variant="outline"
              disabled={
                frame.sessionFinished ||
                Boolean(frame.opening) ||
                !certificationSessionReady
              }
              onClick={() => {
                if (session.snapshot().sessionFinished) return;
                session.endSession();
                recordReplayOperation(session, { op: 'end' });
                setRunning(false);
                sync();
              }}
            >
              {certification
                ? 'End attempt early · cannot qualify'
                : 'End match & see results'}
            </Button>
          </div>
          {frame.sessionFinished && (
            <section
              className="referee-feedback referee-feedback-good"
              aria-label="Referee match results"
            >
              <h2 ref={resultsHeading} tabIndex={-1}>
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
                {certification
                  ? 'Each situation counts once. Certification accuracy uses the first unaided outcome; hints and answer assistance were unavailable.'
                  : 'Each situation counts once. Accuracy = correct ÷ (correct + wrong + missed). Hints are unlimited; assisted situations are listed separately.'}
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
          {frame.sessionFinished && frame.trainingMode === 'continuous' && (
            <section
              className="referee-match-review"
              aria-label="Decision timeline"
            >
              <div className="referee-match-review-heading">
                <div>
                  <p className="rule-kicker">FULL MATCH REVIEW</p>
                  <h2>Decision timeline</h2>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    openMatchReplay(
                      frame.review[0]?.replayAt ?? 0,
                      frame.review[0]?.id ?? null,
                    )
                  }
                >
                  <Play /> Review full match
                </Button>
              </div>
              <p>
                This is the match as your calls changed it. Select any row to
                jump to that moment; corrections remain separate decisions.
              </p>
              {frame.review.length ? (
                <div className="referee-review-list">
                  {frame.review.map((event) => (
                    <article
                      key={event.id}
                      className={cn(
                        'referee-review-event',
                        `referee-review-event-${event.assessment}`,
                        event.id === reviewEventId &&
                          'referee-review-event-selected',
                      )}
                    >
                      <button
                        type="button"
                        aria-current={
                          event.id === reviewEventId ? 'step' : undefined
                        }
                        onClick={() =>
                          openMatchReplay(event.replayAt, event.id)
                        }
                      >
                        <span className="referee-review-time">
                          {clock(event.at)}
                        </span>
                        <span className="referee-review-verdict">
                          {assessmentLabel(event.assessment)}
                        </span>
                        <strong>{event.situation}</strong>
                        <small>{event.evidence}</small>
                        <span>
                          <b>You:</b>{' '}
                          {event.actual
                            ? callLabel(event.actual)
                            : 'No call within the decision window'}
                        </span>
                        <span>
                          <b>Expected:</b>{' '}
                          {event.expected.map(callLabel).join(' or ')}
                        </span>
                        <small>{event.effect}</small>
                        {event.actual && event.at - event.eventAt > 0.5 && (
                          <small>
                            Situation first observed at {clock(event.eventAt)}.
                          </small>
                        )}
                      </button>
                      <a
                        href={event.rule}
                        onClick={(click) => {
                          if (
                            onOpenRule &&
                            !click.ctrlKey &&
                            !click.metaKey &&
                            !click.shiftKey
                          ) {
                            click.preventDefault();
                            onOpenRule(
                              'soccer:' + new URL(event.rule).hash.slice(1),
                            );
                          }
                        }}
                      >
                        Open rule <ExternalLink className="size-3" />
                      </a>
                    </article>
                  ))}
                </div>
              ) : (
                <p>No referee decisions or missed calls were recorded.</p>
              )}
            </section>
          )}
          {frame.trainingMode === 'continuous' &&
            !frame.opening &&
            !frame.sessionFinished && (
              <p className="referee-assistance-note">
                Use Pause or Space to think; the clock and all motion freeze.
                Make any sequence of decisions, then resume when ready. Nothing
                is marked right or wrong until the post-match review.
              </p>
            )}
          {!frame.opening && (
            <p className="referee-end-note">
              Blue → {frame.blueAttackDirection === 1 ? 'yellow' : 'blue'} goal
              · Yellow → {frame.blueAttackDirection === 1 ? 'blue' : 'yellow'}{' '}
              goal
            </p>
          )}

          {!certification && (
            <Button
              className="referee-replay-button"
              variant="outline"
              disabled={!ready || !frame.canReplayLast}
              onClick={() => {
                const recording = session.getLastReplay();
                if (recording) {
                  setReplay(recording);
                  setReplayKind('situation');
                  setReviewEventId(null);
                  seekReplay(0);
                  setReplayRunning(true);
                }
              }}
            >
              <RotateCcw /> Replay last situation
            </Button>
          )}

          {!certification &&
            frame.trainingMode === 'continuous' &&
            !frame.help &&
            !frame.opening &&
            !frame.sessionFinished && (
              <Button
                variant="outline"
                onClick={() => {
                  session.pauseForDecision();
                  recordReplayOperation(session, { op: 'pause' });
                  session.whistle();
                  recordReplayOperation(session, { op: 'whistle' });
                  if (session.requestHint())
                    recordReplayOperation(session, {
                      op: 'hint',
                      reveal: false,
                    });
                  setRunning(false);
                  sync();
                }}
              >
                <Lightbulb /> Pause & get a hint
              </Button>
            )}
          {!certification &&
            frame.help &&
            !frame.opening &&
            !frame.sessionFinished && (
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
                      if (session.requestHint())
                        recordReplayOperation(session, {
                          op: 'hint',
                          reveal: false,
                        });
                      sync();
                    }}
                  >
                    <Lightbulb /> {frame.help.level ? 'More help' : 'Hint'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!ready || frame.resolving}
                    onClick={() => {
                      if (session.requestHint(true))
                        recordReplayOperation(session, {
                          op: 'hint',
                          reveal: true,
                        });
                      sync();
                    }}
                  >
                    Show answer
                  </Button>
                  <Button
                    disabled={!ready || frame.resolving}
                    onClick={() => {
                      if (session.resolveForMe())
                        recordReplayOperation(session, { op: 'resolve' });
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

          {((!certification && frame.drillReady && canNext) ||
            frame.canArrangeKickoff ||
            frame.kickoffReturns.length > 0) && (
            <section className="referee-checkpoint" aria-live="polite">
              <h2>
                {frame.kickoffReturns.length > 0
                  ? 'Optional returns before kickoff'
                  : frame.canArrangeKickoff
                    ? 'Kickoff needs your signal'
                    : 'Next practice situation is ready'}
              </h2>
              <p>
                {frame.kickoffReturns.length > 0
                  ? 'Eligible robots may return with your permission, or remain off the field. Arrange the kickoff when the teams are ready.'
                  : frame.canArrangeKickoff
                    ? 'Check any return requests, then arrange the kickoff. The field stays here until you press the button.'
                    : 'The match keeps playing. Start another situation when you want to load a new practice layout.'}
              </p>
              <Button
                disabled={!ready}
                onClick={() => {
                  if (frame.canArrangeKickoff) {
                    if (session.arrangeKickoff()) {
                      recordReplayOperation(session, {
                        op: 'arrange-kickoff',
                      });
                      sync();
                      setRunning(false);
                      setGroup((current) => {
                        if (current !== 'restart')
                          preKickoffGroup.current = current;
                        return 'restart';
                      });
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
                    recordReplayOperation(session, {
                      op: 'resume-evidence',
                    });
                    sync();
                    setRunning(true);
                  }
                }}
              >
                <Play /> Resume observation
              </Button>
            </section>
          )}

          {frame.trainingMode === 'continuous' &&
            !frame.sessionFinished &&
            frame.history[0] && (
              <section
                className="referee-action-receipt"
                aria-live="polite"
                aria-label="Latest referee action"
              >
                <small>{clock(frame.history[0].at)} · Decision recorded</small>
                <strong>{frame.history[0].call}</strong>
                <p>{frame.history[0].detail}</p>
              </section>
            )}

          {frame.trainingMode === 'step' &&
            frame.feedback &&
            !frame.sessionFinished && (
              <section
                className={cn(
                  'referee-feedback',
                  supported
                    ? 'referee-feedback-good'
                    : 'referee-feedback-retry',
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
                      <BookOpen className="size-4" /> Rules applied to this
                      answer
                    </h3>
                    <ul>
                      {frame.feedback.appliedRules.map((rule) => (
                        <li key={rule.id}>
                          <small>
                            {rule.document} · §{rule.number}
                          </small>
                          <h4>{rule.provision}</h4>
                          <span>{rule.title}</span>
                          {rule.quote && (
                            <blockquote>“{rule.quote}”</blockquote>
                          )}
                          {rule.note && <p>{rule.note}</p>}
                          <div className="referee-rule-links">
                            <a
                              href={appendLocaleToSearch(
                                rule.lessonUrl,
                                locale,
                                { robot: robotVisual },
                              )}
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
                          'soccer:' +
                            new URL(frame.feedback!.rule).hash.slice(1),
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
                    recordReplayOperation(session, { op: 'continue' });
                    sync();
                    setRunning(session.canAdvance);
                  }}
                >
                  {frame.feedback.final
                    ? frame.pendingDecisions > 0
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
                  aria-label={`${robot.label}, ${frame.bench.some((item) => item.robot === robot.id) ? 'off field' : 'on field'}`}
                  onClick={() => setTarget(robot.id)}
                  className={
                    robot.team === 'blue' ? 'text-sky-300' : 'text-amber-300'
                  }
                >
                  {robot.label}
                  <small>
                    {frame.bench.some((item) => item.robot === robot.id)
                      ? 'OFF'
                      : 'ON'}
                  </small>
                </Button>
              ))}
            </div>
          </div>
          <NativeSelect
            aria-label="Referee action category"
            value={group}
            onChange={(e) => {
              preKickoffGroup.current = null;
              setGroup(e.target.value);
            }}
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
                    {frame.trainingMode === 'continuous'
                      ? 'Return now'
                      : 'Return'}
                  </Button>
                </div>
              ))}
              <p>
                {frame.trainingMode === 'continuous'
                  ? 'Return now always follows your decision, even if the robot is not yet eligible. That judgment is reviewed after full time.'
                  : 'Return needs your permission. Timers use simulated play time; a new kickoff can allow an earlier return.'}
              </p>
            </section>
          )}

          {frame.trainingMode === 'step' && !certification && (
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
            <summary>Recent decisions ({frame.history.length})</summary>
            {!frame.history.length && <p>Your decisions will appear here.</p>}
            {frame.history.slice(0, 12).map((item, index) => (
              <div key={index} className="referee-history">
                <strong>{item.call}</strong>
                <small>
                  {frame.trainingMode === 'continuous' && !frame.sessionFinished
                    ? clock(item.at)
                    : item.verdict.replace('-', ' ')}
                </small>
                <p>{item.detail}</p>
              </div>
            ))}
          </details>
        </div>
      </aside>
    </div>
  );
}
