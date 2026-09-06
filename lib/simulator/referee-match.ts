import { SoccerMatch, MATCH_STEP, MATCH_ROBOTS, type MatchTeam } from './match';
import { NEUTRAL_SPOTS } from '../rulebook/animations';
import { RCJ_FIELD_DERIVED as FIELD, RCJ_SIMULATOR_GUIDES } from './field-spec';
import { clonePoses, MANUAL_ROBOT_BALL_CENTER_DISTANCE } from './manual-layout';
import type { Pose } from './types';
import type { DamageCue } from './damage-effects';
import {
  SituationRecorder,
  type ReplayFrame,
  type SituationReplay,
} from './situation-replay';
import { KickoffMeeting, randomKickoff, type GoalEnd } from './kickoff';
import {
  clampRobotToField,
  insidePenalty,
  robotPenaltyOverlap,
  robotTouchesFieldWall,
} from './referee-geometry';
import { rulesForDecision, type AppliedRule } from './referee-rules';
import { DEFAULT_ROBOT_VISUAL_ID, type RobotVisualId } from './robot-models';
import { ContinuousDirector } from './continuous-director';
import { COMMITTEE_TRAINING_POLICY } from './training-policy';
import {
  RefereeScore,
  TRAINING_TOPICS,
  trainingTopic,
  type TrainingMode,
  type TrainingTopic,
  type Assessment,
} from './referee-training';
export { insidePenalty } from './referee-geometry';
import {
  REFEREE_CASES,
  REFEREE_ACTIONS,
  IncidentBag,
  caseScene,
  evidenceDuration,
  requiresStoppage,
  ruleUrl,
  transformId,
  transformText,
  type RefereeCase,
  type RefereeCall,
  type RequiredCall,
  type Variant,
} from './referee-cases';

export type BenchEntry = {
  robot: string;
  reason: string;
  removedAt: number;
  eligibleAt: number;
  /** Deterministic simulated team-repair cue; never a rules-based repair timer. */
  readyAt: number;
  ready: boolean;
  repairReportedAt?: number;
  kickoff: number;
};
export type CallFeedback = {
  verdict: 'correct' | 'supported' | 'wrong-target' | 'incorrect' | 'premature';
  title: string;
  detail: string;
  effect: string;
  rule: string;
  appliedRules: AppliedRule[];
  final: boolean;
};
export type MatchReviewAssessment =
  | 'correct'
  | 'supported'
  | 'wrong-action'
  | 'wrong-target'
  | 'premature'
  | 'correction'
  | 'assisted'
  | 'missed'
  | 'not-scored';
export type MatchReviewEvent = {
  id: number;
  at: number;
  eventAt: number;
  replayAt: number;
  incidentId: number;
  situation: string;
  evidence: string;
  topic: TrainingTopic;
  actual: RefereeCall | null;
  expected: RefereeCall[];
  assessment: MatchReviewAssessment;
  effect: string;
  detail: string;
  rule: string;
  scored: boolean;
};
type ActiveIncident = {
  definition: RefereeCase;
  variant: Variant;
  number: number;
  step: number;
  time: number;
  natural: boolean;
  mistakes: boolean;
  assisted: boolean;
  hintLevel: number;
  finished: boolean;
  permitContact?: boolean;
  releaseAfterCall?: boolean;
  stopsPlay: boolean;
  progressResumed?: boolean;
  replay: SituationReplay | null;
  key: string;
  initial: Record<string, Pose>;
  observedAt?: number;
  lastSeen?: number;
  replayAt?: number;
  scoreNeutral?: boolean;
  scoreTopic?: TrainingTopic;
  /** Calls shown by the field evidence when this reaction window opened. */
  reactionExpected?: RequiredCall[];
  reactionStartedAt?: number;
  reactionDeadline?: number;
  reactionPersistent?: boolean;
  reactionReplayAt?: number;
  /** Ball-passage identity for causally linking unresolved pushing to a goal. */
  ballPassageRevision?: number;
};
export type TrainingPhase =
  | 'live'
  | 'evidence'
  | 'decision'
  | 'feedback'
  | 'ready';
const unchanged: Variant = { swap: false, reflect: false };
const MATCH_REPLAY_SAMPLE = 1 / 8;
/** Ordinary live geometry must persist for this long before a missed call. */
export const CONTINUOUS_REACTION_SECONDS = 3;
/** Irreversible goal/removal/return obligations retain the existing longer window. */
export const CONTINUOUS_OBLIGATION_REACTION_SECONDS = 8;
/** Treat practically equal simulated distances as an untied referee choice. */
export const DEFENDER_DISTANCE_TIE_TOLERANCE = 0.001;
const distance = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.z - b.z);
const robotName = (id: string) =>
  MATCH_ROBOTS.find((item) => item.id === id)?.label ??
  (id === 'blue' ? 'Blue' : id === 'yellow' ? 'Yellow' : id);
const teamOf = (id: string): MatchTeam =>
  id.startsWith('blue') ? 'blue' : 'yellow';

/** Conservative physics/setup envelope; not referee evidence of body overlap. */
export function penaltyOverlap(point: Pose, end: number, full = false) {
  const perimeter = Array.from({ length: 48 }, (_, i) => ({
    x: point.x + Math.cos((i * Math.PI) / 24) * 0.1,
    z: point.z + Math.sin((i * Math.PI) / 24) * 0.1,
    yaw: 0,
  }));
  return full
    ? perimeter.every((p) => insidePenalty(p, end))
    : insidePenalty(point, end) || perimeter.some((p) => insidePenalty(p, end));
}

/** Simulation-clock referee session; React never adjudicates or applies penalties. */
export class RefereeMatch {
  readonly match = new SoccerMatch();
  readonly bag: IncidentBag;
  private currentPhase: TrainingPhase = 'live';
  get phase() {
    return this.currentPhase;
  }
  set phase(value: TrainingPhase) {
    this.currentPhase = value;
    this.syncMotion();
  }
  clock = 0;
  bench: Record<string, BenchEntry> = {};
  feedback: CallFeedback | null = null;
  completed: { id: string; family: string; correct: boolean }[] = [];
  history: {
    call: string;
    verdict: CallFeedback['verdict'];
    detail: string;
    at: number;
  }[] = [];
  private active: ActiveIncident | null = null;
  private serial = 0;
  private kickoffSerial = 0;
  private kickoffDue = false;
  private kickoffTeam: MatchTeam | 'neutral' = 'neutral';
  private opponentDamage = false;
  private waitingFor = 0;
  private untilIncident = 3;
  private heights: Record<string, number> = {};
  private countFor: number | null = null;
  private countCompleted = false;
  private completedCount = 0;
  private correctCount = 0;
  private assistedCount = 0;
  private resolving: number | null = null;
  private damage: DamageCue | null = null;
  private damageSerial = 0;
  private permittedContact: string | null = null;
  private manualHold = false;
  private pending: ActiveIncident[] = [];
  private countAnchor: Pose | null = null;
  private recorder = new SituationRecorder();
  private recordingTime = 0;
  private recordingTick = 0;
  private drillReady = false;
  private fixtureEnded = false;
  private outRobots = new Set<string>();
  readonly meeting: KickoffMeeting;
  robotVisual: RobotVisualId;
  private readonly robotVisualLocked: boolean;
  private opening = false;
  readonly mode: TrainingMode;
  readonly duration: number;
  readonly topics: readonly TrainingTopic[];
  private trainingElapsed = 0;
  private trainingTicks = 0;
  private sessionFinished = false;
  private userPaused = false;
  private score = new RefereeScore();
  private observations = new Map<string, ActiveIncident>();
  private director: ContinuousDirector;
  private reviewEvents: MatchReviewEvent[] = [];
  private reviewSerial = 0;
  private reviewedNoCalls = new Set<number>();
  private matchFrames: ReplayFrame[] = [];
  private lastSampledMatchTime = Number.NEGATIVE_INFINITY;
  private readonly recordMatchReplay: boolean;
  private invalidGoalPassage: { robot: string; team: MatchTeam } | null = null;
  private multipleDefenseOffenses: Record<MatchTeam, number> = {
    blue: 0,
    yellow: 0,
  };

  private simulatedRepairDelay(robot: string) {
    // Deliberately varied fixture timing. The rule requires the robot to be
    // repaired; it does not say repair is completed after a fixed duration.
    const robotSalt = Array.from(robot).reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    );
    return 15 + (Math.abs(this.seed * 17 + this.serial * 13 + robotSalt) % 31);
  }

  private assess(item: ActiveIncident, result: Assessment) {
    const topic = item.scoreTopic ?? trainingTopic(item.definition);
    const scored = !item.scoreNeutral && this.topics.includes(topic);
    const alreadyScored = this.score.has(item.number);
    if (scored)
      this.score.record(
        item.number,
        topic,
        item.assisted ? 'assisted' : result,
        item.definition.title,
      );
    if (
      this.mode === 'continuous' &&
      result === 'missed' &&
      !this.reviewedNoCalls.has(item.number)
    ) {
      this.reviewedNoCalls.add(item.number);
      const expected = this.reviewExpected(item).map(({ action, target }) => ({
        action,
        ...(target ? { target } : {}),
      }));
      if (expected.length)
        this.reviewEvents.push({
          id: ++this.reviewSerial,
          at:
            item.reactionReplayAt ??
            item.replayAt ??
            item.observedAt ??
            this.trainingElapsed,
          eventAt:
            item.reactionReplayAt ??
            item.replayAt ??
            item.observedAt ??
            this.trainingElapsed,
          replayAt:
            item.reactionReplayAt ??
            item.replayAt ??
            this.currentMatchReplayTime,
          incidentId: item.number,
          situation: item.definition.title,
          evidence: transformText(item.definition.facts, item.variant),
          topic,
          actual: null,
          expected,
          assessment: item.assisted
            ? 'assisted'
            : scored
              ? 'missed'
              : 'not-scored',
          effect: 'No referee action changed the match.',
          detail: scored
            ? 'No matching call was made within the available decision window.'
            : 'This situation was recorded for review but was outside the selected scoring topics.',
          rule: ruleUrl(item.definition),
          scored,
        });
    }
    return scored && !alreadyScored;
  }
  /** The pause is a thinking aid, not a graded call. Simulation time freezes too. */
  pauseForDecision() {
    if (this.sessionFinished) return;
    this.userPaused = true;
    this.syncMotion();
  }
  endSession() {
    if (this.sessionFinished) return;
    for (const item of new Set([
      this.active,
      ...this.pending,
      ...this.observations.values(),
    ])) {
      if (!item || item.finished) continue;
      // Full time never penalizes an incident before its explicit reaction
      // deadline. This is training assessment timing, not an official stoppage.
      const seen =
        item.natural || item.time >= evidenceDuration(item.definition);
      if (!this.requiredIncident(item)) continue;
      const enoughTime =
        (this.mode === 'step' && seen) ||
        (item.reactionDeadline !== undefined &&
          this.clock + 1e-8 >= item.reactionDeadline);
      if (enoughTime) this.assess(item, item.mistakes ? 'wrong' : 'missed');
      else if (
        this.mode === 'continuous' &&
        !item.mistakes &&
        !this.reviewedNoCalls.has(item.number)
      ) {
        this.reviewedNoCalls.add(item.number);
        const expected = this.reviewExpected(item).map(
          ({ action, target }) => ({
            action,
            ...(target ? { target } : {}),
          }),
        );
        if (expected.length)
          this.reviewEvents.push({
            id: ++this.reviewSerial,
            at:
              item.reactionReplayAt ??
              item.replayAt ??
              this.currentMatchReplayTime,
            eventAt:
              item.reactionReplayAt ??
              item.replayAt ??
              this.currentMatchReplayTime,
            replayAt:
              item.reactionReplayAt ??
              item.replayAt ??
              this.currentMatchReplayTime,
            incidentId: item.number,
            situation: item.definition.title,
            evidence: transformText(item.definition.facts, item.variant),
            topic: item.scoreTopic ?? trainingTopic(item.definition),
            actual: null,
            expected,
            assessment: 'not-scored',
            effect: 'No referee action changed the match.',
            detail:
              'Not scored: the incident appeared too late to reach its defined reaction deadline before full time.',
            rule: ruleUrl(item.definition),
            scored: false,
          });
      }
    }
    this.sessionFinished = true;
    this.resolving = null;
    this.capture(true);
    this.recorder.seal(
      'Final passage of play',
      'Review the final passage before full time.',
    );
    this.syncMotion();
  }
  private callsRequireAction(calls: readonly RequiredCall[]) {
    return calls.some(
      (c) =>
        !['play-on', 'resume', 'wait', 'keep-out'].includes(c.action) &&
        (!c.discretionary || c.action === 'multiple'),
    );
  }
  private requiredIncident(item: ActiveIncident) {
    return (
      !item.progressResumed &&
      this.callsRequireAction(
        item.reactionExpected ?? item.definition.steps.slice(item.step).flat(),
      )
    );
  }
  private reviewExpected(item: ActiveIncident) {
    return (
      item.reactionExpected?.map((call) => ({ ...call })) ??
      this.expectedFor(item).map((call) => ({ ...call }))
    );
  }
  private armReaction(item: ActiveIncident) {
    if (this.mode !== 'continuous') return;
    const calls = this.expectedFor(item).map((call) => ({ ...call }));
    const persistent = calls.some((call) =>
      ['out', 'damaged', 'goal', 'no-goal', 'return'].includes(call.action),
    );
    item.reactionExpected = calls;
    item.reactionStartedAt = this.clock;
    item.reactionReplayAt = this.currentMatchReplayTime;
    item.reactionPersistent = persistent;
    item.reactionDeadline =
      this.clock +
      (persistent
        ? CONTINUOUS_OBLIGATION_REACTION_SECONDS
        : CONTINUOUS_REACTION_SECONDS);
  }
  private retireObservation(item: ActiveIncident, assessMiss = true) {
    if (!item.finished && assessMiss && this.requiredIncident(item))
      this.assess(item, item.mistakes ? 'wrong' : 'missed');
    item.finished = true;
    this.pending = this.pending.filter((x) => x !== item);
    if (
      this.active === item &&
      this.phase !== 'feedback' &&
      this.countFor === null
    ) {
      this.active = this.pending.shift() ?? null;
      this.phase = this.active ? 'decision' : 'live';
    }
  }
  private ageObservations() {
    for (const [key, item] of this.observations) {
      const absent = this.clock - (item.lastSeen ?? this.clock);
      const conditionPresent = absent <= MATCH_STEP * 2 + 1e-8;
      if (
        !item.finished &&
        !this.manualHold &&
        !this.userPaused &&
        this.countFor === null
      ) {
        if (!item.reactionPersistent && !conditionPresent) {
          // A transient geometry cue that clears before the reaction deadline
          // is not a missed infringement. Keep the observation briefly only to
          // debounce re-detection of the same physical passage.
          this.retireObservation(
            item,
            Boolean(
              item.reactionDeadline !== undefined &&
              this.clock + 1e-8 >= item.reactionDeadline,
            ),
          );
        } else if (
          item.reactionDeadline !== undefined &&
          this.clock + 1e-8 >= item.reactionDeadline &&
          this.requiredIncident(item)
        )
          this.assess(item, item.mistakes ? 'wrong' : 'missed');
      }
      // Rearm only after a resolved condition has actually cleared.
      if (item.finished && absent > 1) this.observations.delete(key);
    }
  }

  /** Trainer pause is separate from a stoppage required by the match rules. */
  private get decisionPaused() {
    if (this.mode === 'continuous') return false;
    const observingCount =
      this.countFor !== null &&
      (this.phase !== 'feedback' ||
        ['correct', 'supported'].includes(this.feedback?.verdict ?? ''));
    return Boolean(
      this.active &&
      this.phase !== 'evidence' &&
      !observingCount &&
      !(this.active.finished && this.active.releaseAfterCall),
    );
  }

  get motionHeld() {
    return (
      this.userPaused ||
      this.sessionFinished ||
      this.manualHold ||
      this.opening ||
      this.fixtureEnded ||
      this.decisionPaused ||
      (this.phase !== 'evidence' &&
        (this.kickoffDue ||
          (this.mode !== 'continuous' && Boolean(this.active?.stopsPlay))))
    );
  }
  private syncMotion() {
    if (this.motionHeld) this.match.holdMotion();
    else this.match.releaseReferee();
  }
  get canResumeMotion() {
    if (this.sessionFinished || this.opening || this.fixtureEnded) return false;
    if (this.mode === 'continuous')
      return !this.kickoffDue || this.awaitingWorkingTeam;
    return (
      !this.manualHold &&
      !this.decisionPaused &&
      (this.phase === 'evidence' ||
        !this.kickoffDue ||
        (this.phase === 'live' && this.awaitingWorkingTeam)) &&
      (this.phase === 'evidence' || !this.active?.stopsPlay)
    );
  }
  resumeMotion() {
    if (!this.canResumeMotion) return;
    this.userPaused = false;
    if (this.mode === 'continuous') {
      this.manualHold = false;
      this.feedback = null;
    }
    this.syncMotion();
  }
  getLastReplay() {
    return this.recorder.getLast();
  }
  private get currentMatchReplayTime() {
    return this.matchFrames.at(-1)?.at ?? this.recordingTime;
  }
  private capture(actionBoundary = false) {
    const state = this.match.snapshot();
    const frame: ReplayFrame = {
      at: this.recordingTime,
      actors: state.actors,
      heights: this.heights,
      score: state.score,
      elapsed: state.elapsed,
      damage: this.damage,
    };
    this.recorder.capture(frame);
    if (this.mode === 'continuous' && this.recordMatchReplay) {
      const previous = this.matchFrames.at(-1);
      if (
        !actionBoundary &&
        previous &&
        this.recordingTime - this.lastSampledMatchTime <
          MATCH_REPLAY_SAMPLE - 1e-8
      )
        return previous.at;
      const at = actionBoundary
        ? Math.max(this.recordingTime, (previous?.at ?? -1) + 0.002)
        : Math.max(this.recordingTime, previous?.at ?? this.recordingTime);
      const fullFrame = structuredClone({ ...frame, at });
      if (!actionBoundary && previous?.at === at) this.matchFrames.pop();
      this.matchFrames.push(fullFrame);
      if (!actionBoundary) this.lastSampledMatchTime = this.recordingTime;
      return at;
    }
    return this.recordingTime;
  }
  private recordTick() {
    this.recordingTime += MATCH_STEP;
    if (++this.recordingTick % 4 === 0) this.capture();
  }
  private saveSituation(item: ActiveIncident) {
    this.noteOut(item);
    this.capture();
    item.replay = this.recorder.seal(
      item.definition.title,
      transformText(item.definition.facts, item.variant),
    );
  }
  getMatchReplay(): SituationReplay | null {
    if (this.mode !== 'continuous' || !this.matchFrames.length) return null;
    const frames = structuredClone(this.matchFrames);
    const start = frames[0].at;
    for (const frame of frames) frame.at -= start;
    const duration = Math.max(1, frames.at(-1)!.at);
    if (frames.at(-1)!.at < duration)
      frames.push({ ...structuredClone(frames.at(-1)!), at: duration });
    return {
      id: -1,
      title: 'Full match review',
      facts:
        'Replay the match exactly as your decisions changed it. Select a review event to compare your call with the expected decision.',
      duration,
      frames,
    };
  }
  private noteOut(item: ActiveIncident) {
    if (
      !['wall', 'full-area', 'out-goal'].includes(
        item.definition.id.replace(/^live-/, ''),
      )
    )
      return;
    for (const call of item.definition.steps.flat()) {
      if (call.action !== 'out' || !call.target) continue;
      const robot = transformId(call.target, item.variant);
      this.outRobots.add(robot);
      if (
        this.match.state.ballOwner === robot ||
        this.match.lastBallTouch === robot
      )
        this.invalidGoalPassage = {
          robot,
          team: teamOf(robot),
        };
    }
  }

  private refreshGoalPassage() {
    const passage = this.invalidGoalPassage;
    if (!passage) return;
    const touch = this.match.lastBallTouch;
    if (touch && touch !== passage.robot) {
      this.invalidGoalPassage = null;
      return;
    }
  }
  private skipResolvedSteps(item: ActiveIncident) {
    while (item.step < item.definition.steps.length) {
      const choices = item.definition.steps[item.step];
      if (
        this.mode === 'continuous' &&
        choices.every(
          (call) =>
            ['out', 'damaged'].includes(call.action) &&
            call.target &&
            !this.match.state.actors[transformId(call.target, item.variant)],
        )
      ) {
        item.step++;
        continue;
      }
      if (
        choices.every((call) => call.action === 'multiple') &&
        !this.multipleStillPresent(item)
      ) {
        item.step++;
        continue;
      }
      const resolved = choices.every((call) => {
        const target =
          call.target && !call.target.startsWith('farther')
            ? transformId(call.target, item.variant)
            : null;
        if (!target) return false;
        if (
          ['out', 'damaged', 'early-start', 'inspect', 'multiple'].includes(
            call.action,
          )
        )
          return !this.match.state.actors[target];
        if (['return', 'keep-out'].includes(call.action))
          return !this.bench[target];
        return false;
      });
      if (!resolved) break;
      item.step++;
    }
  }
  private incidentKey(definition: RefereeCase, variant: Variant) {
    const id = definition.id.replace(/^live-/, '');
    const target =
      definition.steps.flat().find((call) => call.target)?.target ?? '';
    const robot = target.startsWith('farther')
      ? (target.split(':')[1] ?? transformId('blue', variant))
      : transformId(target, variant);
    const kind = ['wall', 'full-area', 'pushed-out'].includes(id)
      ? 'out'
      : ['multiple', 'repeat-defense'].includes(id)
        ? 'multiple'
        : id.startsWith('return-')
          ? 'return'
          : id;
    return `${kind}:${robot}`;
  }

  private multipleDefenseTeam(definition: RefereeCase, variant: Variant) {
    const target = definition.steps
      .flat()
      .find((call) => call.action === 'multiple')?.target;
    if (!target) return null;
    return target.startsWith('farther')
      ? ((target.split(':')[1] ?? transformId('blue', variant)) as MatchTeam)
      : teamOf(transformId(target, variant));
  }

  /** A scored passage ends positional corrections, but not robot penalties. */
  private endScoredPassage() {
    this.invalidGoalPassage = null;
    const positional = new Set([
      'pushing',
      'multiple',
      'combined',
      'repeat-defense',
      'pushing-goal',
      'deadlock',
      'repeat-progress',
    ]);
    const obligations = new Set([
      'out',
      'damaged',
      'inspect',
      'early-start',
      'ball-out',
      'holding',
      'return',
      'keep-out',
      'pause',
      'interference',
    ]);
    this.pending = this.pending.filter((item) => {
      if (positional.has(item.definition.id.replace(/^live-/, ''))) {
        if (this.mode === 'continuous') {
          if (
            item.reactionDeadline !== undefined &&
            this.clock + 1e-8 >= item.reactionDeadline &&
            this.requiredIncident(item)
          )
            this.assess(item, item.mistakes ? 'wrong' : 'missed');
          item.finished = true;
        }
        return false;
      }
      this.skipResolvedSteps(item);
      if (
        ['interruption', 'spectator'].includes(
          item.definition.id.replace(/^live-/, ''),
        )
      )
        return item.step < item.definition.steps.length;
      return item.definition.steps
        .slice(item.step)
        .some((choices) =>
          choices.some((call) => obligations.has(call.action)),
        );
    });
    this.countFor = null;
    this.countCompleted = false;
    this.countAnchor = null;
    this.permittedContact = null;
  }

  private refreshProgress() {
    for (const item of [this.active, ...this.pending]) {
      if (
        !item ||
        item.finished ||
        item.progressResumed ||
        !['deadlock', 'repeat-progress'].includes(
          item.definition.id.replace(/^live-/, ''),
        ) ||
        (!item.natural && item.time < evidenceDuration(item.definition))
      )
        continue;
      if (distance(item.initial.ball, this.match.state.actors.ball) > 0.07) {
        item.progressResumed = true;
        if (item === this.active) {
          this.countFor = null;
          this.countCompleted = false;
          this.feedback = null;
          this.phase = 'decision';
        }
        if (this.mode === 'continuous' && item.step > 0) {
          this.assess(item, item.mistakes ? 'wrong' : 'correct');
          this.retireObservation(item);
        }
      }
    }
  }

  get canArrangeKickoff() {
    return (
      !this.sessionFinished &&
      this.kickoffDue &&
      ![this.active, ...this.pending].some(
        (item) => item && !item.finished && !this.optionalKickoffReturn(item),
      ) &&
      !this.awaitingWorkingTeam
    );
  }
  private get awaitingWorkingTeam() {
    return (['blue', 'yellow'] as const).some(
      (team) =>
        !MATCH_ROBOTS.some(
          (robot) => robot.team === team && this.match.state.actors[robot.id],
        ),
    );
  }
  private get kickoffReturns() {
    return this.kickoffDue
      ? Object.values(this.bench)
          .filter((entry) => this.returnTimeEligible(entry.robot))
          .map((entry) => entry.robot)
      : [];
  }
  private returnNeededForWorkingTeam(id: string) {
    const team = teamOf(id);
    return !MATCH_ROBOTS.some(
      (robot) => robot.team === team && this.match.state.actors[robot.id],
    );
  }
  private optionalKickoffReturn(item: ActiveIncident) {
    const robot = this.returnRequest(item);
    return Boolean(
      this.kickoffDue &&
      item.natural &&
      robot &&
      !this.returnNeededForWorkingTeam(robot),
    );
  }
  get canAdvance() {
    if (this.opening || this.userPaused || this.sessionFinished) return false;
    return (
      this.phase === 'evidence' ||
      !this.motionHeld ||
      (this.kickoffDue &&
        this.awaitingWorkingTeam &&
        (this.mode === 'continuous' ||
          (this.phase === 'live' && !this.manualHold)))
    );
  }

  constructor(
    readonly seed: number,
    options: {
      preMatch?: boolean;
      robotVisual?: RobotVisualId;
      mode?: TrainingMode;
      duration?: number;
      topics?: readonly TrainingTopic[];
      /** Freeze body geometry for certification/checkpoint replay. */
      lockRobotVisual?: boolean;
      /** Disable the heavyweight visual timeline for headless verification. */
      recordMatchReplay?: boolean;
    } = {},
  ) {
    this.mode = options.mode ?? 'step';
    this.duration = options.duration ?? Number.MAX_SAFE_INTEGER;
    this.topics = options.topics?.length
      ? [...options.topics]
      : TRAINING_TOPICS.map((t) => t.id);
    this.robotVisual = options.robotVisual ?? DEFAULT_ROBOT_VISUAL_ID;
    this.robotVisualLocked = Boolean(options.lockRobotVisual);
    this.match.setRobotVisual(this.robotVisual);
    this.recordMatchReplay = options.recordMatchReplay ?? true;
    this.bag = new IncidentBag(seed);
    this.director = new ContinuousDirector(this.bag, this.topics);
    this.meeting = new KickoffMeeting(seed);
    this.opening = Boolean(options.preMatch);
    this.match.restart('neutral');
    this.syncMotion();
    this.capture();
  }
  tossCoin() {
    return this.opening && this.meeting.toss();
  }
  setRobotVisual(visual: RobotVisualId) {
    if (this.robotVisualLocked && visual !== this.robotVisual) return false;
    this.robotVisual = visual;
    this.match.setRobotVisual(visual);
    return true;
  }
  chooseFirstKickoff() {
    return this.opening && this.meeting.takeKickoff();
  }
  chooseOpeningEnd(end: GoalEnd) {
    if (!this.opening || !this.meeting.chooseEnd(end)) return false;
    this.match.blueAttackDirection = this.meeting.blueAttackDirection;
    this.kickoffTeam = this.meeting.firstKickoff!;
    this.kickoffDue = true;
    this.kickoffSerial++;
    this.arrangeKickoff();
    return true;
  }
  private scene(definition: RefereeCase, time: number, variant: Variant) {
    const scene = caseScene(definition, time, variant, this.robotVisual);
    if (this.match.blueAttackDirection === -1)
      for (const pose of Object.values(scene.poses)) {
        pose.x = -pose.x;
        pose.z = -pose.z;
        pose.yaw += Math.PI;
      }
    if (['wall', 'pushed-out'].includes(definition.id)) {
      const target = definition.steps
        .flat()
        .find((call) => ['out', 'waive-out'].includes(call.action))?.target;
      const robot = target ? transformId(target, variant) : null;
      if (robot && scene.poses[robot]) {
        const pose = scene.poses[robot];
        const xGap = FIELD.floorHalfWidth - Math.abs(pose.x);
        const zGap = FIELD.floorHalfLength - Math.abs(pose.z);
        if (Math.min(xGap, zGap) <= 0.105) {
          const requested =
            xGap <= zGap
              ? { ...pose, x: (Math.sign(pose.x) || 1) * FIELD.floorHalfWidth }
              : {
                  ...pose,
                  z: (Math.sign(pose.z) || 1) * FIELD.floorHalfLength,
                };
          const corrected = clampRobotToField(requested, this.robotVisual);
          if (definition.id === 'pushed-out')
            for (const other of MATCH_ROBOTS) {
              const otherPose = scene.poses[other.id];
              if (
                other.id !== robot &&
                otherPose &&
                distance(otherPose, pose) <= 0.205
              )
                scene.poses[other.id] = {
                  ...otherPose,
                  x: otherPose.x + corrected.x - pose.x,
                  z: otherPose.z + corrected.z - pose.z,
                };
            }
          scene.poses[robot] = corrected;
        }
      }
    }
    return scene;
  }
  get decisionKey() {
    return `${this.active?.number ?? this.serial}:${this.active?.step ?? 0}`;
  }
  /** Integer fixed-step clock used by portable certification replays. */
  get trainingTick() {
    return this.trainingTicks;
  }

  snapshot() {
    const item = this.active;
    let facts =
      'Both teams are autonomous. Observe play and whistle whenever a decision is needed.';
    if (item) {
      const early =
        !item.natural && item.time + 1e-8 < evidenceDuration(item.definition);
      facts = transformText(
        early
          ? (item.definition.before ??
              'Watch this passage of play. Observe the robots, ball and field markings.')
          : item.definition.facts,
        item.variant,
      );
      if (item.step > 0) {
        const previous = item.definition.steps[item.step - 1]?.[0].action;
        if (previous === 'count')
          facts = this.countCompleted
            ? 'The visible count has finished; the ball and robots still make no progress. The count length here is a training illustration.'
            : 'A visible count has been requested. Observe whether the stationary situation changes while counting.';
        else if (previous === 'pause')
          facts =
            'The replacement ball / official check is now complete. The stopped robots have remained untouched. Decide how to continue.';
        else if (previous === 'pushing')
          facts =
            'The ball has been relocated. Reassess the remaining penalty-area arrangement using its new position.';
        else if (previous === 'no-goal')
          facts =
            'The goal was disallowed. Resolve the remaining infringement before continuing.';
        else if (previous === 'correct-setup')
          facts =
            'The placement has been corrected. Everyone is stopped and awaiting your signal.';
      }
      if (item.progressResumed)
        facts =
          'The ball has moved and progress has resumed. End the count and let play continue; no lack-of-progress placement is needed.';
      if (!early && !item.finished && !this.multipleStillPresent(item))
        facts =
          'The earlier multiple-defense arrangement has cleared while play continued. Reassess the current position; a relocation is no longer needed.';
      const returnCall = this.returnRequest(item);
      if (returnCall) {
        const entry = this.bench[returnCall];
        facts = !entry
          ? `${robotName(returnCall)} is already back on the field.`
          : this.canReturn(returnCall)
            ? `${robotName(returnCall)} is repaired, eligible and has a clear return spot. You may permit its return now.`
            : `${robotName(returnCall)} requests return. ${!entry.ready ? 'Repair is still in progress.' : this.clock < entry.eligibleAt && !this.kickoffDue ? `${Math.ceil(entry.eligibleAt - this.clock)} seconds of its waiting period remain.` : 'Wait until a legal neutral return spot is clear.'}`;
      }
      if (item.finished && this.feedback) facts = this.feedback.effect;
    }
    if (!item && this.kickoffDue)
      facts =
        'Kickoff is pending. Ready robots may request return; a team must have a working robot before play restarts.';
    const unique = [
      ...new Set(
        this.completed
          .filter((x) => !x.id.startsWith('live-'))
          .map((x) => x.id),
      ),
    ];
    return {
      ...this.match.snapshot(),
      trainingMode: this.mode,
      trainingRemaining: Math.max(0, this.duration - this.trainingElapsed),
      trainingTick: this.trainingTicks,
      sessionFinished: this.sessionFinished,
      userPaused: this.userPaused,
      report: this.score.snapshot(),
      topics: [...this.topics],
      phase: this.phase,
      simulationTime: this.clock,
      heights: { ...this.heights },
      facts:
        this.mode === 'continuous' &&
        !item?.hintLevel &&
        !this.opening &&
        !this.kickoffDue
          ? 'Observe play. Pause or whistle to make a call; play continues if you do not intervene.'
          : facts,
      penaltyEvidence: Boolean(
        (this.mode !== 'continuous' || item?.hintLevel) &&
        item &&
        this.phase !== 'evidence' &&
        [
          'multiple',
          'repeat-defense',
          'combined',
          'pushing',
          'full-area',
          'partial-area',
        ].includes(item.definition.id.replace(/^live-/, '')),
      ),
      decisionKey: this.decisionKey,
      feedback: this.feedback
        ? {
            ...this.feedback,
            appliedRules: this.feedback.appliedRules.map((rule) => ({
              ...rule,
            })),
          }
        : null,
      bench: Object.values(this.bench).map((entry) => ({
        ...entry,
        remaining: Math.max(0, entry.eligibleAt - this.clock),
        eligible: this.canReturn(entry.robot),
      })),
      completed: this.completed.map((entry) => ({ ...entry })),
      coverage: unique,
      assessed: this.completedCount,
      correct: this.correctCount,
      history: this.history.map((entry) => ({ ...entry })),
      callsMade: this.reviewEvents.filter((entry) => entry.actual).length,
      review: this.sessionFinished
        ? [...this.reviewEvents]
            .sort((a, b) => a.at - b.at || a.id - b.id)
            .map((entry) => ({
              ...entry,
              actual: entry.actual ? { ...entry.actual } : null,
              expected: entry.expected.map((call) => ({ ...call })),
            }))
        : [],
      matchReplayDuration: this.currentMatchReplayTime,
      caseNumber: this.serial,
      count: this.countFor === null ? null : Math.floor(this.countFor) + 1,
      canReplay: Boolean(
        item && !item.natural && item.step === 0 && this.phase === 'decision',
      ),
      kickoffDue: this.kickoffDue,
      kickoffTeam: this.kickoffTeam,
      canArrangeKickoff: this.canArrangeKickoff,
      canAdvance: this.canAdvance,
      canResumeMotion: this.canResumeMotion,
      kickoffReturns: this.kickoffReturns,
      motionHeld: this.motionHeld,
      decisionPaused: this.decisionPaused,
      drillReady:
        this.mode === 'step' && this.drillReady && !this.sessionFinished,
      canStartCase:
        this.mode === 'step' &&
        !this.sessionFinished &&
        !this.opening &&
        !item &&
        !this.pending.length &&
        !Object.keys(this.bench).length &&
        !this.kickoffDue,
      pendingDecisions: this.pending.length,
      opening: this.opening ? this.meeting.snapshot() : null,
      blueAttackDirection: this.match.blueAttackDirection,
      decisionTitle:
        this.mode === 'continuous' && !item?.hintLevel
          ? 'Watch the match'
          : (item?.definition.title ?? ''),
      assisted: this.assistedCount,
      help: this.mode === 'continuous' && !item?.hintLevel ? null : this.help(),
      resolving: this.resolving !== null,
      canReplayLast: Boolean(this.recorder.last),
      lastSituationTitle: this.recorder.last?.title ?? '',
      canResumeEvidence: Boolean(
        !this.sessionFinished &&
        item &&
        !item.natural &&
        this.phase === 'decision' &&
        item.time + 1e-8 < evidenceDuration(item.definition),
      ),
      damage: this.damage
        ? { ...this.damage, position: { ...this.damage.position } }
        : null,
    };
  }

  /** Explicit incident selection also powers the labelled practice-topic selector. */
  beginCase(definition: RefereeCase, variant = this.bag.variant()) {
    if (this.sessionFinished || this.mode === 'continuous') return false;
    if (
      this.opening ||
      this.active ||
      Object.keys(this.bench).length ||
      this.kickoffDue
    )
      return false;
    this.damage = null;
    this.manualHold = false;
    this.userPaused = false;
    this.drillReady = false;
    this.fixtureEnded = false;
    this.outRobots.clear();
    this.invalidGoalPassage = null;
    this.recorder.resetBuffer();
    this.permittedContact = null;
    const scene = this.scene(definition, 0, variant);
    this.match.place(scene.poses);
    this.heights = scene.heights;
    this.kickoffDue = Boolean(definition.kickoff);
    this.kickoffTeam = transformId(
      definition.kickoffTeam ??
        (['early', 'return-kickoff'].includes(definition.id)
          ? 'blue'
          : 'neutral'),
      variant,
    ) as MatchTeam | 'neutral';
    if (this.kickoffDue) this.kickoffSerial++;
    this.opponentDamage = Boolean(definition.opponentDamage);
    this.waitingFor = 0;
    for (const entry of definition.bench ?? []) {
      const robot = transformId(entry.robot, variant);
      this.bench[robot] = {
        robot,
        reason: 'Repair exercise',
        removedAt: this.clock - entry.waited,
        eligibleAt: this.clock + 60 - entry.waited,
        ready: entry.ready,
        readyAt: entry.ready
          ? this.clock
          : this.clock + this.simulatedRepairDelay(robot),
        kickoff: this.kickoffSerial,
      };
      delete this.match.state.actors[robot];
    }
    this.active = {
      definition,
      variant,
      number: ++this.serial,
      step: 0,
      time: 0,
      natural: false,
      mistakes: false,
      assisted: false,
      hintLevel: 0,
      finished: false,
      stopsPlay: requiresStoppage(definition),
      replay: null,
      key: this.incidentKey(definition, variant),
      initial: clonePoses(this.match.state.actors),
    };
    this.feedback = null;
    this.countCompleted = false;
    this.phase = evidenceDuration(definition) > 0 ? 'evidence' : 'decision';
    if (definition.id === 'damaged') {
      const robot = transformId('blue-1', variant);
      this.damage = {
        id: `${this.seed}:${++this.damageSerial}`,
        robot,
        position: { ...this.match.state.actors[robot] },
        removed: false,
      };
    }
    this.capture();
    if (evidenceDuration(definition) === 0) this.saveSituation(this.active);
    return true;
  }

  nextCase() {
    if (this.mode === 'continuous' || this.sessionFinished) return false;
    if (this.active || Object.keys(this.bench).length || this.kickoffDue)
      return false;
    for (let i = 0; i < REFEREE_CASES.length * 2; i++) {
      const next = this.bag.next();
      if (this.topics.includes(trainingTopic(next)))
        return this.beginCase(next);
    }
    return false;
  }

  /** New layouts are always an explicit user operation. */
  arrangeKickoff() {
    if (!this.canArrangeKickoff) return false;
    // Eligible returns are permissions, not prerequisites. Retire any passive
    // request the trainee chose not to grant; the robot remains on the bench.
    for (const item of [this.active, ...this.pending])
      if (item && !item.finished && this.optionalKickoffReturn(item))
        item.finished = true;
    this.pending = this.pending.filter((item) => !item.finished);
    if (this.active?.finished) this.active = null;
    this.invalidGoalPassage = null;
    this.match.place(
      randomKickoff(
        Object.keys(this.match.state.actors),
        this.kickoffTeam,
        this.match.blueAttackDirection,
        () => this.meeting.random(),
      ),
    );
    this.match.state.message = `${this.kickoffTeam === 'neutral' ? 'Neutral' : this.kickoffTeam === 'blue' ? 'Blue' : 'Yellow'} kickoff`;
    this.heights = {};
    this.beginLive({
      ...this.liveDefinition(
        'ready',
        `${this.kickoffTeam === 'neutral' ? 'Neutral' : this.kickoffTeam === 'blue' ? 'Blue' : 'Yellow'} kickoff is arranged. Every robot and the ball are stopped, awaiting your start signal.`,
        [[{ action: 'start' }]],
      ),
      title: `${this.kickoffTeam === 'neutral' ? 'Neutral' : this.kickoffTeam === 'blue' ? 'Blue' : 'Yellow'} kickoff`,
      anchor: this.kickoffTeam === 'neutral' ? 'neutral-kickoff' : 'kick-off',
    });
    return true;
  }

  resumeLive() {
    if (this.active || this.kickoffDue) return false;
    this.untilIncident = 6 + this.bag.random() * 7;
    this.phase = 'live';
    return true;
  }

  resumeEvidence() {
    if (this.sessionFinished) return false;
    if (!this.snapshot().canResumeEvidence) return false;
    this.userPaused = false;
    this.manualHold = false;
    this.phase =
      this.active &&
      !this.active.natural &&
      this.active.time < evidenceDuration(this.active.definition)
        ? 'evidence'
        : 'decision';
    return true;
  }

  private beginLive(definition: RefereeCase) {
    const discrete =
      this.mode === 'continuous' &&
      (definition.id === 'live-dribbler' ||
        definition.steps[0]?.some((c) =>
          ['goal', 'no-goal'].includes(c.action),
        ));
    const key =
      this.incidentKey(definition, unchanged) +
      (definition.id === 'live-ready'
        ? `:${this.kickoffSerial}`
        : discrete
          ? `:${this.serial + 1}`
          : '');
    if (this.mode === 'continuous') {
      const previous = this.observations.get(key);
      // A denied request is a new decision once the robot becomes eligible.
      const newlyEligibleReturn =
        previous?.finished &&
        definition.id === 'live-return-ready' &&
        previous.definition.steps
          .flat()
          .some((call) => call.action === 'keep-out');
      if (previous && !newlyEligibleReturn) {
        previous.lastSeen = this.clock;
        return;
      }
    }
    if (
      [this.active, ...this.pending].some(
        (item) =>
          item &&
          !item.finished &&
          (item.key === key ||
            (item.definition.id.replace(/^live-/, '') === 'combined' &&
              ['pushing', 'multiple'].includes(
                definition.id.replace(/^live-/, ''),
              ))),
      )
    )
      return;
    const incident: ActiveIncident = {
      definition,
      variant: unchanged,
      number: ++this.serial,
      step: 0,
      time: 0,
      natural: true,
      mistakes: false,
      assisted: false,
      hintLevel: 0,
      finished: false,
      stopsPlay: requiresStoppage(definition),
      replay: null,
      key,
      initial: clonePoses(this.match.state.actors),
      observedAt: this.clock,
      lastSeen: this.clock,
      scoreNeutral: definition.id === 'live-dribbler',
      ballPassageRevision: ['live-pushing', 'live-combined'].includes(
        definition.id,
      )
        ? this.match.ballPassageRevision
        : undefined,
    };
    const incidentId = definition.id.replace(/^live-/, '');
    if (['multiple', 'repeat-defense', 'combined'].includes(incidentId)) {
      const defenseTeam = this.multipleDefenseTeam(definition, unchanged);
      if (defenseTeam) this.multipleDefenseOffenses[defenseTeam]++;
    }
    this.noteOut(incident);
    this.capture(true);
    incident.replayAt = this.currentMatchReplayTime;
    this.armReaction(incident);
    incident.replay = this.recorder.seal(definition.title, definition.facts);
    if (this.mode === 'continuous') {
      this.observations.set(key, incident);
      if (!this.active || (this.active.finished && this.phase !== 'feedback')) {
        this.active = incident;
        this.phase = 'decision';
      } else this.pending.push(incident);
      return;
    }
    if (this.active && !this.active.finished) {
      if (
        (incident.stopsPlay && !this.active.stopsPlay) ||
        this.countFor !== null
      ) {
        // A fresh violation interrupts observation immediately. A count can be
        // restarted only after that decision, with fresh evidence and timing.
        if (this.countFor !== null) {
          this.active.step = 0;
          this.active.initial = clonePoses(this.match.state.actors);
        }
        this.countFor = null;
        this.countCompleted = false;
        this.countAnchor = null;
        this.pending.unshift(this.active);
      } else {
        this.pending.push(incident);
        return;
      }
    }
    this.active = incident;
    if (this.resolving !== incident.number) this.resolving = null;
    this.manualHold = false;
    this.feedback = null;
    this.phase = 'decision';
  }

  private liveDefinition(
    id: string,
    facts: string,
    steps?: RequiredCall[][],
  ): RefereeCase {
    const source = REFEREE_CASES.find((item) => item.id === id)!;
    const explanations: Record<string, string> = {
      goal: 'Back-wall contact awards one goal to the team attacking that end. The conceding team takes the kickoff.',
      wall: 'Remove the identified out-of-bounds robot. Its one-minute waiting period starts at removal and advances when you resume the training match.',
      'both-damaged':
        'With both opposing robots still damaged at kickoff and no opponent-violation exception, the working team receives one goal for this elapsed 30-second interval.',
      dribbler:
        'No infringement has been established by the current observable field evidence. Continue from the same state.',
      combined:
        'If you call pushing, resolve its ball placement before reassessing multiple defense. If you judge the contact does not warrant pushing, the farther defender still needs relocation.',
    };
    return {
      ...source,
      id: `live-${id}`,
      facts,
      explanation: explanations[id] ?? source.explanation,
      steps: steps ?? source.steps,
      bench: undefined,
    };
  }

  step() {
    this.resolveAssistedSteps();
    if (!this.canAdvance) return;
    this.trainingTicks += 1;
    this.trainingElapsed = Math.min(
      this.duration,
      this.trainingTicks * MATCH_STEP,
    );
    if (this.trainingElapsed + 1e-8 >= this.duration) {
      this.endSession();
      return;
    }
    if (this.phase === 'evidence' && this.active && !this.active.natural) {
      const item = this.active;
      const duration = evidenceDuration(item.definition);
      const nextTime = item.time + MATCH_STEP;
      item.time = nextTime + 1e-8 >= duration ? duration : nextTime;
      const scene = this.scene(item.definition, item.time, item.variant);
      for (const id of Object.keys(this.bench)) delete scene.poses[id];
      this.match.place(scene.poses);
      this.heights = scene.heights;
      this.recordTick();
      if (item.time >= duration) {
        item.initial = clonePoses(this.match.state.actors);
        this.saveSituation(item);
        item.observedAt = this.clock;
        this.phase = 'decision';
        this.resolveAssistedSteps();
      }
      return;
    }
    if (!this.canArrangeKickoff) this.clock += MATCH_STEP;
    for (const entry of Object.values(this.bench))
      if (!entry.ready && this.clock >= entry.readyAt) {
        entry.ready = true;
        entry.repairReportedAt = this.clock;
        this.match.state.message = `${robotName(entry.robot)} team reports repair complete`;
      }
    const requested = Object.values(this.bench).find(
      (entry) =>
        this.canReturn(entry.robot) &&
        (!this.kickoffDue || this.returnNeededForWorkingTeam(entry.robot)),
    );
    if (requested) {
      this.beginLive(
        this.liveDefinition(
          'return-ready',
          `${robotName(requested.robot)} is repaired and requests return${this.kickoffDue ? ' before the pending kickoff' : ' after its waiting period'}.`,
          [[{ action: 'return', target: requested.robot }]],
        ),
      );
      if (this.motionHeld) return;
    }
    if (this.kickoffDue) {
      const unavailable = (['blue', 'yellow'] as const).find(
        (team) =>
          !MATCH_ROBOTS.some(
            (robot) => robot.team === team && this.match.state.actors[robot.id],
          ),
      );
      if (unavailable) {
        this.waitingFor += MATCH_STEP;
        if (this.waitingFor >= 30) {
          this.waitingFor = 0;
          const opponent = unavailable === 'blue' ? 'yellow' : 'blue';
          const id = this.opponentDamage ? 'damage-exception' : 'both-damaged';
          this.beginLive(
            this.liveDefinition(
              id,
              `Both ${unavailable} robots remain unavailable through another complete 30-second kickoff interval.${this.opponentDamage ? ' Opponent-caused damage exception applies.' : ' No opponent-caused damage exception applies.'}`,
              [
                [
                  this.opponentDamage
                    ? { action: 'wait' }
                    : { action: 'goal', target: opponent },
                ],
              ],
            ),
          );
        }
      }
      // Rule 2.9 keeps the official clock and successive 30-second intervals
      // running while a team has no working robot. Continuous training also
      // keeps its reaction windows live if the trainee ignores an award.
      if (this.mode === 'continuous') this.ageObservations();
      this.match.holdMotion();
      return;
    }
    if (this.detectLiveIncident()) return;
    if (this.mode === 'continuous') this.match.state.pendingEvent = null;
    this.match.releaseReferee();
    const disabledRobots: string[] = [];
    if (this.damage && !this.damage.removed)
      disabledRobots.push(this.damage.robot);
    if (
      this.active &&
      ['deadlock', 'repeat-progress'].includes(this.active.definition.id)
    )
      disabledRobots.push(
        ...['blue-1', 'yellow-1'].map((id) =>
          transformId(id, this.active!.variant),
        ),
      );
    const directed =
      this.mode === 'continuous'
        ? this.director.step(
            this.match,
            this.damage && !this.damage.removed ? this.damage.robot : null,
          )
        : null;
    if (directed?.damage) {
      const robot = directed.damage;
      this.damage = {
        id: `${this.seed}:${++this.damageSerial}`,
        robot,
        position: { ...this.match.state.actors[robot] },
        removed: false,
      };
      disabledRobots.push(robot);
    }
    this.match.step({
      controls: { blue: 'ai', yellow: 'ai' },
      selectedRobot: 'blue-1',
      duration: Number.MAX_SAFE_INTEGER,
      referee: true,
      observeReferee: this.mode === 'continuous',
      robotCommands: directed?.commands,
      disabledRobots,
    });
    this.refreshGoalPassage();
    if ((this.heights.ball ?? 0.022) > 0.022)
      this.heights.ball = Math.max(
        0.022,
        this.heights.ball - MATCH_STEP * 0.25,
      );
    this.recordTick();
    this.refreshProgress();
    if (
      !this.active?.finished &&
      (this.countFor !== null || this.countCompleted)
    ) {
      if (this.countFor !== null) this.countFor += MATCH_STEP;
      if (
        this.countAnchor &&
        distance(this.countAnchor, this.match.state.actors.ball) > 0.07
      ) {
        this.countFor = null;
        this.countCompleted = false;
        if (this.active) this.active.progressResumed = true;
        this.feedback = null;
        this.phase = 'decision';
      } else if (this.countFor !== null && this.countFor >= 3) {
        this.countFor = null;
        this.countCompleted = true;
        this.feedback = null;
        this.phase = 'decision';
      }
    }
    if (this.detectLiveIncident()) return;
    if (this.mode === 'continuous') {
      this.match.state.pendingEvent = null;
      this.ageObservations();
    }
    this.resolveAssistedSteps();
    this.untilIncident -= MATCH_STEP;
    if (this.untilIncident <= 0) this.drillReady = true;
  }

  private detectLiveIncident() {
    if (this.mode === 'continuous' && this.match.stationarySeconds >= 1) {
      for (const item of this.observations.values())
        if (
          trainingTopic(item.definition) === 'progress' &&
          !item.progressResumed
        )
          item.lastSeen = this.clock;
    }
    if (
      this.mode === 'continuous' &&
      this.damage &&
      !this.damage.removed &&
      this.match.state.actors[this.damage.robot]
    ) {
      this.beginLive(
        this.liveDefinition(
          'damaged',
          `${robotName(this.damage.robot)} has stopped and is visibly damaged.`,
          [[{ action: 'damaged', target: this.damage.robot }]],
        ),
      );
    }
    const pending = this.match.state.pendingEvent;
    const boundaries = MATCH_ROBOTS.filter((r) => {
      const p = this.match.state.actors[r.id];
      return (
        p &&
        (robotTouchesFieldWall(p, this.robotVisual) ||
          [-1, 1].some((end) =>
            robotPenaltyOverlap(p, end, this.robotVisual, true),
          ))
      );
    });
    const boundaryPushers = new Map(
      boundaries.map((robot) => [
        robot.id,
        this.match.opponentPusher(robot.id),
      ]),
    );
    if (pending) {
      const liveScoringOffender =
        pending.kind === 'goal'
          ? MATCH_ROBOTS.find(
              (r) =>
                r.team === pending.team &&
                this.match.state.actors[r.id] &&
                (this.outRobots.has(r.id) ||
                  (boundaries.includes(r) && !boundaryPushers.get(r.id))),
            )
          : undefined;
      const passageOffender =
        pending.kind === 'goal' &&
        this.invalidGoalPassage?.team === pending.team
          ? MATCH_ROBOTS.find(
              (robot) => robot.id === this.invalidGoalPassage?.robot,
            )
          : undefined;
      const scoringOffender = liveScoringOffender ?? passageOffender;
      const pushingCandidates =
        pending.kind === 'goal'
          ? [this.active, ...this.pending].filter(
              (item): item is ActiveIncident =>
                Boolean(
                  item &&
                  !item.finished &&
                  ['pushing', 'combined'].includes(
                    item.definition.id.replace(/^live-/, ''),
                  ) &&
                  item.definition.steps[item.step]?.some(
                    (call) => call.action === 'pushing',
                  ) &&
                  !item.permitContact,
                ),
            )
          : [];
      const pushing =
        pushingCandidates.find(
          (item) =>
            item.ballPassageRevision === undefined ||
            item.ballPassageRevision === this.match.ballPassageRevision,
        ) ?? null;
      // An earlier contact cannot taint a later, separately placed/touched ball
      // passage. Close that stale observation before presenting the real goal.
      if (pending.kind === 'goal' && !pushing)
        for (const stale of pushingCandidates) {
          this.retireObservation(
            stale,
            Boolean(
              stale.reactionDeadline !== undefined &&
              this.clock + 1e-8 >= stale.reactionDeadline,
            ),
          );
          if (this.active === stale) this.active = null;
        }
      if (pending.kind === 'goal' && scoringOffender) {
        const steps: RequiredCall[][] = [[{ action: 'no-goal' }]];
        if (this.match.state.actors[scoringOffender.id])
          steps.push([{ action: 'out', target: scoringOffender.id }]);
        this.beginLive(
          this.liveDefinition(
            'out-goal',
            !liveScoringOffender && passageOffender
              ? `${scoringOffender.label} was out of bounds while controlling the ball. The robot was removed, but that same released ball continued to the back wall. ${COMMITTEE_TRAINING_POLICY.outCarrierPassage}`
              : `${scoringOffender.label} is out of bounds and still on the field when its team scores.`,
            steps,
          ),
        );
      } else if (pending.kind === 'goal' && pushing) {
        if (this.active === pushing) this.active = null;
        this.pending = this.pending.filter((item) => item !== pushing);
        const steps: RequiredCall[][] = [
          [
            { action: 'no-goal', discretionary: true },
            {
              action: 'goal',
              target: pending.team,
              discretionary: true,
              complete: true,
            },
          ],
          [{ action: 'pushing' }],
        ];
        if (pushing.definition.id.replace(/^live-/, '') === 'combined') {
          const team =
            pushing.definition.steps
              .flat()
              .find((call) => call.action === 'multiple')
              ?.target?.split(':')[1] ?? transformId('blue', pushing.variant);
          steps.push([
            { action: 'multiple', target: `farther:${team}` },
            ...(pushing.definition.steps
              .flat()
              .some((call) => call.action === 'damaged')
              ? [
                  {
                    action: 'damaged' as const,
                    target: `farther:${team}`,
                    discretionary: true,
                  },
                ]
              : []),
          ]);
        }
        this.beginLive({
          ...this.liveDefinition(
            'pushing-goal',
            'A goal follows penalty-area contact that still needs your judgment. Decide whether pushing caused this goal, or the contact was legal.',
            steps,
          ),
          kickoff: true,
          explanation:
            'If you judge the contact pushing, disallow its resulting goal and relocate the ball. If the contact was legal, award the goal and arrange the conceding team kickoff.',
        });
      } else if (pending.kind === 'goal')
        this.beginLive(
          this.liveDefinition(
            'goal',
            `The ball touched the inside back wall. ${pending.team === 'blue' ? 'Yellow' : 'Blue'} defended this end.`,
            [[{ action: 'goal', target: pending.team }]],
          ),
        );
      else
        this.beginLive(
          this.liveDefinition(
            'deadlock',
            'The live ball has remained within a small area for several seconds. Assess the lack of progress and give a count.',
          ),
        );
      if (this.mode === 'continuous') this.match.state.pendingEvent = null;
      this.syncMotion();
      return this.motionHeld;
    }
    for (const boundary of boundaries) {
      const fullyInside = [-1, 1].some((end) =>
        robotPenaltyOverlap(
          this.match.state.actors[boundary.id],
          end,
          this.robotVisual,
          true,
        ),
      );
      const pushedBy = boundaryPushers.get(boundary.id);
      this.beginLive(
        this.liveDefinition(
          pushedBy ? 'pushed-out' : fullyInside ? 'full-area' : 'wall',
          pushedBy
            ? `${robotName(pushedBy)} drove ${boundary.label} ${fullyInside ? 'fully into a penalty area' : 'into the wall'}. ${COMMITTEE_TRAINING_POLICY.pushedOut}`
            : fullyInside
              ? `${boundary.label} has entered a penalty area with its whole footprint.`
              : `${boundary.label}'s physical body has touched the wall.`,
          [
            [
              {
                action: pushedBy ? 'waive-out' : 'out',
                target: boundary.id,
              },
            ],
          ],
        ),
      );
      this.syncMotion();
      if (this.motionHeld) return true;
    }
    const contact = this.contactDefinition();
    const contactKey = contact
      ? JSON.stringify([contact.id, contact.steps])
      : null;
    if (!contact) this.permittedContact = null;
    else if (contactKey !== this.permittedContact) {
      this.beginLive(contact);
      this.syncMotion();
      return this.motionHeld;
    }
    return false;
  }

  whistle() {
    if (this.sessionFinished) return;
    if (this.mode === 'continuous') {
      this.pauseForDecision();
      return;
    }
    if (this.opening) return;
    if (this.phase === 'feedback') return;
    this.manualHold = true;
    if (this.active) {
      this.phase = 'decision';
      return;
    }
    this.beginLive(
      this.contactDefinition() ??
        this.liveDefinition(
          'dribbler',
          'Play has been stopped for your assessment. No automatically confirmed infringement is pending.',
          [[{ action: 'play-on' }, { action: 'resume' }]],
        ),
    );
    this.manualHold = true;
    this.syncMotion();
  }

  private contactDefinition(): RefereeCase | null {
    const poses = this.match.state.actors;
    let defenders: { team: MatchTeam; end: number } | null = null;
    for (const end of [-1, 1])
      for (const team of ['blue', 'yellow'] as const) {
        if (
          MATCH_ROBOTS.filter(
            (r) =>
              r.team === team &&
              poses[r.id] &&
              robotPenaltyOverlap(poses[r.id], end, this.robotVisual),
          ).length === 2
        )
          defenders = { team, end };
      }
    const pushing = MATCH_ROBOTS.some(
      (a) =>
        poses[a.id] &&
        MATCH_ROBOTS.some(
          (b) =>
            poses[b.id] &&
            a.team !== b.team &&
            distance(poses[a.id], poses[b.id]) <= 0.205 &&
            (distance(poses[a.id], poses.ball) <= 0.126 ||
              distance(poses[b.id], poses.ball) <= 0.126) &&
            [-1, 1].some(
              (end) =>
                robotPenaltyOverlap(poses[a.id], end, this.robotVisual) ||
                robotPenaltyOverlap(poses[b.id], end, this.robotVisual),
            ),
        ),
    );
    const repeatedDefense = Boolean(
      defenders && this.multipleDefenseOffenses[defenders.team] > 0,
    );
    if (defenders && pushing) {
      const relocation: RequiredCall = {
        action: 'multiple',
        target: `farther:${defenders.team}`,
      };
      const repeatedDamage: RequiredCall = {
        action: 'damaged',
        target: `farther:${defenders.team}`,
        discretionary: true,
      };
      return this.liveDefinition(
        'combined',
        `${robotName(defenders.team)} 1 and ${robotName(defenders.team)} 2 overlap the same penalty area while opponents touch and contest the ball there. If you judge the contact pushing, resolve it first.${repeatedDefense ? ' This team has already committed multiple defense in this session; the repeat offender may instead be treated as damaged.' : ''}`,
        [
          [
            { action: 'pushing', discretionary: true },
            {
              ...relocation,
              discretionary: true,
              complete: true,
            },
            ...(repeatedDefense ? [{ ...repeatedDamage, complete: true }] : []),
          ],
          [relocation, ...(repeatedDefense ? [repeatedDamage] : [])],
        ],
      );
    }
    if (defenders) {
      return this.liveDefinition(
        repeatedDefense ? 'repeat-defense' : 'multiple',
        `${robotName(defenders.team)} 1 and ${robotName(defenders.team)} 2 overlap the same penalty area. Compare their distances to the ball.${repeatedDefense ? ' This team has already committed multiple defense in this session; the repeat offender may instead be treated as damaged.' : ''}`,
        [
          [
            { action: 'multiple', target: `farther:${defenders.team}` },
            ...(repeatedDefense
              ? [
                  {
                    action: 'damaged' as const,
                    target: `farther:${defenders.team}`,
                    discretionary: true,
                  },
                ]
              : []),
          ],
        ],
      );
    }
    if (pushing) {
      return this.liveDefinition(
        'pushing',
        'Opposing robots touch, at least one overlaps a penalty area, and a robot contacts the ball. Assess the contact.',
      );
    }
    return null;
  }

  replay() {
    if (this.sessionFinished) return false;
    if (
      !this.active ||
      this.active.natural ||
      this.active.step > 0 ||
      this.phase !== 'decision'
    )
      return false;
    this.active.time = 0;
    if (this.damage && !this.damage.removed)
      this.damage = {
        ...this.damage,
        id: `${this.seed}:${++this.damageSerial}`,
      };
    this.phase = 'evidence';
    return true;
  }

  private expected(): RequiredCall[] {
    return this.active ? this.expectedFor(this.active) : [];
  }
  /** Stable, detached grading API for the currently observable decision. */
  acceptedCalls(): RefereeCall[] {
    return this.expected().map(({ action, target }) => ({
      action,
      ...(target ? { target } : {}),
    }));
  }
  private expectedFor(item: ActiveIncident): RequiredCall[] {
    if (item.progressResumed)
      return [
        { action: 'play-on', complete: true },
        { action: 'resume', complete: true },
      ];
    const { definition, variant, step } = item;
    const current = definition.steps[step] ?? [];
    if (
      current.some((call) => call.action === 'multiple') &&
      !current.some((call) => call.action === 'pushing') &&
      !this.multipleStillPresent(item)
    )
      return [
        { action: 'play-on', complete: true },
        { action: 'resume', complete: true },
      ];
    const returning = this.returnRequest(item);
    if (returning)
      return [
        {
          action: this.canReturn(returning) ? 'return' : 'keep-out',
          target: returning,
        },
      ];
    return (definition.steps[step] ?? []).flatMap((entry) => {
      if (entry.target?.startsWith('farther'))
        return this.fartherDefenders(
          (entry.target.split(':')[1] ??
            transformId('blue', variant)) as MatchTeam,
        ).map((target) => ({ ...entry, target }));
      return [
        {
          ...entry,
          target: entry.target ? transformId(entry.target, variant) : undefined,
        },
      ];
    });
  }
  private returnRequest(item: ActiveIncident) {
    const call = item.definition.steps[item.step]?.find(
      (entry) => entry.action === 'return' || entry.action === 'keep-out',
    );
    return call?.target ? transformId(call.target, item.variant) : null;
  }

  private multipleStillPresent(item: ActiveIncident) {
    const call = item.definition.steps[item.step]?.find(
      (entry) => entry.action === 'multiple',
    );
    if (!call) return true;
    const team = call.target?.startsWith('farther')
      ? ((call.target.split(':')[1] ??
          transformId('blue', item.variant)) as MatchTeam)
      : teamOf(transformId(call.target ?? 'blue-1', item.variant));
    const robots = MATCH_ROBOTS.filter((robot) => robot.team === team).map(
      (robot) => this.match.state.actors[robot.id],
    );
    return (
      robots.every(Boolean) &&
      [-1, 1].some((end) =>
        robots.every((pose) =>
          robotPenaltyOverlap(pose, end, this.robotVisual),
        ),
      )
    );
  }

  private explanation(item: ActiveIncident) {
    if (item.progressResumed)
      return 'Progress has resumed. No count or lack-of-progress placement is needed; let play continue.';
    const returning = this.returnRequest(item);
    if (returning)
      return this.canReturn(returning)
        ? 'This robot is now repaired and eligible to return. Place it at the furthest clear neutral spot facing its own goal.'
        : 'A robot may return only when repaired, its waiting period or kickoff exception permits it, and a legal neutral spot is clear. Keep it off until all checks pass.';
    if (!this.multipleStillPresent(item))
      return 'The earlier multiple-defense arrangement has cleared. No relocation is needed in the current position.';
    return transformText(item.definition.explanation, item.variant);
  }

  private help() {
    const item = this.active;
    if (!item || item.finished) return null;
    const early =
      !item.natural && item.time + 1e-8 < evidenceDuration(item.definition);
    const waiting = early || this.countFor !== null;
    return {
      level: item.hintLevel,
      title: item.definition.title,
      step: item.step + 1,
      steps: item.definition.steps.length,
      rule: ruleUrl(item.definition),
      clue: early
        ? 'Watch the rest of the recorded situation before making a call.'
        : this.countFor !== null
          ? 'Let the visible count finish. If progress resumes, let play continue.'
          : this.hintClue(item),
      explanation: this.explanation(item),
      waiting,
      choices: waiting
        ? []
        : this.expected().map((call) => ({
            ...call,
            label: `${REFEREE_ACTIONS.find((action) => action.id === call.action)?.label ?? call.action}${call.target ? ` · ${robotName(call.target)}` : ''}`,
          })),
    };
  }

  private hintClue(item: ActiveIncident) {
    const id = item.definition.id.replace(/^live-/, '');
    if (item.progressResumed)
      return 'The ball has moved away from the stalled position. Check whether a count is still necessary.';
    if (this.returnRequest(item))
      return 'Check the selected robot’s repair status, remaining waiting time, kickoff eligibility and a clear neutral spot.';
    if (['goal', 'own-goal', 'post'].includes(id))
      return 'Watch for contact with the INSIDE back wall, not just the post or goal line. The team attacking that end receives the goal, regardless of the last touch.';
    if (id === 'out-goal')
      return 'Check whether a scoring-team robot was already out on the field, or whether the same ball passage continued from an out-of-bounds carrier after removal.';
    if (id === 'pushing-goal')
      return 'Decide whether the earlier pushing caused the goal. A disallowed goal can leave a separate infringement to resolve.';
    if (['multiple', 'repeat-defense'].includes(id))
      return 'Look for two teammates overlapping the same penalty area. Compare their CURRENT distances to the ball; the farther robot is the one to move.';
    if (id === 'combined')
      return 'There are two questions: pushing and multiple defense. Moving the ball for pushing can change which defender is farther away.';
    if (['pushing', 'midfield'].includes(id))
      return 'Check contact with the ball and overlap with a penalty area. Ordinary contact elsewhere does not establish penalty-area pushing.';
    if (['deadlock', 'repeat-progress'].includes(id))
      return 'Watch whether the ball is making progress. Give a visible count before placing it; cancel the count if play opens up.';
    if (id === 'wall')
      return 'Touching the wall counts as out of bounds. Simply crossing a white playing line does not.';
    if (['full-area', 'partial-area'].includes(id))
      return 'Compare the WHOLE robot footprint with the penalty-area line. Partial overlap and complete entry have different consequences.';
    if (id === 'pushed-out')
      return 'Consider why the robot went out. Being pushed by an opponent allows the referee to waive the penalty and correct its position.';
    if (id === 'ball-out')
      return 'Compare the ball’s height with the wall height, then identify the robot that sent it out.';
    if (['holding', 'dribbler'].includes(id))
      return 'Check whether another robot can access the ball. Possession with a permitted rotating drum alone is not proof of holding.';
    if (id === 'damaged')
      return 'Identify the non-responsive robot and remove it. The other robots stay in place while you make the decision.';
    if (['both-damaged', 'damage-exception'].includes(id))
      return 'Check the complete 30-second kickoff interval AND whether an opponent violation caused the damage.';
    if (id === 'early')
      return 'Compare the robot’s first movement with the referee’s start signal. The current kickoff does not immediately cancel an early-start removal.';
    if (['ready', 'setup'].includes(id))
      return 'Check a centered ball, stationary robots in their own halves and the center-circle restriction for this type of kickoff.';
    if (id === 'human')
      return 'Distinguish stopping an unauthorized team intervention from stopping the entire game.';
    if (id === 'unstick')
      return 'Check whether the entangled robots are disputing the ball. Limited referee assistance is discretionary in this situation.';
    if (['interruption', 'spectator'].includes(id))
      return 'First handle the official interruption safely. After the check, decide how to restart without silently resetting the robots.';
    if (id === 'preflight')
      return 'Check whether ANY of the four robots can react to the ball. A match that cannot be played is different from a scored goal.';
    return 'Compare the confirmed robot compliance issue with the required technical checks. An official inspection can be required during play.';
  }

  requestHint(answer = false) {
    if (this.sessionFinished) return;
    if (!this.active || this.active.finished) return false;
    this.active.assisted = true;
    this.active.hintLevel = answer ? 3 : Math.min(3, this.active.hintLevel + 1);
    return true;
  }

  /** Help uses exactly the same adjudication and penalties as manual calls. */
  resolveForMe() {
    if (this.sessionFinished) return false;
    if (!this.active || this.active.finished) return false;
    this.requestHint(true);
    this.resolving = this.active.number;
    if (this.countFor !== null) {
      this.manualHold = false;
      this.syncMotion();
    }
    if (this.phase === 'feedback') this.continue();
    if (
      !this.active?.natural &&
      this.active &&
      this.active.time < evidenceDuration(this.active.definition)
    ) {
      this.manualHold = false;
      this.phase = 'evidence';
    }
    this.resolveAssistedSteps();
    return true;
  }

  private resolveAssistedSteps() {
    if (this.resolving === null) return;
    // Never answer a newly queued or preempting situation without a new request.
    if (
      !this.active ||
      this.active.number !== this.resolving ||
      this.active.finished
    ) {
      this.resolving = null;
      return;
    }
    if (this.phase === 'evidence' || this.countFor !== null) return;
    for (let i = 0; i < 8 && this.active && !this.active.finished; i++) {
      if (this.phase === 'feedback') this.continue();
      const call = this.expected()[0];
      if (!call || !this.submit(this.decisionKey, call)) break;
      if (this.active.finished || this.countFor !== null) break;
      if (!['correct', 'supported'].includes(this.feedback?.verdict ?? ''))
        break;
    }
    if (this.active?.finished) this.resolving = null;
  }
  private fartherDefenders(team: MatchTeam) {
    const actors = this.match.state.actors;
    const defenders = MATCH_ROBOTS.filter(
      (robot) => robot.team === team && actors[robot.id],
    ).map((robot) => ({
      id: robot.id,
      distance: distance(actors[robot.id], actors.ball),
    }));
    const farthest = Math.max(...defenders.map((entry) => entry.distance));
    return defenders
      .filter(
        (entry) => farthest - entry.distance <= DEFENDER_DISTANCE_TIE_TOLERANCE,
      )
      .map((entry) => entry.id);
  }

  private returnTimeEligible(id: string) {
    const entry = this.bench[id];
    return Boolean(
      entry?.ready &&
      (this.clock + 1e-8 >= entry.eligibleAt ||
        (this.kickoffDue && this.kickoffSerial >= entry.kickoff)),
    );
  }
  canReturn(id: string) {
    return this.returnTimeEligible(id) && Boolean(this.neutralSpot(true, id));
  }
  private focusIncident(item: ActiveIncident) {
    const original = this.active;
    if (item === original) return;
    if (this.countFor !== null || this.countCompleted) {
      this.countFor = null;
      this.countCompleted = false;
      this.countAnchor = null;
      if (original) original.step = 0;
    }
    this.pending = this.pending.filter((x) => x !== item);
    if (original && !original.finished) this.pending.unshift(original);
    this.active = item;
    if (item.replay) this.recorder.last = item.replay;
  }
  private selectReturnRequest(id: string) {
    const findRequest = () =>
      [this.active, ...this.pending].find(
        (item) => item && !item.finished && this.returnRequest(item) === id,
      );
    if (!findRequest()) {
      const valid = this.canReturn(id);
      this.beginLive(
        this.liveDefinition(
          valid ? 'return-ready' : 'return-early',
          `${robotName(id)} requests return. Check repair status, remaining time and kickoff eligibility.`,
          [[{ action: valid ? 'return' : 'keep-out', target: id }]],
        ),
      );
    }
    const item = findRequest();
    if (item) this.focusIncident(item);
  }
  neutralSpot(
    farthest: boolean,
    moved = 'ball',
    different = false,
  ): Pose | null {
    const actors = this.match.state.actors;
    const available = NEUTRAL_SPOTS.filter(
      (spot) =>
        (!different || distance(spot, actors.ball) > 1e-6) &&
        Object.entries(actors).every(
          ([id, p]) =>
            id === moved ||
            (id === 'ball' && moved === 'ball') ||
            distance(spot, p) >=
              (id === 'ball' || moved === 'ball' ? 0.123 : 0.205),
        ),
    );
    return (
      [...available].sort(
        (a, b) =>
          (distance(a, actors.ball) - distance(b, actors.ball)) *
          (farthest ? -1 : 1),
      )[0] ?? null
    );
  }

  private pushedOutCorrection(
    target: string,
    actors: Record<string, Pose>,
  ): Pose | null {
    const original = actors[target];
    const radius = RCJ_SIMULATOR_GUIDES.robotCollisionRadius;
    const clampInside = (pose: Pose): Pose =>
      clampRobotToField(pose, this.robotVisual, 0.005);
    const candidates: Pose[] = [];
    const grid = 0.005;
    const reach = 32;
    for (let x = -reach; x <= reach; x++)
      for (let z = -reach; z <= reach; z++)
        candidates.push(
          clampInside({
            ...original,
            x: original.x + x * grid,
            z: original.z + z * grid,
          }),
        );
    const clearance = radius * 2 + 0.0005;
    const local = candidates
      .filter(
        (candidate) =>
          MATCH_ROBOTS.every(
            (robot) =>
              robot.id === target ||
              !actors[robot.id] ||
              distance(candidate, actors[robot.id]) >= clearance,
          ) &&
          (!actors.ball ||
            distance(candidate, actors.ball) >=
              MANUAL_ROBOT_BALL_CENTER_DISTANCE),
      )
      .sort(
        (first, second) =>
          distance(first, original) - distance(second, original),
      )[0];
    return local ?? this.neutralSpot(true, target);
  }

  private topicForAction(action: RefereeCall['action']): TrainingTopic {
    if (action === 'out') return 'out';
    if (['damaged', 'ball-out', 'early-start', 'inspect'].includes(action))
      return 'damage';
    if (action === 'multiple') return 'multiple';
    if (action === 'pushing') return 'pushing';
    if (['count', 'lack-progress'].includes(action)) return 'progress';
    if (['goal', 'no-goal'].includes(action)) return 'scoring';
    return 'other';
  }

  private sameRefereeAction(entry: RequiredCall, submitted: RefereeCall) {
    return (
      entry.action === submitted.action ||
      (submitted.action === 'damaged' &&
        ['ball-out', 'early-start'].includes(entry.action))
    );
  }

  private advanceContinuous(item: ActiveIncident) {
    this.pending = this.pending.filter((pending) => pending !== item);
    if (this.active === item) this.active = null;
    let next = this.pending.shift();
    while (next) {
      this.skipResolvedSteps(next);
      if (!next.finished && next.step < next.definition.steps.length) break;
      next = this.pending.shift();
    }
    this.active = next ?? null;
    if (next?.replay) this.recorder.last = next.replay;
    this.phase = next ? 'decision' : 'live';
  }

  /** Continuous mode records the judgment first, then enacts it literally. */
  private submitContinuous(submitted: RefereeCall): boolean {
    const original = this.active;
    const candidates = [original, ...this.pending].filter(
      (item): item is ActiveIncident => Boolean(item && !item.finished),
    );
    const matchingIncidents = candidates
      .map((item) => ({
        item,
        call: this.expectedFor(item).find(
          (call) =>
            this.sameRefereeAction(call, submitted) &&
            (!call.target || call.target === submitted.target),
        ),
      }))
      .filter((entry): entry is { item: ActiveIncident; call: RequiredCall } =>
        Boolean(entry.call),
      );
    const exact = matchingIncidents[0]?.item;
    if (exact && exact !== original) this.focusIncident(exact);
    if (!this.active)
      this.beginLive(
        this.contactDefinition() ??
          this.liveDefinition(
            'dribbler',
            'No infringement has been established by the current field evidence.',
            [[{ action: 'play-on' }, { action: 'resume' }]],
          ),
      );
    const item = this.active;
    if (!item) return false;

    const expected = this.expectedFor(item).map((call) => ({ ...call }));
    const explanation = this.explanation(item);
    const premature = this.countFor !== null;
    const match = expected.find(
      (entry) =>
        this.sameRefereeAction(entry, submitted) &&
        (!entry.target || entry.target === submitted.target),
    );
    const rightAction = expected.some((entry) =>
      this.sameRefereeAction(entry, submitted),
    );
    const kickoffBlocked =
      this.kickoffDue &&
      ['start', 'neutral'].includes(submitted.action) &&
      this.awaitingWorkingTeam;
    const correct = Boolean(match) && !premature && !kickoffBlocked;
    const alreadyAssessed = this.score.has(item.number);
    const assessment: MatchReviewAssessment = correct
      ? alreadyAssessed
        ? 'correction'
        : item.assisted
          ? 'assisted'
          : match?.discretionary
            ? 'supported'
            : 'correct'
      : premature || kickoffBlocked
        ? 'premature'
        : rightAction
          ? 'wrong-target'
          : 'wrong-action';
    const feedbackVerdict: CallFeedback['verdict'] = correct
      ? match?.discretionary
        ? 'supported'
        : 'correct'
      : assessment === 'premature'
        ? 'premature'
        : assessment === 'wrong-target'
          ? 'wrong-target'
          : 'incorrect';
    const wasNeutral = Boolean(item.scoreNeutral);
    if (!correct) {
      item.mistakes = true;
      if (item.scoreNeutral) {
        item.scoreNeutral = false;
        item.scoreTopic = this.topicForAction(submitted.action);
      }
      this.assess(item, 'wrong');
    }
    const topic = item.scoreTopic ?? trainingTopic(item.definition);
    const scored = !item.scoreNeutral && this.topics.includes(topic);
    const appliedRules = correct
      ? rulesForDecision(item.definition, match!.action, {
          kickoffDue: this.kickoffDue,
          returnReason: submitted.target
            ? this.bench[submitted.target]?.reason
            : undefined,
        })
      : [];

    const effect = this.apply(submitted);
    const replayAt = this.capture(true);
    if (correct) {
      item.initial = clonePoses(this.match.state.actors);
      item.step = match?.complete
        ? item.definition.steps.length
        : item.step + 1;
      for (const resolved of matchingIncidents) {
        if (resolved.item === item || resolved.item.finished) continue;
        if (
          ['both-damaged', 'damage-exception'].includes(
            item.definition.id.replace(/^live-/, ''),
          ) ||
          ['both-damaged', 'damage-exception'].includes(
            resolved.item.definition.id.replace(/^live-/, ''),
          )
        )
          continue;
        resolved.item.step = resolved.call.complete
          ? resolved.item.definition.steps.length
          : resolved.item.step + 1;
        this.skipResolvedSteps(resolved.item);
        if (resolved.item.step >= resolved.item.definition.steps.length)
          this.finishIncident(resolved.item);
        else this.armReaction(resolved.item);
      }
    }
    this.skipResolvedSteps(item);
    if (correct && item.step < item.definition.steps.length)
      this.armReaction(item);
    const expectedScoreDecision = expected.some((call) =>
      ['goal', 'no-goal'].includes(call.action),
    );
    const submittedScoreDecision = ['goal', 'no-goal'].includes(
      submitted.action,
    );
    const terminalWrongDecision =
      !correct &&
      (wasNeutral ||
        submitted.action === 'goal' ||
        submitted.action === 'void' ||
        (expectedScoreDecision && submittedScoreDecision) ||
        (expected.some((call) => ['start', 'neutral'].includes(call.action)) &&
          ['start', 'neutral'].includes(submitted.action)));
    if (terminalWrongDecision) item.step = item.definition.steps.length;
    const final = item.step >= item.definition.steps.length;
    if (final) this.finishCase();

    const detail = correct
      ? explanation
      : assessment === 'wrong-target'
        ? 'The action matched the situation, but the selected robot or team did not.'
        : assessment === 'premature'
          ? kickoffBlocked
            ? 'The kickoff was signalled before each team had a working robot.'
            : 'The action was taken before the required observation or count was complete.'
          : 'The selected action did not match the referee decision required by the observed situation.';
    this.reviewEvents.push({
      id: ++this.reviewSerial,
      at: replayAt,
      eventAt: item.replayAt ?? replayAt,
      replayAt,
      incidentId: item.number,
      situation: item.definition.title,
      evidence: transformText(item.definition.facts, item.variant),
      topic,
      actual: { ...submitted },
      expected: expected.map(({ action, target }) => ({
        action,
        ...(target ? { target } : {}),
      })),
      assessment,
      effect,
      detail,
      rule: ruleUrl(item.definition),
      scored,
    });
    const label =
      REFEREE_ACTIONS.find((action) => action.id === submitted.action)?.label ??
      submitted.action;
    this.history.unshift({
      call: `${label}${submitted.target ? ` · ${robotName(submitted.target)}` : ''}`,
      verdict: feedbackVerdict,
      detail: effect,
      at: replayAt,
    });
    this.history = this.history.slice(0, 40);
    this.feedback = {
      verdict: feedbackVerdict,
      title: 'Decision recorded',
      detail,
      effect,
      rule: appliedRules[0]?.url ?? ruleUrl(item.definition),
      appliedRules,
      final,
    };
    if (final) this.advanceContinuous(item);
    else this.phase = 'decision';

    this.userPaused = false;
    this.manualHold = ![
      'count',
      'play-on',
      'resume',
      'start',
      'neutral',
    ].includes(submitted.action);
    if (
      !['count', 'play-on', 'resume', 'keep-out', 'wait'].includes(
        submitted.action,
      )
    )
      this.director.cancel();
    this.syncMotion();
    return true;
  }

  submit(key: string, submitted: RefereeCall): boolean {
    if (this.sessionFinished) return false;
    if (this.opening && this.meeting.stage !== 'ready') return false;
    if (this.mode !== 'continuous' && key !== this.decisionKey) return false;
    const benchRequest =
      ['return', 'keep-out'].includes(submitted.action) &&
      submitted.target &&
      this.bench[submitted.target];
    if (this.phase === 'feedback') {
      if (this.mode !== 'continuous') {
        if (!benchRequest) return false;
        this.continue();
      } else {
        // Continuous sessions never quiz-gate the next call. Clear any stale
        // receipt state (for example after restoring an older saved session)
        // and let the submitted action be enacted immediately.
        this.phase = this.active ? 'decision' : 'live';
        this.feedback = null;
      }
    }
    if (benchRequest) this.selectReturnRequest(submitted.target!);
    this.refreshProgress();
    // Counting is an observational judgment. One sustained second of near-static
    // play is enough to start observing; placement still requires the full count.
    if (
      submitted.action === 'count' &&
      this.match.stationarySeconds >= 1 - 1e-8 &&
      this.countFor === null &&
      !this.countCompleted
    ) {
      this.beginLive(
        this.liveDefinition(
          'deadlock',
          'The ball has made very little progress. Observe a visible count before deciding on placement.',
        ),
      );
    }
    if (this.mode === 'continuous') return this.submitContinuous(submitted);
    if (!this.active)
      this.beginLive(
        this.contactDefinition() ??
          this.liveDefinition(
            'dribbler',
            'No infringement has been established by the current field evidence. Decide whether to let play continue.',
            [[{ action: 'play-on' }, { action: 'resume' }]],
          ),
      );
    const item = this.active;
    if (!item) return false;
    const premature =
      !item.natural && item.time + 1e-8 < evidenceDuration(item.definition);
    if (
      premature &&
      (submitted.action === 'play-on' || submitted.action === 'resume')
    ) {
      this.manualHold = false;
      this.phase = 'evidence';
      return true;
    }
    const choices = this.expected();
    const explanation = this.explanation(item);
    const sameAction = (entry: RequiredCall) =>
      entry.action === submitted.action ||
      (submitted.action === 'damaged' &&
        ['ball-out', 'early-start'].includes(entry.action));
    const match = choices.find(
      (entry) =>
        sameAction(entry) &&
        (!entry.target || entry.target === submitted.target),
    );
    const rightAction = choices.some(sameAction);
    const kickoffBlocked =
      this.kickoffDue &&
      ['start', 'neutral'].includes(submitted.action) &&
      this.awaitingWorkingTeam;
    const correct =
      Boolean(match) && !premature && !kickoffBlocked && this.countFor === null;
    const appliedRules = correct
      ? rulesForDecision(item.definition, match!.action, {
          kickoffDue: this.kickoffDue,
          returnReason: submitted.target
            ? this.bench[submitted.target]?.reason
            : undefined,
        })
      : [];
    const verdict = correct
      ? match?.discretionary
        ? 'supported'
        : 'correct'
      : premature || kickoffBlocked || this.countFor !== null
        ? 'premature'
        : rightAction
          ? 'wrong-target'
          : 'incorrect';
    let effect = 'No match change applied. Review the evidence and try again.';
    if (correct) {
      if (
        ['count', 'play-on', 'resume', 'start', 'neutral'].includes(
          submitted.action,
        )
      )
        this.userPaused = false;
      effect = this.apply({ ...submitted, action: match!.action });
      item.initial = clonePoses(this.match.state.actors);
    } else {
      item.mistakes = true;
      if (item.scoreNeutral) {
        item.scoreNeutral = false;
        item.scoreTopic =
          submitted.action === 'out'
            ? 'out'
            : submitted.action === 'damaged'
              ? 'damage'
              : submitted.action === 'multiple'
                ? 'multiple'
                : submitted.action === 'pushing'
                  ? 'pushing'
                  : ['count', 'lack-progress'].includes(submitted.action)
                    ? 'progress'
                    : ['goal', 'no-goal'].includes(submitted.action)
                      ? 'scoring'
                      : 'other';
      }
      this.assess(item, 'wrong');
    }
    const label =
      REFEREE_ACTIONS.find((action) => action.id === submitted.action)?.label ??
      submitted.action;
    const detail = kickoffBlocked
      ? 'Each team needs a working robot before arranging and signalling kickoff.'
      : premature
        ? 'That part of the incident has not happened yet. Watch the complete evidence before deciding.'
        : correct
          ? explanation
          : `Expected ${choices.map((entry) => `${REFEREE_ACTIONS.find((action) => action.id === entry.action)?.label}${entry.target ? ` (${robotName(entry.target)})` : ''}`).join(' or ')}. ${explanation}`;
    if (correct)
      item.step = match?.complete
        ? item.definition.steps.length
        : item.step + 1;
    if (correct) this.skipResolvedSteps(item);
    const final = correct && item.step >= item.definition.steps.length;
    if (final) this.finishCase();
    this.feedback = {
      verdict,
      title: correct
        ? match?.discretionary
          ? 'Supported referee judgment'
          : 'Correct call'
        : verdict === 'wrong-target'
          ? 'Right rule, wrong target'
          : verdict === 'premature'
            ? 'Called too early'
            : 'Reconsider this call',
      detail:
        item.assisted && correct ? `Assisted decision. ${detail}` : detail,
      effect,
      rule: appliedRules[0]?.url ?? ruleUrl(item.definition),
      appliedRules,
      final,
    };
    this.history.unshift({
      call: `${label}${submitted.target ? ` · ${robotName(submitted.target)}` : ''}`,
      verdict,
      detail: effect,
      at: this.recordingTime,
    });
    this.history = this.history.slice(0, 40);
    this.phase = 'feedback';
    return true;
  }

  private finishCase() {
    const item = this.active;
    if (item) this.finishIncident(item);
  }

  private finishIncident(item: ActiveIncident) {
    if (item.finished) return;
    item.finished = true;
    this.assess(item, item.mistakes ? 'wrong' : 'correct');
    this.completedCount++;
    if (item.assisted) this.assistedCount++;
    else if (!item.mistakes) this.correctCount++;
    this.completed.push({
      id: item.definition.id,
      family: item.definition.family,
      correct: !item.mistakes && !item.assisted,
    });
  }

  continue() {
    if (this.sessionFinished) return;
    if (this.mode === 'continuous') {
      this.userPaused = false;
      this.manualHold = false;
      this.feedback = null;
      this.syncMotion();
      return;
    }
    if (this.phase !== 'feedback' || !this.active) return;
    if (!this.feedback?.final) {
      this.feedback = null;
      this.phase = 'decision';
      return;
    }
    const wasNatural = this.active.natural;
    this.active = null;
    this.feedback = null;
    this.countFor = null;
    this.countCompleted = false;
    this.countAnchor = null;
    this.manualHold = false;
    let next = this.pending.shift();
    while (next) {
      this.skipResolvedSteps(next);
      if (!next.finished && next.step < next.definition.steps.length) break;
      next = this.pending.shift();
    }
    if (next) {
      this.active = next;
      if (next.replay) this.recorder.last = next.replay;
    }
    this.phase = next ? 'decision' : 'live';
    if (!wasNatural) this.untilIncident = 6 + this.bag.random() * 7;
    // Continue the resulting position; no hidden correction of a wrong call.
  }

  private remove(id: string, reason: string, inspection = false) {
    if (!this.match.removeRobot(id)) return 'Robot is already off the field.';
    // Each bench visit starts a fresh return lifecycle, even if another removal
    // follows immediately after a return while the simulation is paused.
    this.observations.delete(`return:${id}`);
    this.outRobots.delete(id);
    if (this.damage?.robot === id)
      this.damage = { ...this.damage, removed: true };
    const ready = reason === 'Out of bounds' || reason === 'Early start';
    this.bench[id] = {
      robot: id,
      reason,
      removedAt: this.clock,
      eligibleAt: this.clock + (inspection ? 0 : 60),
      ready,
      readyAt: ready ? this.clock : this.clock + this.simulatedRepairDelay(id),
      kickoff: this.kickoffSerial + 1,
    };
    return `${robotName(id)} removed; motors off. ${inspection ? 'Await official correction and permission.' : '60-second timer set; it runs when you resume the match.'}`;
  }

  private apply(submitted: RefereeCall): string {
    const item = this.active!;
    const { action, target = '' } = submitted;
    if (action === 'play-on' || action === 'resume') {
      item.permitContact = true;
      item.releaseAfterCall = true;
      // Grant this contact permission at the call, not later at feedback dismissal.
      // Once it separates, a fresh contact must produce a new decision and pause.
      const contact = this.contactDefinition();
      this.permittedContact = contact
        ? JSON.stringify([contact.id, contact.steps])
        : null;
      this.manualHold = false;
      if (action === 'resume') item.stopsPlay = false;
    }
    const actors = clonePoses(this.match.state.actors);
    const placeBall = (far: boolean, different = false) => {
      const spot = this.neutralSpot(far, 'ball', different);
      if (!spot)
        return 'All neutral spots are occupied; hold the placement until a spot is available.';
      this.invalidGoalPassage = null;
      this.match.place({ ...this.match.state.actors, ball: { ...spot } });
      this.heights.ball = 0.022;
      return `Ball moved to the ${far ? 'furthest' : 'nearest'} available${different ? ' different' : ''} neutral spot.`;
    };
    if (action === 'goal') {
      if (target !== 'blue' && target !== 'yellow')
        return 'No team was selected; the goal call was recorded without changing the score.';
      const waiting = item.definition.id.endsWith('both-damaged');
      this.match.awardGoal(target as MatchTeam, false);
      if (!waiting) {
        this.endScoredPassage();
        this.kickoffDue = true;
        this.kickoffTeam = target === 'blue' ? 'yellow' : 'blue';
        this.kickoffSerial++;
      }
      return `${target === 'blue' ? 'Blue' : 'Yellow'} +1.${waiting ? ' Keep play stopped until a working robot is ready.' : ' Conceding team kickoff is pending; eligible robots may return first.'}`;
    }
    if (action === 'no-goal') {
      item.stopsPlay = false;
      if (
        ['goal', 'own-goal', 'out-goal', 'pushing-goal', 'post'].includes(
          item.definition.id.replace(/^live-/, ''),
        )
      )
        this.invalidGoalPassage = null;
    }
    if (
      action === 'out' ||
      action === 'damaged' ||
      action === 'early-start' ||
      action === 'ball-out' ||
      action === 'inspect'
    ) {
      const result = this.remove(
        target,
        action === 'out'
          ? 'Out of bounds'
          : action === 'early-start'
            ? 'Early start'
            : action === 'inspect'
              ? 'Inspection'
              : 'Damaged',
        action === 'inspect',
      );
      if (action === 'ball-out') return `${result} ${placeBall(false)}`;
      return result;
    }
    if (action === 'pushing') return placeBall(true);
    if (action === 'lack-progress') {
      this.countFor = null;
      this.countCompleted = false;
      this.countAnchor = null;
      return placeBall(false, true);
    }
    if (action === 'count') {
      this.countFor = 0;
      this.countAnchor = { ...this.match.state.actors.ball };
      this.manualHold = false;
      return 'Visible count started. Watch whether the stationary situation changes.';
    }
    if (action === 'multiple' || action === 'return') {
      if (action === 'multiple' && !actors[target])
        return 'That robot is already off the field; no further relocation is needed.';
      if (action === 'return' && !this.bench[target])
        return 'That robot is already on the field; no additional return is needed.';
      const spot = this.neutralSpot(true, target);
      if (!spot)
        return 'No neutral spot is clear. Keep the robot off until one becomes available.';
      actors[target] = {
        ...spot,
        yaw:
          action === 'return'
            ? Math.atan2(
                -spot.x,
                -this.match.attackDirection(teamOf(target)) *
                  FIELD.goalBackInnerFaceZ -
                  spot.z,
              )
            : (actors[target]?.yaw ?? 0),
      };
      this.match.state.actors[target] = actors[target];
      delete this.bench[target];
      if (action === 'return') {
        // Being removed and returned conclusively clears the old robot fault;
        // a new infringement need not wait for the absence debounce to expire.
        for (const [key, observed] of this.observations)
          if (
            observed.finished &&
            observed.definition.steps
              .flat()
              .some(
                (call) =>
                  call.target === target &&
                  [
                    'out',
                    'damaged',
                    'early-start',
                    'ball-out',
                    'inspect',
                  ].includes(call.action),
              )
          )
            this.observations.delete(key);
      }
      if (action === 'return' && this.kickoffDue) {
        // A return at a neutral spot changes the kickoff layout. Arrange it
        // again explicitly after all return requests have been handled.
        for (const pending of this.pending)
          if (pending.definition.id === 'live-ready') pending.finished = true;
        this.observations.delete(`ready::${this.kickoffSerial}`);
      }
      return `${robotName(target)} ${action === 'return' ? 'returned facing its own goal' : 'relocated'} at the furthest clear neutral spot.`;
    }
    if (action === 'keep-out')
      return `${robotName(target)} stays off the field; its timer and repair status are preserved.`;
    if (action === 'waive-out') {
      const pose = actors[target];
      if (!pose)
        return `${robotName(target)} is off the field; the correction was recorded without moving a robot.`;
      const correction = this.pushedOutCorrection(target, actors);
      if (!correction)
        return 'Pushed out called; the robot stays in play, but no collision-free correction is currently available.';
      this.match.state.actors[target] = correction;
      return 'Pushed out called; the robot stays in play and a small collision-free correction restores field clearance.';
    }
    if (action === 'correct-setup') {
      this.invalidGoalPassage = null;
      this.match.restart('neutral');
      return 'Neutral kickoff positions corrected; robots remain halted for your signal.';
    }
    if (action === 'start' || action === 'neutral') {
      item.releaseAfterCall = true;
      this.opening = false;
      this.kickoffDue = false;
      item.stopsPlay = false;
      this.manualHold = false;
      if (action === 'neutral') {
        this.invalidGoalPassage = null;
        this.match.restart('neutral');
      }
      return action === 'neutral'
        ? 'Neutral kickoff arranged and signalled.'
        : 'Start signal given; robots may move.';
    }
    if (action === 'separate') {
      const a = transformId('blue-1', item.variant),
        b = transformId('yellow-1', item.variant);
      if (!actors[a] || !actors[b])
        return 'The entangled pair is not on the field; the assistance call was recorded without a position change.';
      const dx = actors[a].x - actors[b].x,
        dz = actors[a].z - actors[b].z,
        d = Math.hypot(dx, dz) || 1;
      actors[a].x += (dx / d) * 0.05;
      actors[a].z += (dz / d) * 0.05;
      actors[b].x -= (dx / d) * 0.05;
      actors[b].z -= (dz / d) * 0.05;
      this.match.state.actors[a] = actors[a];
      this.match.state.actors[b] = actors[b];
      return 'Only the entangled pair separated, just enough to move freely.';
    }
    if (action === 'pause') {
      item.stopsPlay = true;
      return 'All robots stopped in place, untouched. The official check / ball replacement now takes place.';
    }
    if (action === 'interference')
      return 'The team intervention was stopped before contact; the robots remain in their original positions.';
    if (action === 'holding')
      return 'Robot flagged for mechanism inspection. The training match remains paused for your review; no invented fixed holding penalty is awarded.';
    if (action === 'void') {
      this.fixtureEnded = true;
      this.drillReady = true;
      return 'The unplayable fixture is recorded 0–0 in this exercise; no practice goal is awarded.';
    }
    if (action === 'wait')
      return 'No goal added. Wait for a working robot and apply the opponent-damage exception.';
    return action === 'no-goal'
      ? 'Score unchanged.'
      : 'Play may continue from the observed positions.';
  }
}
