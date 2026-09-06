'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CircleDot, Gamepad2, Scale } from 'lucide-react';
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

const tabs = [
  { id: 'rules', label: 'Rules', icon: BookOpen },
  { id: 'play', label: 'Play', icon: Gamepad2 },
  { id: 'referee', label: 'Referee', icon: Scale },
] as const;

export function SimulatorApp() {
  const [nav, setNav] = useState(INITIAL_NAVIGATION);
  const [visited, setVisited] = useState<AppMode[]>(['rules']);
  const [robotVisual, setRobotVisual] = useState<RobotVisualId>(
    DEFAULT_ROBOT_VISUAL_ID,
  );
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
    (patch: Partial<AppNavigation>) => {
      const next = { ...nav, ...patch, embed: null };
      setNav(next);
      setVisited((current) => [...new Set([...current, next.mode])]);
      const url = new URL(window.location.href);
      url.search = navigationSearch(next, robotVisual);
      window.history.pushState(null, '', url);
    },
    [nav, robotVisual],
  );
  const openRule = useCallback(
    (sectionId: string) =>
      navigate({ mode: 'rules', sectionId, situationId: null }),
    [navigate],
  );
  const changeRobotVisual = (value: RobotVisualId) => {
    setRobotVisual(value);
    const url = new URL(window.location.href);
    url.search = navigationSearch(nav, value);
    window.history.replaceState(null, '', url);
  };
  const embedded = SCENARIOS.find((item) => item.id === nav.embed);
  if (embedded)
    return (
      <main className="embed-shell lesson-embed">
        <div className="embed-toolbar">
          <strong>{embedded.title}</strong>
          <a href={`?mode=rules&situation=scenario:${embedded.id}`}>
            Open in Rules
          </a>
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
              Learn the rules. Play. Referee.
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
              onClick={() => navigate({ mode: id })}
            >
              <Icon />
              <span>{label}</span>
            </Button>
          ))}
        </nav>
        <NativeSelect
          size="sm"
          aria-label="Robot visual style"
          value={robotVisual}
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
          robotVisual={robotVisual}
          active={nav.mode === 'referee'}
          onExit={() => navigate({ mode: 'play' })}
          onOpenRule={openRule}
        />
      )}
    </main>
  );
}
