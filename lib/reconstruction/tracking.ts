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

export type Pixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};
type Patch = { rgb: Float32Array; foreground: number; core: number };
type State = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  yaw: number;
  radius: number;
  seed: Seed;
  patch: Patch;
  lost: number;
};
const ANGLES = 16;
const RINGS = [0, 0.23, 0.45, 0.67, 0.86, 1.03];
const WEIGHTS = [0.2, 0.6, 1, 1, 1, 0.65];
const OFFSETS = RINGS.flatMap((radius) =>
  Array.from({ length: ANGLES }, (_, i) => [
    radius * Math.cos((i * Math.PI * 2) / ANGLES),
    radius * Math.sin((i * Math.PI * 2) / ANGLES),
  ]),
);
const clamp = (v: number, low: number, high: number) =>
  Math.max(low, Math.min(high, v));

function patchAt(image: Pixels, cx: number, cy: number, radius: number): Patch {
  const rgb = new Float32Array(OFFSETS.length * 3);
  let foreground = 0,
    core = 0;
  OFFSETS.forEach(([x, y], i) => {
    const index =
      (clamp(Math.round(cy + y * radius), 0, image.height - 1) * image.width +
        clamp(Math.round(cx + x * radius), 0, image.width - 1)) *
      4;
    for (let k = 0; k < 3; k++) {
      const value = image.data[index + k] / 255;
      rgb[i * 3 + k] = value;
    }
    if (i < ANGLES * 5) {
      const r = rgb[i * 3],
        g = rgb[i * 3 + 1],
        b = rgb[i * 3 + 2];
      if (!(g > 1.28 * r && g > 1.28 * b && g > 0.25)) {
        if (i >= ANGLES) foreground++;
        if (i < ANGLES * 3) core++;
      }
    }
  });
  return {
    rgb,
    foreground: foreground / (ANGLES * 4),
    core: core / (ANGLES * 3),
  };
}
function similarity(a: Patch, b: Patch, ball = false) {
  // Circular shifts of concentric rings compare every robot rotation. A square
  // template treats a turning robot as a different object and immediately drifts.
  let bestError = Infinity;
  for (let shift = 0; shift < ANGLES; shift++) {
    let error = 0;
    for (let ring = 0; ring < RINGS.length; ring++) {
      for (let angle = 0; angle < ANGLES; angle++) {
        const ai = (ring * ANGLES + angle) * 3;
        const bi = (ring * ANGLES + ((angle + shift) % ANGLES)) * 3;
        error +=
          WEIGHTS[ring] *
          (Math.abs(a.rgb[ai] - b.rgb[bi]) +
            Math.abs(a.rgb[ai + 1] - b.rgb[bi + 1]) +
            Math.abs(a.rgb[ai + 2] - b.rgb[bi + 2]));
      }
      if (error >= bestError) break;
    }
    bestError = Math.min(bestError, error);
  }
  // A narrow white boundary is not a whole white robot: require body occupancy.
  return clamp(
    1 -
      bestError / a.rgb.length / 0.4 -
      (ball ? 0 : Math.max(0, a.foreground - b.foreground) * 0.25),
    0,
    1,
  );
}
function smooth(image: Pixels): Pixels {
  const { width, height, data } = image;
  const blurred = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            sum +=
              data[
                (clamp(y + dy, 0, height - 1) * width +
                  clamp(x + dx, 0, width - 1)) *
                  4 +
                  k
              ];
        blurred[out + k] = sum / 9;
      }
      blurred[out + 3] = 255;
    }
  return { width, height, data: blurred };
}

function turfAround(image: Pixels, x: number, y: number, radius: number) {
  let count = 0;
  for (const ring of [1.55, 1.85])
    for (let i = 0; i < 16; i++) {
      const px = clamp(
        Math.round(x + Math.cos((i * Math.PI) / 8) * radius * ring),
        0,
        image.width - 1,
      );
      const py = clamp(
        Math.round(y + Math.sin((i * Math.PI) / 8) * radius * ring),
        0,
        image.height - 1,
      );
      const index = (py * image.width + px) * 4;
      const r = image.data[index],
        g = image.data[index + 1],
        b = image.data[index + 2];
      if (g > 1.28 * r && g > 1.28 * b && g > 63.75) count++;
    }
  return count / 32;
}
function signature(image: Pixels) {
  const data: number[] = [];
  for (let y = 0; y < 18; y++)
    for (let x = 0; x < 32; x++) {
      const i =
        (Math.floor(((y + 0.5) / 18) * image.height) * image.width +
          Math.floor(((x + 0.5) / 32) * image.width)) *
        4;
      data.push(
        image.data[i] / 255,
        image.data[i + 1] / 255,
        image.data[i + 2] / 255,
      );
    }
  return data;
}

/** Seeded appearance tracking, not identity recognition or an authoritative rule detector. */
export class LocalTracker {
  private states = new Map<TrackId, State>();
  private h: Matrix3;
  private previousSignature: number[];
  private lastTime: number;
  constructor(
    private clip: Clip,
    image: Pixels,
    start: number,
  ) {
    this.h = homography(clip.corners, FIELD_CORNERS);
    this.lastTime = start;
    this.previousSignature = signature(image);
    const appearance = smooth(image);
    for (const id of ACTOR_IDS) {
      const seed = clip.seeds[id];
      if (!seed) continue;
      const x = seed.x * image.width,
        y = seed.y * image.height;
      const radius = Math.max(3, seed.radius * image.width);
      this.states.set(id, {
        x,
        y,
        vx: 0,
        vy: 0,
        yaw: seed.yaw,
        radius,
        seed,
        patch: patchAt(appearance, x, y, radius),
        lost: 0,
      });
    }
  }
  initial(image: Pixels, time: number): TrackFrame {
    const actors: TrackFrame['actors'] = {};
    for (const [id, s] of this.states)
      actors[id] = this.toSample(s, image, 1, 'manual');
    return { time, actors };
  }
  private toSample(
    s: State,
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
  step(
    image: Pixels,
    time: number,
  ): { frame: TrackFrame; cut: boolean; lost: TrackId[] } {
    const dt = Math.max(0.01, time - this.lastTime);
    this.lastTime = time;
    const sig = signature(image);
    let changed = 0;
    for (let i = 0; i < sig.length; i += 3) {
      const difference =
        (Math.abs(sig[i] - this.previousSignature[i]) +
          Math.abs(sig[i + 1] - this.previousSignature[i + 1]) +
          Math.abs(sig[i + 2] - this.previousSignature[i + 2])) /
        3;
      if (difference > 0.24) changed++;
    }
    this.previousSignature = sig;
    if (changed > (sig.length / 3) * 0.48)
      return {
        frame: { time, actors: {} },
        cut: true,
        lost: [...this.states.keys()],
      };
    const actors: TrackFrame['actors'] = {};
    const appearance = smooth(image);
    const previousStates = new Map(
      [...this.states].map(([id, state]) => [id, { ...state }]),
    );
    for (const [id, s] of this.states) {
      if (s.lost > this.clip.fps) continue;
      const predictedX = s.x + s.vx * dt,
        predictedY = s.y + s.vy * dt;
      const range = clamp(
        image.width * dt * (id === 'ball' ? 0.81 : 0.5) * (1 + s.lost * 0.12),
        10,
        image.width * 0.18,
      );
      const stride = id === 'ball' ? 2 : 3;
      let best = -1,
        bx = s.x,
        by = s.y;
      const candidates: { x: number; y: number; score: number; raw: number }[] =
        [];
      const candidateScore = (x: number, y: number): number | null => {
        const ground = projectPoint(this.h, {
          x: x / image.width,
          y: y / image.height + s.seed.groundOffset,
        });
        if (Math.abs(ground.x) > 1.15 || Math.abs(ground.y) > 1.5) return null;
        const patch = patchAt(appearance, x, y, s.radius);
        return similarity(s.patch, patch, id === 'ball');
      };
      for (
        let y = Math.max(s.radius, predictedY - range);
        y <= Math.min(image.height - s.radius, predictedY + range);
        y += stride
      ) {
        for (
          let x = Math.max(s.radius, predictedX - range);
          x <= Math.min(image.width - s.radius, predictedX + range);
          x += stride
        ) {
          const raw = candidateScore(x, y);
          if (raw === null) continue;
          const prior = Math.hypot(x - predictedX, y - predictedY) / range;
          const score = raw - 0.08 * prior;
          candidates.push({ x, y, score, raw });
          if (score > best) {
            best = score;
            bx = x;
            by = y;
          }
        }
      }
      // Refine the best coarse pixel, without adapting the identity template.
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = bx + dx,
            y = by + dy;
          const raw = candidateScore(x, y);
          if (raw === null) continue;
          const score =
            raw - (0.08 * Math.hypot(x - predictedX, y - predictedY)) / range;
          candidates.push({ x, y, score, raw });
        }
      candidates.sort((a, b) => b.score - a.score);
      const chosen = candidates[0];
      const alternative =
        chosen &&
        candidates.find(
          (c) => Math.hypot(c.x - chosen.x, c.y - chosen.y) > s.radius * 1.5,
        );
      const ambiguous = alternative && chosen.score - alternative.score < 0.015;
      const obscuredBall =
        id === 'ball' &&
        chosen &&
        (patchAt(appearance, chosen.x, chosen.y, s.radius).core < 0.75 ||
          turfAround(appearance, chosen.x, chosen.y, s.radius) < 0.5);
      if (
        !chosen ||
        chosen.raw < (id === 'ball' ? 0.68 : 0.6) ||
        obscuredBall
      ) {
        s.lost++;
        s.vx *= 0.5;
        s.vy *= 0.5;
        continue;
      }
      const old = this.toSample(s, image, 1, 'tracked');
      s.vx = (0.5 * (chosen.x - s.x)) / dt + 0.5 * s.vx;
      s.vy = (0.5 * (chosen.y - s.y)) / dt + 0.5 * s.vy;
      s.x = chosen.x;
      s.y = chosen.y;
      s.lost = 0;
      const value = this.toSample(
        s,
        image,
        Math.min(ambiguous ? 0.59 : 0.95, chosen.raw),
        'tracked',
      );
      if (Math.hypot(value.x - old.x, value.z - old.z) > 0.012)
        s.yaw = Math.atan2(value.x - old.x, value.z - old.z);
      value.yaw = s.yaw;
      actors[id] = value;
    }
    // One visual patch must not silently become two robots, or a hidden ball.
    const conflicted = new Set<TrackId>();
    for (let i = 0; i < ACTOR_IDS.length; i++)
      for (let j = i + 1; j < ACTOR_IDS.length; j++) {
        const a = ACTOR_IDS[i],
          b = ACTOR_IDS[j],
          x = actors[a],
          y = actors[b];
        if (!x || !y) continue;
        const distance = Math.hypot(x.x - y.x, x.z - y.z);
        if (a === 'ball' || b === 'ball') {
          const robotId = a === 'ball' ? b : a;
          const ballId = a === 'ball' ? a : b;
          const robot = this.states.get(robotId),
            ball = this.states.get(ballId);
          const insideBody =
            robot &&
            ball &&
            Math.hypot(robot.x - ball.x, robot.y - ball.y) <
              robot.radius + ball.radius * 0.5;
          if (distance < 0.075 || insideBody) conflicted.add(ballId);
        } else if (distance < 0.11) {
          conflicted.add(a);
          conflicted.add(b);
        }
      }
    for (const id of conflicted) {
      delete actors[id];
      const s = previousStates.get(id);
      if (s) {
        s.lost++;
        s.vx *= 0.5;
        s.vy *= 0.5;
        this.states.set(id, s);
      }
    }
    return {
      frame: { time, actors },
      cut: false,
      lost: ACTOR_IDS.filter((id) => this.states.has(id) && !actors[id]),
    };
  }
}
