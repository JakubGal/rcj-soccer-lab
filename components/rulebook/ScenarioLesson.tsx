'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  PlayCanvasViewport,
  type CameraPreset,
} from '@/components/simulator/PlayCanvasViewport';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import type { ScenarioDefinition } from '@/lib/simulator/types';

export function ScenarioLesson({
  scenario,
  robotVisual,
  onPassed,
  initialAnswer = null,
  onAnswer,
  studyScore,
}: {
  scenario: ScenarioDefinition;
  robotVisual: RobotVisualId;
  onPassed?: () => void;
  initialAnswer?: string | null;
  onAnswer?: (id: string) => void;
  studyScore?: string;
}) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [answer, setAnswer] = useState<string | null>(initialAnswer);
  const [geometry, setGeometry] = useState(true);
  const [contact, setContact] = useState(false);
  const [showTrail, setShowTrail] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState<CameraPreset>('overhead');
  const [copied, setCopied] = useState(false);
  const cursor = useRef(0);
  const frame = useMemo(() => scenario.sample(time), [scenario, time]);
  const trail = useMemo(
    () =>
      Array.from(
        { length: 30 },
        (_, i) =>
          scenario.sample(Math.max(0, time - 1.5 + (i / 29) * 1.5)).actors.ball,
      ),
    [scenario, time],
  );
  const selected = scenario.choices.find((choice) => choice.id === answer);
  const seek = (value: number) => {
    cursor.current = value;
    setTime(value);
    setPlaying(false);
  };
  useEffect(() => {
    if (!playing) return;
    let raf = 0,
      previous = 0;
    const animate = (now: number) => {
      cursor.current = Math.min(
        scenario.duration,
        cursor.current +
          (previous ? Math.min(0.1, (now - previous) / 1000) * speed : 0),
      );
      previous = now;
      setTime(cursor.current);
      if (cursor.current >= scenario.duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [playing, scenario, speed]);
  return (
    <div className="rule-animation">
      <div className="rule-animation-stage">
        <PlayCanvasViewport
          actors={scenario.actors}
          poses={frame.actors}
          robotVisual={robotVisual}
          cameraPreset={camera}
          showRuleGeometry={geometry}
          showBallTrail={showTrail}
          showContactEvidence={contact}
          ballTrail={trail}
          phaseLabel={frame.phaseLabel}
        />
        <output className="rule-scene-caption">
          <strong>{frame.phaseLabel}</strong>
        </output>
      </div>
      <div className="rule-player-controls">
        <Button
          aria-label={playing ? 'Pause situation' : 'Play situation'}
          onClick={() => {
            if (time >= scenario.duration) {
              cursor.current = 0;
              setTime(0);
            }
            setPlaying((value) => !value);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="outline"
          aria-label="Replay situation"
          onClick={() => {
            seek(0);
            setPlaying(true);
          }}
        >
          <RotateCcw />
        </Button>
        <Slider
          aria-label="Situation timeline"
          min={0}
          max={scenario.duration}
          step={0.02}
          value={[time]}
          onValueChange={(value) =>
            seek(Array.isArray(value) ? value[0] : value)
          }
        />
        <span>{time.toFixed(1)} s</span>
        <select
          aria-label="Situation speed"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>
      </div>
      <div className="lesson-tools">
        <select
          aria-label="Situation camera"
          value={camera}
          onChange={(event) => setCamera(event.target.value as CameraPreset)}
        >
          {(
            [
              'overhead',
              'broadcast',
              'referee',
              'ball',
              'blue',
              'yellow',
              'free',
            ] as const
          ).map((preset) => (
            <option key={preset} value={preset}>
              {preset === 'ball' ? 'Follow ball' : preset}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            const url = new URL(window.location.href);
            url.search = new URLSearchParams({
              embed: scenario.id,
              robot: robotVisual,
            }).toString();
            await navigator.clipboard.writeText(
              `<iframe src="${url}" title="${scenario.title}" loading="lazy" allowfullscreen></iframe>`,
            );
            setCopied(true);
          }}
        >
          <Code2 />
          {copied ? 'Embed copied' : 'Copy embed'}
        </Button>
        <label>
          <input
            type="checkbox"
            checked={geometry}
            onChange={(event) => setGeometry(event.target.checked)}
          />{' '}
          Rule geometry
        </label>
        <label>
          <input
            type="checkbox"
            checked={showTrail}
            onChange={(event) => setShowTrail(event.target.checked)}
          />{' '}
          Ball trail
        </label>
        <label>
          <input
            type="checkbox"
            checked={contact}
            onChange={(event) => setContact(event.target.checked)}
          />{' '}
          Contact evidence
        </label>
      </div>
      <p className="lesson-observation">{scenario.publicSummary}</p>
      <div className="lesson-evidence">
        <dl>
          {Object.entries(frame.metrics).map(([key, metric]) => (
            <div key={key}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
        <ul>
          {frame.evidence.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
      <section className="rule-question">
        <h3>{scenario.refereeCue}</h3>
        <div>
          {scenario.choices.map((choice) => (
            <Button
              variant="outline"
              key={choice.id}
              aria-pressed={answer === choice.id}
              onClick={() => {
                setAnswer(choice.id);
                onAnswer?.(choice.id);
                setPlaying(false);
                if (['correct', 'acceptable'].includes(choice.grade))
                  onPassed?.();
              }}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        {selected && (
          <output
            className={
              ['correct', 'acceptable'].includes(selected.grade)
                ? 'text-emerald-300'
                : 'text-amber-300'
            }
          >
            {selected.grade === 'acceptable'
              ? 'Acceptable referee discretion'
              : selected.grade === 'partial'
                ? 'Partly correct'
                : selected.grade === 'correct'
                  ? 'Correct'
                  : 'Try again'}{' '}
            · {Math.round(selected.score * 100)}% · {selected.feedback}
          </output>
        )}
        {studyScore && <p className="rule-small">{studyScore}</p>}
      </section>
    </div>
  );
}
