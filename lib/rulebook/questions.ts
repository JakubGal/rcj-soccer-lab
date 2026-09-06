/** Short, source-linked checks where an invented 3D scene would add no evidence. */
export type RuleQuestion = {
  id: string;
  title: string;
  anchor: string;
  question: string;
  options: string[];
  answer: number;
  feedback: string;
};

export const RULE_QUESTIONS: RuleQuestion[] = [
  {
    id: 'vision-dimensions',
    title: 'Soccer Vision inspection limits',
    anchor: 'dimensions',
    question:
      'A Soccer Vision robot is measured upright with all parts extended. Which body limits apply, before the stated handle and top-marker exceptions?',
    options: [
      '220 mm diameter, 220 mm height, 1500 g maximum',
      '180 mm cylinder diameter and 180 mm height; no mass limit',
      '180 mm diameter, 220 mm height, 1400 g maximum',
    ],
    answer: 1,
    feedback:
      'Soccer Vision uses the 180 mm diameter and height limits with no mass cap. The robot must fit smoothly; the suggested inspection margin does not replace the stated limit.',
  },
  {
    id: 'infrared-dimensions',
    title: 'Soccer Infrared inspection limits',
    anchor: 'dimensions',
    question:
      'Which limits apply to a main-league Soccer Infrared robot in 2026?',
    options: [
      '220 mm cylinder diameter, 220 mm height and 1500 g including the handle',
      '220 mm diameter and 1400 g, excluding the handle',
      '180 mm diameter and no mass limit',
    ],
    answer: 0,
    feedback:
      'The main Soccer Infrared limits are 220 mm diameter, 220 mm height and 1500 g. Measure extended parts and include the handle mass. Entry has separate requirements.',
  },
  {
    id: 'capture-depth-access',
    title: 'Capture depth and opponent access',
    anchor: 'dimensions',
    question:
      'A robot captures the ball only 12 mm inside its convex hull, but opponents cannot take the ball. Does the shallow capture depth alone make it compliant?',
    options: [
      'Yes, anything below 15 mm is automatically legal',
      'Yes, if it uses a powered dribbler',
      'No; the 15 mm depth limit and opponent access both matter',
    ],
    answer: 2,
    feedback:
      'Check the depth against a straight edge across protruding points, and check that another robot can take possession. Passing one check does not replace the other.',
  },
  {
    id: 'handle-exception',
    title: 'Handle clearance and height exception',
    anchor: 'handle',
    question: 'Which handle arrangement meets the stated handle requirements?',
    options: [
      'An accessible stable handle with at least 50 mm hand clearance; any portion above the robot height limit carries no robot components',
      'A handle with 20 mm clearance if the referee can just reach it',
      'A handle above the height limit with a camera mounted on the excess portion',
    ],
    answer: 0,
    feedback:
      'The accessible handle needs at least 50 mm clearance above the highest non-handle structure. It may exceed the height limit, but the excess portion is not a component-mounting exception.',
  },
  {
    id: 'top-marker-exception',
    title: 'Top marker requirements',
    anchor: 'top-markers',
    question:
      'Which top marker is compliant even if it extends beyond the normal robot size limit?',
    options: [
      'Any coloured team badge at least 20 mm wide',
      'A horizontal white plastic circle at least 40 mm across, visible and accessible for the referee to write its number',
      'A number printed only on the side of the robot',
    ],
    answer: 1,
    feedback:
      'The referee writes the assigned number on the accessible white plastic top circle. Top markers have a stated size-limit exception; a side label does not replace them.',
  },
  {
    id: 'electrical-safety',
    title: 'Voltage and mains safety',
    anchor: '_safety_and_power_requirements',
    question: 'Which electrical arrangement meets the stated power limits?',
    options: [
      'A 60 V DC supply with insulated wires',
      'Mains electricity through a long protected cable',
      'No mains electricity, at most 48 V DC or 25 V AC RMS, with safely accessible measurement points',
    ],
    answer: 2,
    feedback:
      'Insulation does not waive the voltage limits or mains prohibition. Voltage must be measurable at inspection without exposing unsafe test points.',
  },
  {
    id: 'lithium-safety',
    title: 'Lithium battery storage and charging',
    anchor: '_safety_and_power_requirements',
    question:
      'How should a team handle lithium batteries in the competition area?',
    options: [
      'Store them in safety bags, supervise charging, and follow the event fire and evacuation procedures',
      'Leave charging unattended whenever a charger has an automatic cut-off',
      'Use a safety bag only after a battery starts overheating',
    ],
    answer: 0,
    feedback:
      'Battery storage, supervised charging and emergency procedures are separate safety duties. An automatic charger does not replace supervision.',
  },
  {
    id: 'mechanical-stop-safety',
    title: 'Emergency stop and mechanical hazards',
    anchor: '_safety_and_power_requirements',
    question:
      'A robot meets the size limits but has an unsecured battery, exposed pinch points and no emergency stop. What should inspection conclude?',
    options: [
      'Size compliance is enough to permit play',
      'The safety problems must be addressed; dimensional compliance does not replace safe construction and emergency stop functionality',
      'It is legal if the team promises not to drive quickly',
    ],
    answer: 1,
    feedback:
      'Safety checks include secure batteries, safe wiring, emergency stop functionality and mechanical hazards. Teams must also report potentially dangerous behavior in advance as required by the event rules.',
  },
  {
    id: 'radio-limits',
    title: 'Robot communication limits',
    anchor: '_robot_communication',
    question:
      'Which robot-to-robot radio arrangement is permitted by the general rules, unless a league has an applicable modification?',
    options: [
      'Any band if no other team complains',
      '2.4 GHz at 200 mW EIRP when the venue is crowded',
      '2.4 GHz at no more than 100 mW EIRP; spectrum availability is not guaranteed',
    ],
    answer: 2,
    feedback:
      'The limit applies to EIRP, not just a transmitter power setting. Teams manage their communication and cannot assume exclusive spectrum access.',
  },
  {
    id: 'colours-lights',
    title: 'Visible colours and interfering lights',
    anchor: 'robots-interference',
    question:
      'A bright red line-sensor light is detected as the ball by another team. Is it automatically acceptable because it is not an orange construction part?',
    options: [
      'Yes; only orange plastic is restricted',
      'No; interfering lights must be covered, as must prohibited visible orange, yellow and blue robot parts',
      'Yes; the opposing camera must accept any light mounted on a robot',
    ],
    answer: 1,
    feedback:
      'The interference requirement covers lights as well as construction colours. The 2026 text specifically warns about bright red lights being mistaken for the ball.',
  },
  {
    id: 'infrared-emitters',
    title: 'IR emitters in Soccer Infrared',
    anchor: 'regulations-inference-in-infrared',
    question:
      'A main Soccer Infrared robot has a ToF distance sensor designed to emit IR. What is required?',
    options: [
      'Remove or cover the IR-emitting device as required by the organizers',
      'It is always permitted because it measures distance rather than communicating',
      'It is automatically allowed if its wavelength differs from the ball specification',
    ],
    answer: 0,
    feedback:
      'The Soccer Infrared restriction covers components designed to emit IR, including ToF and LiDAR. Do not apply this league-specific blanket ban to Soccer Vision; general interference rules still apply there.',
  },
  {
    id: 'autonomy-agility',
    title: 'Autonomous control and agility',
    anchor: 'robots-control',
    question:
      'Does the simulator’s keyboard control mean a team may steer its competition robot remotely during a match?',
    options: [
      'Yes, if only the captain operates it',
      'Yes, provided the robot can detect the ball',
      'No; competition robots are autonomous, and their movement must not be restricted to a single axis',
    ],
    answer: 2,
    feedback:
      'Manual mode is a teaching tool, not a competition control method. Rule 3.2 requires autonomous control; Rule 3.3 also requires movement beyond one dimension, for example by turning.',
  },
  {
    id: 'communication-module',
    title: 'Referee communication module',
    anchor: 'international-competition-specifics',
    question:
      'At the world championship, which statement about the provided referee communication module is correct?',
    options: [
      'It is optional for all teams',
      'It is required; protect it from impact and keep it at least 10 mm inside the outer edge. The module itself may exceed the height limit',
      'It must be omitted whenever it exceeds the normal robot height limit',
    ],
    answer: 1,
    feedback:
      'The current module provides referee start/stop control. Other competitions must confirm their own requirement; the stated height exception does not remove the protection and placement requirements.',
  },
  {
    id: 'inspection-cadence',
    title: 'Daily and random inspections',
    anchor: 'regulations-inspections',
    question:
      'A robot passed inspection yesterday and has not been modified. What applies today?',
    options: [
      'It still needs daily inspection before its first game; organizers may also request random inspections',
      'Yesterday’s inspection covers the entire tournament',
      'It needs another inspection only after a team files a complaint',
    ],
    answer: 0,
    feedback:
      'Daily inspection is required before the first game. An earlier pass does not prevent further checks during the event.',
  },
  {
    id: 'kicker-test-setup',
    title: 'Kicker test setup',
    anchor: 'kicker-power-measuring',
    question: 'How is the on-field kicker test set up?',
    options: [
      'Use any practice ball and kick from the center circle',
      'Start beside the goal and measure the first bounce height',
      'Use the tournament ball, place the robot inside a goal touching its back wall, and kick toward the opposite goal',
    ],
    answer: 2,
    feedback:
      'The test uses the tournament ball and actual field because rebound behavior depends on field construction. Teams should be able to adjust kicker power.',
  },
  {
    id: 'kicker-test-result',
    title: 'Kicker test pass or fail',
    anchor: 'kicker-power-measuring',
    question:
      'After the test kick rebounds from the opposite goal, it hits the back wall of the starting goal. What is the result?',
    options: [
      'Pass, because it reached both goals',
      'Fail; a passing rebound must not hit the starting goal’s back wall',
      'Pass unless the ball comes to rest inside the starting goal',
    ],
    answer: 1,
    feedback:
      'A rebound contact with the starting goal’s back wall fails this test. The ball does not have to come to rest there.',
  },
  {
    id: 'kicker-recheck',
    title: 'Kicker compliance during the event',
    anchor: 'regulations-limitations',
    question:
      'Can a referee recheck kicker power after a robot passed an earlier inspection?',
    options: [
      'Yes; compliance can be checked at any time, with on-field checks available before a half, on a damaged robot’s return, or before a restart after a goal',
      'No; one pass makes all later power settings legal',
      'Only after the tournament has finished',
    ],
    answer: 0,
    feedback:
      'An earlier inspection is not a permanent exemption. The named gameplay moments are opportunities for the referee to test the kicker, not a promise that every check must happen at each one.',
  },
  {
    id: 'repeated-out-damage',
    title: 'Repeated out of bounds',
    anchor: 'damaged-robots',
    question:
      'A robot continually enters the penalty area completely or goes out of bounds. Is this relevant to a damaged-robot decision?',
    options: [
      'No; repeated behavior can never be considered damage',
      'Only if the robot loses a visible part',
      'Yes; continual entry or out of bounds is listed as a damaged-robot example, with the referee deciding',
    ],
    answer: 2,
    feedback:
      'Damage is not limited to broken hardware. The referee assesses the repeated behavior; the team cannot decide unilaterally to remove or return its robot.',
  },
  {
    id: 'removed-motors',
    title: 'Motors after removal',
    anchor: 'damaged-robots',
    question: 'A robot is removed from play. What must happen to its motors?',
    options: [
      'They may keep running while the team holds the handle',
      'They must be turned off',
      'They need stopping only if a wheel is damaged',
    ],
    answer: 1,
    feedback:
      'Whenever a robot is removed from play, its motors must be off. This is not conditional on the reason for removal.',
  },
  {
    id: 'neutral-capability',
    title: 'Ability to play a neutral ball',
    anchor: 'ball-movement',
    question:
      'An unhindered robot cannot approach and touch a ball at its nearest neutral spot before lack of progress, or cannot move that ball from its own half to the opponent’s half. What may the referee do?',
    options: [
      'Deem that robot damaged at referee discretion',
      'Automatically award a goal on every failed approach',
      'Ignore it because only the teammate must be able to play the ball',
    ],
    answer: 0,
    feedback:
      'The capability requirement applies to each robot. The published response is discretionary damaged classification, not an invented automatic goal penalty.',
  },
  {
    id: 'neutral-obstruction',
    title: 'Opponent obstruction exception',
    anchor: 'ball-movement',
    question:
      'The opponent prevents a robot from detecting or playing a neutral ball. Does the neutral-ball capability rule alone establish that the obstructed robot is damaged?',
    options: [
      'Yes; any failure to reach the ball proves damage',
      'Yes; obstruction matters only during kickoff',
      'No; this capability rule has an opponent-obstruction exception',
    ],
    answer: 2,
    feedback:
      'Separate an inability to play an unhindered neutral ball from a robot being prevented from playing it by an opponent.',
  },
  {
    id: 'ball-above-wall',
    title: 'Ball above wall height',
    anchor: 'ball-movement',
    question:
      'A robot sends the ball above the wall height, but it lands back inside the field. Is crossing the side wall horizontally necessary for the ball-out damaged rule?',
    options: [
      'Yes; landing inside makes any kick legal',
      'No; sending it above wall height also meets the stated condition',
      'Yes; only a goal can be called for a high ball',
    ],
    answer: 1,
    feedback:
      'The permitted playing volume is bounded by the walls and their height. Identify the responsible robot; do not invent a safe exemption simply because the ball lands inside.',
  },
  {
    id: 'lack-progress-placement',
    title: 'Choosing the lack-of-progress spot',
    anchor: 'lack-of-progress',
    question:
      'After a completed count, the stalemate persists. The closest neutral spot is occupied, but other neutral spots are free. Where should the ball be placed?',
    options: [
      'At the nearest unoccupied neutral spot',
      'At the occupied closest spot, moving its robot away first',
      'Always at the center, regardless of availability',
    ],
    answer: 0,
    feedback:
      'Choose among unoccupied neutral spots. If that placement does not resolve lack of progress, another call may use a different neutral spot.',
  },
  {
    id: 'return-placement',
    title: 'Return position and orientation',
    anchor: 'out-of-bounds',
    question:
      'An out-of-bounds robot is eligible and has permission to return. Which placement is correct?',
    options: [
      'At the nearest free neutral spot, facing the opponent’s goal',
      'Where it left the field, facing the ball',
      'At the unoccupied neutral spot furthest from the ball, facing its own goal',
    ],
    answer: 2,
    feedback:
      'Eligibility, referee permission, a free placement and orientation are separate checks. The return rule selects the furthest available neutral spot and the robot’s own goal direction.',
  },
  {
    id: 'final-score-trim',
    title: 'Final score margin',
    anchor: 'game-procedure-and-length-of-a-game',
    question:
      'The raw game score has a 14-goal difference. How is the final score handled under the main game procedure?',
    options: [
      'Keep the full difference in every case',
      'Trim the final score so the difference is at most 10 goals',
      'Stop recording all goals after the first goal',
    ],
    answer: 1,
    feedback:
      'The published limit concerns the final score difference. It is not an instruction to end the match when a team first leads by ten.',
  },
  {
    id: 'full-match-duration',
    title: 'Full match versus training session',
    anchor: 'game-procedure-and-length-of-a-game',
    question:
      'A certification training session lasts 10 minutes. What is the normal complete main-league match format?',
    options: [
      'Two 10-minute halves with a 5-minute interval',
      'One 10-minute period with no side change',
      'Two 5-minute halves with a 10-minute interval',
    ],
    answer: 0,
    feedback:
      'A timed training session is not the entire competition match. The normal game has two halves; sides and the kickoff assignment change at half-time.',
  },
  {
    id: 'result-disputes',
    title: 'Discussing and signing the result',
    anchor: 'referees',
    question:
      'A team disputes an incident when reviewing the result. Which process follows the referee section?',
    options: [
      'Any spectator may overrule the referee',
      'Sign first and settle the disagreement later',
      'Team members at the table discuss it with the referee; settle disputes before both teams sign the final result',
    ],
    answer: 2,
    feedback:
      'Referee decisions during play are final. The team members at the table may speak to the referee, and result disputes must be settled before signatures finalize the result.',
  },
  {
    id: 'interference-evidence',
    title: 'Evidence of robot interference',
    anchor: 'robots-interference',
    question:
      'A team claims another team’s robot interferes with its sensors. What does the rule require for that claim?',
    options: [
      'Automatic disqualification of the opponent without checking',
      'Evidence from the claiming team and confirmation by the tournament organizers',
      'Proof only if both teams agree to an investigation',
    ],
    answer: 1,
    feedback:
      'A claim is not itself proof. This does not remove the referee’s separate ability to interrupt a game when spectator interference is suspected.',
  },
  {
    id: 'specification-violation',
    title: 'A non-compliant robot',
    anchor: 'violations',
    question:
      'Inspection confirms a robot violates a specification and no stated exception applies. What is the correct starting point?',
    options: [
      'It is not eligible to play; game or tournament disqualification may also apply as described, rather than being automatic for every case',
      'Allow it to play until it loses a match',
      'Every first violation automatically disqualifies the whole team from the tournament',
    ],
    answer: 0,
    feedback:
      'Do not confuse robot eligibility with discretionary sanctions against a team. Repeated similar violations can have more serious consequences.',
  },
  {
    id: 'pushed-out-policy',
    title: 'Published waiver and training policy',
    anchor: 'out-of-bounds',
    question:
      'Why does this trainer expect pushed out and keep-in-play after an accidental opponent push out of bounds?',
    options: [
      'The published rule removes all referee discretion',
      'An opponent push always scores a goal',
      'Committee training policy v1 selects the waiver permitted by Rule 2.8; an actual event must confirm its application',
    ],
    answer: 2,
    feedback:
      'Published Rule 2.8 permits the referee to waive the penalty. This trainer deliberately selects that option for the stated accidental-push cases; its policy is labelled separately from the official text.',
  },
  {
    id: 'infrared-ball-change',
    title: 'The main 2026 IR ball',
    anchor: 'infrared-ball-change',
    question:
      'Which ball-size distinction applies to the main 2026 rules and the separate Entry format?',
    options: [
      'Main Soccer Infrared keeps 74 mm and Entry switches to 42 mm',
      'Main Soccer Infrared switches to 42 mm; Entry continues with the larger IR ball',
      'Every format uses the same ball with no exceptions',
    ],
    answer: 1,
    feedback:
      'Read the 2026 change instead of treating the legacy large-ball specification as the main-league size. Tournament organizers provide game balls, not necessarily practice balls.',
  },
  {
    id: 'event-scope',
    title: 'Event-specific rules and credential scope',
    anchor: 'competition-specifics',
    question:
      'Does passing this main 2v2 training assessment establish that every local, Entry or SuperTeam procedure is identical?',
    options: [
      'No; verify the event’s adaptations, and study the separate Entry or SuperTeam rules when applicable',
      'Yes; the same certification replaces all event briefings',
      'Yes; only field colour can differ between formats',
    ],
    answer: 0,
    feedback:
      'The credential records completion of this main-league training assessment, not an official appointment or separate-format qualification. Local organizers can have adaptations and additional procedures.',
  },
];
