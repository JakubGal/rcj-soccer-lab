import { z } from 'zod';
import type { Pose } from '../simulator/types';
import {
  FIELD_CORNERS,
  homography,
  projectPoint,
  shortAngle,
  validCorners,
} from './geometry';

export const ACTOR_IDS = [
  'blue-1',
  'blue-2',
  'yellow-1',
  'yellow-2',
  'ball',
] as const;
export type TrackId = (typeof ACTOR_IDS)[number];
export const TRACK_LABELS: Record<TrackId, string> = {
  'blue-1': 'Blue 1',
  'blue-2': 'Blue 2',
  'yellow-1': 'Yellow 1',
  'yellow-2': 'Yellow 2',
  ball: 'Ball',
};
export const EVENT_KINDS = [
  'goal',
  'score',
  'out',
  'damaged',
  'pushed-out',
  'kickoff',
  'pause',
  'resume',
  'period',
  'side-swap',
  'note',
  'tracking-gap',
  'camera-cut',
] as const;
export const EVENT_LABELS: Record<(typeof EVENT_KINDS)[number], string> = {
  goal: 'Goal',
  score: 'Set score',
  out: 'out of bounds',
  damaged: 'damaged',
  'pushed-out': 'pushed out',
  kickoff: 'Kickoff',
  pause: 'Pause',
  resume: 'Resume',
  period: 'New period',
  'side-swap': 'Swap ends',
  note: 'Note',
  'tracking-gap': 'Tracking gap',
  'camera-cut': 'Camera cut',
};
const finite = z.number();
const time = finite.min(0).max(604800);
const point = z
  .object({ x: finite.min(0).max(1), y: finite.min(0).max(1) })
  .strict();
const seed = point
  .extend({
    radius: finite.min(0.002).max(0.15),
    groundOffset: finite.min(-0.15).max(0.15),
    yaw: finite.min(-10).max(10),
  })
  .strict();
const sample = z
  .object({
    x: finite.min(-5).max(5),
    z: finite.min(-5).max(5),
    yaw: finite.min(-100000).max(100000),
    imageX: finite.min(-0.1).max(1.1),
    imageY: finite.min(-0.1).max(1.1),
    confidence: finite.min(0).max(1),
    origin: z.enum(['tracked', 'manual']),
    heading: z.enum(['estimated', 'manual']),
  })
  .strict();
const tracks = z
  .object({
    'blue-1': sample.optional(),
    'blue-2': sample.optional(),
    'yellow-1': sample.optional(),
    'yellow-2': sample.optional(),
    ball: sample.optional(),
  })
  .strict();
const seeds = z
  .object({
    'blue-1': seed.optional(),
    'blue-2': seed.optional(),
    'yellow-1': seed.optional(),
    'yellow-2': seed.optional(),
    ball: seed.optional(),
  })
  .strict();
const frame = z
  .object({
    time,
    actors: tracks,
    corners: z.array(point).length(4).optional(),
  })
  .strict();
const clip = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().max(100),
    start: time,
    end: time,
    corners: z.array(point).max(4),
    seeds,
    frames: z.array(frame).max(200000),
    fps: z.number().int().min(2).max(20),
    referenceTime: time.optional(),
    ballDiameter: z.enum(['42', '74']),
    blueAttacksPositive: z.boolean(),
  })
  .strict();
const event = z
  .object({
    id: z.string().min(1).max(160),
    clipId: z.string().max(80),
    time,
    kind: z.enum(EVENT_KINDS),
    status: z.enum(['suggested', 'confirmed', 'dismissed']),
    team: z.enum(['blue', 'yellow']).optional(),
    actor: z.enum(ACTOR_IDS).optional(),
    note: z.string().max(500),
    score: z
      .object({
        blue: z.number().int().min(0).max(999),
        yellow: z.number().int().min(0).max(999),
      })
      .strict()
      .optional(),
  })
  .strict();
export const PROJECT_SCHEMA = z
  .object({
    format: z.literal('rcj-match-reconstruction'),
    version: z.literal(1),
    title: z.string().max(150),
    source: z
      .object({
        name: z.string().max(500),
        size: finite.min(0).max(1e13),
        lastModified: finite.min(0),
        duration: time,
        width: z.number().int().min(1).max(16384),
        height: z.number().int().min(1).max(16384),
      })
      .strict(),
    initialScore: z
      .object({
        blue: z.number().int().min(0).max(999),
        yellow: z.number().int().min(0).max(999),
      })
      .strict(),
    clips: z.array(clip).max(200),
    events: z.array(event).max(20000),
  })
  .strict();
export type ReconstructionProject = z.infer<typeof PROJECT_SCHEMA>;
export type Clip = ReconstructionProject['clips'][number];
export type TrackFrame = Clip['frames'][number];
export type TrackSample = z.infer<typeof sample>;
export type Seed = z.infer<typeof seed>;
export type ReconstructionEvent = z.infer<typeof event>;
export const MAX_PROJECT_BYTES = 128 * 1024 * 1024;
export const MAX_SAMPLES = 100000;
export const newId = () => globalThis.crypto.randomUUID();

export function parseProject(text: string): ReconstructionProject {
  if (text.length > MAX_PROJECT_BYTES)
    throw new Error('This replay file is too large (128 MB limit).');
  const parsed = PROJECT_SCHEMA.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(
      'This is not a supported RCJ reconstruction file (version 1).',
    );
  const p = parsed.data;
  const ids = new Set<string>();
  let count = 0;
  for (const c of p.clips) {
    if (
      ids.has(c.id) ||
      c.end <= c.start ||
      c.end > p.source.duration + 0.05 ||
      c.end - c.start > 3600 ||
      (c.referenceTime !== undefined && c.referenceTime > p.source.duration) ||
      (c.corners.length === 4 && !validCorners(c.corners)) ||
      (c.frames.length > 0 && c.corners.length !== 4)
    )
      throw new Error('Invalid clip range or camera calibration.');
    ids.add(c.id);
    let last = -1;
    for (const f of c.frames) {
      if (
        f.time <= last ||
        f.time < c.start - 0.001 ||
        f.time > c.end + 0.001 ||
        (f.corners && !validCorners(f.corners))
      )
        throw new Error(
          'Replay samples must be ordered and inside their clip.',
        );
      last = f.time;
    }
    count += c.frames.length;
  }
  if (count > MAX_SAMPLES)
    throw new Error('Replay has too many samples (100,000 limit).');
  const eventIds = new Set<string>();
  for (const e of p.events) {
    const c = p.clips.find((c) => c.id === e.clipId);
    if (
      !c ||
      e.time < c.start ||
      e.time > c.end ||
      eventIds.has(e.id) ||
      (e.kind === 'goal' && !e.team) ||
      (e.kind === 'score' && !e.score)
    )
      throw new Error('Invalid timeline event.');
    eventIds.add(e.id);
  }
  return p;
}

/** Five decimals preserve sub-millimetre field positions while keeping long replays portable. */
export function serializeProject(project: ReconstructionProject): string {
  const text = JSON.stringify(project, (_key, value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value * 100000) / 100000
      : value,
  );
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES)
    throw new Error('This replay file is too large (128 MB limit).');
  parseProject(text);
  return text;
}

export function makeProject(
  source: ReconstructionProject['source'],
): ReconstructionProject {
  return {
    format: 'rcj-match-reconstruction',
    version: 1,
    title: source.name.replace(/\.[^.]+$/, ''),
    source,
    initialScore: { blue: 0, yellow: 0 },
    clips: [],
    events: [],
  };
}
export function makeClip(start: number, end: number): Clip {
  return {
    id: newId(),
    label: 'Clip',
    start,
    end,
    corners: [],
    seeds: {},
    frames: [],
    fps: 10,
    ballDiameter: '42',
    blueAttacksPositive: true,
  };
}
export function duration(p: ReconstructionProject) {
  return p.clips.reduce((n, c) => n + c.end - c.start, 0);
}
export function locate(p: ReconstructionProject, at: number) {
  let offset = 0;
  for (const [index, c] of p.clips.entries()) {
    const length = c.end - c.start;
    if (at < offset + length || index === p.clips.length - 1)
      return {
        clip: c,
        time: c.start + Math.max(0, Math.min(length, at - offset)),
        offset,
      };
    offset += length;
  }
  return null;
}
export function timelineTime(
  p: ReconstructionProject,
  clipId: string,
  sourceTime: number,
) {
  let offset = 0;
  for (const c of p.clips) {
    if (c.id === clipId) return offset + sourceTime - c.start;
    offset += c.end - c.start;
  }
  return 0;
}
export function sampleClip(
  c: Clip,
  time: number,
): Partial<Record<TrackId, TrackSample>> {
  const frames = c.frames;
  if (
    !frames.length ||
    time < frames[0].time - 0.001 ||
    time > frames[frames.length - 1].time + 0.001
  )
    return {};
  let low = 0,
    high = frames.length - 1;
  while (low < high) {
    const m = Math.ceil((low + high) / 2);
    if (frames[m].time <= time) low = m;
    else high = m - 1;
  }
  const a = frames[low],
    b = frames[Math.min(low + 1, frames.length - 1)];
  if (Math.abs(time - a.time) < 0.0001) return a.actors;
  if (b.time - a.time > Math.max(0.6, 1.5 / c.fps)) return {};
  const alpha = a === b ? 0 : (time - a.time) / (b.time - a.time);
  const result: Partial<Record<TrackId, TrackSample>> = {};
  for (const id of ACTOR_IDS) {
    const x = a.actors[id],
      y = b.actors[id];
    if (!x || !y) continue;
    result[id] = {
      ...x,
      x: x.x + (y.x - x.x) * alpha,
      z: x.z + (y.z - x.z) * alpha,
      yaw: shortAngle(x.yaw, y.yaw, alpha),
      imageX: x.imageX + (y.imageX - x.imageX) * alpha,
      imageY: x.imageY + (y.imageY - x.imageY) * alpha,
      confidence: Math.min(x.confidence, y.confidence),
    };
  }
  return result;
}
export function renderPoses(
  samples: Partial<Record<TrackId, TrackSample>>,
): Record<string, Pose> {
  return Object.fromEntries(
    Object.entries(samples).map(([id, p]) => [
      id,
      { x: p.x, z: p.z, yaw: p.yaw },
    ]),
  );
}
export function scoreAt(p: ReconstructionProject, at: number) {
  let score = { ...p.initialScore };
  const events = p.events
    .filter((e) => e.status === 'confirmed')
    .map((e) => ({ e, at: timelineTime(p, e.clipId, e.time) }))
    .sort((a, b) => a.at - b.at);
  for (const { e, at: t } of events)
    if (t <= at + 0.0001) {
      if (e.kind === 'score' && e.score) score = { ...e.score };
      if (e.kind === 'goal' && e.team) score[e.team]++;
    }
  return score;
}
/** Latest accepted white-line calibration, with original corners as a safe fallback. */
export function fieldCornersAt(c: Clip, time: number) {
  let lo = 0,
    hi = c.frames.length;
  while (lo < hi) {
    const middle = (lo + hi) >> 1;
    if (c.frames[middle].time <= time) lo = middle + 1;
    else hi = middle;
  }
  for (let i = lo - 1; i >= 0; i--)
    if (c.frames[i].corners) return c.frames[i].corners!;
  return c.corners;
}
export function manualSample(
  c: Clip,
  id: TrackId,
  point: { x: number; y: number },
  yaw = 0,
  time = c.referenceTime ?? c.start,
): TrackSample {
  const h = homography(fieldCornersAt(c, time), FIELD_CORNERS);
  const ground = projectPoint(h, {
    x: point.x,
    y: point.y + (c.seeds[id]?.groundOffset ?? 0),
  });
  return {
    x: ground.x,
    z: ground.y,
    yaw,
    imageX: point.x,
    imageY: point.y,
    confidence: 1,
    origin: 'manual',
    heading: 'manual',
  };
}
export function correctAt(
  c: Clip,
  time: number,
  id: TrackId,
  value: TrackSample | null,
): Clip {
  const actors = { ...sampleClip(c, time) };
  if (value) actors[id] = value;
  else delete actors[id];
  const frames = c.frames.filter((f) => Math.abs(f.time - time) > 0.001);
  frames.push({ time, actors, corners: fieldCornersAt(c, time) });
  frames.sort((a, b) => a.time - b.time);
  return { ...c, frames };
}

export function trimClip(
  project: ReconstructionProject,
  clipId: string,
  start: number,
  end: number,
): ReconstructionProject {
  const c = project.clips.find((c) => c.id === clipId);
  if (
    !c ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < c.start ||
    end > c.end ||
    start >= end
  )
    throw new Error(
      'Trim must stay inside the selected clip. Add a new clip to include different footage.',
    );
  const samples = sampleClip(c, start);
  // Trimming the timeline must not discard an exemplar because that actor is hidden at the new start.
  const seeds = c.seeds;
  const referenceTime = c.referenceTime ?? c.start;
  const frames = c.frames.filter((f) => f.time >= start && f.time <= end);
  if (frames.length)
    frames[0] = { ...frames[0], corners: fieldCornersAt(c, frames[0].time) };
  if (Object.keys(samples).length && (!frames.length || frames[0].time > start))
    frames.unshift({
      time: start,
      actors: samples,
      corners: fieldCornersAt(c, start),
    });
  return {
    ...project,
    clips: project.clips.map((clip) =>
      clip.id === clipId
        ? { ...c, start, end, referenceTime, seeds, frames }
        : clip,
    ),
    events: project.events.filter(
      (e) => e.clipId !== clipId || (e.time >= start && e.time <= end),
    ),
  };
}
/** Index-based sampling avoids accumulated drift, including when resuming mid-clip. */
export function trackingSampleTimes(start: number, end: number, fps: number) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    !Number.isInteger(fps) ||
    fps < 2 ||
    fps > 20 ||
    end - start > 3600
  )
    throw new Error('Invalid tracking interval.');
  const intervals = (end - start) * fps;
  // Floating-point subtraction must not produce a duplicate near the endpoint.
  const steps =
    Math.abs(intervals - Math.round(intervals)) < 1e-7
      ? Math.round(intervals)
      : Math.ceil(intervals);
  return Array.from({ length: steps + 1 }, (_, index) =>
    index === steps ? end : start + index / fps,
  );
}

export function formatTime(seconds: number, precise = false) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const milliseconds = Math.round(safe * 1000);
  const t = precise ? Math.floor(milliseconds / 1000) : Math.floor(safe);
  const whole = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  return precise
    ? `${whole}.${String(milliseconds % 1000).padStart(3, '0')}`
    : whole;
}
