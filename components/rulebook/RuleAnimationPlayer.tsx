'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  PlayCanvasViewport,
  type CameraPreset,
} from '@/components/simulator/PlayCanvasViewport';
import {
  RULE_ACTORS,
  sampleClip,
  type RuleClip,
} from '@/lib/rulebook/animations';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import { cn } from '@/lib/utils';

export function RuleAnimationPlayer({
  clips,
  robotVisual,
  onPassed,
}: {
  clips: RuleClip[];
  robotVisual: RobotVisualId;
  onPassed?: () => void;
}) {
  const [clipId, setClipId] = useState(clips[0].id);
  const clip = clips.find((item) => item.id === clipId) ?? clips[0];
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [camera, setCamera] = useState<CameraPreset>('overhead');
  const [speed, setSpeed] = useState(1);
  const [answer, setAnswer] = useState<number | null>(null);
  const duration = clip.frames[clip.frames.length - 1].at;
  const scene = useMemo(() => sampleClip(clip, time), [clip, time]);
  const trail = useMemo(
    () =>
      Array.from(
        { length: 30 },
        (_, index) =>
          sampleClip(clip, Math.max(0, time - 1.5 + (index / 29) * 1.5)).poses
            .ball,
      ).filter(Boolean),
    [clip, time],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = 0;
    const animate = (now: number) => {
      const delta = previous
        ? Math.min((now - previous) / 1000, 0.08) * speed
        : 0;
      previous = now;
      timeRef.current = Math.min(duration, timeRef.current + delta);
      setTime(timeRef.current);
      if (timeRef.current >= duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [duration, playing, speed]);

  const ended = time >= duration;
  const seek = (at: number) => {
    setPlaying(false);
    timeRef.current = at;
    setTime(at);
  };
  const choose = (id: string) => {
    setClipId(id);
    timeRef.current = 0;
    setTime(0);
    setPlaying(false);
    setAnswer(null);
  };

  return (
    <div className="rule-animation">
      <div className="rule-example-list" aria-label="Animated examples">
        {clips.map((item, index) => (
          <Button
            key={item.id}
            variant={item.id === clip.id ? 'secondary' : 'outline'}
            aria-pressed={item.id === clip.id}
            onClick={() => choose(item.id)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {item.title}
          </Button>
        ))}
      </div>
      <div className="rule-animation-stage">
        <PlayCanvasViewport
          actors={RULE_ACTORS}
          poses={scene.poses}
          actorHeights={scene.heights}
          cameraPreset={camera}
          showRuleGeometry={false}
          showBallTrail
          showContactEvidence={false}
          ballTrail={trail}
          phaseLabel={scene.label}
          robotVisual={robotVisual}
          selectedActorId={scene.focus}
        />
        <output className="rule-scene-caption">
          <strong>{scene.label}</strong>
          {scene.readout && <span>{scene.readout}</span>}
        </output>
        <div className="rule-scene-camera">
          <NativeSelect
            size="sm"
            aria-label="Example camera"
            value={camera}
            onChange={(event) => setCamera(event.target.value as CameraPreset)}
          >
            <NativeSelectOption value="overhead">Overhead</NativeSelectOption>
            <NativeSelectOption value="broadcast">3D view</NativeSelectOption>
            <NativeSelectOption value="referee">
              Referee view
            </NativeSelectOption>
            <NativeSelectOption value="ball">Follow ball</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      <div className="rule-player-controls">
        <Button
          aria-label={playing && !ended ? 'Pause example' : 'Play example'}
          onClick={() => {
            if (ended) {
              timeRef.current = 0;
              setTime(0);
              setPlaying(true);
            } else setPlaying((current) => !current);
          }}
        >
          {playing && !ended ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          aria-label="Restart example"
          onClick={() => seek(0)}
        >
          <RotateCcw />
        </Button>
        <Slider
          aria-label="Example timeline"
          min={0}
          max={duration}
          step={0.02}
          value={[time]}
          onValueChange={(value) =>
            seek(Array.isArray(value) ? value[0] : value)
          }
        />
        <span>
          {time.toFixed(1)} / {duration.toFixed(0)} s
        </span>
        <NativeSelect
          size="sm"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          aria-label="Example playback speed"
        >
          <NativeSelectOption value={0.5}>0.5×</NativeSelectOption>
          <NativeSelectOption value={1}>1×</NativeSelectOption>
          <NativeSelectOption value={2}>2×</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="rule-story-steps" aria-label="Animation key moments">
        {clip.frames.map((frame, index) => (
          <Button
            key={index}
            variant="ghost"
            className={cn(
              time >= frame.at &&
                (index === clip.frames.length - 1 ||
                  time < clip.frames[index + 1].at) &&
                'rule-step-active',
            )}
            onClick={() => seek(frame.at)}
          >
            <span>{index + 1}</span>
            {frame.label}
          </Button>
        ))}
      </div>
      <div className="rule-question">
        <h3>{clip.question}</h3>
        <div>
          {clip.options.map((option, index) => (
            <Button
              key={option}
              variant="outline"
              aria-pressed={answer === index}
              onClick={() => {
                setAnswer(index);
                if (index === clip.answer) onPassed?.();
              }}
              className={cn(
                answer === index &&
                  (index === clip.answer
                    ? 'rule-answer-correct'
                    : 'rule-answer-retry'),
              )}
            >
              {answer === index && index === clip.answer && <Check />}
              {option}
            </Button>
          ))}
        </div>
        {answer !== null && (
          <output
            className={
              answer === clip.answer ? 'text-emerald-300' : 'text-amber-300'
            }
          >
            {answer === clip.answer ? 'That’s right. ' : 'Look again. '}
            {clip.feedback}
          </output>
        )}
      </div>
      <p className="rule-small">
        Authored teaching examples. Movement and waiting periods may be
        compressed. Use the complete official paragraph for conditions and
        exceptions.
      </p>
    </div>
  );
}
