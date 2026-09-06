/** Shared, serialisable contracts for the browser simulator and referee trainer. */

export type SimulatorMode = 'rules' | 'play' | 'referee';

export type CameraPreset =
  | 'broadcast'
  | 'referee'
  | 'overhead'
  | 'ball'
  | 'blue-robot'
  | 'yellow-robot'
  | 'free';

export type Team = 'blue' | 'yellow' | 'neutral';
export type ActorKind = 'robot' | 'ball';

/** Metres and radians; +x is field-right, +z points from blue to yellow. */
export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

export interface ActorDefinition {
  id: string;
  label: string;
  kind: ActorKind;
  team: Team;
  initial: Pose;
  number?: number;
  /** Whether the procedural robot proxy should show a powered front roller. */
  poweredDribbler?: boolean;
}

export type MetricStatus = 'neutral' | 'good' | 'warn' | 'bad';

export interface FrameMetric {
  label: string;
  value: string;
  status: MetricStatus;
}

export type EvidenceKind = 'objective' | 'judgment' | 'policy';

export interface ScenarioEvidence {
  kind: EvidenceKind;
  text: string;
}

/**
 * A visual attachment used by deterministic rule replays. A frame can name
 * either one owner or no owner, so two robots can never hold the single ball
 * at the same time.
 */
export interface BallPossession {
  ownerId: string;
  /** Distance from the owner's centre along its forward axis, in metres. */
  forwardOffsetM: number;
  /** Distance along the owner's right axis, in metres. */
  lateralOffsetM?: number;
}

export interface ScenarioFrame {
  actors: Record<string, Pose>;
  /** Null while the ball is moving freely. */
  ballPossession: BallPossession | null;
  metrics: Record<string, FrameMetric>;
  phaseLabel: string;
  /** Short, viewer-facing observations valid at this instant. */
  evidence: string[];
  /** Structured form used when the UI needs to separate facts from judgment. */
  evidenceDetails?: ScenarioEvidence[];
}

export type RefereeGrade = 'correct' | 'acceptable' | 'partial' | 'incorrect';

export interface RefereeChoice {
  id: string;
  label: string;
  grade: RefereeGrade;
  /** Normalised score in the inclusive range 0–1. */
  score: number;
  feedback: string;
}

export interface RuleReference {
  section: string;
  url: string;
  /** A deliberate caveat when interpretation or local procedure is involved. */
  note?: string;
}

export type ScenarioCategory =
  | 'ball-control'
  | 'penalty-area'
  | 'contact'
  | 'goal';

export type OverlayFlag =
  | 'actor-labels'
  | 'ball-trail'
  | 'capture-plane'
  | 'contact-point'
  | 'contact-vector'
  | 'penalty-areas'
  | 'neutral-placement'
  | 'goal-plane'
  | 'goal-back-wall'
  | 'timers';

export interface ScenarioDefinition {
  id: string;
  title: string;
  shortTitle: string;
  ruleRef: RuleReference;
  category: ScenarioCategory;
  publicSummary: string;
  refereeCue: string;
  duration: number;
  actors: ActorDefinition[];
  overlays: OverlayFlag[];
  choices: RefereeChoice[];
  defaultCamera?: CameraPreset;
  sample: (timeSeconds: number) => ScenarioFrame;
}
