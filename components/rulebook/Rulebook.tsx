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

const DEFAULT_SECTION = 'soccer:inside-penalty-area';
const PROGRESS_KEY = 'rcj-rulebook-read-2026-06-03-v1';

export function Rulebook({ robotVisual }: { robotVisual: RobotVisualId }) {
  const [selectedId, setSelectedId] = useState(DEFAULT_SECTION);
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
    () => findSections(query, document.id),
    [document.id, query],
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
      const requested = new URLSearchParams(window.location.search).get('rule');
      if (
        requested &&
        RULE_SECTIONS.some((section) => section.id === requested)
      )
        setSelectedId(requested);
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
    } catch {
      /* Session-only progress is still usable. */
    }
  }, [restored, reviewed]);

  const select = useCallback((section: RuleSection) => {
    setSelectedId(section.id);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'rules');
    url.searchParams.set('rule', section.id);
    window.history.replaceState(null, '', url);
  }, []);
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

  return (
    <div className="rulebook-shell">
      <aside className="rulebook-nav" aria-label="Complete rulebook contents">
        <div className="rulebook-nav-top">
          <p className="rule-kicker">RULEBOOK / 2026</p>
          <NativeSelect
            aria-label="Official rule document"
            value={document.id}
            onChange={(event) => selectDocument(event.target.value)}
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
              placeholder="Find a section or rule number"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="rule-reading-progress">
            <span>
              {readCount} / {documentSections.length} reviewed
            </span>
            <Progress
              value={(readCount / documentSections.length) * 100}
              aria-label="Reading progress in this document"
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
              disabled={documentIndex <= 0}
              onClick={() => select(documentSections[documentIndex - 1])}
            >
              <ArrowLeft />
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={documentIndex >= documentSections.length - 1}
              onClick={() => select(documentSections[documentIndex + 1])}
            >
              Next
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
                text.
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
                  Interactive guide
                </span>
                {guide === 'animation' && (
                  <small>{clips.length} examples</small>
                )}
              </div>
              <div className="rule-guide-scroll">
                {guide === 'animation' && clips.length > 0 && (
                  <RuleAnimationPlayer
                    key={selected.anchor}
                    clips={clips}
                    robotVisual={robotVisual}
                  />
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
