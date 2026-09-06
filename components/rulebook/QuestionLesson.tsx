'use client';

import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import type { RuleQuestion } from '@/lib/rulebook/questions';
import type {
  RuleLearningEvent,
  RuleLearningMode,
} from '@/lib/certification/client-types';

/** Text-only evidence for technical checks and match administration. */
export function QuestionLesson({
  item,
  onPassed,
  learningMode = 'practice',
  certificationRunId = null,
  onLearningEvent,
}: {
  item: RuleQuestion;
  onPassed: () => void;
  learningMode?: RuleLearningMode;
  certificationRunId?: string | null;
  onLearningEvent?: (event: RuleLearningEvent) => void | Promise<void>;
}) {
  const { t } = useLocalization();
  const [selected, setSelected] = useState<number | null>(null);
  const attempts = useRef(0);
  const firstAnswer = useRef<number | null>(null);
  const completed = useRef(false);
  const accepted = selected === item.answer;
  const choose = (selectedIndex: number) => {
    if (completed.current) return;
    const attemptNumber = ++attempts.current;
    firstAnswer.current ??= selectedIndex;
    const correct = selectedIndex === item.answer;
    const questionId = `question:${item.id}`;
    setSelected(selectedIndex);
    void onLearningEvent?.({
      type: 'answer',
      mode: learningMode,
      certificationRunId,
      questionId,
      sourceId: item.id,
      kind: 'question',
      decisionId: questionId,
      answer: { kind: 'question', selectedIndex },
      attemptNumber,
      firstAnswer: attemptNumber === 1,
      accepted: correct,
      score: correct ? 1 : 0,
      completed: correct,
      assisted: false,
    });
    if (correct) {
      completed.current = true;
      onPassed();
      void onLearningEvent?.({
        type: 'complete',
        mode: learningMode,
        certificationRunId,
        questionId,
        sourceId: item.id,
        kind: 'question',
        answer: { kind: 'question', selectedIndex: firstAnswer.current },
        firstTryCorrect: firstAnswer.current === item.answer,
        assisted: false,
      });
    }
  };
  return (
    <section className="rule-lab" aria-label={t('Rule knowledge check')}>
      <span className="rule-kicker">
        {t('Knowledge check · no simulated incident')}
      </span>
      <h2>{t(item.title)}</h2>
      <p>{t(item.question)}</p>
      <p className="rule-small">
        {t(
          learningMode === 'certification'
            ? 'Your first choice is recorded for certification. Read all choices before selecting one.'
            : 'Choose an answer to check your understanding. You can retry for practice.',
        )}
      </p>
      <fieldset className="rule-example-list">
        <legend className="sr-only">{t('Answer choices')}</legend>
        {item.options.map((option, index) => (
          <Button
            key={option}
            variant={selected === index ? 'secondary' : 'outline'}
            className="h-auto min-h-11 whitespace-normal justify-start text-left"
            disabled={accepted}
            aria-pressed={selected === index}
            onClick={() => choose(index)}
          >
            <span>{String.fromCharCode(65 + index)}.</span> {t(option)}
          </Button>
        ))}
      </fieldset>
      {selected !== null && (
        <div className="lab-fact" aria-live="polite">
          <h3>
            {accepted ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{' '}
            {t(accepted ? 'Correct answer' : 'Review this answer')}
          </h3>
          <p>{t(item.feedback)}</p>
          {!accepted && (
            <p className="rule-small">
              {t(
                'You may retry to learn; a later correct answer does not replace your first certification choice.',
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
