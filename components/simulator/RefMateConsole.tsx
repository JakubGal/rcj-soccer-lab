'use client';

import { useId, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { Radio, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { RefereeMatch } from '@/lib/simulator/referee-match';
import type { RefereeCall } from '@/lib/simulator/referee-cases';
import {
  REFMATE_ROBOTS,
  RefMateTapGuard,
  refMateStartCall,
  refMateTileCall,
  type RefMatePenalty,
  type RefMateStartSignal,
} from '@/lib/simulator/refmate-controls';

type Frame = ReturnType<RefereeMatch['snapshot']>;
type Activation = 'single' | 'double';
const clock = (seconds: number) => {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Native buttons also provide a deliberate, single keyboard activation. */
function CriticalButton({
  actionKey,
  activation,
  onAction,
  onSelect,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  actionKey: string;
  activation: Activation;
  onAction: () => void;
  onSelect?: () => void;
}) {
  const gesture = useRef(new RefMateTapGuard());
  return (
    <button
      {...props}
      type="button"
      onBlur={() => gesture.current.reset()}
      onKeyDown={(event) => {
        if (event.repeat && ['Enter', ' '].includes(event.key))
          event.preventDefault();
      }}
      onClick={(event) => {
        onSelect?.();
        if (
          gesture.current.activate(
            actionKey,
            event.timeStamp,
            activation,
            event.detail === 0,
          )
        )
          onAction();
      }}
    />
  );
}

export function RefMateConsole({
  frame,
  running,
  target,
  blocked,
  returnBlocked,
  startBlocked,
  transportBlocked,
  onSelect,
  onCall,
  onTransport,
  onContinue,
  continueLabel = 'Continue decision',
  onArrangeKickoff,
}: {
  frame: Frame;
  running: boolean;
  target: string;
  blocked: boolean;
  returnBlocked: boolean;
  startBlocked: boolean;
  transportBlocked: boolean;
  onSelect: (robot: string) => void;
  onCall: (call: RefereeCall) => void;
  onTransport: () => void;
  onContinue: () => void;
  continueLabel?: string;
  onArrangeKickoff: () => void;
}) {
  const controlsId = useId();
  const [activation, setActivation] = useState<Activation>('double');
  const [penalty, setPenalty] = useState<RefMatePenalty>('out');
  const [startChoice, setStartChoice] = useState<{
    context: string;
    signal: RefMateStartSignal;
  } | null>(null);
  const startContext = frame.opening
    ? 'opening'
    : frame.kickoffDue
      ? 'kickoff'
      : 'play';
  const startSignal =
    startChoice?.context === startContext
      ? startChoice.signal
      : startContext === 'play'
        ? 'resume'
        : 'kickoff';
  const playing = running && !frame.motionHeld && !frame.sessionFinished;
  const selected =
    REFMATE_ROBOTS.find((robot) => robot.id === target) ?? REFMATE_ROBOTS[0];

  return (
    <section
      className="refmate-console"
      aria-label="RefMate-style training controller"
    >
      <header className="refmate-header">
        <Smartphone aria-hidden="true" />
        <strong>
          RefMate <span>Training console</span>
        </strong>
        <span className="refmate-link">
          <Radio aria-hidden="true" /> Simulated link
        </span>
      </header>
      <div className="refmate-body">
        <div className="refmate-scoreboard">
          {(['blue', 'yellow'] as const).map((team) => (
            <CriticalButton
              key={team}
              className={`refmate-score refmate-team-${team}`}
              actionKey={`goal:${team}`}
              activation={activation}
              disabled={blocked}
              onAction={() => onCall({ action: 'goal', target: team })}
              aria-label={
                team === 'blue'
                  ? 'Award goal · Team A / Blue'
                  : 'Award goal · Team B / Yellow'
              }
              title={
                team === 'blue'
                  ? 'Award goal · Team A / Blue'
                  : 'Award goal · Team B / Yellow'
              }
            >
              <span>
                {team === 'blue' ? 'Team A · Blue' : 'Team B · Yellow'}
              </span>
              <strong>{frame.score[team]}</strong>
              <small>Goal +1</small>
            </CriticalButton>
          ))}
          <div className="refmate-timer">
            <output aria-label="Training time remaining">
              {clock(frame.trainingRemaining)}
            </output>
            <small>
              {frame.sessionFinished
                ? 'FULL TIME'
                : frame.trainingMode === 'continuous'
                  ? 'Continuous'
                  : 'Step mode'}
            </small>
            <CriticalButton
              actionKey={running ? 'clock-stop' : 'clock-start'}
              activation={activation}
              className={`refmate-clock-button ${running ? 'is-stop' : ''}`}
              disabled={transportBlocked}
              onAction={onTransport}
              aria-label={
                running ? 'Pause training clock' : 'Resume training clock'
              }
            >
              {running ? 'STOP' : 'START'}
            </CriticalButton>
            <small>Training clock only</small>
          </div>
        </div>

        <div className="refmate-options">
          <label htmlFor={`${controlsId}-activation`}>
            Activation
            <NativeSelect
              id={`${controlsId}-activation`}
              aria-label="RefMate activation"
              value={activation}
              onChange={(event) =>
                setActivation(event.target.value as Activation)
              }
            >
              <NativeSelectOption value="double">Double-tap</NativeSelectOption>
              <NativeSelectOption value="single">Single-tap</NativeSelectOption>
            </NativeSelect>
          </label>
          <label htmlFor={`${controlsId}-penalty`}>
            Penalty reason
            <NativeSelect
              id={`${controlsId}-penalty`}
              aria-label="RefMate penalty reason"
              value={penalty}
              onChange={(event) =>
                setPenalty(event.target.value as RefMatePenalty)
              }
            >
              <NativeSelectOption value="out">out of bounds</NativeSelectOption>
              <NativeSelectOption value="damaged">damaged</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>

        <div className="refmate-robots">
          {REFMATE_ROBOTS.map((robot) => {
            const bench = frame.bench.find((entry) => entry.robot === robot.id);
            const offField = !frame.actors[robot.id];
            const state = bench
              ? 'penalty'
              : frame.opening
                ? 'setup'
                : offField
                  ? 'off'
                  : playing
                    ? 'playing'
                    : 'stopped';
            const call = refMateTileCall(robot.id, penalty, frame.bench);
            return (
              <CriticalButton
                key={robot.id}
                className={`refmate-robot refmate-robot-${state}`}
                actionKey={`${robot.id}:${call.action}`}
                activation={activation}
                disabled={bench ? returnBlocked : blocked}
                aria-pressed={target === robot.id}
                aria-label={`${robot.slot} · ${robot.label} · ${bench ? 'Return now' : penalty === 'out' ? 'Out of bounds · remove' : 'Damaged · remove'}`}
                onSelect={() => onSelect(robot.id)}
                onAction={() => onCall(call)}
              >
                <strong data-i18n-skip>{robot.slot}</strong>
                <span data-i18n-skip>{robot.label}</span>
                {bench ? (
                  <>
                    <output>{clock(bench.remaining)}</output>
                    <small>{bench.reason}</small>
                    <small>
                      {bench.ready ? 'Ready' : 'Repairing'} ·{' '}
                      {bench.eligible ? 'Eligible' : 'Waiting'}
                    </small>
                  </>
                ) : (
                  <small>
                    {state === 'setup'
                      ? 'Awaiting setup'
                      : state === 'playing'
                        ? 'PLAYING'
                        : state === 'off'
                          ? 'OFF FIELD'
                          : 'STOPPED'}
                  </small>
                )}
              </CriticalButton>
            );
          })}
        </div>

        <p className="refmate-gesture-hint">
          {activation === 'double'
            ? 'Tap a tile to select. Double-tap to penalize or return; double-tap a score to award a goal.'
            : 'One tap sends the selected penalty, return or goal decision.'}
        </p>
        <div className="refmate-selected-actions">
          <strong>
            <span data-i18n-skip>
              {selected.slot} · {selected.label}
            </span>
          </strong>
          <Button
            variant="outline"
            disabled={blocked}
            onClick={() => onCall({ action: penalty, target: selected.id })}
          >
            Apply 1-minute penalty
          </Button>
          <Button
            variant="outline"
            disabled={returnBlocked}
            onClick={() => onCall({ action: 'return', target: selected.id })}
          >
            Return now
          </Button>
        </div>

        <label
          className="refmate-start-choice"
          htmlFor={`${controlsId}-signal`}
        >
          Start signal
          <NativeSelect
            id={`${controlsId}-signal`}
            aria-label="RefMate start signal"
            value={startSignal}
            onChange={(event) =>
              setStartChoice({
                context: startContext,
                signal: event.target.value as RefMateStartSignal,
              })
            }
          >
            <NativeSelectOption value="kickoff">
              Signal kickoff
            </NativeSelectOption>
            <NativeSelectOption value="resume">
              Resume same positions
            </NativeSelectOption>
          </NativeSelect>
        </label>
        <div className="refmate-all-controls">
          <CriticalButton
            className="refmate-all-start"
            actionKey={`start-all:${startSignal}`}
            activation={activation}
            disabled={startBlocked}
            onAction={() => onCall(refMateStartCall(startSignal))}
          >
            START ALL ROBOTS
          </CriticalButton>
          <CriticalButton
            className="refmate-all-stop"
            actionKey="stop-all"
            activation={activation}
            disabled={blocked}
            onAction={() => onCall({ action: 'pause' })}
          >
            STOP ALL ROBOTS
          </CriticalButton>
        </div>
        {frame.canArrangeKickoff && (
          <Button
            className="refmate-arrange"
            variant="outline"
            disabled={returnBlocked}
            onClick={onArrangeKickoff}
          >
            Arrange kickoff positions
          </Button>
        )}
        {frame.trainingMode === 'step' &&
          frame.feedback &&
          !frame.sessionFinished && (
            <div className="refmate-feedback" aria-live="polite">
              <strong>{frame.feedback.title}</strong>
              <span>Full explanation and rules below.</span>
              <Button disabled={returnBlocked} onClick={onContinue}>
                {continueLabel}
              </Button>
            </div>
          )}
        <details className="refmate-guide">
          <summary>How this training controller works</summary>
          <p>
            A1/A2 are Blue; B1/B2 are Yellow. Tile colors show robot status, not
            team color.
          </p>
          <p>
            Robot links are simulated. No Bluetooth connection or physical robot
            commands are sent.
          </p>
          <p>
            START/STOP beside the clock pauses or resumes training without
            grading a call. START ALL / STOP ALL records your referee signal.
            Choose kickoff or same-position resume yourself.
          </p>
          <p>
            Penalty timers use simulation time. Expiry and START ALL never
            return a robot automatically. Select Return now to give permission;
            continuous mode also accepts early or mistaken returns.
          </p>
          <p>
            Unlike the hardware app, a stopped tile can still receive a penalty
            during a teaching pause. Use the penalty-reason selector to record
            out of bounds or damaged explicitly.
          </p>
          <p>
            Enter or Space activates a focused control once. The two smaller
            selected-robot buttons always use one click.
          </p>
          <a
            href="https://github.com/robocup-junior/soccer-referee-app"
            target="_blank"
            rel="noreferrer"
          >
            RefMate source and hardware app
          </a>
        </details>
      </div>
    </section>
  );
}
