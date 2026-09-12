import {
  FIELD_CORNERS,
  homography,
  projectPoint,
  type Matrix3,
} from './geometry';
import {
  ACTOR_IDS,
  type Clip,
  type Seed,
  type TrackFrame,
  type TrackId,
  type TrackSample,
} from './project';
import { fitFieldBoundary } from './field-alignment';
import { DarkBallDetector } from './dark-ball';

export type Pixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};
type Candidate = {
  x: number;
  y: number;
  radius: number;
  score: number;
  turf: number;
};
type Identity = {
  seed: Seed;
  radius: number;
  descriptor: Float32Array;
  x: number;
  y: number;
  vx: number;
  vy: number;
  yaw: number;
  lastSeen: number;
  missing: boolean;
};
const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
const green = (r: number, g: number, b: number) =>
  g > 1.28 * r && g > 1.28 * b && g > 63.75;

/** Rotation-invariant two-ring colour distribution; immutable reference prevents template drift. */
function describe(image: Pixels, cx: number, cy: number, radius: number) {
  const bins = new Float32Array(128),
    count = [0, 0];
  const inner = radius * 0.57,
    stride = radius > 10 ? 2 : 1;
  for (let dy = -Math.ceil(radius); dy <= radius; dy += stride)
    for (let dx = -Math.ceil(radius); dx <= radius; dx += stride) {
      const distance = dx * dx + dy * dy;
      if (distance > radius * radius) continue;
      const x = Math.round(cx + dx),
        y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const i = (y * image.width + x) * 4,
        ring = distance < inner * inner ? 0 : 1;
      const bin =
        (image.data[i] >> 6) * 16 +
        (image.data[i + 1] >> 6) * 4 +
        (image.data[i + 2] >> 6);
      bins[ring * 64 + bin]++;
      count[ring]++;
    }
  for (let i = 0; i < bins.length; i++)
    bins[i] = Math.sqrt(bins[i] / Math.max(1, count[i >> 6]));
  return bins;
}
function similarity(a: Float32Array, b: Float32Array) {
  let result = 0;
  for (let i = 0; i < a.length; i++) result += a[i] * b[i];
  return result / 2;
}
type Mask = {
  width: number;
  height: number;
  foreground: Uint8Array;
  integral: Int32Array;
  turfFraction: number;
};
function maskImage(image: Pixels): Mask {
  const { width, height, data } = image;
  const foreground = new Uint8Array(width * height),
    integral = new Int32Array((width + 1) * (height + 1));
  let turf = 0;
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        p = i * 4;
      const fg = green(data[p], data[p + 1], data[p + 2]) ? 0 : 1;
      foreground[i] = fg;
      turf += 1 - fg;
      row += fg;
      integral[(y + 1) * (width + 1) + x + 1] =
        integral[y * (width + 1) + x + 1] + row;
    }
  }
  return {
    width,
    height,
    foreground,
    integral,
    turfFraction: turf / (width * height),
  };
}
const diskRows = new Map<number, { rows: number[]; area: number }>();
function disk(mask: Mask, x: number, y: number, radius: number) {
  const r = Math.max(1, Math.round(radius));
  let kernel = diskRows.get(r);
  if (!kernel) {
    const rows = Array.from({ length: r * 2 + 1 }, (_, i) =>
      Math.floor(Math.sqrt(r * r - (i - r) ** 2)),
    );
    kernel = { rows, area: rows.reduce((a, span) => a + span * 2 + 1, 0) };
    diskRows.set(r, kernel);
  }
  const cx = Math.round(x),
    cy = Math.round(y),
    pitch = mask.width + 1;
  let sum = 0,
    area = 0;
  for (let dy = -r; dy <= r; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= mask.height) continue;
    const span = kernel.rows[dy + r],
      lo = Math.max(0, cx - span),
      hi = Math.min(mask.width, cx + span + 1);
    if (hi <= lo) continue;
    sum +=
      mask.integral[(yy + 1) * pitch + hi] -
      mask.integral[(yy + 1) * pitch + lo] -
      mask.integral[yy * pitch + hi] +
      mask.integral[yy * pitch + lo];
    area += hi - lo;
  }
  return { sum, area, fraction: sum / Math.max(1, area) };
}
function occupancy(mask: Mask, x: number, y: number, radius: number) {
  const core = disk(mask, x, y, radius * 0.47).fraction;
  if (core < 0.4) return null;
  const body = disk(mask, x, y, radius).fraction;
  if (body < 0.4) return null;
  const outer = disk(mask, x, y, radius * 1.82),
    inner = disk(mask, x, y, radius * 1.35);
  const turf =
    1 - (outer.sum - inner.sum) / Math.max(1, outer.area - inner.area);
  return {
    core,
    body,
    turf,
    score: body * 0.7 + core * 0.3 - (1 - turf) * 0.2,
  };
}
function inside(h: Matrix3, x: number, y: number, image: Pixels) {
  const p = projectPoint(h, { x: x / image.width, y: y / image.height });
  // White touchlines are inside the carpet: keep the run-off but exclude goals/spectators.
  return Math.abs(p.x) <= 0.93 && Math.abs(p.y) <= 1.23;
}

/** Whole-field proposals on EVERY frame, independent of where a previous track ended. */
function robotCandidates(
  image: Pixels,
  mask: Mask,
  h: Matrix3,
  radius: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  const stride = Math.max(2, Math.round(image.width / 210));
  for (let y = radius; y < image.height - radius; y += stride)
    for (let x = radius; x < image.width - radius; x += stride) {
      if (
        !mask.foreground[Math.round(y) * image.width + Math.round(x)] ||
        !inside(h, x, y, image)
      )
        continue;
      const value = occupancy(mask, x, y, radius);
      if (value && value.turf > 0.22 && value.score > 0.48)
        candidates.push({ x, y, radius, ...value });
    }
  candidates.sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const c of candidates) {
    if (kept.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < radius * 1.65))
      continue;
    let best = c;
    for (let dy = -stride; dy <= stride; dy++)
      for (let dx = -stride; dx <= stride; dx++) {
        if (!inside(h, c.x + dx, c.y + dy, image)) continue;
        const next = occupancy(mask, c.x + dx, c.y + dy, radius);
        if (next && next.turf > 0.22 && next.score > best.score)
          best = { x: c.x + dx, y: c.y + dy, radius, ...next };
      }
    kept.push(best);
    if (kept.length === 40) break;
  }
  return kept;
}
function ballCandidates(
  image: Pixels,
  mask: Mask,
  h: Matrix3,
  radius: number,
  robots: Pick<Candidate, 'x' | 'y' | 'radius'>[],
) {
  const found: Candidate[] = [],
    step = Math.max(1, Math.round(radius / 2));
  for (let y = radius * 2; y < image.height - radius * 2; y += step)
    for (let x = radius * 2; x < image.width - radius * 2; x += step) {
      if (
        !mask.foreground[Math.round(y) * image.width + Math.round(x)] ||
        !inside(h, x, y, image)
      )
        continue;
      if (
        robots.some(
          (p) => Math.hypot(p.x - x, p.y - y) < p.radius * 1.3 + radius * 0.25,
        )
      )
        continue;
      const core = disk(mask, x, y, radius * 0.65).fraction;
      if (core < 0.72) continue;
      const outer = disk(mask, x, y, radius * 2),
        inner = disk(mask, x, y, radius * 1.15);
      const turf =
        1 - (outer.sum - inner.sum) / Math.max(1, outer.area - inner.area);
      if (turf < 0.68) continue;
      found.push({ x, y, radius, turf, score: core * 0.65 + turf * 0.35 });
    }
  found.sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const p of found) {
    if (!kept.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < radius * 1.5))
      kept.push(p);
    if (kept.length === 25) break;
  }
  return kept;
}
function signature(image: Pixels) {
  const values = [];
  for (let y = 0; y < 18; y++)
    for (let x = 0; x < 32; x++) {
      const i =
        (Math.floor(((y + 0.5) * image.height) / 18) * image.width +
          Math.floor(((x + 0.5) * image.width) / 32)) *
        4;
      values.push(image.data[i], image.data[i + 1], image.data[i + 2]);
    }
  return values;
}

/** Seeded object detection + one-to-one re-identification, without permanent lost-track shutdown. */
export class LocalTracker {
  private states = new Map<TrackId, Identity>();
  private h: Matrix3;
  private previousSignature: number[];
  private lastTime: number;
  private radius: number;
  private originalCorners: { x: number; y: number }[];
  private referenceBoundary: { x: number; y: number }[] | null = null;
  private currentCorners: { x: number; y: number }[];
  private lastAlignment = -Infinity;
  private referenceSignature: number[];
  private cameraBlocked = false;
  private darkBall: DarkBallDetector | null = null;
  constructor(
    private clip: Clip,
    image: Pixels,
    start: number,
  ) {
    this.h = homography(clip.corners, FIELD_CORNERS);
    this.originalCorners = clip.corners.map((p) => ({
      x: p.x * image.width,
      y: p.y * image.height,
    }));
    this.currentCorners = clip.corners;
    const boundary = fitFieldBoundary(image, this.originalCorners);
    if (boundary.valid) this.referenceBoundary = boundary.corners;
    this.lastTime = start;
    this.previousSignature = signature(image);
    this.referenceSignature = this.previousSignature;
    const radii = ACTOR_IDS.filter((id) => id !== 'ball' && clip.seeds[id])
      .map((id) => clip.seeds[id]!.radius * image.width)
      .sort((a, b) => a - b);
    this.radius =
      (radii[Math.floor(radii.length / 2)] ?? image.width * 0.033) * 0.82;
    for (const id of ACTOR_IDS) {
      const seed = clip.seeds[id];
      if (!seed) continue;
      const x = seed.x * image.width,
        y = seed.y * image.height,
        radius = Math.max(3, seed.radius * image.width);
      if (id === 'ball')
        this.darkBall = DarkBallDetector.fromReference(image, x, y, radius);
      this.states.set(id, {
        seed,
        radius,
        descriptor: describe(image, x, y, radius),
        x,
        y,
        vx: 0,
        vy: 0,
        yaw: seed.yaw,
        lastSeen: start,
        missing: false,
      });
    }
  }
  private sample(
    id: TrackId,
    s: Identity,
    image: Pixels,
    confidence: number,
    origin: 'manual' | 'tracked',
  ): TrackSample {
    const p = projectPoint(this.h, {
      x: s.x / image.width,
      y: s.y / image.height + s.seed.groundOffset,
    });
    return {
      x: p.x,
      z: p.y,
      imageX: s.x / image.width,
      imageY: s.y / image.height,
      yaw: s.yaw,
      confidence,
      origin,
      heading: origin === 'manual' ? 'manual' : 'estimated',
    };
  }
  initial(image: Pixels, time: number): TrackFrame {
    return {
      time,
      actors: Object.fromEntries(
        [...this.states].map(([id, s]) => [
          id,
          this.sample(id, s, image, 1, 'manual'),
        ]),
      ),
    };
  }
  /** Re-anchor a corrected frame without forgetting the references of hidden actors. */
  resume(
    image: Pixels,
    time: number,
    seeds: Clip['seeds'],
    corners: Clip['corners'],
  ): TrackFrame {
    this.currentCorners = corners;
    this.h = homography(corners, FIELD_CORNERS);
    this.originalCorners = corners.map((p) => ({
      x: p.x * image.width,
      y: p.y * image.height,
    }));
    const boundary = fitFieldBoundary(image, this.originalCorners);
    this.referenceBoundary = boundary.valid ? boundary.corners : null;
    this.lastAlignment = time;
    this.referenceSignature = signature(image);
    this.previousSignature = this.referenceSignature;
    this.cameraBlocked = false;
    this.lastTime = time;
    const actors: TrackFrame['actors'] = {};
    for (const s of this.states.values()) {
      s.missing = true;
      s.vx = s.vy = 0;
    }
    for (const id of ACTOR_IDS) {
      const seed = seeds[id];
      if (!seed) continue;
      const x = seed.x * image.width,
        y = seed.y * image.height;
      const radius = Math.max(3, seed.radius * image.width);
      if (id === 'ball')
        this.darkBall = DarkBallDetector.fromReference(image, x, y, radius);
      const state: Identity = {
        seed,
        x,
        y,
        radius,
        descriptor: describe(image, x, y, radius),
        vx: 0,
        vy: 0,
        yaw: seed.yaw,
        lastSeen: time,
        missing: false,
      };
      this.states.set(id, state);
      actors[id] = this.sample(id, state, image, 1, 'manual');
    }
    return { time, actors, corners };
  }
  step(
    image: Pixels,
    time: number,
  ): {
    frame: TrackFrame;
    cut: boolean;
    lost: TrackId[];
    reacquired: TrackId[];
  } {
    const dt = time - this.lastTime;
    this.lastTime = time;
    const sig = signature(image);
    let changed = 0;
    for (let i = 0; i < sig.length; i += 3)
      if (
        (Math.abs(sig[i] - this.previousSignature[i]) +
          Math.abs(sig[i + 1] - this.previousSignature[i + 1]) +
          Math.abs(sig[i + 2] - this.previousSignature[i + 2])) /
          3 >
        61
      )
        changed++;
    this.previousSignature = sig;
    const mask = maskImage(image);
    const cut = changed > (sig.length / 3) * 0.48;
    if (cut) this.cameraBlocked = true;
    if (this.cameraBlocked && mask.turfFraction >= 0.08) {
      let different = 0;
      for (let i = 0; i < sig.length; i += 3)
        if (
          (Math.abs(sig[i] - this.referenceSignature[i]) +
            Math.abs(sig[i + 1] - this.referenceSignature[i + 1]) +
            Math.abs(sig[i + 2] - this.referenceSignature[i + 2])) /
            3 >
          61
        )
          different++;
      if (different < (sig.length / 3) * 0.3) this.cameraBlocked = false;
    }
    // No blind extrapolation over a title card. Keep identities alive for the next visible field.
    if (mask.turfFraction < 0.08 || this.cameraBlocked) {
      for (const s of this.states.values()) {
        s.missing = true;
        s.vx = 0;
        s.vy = 0;
      }
      return {
        frame: { time, actors: {} },
        cut,
        lost: [...this.states.keys()],
        reacquired: [],
      };
    }
    let aligned = false;
    if (this.referenceBoundary && Math.abs(time - this.lastAlignment) >= 1) {
      this.lastAlignment = time;
      const boundary = fitFieldBoundary(image, this.originalCorners);
      if (boundary.valid) {
        const shift = homography(this.referenceBoundary, boundary.corners);
        const nextCorners = this.originalCorners.map((p) => {
          const q = projectPoint(shift, p);
          return { x: q.x / image.width, y: q.y / image.height };
        });
        const cameraMotion = homography(this.currentCorners, nextCorners);
        for (const state of this.states.values()) {
          const p = projectPoint(cameraMotion, {
            x: state.x / image.width,
            y: state.y / image.height,
          });
          const v = projectPoint(cameraMotion, {
            x: (state.x + state.vx) / image.width,
            y: (state.y + state.vy) / image.height,
          });
          state.x = p.x * image.width;
          state.y = p.y * image.height;
          state.vx = (v.x - p.x) * image.width;
          state.vy = (v.y - p.y) * image.height;
        }
        this.currentCorners = nextCorners;
        this.h = homography(this.currentCorners, FIELD_CORNERS);
        aligned = true;
      }
    }
    const candidates = robotCandidates(image, mask, this.h, this.radius);
    const ids = ACTOR_IDS.filter((id) => id !== 'ball' && this.states.has(id));
    const options = ids.map((id) => {
      const s = this.states.get(id)!;
      const gap = time - s.lastSeen;
      const recent = dt > 0 && dt < 0.6 && gap > 0 && gap < 0.8 && !s.missing;
      return candidates
        .map((c, index) => {
          let appearance = 0;
          for (const scale of [0.85, 1, 1.15]) {
            const candidate = describe(image, c.x, c.y, s.radius * scale);
            appearance = Math.max(
              appearance,
              similarity(s.descriptor, candidate),
            );
          }
          const distance = Math.hypot(
            c.x - (s.x + s.vx * Math.max(0, dt)),
            c.y - (s.y + s.vy * Math.max(0, dt)),
          );
          const motion = recent
            ? Math.min(
                1,
                distance /
                  Math.max(
                    image.width * Math.min(gap, 0.5) * 0.85,
                    s.radius * 2,
                  ),
              )
            : 0;
          const score = appearance - 0.09 * motion + 0.04 * c.score;
          return { index, score, appearance };
        })
        .filter((p) => p.appearance > 0.78)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);
    });
    // Four identities, each assigned to at most one proposal; an explicit unmatched choice avoids inventing a fifth robot.
    let best = -Infinity,
      selected: ((typeof options)[number][number] | null)[] = [];
    const visit = (
      i: number,
      used: Set<number>,
      score: number,
      values: ((typeof options)[number][number] | null)[],
    ) => {
      if (i === ids.length) {
        if (score > best) {
          best = score;
          selected = [...values];
        }
        return;
      }
      visit(i + 1, used, score + 0.78, [...values, null]);
      for (const option of options[i]) {
        if (used.has(option.index)) continue;
        used.add(option.index);
        visit(i + 1, used, score + option.score, [...values, option]);
        used.delete(option.index);
      }
    };
    visit(0, new Set(), 0, []);
    const actors: TrackFrame['actors'] = {},
      reacquired: TrackId[] = [];
    const accept = (id: TrackId, c: Candidate, confidence: number) => {
      const s = this.states.get(id)!;
      const gap = time - s.lastSeen,
        wasMissing =
          s.missing || gap > Math.max(0.8, 2 / this.clip.fps) || gap <= 0;
      if (wasMissing) reacquired.push(id);
      const old = this.sample(id, s, image, 1, 'tracked');
      s.vx =
        !wasMissing && gap > 0
          ? clamp((c.x - s.x) / gap, -image.width, image.width) * 0.55 +
            s.vx * 0.45
          : 0;
      s.vy =
        !wasMissing && gap > 0
          ? clamp((c.y - s.y) / gap, -image.width, image.width) * 0.55 +
            s.vy * 0.45
          : 0;
      s.x = c.x;
      s.y = c.y;
      s.lastSeen = time;
      s.missing = false;
      const value = this.sample(
        id,
        s,
        image,
        clamp(confidence, 0.3, 0.95),
        'tracked',
      );
      if (!wasMissing && Math.hypot(value.x - old.x, value.z - old.z) > 0.012)
        s.yaw = Math.atan2(value.x - old.x, value.z - old.z);
      value.yaw = s.yaw;
      actors[id] = value;
    };
    ids.forEach((id, i) => {
      const option = selected[i];
      if (option) {
        const alternative = options[i].find((p) => p.index !== option.index);
        const margin = option.score - (alternative?.score ?? 0);
        accept(
          id,
          candidates[option.index],
          margin < 0.025 ? 0.64 : option.appearance,
        );
      } else {
        const s = this.states.get(id)!;
        s.missing = true;
        s.vx = 0;
        s.vy = 0;
      }
    });
    const ball = this.states.get('ball');
    if (ball) {
      const bodies = ids.flatMap((id) => {
        const s = this.states.get(id)!;
        return actors[id] ? [{ x: s.x, y: s.y, radius: s.radius }] : [];
      });
      const darkProposals = this.darkBall?.detect(image, bodies, (x, y) => {
        const p = projectPoint(this.h, {
          x: x / image.width,
          y: y / image.height,
        });
        return Math.abs(p.x) <= 1.04 && Math.abs(p.y) <= 1.35;
      });
      const proposals =
        darkProposals ??
        ballCandidates(
          image,
          mask,
          this.h,
          ball.radius,
          bodies.filter((c) => c.radius > ball.radius * 1.5),
        );
      const gap = time - ball.lastSeen,
        recent = dt > 0 && dt < 0.6 && gap > 0 && gap < 0.6 && !ball.missing;
      const options = proposals
        .map((c) => {
          const appearance =
            'appearance' in c
              ? Number(c.appearance)
              : similarity(
                  ball.descriptor,
                  describe(image, c.x, c.y, ball.radius),
                );
          const distance = Math.hypot(
            c.x - (ball.x + ball.vx * Math.max(0, dt)),
            c.y - (ball.y + ball.vy * Math.max(0, dt)),
          );
          return {
            c,
            appearance,
            score:
              appearance +
              c.score * (darkProposals ? 0.1 : 0.03) -
              (recent
                ? 0.07 *
                  Math.min(
                    1,
                    distance / Math.max(image.width * gap, ball.radius * 5),
                  )
                : 0),
          };
        })
        .filter((p) => p.appearance > (darkProposals ? 0.68 : 0.72))
        .sort((a, b) => b.score - a.score);
      const first = options[0];
      // Multiple matching balls (e.g. halftime equipment on carpet) are not a confident match-ball identity.
      if (first && (!options[1] || first.score - options[1].score > 0.012))
        accept('ball', first.c, first.appearance);
      else {
        ball.missing = true;
        ball.vx = 0;
        ball.vy = 0;
      }
    }
    return {
      frame: {
        time,
        actors,
        ...(aligned ? { corners: this.currentCorners } : {}),
      },
      cut,
      lost: [...this.states.keys()].filter((id) => !actors[id]),
      reacquired,
    };
  }
}
