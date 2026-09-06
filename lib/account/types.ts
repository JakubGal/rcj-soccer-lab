import type {
  MatchReplay,
  MatchReplayCheckpoint,
} from '../certification/replay';
import type { RobotVisualId } from '../simulator/robot-models';

export type AccountLoadStatus =
  | 'loading'
  | 'authenticated'
  | 'guest'
  | 'unavailable';

export type AcademyPage = 'profile' | 'certification' | 'referees';
export type CertificationMode = 'step' | 'continuous';
export type CertificationStatus =
  | 'not-started'
  | 'in-progress'
  | 'ready'
  | 'qualified'
  | 'failed'
  | 'upgrade-required'
  | 'restarted';

export type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  country: string;
  refereeNumber: string;
  publicProfile: boolean;
  createdAt: string | null;
};

export type PracticeStats = {
  ruleChecksCompleted: number;
  ruleChecksTotal: number;
  refereeGamesPlayed: number;
  stepGamesPlayed: number;
  continuousGamesPlayed: number;
  stepAccuracy: number | null;
  continuousAccuracy: number | null;
  completedQuestionIds: string[];
};

export type RulesCertificationProgress = {
  answered: number;
  total: number;
  correctFirstTry: number;
  accuracy: number | null;
  requiredAccuracy: number;
  passed: boolean;
  answeredQuestionIds: string[];
};

export type CertificationGameAttempt = {
  id: string;
  mode: CertificationMode;
  attemptNumber: number;
  durationSeconds: number;
  accuracy: number | null;
  correct: number;
  wrong: number;
  missed: number;
  assisted: number;
  completed: boolean;
  qualifying: boolean;
  startedAt: string | null;
  completedAt: string | null;
  inProgress?: boolean;
  canReview?: boolean;
};

export type GameCertificationProgress = {
  mode: CertificationMode;
  requiredGames: number;
  qualifyingGames: number;
  attemptsUsed: number;
  attemptsAllowed: number;
  requiredAccuracy: number;
  durationSeconds: number;
  passed: boolean;
  attempts: CertificationGameAttempt[];
};

export type CertificationRound = {
  id: string;
  number: number;
  season: string;
  status: CertificationStatus;
  startedAt: string | null;
  completedAt: string | null;
  rules: RulesCertificationProgress;
  step: GameCertificationProgress;
  continuous: GameCertificationProgress;
  policyVersion?: string;
};

export type PracticeGame = {
  id: string;
  mode: CertificationMode;
  durationSeconds: number;
  accuracy: number | null;
  completedAt: string | null;
  canReview?: boolean;
};

export type CertificationHistoryEntry = {
  id: string;
  roundNumber: number;
  season: string;
  status: CertificationStatus;
  startedAt: string | null;
  completedAt: string | null;
};

export type AccountLinks = {
  signIn: string | null;
  signOut: string | null;
};

export type AccountSnapshot = {
  authenticated: boolean;
  profile: AccountProfile | null;
  practice: PracticeStats;
  certification: CertificationRound | null;
  recentGames: PracticeGame[];
  certificationHistory: CertificationHistoryEntry[];
  links: AccountLinks;
};

export type AccountProfilePatch = {
  displayName: string;
  country: string;
  publicProfile: boolean;
};

export type StartGamePayload = {
  roundId?: string;
  mode: CertificationMode;
  purpose?: 'certification' | 'practice';
  clientSessionId?: string;
  seed?: number;
  durationSeconds?: number;
  topics?: readonly string[];
  robotVisual?: RobotVisualId;
};

export type CertificationGameLaunch = {
  attemptId: string;
  roundId: string;
  mode: CertificationMode;
  seed: number;
  durationSeconds: number;
  topics: string[];
  startedAt: string | null;
  clientSessionId: string | null;
  attemptNumber?: number;
  robotVisual?: RobotVisualId;
  checkpoint?: MatchReplayCheckpoint;
};

export type FinishGamePayload = {
  elapsedSeconds: number;
  correct: number;
  wrong: number;
  missed: number;
  assisted: number;
  accuracy: number | null;
  replay?: MatchReplay;
  decisionLog?: unknown[];
  purpose?: 'certification' | 'practice';
};

export type CertifiedReferee = {
  refereeNumber: string;
  displayName: string;
  country: string;
  season: string;
  certifiedAt: string | null;
  status: 'certified' | 'expired' | 'unknown';
  verificationCode: string;
};

export type CertifiedRefereeDirectory = {
  referees: CertifiedReferee[];
  total: number;
  nextCursor: string | null;
};

export type AccountActionResult<T = AccountSnapshot> = {
  data: T;
  message: string | null;
};
