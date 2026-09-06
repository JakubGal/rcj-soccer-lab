'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CircleDot,
  Gamepad2,
  GraduationCap,
  Languages,
  Scale,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Rulebook } from '@/components/rulebook/Rulebook';
import { MatchPlay } from './MatchPlay';
import { RefereePlay } from './RefereePlay';
import { ScenarioLesson } from '@/components/rulebook/ScenarioLesson';
import { SCENARIOS } from '@/lib/simulator/scenarios';
import {
  DEFAULT_ROBOT_VISUAL_ID,
  ROBOT_VISUALS,
  isRobotVisualId,
  type RobotVisualId,
} from '@/lib/simulator/robot-models';
import {
  INITIAL_NAVIGATION,
  readNavigation,
  navigationSearch,
  type AppMode,
  type AppNavigation,
} from '@/lib/simulator/navigation';
import { LOCALE_OPTIONS, appendLocaleToSearch, type Locale } from '@/lib/i18n';
import { useLocalization } from '@/components/i18n/LocalizationProvider';
import { AccountMenu, AcademyHub, useAccount } from '@/components/account';
import type { CertificationGameLaunch } from '@/lib/account';
import type { RefereeCertificationBridge } from '@/lib/certification/client-types';
import { LEARNING_SITUATIONS } from '@/lib/rulebook/learning';
import type { MatchReplay } from '@/lib/certification/replay';

const tabs = [
  { id: 'rules', label: 'Rules', icon: BookOpen },
  { id: 'play', label: 'Play', icon: Gamepad2 },
  { id: 'referee', label: 'Referee', icon: Scale },
  { id: 'academy', label: 'Academy', icon: GraduationCap },
] as const;

export function SimulatorApp() {
  const { locale, setLocale } = useLocalization();
  const {
    account,
    beginCertificationGame,
    completeCertificationGame,
    saveCertificationCheckpoint,
    practiceRuleLearningBridge,
    certificationRuleLearningBridge,
    practiceTrackingBridge,
  } = useAccount();
  const [nav, setNav] = useState(INITIAL_NAVIGATION);
  const [visited, setVisited] = useState<AppMode[]>(['rules']);
  const [robotVisual, setRobotVisual] = useState<RobotVisualId>(
    DEFAULT_ROBOT_VISUAL_ID,
  );
  const [certificationLaunch, setCertificationLaunch] =
    useState<CertificationGameLaunch | null>(null);
  const [savedReview, setSavedReview] = useState<{
    id: string;
    replay: MatchReplay;
  } | null>(null);
  const certificationRound = account?.certification ?? null;
  useEffect(() => {
    const restore = () => {
      const next = readNavigation(window.location.search);
      setNav(next);
      setVisited((current) => [...new Set([...current, next.mode])]);
      const robot = new URLSearchParams(window.location.search).get('robot');
      if (isRobotVisualId(robot)) setRobotVisual(robot);
    };
    const frame = requestAnimationFrame(restore);
    window.addEventListener('popstate', restore);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', restore);
    };
  }, []);
  const navigate = useCallback(
    (patch: Partial<AppNavigation>, visual = robotVisual) => {
      const next = { ...nav, ...patch, embed: null };
      setNav(next);
      setVisited((current) => [...new Set([...current, next.mode])]);
      const url = new URL(window.location.href);
      url.search = navigationSearch(next, visual, locale);
      window.history.pushState(null, '', url);
    },
    [locale, nav, robotVisual],
  );
  const openRule = useCallback(
    (sectionId: string) =>
      navigate({ mode: 'rules', sectionId, situationId: null }),
    [navigate],
  );
  const openCertificationRules = useCallback(
    (roundId: string) => {
      const answered = new Set(
        certificationRound?.id === roundId
          ? certificationRound.rules.answeredQuestionIds
          : [],
      );
      const next =
        LEARNING_SITUATIONS.find((item) => !answered.has(item.id)) ??
        LEARNING_SITUATIONS[0];
      navigate({
        mode: 'rules',
        sectionId: next.sectionId,
        situationId: next.id,
        certificationTrack: 'rules',
      });
    },
    [certificationRound, navigate],
  );
  const launchCertificationGame = useCallback(
    (launch: CertificationGameLaunch) => {
      setSavedReview(null);
      setCertificationLaunch(launch);
      if (launch.robotVisual) setRobotVisual(launch.robotVisual);
      navigate(
        {
          mode: 'referee',
          certificationTrack: launch.mode,
        },
        launch.robotVisual,
      );
    },
    [navigate],
  );
  const certificationBridge = useMemo<
    RefereeCertificationBridge | undefined
  >(() => {
    const track = nav.certificationTrack;
    const round = certificationRound;
    if (
      (track !== 'step' && track !== 'continuous') ||
      !round ||
      round.status === 'upgrade-required'
    )
      return undefined;
    const asAttempt = (launch: CertificationGameLaunch) => ({
      attemptId: launch.attemptId,
      certificationRunId: round.id,
      mode: launch.mode,
      seed: launch.seed,
      attemptNumber: launch.attemptNumber,
      robotVisual: launch.robotVisual,
      checkpoint: launch.checkpoint,
    });
    return {
      certificationRunId: round.id,
      mode: track,
      attempt:
        certificationLaunch?.roundId === round.id &&
        certificationLaunch.mode === track
          ? asAttempt(certificationLaunch)
          : null,
      onStartAttempt: async () => {
        const launch = await beginCertificationGame({
          roundId: round.id,
          mode: track,
          purpose: 'certification',
          robotVisual,
        });
        setCertificationLaunch(launch);
        return asAttempt(launch);
      },
      onCheckpoint: saveCertificationCheckpoint,
      onFinishAttempt: async (result) => {
        await completeCertificationGame(result.attemptId, {
          elapsedSeconds:
            result.completionReason === 'full-time'
              ? result.durationSeconds
              : Math.floor(result.simulatedSeconds),
          correct: result.report.correct,
          wrong: result.report.wrong,
          missed: result.report.missed,
          assisted: result.report.assisted,
          accuracy: result.report.accuracy,
          replay: result.replay,
        });
        setCertificationLaunch(null);
      },
    };
  }, [
    beginCertificationGame,
    certificationRound,
    certificationLaunch,
    completeCertificationGame,
    nav.certificationTrack,
    robotVisual,
    saveCertificationCheckpoint,
  ]);
  const changeRobotVisual = (value: RobotVisualId) => {
    setRobotVisual(value);
    const url = new URL(window.location.href);
    url.search = navigationSearch(nav, value, locale);
    window.history.replaceState(null, '', url);
  };
  const embedded = SCENARIOS.find((item) => item.id === nav.embed);
  if (embedded)
    return (
      <main className="embed-shell lesson-embed">
        <div className="embed-toolbar">
          <strong>{embedded.title}</strong>
          <div className="embed-toolbar-actions">
            <label className="app-language-select embed-language-select">
              <Languages aria-hidden="true" />
              <span className="sr-only">Language</span>
              <NativeSelect
                size="sm"
                aria-label="Language"
                value={locale}
                onChange={(event) => setLocale(event.target.value as Locale)}
              >
                {LOCALE_OPTIONS.map((option) => (
                  <NativeSelectOption
                    key={option.id}
                    value={option.id}
                    data-i18n-skip
                  >
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <a
              href={appendLocaleToSearch(
                `?mode=rules&situation=scenario:${embedded.id}`,
                locale,
                { robot: robotVisual },
              )}
            >
              Open in Rules
            </a>
          </div>
        </div>
        <ScenarioLesson scenario={embedded} robotVisual={robotVisual} />
      </main>
    );
  return (
    <main className="simulator-app">
      <header className="app-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="brand-mark">
            <CircleDot className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">RCJ Soccer Lab</p>
            <p className="text-[10px] text-muted-foreground">
              Learn the rules. Play. Referee. Certify.
            </p>
          </div>
        </div>
        <nav className="mode-switcher" aria-label="Simulator mode">
          {tabs.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              size="sm"
              variant={nav.mode === id ? 'secondary' : 'ghost'}
              aria-pressed={nav.mode === id}
              onClick={() => {
                setSavedReview(null);
                navigate({ mode: id, certificationTrack: null });
              }}
            >
              <Icon />
              <span>{label}</span>
            </Button>
          ))}
        </nav>
        <div className="app-header-actions">
          {nav.mode !== 'academy' && (
            <NativeSelect
              className="app-robot-select"
              size="sm"
              aria-label="Robot visual style"
              value={robotVisual}
              disabled={
                Boolean(savedReview && nav.mode === 'referee') ||
                (nav.certificationTrack !== null &&
                  certificationRound?.status !== 'upgrade-required')
              }
              onChange={(event) => {
                if (isRobotVisualId(event.target.value))
                  changeRobotVisual(event.target.value);
              }}
            >
              {ROBOT_VISUALS.map((model) => (
                <NativeSelectOption key={model.id} value={model.id}>
                  {model.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <label className="app-language-select">
            <Languages aria-hidden="true" />
            <span className="sr-only">Language</span>
            <NativeSelect
              size="sm"
              aria-label="Language"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              {LOCALE_OPTIONS.map((option) => (
                <NativeSelectOption
                  key={option.id}
                  value={option.id}
                  data-i18n-skip
                >
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <AccountMenu
            compact
            onNavigate={(academyPage) =>
              navigate({
                mode: 'academy',
                academyPage,
                certificationTrack: null,
              })
            }
          />
        </div>
      </header>
      {visited.includes('rules') && (
        <Rulebook
          robotVisual={robotVisual}
          active={nav.mode === 'rules'}
          sectionId={nav.sectionId}
          situationId={nav.situationId}
          onSelect={(sectionId, situationId) =>
            navigate({ mode: 'rules', sectionId, situationId })
          }
          learning={
            nav.certificationTrack === 'rules' &&
            certificationRound?.status === 'in-progress'
              ? certificationRuleLearningBridge
              : practiceRuleLearningBridge
          }
        />
      )}
      {visited.includes('play') && (
        <MatchPlay
          robotVisual={robotVisual}
          onRobotVisualChange={changeRobotVisual}
          active={nav.mode === 'play'}
          arrange={nav.arrange}
          onArrangeChange={(arrange) => navigate({ arrange })}
          onReferee={() => navigate({ mode: 'referee' })}
        />
      )}
      {visited.includes('referee') && (
        <RefereePlay
          key={
            savedReview
              ? `review:${savedReview.id}`
              : nav.certificationTrack === 'step' ||
                  nav.certificationTrack === 'continuous'
                ? `certification:${nav.certificationTrack}`
                : 'practice'
          }
          robotVisual={robotVisual}
          savedReview={savedReview?.replay}
          active={nav.mode === 'referee'}
          onExit={() => {
            setSavedReview(null);
            navigate({
              mode: savedReview ? 'academy' : 'play',
              certificationTrack: null,
            });
          }}
          onOpenRule={openRule}
          tracking={practiceTrackingBridge}
          certification={certificationBridge}
        />
      )}
      {nav.mode === 'academy' && (
        <AcademyHub
          page={nav.academyPage}
          onPageChange={(academyPage) =>
            navigate({ mode: 'academy', academyPage })
          }
          onOpenRules={openCertificationRules}
          onLaunchGame={launchCertificationGame}
          robotVisual={robotVisual}
          onReviewGame={(id, replay) => {
            setSavedReview({ id, replay });
            setRobotVisual(replay.robotVisual);
            navigate(
              { mode: 'referee', certificationTrack: null },
              replay.robotVisual,
            );
          }}
        />
      )}
    </main>
  );
}
