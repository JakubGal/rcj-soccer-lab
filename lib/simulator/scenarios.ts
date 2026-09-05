import {
  RCJ_FIELD_DERIVED,
  RCJ_FIELD_SPEC_2026,
  RCJ_SIMULATOR_GUIDES,
} from './field-spec';
import type {
  ActorDefinition,
  BallPossession,
  FrameMetric,
  Pose,
  RefereeChoice,
  ScenarioDefinition,
  ScenarioEvidence,
  ScenarioFrame,
} from './types';

const RULES_URL =
  'https://robocup-junior.github.io/soccer-rules/master/rules.html';
const RULE_2_4_URL = `${RULES_URL}#scoring`;
const RULE_2_5_URL = `${RULES_URL}#ball-movement`;
const RULE_2_6_URL = `${RULES_URL}#inside-penalty-area`;

const PI = Math.PI;
const ROBOT_CONTACT_CLEARANCE = 0.002;
const ROBOT_CONTACT_CENTER_DISTANCE =
  RCJ_SIMULATOR_GUIDES.robotCollisionRadius * 2 + ROBOT_CONTACT_CLEARANCE;
const OPPONENT_BALL_CHALLENGE_DISTANCE = 0.106;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mix(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

function progress(time: number, start: number, end: number) {
  return clamp((time - start) / (end - start), 0, 1);
}

function smoothProgress(time: number, start: number, end: number) {
  const value = progress(time, start, end);
  return value * value * (3 - 2 * value);
}

function pose(x: number, z: number, yaw = 0): Pose {
  return { x, z, yaw };
}

function mixPose(from: Pose, to: Pose, amount: number): Pose {
  return {
    x: mix(from.x, to.x, amount),
    z: mix(from.z, to.z, amount),
    yaw: mix(from.yaw, to.yaw, amount),
  };
}

function distanceBetween(first: Pose, second: Pose) {
  return Math.hypot(second.x - first.x, second.z - first.z);
}

/**
 * Keeps two circular robot footprints tangent without assigning blame to
 * either robot. This is used by the deliberately ambiguous pushing lesson.
 */
function separateRobotPairEqually(
  first: Pose,
  second: Pose,
  minimumDistance = ROBOT_CONTACT_CENTER_DISTANCE,
): [Pose, Pose] {
  const deltaX = second.x - first.x;
  const deltaZ = second.z - first.z;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance >= minimumDistance) return [first, second];

  // A stable axis makes coincident authored poses deterministic when seeking.
  const normalX = distance > 1e-9 ? deltaX / distance : 1;
  const normalZ = distance > 1e-9 ? deltaZ / distance : 0;
  const correction = (minimumDistance - distance) / 2;
  return [
    {
      ...first,
      x: first.x - normalX * correction,
      z: first.z - normalZ * correction,
    },
    {
      ...second,
      x: second.x + normalX * correction,
      z: second.z + normalZ * correction,
    },
  ];
}

/**
 * Last-resort invariant for present and future authored scenes. It is pure and
 * stateless, so scrubbing directly to a time always produces the same frame.
 */
function separateRobotActors(actors: Record<string, Pose>) {
  const robotIds = Object.keys(actors)
    .filter((id) => id !== 'ball')
    .sort();
  if (robotIds.length < 2) return actors;

  const minimumDistance = RCJ_SIMULATOR_GUIDES.robotCollisionRadius * 2;
  let resolvedActors = actors;
  let changed = false;

  // Multiple fixed passes resolve the uncommon case of three robots packed
  // together while preserving deterministic actor ordering.
  for (let pass = 0; pass < 24; pass += 1) {
    let changedThisPass = false;
    for (let firstIndex = 0; firstIndex < robotIds.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < robotIds.length;
        secondIndex += 1
      ) {
        const firstId = robotIds[firstIndex];
        const secondId = robotIds[secondIndex];
        const first = resolvedActors[firstId];
        const second = resolvedActors[secondId];
        if (distanceBetween(first, second) >= minimumDistance) continue;

        const [resolvedFirst, resolvedSecond] = separateRobotPairEqually(
          first,
          second,
          minimumDistance,
        );
        if (!changed) resolvedActors = { ...actors };
        resolvedActors[firstId] = resolvedFirst;
        resolvedActors[secondId] = resolvedSecond;
        changed = true;
        changedThisPass = true;
      }
    }
    if (!changedThisPass) break;
  }

  return resolvedActors;
}

/**
 * Places an opponent beside an owner's front-held ball while keeping the two
 * robot envelopes clear. The opponent faces the ball, preserving the visual
 * meaning of a genuine challenge.
 */
function opponentChallengePose(owner: Pose, ballForwardDistance: number) {
  const forwardOffset =
    (ROBOT_CONTACT_CENTER_DISTANCE ** 2 +
      ballForwardDistance ** 2 -
      OPPONENT_BALL_CHALLENGE_DISTANCE ** 2) /
    (2 * ballForwardDistance);
  const lateralOffset = Math.sqrt(
    Math.max(0, ROBOT_CONTACT_CENTER_DISTANCE ** 2 - forwardOffset ** 2),
  );
  const forwardX = Math.sin(owner.yaw);
  const forwardZ = Math.cos(owner.yaw);
  const rightX = Math.cos(owner.yaw);
  const rightZ = -Math.sin(owner.yaw);
  const ballX = owner.x + forwardX * ballForwardDistance;
  const ballZ = owner.z + forwardZ * ballForwardDistance;
  const targetX = owner.x + rightX * lateralOffset + forwardX * forwardOffset;
  const targetZ = owner.z + rightZ * lateralOffset + forwardZ * forwardOffset;
  return pose(targetX, targetZ, Math.atan2(ballX - targetX, ballZ - targetZ));
}

function robot(
  id: string,
  label: string,
  team: 'blue' | 'yellow',
  initial: Pose,
  number: number,
  poweredDribbler = false,
): ActorDefinition {
  return {
    id,
    label,
    kind: 'robot',
    team,
    initial,
    number,
    poweredDribbler,
  };
}

function ball(initial: Pose): ActorDefinition {
  return {
    id: 'ball',
    label: 'Ball',
    kind: 'ball',
    team: 'neutral',
    initial,
  };
}

function metric(
  label: string,
  value: string,
  status: FrameMetric['status'] = 'neutral',
): FrameMetric {
  return { label, value, status };
}

function evidenceLabel(item: ScenarioEvidence) {
  const prefix =
    item.kind === 'objective'
      ? 'FACT'
      : item.kind === 'judgment'
        ? 'JUDGMENT'
        : 'PROCEDURE';
  return `${prefix} — ${item.text}`;
}

function frame(
  actors: Record<string, Pose>,
  metrics: Record<string, FrameMetric>,
  phaseLabel: string,
  evidenceDetails: ScenarioEvidence[],
  ballPossession: BallPossession | null = null,
): ScenarioFrame {
  let resolvedActors = separateRobotActors(actors);
  if (ballPossession) {
    const owner = resolvedActors[ballPossession.ownerId];
    const currentBall = resolvedActors.ball;
    if (!owner || !currentBall) {
      throw new Error(
        `Ball possession requires both ball and owner "${ballPossession.ownerId}" poses.`,
      );
    }

    const forwardX = Math.sin(owner.yaw);
    const forwardZ = Math.cos(owner.yaw);
    const rightX = Math.cos(owner.yaw);
    const rightZ = -Math.sin(owner.yaw);
    const lateralOffset = ballPossession.lateralOffsetM ?? 0;
    resolvedActors = {
      ...resolvedActors,
      ball: {
        ...currentBall,
        x:
          owner.x +
          forwardX * ballPossession.forwardOffsetM +
          rightX * lateralOffset,
        z:
          owner.z +
          forwardZ * ballPossession.forwardOffsetM +
          rightZ * lateralOffset,
      },
    };
  }

  return {
    actors: resolvedActors,
    ballPossession,
    metrics,
    phaseLabel,
    evidence: evidenceDetails.map(evidenceLabel),
    evidenceDetails,
  };
}

const legalDribblerChoices: RefereeChoice[] = [
  {
    id: 'play-on',
    label: 'Play on — the ball remains contestable',
    grade: 'correct',
    score: 1,
    feedback:
      'Correct. Backspin and close control are not by themselves holding. The challenge visibly dislodges the ball.',
  },
  {
    id: 'call-holding',
    label: 'Stop play for ball holding',
    grade: 'incorrect',
    score: 0,
    feedback:
      'The visible evidence does not support holding: the ball moves relative to the robot and an opponent can take it away.',
  },
  {
    id: 'warn-team',
    label: 'Issue a warning but allow play to continue',
    grade: 'partial',
    score: 0.35,
    feedback:
      'Allowing play to continue reaches the right game outcome, but no warning is supported by the shown facts.',
  },
  {
    id: 'disable-roller',
    label: 'Require the powered roller to be disabled',
    grade: 'incorrect',
    score: 0,
    feedback:
      'A powered dribbler is not automatically illegal. Judge the resulting control against the ball-holding requirements.',
  },
];

const holdingChoices: RefereeChoice[] = [
  {
    id: 'call-holding',
    label: 'Stop play for ball holding',
    grade: 'correct',
    score: 1,
    feedback:
      'Correct. The ball is trapped with almost no independent motion and remains unavailable during a genuine challenge.',
  },
  {
    id: 'brief-observation',
    label: 'Observe the challenge briefly, then call holding',
    grade: 'acceptable',
    score: 0.85,
    feedback:
      'Acceptable. A short observation can establish that the ball is truly unavailable, provided the call is not needlessly delayed.',
  },
  {
    id: 'play-on',
    label: 'Play on because the robot has no powered roller',
    grade: 'incorrect',
    score: 0,
    feedback:
      'The mechanism is not decisive. The observable result is that the robot prevents access to the ball.',
  },
  {
    id: 'invent-restart',
    label: 'Stop and choose any convenient restart',
    grade: 'partial',
    score: 0.25,
    feedback:
      'Recognising the offence is useful, but the restart must follow the procedure in the current official rules and event guidance.',
  },
];

const multipleDefenseChoices: RefereeChoice[] = [
  {
    id: 'move-farther',
    label: 'Move Blue 2, the robot farther from the ball',
    grade: 'correct',
    score: 1,
    feedback:
      'Correct. Blue 1 is closer to the ball, so Blue 2 is moved to the furthest unoccupied neutral spot.',
  },
  {
    id: 'move-nearer',
    label: 'Move Blue 1, the robot nearer to the ball',
    grade: 'incorrect',
    score: 0,
    feedback:
      'That moves the wrong defender. Rule 2.6 selects the robot farther from the ball.',
  },
  {
    id: 'wait-for-ball',
    label: 'Wait until the ball leaves the penalty area',
    grade: 'incorrect',
    score: 0.1,
    feedback:
      'The shown multiple-defense fact already exists; ball position does not erase the two-defender condition.',
  },
  {
    id: 'move-both',
    label: 'Remove both defenders from the field',
    grade: 'incorrect',
    score: 0,
    feedback:
      'This is disproportionate and does not follow the depicted multiple-defense remedy.',
  },
];

const pushingChoices: RefereeChoice[] = [
  {
    id: 'call-pushing',
    label: 'Call pushing because the contact materially blocks play',
    grade: 'correct',
    score: 1,
    feedback:
      'Supported. From this angle the sustained drive can reasonably be judged to have created the disadvantage.',
  },
  {
    id: 'play-on',
    label: 'Play on because both robots contribute to the contact',
    grade: 'acceptable',
    score: 1,
    feedback:
      'Also defensible. Pushing requires referee judgment; the balanced contact and continuing access to the ball support no call.',
  },
  {
    id: 'automatic-contact-call',
    label: 'Call pushing whenever opposing robots touch',
    grade: 'incorrect',
    score: 0,
    feedback:
      'Contact is an objective observation, but it is not an automatic pushing decision. Consider cause and effect on play.',
  },
  {
    id: 'guess-from-color',
    label: 'Penalise Blue because it entered the area first',
    grade: 'incorrect',
    score: 0,
    feedback:
      'Arrival order alone does not establish responsibility for the sustained contact shown here.',
  },
];

const combinedChoices: RefereeChoice[] = [
  {
    id: 'pushing-first',
    label: 'Resolve the pushing judgment first, then reassess defense',
    grade: 'correct',
    score: 1,
    feedback:
      'Correct for this exercise. The contact may have caused the penalty-area arrangement, so resolve that judgment before applying the objective defense count.',
  },
  {
    id: 'defense-first',
    label: 'Immediately remove the farther Blue defender',
    grade: 'partial',
    score: 0.45,
    feedback:
      'You noticed the two defenders, but acting first can ignore that the judged pushing event created the situation.',
  },
  {
    id: 'call-both',
    label: 'Apply both decisions at the same instant',
    grade: 'partial',
    score: 0.3,
    feedback:
      'Both conditions deserve attention, but the sequence matters. First decide whether pushing caused the later geometry, then reassess.',
  },
  {
    id: 'ignore-both',
    label: 'Play on and ignore both observations',
    grade: 'incorrect',
    score: 0,
    feedback:
      'Even if pushing is judged incidental, the visible two-defender state still needs to be evaluated under multiple defense.',
  },
];

const goalChoices: RefereeChoice[] = [
  {
    id: 'wait-back-wall',
    label: 'Award the goal only when the ball contacts the back wall',
    grade: 'correct',
    score: 1,
    feedback:
      'Correct. Crossing the front plane is not the scoring instant in this scenario; the back-wall contact supplies the required event.',
  },
  {
    id: 'plane-crossing',
    label: 'Award the goal as soon as the ball crosses the goal line',
    grade: 'incorrect',
    score: 0,
    feedback:
      'Too early. Keep observing until the ball makes the defined back-wall contact.',
  },
  {
    id: 'wait-rest',
    label: 'Wait until the ball becomes completely stationary',
    grade: 'partial',
    score: 0.35,
    feedback:
      'You avoid the early plane-crossing call, but full rest is unnecessary once the back-wall event is clear.',
  },
  {
    id: 'no-goal-rebound',
    label: 'Disallow it because the ball rebounds out of the goal',
    grade: 'incorrect',
    score: 0,
    feedback:
      'The later rebound does not undo the already observed back-wall contact.',
  },
];

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'legal-dribbler-backspin',
    title: 'Legal powered dribbler: backspin without holding',
    shortTitle: 'Legal dribbler',
    ruleRef: {
      section: 'Rule 2.5',
      url: RULE_2_5_URL,
      note: 'Judge the observable control, not merely the presence of a powered roller.',
    },
    category: 'ball-control',
    publicSummary:
      'The blue robot uses a powered front roller to give the ball backspin while driving. The ball stays visibly mobile and the yellow robot can knock it free.',
    refereeCue:
      'Look for independent ball movement and whether a genuine opponent challenge can dislodge it. Backspin alone is not the decision.',
    duration: 10,
    actors: [
      robot('blue-1', 'Blue 1', 'blue', pose(-0.2, -0.64, 0), 1, true),
      robot('yellow-1', 'Yellow 1', 'yellow', pose(0.5, 0.25, -PI / 2), 1),
      ball(pose(-0.2, -0.53, 0)),
    ],
    overlays: ['actor-labels', 'ball-trail', 'capture-plane', 'timers'],
    choices: legalDribblerChoices,
    defaultCamera: 'broadcast',
    sample: (timeSeconds) => {
      const time = clamp(timeSeconds, 0, 10);
      const travel = smoothProgress(time, 0.8, 7.1);
      const yaw = 0.15 * Math.sin(travel * PI);
      const blue = pose(-0.2 + 0.2 * travel, -0.64 + 0.92 * travel, yaw);
      // Keep the visual ball shallow enough that it touches the roller without
      // intersecting deeply with any of the selectable robot meshes.
      const frontDistance = 0.1175;
      const challenge = smoothProgress(time, 5.4, 7.25);
      const yellow = mixPose(
        pose(0.5, 0.25, -PI / 2),
        opponentChallengePose(blue, frontDistance),
        challenge,
      );
      const released = smoothProgress(time, 7.15, 8.7);
      const captureDepthMm = Math.max(
        0,
        (RCJ_SIMULATOR_GUIDES.robotCapturePlaneForward -
          (frontDistance - RCJ_FIELD_SPEC_2026.ball.diameter / 2)) *
          1000,
      );
      const controlledBall = pose(
        blue.x + Math.sin(yaw) * frontDistance,
        blue.z + Math.cos(yaw) * frontDistance,
        -time * 5.4,
      );
      const releaseAwayFromOpponentX = controlledBall.x <= yellow.x ? -1 : 1;
      const ballPose = pose(
        controlledBall.x + releaseAwayFromOpponentX * 0.3 * released,
        controlledBall.z + 0.025 * released,
        controlledBall.yaw - released * 2,
      );
      const phaseLabel =
        time < 0.8
          ? 'Set-up'
          : time < 5.4
            ? 'Powered dribble'
            : time < 7.2
              ? 'Opponent challenge'
              : 'Ball dislodged';
      const evidence: ScenarioEvidence[] = [
        {
          kind: 'objective',
          text: 'The ball rotates and changes position while under close control.',
        },
        {
          kind: 'objective',
          text:
            time < 7.2
              ? 'A yellow opponent is approaching the ball.'
              : 'The yellow challenge visibly separates the ball from Blue 1.',
        },
        {
          kind: 'judgment',
          text: 'The shown control remains contestable rather than trapping the ball.',
        },
      ];
      return frame(
        { 'blue-1': blue, 'yellow-1': yellow, ball: ballPose },
        {
          roller: metric('Powered roller', '1.5 m/s surface', 'neutral'),
          capture: metric(
            'Capture depth',
            `${captureDepthMm.toFixed(1)} mm`,
            'good',
          ),
          spin: metric(
            'Ball backspin',
            `${Math.round(mix(18, 34, travel))} rad/s`,
            'good',
          ),
          contestable: metric(
            'Opponent access',
            time < 7.2 ? 'Challenge developing' : 'Ball dislodged',
            time < 7.2 ? 'neutral' : 'good',
          ),
        },
        phaseLabel,
        evidence,
        released === 0
          ? { ownerId: 'blue-1', forwardOffsetM: frontDistance }
          : null,
      );
    },
  },
  {
    id: 'illegal-ball-holding',
    title: 'Illegal ball holding: trapped without a powered roller',
    shortTitle: 'Ball holding',
    ruleRef: {
      section: 'Rule 2.5',
      url: RULE_2_5_URL,
      note: 'Use the current official procedure for the restart; this scene teaches recognition of the condition.',
    },
    category: 'ball-control',
    publicSummary:
      'A front cavity traps the ball even though the roller is switched off. The opponent makes a real challenge, but the ball remains locked to the blue robot.',
    refereeCue:
      'Mechanism labels are not enough. Watch relative ball motion, access by the opponent, and how long the trapped state persists.',
    duration: 10,
    actors: [
      robot('blue-1', 'Blue 1', 'blue', pose(-0.12, -0.26, 0.05), 1),
      robot('yellow-1', 'Yellow 1', 'yellow', pose(0.48, 0, -PI / 2), 1),
      ball(pose(-0.115, -0.153, 0)),
    ],
    overlays: ['actor-labels', 'capture-plane', 'contact-point', 'timers'],
    choices: holdingChoices,
    defaultCamera: 'referee',
    sample: (timeSeconds) => {
      const time = clamp(timeSeconds, 0, 10);
      const drift = smoothProgress(time, 1, 8);
      const blue = pose(-0.12 + 0.04 * drift, -0.26 + 0.22 * drift, 0.05);
      const challenge = smoothProgress(time, 3, 5.4);
      const withdraw = smoothProgress(time, 7.2, 9.2);
      const contactPoint = opponentChallengePose(blue, 0.112);
      const yellowAtChallenge = mixPose(
        pose(0.48, 0, -PI / 2),
        contactPoint,
        challenge,
      );
      const yellow = mixPose(
        yellowAtChallenge,
        pose(0.4, 0.12, -PI / 2),
        withdraw,
      );
      const ballPose = pose(
        blue.x + Math.sin(blue.yaw) * 0.112,
        blue.z + Math.cos(blue.yaw) * 0.112,
        -0.08 * time,
      );
      const elapsed = Math.max(0, time - 1);
      const phaseLabel =
        time < 3
          ? 'Trapped ball'
          : time < 5.4
            ? 'Opponent challenge'
            : time < 7.2
              ? 'Challenge cannot free ball'
              : 'Persistent holding';
      const evidence: ScenarioEvidence[] = [
        {
          kind: 'objective',
          text: 'Ball-to-robot relative motion remains near zero for several seconds.',
        },
        {
          kind: 'objective',
          text:
            time < 3
              ? 'The ball sits deep in the front cavity.'
              : 'A genuine opponent challenge does not make the ball available.',
        },
        {
          kind: 'policy',
          text: 'After recognising holding, use the restart specified by the current rules and event guidance.',
        },
      ];
      return frame(
        { 'blue-1': blue, 'yellow-1': yellow, ball: ballPose },
        {
          roller: metric('Powered roller', 'Off', 'neutral'),
          relativeMotion: metric('Relative ball motion', '< 0.01 m/s', 'bad'),
          possession: metric(
            'Trapped duration',
            `${elapsed.toFixed(1)} s`,
            elapsed > 3 ? 'bad' : 'warn',
          ),
          access: metric(
            'Opponent access',
            time < 3 ? 'Not yet tested' : 'Challenge blocked',
            time < 3 ? 'neutral' : 'bad',
          ),
        },
        phaseLabel,
        evidence,
        { ownerId: 'blue-1', forwardOffsetM: 0.112 },
      );
    },
  },
  {
    id: 'multiple-defense-basic',
    title: 'Multiple defense: identify and relocate the farther robot',
    shortTitle: 'Multiple defense',
    ruleRef: {
      section: 'Rule 2.6',
      url: RULE_2_6_URL,
      note: 'Neutral placement must be unoccupied and follow the current placement procedure.',
    },
    category: 'penalty-area',
    publicSummary:
      'Two blue robots occupy their own penalty area. Blue 1 is closer to the ball, so Blue 2 is moved to the furthest unoccupied neutral spot.',
    refereeCue:
      "Count defenders using position, then compare each robot's distance from the ball before selecting the robot to move.",
    duration: 12,
    actors: [
      robot('blue-1', 'Blue 1', 'blue', pose(-0.18, -0.89, 0), 1),
      robot('blue-2', 'Blue 2', 'blue', pose(0.2, -0.88, 0.2), 2),
      robot('yellow-1', 'Yellow 1', 'yellow', pose(0.18, -0.42, PI), 1),
      ball(pose(-0.14, -0.77, 0)),
    ],
    overlays: ['actor-labels', 'penalty-areas', 'neutral-placement', 'timers'],
    choices: multipleDefenseChoices,
    defaultCamera: 'overhead',
    sample: (timeSeconds) => {
      const time = clamp(timeSeconds, 0, 12);
      const entering = smoothProgress(time, 1, 3);
      const relocation = smoothProgress(time, 6.4, 9.2);
      const blue1 = pose(-0.18, -0.89, 0);
      const blue2Inside = mixPose(
        pose(0.24, -0.66, -0.1),
        pose(0.2, -0.88, 0.2),
        entering,
      );
      const blue2 = mixPose(
        blue2Inside,
        pose(
          RCJ_FIELD_DERIVED.neutralSpotX,
          RCJ_FIELD_DERIVED.neutralSpotZ,
          PI,
        ),
        relocation,
      );
      const yellow = pose(0.18, -0.42 + 0.025 * Math.sin(time * 0.8), PI);
      const ballPose = pose(-0.14, -0.77, 0);
      const twoInside = time >= 2.4 && relocation < 0.65;
      const phaseLabel =
        time < 2.4
          ? 'Second defender enters'
          : time < 6.4
            ? 'Two defenders in penalty area'
            : time < 9.2
              ? 'Relocate farther defender'
              : 'Legal defensive shape restored';
      const evidence: ScenarioEvidence[] = [
        {
          kind: 'objective',
          text: twoInside
            ? 'Two blue robot footprints overlap the blue penalty area.'
            : 'Only Blue 1 remains in the blue penalty area.',
        },
        {
          kind: 'objective',
          text: 'Blue 1 is nearer to the ball than Blue 2.',
        },
        {
          kind: 'policy',
          text: 'The visual neutral marker represents the prescribed unoccupied placement; confirm event-specific procedure.',
        },
      ];
      return frame(
        {
          'blue-1': blue1,
          'blue-2': blue2,
          'yellow-1': yellow,
          ball: ballPose,
        },
        {
          defenders: metric(
            'Blue defenders in area',
            twoInside ? '2' : '1',
            twoInside ? 'bad' : 'good',
          ),
          nearer: metric('Nearest the ball', 'Blue 1', 'neutral'),
          selected: metric('Robot to relocate', 'Blue 2', 'good'),
          placement: metric(
            'Neutral placement',
            relocation < 1 ? 'Highlighted' : 'Complete',
            relocation < 1 ? 'warn' : 'good',
          ),
        },
        phaseLabel,
        evidence,
      );
    },
  },
  {
    id: 'pushing-discretion',
    title: "Pushing: the referee's judgment between contact and offence",
    shortTitle: 'Pushing judgment',
    ruleRef: {
      section: 'Rule 2.6',
      url: RULE_2_6_URL,
      note: 'This deliberately ambiguous clip accepts more than one well-supported decision.',
    },
    category: 'contact',
    publicSummary:
      'Blue and yellow meet while both can play the ball. Their contact becomes sustained, but both keep driving. Camera angle and effect on play matter.',
    refereeCue:
      'Separate facts from judgment: observe contact, drive directions and ball access, then decide whether one robot caused a material disadvantage.',
    duration: 10,
    actors: [
      robot('blue-1', 'Blue 1', 'blue', pose(-0.12, -1.02, 0), 1),
      robot('yellow-1', 'Yellow 1', 'yellow', pose(0.1, -0.56, PI), 1),
      ball(pose(0.02, -0.84, 0)),
    ],
    overlays: [
      'actor-labels',
      'penalty-areas',
      'contact-point',
      'contact-vector',
      'ball-trail',
    ],
    choices: pushingChoices,
    defaultCamera: 'referee',
    sample: (timeSeconds) => {
      const time = clamp(timeSeconds, 0, 10);
      const approach = smoothProgress(time, 0.8, 3.3);
      const separation = smoothProgress(time, 7.2, 9.2);
      const blueContact = pose(-0.075, -0.91, 0.14);
      const contactDirectionX = 0.15;
      const contactDirectionZ = 0.13;
      const contactDirectionScale =
        ROBOT_CONTACT_CENTER_DISTANCE /
        Math.hypot(contactDirectionX, contactDirectionZ);
      const yellowContact = pose(
        blueContact.x + contactDirectionX * contactDirectionScale,
        blueContact.z + contactDirectionZ * contactDirectionScale,
        PI + 0.14,
      );
      const blueRaw = mixPose(
        mixPose(pose(-0.12, -1.02, 0), blueContact, approach),
        pose(-0.2, -0.65, -0.28),
        separation,
      );
      const yellowRaw = mixPose(
        mixPose(pose(0.1, -0.56, PI), yellowContact, approach),
        pose(0.22, -0.98, PI - 0.2),
        separation,
      );
      const [blue, yellow] = separateRobotPairEqually(blueRaw, yellowRaw);
      const ballPose = pose(
        0.015 + 0.11 * separation,
        -0.84 + 0.16 * separation,
        time * 1.8,
      );
      const sustained =
        time >= 3.3 &&
        distanceBetween(blue, yellow) <= ROBOT_CONTACT_CENTER_DISTANCE + 1e-6;
      const phaseLabel =
        time < 3.3
          ? 'Opponents converge'
          : sustained
            ? 'Sustained opposing contact'
            : 'Contact resolves';
      const evidence: ScenarioEvidence[] = [
        {
          kind: 'objective',
          text: sustained
            ? 'The robot bodies are in sustained opposing contact.'
            : 'The robots are not currently in sustained contact.',
        },
        {
          kind: 'objective',
          text: 'Both robots apply motion toward the contest and the ball remains nearby.',
        },
        {
          kind: 'judgment',
          text: 'Whether one robot caused a material disadvantage is intentionally ambiguous.',
        },
      ];
      return frame(
        { 'blue-1': blue, 'yellow-1': yellow, ball: ballPose },
        {
          contact: metric(
            'Opposing contact',
            sustained ? 'Sustained' : 'No',
            sustained ? 'warn' : 'neutral',
          ),
          drive: metric('Drive contribution', 'Both robots', 'neutral'),
          access: metric('Ball access', 'Still contestable', 'good'),
          decision: metric('Pushing call', 'Referee judgment', 'warn'),
        },
        phaseLabel,
        evidence,
      );
    },
  },
  {
    id: 'pushing-and-multiple-defense',
    title: 'Overlapping events: pushing before multiple defense',
    shortTitle: 'Two events',
    ruleRef: {
      section: 'Rule 2.6',
      url: RULE_2_6_URL,
      note: 'The 2026 rule explicitly resolves pushing before multiple defense when both occur together.',
    },
    category: 'contact',
    publicSummary:
      'A yellow attacker pushes a second blue robot into the blue penalty area. The result looks like multiple defense, but the preceding contact may have caused it.',
    refereeCue:
      'Read the timeline, not one frozen frame. Decide the pushing question first, then reassess which objective conditions remain.',
    duration: 12,
    actors: [
      robot('blue-1', 'Blue 1', 'blue', pose(-0.26, -0.98, 0), 1),
      robot('blue-2', 'Blue 2', 'blue', pose(0.22, -0.62, PI), 2),
      robot('yellow-1', 'Yellow 1', 'yellow', pose(0.24, -0.34, PI), 1),
      ball(pose(0.1, -0.84, 0)),
    ],
    overlays: [
      'actor-labels',
      'penalty-areas',
      'contact-point',
      'contact-vector',
      'timers',
    ],
    choices: combinedChoices,
    defaultCamera: 'overhead',
    sample: (timeSeconds) => {
      const time = clamp(timeSeconds, 0, 12);
      const approach = smoothProgress(time, 1.2, 3.4);
      const push = smoothProgress(time, 3.4, 6.3);
      const release = smoothProgress(time, 8.2, 10.3);
      const blue1 = pose(-0.26, -0.98, 0);
      const blue2Start = pose(0.22, -0.62, PI);
      const blue2 = mixPose(blue2Start, pose(0.2, -0.88, PI), push);
      const yellowApproach = mixPose(
        pose(0.24, -0.34, PI),
        pose(blue2Start.x, blue2Start.z + ROBOT_CONTACT_CENTER_DISTANCE, PI),
        approach,
      );
      const yellowInContact = pose(
        blue2.x,
        blue2.z + ROBOT_CONTACT_CENTER_DISTANCE,
        PI,
      );
      const yellow =
        time < 3.4
          ? yellowApproach
          : mixPose(yellowInContact, pose(0.42, -0.52, PI), release);
      const ballPose = pose(
        0.09 + 0.04 * push + 0.05 * release,
        -0.84 - 0.035 * push + 0.14 * release,
        time * 1.2,
      );
      const contact = time >= 3.4 && time < 8.2;
      const twoDefenders = push > 0.72 && release < 0.9;
      const phaseLabel =
        time < 3.4
          ? 'Attacker approaches defender'
          : time < 6.3
            ? 'Contact drives Blue 2 inward'
            : time < 8.2
              ? 'Two defenders now inside'
              : 'Reassess after contact';
      const evidence: ScenarioEvidence[] = [
        {
          kind: 'objective',
          text: contact
            ? 'Yellow 1 is in sustained contact while Blue 2 moves toward its own goal.'
            : 'The sustained contact has ended.',
        },
        {
          kind: 'objective',
          text: twoDefenders
            ? 'Two blue robots now overlap the blue penalty area.'
            : 'The two-defender overlap is not currently established.',
        },
        {
          kind: 'judgment',
          text: 'The referee must decide whether the contact caused the later defensive geometry.',
        },
        {
          kind: 'policy',
          text: 'The 2026 rule resolves pushing before multiple defense when both occur together.',
        },
      ];
      return frame(
        {
          'blue-1': blue1,
          'blue-2': blue2,
          'yellow-1': yellow,
          ball: ballPose,
        },
        {
          contact: metric(
            'Yellow–Blue contact',
            contact ? 'Sustained' : 'Clear',
            contact ? 'warn' : 'neutral',
          ),
          defenders: metric(
            'Blue defenders in area',
            twoDefenders ? '2' : '1',
            twoDefenders ? 'bad' : 'good',
          ),
          causality: metric('Cause of entry', 'Requires judgment', 'warn'),
          priority: metric(
            'Training sequence',
            'Pushing → reassess',
            'neutral',
          ),
        },
        phaseLabel,
        evidence,
      );
    },
  },
  {
    id: 'goal-back-wall',
    title: 'Goal recognition: wait for the back-wall contact',
    shortTitle: 'Goal event',
    ruleRef: {
      section: 'Rule 2.4',
      url: RULE_2_4_URL,
      note: 'The rendered goal plane is an explanatory aid; the highlighted back-wall contact is the scoring event taught here.',
    },
    category: 'goal',
    publicSummary:
      'The ball crosses the yellow goal opening, continues through the goal, and only then touches the back wall. A small rebound follows.',
    refereeCue:
      'Do not react to the plane overlay alone. Keep sight of the ball and confirm the distinct back-wall contact before signalling.',
    duration: 10,
    actors: [
      robot('blue-1', 'Blue 1', 'blue', pose(-0.08, 0.38, 0), 1),
      robot('yellow-1', 'Yellow 1', 'yellow', pose(0.28, 0.92, PI), 1),
      ball(pose(-0.08, 0.5, 0)),
    ],
    overlays: [
      'actor-labels',
      'ball-trail',
      'goal-plane',
      'goal-back-wall',
      'timers',
    ],
    choices: goalChoices,
    defaultCamera: 'broadcast',
    sample: (timeSeconds) => {
      const time = clamp(timeSeconds, 0, 10);
      const shot = smoothProgress(time, 1.2, 6.9);
      const rebound = smoothProgress(time, 7, 8.4);
      const blue = pose(-0.08, 0.38 + 0.08 * smoothProgress(time, 0.5, 1.2), 0);
      const yellow = pose(0.28 - 0.09 * smoothProgress(time, 2.5, 5), 0.92, PI);
      const forwardZ = mix(
        0.5,
        RCJ_FIELD_DERIVED.goalBackContactBallCenterZ,
        shot,
      );
      const ballPose = pose(
        -0.08 + 0.035 * Math.sin(shot * PI),
        forwardZ - 0.14 * rebound,
        time * 4.2,
      );
      const crossedPlane =
        forwardZ >=
        RCJ_FIELD_DERIVED.goalMouthZ + RCJ_FIELD_SPEC_2026.ball.diameter / 2;
      const hitBackWall = time >= 6.9;
      const phaseLabel =
        time < 1.2
          ? 'Shot set-up'
          : !crossedPlane
            ? 'Ball travels toward goal'
            : !hitBackWall
              ? 'Plane crossed — keep watching'
              : rebound < 0.2
                ? 'Back-wall contact — goal'
                : 'Post-goal rebound';
      const evidence: ScenarioEvidence[] = [
        {
          kind: 'objective',
          text: crossedPlane
            ? 'The whole ball has passed the illustrated front plane.'
            : 'The ball has not yet passed the illustrated front plane.',
        },
        {
          kind: 'objective',
          text: hitBackWall
            ? 'The ball has made visible contact with the goal back wall.'
            : 'No back-wall contact has occurred yet.',
        },
        {
          kind: 'judgment',
          text: hitBackWall
            ? 'The required scoring event is now observable.'
            : 'The plane crossing alone is not enough for the scoring call taught here.',
        },
      ];
      return frame(
        { 'blue-1': blue, 'yellow-1': yellow, ball: ballPose },
        {
          plane: metric(
            'Goal plane',
            crossedPlane ? 'Crossed' : 'Not crossed',
            crossedPlane ? 'warn' : 'neutral',
          ),
          backWall: metric(
            'Back-wall contact',
            hitBackWall ? 'Confirmed' : 'Waiting',
            hitBackWall ? 'good' : 'neutral',
          ),
          decision: metric(
            'Goal decision',
            hitBackWall ? 'Award goal' : 'Keep observing',
            hitBackWall ? 'good' : 'warn',
          ),
          rebound: metric(
            'Later rebound',
            rebound > 0.2 ? 'Visible' : 'None',
            'neutral',
          ),
        },
        phaseLabel,
        evidence,
      );
    },
  },
];

export function getScenario(id: string | null | undefined): ScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
