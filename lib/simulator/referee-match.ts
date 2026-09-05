import { SoccerMatch, MATCH_STEP, MATCH_ROBOTS, type MatchTeam } from './match';
import { NEUTRAL_SPOTS } from '../rulebook/animations';
import {
  RCJ_FIELD_DERIVED as FIELD,
  RCJ_FIELD_SPEC_2026 as SPEC,
} from './field-spec';
import { clonePoses } from './manual-layout';
import type { Pose } from './types';
import {
  REFEREE_CASES,
  REFEREE_ACTIONS,
  IncidentBag,
  caseScene,
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
  finished: boolean;
  initial: Record<string, Pose>;
};
export type TrainingPhase = 'live' | 'evidence' | 'decision' | 'feedback';
const unchanged: Variant = { swap: false, reflect: false };
const distance = (a: Pose, b: Pose) => Math.hypot(a.x - b.x, a.z - b.z);
const robotName = (id: string) =>
  MATCH_ROBOTS.find((item) => item.id === id)?.label ?? id;
const teamOf = (id: string): MatchTeam =>
  id.startsWith('blue') ? 'blue' : 'yellow';

/** Conservative circular-footprint evidence in the marked, rounded penalty areas. */
export function insidePenalty(point: Pose, end: number) {
  const x = Math.abs(point.x),
    z = point.z * end;
  if (
    x > SPEC.penaltyArea.width / 2 ||
    z > FIELD.penaltyBackEdgeZ ||
    z < FIELD.penaltyBackEdgeZ - SPEC.penaltyArea.depth
  )
    return false;
  return (
    x <= FIELD.penaltyArcCenterX ||
    z >= FIELD.penaltyArcCenterZ ||
    Math.hypot(x - FIELD.penaltyArcCenterX, z - FIELD.penaltyArcCenterZ) <=
      SPEC.penaltyArea.outerCornerRadius
  );
}
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
  phase: TrainingPhase = 'live';
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

  constructor(readonly seed: number) {
    this.bag = new IncidentBag(seed);
    this.match.restart('neutral');
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
        !item.natural &&
        item.time + 1e-8 < item.definition.end - (item.definition.start ?? 0);
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
      decisionKey: this.decisionKey,
      feedback: this.feedback ? { ...this.feedback } : null,
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
    };
  }

  /** Explicit incident selection also powers the labelled practice-topic selector. */
  beginCase(definition: RefereeCase, variant = this.bag.variant()) {
    if (this.active || Object.keys(this.bench).length) return false;
    const scene = caseScene(definition, 0, variant);
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
      finished: false,
      initial: clonePoses(this.match.state.actors),
    };
    this.feedback = null;
    this.countCompleted = false;
    this.phase =
      definition.end > (definition.start ?? 0) ? 'evidence' : 'decision';
    return true;
  }

  nextCase() {
    if (this.active || Object.keys(this.bench).length || this.kickoffDue)
      return false;
    return this.beginCase(this.bag.next());
  }

  private beginLive(definition: RefereeCase) {
    this.active = {
      definition,
      variant: unchanged,
      number: ++this.serial,
      step: 0,
      time: 0,
      natural: true,
      mistakes: false,
      finished: false,
      initial: clonePoses(this.match.state.actors),
    };
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
      wall: 'Remove the identified out-of-bounds robot. Its one-minute waiting period starts at removal while the other robots keep playing.',
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
    if (this.phase === 'feedback' || this.phase === 'decision') return;
    if (this.countFor !== null) {
      this.countFor += MATCH_STEP;
      if (this.countFor >= 3) {
        this.countFor = null;
        this.countCompleted = true;
        this.phase = 'decision';
      }
      return;
    }
    if (this.phase === 'evidence' && this.active) {
      this.active.time += MATCH_STEP;
      const item = this.active;
      const scene = caseScene(item.definition, item.time, item.variant);
      for (const id of Object.keys(this.bench)) delete scene.poses[id];
      this.match.place(scene.poses);
      this.heights = scene.heights;
      if (item.time >= item.definition.end - (item.definition.start ?? 0))
        this.phase = 'decision';
      return;
    }
    this.clock += MATCH_STEP;
    for (const entry of Object.values(this.bench))
      if (!entry.ready && this.clock >= entry.readyAt) entry.ready = true;
    // Requests happen during actual simulated play, without respawning robots.
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
      return;
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
        return;
      }
      this.match.restart(this.kickoffTeam);
      this.kickoffDue = false;
    }
    this.match.step({
      controls: { blue: 'ai', yellow: 'ai' },
      selectedRobot: 'blue-1',
      duration: Number.MAX_SAFE_INTEGER,
      referee: true,
    });
    const pending = this.match.state.pendingEvent;
    const boundaries = MATCH_ROBOTS.filter((r) => {
      const p = this.match.state.actors[r.id];
      return (
        p &&
        (Math.abs(p.x) >= FIELD.floorHalfWidth - 0.10001 ||
          Math.abs(p.z) >= FIELD.floorHalfLength - 0.10001 ||
          [-1, 1].some((end) => penaltyOverlap(p, end, true)))
      );
    });
    const boundary = boundaries[0];
    if (pending) {
      const scoringOffender =
        pending.kind === 'goal'
          ? boundaries.find((r) => r.team === pending.team)
          : undefined;
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
      else if (pending.kind === 'goal')
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
      return;
    }
    if (boundary) {
      this.beginLive(
        this.liveDefinition(
          'wall',
          `${boundary.label} has touched the wall or entered a penalty area with its whole footprint.`,
          [[{ action: 'out', target: boundary.id }]],
        ),
      );
      return;
    }
    this.untilIncident -= MATCH_STEP;
    if (this.untilIncident <= 0 && !Object.keys(this.bench).length)
      this.nextCase();
  }

  whistle() {
    if (this.phase === 'feedback') return;
    if (this.active) {
      this.phase = 'decision';
      return;
    }
    const poses = this.match.state.actors;
    let defenders: { team: MatchTeam; end: number } | null = null;
    for (const end of [-1, 1])
      for (const team of ['blue', 'yellow'] as const) {
        if (
          MATCH_ROBOTS.filter(
            (r) =>
              r.team === team &&
              poses[r.id] &&
              penaltyOverlap(poses[r.id], end),
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
                penaltyOverlap(poses[a.id], end) ||
                penaltyOverlap(poses[b.id], end),
            ),
        ),
    );
    if (defenders && pushing) {
      this.beginLive(
        this.liveDefinition(
          'combined',
          'Two teammates partly overlap one penalty area while opponents touch and contest the ball there. If you judge the contact pushing, resolve it first.',
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
        ),
      );
      return;
    }
    if (defenders) {
      this.beginLive(
        this.liveDefinition(
          'multiple',
          'Two teammates partly overlap the same penalty area. Compare their distances to the ball.',
          [[{ action: 'multiple', target: `farther:${defenders.team}` }]],
        ),
      );
      return;
    }
    if (pushing) {
      this.beginLive(
        this.liveDefinition(
          'pushing',
          'Opposing robots touch, at least one overlaps a penalty area, and a robot contacts the ball. Assess the contact.',
        ),
      );
      return;
    }
    this.beginLive(
      this.liveDefinition(
        'dribbler',
        'Play has been stopped for your assessment. No automatically confirmed infringement is pending.',
        [[{ action: 'play-on' }, { action: 'resume' }]],
      ),
    );
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
    this.phase = 'evidence';
    return true;
  }

  private expected(): RequiredCall[] {
    if (!this.active) return [];
    const { definition, variant, step } = this.active;
    return definition.steps[step].map((entry) => ({
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
  private fartherDefender(team: MatchTeam) {
    return MATCH_ROBOTS.filter(
      (robot) => robot.team === team && this.match.state.actors[robot.id],
    ).sort(
      (a, b) =>
        distance(this.match.state.actors[b.id], this.match.state.actors.ball) -
        distance(this.match.state.actors[a.id], this.match.state.actors.ball),
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
    if (key !== this.decisionKey || this.phase === 'feedback') return false;
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
    if (!this.active) this.whistle();
    const item = this.active!;
    const earlyBallOut =
      item.definition.id === 'ball-out' &&
      ((this.heights.ball ?? 0.022) > SPEC.wall.height ||
        Math.abs(this.match.state.actors.ball.x) > FIELD.floorHalfWidth);
    const premature =
      !item.natural &&
      !earlyBallOut &&
      item.time + 1e-8 < item.definition.end - (item.definition.start ?? 0);
    if (
      premature &&
      (submitted.action === 'play-on' || submitted.action === 'resume')
    ) {
      this.phase = 'evidence';
      return true;
    }
    const choices = this.expected();
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
    if (correct) effect = this.apply({ ...submitted, action: match!.action });
    else item.mistakes = true;
    const label =
      REFEREE_ACTIONS.find((action) => action.id === submitted.action)?.label ??
      submitted.action;
    const detail = premature
      ? 'That part of the incident has not happened yet. Watch the complete evidence before deciding.'
      : correct
        ? transformText(item.definition.explanation, item.variant)
        : `Expected ${choices.map((entry) => `${REFEREE_ACTIONS.find((action) => action.id === entry.action)?.label}${entry.target ? ` (${robotName(entry.target)})` : ''}`).join(' or ')}. ${transformText(item.definition.explanation, item.variant)}`;
    if (correct)
      item.step = match?.complete
        ? item.definition.steps.length
        : item.step + 1;
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
      detail,
      effect,
      rule: ruleUrl(item.definition),
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
    if (!item.mistakes) this.correctCount++;
    this.completed.push({
      id: item.definition.id,
      family: item.definition.family,
      correct: !item.mistakes,
    });
  }

  continue() {
    if (this.phase !== 'feedback' || !this.active) return;
    if (!this.feedback?.final) {
      const correct = ['correct', 'supported'].includes(
        this.feedback?.verdict ?? '',
      );
      this.feedback = null;
      if (
        correct &&
        this.active.definition.steps[this.active.step - 1]?.[0].action ===
          'count'
      ) {
        this.countFor = 0;
        this.phase = 'evidence';
      } else if (
        this.countFor !== null ||
        (!correct &&
          this.active.time <
            this.active.definition.end - (this.active.definition.start ?? 0))
      )
        this.phase = 'evidence';
      else this.phase = 'decision';
      return;
    }
    const wasNatural = this.active.natural;
    this.active = null;
    this.feedback = null;
    this.heights = {};
    this.countFor = null;
    this.phase = 'live';
    if (!wasNatural) this.untilIncident = 6 + this.bag.random() * 7;
    // Continue the resulting position; no hidden correction of a wrong call.
    this.match.releaseReferee();
  }

  private remove(id: string, reason: string, inspection = false) {
    if (!this.match.removeRobot(id)) return 'Robot is already off the field.';
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
    return `${robotName(id)} removed; motors off. ${inspection ? 'Await official correction and permission.' : '60-second timer started; the other robots continue.'}`;
  }

  private apply(submitted: RefereeCall): string {
    const item = this.active!;
    const { action, target = '' } = submitted;
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
        this.kickoffDue = true;
        this.kickoffTeam = target === 'blue' ? 'yellow' : 'blue';
        this.kickoffSerial++;
      }
      return `${target === 'blue' ? 'Blue' : 'Yellow'} +1.${waiting ? ' Keep play stopped until a working robot is ready.' : ' Conceding team kickoff is pending; eligible robots may return first.'}`;
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
    if (action === 'lack-progress') return placeBall(false, true);
    if (action === 'count')
      return 'Visible count started. Watch whether the stationary situation changes.';
    if (action === 'multiple' || action === 'return') {
      const spot = this.neutralSpot(true, target);
      if (!spot)
        return 'No neutral spot is clear. Keep the robot off until one becomes available.';
      actors[target] = {
        ...spot,
        yaw:
          action === 'return'
            ? Math.atan2(
                -spot.x,
                (teamOf(target) === 'blue' ? -1 : 1) *
                  FIELD.goalBackInnerFaceZ -
                  spot.z,
              )
            : (actors[target]?.yaw ?? 0),
      };
      this.match.place(actors);
      delete this.bench[target];
      return `${robotName(target)} ${action === 'return' ? 'returned facing its own goal' : 'relocated'} at the furthest clear neutral spot.`;
    }
    if (action === 'keep-out')
      return `${robotName(target)} stays off the field; its timer and repair status are preserved.`;
    if (action === 'waive-out') {
      const previous = caseScene(item.definition, 0, item.variant);
      this.match.place(previous.poses);
      return 'Pushed-out penalty waived; a small correction restores field clearance.';
    }
    if (action === 'correct-setup') {
      this.match.restart('neutral');
      return 'Neutral kickoff positions corrected; robots remain halted for your signal.';
    }
    if (action === 'start' || action === 'neutral') {
      this.kickoffDue = false;
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
      this.match.place(actors);
      return 'Only the entangled pair separated, just enough to move freely.';
    }
    if (action === 'pause')
      return 'All robots stopped in place, untouched. The official check / ball replacement now takes place.';
    if (action === 'interference')
      return 'The team intervention was stopped before contact; the robots remain in their original positions.';
    if (action === 'holding')
      return 'Play held for inspection. After the mechanism is corrected, this exercise resumes with a released ball; no invented fixed holding penalty is awarded.';
    if (action === 'void')
      return 'The unplayable fixture is recorded 0–0 in this exercise; no practice goal is awarded.';
    if (action === 'wait')
      return 'No goal added. Wait for a working robot and apply the opponent-damage exception.';
    return action === 'no-goal'
      ? 'Score unchanged.'
      : 'Play may continue from the observed positions.';
  }
}
