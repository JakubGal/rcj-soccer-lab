'use client';

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * The referee session runs two clocks. Match time (scoreboard) advances only
 * while the ball is live; training time (console) also runs while drill
 * evidence plays back, so a 10:00 training game ends with the match clock
 * well short of 10:00. Both are shown with their names so the difference is
 * expected rather than puzzling.
 */
export function MatchClock({
  elapsed,
  status,
}: {
  elapsed: number;
  status: string;
}) {
  return (
    <div
      className="match-clock"
      role="timer"
      aria-label={`Match time ${formatClock(elapsed)}`}
      title="Match time only advances while play is live."
    >
      <small className="match-clock-label">MATCH</small>
      {formatClock(elapsed)}
      <small>{status}</small>
    </div>
  );
}

export function TrainingClock({
  remaining,
  matchElapsed,
}: {
  remaining: number;
  matchElapsed: number;
}) {
  return (
    <div className="grid gap-0.5">
      <strong>
        {`Training time ${formatClock(Math.ceil(remaining))} remaining`}
      </strong>
      <small className="text-xs text-slate-400">
        {`Match clock ${formatClock(matchElapsed)} · training time also runs while drill evidence plays; the match clock waits for live play.`}
      </small>
    </div>
  );
}
