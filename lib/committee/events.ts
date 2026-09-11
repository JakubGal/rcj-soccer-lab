import {
  CHARACTERS,
  DIALOGUE,
  type CommitteeCharacterId,
  type CommitteeDialogue,
  type CommitteeOutcome,
  type CommitteeTopic,
} from './catalog';

export const COMMITTEE_EVENT_NAME = 'rcj-committee-feedback-v1';
export const COMMITTEE_RESET_EVENT_NAME = 'rcj-committee-reset-v1';

export type CommitteeEvent = {
  id: string;
  surface: 'rules' | 'referee' | 'play';
  context: 'practice' | 'certification' | 'continuous' | 'review';
  outcome: CommitteeOutcome;
  topic: CommitteeTopic;
};

export type CommitteeHistory = {
  appearances: Partial<Record<CommitteeCharacterId, number>>;
  turns: Partial<Record<CommitteeCharacterId, number>>;
  lines: string[];
  lastCharacter: CommitteeCharacterId | null;
};

export function createCommitteeHistory(): CommitteeHistory {
  return { appearances: {}, turns: {}, lines: [], lastCharacter: null };
}

/** Text is used only to select a theme, never to determine a rule verdict. */
export function committeeTopic(text: string): CommitteeTopic {
  // Rule anchors use both hyphens and underscores. Treat them as word
  // separators so "out" cannot accidentally match "without" or "layout".
  const words = text.replace(/[_-]+/g, ' ');
  if (/waive|pushed\s+out/i.test(words)) return 'pushed-out';
  if (/own\s+goal/i.test(words)) return 'own-goal';
  if (/damag|non\s+responsive|repair/i.test(words)) return 'damaged';
  if (/interference|intervention|spectator|audience/i.test(words))
    return 'interference';
  // Penalty-area rules also cover legal overlap, pushing and multiple defense;
  // the area alone must not be classified as an out-of-bounds situation.
  if (/\b(?:out|walls?)\b/i.test(words)) return 'out';
  if (/goal|scor/i.test(words)) return 'goal';
  if (
    /\b(?:kick\s*off|restart|resume|return|early\s+start|start|pause|interruption)\b/i.test(
      words,
    )
  )
    return 'restart';
  if (/progress|count|stall|stuck/i.test(words)) return 'progress';
  if (
    /technical|inspect|ball|radio|module|communicat|kicker|infrared|\bdimensions?\b|\bhandle\b|\btop\s+markers?\b|\bsafety\b|\bpower\b/i.test(
      words,
    )
  )
    return 'technical';
  return 'general';
}

export function isCommitteeEvent(value: unknown): value is CommitteeEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as CommitteeEvent;
  return (
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    event.id.length <= 256 &&
    ['rules', 'referee', 'play'].includes(event.surface) &&
    ['practice', 'certification', 'continuous', 'review'].includes(
      event.context,
    ) &&
    ['correct', 'retry', 'recorded', 'study', 'complete'].includes(
      event.outcome,
    ) &&
    [
      'out',
      'damaged',
      'goal',
      'own-goal',
      'pushed-out',
      'restart',
      'technical',
      'interference',
      'progress',
      'general',
    ].includes(event.topic)
  );
}

/** Fire-and-forget cosmetics must never interrupt a saved answer or referee call. */
export function emitCommitteeEvent(event: CommitteeEvent): void {
  try {
    if (typeof window !== 'undefined' && isCommitteeEvent(event))
      window.dispatchEvent(
        new CustomEvent(COMMITTEE_EVENT_NAME, { detail: event }),
      );
  } catch {
    // Lessons, replay evidence and scoring do not depend on this optional UI.
  }
}

/** Clear cosmetic feedback when the learner leaves its originating session. */
export function emitCommitteeReset(surface: CommitteeEvent['surface']): void {
  try {
    if (
      typeof window !== 'undefined' &&
      ['rules', 'referee', 'play'].includes(surface)
    )
      window.dispatchEvent(
        new CustomEvent(COMMITTEE_RESET_EVENT_NAME, { detail: { surface } }),
      );
  } catch {
    // Changing sessions must never depend on an optional character listener.
  }
}

const specialists: Partial<Record<CommitteeTopic, CommitteeCharacterId>> = {
  out: 'marek',
  damaged: 'isa',
  'own-goal': 'will',
  'pushed-out': 'david',
  restart: 'david',
  technical: 'jakub',
  interference: 'caroline',
  progress: 'tom',
  goal: 'finance',
};

/**
 * Rotation is cosmetic and deterministic, independent from match randomness.
 * Damage belongs to Isa; other specialists get a small preference, not a
 * monopoly. A general event always gives the least-seen available person a turn.
 */
export function selectCommitteeDialogue(
  event: CommitteeEvent,
  history: CommitteeHistory,
) {
  if (!isCommitteeEvent(event) || event.context === 'review') return null;
  // No answer-derived lines in exams or during live continuous observation.
  if (event.context === 'certification' && event.outcome !== 'recorded')
    return null;
  if (
    event.context === 'continuous' &&
    event.outcome !== 'recorded' &&
    event.outcome !== 'complete'
  )
    return null;

  const neutral =
    event.context === 'certification' || event.outcome === 'recorded';
  const topic = neutral ? 'general' : event.topic;
  const outcome = neutral ? 'recorded' : event.outcome;
  const candidates = DIALOGUE.filter(
    (line) =>
      line.outcomes.includes(outcome) &&
      (line.topic === topic || line.topic === 'general'),
  );
  const available = CHARACTERS.filter((character) =>
    candidates.some((line) => line.character === character.id),
  );
  if (!available.length) return null;
  const count = (id: CommitteeCharacterId) => history.turns[id] ?? 0;
  const preferred = specialists[event.topic];
  const ranked = [...available].sort((a, b) => {
    if (event.topic === 'damaged') {
      if (a.id === 'isa') return -1;
      if (b.id === 'isa') return 1;
    }
    const score = (id: CommitteeCharacterId) =>
      count(id) -
      (id === preferred ? 0.5 : 0) +
      (id === history.lastCharacter ? 0.25 : 0);
    return score(a.id) - score(b.id);
  });
  const character = ranked[0];
  const choices = candidates.filter((line) => line.character === character.id);
  const recency = (line: CommitteeDialogue) =>
    history.lines.lastIndexOf(line.id);
  choices.sort((a, b) => {
    const unusedA = recency(a) < 0;
    const unusedB = recency(b) < 0;
    if (unusedA !== unusedB) return unusedA ? -1 : 1;
    if (a.topic !== b.topic) return a.topic === topic ? -1 : 1;
    return recency(a) - recency(b);
  });
  const dialogue = choices[0];
  const characters =
    character.id === 'jakub'
      ? [character, CHARACTERS.find((person) => person.id === 'caroline')!]
      : [character];
  const appearances = { ...history.appearances };
  for (const person of characters)
    appearances[person.id] = (appearances[person.id] ?? 0) + 1;
  return {
    dialogue,
    characters,
    history: {
      appearances,
      turns: { ...history.turns, [character.id]: count(character.id) + 1 },
      lines: [...history.lines, dialogue.id].slice(-96),
      lastCharacter: character.id,
    } satisfies CommitteeHistory,
  };
}
