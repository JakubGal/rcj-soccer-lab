import { RULE_SECTIONS } from './catalog';
import { RULE_CLIPS } from './animations';
import { SCENARIOS } from '../simulator/scenarios';
import {
  REFEREE_CASES,
  ruleUrl,
  type RefereeCall,
} from '../simulator/referee-cases';

export type LearningSituation = {
  id: string;
  sourceId: string;
  kind: 'case' | 'clip' | 'scenario';
  title: string;
  sectionId: string;
};
function sectionFor(url: string) {
  const anchor = url.split('#')[1];
  return RULE_SECTIONS.find(
    (section) => section.document === 'soccer' && section.anchor === anchor,
  )!.id;
}
export const LEARNING_SITUATIONS: LearningSituation[] = [
  ...REFEREE_CASES.map((item) => ({
    id: `case:${item.id}`,
    sourceId: item.id,
    kind: 'case' as const,
    title: item.title,
    sectionId: sectionFor(ruleUrl(item)),
  })),
  ...RULE_CLIPS.map((item) => ({
    id: `clip:${item.id}`,
    sourceId: item.id,
    kind: 'clip' as const,
    title: item.title,
    sectionId: sectionFor(`#${item.anchor}`),
  })),
  ...SCENARIOS.map((item) => ({
    id: `scenario:${item.id}`,
    sourceId: item.id,
    kind: 'scenario' as const,
    title: item.shortTitle,
    sectionId: sectionFor(item.ruleRef.url),
  })),
];
export const LEARNING_PROGRESS_KEY = 'rcj-rule-checks-2026-v1';
export function validLearningProgress(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string =>
              typeof id === 'string' &&
              LEARNING_SITUATIONS.some((item) => item.id === id),
          ),
        ),
      ]
    : [];
}
export function lessonChoices(
  expected: RefereeCall[],
  salt: string,
): RefereeCall[] {
  const key = (call: RefereeCall) => `${call.action}:${call.target ?? ''}`;
  const distractors: RefereeCall[] = expected.flatMap((call) =>
    call.target
      ? [
          {
            action: call.action,
            target: call.target.includes('-')
              ? `${call.target.split('-')[0]}-${call.target.endsWith('1') ? 2 : 1}`
              : call.target === 'blue'
                ? 'yellow'
                : 'blue',
          },
        ]
      : [],
  );
  distractors.push(
    { action: 'play-on' },
    { action: 'out', target: 'blue-1' },
    { action: 'pushing' },
    { action: 'multiple', target: 'blue-2' },
    { action: 'count' },
    { action: 'neutral' },
  );
  const choices = [...expected];
  for (const choice of distractors)
    if (
      choices.length < 4 &&
      !choices.some((existing) => key(existing) === key(choice))
    )
      choices.push(choice);
  const offset =
    salt.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    choices.length;
  return [...choices.slice(offset), ...choices.slice(0, offset)];
}
