'use client';

import { useEffect, useState } from 'react';
import { Coins, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KickoffMeeting, GoalEnd } from '@/lib/simulator/kickoff';

const name = (team: string | null) => (team === 'blue' ? 'Blue' : 'Yellow');

export function PreMatchToss({
  meeting,
  onToss,
  onKickoff,
  onEnd,
  onStart,
  ready,
}: {
  meeting: ReturnType<KickoffMeeting['snapshot']>;
  onToss: () => void;
  onKickoff: () => void;
  onEnd: (end: GoalEnd) => void;
  onStart: () => void;
  ready: boolean;
}) {
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (!spinning) return;
    const timer = window.setTimeout(() => setSpinning(false), 1800);
    return () => window.clearTimeout(timer);
  }, [spinning]);
  return (
    <section className="referee-meeting" aria-label="Pre-match coin toss">
      <p className="rule-kicker">PRE-MATCH / §2.2–2.3</p>
      <div className="referee-coin-stage" aria-hidden="true">
        <div
          className={`referee-coin ${spinning ? 'is-tossing' : ''} ${meeting.winner === 'yellow' ? 'lands-yellow' : ''}`}
        >
          <span className="referee-coin-blue">B</span>
          <span className="referee-coin-yellow">Y</span>
        </div>
      </div>
      <div aria-live="polite">
        <h2>
          {spinning
            ? 'Coin in the air…'
            : meeting.stage === 'toss'
              ? 'Who chooses first?'
              : meeting.stage === 'ready'
                ? `${name(meeting.firstKickoff)} kicks off`
                : meeting.stage === 'end-choice'
                  ? `${name(meeting.choosingTeam)} chooses an end`
                  : `${name(meeting.winner)} wins the toss`}
        </h2>
        <p>
          {spinning
            ? 'Blue and Yellow each have an equal chance.'
            : meeting.stage === 'ready'
              ? `Blue attacks the ${meeting.blueAttackDirection === 1 ? 'yellow' : 'blue'} goal. Yellow attacks the other end.`
              : meeting.stage === 'toss'
                ? 'The winner chooses first kickoff or an attacking end. The other team gets the remaining choice.'
                : meeting.stage === 'end-choice'
                  ? `${name(meeting.firstKickoff)} chose first kickoff. Choose the goal ${name(meeting.choosingTeam)} will attack.`
                  : `Make ${name(meeting.winner)}’s choice: take first kickoff, or pick a goal to attack and let the other team kick off.`}
        </p>
      </div>
      {!spinning && (
        <div className="referee-meeting-actions">
          {meeting.stage === 'toss' ? (
            <Button
              disabled={!ready}
              onClick={() => {
                setSpinning(true);
                onToss();
              }}
            >
              <Coins /> Toss coin
            </Button>
          ) : meeting.stage === 'ready' ? (
            <>
              <small>
                Random legal positions · own halves · ball centered · opponents
                clear of the center circle. Everyone waits for your signal.
              </small>
              <Button disabled={!ready} onClick={onStart}>
                <Flag /> Signal kickoff
              </Button>
            </>
          ) : (
            <>
              {meeting.stage === 'winner-choice' && (
                <Button onClick={onKickoff}>
                  <Flag /> Take first kickoff
                </Button>
              )}
              <div className="referee-end-options">
                <Button variant="outline" onClick={() => onEnd('blue')}>
                  Attack blue goal
                </Button>
                <Button variant="outline" onClick={() => onEnd('yellow')}>
                  Attack yellow goal
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
