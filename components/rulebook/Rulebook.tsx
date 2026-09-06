'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Film,
  Search,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import {
  RULE_DOCUMENTS,
  RULE_SECTIONS,
  RULEBOOK_CHECKED_ON,
  findSections,
  guideFor,
  sectionUrl,
  type RuleSection,
} from '@/lib/rulebook/catalog';
import { clipsFor, RULE_CLIPS } from '@/lib/rulebook/animations';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import { InspectionWorkbench } from './InspectionWorkbench';
import { RuleAnimationPlayer } from './RuleAnimationPlayer';
import {
  BallWorkbench,
  CompanionWorkbench,
  DecisionWorkbench,
  FieldWorkbench,
  KickerWorkbench,
  ReadinessWorkbench,
  ScoringWorkbench,
} from './RuleLabs';
import { cn } from '@/lib/utils';
import {
  LEARNING_SITUATIONS,
  LEARNING_PROGRESS_KEY,
  validLearningProgress,
} from '@/lib/rulebook/learning';
import { REFEREE_CASES } from '@/lib/simulator/referee-cases';
import { SCENARIOS } from '@/lib/simulator/scenarios';
import { CaseLesson } from './CaseLesson';
import { ScenarioLesson } from './ScenarioLesson';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import { translateText } from '@/lib/i18n';

const DEFAULT_SECTION = 'soccer:inside-penalty-area';
const PROGRESS_KEY = 'rcj-rulebook-read-2026-06-03-v1';

export function Rulebook({
  robotVisual,
  active = true,
  sectionId = DEFAULT_SECTION,
  situationId = null,
  onSelect,
}: {
  robotVisual: RobotVisualId;
  active?: boolean;
  sectionId?: string;
  situationId?: string | null;
  onSelect: (sectionId: string, situationId: string | null) => void;
}) {
  const { locale } = useLocalization();
  const requestedSituation = LEARNING_SITUATIONS.find(
    (item) => item.id === situationId,
  );
  const selectedId = requestedSituation?.sectionId ?? sectionId;
  const [library, setLibrary] = useState<'situations' | 'sections'>(
    'situations',
  );
  const [passed, setPassed] = useState<string[]>([]);
  const [studyAnswers, setStudyAnswers] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'split' | 'text' | 'visual'>('split');
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const selected =
    RULE_SECTIONS.find((section) => section.id === selectedId) ??
    RULE_SECTIONS[0];
  const document = RULE_DOCUMENTS.find(
    (item) => item.id === selected.document,
  )!;
  const guide = guideFor(selected);
  const matches = useMemo(
    () =>
      findSections(query, document.id, (value) => translateText(value, locale)),
    [document.id, locale, query],
  );
  const documentSections = RULE_SECTIONS.filter(
    (section) => section.document === document.id,
  );
  const documentIndex = documentSections.findIndex(
    (section) => section.id === selected.id,
  );
  const readCount = documentSections.filter((section) =>
    reviewed.includes(section.id),
  ).length;
  const clips = useMemo(() => clipsFor(selected.anchor), [selected.anchor]);
  const sourceUrl = sectionUrl(selected);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        setPassed(
          validLearningProgress(
            JSON.parse(localStorage.getItem(LEARNING_PROGRESS_KEY) ?? '[]'),
          ),
        );
      } catch {
        /* Invalid quiz progress must not prevent restoring reading progress. */
      }
      try {
        const saved: unknown = JSON.parse(
          localStorage.getItem(PROGRESS_KEY) ?? '[]',
        );
        if (Array.isArray(saved))
          setReviewed(
            saved.filter(
              (id): id is string =>
                typeof id === 'string' &&
                RULE_SECTIONS.some((section) => section.id === id),
            ),
          );
      } catch {
        /* Reading remains available when local storage is disabled. */
      }
      setRestored(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(reviewed));
      localStorage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify(passed));
    } catch {
      /* Session-only progress is still usable. */
    }
  }, [restored, reviewed, passed]);

  const select = useCallback(
    (section: RuleSection) => {
      onSelect(section.id, null);
    },
    [onSelect],
  );
  const selectDocument = useCallback(
    (id: string) => {
      const first = RULE_SECTIONS.find((section) => section.document === id);
      if (first) {
        select(first);
        setQuery('');
      }
    },
    [select],
  );
  const onRule = useCallback(
    (documentId: string, anchor: string) => {
      const section = RULE_SECTIONS.find(
        (item) => item.document === documentId && item.anchor === anchor,
      );
      if (section) {
        select(section);
        setQuery('');
      }
    },
    [select],
  );
  const sectionSituations = LEARNING_SITUATIONS.filter(
    (item) => item.sectionId === selected.id,
  );
  const situation =
    requestedSituation ??
    sectionSituations.find((item) => item.kind === 'case') ??
    sectionSituations[0];
  const chooseSituation = (id: string) => {
    const item = LEARNING_SITUATIONS.find((item) => item.id === id)!;
    onSelect(item.sectionId, item.id);
  };
  const passSituation = () => {
    if (situation)
      setPassed((current) => [...new Set([...current, situation.id])]);
  };
  const filteredSituations = LEARNING_SITUATIONS.filter((item) => {
    const section = RULE_SECTIONS.find(
      (section) => section.id === item.sectionId,
    )!;
    return (
      !query ||
      (
        item.title +
        ' ' +
        translateText(item.title, locale) +
        ' ' +
        section.title +
        ' ' +
        translateText(section.title, locale) +
        ' ' +
        section.number
      )
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  const situationIndex = filteredSituations.findIndex(
    (item) => item.id === situation?.id,
  );
  const navigatingSituations = library === 'situations' && situationIndex >= 0;
  const studyResults = SCENARIOS.flatMap((item) => {
    const answer = item.choices.find(
      (choice) => choice.id === studyAnswers[item.id],
    );
    return answer ? [answer.score] : [];
  });
  const studyScore = studyResults.length
    ? `Detailed study score: ${Math.round((studyResults.reduce((sum, score) => sum + score, 0) / studyResults.length) * 100)}% · ${studyResults.length} / ${SCENARIOS.length} studies answered this session`
    : undefined;
  const onSoccerRule = useCallback(
    (anchor: string) => onRule('soccer', anchor),
    [onRule],
  );

  const overview = (
    <section className="rule-lab">
      <h2>Choose something to explore</h2>
      <div className="rule-starting-points">
        <Button
          variant="outline"
          onClick={() => onSoccerRule('inside-penalty-area')}
        >
          <Film />
          <span>
            Pushing & multiple defense
            <small>Five contrasting animated examples</small>
          </span>
          <ArrowRight />
        </Button>
        <Button
          variant="outline"
          onClick={() => onSoccerRule('regulations-inspections')}
        >
          <Wrench />
          <span>
            Technical inspection<small>Measurements and practical checks</small>
          </span>
          <ArrowRight />
        </Button>
        <Button
          variant="outline"
          onClick={() => onSoccerRule('kicker-power-measuring')}
        >
          <Film />
          <span>
            Kicker test<small>Change the rebound and replay</small>
          </span>
          <ArrowRight />
        </Button>
        <Button variant="outline" onClick={() => selectDocument('field')}>
          <BookOpen />
          <span>
            Field specification<small>Dimensions and placement geometry</small>
          </span>
          <ArrowRight />
        </Button>
      </div>
      <p className="rule-small">
        The complete documents remain available in the official-text pane. The
        animations and workbenches are companion learning aids.
      </p>
    </section>
  );

  if (!active) return null;
  return (
    <div className="rulebook-shell">
      <aside className="rulebook-nav" aria-label="Complete rulebook contents">
        <div className="rulebook-nav-top">
          <p className="rule-kicker">RULES & SITUATIONS / 2026</p>
          <div className="learning-library-switch">
            <Button
              size="sm"
              variant={library === 'situations' ? 'secondary' : 'ghost'}
              onClick={() => setLibrary('situations')}
            >
              Situations
            </Button>
            <Button
              size="sm"
              variant={library === 'sections' ? 'secondary' : 'ghost'}
              onClick={() => setLibrary('sections')}
            >
              All rules
            </Button>
          </div>
          <NativeSelect
            aria-label="Official rule document"
            value={document.id}
            onChange={(event) => {
              setLibrary('sections');
              selectDocument(event.target.value);
            }}
          >
            {RULE_DOCUMENTS.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="rule-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="Search rule sections and numbers"
              placeholder="Find a situation or rule number"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="rule-reading-progress">
            <span>
              {library === 'situations'
                ? `${passed.length} / ${LEARNING_SITUATIONS.length} checks passed`
                : `${readCount} / ${documentSections.length} reviewed`}
            </span>
            <Progress
              value={
                library === 'situations'
                  ? (passed.length / LEARNING_SITUATIONS.length) * 100
                  : (readCount / documentSections.length) * 100
              }
              aria-label={
                library === 'situations'
                  ? 'Situation checks passed'
                  : 'Reading progress in this document'
              }
            />
          </div>
        </div>
        <nav
          className="rulebook-toc"
          aria-label={
            query
              ? 'Rule search results across all documents'
              : `${document.title} sections`
          }
        >
          {library === 'situations' && (
            <>
              {filteredSituations.map((item) => {
                const section = RULE_SECTIONS.find(
                  (section) => section.id === item.sectionId,
                )!;
                return (
                  <button
                    key={item.id}
                    className={cn(
                      'rule-toc-item',
                      situation?.id === item.id && 'rule-toc-active',
                    )}
                    aria-current={
                      situation?.id === item.id ? 'page' : undefined
                    }
                    onClick={() => chooseSituation(item.id)}
                  >
                    <span className="rule-toc-number">
                      {passed.includes(item.id) ? (
                        <Check aria-label="Check passed" />
                      ) : (
                        section.number
                      )}
                    </span>
                    <span>
                      {item.title}
                      <small>
                        {item.kind === 'case'
                          ? 'Referee decisions'
                          : item.kind === 'scenario'
                            ? 'Explore & judge'
                            : 'Replay & question'}{' '}
                        · §{section.number}
                      </small>
                    </span>
                  </button>
                );
              })}
              {!filteredSituations.length && (
                <p className="rule-small">
                  No matching situation. Use All rules to search every
                  paragraph.
                </p>
              )}
            </>
          )}
          {library === 'sections' && (
            <>
              {query && (
                <p className="rule-small">
                  {matches.length} matches across all documents
                </p>
              )}
              {matches.map((section) => (
                <button
                  key={section.id}
                  className={cn(
                    'rule-toc-item',
                    selected.id === section.id && 'rule-toc-active',
                    section.depth === 0 && 'rule-toc-chapter',
                  )}
                  onClick={() => select(section)}
                  aria-current={selected.id === section.id ? 'page' : undefined}
                  style={{
                    paddingLeft: `${12 + Math.min(2, section.depth) * 9}px`,
                  }}
                >
                  <span className="rule-toc-number">
                    {reviewed.includes(section.id) ? (
                      <Check aria-label="Reviewed" />
                    ) : (
                      section.number || '•'
                    )}
                  </span>
                  <span>
                    {section.title}
                    {query && (
                      <small>
                        {
                          RULE_DOCUMENTS.find(
                            (item) => item.id === section.document,
                          )?.title
                        }
                      </small>
                    )}
                  </span>
                </button>
              ))}
              {!matches.length && (
                <div className="rule-no-results">
                  <p>No matching section.</p>
                  <Button variant="ghost" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                </div>
              )}
            </>
          )}
        </nav>
        <div className="rulebook-nav-footer">
          <span>{RULE_DOCUMENTS.length} full official documents</span>
          <small>Index checked {RULEBOOK_CHECKED_ON}</small>
          <a
            href="https://robocup.org/conduct"
            target="_blank"
            rel="noreferrer"
          >
            Federation conduct policy <ExternalLink />
          </a>
        </div>
      </aside>

      <section
        className="rulebook-main"
        aria-label="Interactive rulebook section"
      >
        <header className="rule-section-heading">
          <div>
            <p className="rule-kicker">
              {document.title} / Indexed revision {document.revision}
            </p>
            <h1>
              {selected.number && <span>{selected.number}</span>}
              {selected.title}
            </h1>
          </div>
          <label htmlFor="rule-reviewed" className="rule-reviewed">
            <Checkbox
              id="rule-reviewed"
              checked={reviewed.includes(selected.id)}
              onCheckedChange={(checked) =>
                setReviewed((current) =>
                  checked
                    ? [...new Set([...current, selected.id])]
                    : current.filter((id) => id !== selected.id),
                )
              }
            />
            Reviewed
          </label>
        </header>
        <div className="rule-section-toolbar">
          <div>
            <Button
              size="sm"
              variant="ghost"
              disabled={
                navigatingSituations ? situationIndex <= 0 : documentIndex <= 0
              }
              onClick={() =>
                navigatingSituations
                  ? chooseSituation(filteredSituations[situationIndex - 1].id)
                  : select(documentSections[documentIndex - 1])
              }
            >
              <ArrowLeft />
              {navigatingSituations ? 'Previous situation' : 'Previous rule'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={
                navigatingSituations
                  ? situationIndex >= filteredSituations.length - 1
                  : documentIndex >= documentSections.length - 1
              }
              onClick={() =>
                navigatingSituations
                  ? chooseSituation(filteredSituations[situationIndex + 1].id)
                  : select(documentSections[documentIndex + 1])
              }
            >
              {navigatingSituations ? 'Next situation' : 'Next rule'}
              <ArrowRight />
            </Button>
          </div>
          <NativeSelect
            size="sm"
            value={layout}
            onChange={(event) => setLayout(event.target.value as typeof layout)}
            aria-label="Rulebook reading layout"
          >
            <NativeSelectOption value="split">
              Text + interactive guide
            </NativeSelectOption>
            <NativeSelectOption value="text">
              Full-width official text
            </NativeSelectOption>
            <NativeSelectOption value="visual">
              Interactive guide
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <div className={cn('rule-reading-layout', `rule-layout-${layout}`)}>
          {layout !== 'visual' && (
            <section
              className="rule-source-pane"
              aria-label="Complete official rule text"
            >
              <div className="rule-pane-label">
                <span>
                  <BookOpen />
                  Official text · live source
                </span>
                <small>Official English source</small>
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  Open original <ExternalLink />
                </a>
              </div>
              <iframe
                key={document.id}
                src={sourceUrl}
                title={`Complete official ${document.title}: ${selected.title}`}
                referrerPolicy="no-referrer"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
              />
              <p className="rule-source-footer">
                All paragraphs, tables, notes and appendices are in this
                original document. Internet access is needed for the official
                text. Translations in this app are learning aids; the official
                English source controls.
              </p>
            </section>
          )}
          {layout !== 'text' && (
            <section
              className="rule-guide-pane"
              aria-label="Interactive companion guide"
            >
              <div className="rule-pane-label">
                <span>
                  {guide === 'animation' || guide === 'kicker' ? (
                    <Film />
                  ) : (
                    <Wrench />
                  )}
                  Situation & checking questions
                </span>
                {guide === 'animation' && (
                  <small>{clips.length} examples</small>
                )}
              </div>
              <div className="rule-guide-scroll">
                {sectionSituations.length > 0 && (
                  <section className="learning-situation-picker">
                    <label htmlFor="learning-situation">
                      Situations for this rule
                    </label>
                    <NativeSelect
                      id="learning-situation"
                      value={situation?.id ?? ''}
                      onChange={(event) => chooseSituation(event.target.value)}
                    >
                      {sectionSituations.map((item) => (
                        <NativeSelectOption key={item.id} value={item.id}>
                          {passed.includes(item.id) ? '✓ ' : ''}
                          {item.title} ·{' '}
                          {item.kind === 'case'
                            ? 'decision practice'
                            : item.kind === 'scenario'
                              ? 'detailed study'
                              : 'guided replay'}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <p>
                      {
                        sectionSituations.filter((item) =>
                          passed.includes(item.id),
                        ).length
                      }{' '}
                      / {sectionSituations.length} situation checks passed ·{' '}
                      {sectionSituations.every((item) =>
                        passed.includes(item.id),
                      )
                        ? 'All checks complete'
                        : 'Answer each situation to check your understanding'}
                    </p>
                  </section>
                )}
                {situation?.kind === 'case' && (
                  <CaseLesson
                    key={situation.id}
                    item={REFEREE_CASES.find(
                      (item) => item.id === situation.sourceId,
                    )!}
                    robotVisual={robotVisual}
                    onPassed={passSituation}
                  />
                )}
                {situation?.kind === 'scenario' && (
                  <ScenarioLesson
                    key={situation.id}
                    scenario={SCENARIOS.find(
                      (item) => item.id === situation.sourceId,
                    )!}
                    initialAnswer={studyAnswers[situation.sourceId]}
                    onAnswer={(id) =>
                      setStudyAnswers((current) => ({
                        ...current,
                        [situation.sourceId]: id,
                      }))
                    }
                    studyScore={studyScore}
                    robotVisual={robotVisual}
                    onPassed={passSituation}
                  />
                )}
                {situation?.kind === 'clip' && (
                  <RuleAnimationPlayer
                    key={situation.id}
                    clips={[
                      RULE_CLIPS.find(
                        (item) => item.id === situation.sourceId,
                      )!,
                    ]}
                    robotVisual={robotVisual}
                    onPassed={passSituation}
                  />
                )}
                {guide === 'animation' && !situation && clips.length > 0 && (
                  <div className="rule-example-list">
                    {clips.map((clip) => (
                      <Button
                        key={clip.id}
                        variant="outline"
                        onClick={() => chooseSituation(`clip:${clip.id}`)}
                      >
                        {clip.title}
                      </Button>
                    ))}
                  </div>
                )}
                {guide === 'inspection' && (
                  <InspectionWorkbench onRule={onSoccerRule} />
                )}
                {guide === 'kicker' && (
                  <KickerWorkbench robotVisual={robotVisual} />
                )}
                {guide === 'field' && <FieldWorkbench onRule={onRule} />}
                {guide === 'ball' && <BallWorkbench />}
                {guide === 'scoring' && <ScoringWorkbench />}
                {(
                  [
                    'team',
                    'documentation',
                    'competition',
                    'conduct',
                  ] as string[]
                ).includes(guide) && (
                  <ReadinessWorkbench
                    key={guide}
                    category={
                      guide as
                        | 'team'
                        | 'documentation'
                        | 'competition'
                        | 'conduct'
                    }
                  />
                )}
                {guide === 'decision' && <DecisionWorkbench />}
                {guide === 'companion' && (
                  <CompanionWorkbench
                    key={document.id}
                    document={document.id as 'entry' | 'superteam'}
                    onDocument={selectDocument}
                  />
                )}
                {guide === 'overview' && overview}
                {selected.anchor === 'robots-control' && (
                  <p className="rule-source-note">
                    Manual Play mode is a practice tool. Competition robots
                    operate autonomously.
                  </p>
                )}
                <div className="rule-guide-footnote">
                  <BookOpen />
                  <span>
                    {RULE_CLIPS.length} authored gameplay examples across the
                    main gameplay chapter. Complete rule coverage comes from the
                    official documents; local amendments must be checked with
                    your event.
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
