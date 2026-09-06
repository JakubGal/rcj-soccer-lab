import { SoccerMatch, MATCH_STEP, MATCH_ROBOTS, type MatchTeam } from './match';
import { NEUTRAL_SPOTS } from '../rulebook/animations';
import { RCJ_FIELD_DERIVED as FIELD } from './field-spec';
import { clonePoses } from './manual-layout';
import type { Pose } from './types';
import type { DamageCue } from './damage-effects';
import { SituationRecorder, type SituationReplay } from './situation-replay';
import { KickoffMeeting, randomKickoff, type GoalEnd } from './kickoff';
import { insidePenalty, robotPenaltyOverlap } from './referee-geometry';
import { rulesForDecision, type AppliedRule } from './referee-rules';
import { DEFAULT_ROBOT_VISUAL_ID, type RobotVisualId } from './robot-models';
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
  readyAt: number;
  ready: boolean;
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
};
export type TrainingPhase =
  | 'live'
  | 'evidence'
  | 'decision'
  | 'feedback'
  | 'ready';
const unchanged: Variant = { swap: false, reflect: false };
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
  private opening = false;

  /** Trainer pause is separate from a stoppage required by the match rules. */
  private get decisionPaused() {
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
      this.manualHold ||
      this.opening ||
      this.fixtureEnded ||
      this.decisionPaused ||
      (this.phase !== 'evidence' &&
        (this.kickoffDue || Boolean(this.active?.stopsPlay)))
    );
  }
  private syncMotion() {
    if (this.motionHeld) this.match.holdMotion();
    else this.match.releaseReferee();
  }
  resumeMotion() {
    this.syncMotion();
  }
  getLastReplay() {
    return this.recorder.getLast();
  }
  private capture() {
    const state = this.match.snapshot();
    this.recorder.capture({
      at: this.recordingTime,
      actors: state.actors,
      heights: this.heights,
      score: state.score,
      elapsed: state.elapsed,
      damage: this.damage,
    });
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
  private noteOut(item: ActiveIncident) {
    if (
      !['wall', 'full-area', 'out-goal'].includes(
        item.definition.id.replace(/^live-/, ''),
      )
    )
      return;
    for (const call of item.definition.steps.flat())
      if (call.action === 'out' && call.target)
        this.outRobots.add(transformId(call.target, item.variant));
  }
  private skipResolvedSteps(item: ActiveIncident) {
    while (item.step < item.definition.steps.length) {
      const choices = item.definition.steps[item.step];
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

  /** A scored passage ends positional corrections, but not robot penalties. */
  private endScoredPassage() {
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
      if (positional.has(item.definition.id.replace(/^live-/, '')))
        return false;
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
      }
    }
  }

  get canArrangeKickoff() {
    return (
      this.kickoffDue &&
      !this.active &&
      (['blue', 'yellow'] as const).every((team) =>
        MATCH_ROBOTS.some(
          (robot) => robot.team === team && this.match.state.actors[robot.id],
        ),
      )
    );
  }
  get canAdvance() {
    if (this.opening) return false;
    return (
      this.phase === 'evidence' ||
      !this.motionHeld ||
      (this.phase === 'live' &&
        this.kickoffDue &&
        !this.canArrangeKickoff &&
        !this.manualHold)
    );
  }

  constructor(
    readonly seed: number,
    options: { preMatch?: boolean; robotVisual?: RobotVisualId } = {},
  ) {
    this.robotVisual = options.robotVisual ?? DEFAULT_ROBOT_VISUAL_ID;
    this.bag = new IncidentBag(seed);
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
    this.robotVisual = visual;
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
    const scene = caseScene(definition, time, variant);
    if (this.match.blueAttackDirection === -1)
      for (const pose of Object.values(scene.poses)) {
        pose.x = -pose.x;
        pose.z = -pose.z;
        pose.yaw += Math.PI;
      }
    return scene;
  }
  get decisionKey() {
    return `${this.active?.number ?? this.serial}:${this.active?.step ?? 0}`;
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
      phase: this.phase,
      simulationTime: this.clock,
      heights: { ...this.heights },
      facts,
      penaltyEvidence: Boolean(
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
      caseNumber: this.serial,
      count: this.countFor === null ? null : Math.floor(this.countFor) + 1,
      canReplay: Boolean(
        item && !item.natural && item.step === 0 && this.phase === 'decision',
      ),
      kickoffDue: this.kickoffDue,
      kickoffTeam: this.kickoffTeam,
      canArrangeKickoff: this.canArrangeKickoff,
      canAdvance: this.canAdvance,
      motionHeld: this.motionHeld,
      decisionPaused: this.decisionPaused,
      drillReady: this.drillReady,
      canStartCase:
        !this.opening &&
        !item &&
        !this.pending.length &&
        !Object.keys(this.bench).length &&
        !this.kickoffDue,
      pendingDecisions: this.pending.length,
      opening: this.opening ? this.meeting.snapshot() : null,
      blueAttackDirection: this.match.blueAttackDirection,
      decisionTitle: item?.definition.title ?? '',
      assisted: this.assistedCount,
      help: this.help(),
      resolving: this.resolving !== null,
      canReplayLast: Boolean(this.recorder.last),
      lastSituationTitle: this.recorder.last?.title ?? '',
      canResumeEvidence: Boolean(
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
    if (
      this.opening ||
      this.active ||
      Object.keys(this.bench).length ||
      this.kickoffDue
    )
      return false;
    this.damage = null;
    this.manualHold = false;
    this.drillReady = false;
    this.fixtureEnded = false;
    this.outRobots.clear();
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
        readyAt: this.clock + 12,
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
    if (this.active || Object.keys(this.bench).length || this.kickoffDue)
      return false;
    return this.beginCase(this.bag.next());
  }

  /** New layouts are always an explicit user operation. */
  arrangeKickoff() {
    if (!this.canArrangeKickoff) return false;
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
    if (!this.snapshot().canResumeEvidence) return false;
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
    const key = this.incidentKey(definition, unchanged);
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
    };
    this.noteOut(incident);
    this.capture();
    incident.replay = this.recorder.seal(definition.title, definition.facts);
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
        this.phase = 'decision';
        this.resolveAssistedSteps();
      }
      return;
    }
    if (!this.canArrangeKickoff) this.clock += MATCH_STEP;
    for (const entry of Object.values(this.bench))
      if (!entry.ready && this.clock >= entry.readyAt) entry.ready = true;
    const requested = Object.values(this.bench).find((entry) =>
      this.canReturn(entry.robot),
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
      this.match.holdMotion();
      return;
    }
    if (this.detectLiveIncident()) return;
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
    this.match.step({
      controls: { blue: 'ai', yellow: 'ai' },
      selectedRobot: 'blue-1',
      duration: Number.MAX_SAFE_INTEGER,
      referee: true,
      disabledRobots,
    });
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
    this.resolveAssistedSteps();
    this.untilIncident -= MATCH_STEP;
    if (this.untilIncident <= 0) this.drillReady = true;
  }

  private detectLiveIncident() {
    const pending = this.match.state.pendingEvent;
    const boundaries = MATCH_ROBOTS.filter((r) => {
      const p = this.match.state.actors[r.id];
      return (
        p &&
        (Math.abs(p.x) >= FIELD.floorHalfWidth - 0.10001 ||
          Math.abs(p.z) >= FIELD.floorHalfLength - 0.10001 ||
          [-1, 1].some((end) =>
            robotPenaltyOverlap(p, end, this.robotVisual, true),
          ))
      );
    });
    const boundary = boundaries[0];
    if (pending) {
      const scoringOffender =
        pending.kind === 'goal'
          ? MATCH_ROBOTS.find(
              (r) =>
                r.team === pending.team &&
                this.match.state.actors[r.id] &&
                (this.outRobots.has(r.id) || boundaries.includes(r)),
            )
          : undefined;
      const pushing =
        pending.kind === 'goal'
          ? [this.active, ...this.pending].find(
              (item) =>
                item &&
                !item.finished &&
                ['pushing', 'combined'].includes(
                  item.definition.id.replace(/^live-/, ''),
                ) &&
                item.definition.steps[item.step]?.some(
                  (call) => call.action === 'pushing',
                ) &&
                !item.permitContact,
            )
          : null;
      if (pending.kind === 'goal' && scoringOffender)
        this.beginLive(
          this.liveDefinition(
            'out-goal',
            `${scoringOffender.label} is out of bounds and still on the field when its team scores.`,
            [
              [{ action: 'no-goal' }],
              [{ action: 'out', target: scoringOffender.id }],
            ],
          ),
        );
      else if (pending.kind === 'goal' && pushing) {
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
        if (pushing.definition.id.replace(/^live-/, '') === 'combined')
          steps.push([
            {
              action: 'multiple',
              target: `farther:${
                pushing.definition.steps
                  .flat()
                  .find((call) => call.action === 'multiple')
                  ?.target?.split(':')[1] ??
                transformId('blue', pushing.variant)
              }`,
            },
          ]);
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
      this.syncMotion();
      return this.motionHeld;
    }
    if (boundary) {
      const fullyInside = [-1, 1].some((end) =>
        robotPenaltyOverlap(
          this.match.state.actors[boundary.id],
          end,
          this.robotVisual,
          true,
        ),
      );
      this.beginLive(
        this.liveDefinition(
          fullyInside ? 'full-area' : 'wall',
          fullyInside
            ? `${boundary.label} has entered a penalty area with its whole footprint.`
            : `${boundary.label} has touched the wall.`,
          [[{ action: 'out', target: boundary.id }]],
        ),
      );
      this.syncMotion();
      return this.motionHeld;
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
    if (defenders && pushing) {
      return this.liveDefinition(
        'combined',
        `${robotName(defenders.team)} 1 and ${robotName(defenders.team)} 2 overlap the same penalty area while opponents touch and contest the ball there. If you judge the contact pushing, resolve it first.`,
        [
          [
            { action: 'pushing', discretionary: true },
            {
              action: 'multiple',
              target: `farther:${defenders.team}`,
              discretionary: true,
              complete: true,
            },
          ],
          [{ action: 'multiple', target: `farther:${defenders.team}` }],
        ],
      );
    }
    if (defenders) {
      return this.liveDefinition(
        'multiple',
        `${robotName(defenders.team)} 1 and ${robotName(defenders.team)} 2 overlap the same penalty area. Compare their distances to the ball.`,
        [[{ action: 'multiple', target: `farther:${defenders.team}` }]],
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
    if (!this.active) return [];
    if (this.active.progressResumed)
      return [
        { action: 'play-on', complete: true },
        { action: 'resume', complete: true },
      ];
    const { definition, variant, step } = this.active;
    const current = definition.steps[step] ?? [];
    if (
      current.some((call) => call.action === 'multiple') &&
      !current.some((call) => call.action === 'pushing') &&
      !this.multipleStillPresent(this.active)
    )
      return [
        { action: 'play-on', complete: true },
        { action: 'resume', complete: true },
      ];
    const returning = this.returnRequest(this.active);
    if (returning)
      return [
        {
          action: this.canReturn(returning) ? 'return' : 'keep-out',
          target: returning,
        },
      ];
    return (definition.steps[step] ?? []).map((entry) => ({
      ...entry,
      target: entry.target?.startsWith('farther')
        ? this.fartherDefender(
            (entry.target.split(':')[1] ??
              transformId('blue', variant)) as MatchTeam,
          )
        : entry.target
          ? transformId(entry.target, variant)
          : undefined,
    }));
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
      return 'Check whether a robot from the scoring team had already been called out and was still on the field when the ball reached the back wall.';
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
    if (!this.active || this.active.finished) return false;
    this.active.assisted = true;
    this.active.hintLevel = answer ? 3 : Math.min(3, this.active.hintLevel + 1);
    return true;
  }

  /** Help uses exactly the same adjudication and penalties as manual calls. */
  resolveForMe() {
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
  private fartherDefender(team: MatchTeam) {
    const actors = this.match.state.actors;
    return MATCH_ROBOTS.filter(
      (robot) => robot.team === team && actors[robot.id],
    ).sort(
      (a, b) =>
        distance(actors[b.id], actors.ball) -
        distance(actors[a.id], actors.ball),
    )[0]?.id;
  }

  canReturn(id: string) {
    const entry = this.bench[id];
    return Boolean(
      entry?.ready &&
      (this.clock + 1e-8 >= entry.eligibleAt ||
        (this.kickoffDue && this.kickoffSerial >= entry.kickoff)) &&
      this.neutralSpot(true, id),
    );
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

  submit(key: string, submitted: RefereeCall): boolean {
    if (this.opening && this.meeting.stage !== 'ready') return false;
    if (key !== this.decisionKey || this.phase === 'feedback') return false;
    this.refreshProgress();
    // Return requests can be judged directly from the bench during live play.
    if (
      !this.active &&
      (submitted.action === 'return' || submitted.action === 'keep-out') &&
      submitted.target &&
      this.bench[submitted.target]
    ) {
      const valid = this.canReturn(submitted.target);
      this.beginLive(
        this.liveDefinition(
          valid ? 'return-ready' : 'return-early',
          `${robotName(submitted.target)} requests return. Check repair status, remaining time and kickoff eligibility.`,
          [
            [
              {
                action: valid ? 'return' : 'keep-out',
                target: submitted.target,
              },
            ],
          ],
        ),
      );
    }
    if (!this.active)
      this.beginLive(
        this.contactDefinition() ??
          this.liveDefinition(
            'dribbler',
            'No infringement has been established by the current field evidence. Decide whether to let play continue.',
            [[{ action: 'play-on' }, { action: 'resume' }]],
          ),
      );
    const item = this.active!;
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
    const correct = Boolean(match) && !premature && this.countFor === null;
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
      : premature || this.countFor !== null
        ? 'premature'
        : rightAction
          ? 'wrong-target'
          : 'incorrect';
    let effect = 'No match change applied. Review the evidence and try again.';
    if (correct) {
      effect = this.apply({ ...submitted, action: match!.action });
      item.initial = clonePoses(this.match.state.actors);
    } else item.mistakes = true;
    const label =
      REFEREE_ACTIONS.find((action) => action.id === submitted.action)?.label ??
      submitted.action;
    const detail = premature
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
    });
    this.history = this.history.slice(0, 40);
    this.phase = 'feedback';
    return true;
  }

  private finishCase() {
    const item = this.active;
    if (!item || item.finished) return;
    item.finished = true;
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
      if (next.step < next.definition.steps.length) break;
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
      readyAt: this.clock + 12,
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
      this.match.place({ ...this.match.state.actors, ball: { ...spot } });
      this.heights.ball = 0.022;
      return `Ball moved to the ${far ? 'furthest' : 'nearest'} available${different ? ' different' : ''} neutral spot.`;
    };
    if (action === 'goal') {
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
    if (action === 'no-goal') item.stopsPlay = false;
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
      return `${robotName(target)} ${action === 'return' ? 'returned facing its own goal' : 'relocated'} at the furthest clear neutral spot.`;
    }
    if (action === 'keep-out')
      return `${robotName(target)} stays off the field; its timer and repair status are preserved.`;
    if (action === 'waive-out') {
      const pose = actors[target];
      pose.x = Math.max(
        -FIELD.floorHalfWidth + 0.105,
        Math.min(FIELD.floorHalfWidth - 0.105, pose.x),
      );
      pose.z = Math.max(
        -FIELD.floorHalfLength + 0.105,
        Math.min(FIELD.floorHalfLength - 0.105, pose.z),
      );
      this.match.state.actors[target] = pose;
      return 'Pushed-out penalty waived; a small correction restores field clearance.';
    }
    if (action === 'correct-setup') {
      this.match.restart('neutral');
      return 'Neutral kickoff positions corrected; robots remain halted for your signal.';
    }
    if (action === 'start' || action === 'neutral') {
      item.releaseAfterCall = true;
      this.opening = false;
      this.kickoffDue = false;
      item.stopsPlay = false;
      this.manualHold = false;
      if (action === 'neutral') this.match.restart('neutral');
      return action === 'neutral'
        ? 'Neutral kickoff arranged and signalled.'
        : 'Start signal given; robots may move.';
    }
    if (action === 'separate') {
      const a = transformId('blue-1', item.variant),
        b = transformId('yellow-1', item.variant);
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
