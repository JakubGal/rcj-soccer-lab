'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Users, X } from 'lucide-react';
import {
  CHARACTERS,
  COMMITTEE_VOICE_DISCLAIMER,
  type CommitteeCharacter,
} from '@/lib/committee/catalog';
import {
  COMMITTEE_EVENT_NAME,
  COMMITTEE_RESET_EVENT_NAME,
  createCommitteeHistory,
  isCommitteeEvent,
  selectCommitteeDialogue,
  type CommitteeEvent,
} from '@/lib/committee/events';
import './committee.css';

type Pose = 'celebrate' | 'explain' | 'encourage';
type Preferences = { reactions: boolean; motion: boolean };
type Reaction = NonNullable<ReturnType<typeof selectCommitteeDialogue>>;
type PendingReaction = { reaction: Reaction; receivedAt: number };
const TOUR_KEY = 'committee-tour-v1';
const PREFERENCES_KEY = 'committee-preferences-v1';
const REACTION_DURATION = 9000;
const POSES: Pose[] = ['celebrate', 'explain', 'encourage'];
const POSE_LABELS: Record<Pose, string> = {
  celebrate: 'Celebrate',
  explain: 'Explain',
  encourage: 'Encourage',
};

export const COMMITTEE_TOUR = [
  {
    characters: ['marek'],
    title: 'Welcome to the touchline',
    text: 'Start in Rules. Read a section, watch its situation, and try the questions. In practice, you can take another look and try again. We are here to help you learn.',
    hint: 'The official rules are always the source of truth.',
  },
  {
    characters: ['tom'],
    title: 'A better view changes everything',
    text: 'Drag the 3D field to look around, use the wheel to zoom, or choose a camera view. Replay a situation and look from both sides before making a decision.',
    hint: 'Watch the robots, the ball, and the sequence of events.',
  },
  {
    characters: ['will'],
    title: 'Your robots. Your match.',
    text: 'Play lets you arrange the field and experiment. Try a match against AI, or choose Human vs human: one player uses WASD and Space, the other uses the arrow keys and Enter.',
    hint: 'Two humans, one keyboard. No online account is needed.',
  },
  {
    characters: ['david'],
    title: 'Take the whistle',
    text: 'In Referee, you make the calls. RefMate is your match-control panel: choose an action and the robot or team it applies to. Your decisions change what happens on the field.',
    hint: 'A useful referee habit: look first, then choose the action.',
  },
  {
    characters: ['isa'],
    title: 'Practice at your own pace',
    text: 'Step mode pauses for decisions. Continuous mode keeps the match moving and accepts your calls, including mistakes. Review the timeline afterwards to see what happened and what you could improve.',
    hint: 'During certification, we stay quiet. Your decisions are yours.',
  },
  {
    characters: ['finance'],
    title: 'Progress without a paywall',
    text: 'Explore and play as a guest. Academy offers an optional local profile to save practice progress and work towards training certification. Export a backup if you want to keep your progress safe.',
    hint: 'Training certification is not an official competition appointment.',
  },
  {
    characters: ['jakub', 'caroline'],
    title: 'See you on the field!',
    text: 'Learn together, try a tricky situation, and keep asking why. You can switch our reactions and motion off at any time, or come back here to meet everyone again.',
    hint: 'This tour never changes your match or your learning progress.',
  },
] as const;

export function readCommitteePreferences(
  storage: Pick<Storage, 'getItem'> | null,
): Preferences {
  try {
    const value = JSON.parse(storage?.getItem(PREFERENCES_KEY) ?? 'null');
    return {
      reactions: typeof value?.reactions === 'boolean' ? value.reactions : true,
      motion: typeof value?.motion === 'boolean' ? value.motion : true,
    };
  } catch {
    return { reactions: true, motion: true };
  }
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function persist(key: string, value: string) {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Companions are optional: denied/full storage must never interrupt play.
  }
}

function tourSeen() {
  try {
    return storage()?.getItem(TOUR_KEY) === 'seen';
  } catch {
    return false;
  }
}

/** One scoped subscription, removed entirely when reactions are muted. */
export function subscribeCommitteeSurface(
  target: EventTarget,
  surface: string,
  onEvent: (event: CommitteeEvent) => void,
  onReset: () => void,
) {
  const receive = (raw: Event) => {
    const event = (raw as CustomEvent<unknown>).detail;
    if (isCommitteeEvent(event) && event.surface === surface) onEvent(event);
  };
  const reset = (raw: Event) => {
    const detail = (raw as CustomEvent<{ surface?: unknown }>).detail;
    if (detail?.surface === surface) onReset();
  };
  target.addEventListener(COMMITTEE_EVENT_NAME, receive);
  target.addEventListener(COMMITTEE_RESET_EVENT_NAME, reset);
  return () => {
    target.removeEventListener(COMMITTEE_EVENT_NAME, receive);
    target.removeEventListener(COMMITTEE_RESET_EVENT_NAME, reset);
  };
}

export function CommitteeFigure({
  character,
  pose = 'explain',
}: {
  character: CommitteeCharacter;
  pose?: Pose;
}) {
  const base = import.meta.env?.BASE_URL ?? '/';
  return (
    <div
      className="committee-figure"
      data-character={character.id}
      data-pose={pose}
      aria-hidden="true"
      style={
        {
          '--committee-sprite': `url("${base}characters/${character.id}.png")`,
          '--committee-position': `${POSES.indexOf(pose) * 50}%`,
        } as CSSProperties
      }
    />
  );
}

function charactersForSlide(index: number) {
  return COMMITTEE_TOUR[index].characters
    .map((id) => CHARACTERS.find((character) => character.id === id))
    .filter((character): character is CommitteeCharacter => Boolean(character));
}

export function CommitteeTourSlide({
  index,
  pose,
}: {
  index: number;
  pose: Pose;
}) {
  const slide = COMMITTEE_TOUR[index];
  const characters = charactersForSlide(index);
  return (
    <div className="committee-tour-slide" key={index}>
      <div className="committee-stage">
        <div className="committee-stage-figures">
          {characters.map((character) => (
            <CommitteeFigure
              key={character.id}
              character={character}
              pose={pose}
            />
          ))}
        </div>
        <div className="committee-nameplates">
          {characters.map((character) => (
            <div key={character.id}>
              <strong data-i18n-skip>{character.name}</strong>
              <span>{character.role}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="committee-tour-copy">
        <span className="committee-eyebrow">Your sideline crew</span>
        <h3>{slide.title}</h3>
        <p>{slide.text}</p>
        <div className="committee-tour-hint">
          <Sparkles aria-hidden="true" />
          {slide.hint}
        </div>
        <details className="committee-bio">
          <summary>Meet your guide</summary>
          {characters.map((character) => (
            <p key={character.id}>
              <strong data-i18n-skip>{character.name}</strong> — {character.bio}
            </p>
          ))}
        </details>
      </div>
    </div>
  );
}

export function CommitteeCompanions({
  mode,
  embedded,
  assessmentActive,
}: {
  mode: string;
  embedded: boolean;
  assessmentActive: boolean;
}) {
  const [preferences, setPreferences] = useState<Preferences>({
    reactions: true,
    motion: true,
  });
  const [ready, setReady] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const [pose, setPose] = useState<Pose>('explain');
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const history = useRef(createCommitteeHistory());
  const seenIds = useRef(new Set<string>());
  const pending = useRef<PendingReaction[]>([]);
  const active = useRef<Reaction | null>(null);
  const remaining = useRef(REACTION_DURATION);
  const autoTourConsidered = useRef(false);
  const blocked = embedded || assessmentActive;

  const clearReactions = useCallback(() => {
    pending.current = [];
    active.current = null;
    remaining.current = REACTION_DURATION;
    setReaction(null);
    setHovered(false);
    setFocused(false);
  }, []);

  const present = useCallback((next: Reaction | null) => {
    active.current = next;
    remaining.current = REACTION_DURATION;
    setHovered(false);
    setFocused(false);
    setReaction(next);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setDocumentHidden(document.hidden);
    const frame = requestAnimationFrame(() => {
      setPreferences(readCommitteePreferences(storage()));
      setReady(true);
      updateVisibility();
    });
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      clearReactions();
      setTourOpen(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, blocked, clearReactions]);

  useEffect(() => {
    if (!ready || autoTourConsidered.current) return;
    // Consider the initial settled landing only. A later mode change must not
    // pop up a welcome dialog in the middle of a user's existing activity.
    const timer = window.setTimeout(() => {
      autoTourConsidered.current = true;
      if (!blocked && mode === 'rules' && !tourSeen()) {
        previousFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setTourOpen(true);
      }
    }, 800);
    const keepLearning = () => {
      autoTourConsidered.current = true;
      window.clearTimeout(timer);
    };
    window.addEventListener('pointerdown', keepLearning, { once: true });
    window.addEventListener('keydown', keepLearning, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', keepLearning);
      window.removeEventListener('keydown', keepLearning);
    };
  }, [ready, mode, blocked]);

  const closeTour = useCallback(() => {
    persist(TOUR_KEY, 'seen');
    setTourOpen(false);
  }, []);

  const openTour = useCallback(() => {
    if (blocked) return;
    clearReactions();
    autoTourConsidered.current = true;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSlide(0);
    setPose('explain');
    setTourOpen(true);
  }, [blocked, clearReactions]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (tourOpen && !blocked) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
      const target = previousFocus.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else launcherRef.current?.focus({ preventScroll: true });
    }
  }, [tourOpen, blocked]);

  useEffect(() => {
    if (!ready || blocked || tourOpen || !preferences.reactions) {
      const frame = requestAnimationFrame(clearReactions);
      return () => cancelAnimationFrame(frame);
    }
    const receive = (event: CommitteeEvent) => {
      if (seenIds.current.has(event.id)) return;
      seenIds.current.add(event.id);
      if (seenIds.current.size > 256)
        seenIds.current.delete(seenIds.current.values().next().value!);
      const selected = selectCommitteeDialogue(event, history.current);
      if (!selected) return;
      history.current = selected.history;
      if (!active.current) present(selected);
      else {
        // Never stack cards. Keep at most two recent pending reactions, and
        // drop old commentary rather than replaying a stale stream of advice.
        if (pending.current.length >= 2) pending.current.pop();
        pending.current.push({ reaction: selected, receivedAt: Date.now() });
      }
    };
    return subscribeCommitteeSurface(window, mode, receive, clearReactions);
  }, [
    ready,
    blocked,
    tourOpen,
    preferences.reactions,
    mode,
    clearReactions,
    present,
  ]);

  useEffect(() => {
    if (!reaction || hovered || focused || documentHidden) return;
    const started = performance.now();
    const timer = window.setTimeout(
      () => {
        const next = pending.current.find(
          (entry) => Date.now() - entry.receivedAt < 18000,
        );
        pending.current = next
          ? pending.current.slice(pending.current.indexOf(next) + 1)
          : [];
        present(next?.reaction ?? null);
      },
      Math.max(0, remaining.current),
    );
    return () => {
      window.clearTimeout(timer);
      if (active.current === reaction)
        remaining.current = Math.max(
          0,
          remaining.current - (performance.now() - started),
        );
    };
  }, [reaction, hovered, focused, documentHidden, present]);

  function updatePreference(key: keyof Preferences) {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    persist(PREFERENCES_KEY, JSON.stringify(next));
    if (!next.reactions) clearReactions();
  }

  if (blocked) return null;
  return (
    <div
      className="committee-companions"
      data-motion={preferences.motion ? 'on' : 'off'}
    >
      <button
        ref={launcherRef}
        type="button"
        className="committee-launcher"
        onClick={openTour}
        aria-haspopup="dialog"
      >
        <Users aria-hidden="true" />
        <span>Meet the committee</span>
      </button>

      {reaction && !tourOpen && preferences.reactions && (
        <div
          className="committee-reaction"
          aria-label="Committee companion"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setFocused(false);
          }}
        >
          <div className="committee-reaction-figures">
            {reaction.characters.map((character) => (
              <CommitteeFigure
                key={character.id}
                character={character}
                pose={reaction.dialogue.pose}
              />
            ))}
          </div>
          <output
            className="committee-reaction-copy"
            aria-live="polite"
            aria-atomic="true"
          >
            <strong data-i18n-skip>
              {reaction.characters
                .map((character) => character.name)
                .join(' & ')}
            </strong>
            <span className="committee-reaction-text">
              {reaction.dialogue.text}
            </span>
          </output>
          <button
            className="committee-icon-button committee-dismiss"
            type="button"
            onClick={clearReactions}
            aria-label="Dismiss committee reaction"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="committee-dialog"
        aria-labelledby="committee-tour-title"
        aria-describedby="committee-tour-description"
        onCancel={(event) => {
          event.preventDefault();
          closeTour();
        }}
      >
        <header className="committee-dialog-header">
          <div>
            <span className="committee-eyebrow">RCJ Soccer Lab</span>
            <h2 id="committee-tour-title">Meet the committee</h2>
          </div>
          <button
            className="committee-icon-button"
            type="button"
            onClick={closeTour}
            aria-label="Close committee tour"
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <p
          id="committee-tour-description"
          className="committee-tour-description"
        >
          A quick introduction to learning, playing, and refereeing.
        </p>
        <nav className="committee-cast" aria-label="Committee tour guides">
          {COMMITTEE_TOUR.map((item, index) => (
            <button
              key={item.characters[0]}
              type="button"
              aria-current={slide === index ? 'step' : undefined}
              onClick={() => {
                setSlide(index);
                setPose('explain');
              }}
            >
              <span data-i18n-skip>
                {charactersForSlide(index)
                  .map((character) => character.name)
                  .join(' & ')}
              </span>
            </button>
          ))}
        </nav>
        <CommitteeTourSlide index={slide} pose={pose} />
        <fieldset
          className="committee-pose-controls"
          aria-label="Preview character poses"
        >
          {POSES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={pose === value}
              onClick={() => setPose(value)}
            >
              {POSE_LABELS[value]}
            </button>
          ))}
        </fieldset>
        <div className="committee-preferences">
          <button
            type="button"
            role="switch"
            aria-checked={preferences.reactions}
            onClick={() => updatePreference('reactions')}
          >
            <span className="committee-toggle" aria-hidden="true" />
            Committee reactions
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={preferences.motion}
            onClick={() => updatePreference('motion')}
          >
            <span className="committee-toggle" aria-hidden="true" />
            Character motion
          </button>
          <small>
            Your device’s reduced-motion setting is always respected.
          </small>
          <small>{COMMITTEE_VOICE_DISCLAIMER}</small>
        </div>
        <footer className="committee-dialog-footer">
          <button
            type="button"
            className="committee-text-button"
            onClick={closeTour}
          >
            Skip tour
          </button>
          <span className="committee-page-count" aria-label="Tour progress">
            {slide + 1} / {COMMITTEE_TOUR.length}
          </span>
          <div className="committee-navigation">
            <button
              type="button"
              className="committee-secondary-button"
              disabled={slide === 0}
              onClick={() => {
                setSlide((current) => current - 1);
                setPose('explain');
              }}
            >
              <ChevronLeft aria-hidden="true" />
              <span>Back</span>
            </button>
            <button
              type="button"
              className="committee-primary-button"
              onClick={() => {
                if (slide === COMMITTEE_TOUR.length - 1) closeTour();
                else {
                  setSlide((current) => current + 1);
                  setPose('explain');
                }
              }}
            >
              <span>
                {slide === COMMITTEE_TOUR.length - 1 ? 'Let’s play' : 'Next'}
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </footer>
      </dialog>
    </div>
  );
}
