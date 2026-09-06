import type { RefereeCase } from './referee-cases';

export const TRAINING_TOPICS = [
  { id: 'out', label: 'Out of bounds' },
  { id: 'damage', label: 'Damaged robots' },
  { id: 'multiple', label: 'Multiple defense' },
  { id: 'pushing', label: 'Pushing' },
  { id: 'progress', label: 'Lack of progress' },
  { id: 'scoring', label: 'Goals' },
  { id: 'other', label: 'Restarts, returns & other rules' },
] as const;
export type TrainingTopic = (typeof TRAINING_TOPICS)[number]['id'];
export type TrainingMode = 'step' | 'continuous';
export type Assessment = 'correct' | 'wrong' | 'missed' | 'assisted';
export function trainingTopic(definition: RefereeCase): TrainingTopic {
  const id = definition.id.replace(/^live-/, '');
  if (['wall', 'full-area', 'pushed-out'].includes(id)) return 'out';
  if (['damaged', 'both-damaged', 'damage-exception'].includes(id))
    return 'damage';
  if (['multiple', 'repeat-defense', 'combined'].includes(id))
    return 'multiple';
  if (id.includes('pushing')) return 'pushing';
  if (['deadlock', 'repeat-progress'].includes(id)) return 'progress';
  if (['goal', 'own-goal', 'out-goal', 'post'].includes(id)) return 'scoring';
  return 'other';
}

/** One terminal result per incident, independent of retries and the display log. */
export class RefereeScore {
  private results = new Map<
    number,
    { topic: TrainingTopic; result: Assessment; title: string }
  >();
  record(id: number, topic: TrainingTopic, result: Assessment, title: string) {
    if (!this.results.has(id)) this.results.set(id, { topic, result, title });
  }
  has(id: number) {
    return this.results.has(id);
  }
  snapshot() {
    const entries = [...this.results.values()];
    const summarize = (rows: typeof entries) => {
      const correct = rows.filter((x) => x.result === 'correct').length;
      const wrong = rows.filter((x) => x.result === 'wrong').length;
      const missed = rows.filter((x) => x.result === 'missed').length;
      const assisted = rows.filter((x) => x.result === 'assisted').length;
      const assessed = correct + wrong + missed;
      return {
        correct,
        wrong,
        missed,
        assisted,
        assessed,
        accuracy: assessed ? Math.round((100 * correct) / assessed) : null,
      };
    };
    return {
      ...summarize(entries),
      topics: TRAINING_TOPICS.map((topic) => ({
        ...topic,
        ...summarize(entries.filter((row) => row.topic === topic.id)),
      })),
      entries: entries.map((row) => ({ ...row })),
    };
  }
}
