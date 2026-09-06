import { RULE_DOCUMENTS, RULE_SECTIONS, sectionUrl } from '../rulebook/catalog';
import type { RefereeAction, RefereeCase } from './referee-cases';

export type AppliedRule = {
  id: string;
  sectionId: string;
  document: string;
  number: string;
  title: string;
  provision: string;
  quote?: string;
  note?: string;
  url: string;
  lessonUrl: string;
};

// Provision labels identify the part to read within each official section.
// Section numbers and titles come from the same index as the full rulebook.
const provisions = {
  score: ['scoring', 'Back-wall scoring and the following kickoff'],
  capability: ['pre-match-meeting', 'Pre-match capability check'],
  kickoff: ['kick-off', 'Placement and referee start signal'],
  early: ['kick-off', 'Early-start removal'],
  kickoffReturn: ['kick-off', 'Ready robots returning before kickoff'],
  neutral: ['neutral-kickoff', 'Neutral kickoff exclusion circle'],
  holding: ['ball-movement', 'Holding restriction and dribbler exception'],
  ballOut: ['ball-movement', 'Robot sending the ball outside the enclosure'],
  fullArea: ['inside-penalty-area', 'Whole-robot entry'],
  multiple: [
    'inside-penalty-area',
    'Multiple defense and farther-robot relocation',
  ],
  repeated: [
    'inside-penalty-area',
    'Discretion after repeated multiple defense',
  ],
  pushing: ['inside-penalty-area', 'Pushing conditions and ball relocation'],
  pushingGoal: ['inside-penalty-area', 'Goals resulting from pushing'],
  order: ['inside-penalty-area', 'Pushing before multiple defense'],
  progress: ['lack-of-progress', 'Stalemate, count and neutral placement'],
  out: ['out-of-bounds', 'Removal and waiting period'],
  outGoal: [
    'out-of-bounds',
    'Scoring while the penalized robot remains on field',
  ],
  outReturn: ['out-of-bounds', 'Return position and direction'],
  pushed: ['out-of-bounds', 'Opponent-caused contact: discretionary waiver'],
  damage: ['damaged-robots', 'Repair, waiting period and referee permission'],
  waitingGoal: [
    'damaged-robots',
    'Both robots damaged at kickoff; opponent exception',
  ],
  human: ['human-interference', 'Team intervention requires permission'],
  unstick: [
    'human-interference',
    'Limited referee assistance for entanglement',
  ],
  interruption: [
    'interruption-of-game-ref-interruption',
    'Stopping and choosing how play resumes',
  ],
  spectator: ['robots-interference', 'Suspected spectator interference'],
  marker: ['top-markers', 'Required marker and eligibility'],
  compliance: ['violations', 'Eligibility after a specification violation'],
  referee: ['referees', 'Referee decisions under the rules'],
} as const;
type Provision = keyof typeof provisions;

function reference(key: Provision): AppliedRule {
  const [anchor, provision] = provisions[key];
  const section = RULE_SECTIONS.find(
    (item) => item.document === 'soccer' && item.anchor === anchor,
  )!;
  return {
    id: key,
    sectionId: section.id,
    document: 'Soccer rules 2026',
    number: section.number,
    title: section.title,
    provision,
    url: sectionUrl(section),
    lessonUrl: `?mode=rules&rule=${encodeURIComponent(section.id)}`,
    ...(key === 'multiple'
      ? { quote: 'at least partially in a penalty area' }
      : {}),
  };
}
function penaltyLine(): AppliedRule {
  const section = RULE_SECTIONS.find(
    (item) => item.id === 'field:penalty-areas',
  )!;
  return {
    id: 'penalty-line',
    sectionId: section.id,
    document: RULE_DOCUMENTS.find((item) => item.id === 'field')!.title,
    number: section.number,
    title: section.title,
    provision: 'White boundary marking',
    quote: 'The line is part of the area.',
    note: 'Body overlap onto the stripe counts as partial entry. One partial robot alone does not establish multiple defense.',
    url: sectionUrl(section),
    lessonUrl: `?mode=rules&rule=${encodeURIComponent(section.id)}`,
  };
}

/** Call-specific references are captured before the correction changes the scene. */
export function rulesForDecision(
  item: RefereeCase,
  action: RefereeAction,
  context: { kickoffDue?: boolean; returnReason?: string } = {},
): AppliedRule[] {
  const id = item.id.replace(/^live-/, '');
  let keys: Provision[] = [];
  let line = false;
  switch (action) {
    case 'goal':
      keys =
        id === 'both-damaged'
          ? ['waitingGoal']
          : id === 'pushing-goal'
            ? ['score', 'pushing']
            : ['score'];
      break;
    case 'no-goal':
      keys =
        id === 'out-goal'
          ? ['outGoal']
          : id === 'pushing-goal'
            ? ['pushingGoal']
            : ['score'];
      break;
    case 'out':
      keys =
        id === 'full-area'
          ? ['fullArea', 'out']
          : id === 'pushed-out'
            ? ['out', 'pushed']
            : ['out'];
      line = id === 'full-area';
      break;
    case 'multiple':
      keys = ['multiple'];
      if (id === 'combined' || id === 'pushing-goal') keys.push('order');
      if (id === 'repeat-defense') keys.push('repeated');
      line = true;
      break;
    case 'pushing':
      keys = ['pushing'];
      if (id === 'combined') keys.push('order');
      line = true;
      break;
    case 'damaged':
      keys = id === 'repeat-defense' ? ['repeated', 'damage'] : ['damage'];
      line = id === 'repeat-defense';
      break;
    case 'early-start':
      keys = ['early', 'damage'];
      break;
    case 'ball-out':
      keys = ['ballOut', 'damage'];
      break;
    case 'holding':
      keys = ['holding', 'compliance'];
      break;
    case 'waive-out':
      keys = ['pushed'];
      break;
    case 'return':
    case 'keep-out':
      keys =
        context.returnReason === 'Inspection' ? ['compliance'] : ['damage'];
      if (context.returnReason === 'Out of bounds')
        keys = ['outReturn', 'out', 'damage'];
      if (
        context.returnReason !== 'Inspection' &&
        (context.kickoffDue || id === 'return-kickoff')
      )
        keys.unshift('kickoffReturn');
      break;
    case 'count':
    case 'lack-progress':
      keys = ['progress'];
      break;
    case 'correct-setup':
      keys = ['neutral', 'kickoff'];
      break;
    case 'start':
      keys = ['kickoff'];
      if (
        item.anchor === 'neutral-kickoff' ||
        (!item.anchor && ['setup', 'ready'].includes(id))
      )
        keys.push('neutral');
      break;
    case 'neutral':
      keys = ['interruption', 'neutral', 'kickoff'];
      break;
    case 'pause':
      keys =
        id === 'spectator' ? ['spectator', 'interruption'] : ['interruption'];
      break;
    case 'separate':
      keys = ['unstick'];
      break;
    case 'interference':
      keys = ['human'];
      break;
    case 'wait':
      keys = ['waitingGoal'];
      break;
    case 'void':
      keys = ['capability'];
      break;
    case 'inspect':
      keys = ['marker', 'compliance'];
      break;
    case 'play-on':
    case 'resume':
      if (['deadlock', 'repeat-progress'].includes(id)) keys = ['progress'];
      else if (['multiple', 'repeat-defense', 'combined'].includes(id)) {
        keys = ['multiple'];
        line = true;
      } else if (id === 'partial-area') {
        keys = ['fullArea', 'multiple'];
        line = true;
      } else if (['pushing', 'midfield'].includes(id)) {
        keys = ['pushing'];
        line = true;
      } else if (id === 'post') keys = ['score'];
      else if (id === 'unstick') keys = ['unstick'];
      else if (['interruption', 'spectator'].includes(id))
        keys = ['interruption'];
      else if (item.id === 'dribbler') keys = ['holding'];
      else keys = ['referee']; // A general live whistle has no established infringement.
      break;
  }
  return [...new Set(keys)].map(reference).concat(line ? [penaltyLine()] : []);
}
