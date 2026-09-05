import {
  RULE_CLIPS,
  sampleClip,
  type RuleClip,
  type RuleScene,
} from '../rulebook/animations';
import type { Pose } from './types';

export const REFEREE_ACTIONS = [
  { id: 'play-on', label: 'Play on', target: false, group: 'Play' },
  { id: 'goal', label: 'Award goal', target: true, group: 'Score' },
  { id: 'no-goal', label: 'Disallow goal', target: false, group: 'Score' },
  { id: 'out', label: 'Out of bounds · remove', target: true, group: 'Robot' },
  { id: 'damaged', label: 'Damaged · remove', target: true, group: 'Robot' },
  {
    id: 'early-start',
    label: 'Early start · remove',
    target: true,
    group: 'Robot',
  },
  {
    id: 'ball-out',
    label: 'Ball sent out · remove kicker',
    target: true,
    group: 'Robot',
  },
  {
    id: 'pushing',
    label: 'Pushing · move ball',
    target: false,
    group: 'Field',
  },
  {
    id: 'multiple',
    label: 'Multiple defense · relocate',
    target: true,
    group: 'Robot',
  },
  { id: 'count', label: 'Start visible count', target: false, group: 'Field' },
  {
    id: 'lack-progress',
    label: 'Lack of progress',
    target: false,
    group: 'Field',
  },
  {
    id: 'waive-out',
    label: 'Pushed out · waive & correct',
    target: true,
    group: 'Robot',
  },
  {
    id: 'holding',
    label: 'Holding · inspect mechanism',
    target: true,
    group: 'Robot',
  },
  { id: 'return', label: 'Permit return', target: true, group: 'Robot' },
  {
    id: 'keep-out',
    label: 'Keep robot off field',
    target: true,
    group: 'Robot',
  },
  {
    id: 'correct-setup',
    label: 'Correct kickoff placement',
    target: true,
    group: 'Robot',
  },
  { id: 'start', label: 'Signal kickoff', target: false, group: 'Restart' },
  { id: 'neutral', label: 'Neutral kickoff', target: false, group: 'Restart' },
  { id: 'pause', label: 'Stop all robots', target: false, group: 'Restart' },
  {
    id: 'resume',
    label: 'Resume same positions',
    target: false,
    group: 'Restart',
  },
  {
    id: 'separate',
    label: 'Referee: gently unstick',
    target: false,
    group: 'Field',
  },
  {
    id: 'interference',
    label: 'Stop team intervention',
    target: false,
    group: 'Field',
  },
  { id: 'wait', label: 'Wait · no goal award', target: false, group: 'Score' },
  {
    id: 'void',
    label: 'Do not play · record 0–0',
    target: false,
    group: 'Restart',
  },
  {
    id: 'inspect',
    label: 'Stop for official inspection',
    target: true,
    group: 'Robot',
  },
] as const;
export type RefereeAction = (typeof REFEREE_ACTIONS)[number]['id'];
export type RefereeCall = { action: RefereeAction; target?: string };
export type RequiredCall = RefereeCall & {
  discretionary?: boolean;
  complete?: boolean;
};
export type RefereeCase = {
  id: string;
  title: string;
  family: string;
  clip: string;
  start?: number;
  end: number;
  facts: string;
  before?: string;
  explanation: string;
  steps: RequiredCall[][];
  anchor?: string;
  bench?: { robot: string; waited: number; ready: boolean }[];
  kickoff?: boolean;
  kickoffTeam?: 'blue' | 'yellow' | 'neutral';
  opponentDamage?: boolean;
  repeated?: boolean;
};
const call = (
  action: RefereeAction,
  target?: string,
  discretionary?: boolean,
): RequiredCall => ({ action, target, discretionary });
const one = (action: RefereeAction, target?: string): RequiredCall[][] => [
  [call(action, target)],
];
const count = (): RequiredCall[][] => [
  one('count')[0],
  one('lack-progress')[0],
];

/** Assessment evidence ends BEFORE the lesson's answer or referee movement. */
export const REFEREE_CASES: RefereeCase[] = [
  {
    id: 'goal',
    title: 'Back-wall goal',
    family: 'Scoring',
    clip: 'goal-contact',
    end: 4,
    before: 'Follow the ball all the way through the goal.',
    facts: 'The shot touches the inside back wall of Yellow’s goal.',
    steps: one('goal', 'blue'),
    explanation:
      'Back-wall contact awards Blue one goal. Yellow takes the kickoff.',
  },
  {
    id: 'own-goal',
    title: 'Own goal',
    family: 'Scoring',
    clip: 'own-goal',
    end: 3,
    facts:
      'Blue last touched the ball; it then touches the inside back wall of Blue’s goal.',
    steps: one('goal', 'yellow'),
    explanation:
      'The goal end decides the scoring team, regardless of who last touched the ball.',
  },
  {
    id: 'post',
    title: 'Post deflection',
    family: 'Scoring',
    clip: 'goal-near-miss',
    end: 5,
    facts:
      'The ball hits the front of the post and returns to the field. It never reaches the goal back wall.',
    steps: [[call('play-on'), call('no-goal')]],
    explanation: 'No goal was scored. Leave the score unchanged and continue.',
  },
  {
    id: 'out-goal',
    title: 'Goal before an out robot is removed',
    family: 'Scoring',
    clip: 'goal-contact',
    end: 4,
    facts:
      'Blue 2 has already been called out of bounds but is still on the field when Blue scores.',
    steps: [one('no-goal')[0], one('out', 'blue-2')[0]],
    explanation:
      'Disallow the penalized team’s goal while its out-of-bounds robot remains on the field, then remove that robot. The minute starts at removal.',
    anchor: 'out-of-bounds',
  },
  {
    id: 'pushing',
    title: 'Penalty-area contact',
    family: 'Pushing & defense',
    clip: 'pushing-call',
    end: 2.5,
    facts:
      'Opponents touch beside the penalty area and both contact the ball. Consider whether this warrants a pushing call.',
    steps: [
      [call('pushing', undefined, true), call('play-on', undefined, true)],
    ],
    explanation:
      'This meets the conditions under which pushing may be called. Calling it moves the ball to the furthest free neutral spot; allowing play is referee discretion.',
  },
  {
    id: 'midfield',
    title: 'Legal midfield contact',
    family: 'Pushing & defense',
    clip: 'contact-midfield',
    end: 6,
    facts:
      'The robots contest the ball in midfield, outside both penalty areas. The ball escapes.',
    steps: one('play-on'),
    explanation: 'Contact alone does not establish penalty-area pushing.',
  },
  {
    id: 'multiple',
    title: 'Two partial defenders',
    family: 'Pushing & defense',
    clip: 'two-defenders',
    end: 2.5,
    facts:
      'Both Blue robots partly overlap the same penalty area. Compare their distances to the ball.',
    steps: one('multiple', 'farther'),
    explanation:
      'Relocate the robot farther from the ball to the furthest free neutral spot. A first partial overlap is not a one-minute removal.',
  },
  {
    id: 'combined',
    title: 'Pushing and multiple defense',
    family: 'Pushing & defense',
    clip: 'combined-order',
    end: 2.5,
    facts:
      'The penalty-area contact is judged pushing. Both Blue robots also partly overlap that area.',
    steps: [one('pushing')[0], one('multiple', 'farther')[0]],
    explanation:
      'Resolve pushing first, then reassess defender distances using the NEW ball position before relocating the farther defender.',
  },
  {
    id: 'pushing-goal',
    title: 'Goal resulting from pushing',
    family: 'Pushing & defense',
    clip: 'pushing-goal',
    end: 3,
    facts:
      'Pushing has been called in this contact. The resulting ball movement reaches Blue’s goal back wall.',
    steps: [one('no-goal')[0], one('pushing')[0]],
    explanation:
      'A goal resulting from pushing is not granted. Resolve the pushing ball placement.',
  },
  {
    id: 'repeat-defense',
    title: 'Repeated multiple defense',
    family: 'Pushing & defense',
    clip: 'two-defenders',
    end: 2.5,
    facts:
      'This is the same repeated multiple-defense violation after several earlier relocations.',
    steps: [
      [call('multiple', 'farther', true), call('damaged', 'farther', true)],
    ],
    explanation:
      'For repeated multiple defense, the referee may deem the robot damaged or use the normal relocation.',
  },
  {
    id: 'deadlock',
    title: 'Stationary contest',
    family: 'Lack of progress',
    clip: 'deadlock',
    end: 4,
    facts:
      'The ball and opponents remain stationary and the situation is unlikely to change. No referee count has been given yet.',
    steps: count(),
    explanation:
      'Give a visible, audible count, then move the ball to the nearest free neutral spot if the stalemate persists. The training count is illustrative, not a universal timeout.',
  },
  {
    id: 'repeat-progress',
    title: 'Unsuccessful neutral placement',
    family: 'Lack of progress',
    clip: 'deadlock-repeat',
    start: 2.5,
    end: 4,
    facts:
      'An earlier neutral placement did not help. The robots still do not respond.',
    steps: count(),
    repeated: true,
    explanation:
      'Count and reassess; a further lack-of-progress call may place the ball at a DIFFERENT available neutral spot.',
  },
  {
    id: 'wall',
    title: 'Wall contact',
    family: 'Out of bounds',
    clip: 'wall-touch',
    end: 2,
    facts: 'Blue 1 reaches the physical wall without being pushed there.',
    steps: one('out', 'blue-1'),
    explanation:
      'Remove Blue 1. Its 60-second penalty starts now; the remaining robots keep playing.',
  },
  {
    id: 'full-area',
    title: 'Entire robot in penalty area',
    family: 'Out of bounds',
    clip: 'full-area',
    end: 3,
    facts: 'The whole Blue 1 footprint is within the penalty area.',
    steps: one('out', 'blue-1'),
    explanation:
      'Full entry is out of bounds. Remove the robot for one minute or until an earlier kickoff.',
  },
  {
    id: 'partial-area',
    title: 'One partial overlap',
    family: 'Out of bounds',
    clip: 'full-area',
    end: 0,
    facts:
      'Only Blue 1 partly overlaps the area; the rest of its footprint remains outside. No wall contact.',
    steps: one('play-on'),
    explanation:
      'One partial overlap is allowed. Full entry and two teammates partly inside are different events.',
  },
  {
    id: 'pushed-out',
    title: 'Opponent-caused wall contact',
    family: 'Out of bounds',
    clip: 'pushed-out',
    end: 2.5,
    facts: 'Yellow 1 accidentally pushes Blue 1 into the wall.',
    steps: [[call('waive-out', 'blue-1', true), call('out', 'blue-1', true)]],
    explanation:
      'A pushed-out waiver and small correction are permitted, but not compulsory.',
  },
  {
    id: 'ball-out',
    title: 'High kick outside enclosure',
    family: 'Ball movement',
    clip: 'ball-over-wall',
    end: 3.5,
    facts: 'Blue 1 sends the ball beyond the enclosure, over the wall.',
    steps: one('ball-out', 'blue-1'),
    explanation:
      'The responsible robot is deemed damaged. The bench enforces its waiting period. This trainer retrieves the ball to a neutral spot under its stated exercise procedure.',
  },
  {
    id: 'holding',
    title: 'Trapped ball',
    family: 'Ball movement',
    clip: 'trapped-ball',
    end: 4,
    facts:
      'Blue 1 moves with a fixed, non-rolling ball that Yellow cannot take. The mechanism is represented schematically.',
    steps: one('holding', 'blue-1'),
    explanation:
      'Recognize holding and inspect the mechanism. The ball-movement rule does not prescribe a unique holding restart or fixed penalty; this exercise stops for inspection.',
  },
  {
    id: 'dribbler',
    title: 'Accessible backspin dribbler',
    family: 'Ball movement',
    clip: 'dribble-access',
    end: 6,
    facts:
      'The ball rolls with backspin, remains accessible, and comes free during the challenge.',
    steps: one('play-on'),
    explanation:
      'An accessible rotating-drum dribbler is permitted; possession alone is not holding.',
  },
  {
    id: 'damaged',
    title: 'Non-responsive robot',
    family: 'Damage & returns',
    clip: 'repair-clock',
    end: 0,
    facts:
      'Blue 1 has lost power and does not respond to the ball. The team asks permission to remove it.',
    steps: one('damaged', 'blue-1'),
    explanation:
      'Authorize removal with motors off. Repair and return permission are required in addition to time eligibility.',
  },
  {
    id: 'return-early',
    title: 'Premature return request',
    family: 'Damage & returns',
    clip: 'repair-kickoff',
    end: 0,
    facts:
      'Blue 1 is repaired and requests return after 25 seconds. Play is ongoing; no kickoff is due.',
    bench: [{ robot: 'blue-1', waited: 25, ready: true }],
    steps: one('keep-out', 'blue-1'),
    explanation:
      'A repair does not cancel the remaining waiting period. Keep the robot off until 60 seconds or a new kickoff.',
  },
  {
    id: 'return-ready',
    title: 'Eligible return',
    family: 'Damage & returns',
    clip: 'repair-kickoff',
    end: 0,
    facts:
      'Blue 1 has been off for 60 seconds, is repaired, and requests permission to return.',
    bench: [{ robot: 'blue-1', waited: 60, ready: true }],
    steps: one('return', 'blue-1'),
    explanation:
      'Permit return at the furthest clear neutral spot, facing its own goal.',
  },
  {
    id: 'return-broken',
    title: 'Time served but not repaired',
    family: 'Damage & returns',
    clip: 'repair-kickoff',
    end: 0,
    facts: 'Blue 1 has waited 65 seconds but its drive still does not work.',
    bench: [{ robot: 'blue-1', waited: 65, ready: false }],
    steps: one('keep-out', 'blue-1'),
    explanation:
      'Time served does not make an unrepaired robot eligible. It must be fully functional before return.',
  },
  {
    id: 'return-kickoff',
    title: 'Kickoff return exception',
    family: 'Damage & returns',
    clip: 'repair-kickoff',
    start: 3,
    end: 3,
    facts:
      'A kickoff is now due. Blue 1 is fully repaired after only 25 seconds off the field.',
    bench: [{ robot: 'blue-1', waited: 25, ready: true }],
    kickoff: true,
    steps: one('return', 'blue-1'),
    explanation:
      'A ready robot may return before a kickoff without waiting for the full minute.',
  },
  {
    id: 'both-damaged',
    title: 'Both robots unavailable at kickoff',
    family: 'Damage & returns',
    clip: 'both-damaged',
    end: 0,
    facts:
      'Both Blue robots remain damaged at kickoff after one complete 30-second interval. Neither was damaged by an opponent violation.',
    bench: [
      { robot: 'blue-1', waited: 30, ready: false },
      { robot: 'blue-2', waited: 30, ready: false },
    ],
    kickoff: true,
    steps: one('goal', 'yellow'),
    explanation:
      'Award Yellow one goal for this elapsed 30-second interval while play remains stopped.',
  },
  {
    id: 'damage-exception',
    title: 'Opponent-caused damage exception',
    family: 'Damage & returns',
    clip: 'both-damaged',
    end: 0,
    facts:
      'Both Blue robots are damaged at kickoff. One was damaged by a confirmed opponent rule violation. Thirty seconds have elapsed.',
    bench: [
      { robot: 'blue-1', waited: 30, ready: false },
      { robot: 'blue-2', waited: 30, ready: false },
    ],
    kickoff: true,
    opponentDamage: true,
    steps: one('wait'),
    explanation:
      'The opponent-violation exception prevents the automatic 30-second goal award.',
  },
  {
    id: 'early',
    title: 'Early kickoff movement',
    family: 'Kickoffs',
    clip: 'kickoff-early',
    end: 2,
    before: 'No start signal has been given.',
    facts: 'Blue 1 moves before any start signal.',
    kickoff: true,
    steps: one('early-start', 'blue-1'),
    explanation:
      'The early starter is removed and deemed damaged. The current kickoff does not immediately erase that removal.',
  },
  {
    id: 'setup',
    title: 'Invalid neutral kickoff',
    family: 'Kickoffs',
    clip: 'neutral-correction',
    end: 0,
    facts:
      'This is a neutral kickoff. Blue 1 is inside the 30 cm exclusion circle.',
    kickoff: true,
    steps: [one('correct-setup', 'blue-1')[0], one('start')[0]],
    explanation:
      'Correct the placement before giving the signal. At a neutral kickoff all robots must be outside the circle.',
  },
  {
    id: 'ready',
    title: 'Valid neutral kickoff',
    family: 'Kickoffs',
    clip: 'neutral-start',
    end: 0,
    facts:
      'Neutral kickoff: all robots are halted in their own halves and outside the circle. The ball is centered.',
    kickoff: true,
    steps: one('start'),
    explanation: 'The setup is valid; the referee may give the start signal.',
  },
  {
    id: 'human',
    title: 'Unauthorized team intervention',
    family: 'Interference & stoppages',
    clip: 'team-touch',
    end: 3,
    facts:
      'A team member is about to touch Blue 1 during play without permission.',
    steps: one('interference'),
    explanation:
      'Stop the unauthorized intervention. Team touching requires permission; disqualification is discretionary, not an automatic default.',
  },
  {
    id: 'unstick',
    title: 'Normal entanglement away from ball',
    family: 'Interference & stoppages',
    clip: 'referee-unstick',
    end: 3,
    facts:
      'Normal robot interaction caused this entanglement. The ball is not being disputed nearby.',
    steps: [
      [call('separate', undefined, true), call('play-on', undefined, true)],
    ],
    explanation:
      'The referee may separate the robots just enough to move freely. This is limited assistance, not a general repositioning right.',
  },
  {
    id: 'interruption',
    title: 'Ball failure during play',
    family: 'Interference & stoppages',
    clip: 'pause-resume',
    end: 2,
    facts: 'The ball has malfunctioned and a replacement is not yet available.',
    steps: [
      one('pause')[0],
      [call('resume', undefined, true), call('neutral', undefined, true)],
    ],
    explanation:
      'Stop all robots and leave them untouched. Once the replacement is available, the referee can resume the positions or use a neutral kickoff.',
  },
  {
    id: 'spectator',
    title: 'Suspected outside interference',
    family: 'Interference & stoppages',
    clip: 'pause-neutral',
    end: 0,
    facts:
      'A spectator’s transmitter may be affecting the robots. The interference needs checking with an official.',
    anchor: 'robots-interference',
    steps: [
      one('pause')[0],
      [call('resume', undefined, true), call('neutral', undefined, true)],
    ],
    explanation:
      'Pause for investigation. The suspicion is not proof against a team. After the official clears play, either allowed continuation may be chosen.',
  },
  {
    id: 'preflight',
    title: 'No robot capable of playing',
    family: 'Match checks',
    clip: 'neutral-start',
    end: 0,
    facts:
      'Pre-match capability check: none of the FOUR robots can follow or react to the ball.',
    anchor: 'pre-match-meeting',
    steps: one('void'),
    explanation:
      'If none of the robots is capable of playing, this fixture is not played and its result is 0–0. The trainer records that fixture separately from your practice score.',
  },
  {
    id: 'inspection',
    title: 'Confirmed robot compliance issue',
    family: 'Match checks',
    clip: 'repair-clock',
    end: 0,
    facts:
      'The official confirms that Blue 1 is missing its required writable white top marker.',
    anchor: 'top-markers',
    steps: one('inspect', 'blue-1'),
    explanation:
      'A robot without the required marker is not eligible to play. Remove it for inspection and correction; no invented fixed penalty applies.',
  },
];

export const REFEREE_FAMILIES = [
  ...new Set(REFEREE_CASES.map((item) => item.family)),
];
export type Variant = { swap: boolean; reflect: boolean };
export function transformId(id: string, variant: Variant): string {
  if (!variant.swap) return id;
  return id.replace(/blue|yellow/g, (team) =>
    team === 'blue' ? 'yellow' : 'blue',
  );
}
export function transformText(text: string, variant: Variant) {
  if (!variant.swap) return text;
  return text.replace(/Blue|Yellow/g, (team) =>
    team === 'Blue' ? 'Yellow' : 'Blue',
  );
}
export function transformPose(value: Pose, variant: Variant): Pose {
  let { x, z, yaw } = value;
  if (variant.swap) {
    x = -x;
    z = -z;
    yaw += Math.PI;
  }
  if (variant.reflect) {
    x = -x;
    yaw = -yaw;
  }
  return { x, z, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)) };
}
export function evidenceClip(item: RefereeCase): RuleClip {
  const source = RULE_CLIPS.find((clip) => clip.id === item.clip)!;
  // Cutting the timeline also prevents interpolation toward a later referee action.
  return {
    ...source,
    frames: source.frames.filter((frame) => frame.at <= item.end),
  };
}
export function caseScene(
  item: RefereeCase,
  time: number,
  variant: Variant,
): RuleScene {
  const scene = sampleClip(
    evidenceClip(item),
    Math.min(item.end, (item.start ?? 0) + time),
  );
  return {
    poses: Object.fromEntries(
      Object.entries(scene.poses).map(([id, value]) => [
        transformId(id, variant),
        transformPose(value, variant),
      ]),
    ),
    heights: Object.fromEntries(
      Object.entries(scene.heights).map(([id, value]) => [
        transformId(id, variant),
        value,
      ]),
    ),
    label: '',
    readout: '',
    focus: null,
  };
}
export function ruleUrl(item: RefereeCase) {
  const anchor =
    item.anchor ?? RULE_CLIPS.find((clip) => clip.id === item.clip)!.anchor;
  return `https://robocup-junior.github.io/soccer-rules/master/rules.html#${anchor}`;
}

export class IncidentBag {
  private randomState: number;
  private bag: RefereeCase[] = [];
  constructor(readonly seed: number) {
    this.randomState = seed >>> 0 || 1;
  }
  random() {
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 4294967296;
  }
  next() {
    if (!this.bag.length) {
      this.bag = [...REFEREE_CASES];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }
  variant(): Variant {
    return { swap: this.random() > 0.5, reflect: this.random() > 0.5 };
  }
}
