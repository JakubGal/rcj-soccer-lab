import { TRAINING_TOPICS } from '@/lib/simulator/referee-training';

export const CERTIFICATION_POLICY = {
  policyVersion: 'rcj-soccer-2026-v1',
  rulesetVersion: 'rcj-soccer-rules-2026',
  engineVersion: 'referee-match-2026-v1',
  ruleQuestionCount: 73,
  ruleFirstTryPercent: 95,
  ruleFirstTryRequired: 70,
  topics: TRAINING_TOPICS.map((topic) => topic.id),
  games: {
    step: {
      durationSeconds: 600,
      requiredQualifying: 5,
      maxAttempts: 8,
      minimumAccuracy: 90,
    },
    continuous: {
      durationSeconds: 600,
      requiredQualifying: 2,
      maxAttempts: 5,
      minimumAccuracy: 80,
    },
  },
} as const;

export type CertificationMode = keyof typeof CERTIFICATION_POLICY.games;
export type GamePurpose = 'practice' | 'certification';

export function isCertificationMode(
  value: unknown,
): value is CertificationMode {
  return value === 'step' || value === 'continuous';
}
