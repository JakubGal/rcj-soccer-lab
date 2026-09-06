import {
  RCJ_FIELD_DERIVED as FIELD,
  RCJ_SIMULATOR_GUIDES,
} from '../simulator/field-spec';
import { MATCH_ACTORS } from '../simulator/match';
import type { Pose } from '../simulator/types';

export const RULE_ACTORS = MATCH_ACTORS;
export const pose = (x: number, z: number, yaw = 0): Pose => ({ x, z, yaw });
export const NEUTRAL_SPOTS = [
  pose(0, 0),
  ...[-1, 1].flatMap((x) =>
    [-1, 1].map((z) => pose(x * FIELD.neutralSpotX, z * FIELD.neutralSpotZ)),
  ),
];
export function neutralPlacement(
  ball: Pose,
  robots: Pose[],
  farthest: boolean,
) {
  const available = NEUTRAL_SPOTS.filter((spot) =>
    robots.every(
      (robot) => Math.hypot(spot.x - robot.x, spot.z - robot.z) >= 0.21,
    ),
  );
  return (
    [...available].sort(
      (a, b) =>
        (Math.hypot(a.x - ball.x, a.z - ball.z) -
          Math.hypot(b.x - ball.x, b.z - ball.z)) *
        (farthest ? -1 : 1),
    )[0] ?? null
  );
}

type Keyframe = {
  at: number;
  label: string;
  poses?: Record<string, Pose | null>;
  heights?: Record<string, number>;
  readout?: string;
  focus?: string;
};
export type RuleClip = {
  id: string;
  title: string;
  anchor: string;
  frames: Keyframe[];
  question: string;
  options: string[];
  answer: number;
  feedback: string;
};
export type RuleScene = {
  poses: Record<string, Pose>;
  heights: Record<string, number>;
  label: string;
  readout: string;
  focus: string | null;
};
const B = 'blue-1';
const B2 = 'blue-2';
const Y = 'yellow-1';
const Y2 = 'yellow-2';
const P = Math.PI;
const base: Record<string, Pose | null> = {
  [B]: pose(-0.24, -0.42),
  [B2]: pose(0.3, -0.66),
  [Y]: pose(0.2, 0.42, P),
  [Y2]: pose(-0.3, 0.66, P),
  ball: pose(0, 0),
};
const kickoff: Record<string, Pose> = {
  [B]: pose(0, -0.18),
  [B2]: pose(0.42, -0.56),
  [Y]: pose(-0.28, 0.38, P),
  [Y2]: pose(0.28, 0.38, P),
  ball: pose(0, 0),
};
const neutral = {
  ...kickoff,
  [B]: pose(-0.28, -0.38),
  [B2]: pose(0.28, -0.38),
};
const far = pose(FIELD.neutralSpotX, FIELD.neutralSpotZ, P);

function make(
  id: string,
  title: string,
  anchor: string,
  frames: Keyframe[],
  question: string,
  options: string[],
  answer: number,
  feedback: string,
): RuleClip {
  return { id, title, anchor, frames, question, options, answer, feedback };
}

/** Authored teaching scenes. Time is illustrative unless a clock is labelled. */
export const RULE_CLIPS: RuleClip[] = [
  make(
    'match-halves',
    'Two halves & a side swap',
    'game-procedure-and-length-of-a-game',
    [
      {
        at: 0,
        label: 'First half',
        poses: kickoff,
        readout: '10:00 · first half',
      },
      {
        at: 3,
        label: 'Half-time interval',
        poses: {
          [B]: pose(-0.4, 0.4, P),
          [Y]: pose(0.4, -0.4),
          ball: pose(0.3, 0.2),
        },
        readout: '5:00 · interval',
      },
      {
        at: 6,
        label: 'Second half · opposite kickoff team',
        poses: {
          [B]: pose(-0.28, 0.38, P),
          [B2]: pose(0.28, 0.38, P),
          [Y]: pose(0, -0.18),
          [Y2]: pose(0.4, -0.5),
          ball: pose(0, 0),
        },
        readout: '10:00 · second half',
      },
    ],
    'Who begins the second half?',
    ['The other kickoff team', 'The first-half leader'],
    0,
    'Track the kickoff assignment across the side swap.',
  ),
  make(
    'late-team',
    'An empty starting position',
    'game-procedure-and-length-of-a-game',
    [
      {
        at: 0,
        label: 'Waiting at the field',
        poses: { [Y]: null, [Y2]: null },
        readout: 'Arrival example',
      },
      {
        at: 3,
        label: 'Late-arrival interval',
        readout: '+30 s · referee decision',
      },
      {
        at: 6,
        label: 'Team arrives',
        poses: { [Y]: kickoff[Y], [Y2]: kickoff[Y2] },
        readout: 'Discretionary penalty',
      },
    ],
    'Is the late-arrival penalty automatic?',
    ['Always', 'Referee discretion'],
    1,
    'The official paragraph preserves discretion.',
  ),
  make(
    'toss-ends',
    'Choose an end',
    'pre-match-meeting',
    [
      { at: 0, label: 'Blue wins the toss', readout: 'Toss winner: Blue' },
      {
        at: 2.5,
        label: 'Blue chooses attacking direction',
        poses: { [B]: pose(-0.28, 0.38, P), [B2]: pose(0.28, 0.38, P) },
        readout: 'Blue attacks −Z',
      },
      {
        at: 5,
        label: 'Yellow chooses the kickoff',
        poses: { [Y]: pose(0, -0.18), [Y2]: pose(0.4, -0.5), ball: pose(0, 0) },
      },
    ],
    'What choice remains for Yellow?',
    ['Kickoff', 'Both choices'],
    0,
    'Each team takes one of the two choices.',
  ),
  make(
    'toss-kickoff',
    'Choose the kickoff',
    'pre-match-meeting',
    [
      { at: 0, label: 'Blue wins the toss', readout: 'Toss winner: Blue' },
      { at: 2.5, label: 'Blue chooses kickoff', poses: kickoff },
      {
        at: 5,
        label: 'Yellow chooses its attacking end',
        readout: 'Yellow attacks −Z',
      },
    ],
    'Does Blue also choose the end?',
    ['Yes', 'No'],
    1,
    'The remaining choice belongs to Yellow.',
  ),
  make(
    'kickoff-valid',
    'Ready, wait, start',
    'kick-off',
    [
      {
        at: 0,
        label: 'Kickoff team places first',
        poses: { ...kickoff, [Y]: null, [Y2]: null },
        readout: 'Robots stopped',
      },
      {
        at: 2,
        label: 'Opponents take their positions',
        poses: { [Y]: kickoff[Y], [Y2]: kickoff[Y2] },
        readout: 'Outside the 30 cm circle',
      },
      { at: 4, label: 'Wait for the referee', readout: 'Still stopped' },
      {
        at: 5,
        label: 'Start signal · robots may move',
        readout: 'Referee signal',
      },
      {
        at: 6,
        label: 'Start signal',
        poses: {
          [B]: pose(0, -0.1),
          [Y]: pose(-0.17, 0.2, P),
          ball: pose(0, 0.07),
        },
        readout: 'All robots start',
      },
    ],
    'When may the robots move?',
    ['After placement', 'At the referee signal'],
    1,
    'Watch the stationary setup before the start cue.',
  ),
  make(
    'kickoff-early',
    'One robot starts early',
    'kick-off',
    [
      { at: 0, label: 'Waiting for the start', poses: kickoff },
      {
        at: 2,
        label: 'Blue moves before the signal',
        poses: { [B]: pose(0, -0.11) },
        focus: B,
      },
      {
        at: 3.5,
        label: 'Referee removes Blue 1',
        poses: { [B]: null },
        readout: 'Damaged robot',
      },
      { at: 6, label: 'Remaining robots await kickoff', focus: B2 },
    ],
    'Which robot is removed?',
    ['Blue 1', 'Both blue robots'],
    0,
    'Follow the robot that moved early.',
  ),
  make(
    'neutral-start',
    'A neutral restart',
    'neutral-kickoff',
    [
      {
        at: 0,
        label: 'All robots outside the circle',
        poses: neutral,
        readout: '30 cm exclusion · both teams',
      },
      { at: 3, label: 'Wait for the start', readout: 'No kickoff advantage' },
      { at: 4, label: 'Start signal · both teams move' },
      {
        at: 6,
        label: 'Both teams approach',
        poses: { [B]: pose(-0.13, -0.17), [Y]: pose(0.13, 0.17, P) },
      },
    ],
    'Who observes the exclusion circle?',
    ['Only the opponent', 'Every robot'],
    1,
    'This is the neutral-kickoff variation.',
  ),
  make(
    'neutral-correction',
    'Correct an invalid setup',
    'neutral-kickoff',
    [
      {
        at: 0,
        label: 'Blue is too close',
        poses: { ...neutral, [B]: pose(0, -0.2) },
        focus: B,
      },
      {
        at: 3,
        label: 'Referee requests a correction',
        poses: { [B]: neutral[B] },
        readout: 'Reposition before starting',
      },
      { at: 6, label: 'Ready outside the circle', readout: '30 cm' },
    ],
    'Should this setup start immediately?',
    ['Correct the placement first', 'Start anyway'],
    0,
    'The referee can request a placement correction.',
  ),
  make(
    'goal-contact',
    'A ball reaches the back wall',
    'scoring',
    [
      {
        at: 0,
        label: 'Shot toward Yellow’s goal',
        poses: {
          ball: pose(0, 0.6),
          [Y]: pose(0.6, 0.5, P),
          [Y2]: pose(-0.6, 0.5, P),
        },
      },
      {
        at: 3,
        label: 'Goal mouth crossed',
        poses: { ball: pose(0, 1.098) },
        readout: 'Score unchanged',
      },
      {
        at: 4,
        label: 'Back-wall contact',
        poses: { ball: pose(0, FIELD.goalBackContactBallCenterZ) },
        readout: 'BLUE +1',
      },
      {
        at: 6,
        label: 'Yellow kickoff',
        poses: { ...neutral, [Y]: pose(0, 0.18, P) },
      },
    ],
    'Which instant scores?',
    ['Mouth crossing', 'Back-wall contact'],
    1,
    'Scrub between the two marked instants.',
  ),
  make(
    'goal-near-miss',
    'A shot clips the post',
    'scoring',
    [
      {
        at: 0,
        label: 'Slow ball approaches the post',
        poses: {
          ball: pose(0.305, 0.83),
          [Y]: pose(0.65, 0.4, P),
          [Y2]: pose(-0.6, 0.5, P),
        },
      },
      {
        at: 2.5,
        label: 'Contact with the front of the post',
        poses: { ball: pose(0.305, FIELD.goalMouthZ - 0.021) },
        readout: 'No back-wall contact',
      },
      {
        at: 5,
        label: 'Post deflection returns to play',
        poses: { ball: pose(0.305, 0.78) },
        readout: 'No goal',
      },
    ],
    'Has a goal been demonstrated?',
    ['Yes', 'No'],
    1,
    'This path never reaches the back wall.',
  ),
  make(
    'own-goal',
    'A defender deflects the ball',
    'scoring',
    [
      {
        at: 0,
        label: 'Blue defends its goal',
        poses: { [B]: pose(0, -0.87, P), ball: pose(0, -0.99) },
      },
      {
        at: 3,
        label: 'Ball touches Blue’s goal back wall',
        poses: { ball: pose(0, -FIELD.goalBackContactBallCenterZ) },
        readout: 'YELLOW +1',
      },
      { at: 6, label: 'Blue takes the kickoff', poses: kickoff },
    ],
    'Which team receives the goal?',
    ['Blue', 'Yellow'],
    1,
    'Track the goal end, rather than the last robot touching the ball.',
  ),
  make(
    'dribble-access',
    'A contestable moving ball',
    'ball-movement',
    [
      {
        at: 0,
        label: 'Blue rolls the ball forward',
        poses: { [B]: pose(-0.1, -0.3), ball: pose(-0.1, -0.177) },
      },
      {
        at: 2,
        label: 'Backspin contact',
        poses: { [B]: pose(-0.1, -0.05), ball: pose(-0.1, 0.073, 14) },
        readout: 'Ball rotates',
      },
      {
        at: 4,
        label: 'Opponent challenges from the side',
        poses: { [Y]: pose(0.015287, 0.11587, -1.926805) },
      },
      {
        at: 6,
        label: 'Ball leaves Blue',
        poses: { ball: pose(-0.28, 0.15, 25) },
        readout: 'Opponent access remains',
      },
    ],
    'What makes this example useful evidence?',
    ['The ball remains accessible', 'The ball never rotates'],
    0,
    'Observe both ball rotation and the challenge.',
  ),
  make(
    'trapped-ball',
    'A locked ball under challenge',
    'ball-movement',
    [
      {
        at: 0,
        label: 'Ball fixed at the front',
        poses: { [B]: pose(-0.1, -0.3), ball: pose(-0.1, -0.2) },
      },
      {
        at: 2,
        label: 'Robot moves; ball does not roll',
        poses: { [B]: pose(-0.1, -0.05), ball: pose(-0.1, 0.05) },
        readout: 'Fixed orientation',
      },
      {
        at: 4,
        label: 'Challenge cannot free the ball',
        poses: { [Y]: pose(0.1, 0.04, -P / 2) },
        readout: 'Teaching example: trapped ball',
      },
      { at: 6, label: 'Inspect the mechanism', focus: B },
    ],
    'Which observation needs inspection?',
    ['Fixed, inaccessible ball', 'A free rolling ball'],
    0,
    'The animation represents a trapping mechanism; the mesh is illustrative.',
  ),
  make(
    'ball-over-wall',
    'A high kick leaves the enclosure',
    'ball-movement',
    [
      {
        at: 0,
        label: 'Blue prepares a high kick',
        poses: { [B]: pose(0.45, 0, P / 2), ball: pose(0.574, 0) },
      },
      {
        at: 2,
        label: 'Ball rises toward the wall',
        poses: { ball: pose(0.8, 0) },
        heights: { ball: 0.29 },
        readout: 'Above the 22 cm wall',
      },
      {
        at: 3.5,
        label: 'Ball exits the enclosure',
        poses: { ball: pose(1.04, 0) },
        heights: { ball: 0.2 },
      },
      {
        at: 5.5,
        label: 'Blue 1 is removed',
        poses: { [B]: null },
        readout: 'Damaged robot',
      },
    ],
    'Which robot is involved in the removal?',
    ['The kicker', 'The nearest opponent'],
    0,
    'Track who sent the ball outside the enclosure.',
  ),
  make(
    'neutral-response',
    'Detect, touch, advance',
    'ball-movement',
    [
      {
        at: 0,
        label: 'Ball placed on a neutral spot',
        poses: {
          ball: pose(-FIELD.neutralSpotX, -FIELD.neutralSpotZ),
          [B]: pose(-0.6, -0.85),
        },
      },
      {
        at: 2,
        label: 'Blue approaches the ball',
        poses: { [B]: pose(-FIELD.neutralSpotX, -FIELD.neutralSpotZ - 0.124) },
      },
      {
        at: 5,
        label: 'Ball advances to the opposing half',
        poses: { [B]: pose(-0.25, 0.03), ball: pose(-0.25, 0.154, 18) },
        readout: 'Unobstructed demonstration',
      },
    ],
    'What does the demonstration show?',
    ['Detection and useful movement', 'Remote control'],
    0,
    'Compare the initial neutral placement with the final ball position.',
  ),
  make(
    'pushing-call',
    'Contact, ball, penalty area',
    'inside-penalty-area',
    [
      {
        at: 0,
        label: 'Opponents converge near the penalty area',
        poses: {
          [B]: pose(-0.08, -0.89),
          [Y]: pose(0.25, -0.62, P),
          ball: pose(-0.051475, -0.770353),
          [B2]: pose(0.6, 0.2),
        },
      },
      {
        at: 2.5,
        label: 'Opponent contact and ball contact',
        poses: { [Y]: pose(0.071, -0.759, P) },
        readout: 'Referee judgment',
      },
      {
        at: 4,
        label: 'Example decision: pushing called',
        focus: B,
        readout: 'Relocate BALL',
      },
      {
        at: 6,
        label: 'Referee moves ball to the far spot',
        poses: { ball: pose(FIELD.neutralSpotX, FIELD.neutralSpotZ) },
        readout: 'Furthest unoccupied neutral spot',
      },
    ],
    'What moves after this pushing call?',
    ['The ball', 'The farther defender'],
    0,
    'The highlighted object in this restart is the ball.',
  ),
  make(
    'contact-midfield',
    'Similar contact at midfield',
    'inside-penalty-area',
    [
      {
        at: 0,
        label: 'The same approach away from the penalty area',
        poses: {
          [B]: pose(-0.08, -0.09),
          [Y]: pose(0.25, 0.18, P),
          ball: pose(-0.051475, 0.029647),
          [B2]: pose(-0.5, -0.6),
        },
      },
      {
        at: 3,
        label: 'Contact outside the penalty areas',
        poses: { [Y]: pose(0.071, 0.041, P) },
        readout: 'Penalty-area condition absent',
      },
      {
        at: 6,
        label: 'The ball escapes',
        poses: { ball: pose(0.35, -0.18) },
        readout: 'Assess other rules separately',
      },
    ],
    'Does contact alone establish §2.6 pushing?',
    ['Yes', 'No'],
    1,
    'Compare the field location with the preceding case.',
  ),
  make(
    'two-defenders',
    'Which defender must move?',
    'inside-penalty-area',
    [
      {
        at: 0,
        label: 'One partial overlap',
        poses: {
          [B]: pose(-0.15, -0.87),
          [B2]: pose(0.18, -0.56),
          [Y]: pose(0.5, -0.3, P),
          ball: pose(-0.15, -0.745),
        },
      },
      {
        at: 2.5,
        label: 'Two partial overlaps',
        poses: { [B2]: pose(0.18, -0.87) },
        readout: 'Blue 2 is farther from the ball',
      },
      {
        at: 4,
        label: 'Referee lifts Blue 2',
        heights: { [B2]: 0.25 },
        focus: B2,
      },
      {
        at: 6,
        label: 'Far neutral placement',
        poses: { [B2]: far },
        heights: { [B2]: 0 },
        readout: 'Blue 1 remains',
      },
    ],
    'Which defender is relocated?',
    ['Blue 1', 'Blue 2'],
    1,
    'Compare both distances from the stationary ball.',
  ),
  make(
    'combined-order',
    'Pushing and two defenders',
    'inside-penalty-area',
    [
      {
        at: 0,
        label: 'Defenders near the area',
        poses: {
          [B]: pose(-0.22, -0.87),
          [B2]: pose(0.18, -0.69, P),
          [Y]: pose(0.18, -0.49, P),
          ball: pose(0.06, -0.7),
        },
      },
      {
        at: 2.5,
        label: 'Second defender moves inward during contact',
        poses: {
          [B2]: pose(0.18, -0.87, P),
          [Y]: pose(0.18, -0.67, P),
          ball: pose(0.06, -0.87),
        },
        readout: 'Two overlapping events',
      },
      {
        at: 4,
        label: 'Resolve pushing first',
        poses: { ball: pose(FIELD.neutralSpotX, FIELD.neutralSpotZ) },
        readout: '1 · BALL placement',
      },
      {
        at: 6,
        label: 'Then resolve multiple defense',
        poses: { [B]: pose(-FIELD.neutralSpotX, -FIELD.neutralSpotZ, P) },
        readout: '2 · ROBOT placement, distances reassessed',
      },
    ],
    'Which decision comes first?',
    ['Multiple defense', 'Pushing'],
    1,
    'The 2026 sequence is explicit; inspect the changed ball position before choosing the defender.',
  ),
  make(
    'pushing-goal',
    'A goal during a called pushing situation',
    'inside-penalty-area',
    [
      {
        at: 0,
        label: 'Eligible pushing contact',
        poses: {
          [B]: pose(-0.08, -0.89),
          [Y]: pose(0.071, -0.759, P),
          ball: pose(-0.051475, -0.770353),
        },
        readout: 'Referee calls pushing',
      },
      {
        at: 3,
        label: 'Ball subsequently reaches the goal',
        poses: { ball: pose(0.01, -FIELD.goalBackContactBallCenterZ) },
        readout: 'Goal not granted',
      },
      {
        at: 6,
        label: 'Resolve the pushing restart',
        poses: { ball: pose(FIELD.neutralSpotX, FIELD.neutralSpotZ) },
      },
    ],
    'Does this called pushing goal stand?',
    ['Yes', 'No'],
    1,
    'Follow the decision that precedes the goal.',
  ),
  make(
    'deadlock',
    'A stationary contest',
    'lack-of-progress',
    [
      {
        at: 0,
        label: 'Ball between stationary opponents',
        poses: {
          [B]: pose(0, -0.124),
          [Y]: pose(0, 0.124, P),
          ball: pose(0, 0),
        },
      },
      {
        at: 2,
        label: 'Referee starts a visible count',
        readout: '1… 2… 3 · illustrative count',
      },
      {
        at: 4,
        label: 'No change in the situation',
        readout: 'Lack of progress called',
      },
      {
        at: 6,
        label: 'Nearest available neutral spot',
        poses: { ball: pose(-FIELD.neutralSpotX, -FIELD.neutralSpotZ) },
      },
    ],
    'Is this a universal three-second timeout?',
    ['Yes', 'No'],
    1,
    'The clock here illustrates the count; the decision depends on the situation.',
  ),
  make(
    'deadlock-repeat',
    'The first relocation does not help',
    'lack-of-progress',
    [
      {
        at: 0,
        label: 'Ball beyond the robots’ response',
        poses: { ball: pose(0.84, 0.82) },
      },
      {
        at: 2.5,
        label: 'First neutral placement',
        poses: { ball: pose(FIELD.neutralSpotX, FIELD.neutralSpotZ) },
      },
      { at: 4, label: 'Still no response', readout: 'Referee reassesses' },
      { at: 6, label: 'A different neutral spot', poses: { ball: pose(0, 0) } },
    ],
    'Can another neutral placement follow?',
    ['Yes', 'Never'],
    0,
    'The first relocation has not resolved this example.',
  ),
  make(
    'wall-touch',
    'A robot touches the wall',
    'out-of-bounds',
    [
      {
        at: 0,
        label: 'Approaching the physical wall',
        poses: { [B]: pose(0.6, -0.2, P / 2), ball: pose(-0.5, -0.7) },
      },
      {
        at: 2,
        label: 'Wall contact',
        poses: { [B]: pose(0.81, -0.2, P / 2) },
        readout: 'Out of bounds',
        focus: B,
      },
      {
        at: 3,
        label: 'Robot removed · penalty starts',
        poses: { [B]: null },
        readout: '60 s penalty · match continues',
      },
      {
        at: 6,
        label: 'Eligible return at far neutral spot',
        poses: { [B]: far },
        readout: 'Facing own goal · time compressed',
      },
    ],
    'Where does the boundary event occur?',
    ['At the physical wall', 'At any white sideline'],
    0,
    'The animation isolates wall contact.',
  ),
  make(
    'full-area',
    'Partial versus full entry',
    'out-of-bounds',
    [
      {
        at: 0,
        label: 'Partly overlapping the penalty area',
        poses: {
          [B]: pose(0, -0.87),
          [B2]: pose(0.6, 0.2),
          ball: pose(-0.5, -0.2),
        },
        focus: B,
      },
      {
        at: 3,
        label: 'Entire footprint enters the area',
        poses: { [B]: pose(0, -0.965) },
        readout: 'Full entry',
      },
      {
        at: 5,
        label: 'Robot removed',
        poses: { [B]: null },
        readout: 'Out of bounds',
      },
    ],
    'Which footprint change matters here?',
    ['Any partial overlap', 'The entire robot entering'],
    1,
    'Use the overhead footprint against the penalty-area line.',
  ),
  make(
    'pushed-out',
    'An opponent pushes a robot out',
    'out-of-bounds',
    [
      {
        at: 0,
        label: 'Opponents beside the wall',
        poses: {
          [B]: pose(0.74, 0, -P / 2),
          [Y]: pose(0.54, 0, P / 2),
          ball: pose(-0.5, 0.4),
        },
      },
      {
        at: 2.5,
        label: 'Opponent displacement creates wall contact',
        poses: { [B]: pose(0.81, 0, -P / 2), [Y]: pose(0.61, 0, P / 2) },
        readout: 'Pushed out · referee judgment',
      },
      {
        at: 5,
        label: 'Example: penalty waived, small correction',
        poses: { [B]: pose(0.74, 0.07, -P / 2), [Y]: pose(0.48, 0, P / 2) },
      },
    ],
    'What does the pushed-out call do in this example?',
    ['Keeps the robot in play after a small correction', 'Starts a penalty'],
    0,
    'The published rule gives the referee discretion to waive the penalty; this example shows that waiver and the committee training policy.',
  ),
  make(
    'repair-clock',
    'Repair and return',
    'damaged-robots',
    [
      { at: 0, label: 'Blue 1 stops responding', focus: B },
      {
        at: 2,
        label: 'Permission to remove · motors off',
        poses: { [B]: null },
        readout: 'Penalty clock starts',
      },
      {
        at: 3.5,
        label: 'Repair completed while waiting',
        readout: 'Still waiting for eligibility',
      },
      {
        at: 6,
        label: 'Referee permits the return',
        poses: { [B]: pose(FIELD.neutralSpotX, FIELD.neutralSpotZ, P) },
        readout: '60 s elapsed · time compressed',
      },
    ],
    'Can a team return a robot without permission?',
    ['Yes', 'No'],
    1,
    'Repair and permission are separate steps.',
  ),
  make(
    'repair-kickoff',
    'A kickoff before the minute expires',
    'damaged-robots',
    [
      {
        at: 0,
        label: 'Repaired robot waiting off the field',
        poses: { [B]: null },
        readout: '25 s into waiting period',
      },
      {
        at: 3,
        label: 'A new kickoff is due',
        poses: { ...kickoff, [B]: null },
      },
      {
        at: 5,
        label: 'Ready robot returns with permission',
        poses: { [B]: kickoff[B] },
        readout: 'Kickoff exception',
      },
    ],
    'Can a ready robot return at this kickoff?',
    ['Yes, with permission', 'Only after the full minute'],
    0,
    'The new kickoff changes the waiting requirement.',
  ),
  make(
    'both-damaged',
    'Neither robot is ready at kickoff',
    'damaged-robots',
    [
      {
        at: 0,
        label: 'Both Blue robots unavailable',
        poses: { ...neutral, [B]: null, [B2]: null },
        readout: 'Kickoff paused',
      },
      { at: 3, label: 'First elapsed interval', readout: '30 s · YELLOW +1' },
      {
        at: 6,
        label: 'One Blue robot becomes ready',
        poses: { [B]: kickoff[B] },
        readout: 'Opponent-violation exception must be checked',
      },
    ],
    'Does this example require checking how the damage arose?',
    ['Yes', 'No'],
    0,
    'An opponent-rule-violation exception can change the result.',
  ),
  make(
    'team-touch',
    'Team intervention during play',
    'human-interference',
    [
      {
        at: 0,
        label: 'A robot appears stuck',
        poses: { [B]: pose(-0.55, -0.3), ball: pose(0.4, 0.2) },
        focus: B,
      },
      {
        at: 3,
        label: 'Pause the proposed intervention',
        readout: 'Ask the referee · no permission yet',
      },
      {
        at: 6,
        label: 'Wait for a decision',
        readout: 'Team touching is not a routine restart',
      },
    ],
    'Who grants permission to intervene?',
    ['The team captain', 'The referee'],
    1,
    'The highlighted robot is still in live play.',
  ),
  make(
    'referee-unstick',
    'Limited referee assistance',
    'human-interference',
    [
      {
        at: 0,
        label: 'Normal entanglement away from the ball',
        poses: {
          [B]: pose(-0.4, -0.3),
          [Y]: pose(-0.2, -0.3, P),
          ball: pose(0.5, 0.6),
        },
      },
      {
        at: 3,
        label: 'Referee checks the circumstances',
        readout: 'Ball not disputed nearby',
      },
      {
        at: 6,
        label: 'Minimal separation restores movement',
        poses: { [B]: pose(-0.45, -0.3), [Y]: pose(-0.15, -0.3, P) },
      },
    ],
    'Is this permission for unlimited repositioning?',
    ['No', 'Yes'],
    0,
    'Compare the small correction with the original positions.',
  ),
  make(
    'pause-resume',
    'Freeze and resume the same situation',
    'interruption-of-game-ref-interruption',
    [
      { at: 0, label: 'Game in motion', poses: { ball: pose(0.15, 0.1) } },
      {
        at: 2,
        label: 'Referee stops play',
        poses: { [B]: pose(-0.1, -0.1), ball: pose(0.1, 0.08) },
        readout: 'Robots stopped · leave untouched',
      },
      {
        at: 4,
        label: 'Discussion / ball replacement',
        readout: 'Field remains frozen',
      },
      {
        at: 5,
        label: 'Referee signals resume',
        readout: 'Robots may move again',
      },
      {
        at: 6,
        label: 'Resume from the same positions',
        poses: { [B]: pose(0.01, -0.04), ball: pose(0.12, 0.17) },
      },
    ],
    'May teams adjust robots during the stoppage?',
    ['Yes', 'No'],
    1,
    'The unchanged middle frames show the stopped situation.',
  ),
  make(
    'pause-neutral',
    'Restart neutrally after a stoppage',
    'interruption-of-game-ref-interruption',
    [
      {
        at: 0,
        label: 'Referee stops a disputed situation',
        poses: { ball: pose(-0.3, -0.2) },
      },
      {
        at: 3,
        label: 'Referee chooses a neutral restart',
        poses: neutral,
        readout: 'Both teams outside the circle',
      },
      { at: 6, label: 'Await a new start signal', readout: 'Neutral kickoff' },
    ],
    'Who chooses this restart?',
    ['The referee', 'The leading team'],
    0,
    'This is an alternative to resuming the stopped positions.',
  ),
];

export function clipsFor(anchor: string) {
  if (anchor === 'gameplay') return RULE_CLIPS;
  return RULE_CLIPS.filter((clip) => clip.anchor === anchor);
}

export function sampleClip(clip: RuleClip, time: number): RuleScene {
  let previousPoses = { ...base };
  let previousHeights: Record<string, number> = {};
  let previousFrame = clip.frames[0];
  const first = clip.frames[0];
  previousPoses = { ...previousPoses, ...first.poses };
  previousHeights = { ...first.heights };
  for (let index = 1; index < clip.frames.length; index += 1) {
    const next = clip.frames[index];
    const nextPoses = { ...previousPoses, ...next.poses };
    const nextHeights = { ...previousHeights, ...next.heights };
    if (time < next.at) {
      const raw = Math.max(
        0,
        Math.min(1, (time - previousFrame.at) / (next.at - previousFrame.at)),
      );
      const t = raw * raw * (3 - 2 * raw);
      const poses: Record<string, Pose> = {};
      const heights: Record<string, number> = {};
      for (const actor of RULE_ACTORS) {
        const a = previousPoses[actor.id];
        const b = nextPoses[actor.id];
        if (!a) continue;
        poses[actor.id] = b
          ? {
              x: a.x + (b.x - a.x) * t,
              z: a.z + (b.z - a.z) * t,
              yaw: a.yaw + (b.yaw - a.yaw) * t,
            }
          : a;
        const baseline = actor.kind === 'ball' ? 0.022 : 0;
        const ah = previousHeights[actor.id] ?? baseline;
        const bh = nextHeights[actor.id] ?? baseline;
        heights[actor.id] = ah + (bh - ah) * t;
      }
      return {
        poses,
        heights,
        label: previousFrame.label,
        readout: previousFrame.readout ?? '',
        focus: previousFrame.focus ?? null,
      };
    }
    previousPoses = nextPoses;
    previousHeights = nextHeights;
    previousFrame = next;
  }
  return {
    poses: Object.fromEntries(
      Object.entries(previousPoses).filter(
        (entry): entry is [string, Pose] => entry[1] !== null,
      ),
    ),
    heights: previousHeights,
    label: previousFrame.label,
    readout: previousFrame.readout ?? '',
    focus: previousFrame.focus ?? null,
  };
}

export const ROBOT_FOOTPRINT_RADIUS = RCJ_SIMULATOR_GUIDES.robotCollisionRadius;
