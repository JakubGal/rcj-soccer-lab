import type {
  TrainingMode,
  TrainingTopic,
} from '@/lib/simulator/referee-training';
import type { RefereeCall } from '@/lib/simulator/referee-cases';

export type MaybePromise<T> = T | Promise<T>;

export type RuleLearningMode = 'practice' | 'certification';
export type RuleLearningKind = 'case' | 'clip' | 'scenario';
export type CanonicalRuleAnswer =
  | { kind: 'clip'; selectedIndex: number }
  | { kind: 'scenario'; choiceId: string }
  | { kind: 'case'; calls: RefereeCall[] };

/**
 * Browser-side learning telemetry. The server remains authoritative: answer
 * correctness and first-attempt status must be recalculated or constrained by
 * an idempotent server write.
 */
export type RuleLearningEvent =
  | {
      type: 'answer';
      mode: RuleLearningMode;
      certificationRunId: string | null;
      questionId: string;
      sourceId: string;
      kind: RuleLearningKind;
      decisionId: string;
      answer: CanonicalRuleAnswer;
      attemptNumber: number;
      firstAnswer: boolean;
      accepted: boolean;
      score: number;
      completed: boolean;
      assisted: boolean;
    }
  | {
      type: 'assistance';
      mode: RuleLearningMode;
      certificationRunId: string | null;
      questionId: string;
      sourceId: string;
      kind: RuleLearningKind;
      decisionId: string;
      assistance: 'hint' | 'show-answer' | 'resolve-for-me';
    }
  | {
      type: 'complete';
      mode: RuleLearningMode;
      certificationRunId: string | null;
      questionId: string;
      sourceId: string;
      kind: RuleLearningKind;
      answer: CanonicalRuleAnswer;
      firstTryCorrect: boolean;
      assisted: boolean;
    };

/** Optional account/certification bridge for the otherwise local Rulebook. */
export type RuleLearningBridge = {
  mode?: RuleLearningMode;
  certificationRunId?: string | null;
  /** Eventual completions restored from the account or active certification. */
  completedSituationIds?: readonly string[];
  onEvent?: (event: RuleLearningEvent) => MaybePromise<void>;
};

export const CERTIFICATION_MATCH_DURATION_SECONDS = 600 as const;

export type RefereeCertificationAttempt = {
  attemptId: string;
  certificationRunId: string;
  mode: TrainingMode;
  /** The attempt seed must be issued by the server, never chosen in the UI. */
  seed: number;
  attemptNumber?: number;
  maxAttempts?: number;
};

export type RefereeCertificationStartRequest = {
  certificationRunId: string;
  mode: TrainingMode;
  durationSeconds: typeof CERTIFICATION_MATCH_DURATION_SECONDS;
  topics: readonly TrainingTopic[];
};

export type RefereeCertificationFinishPayload = {
  attemptId: string;
  certificationRunId: string;
  mode: TrainingMode;
  seed: number;
  durationSeconds: typeof CERTIFICATION_MATCH_DURATION_SECONDS;
  simulatedSeconds: number;
  completionReason: 'full-time' | 'ended-early';
  eligibleForScoring: boolean;
  topics: readonly TrainingTopic[];
  report: {
    correct: number;
    wrong: number;
    missed: number;
    assisted: number;
    assessed: number;
    accuracy: number | null;
  };
};

export type RefereePracticeSessionStartPayload = {
  clientSessionId: string;
  mode: TrainingMode;
  seed: number;
  durationSeconds: number;
  topics: readonly TrainingTopic[];
};

export type RefereePracticeSessionFinishPayload =
  RefereePracticeSessionStartPayload & {
    simulatedSeconds: number;
    completionReason: 'full-time' | 'ended-early';
    report: RefereeCertificationFinishPayload['report'];
  };

/** Optional account bridge for ordinary logged-in practice games. */
export type RefereePracticeTrackingBridge = {
  onStartSession?: (
    session: RefereePracticeSessionStartPayload,
  ) => MaybePromise<void>;
  onFinishSession?: (
    result: RefereePracticeSessionFinishPayload,
  ) => MaybePromise<void>;
};

/**
 * A certification session is explicitly started. This lets the server consume
 * an attempt and return its seed before any match state is created.
 */
export type RefereeCertificationBridge = {
  certificationRunId: string;
  mode: TrainingMode;
  attempt?: RefereeCertificationAttempt | null;
  onStartAttempt: (
    request: RefereeCertificationStartRequest,
  ) => MaybePromise<RefereeCertificationAttempt>;
  onFinishAttempt: (
    result: RefereeCertificationFinishPayload,
  ) => MaybePromise<void>;
};
