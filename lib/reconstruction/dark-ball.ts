import type { Pixels } from './tracking';

type Body = { x: number; y: number; radius: number };
type Proposal = Body & {
  core: number;
  turf: number;
  score: number;
  appearance: number;
};
type Mask = {
  width: number;
  height: number;
  dark: Uint8Array;
  integral: Int32Array;
  foreground: Int32Array;
};
const green = (r: number, g: number, b: number) =>
  g > 1.28 * r && g > 1.28 * b && g > 63.75;
function maskImage(image: Pixels): Mask {
  const { width, height, data } = image,
    pitch = width + 1;
  const dark = new Uint8Array(width * height),
    integral = new Int32Array(pitch * (height + 1)),
    foreground = new Int32Array(integral.length);
  for (let y = 0; y < height; y++) {
    let ds = 0,
      fs = 0;
    for (let x = 0; x < width; x++) {
      const p = y * width + x,
        i = p * 4,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        fg = !green(r, g, b);
      dark[p] = Number(
        fg &&
          Math.max(r, g, b) < 155 &&
          Math.max(r, g, b) - Math.min(r, g, b) < 75,
      );
      ds += dark[p];
      fs += Number(fg);
      integral[(y + 1) * pitch + x + 1] = integral[y * pitch + x + 1] + ds;
      foreground[(y + 1) * pitch + x + 1] = foreground[y * pitch + x + 1] + fs;
    }
  }
  return { width, height, dark, integral, foreground };
}
const kernels = new Map<number, number[]>();
function disk(
  mask: Mask,
  integral: Int32Array,
  x: number,
  y: number,
  radius: number,
) {
  const r = Math.max(1, Math.round(radius));
  let rows = kernels.get(r);
  if (!rows) {
    rows = Array.from({ length: 2 * r + 1 }, (_, i) =>
      Math.floor(Math.sqrt(r * r - (i - r) ** 2)),
    );
    kernels.set(r, rows);
  }
  x = Math.round(x);
  y = Math.round(y);
  let sum = 0,
    area = 0;
  const pitch = mask.width + 1;
  for (let dy = -r; dy <= r; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= mask.height) continue;
    const span = rows[dy + r],
      lo = Math.max(0, x - span),
      hi = Math.min(mask.width, x + span + 1);
    if (hi <= lo) continue;
    sum +=
      integral[(yy + 1) * pitch + hi] -
      integral[(yy + 1) * pitch + lo] -
      integral[yy * pitch + hi] +
      integral[yy * pitch + lo];
    area += hi - lo;
  }
  return { sum, area, fraction: sum / Math.max(1, area) };
}
function proposals(
  mask: Mask,
  radius: number,
  robots: Body[],
  inside: (x: number, y: number) => boolean,
  bounds?: { x0: number; x1: number; y0: number; y1: number },
  fast = false,
): Proposal[] {
  const physical = Math.max(2, Math.floor(radius * 0.66)),
    found: Proposal[] = [];
  const x0 = Math.max(1, Math.floor(bounds?.x0 ?? physical)),
    x1 = Math.min(
      mask.width - 1,
      Math.ceil(bounds?.x1 ?? mask.width - physical),
    );
  const y0 = Math.max(1, Math.floor(bounds?.y0 ?? physical)),
    y1 = Math.min(
      mask.height - 1,
      Math.ceil(bounds?.y1 ?? mask.height - physical),
    );
  const at = (x: number, y: number, coarse = false): Proposal | null => {
    if (
      x < 0 ||
      x >= mask.width ||
      y < 0 ||
      y >= mask.height ||
      !mask.dark[y * mask.width + x] ||
      !inside(x, y)
    )
      return null;
    if (robots.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius * 1.05))
      return null;
    const core = disk(mask, mask.integral, x, y, physical * 0.6).fraction;
    if (core <= (coarse ? 0.3 : 0.55)) return null;
    const body = disk(mask, mask.integral, x, y, physical).fraction;
    if (body <= (coarse ? 0.5 : 0.7)) return null;
    const outer = disk(mask, mask.integral, x, y, physical * 2.8),
      inner = disk(mask, mask.integral, x, y, physical * 1.8);
    const contrast =
      body - (outer.sum - inner.sum) / Math.max(1, outer.area - inner.area);
    if (contrast <= (coarse ? 0.45 : 0.7)) return null;
    const foreground = disk(mask, mask.foreground, x, y, physical).fraction;
    if (foreground <= (coarse ? 0.55 : 0.75)) return null;
    const of = disk(mask, mask.foreground, x, y, physical * 2.8),
      inf = disk(mask, mask.foreground, x, y, physical * 1.8);
    const turf = 1 - (of.sum - inf.sum) / Math.max(1, of.area - inf.area);
    if (!coarse && turf < 0.6 && core < 0.95) return null;
    return {
      x,
      y,
      radius,
      core,
      turf,
      score: 0.4 * body + 0.25 * core + 0.2 * contrast + 0.15 * foreground,
      appearance: 0,
    };
  };
  const order = (a: Proposal, b: Proposal) =>
    b.score - a.score || a.y - b.y || a.x - b.x;
  const coarse: Proposal[] = [];
  for (let y = y0; y < y1; y += fast ? 2 : 1)
    for (let x = x0; x < x1; x += fast ? 2 : 1) {
      const p = at(x, y, fast);
      if (p) (fast ? coarse : found).push(p);
    }
  if (fast) {
    // Cheap proposals may be permissive, but only original strict per-pixel gates can emit a detection.
    coarse.sort(order);
    const kept: Proposal[] = [];
    for (const p of coarse) {
      if (kept.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < physical * 1.2))
        continue;
      kept.push(p);
      if (kept.length === 120) break;
    }
    for (const c of kept)
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const p = at(c.x + dx, c.y + dy);
          if (p) found.push(p);
        }
  }
  found.sort(order);
  const kept: Proposal[] = [];
  for (const p of found) {
    if (kept.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < physical * 2.4))
      continue;
    kept.push(p);
    if (kept.length === 40) break;
  }
  return kept;
}
function describe(image: Pixels, cx: number, cy: number, radius: number) {
  const bins = new Float32Array(128),
    counts = [0, 0],
    inner = radius * 0.57;
  for (let dy = -Math.ceil(radius); dy <= radius; dy++)
    for (let dx = -Math.ceil(radius); dx <= radius; dx++) {
      const d = dx * dx + dy * dy;
      if (d > radius * radius) continue;
      const x = Math.round(cx + dx),
        y = Math.round(cy + dy);
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue;
      const i = (y * image.width + x) * 4,
        ring = d < inner * inner ? 0 : 1,
        bin =
          (image.data[i] >> 6) * 16 +
          (image.data[i + 1] >> 6) * 4 +
          (image.data[i + 2] >> 6);
      bins[ring * 64 + bin]++;
      counts[ring]++;
    }
  for (let i = 0; i < 128; i++)
    bins[i] = Math.sqrt(bins[i] / Math.max(1, counts[i >> 6]));
  return bins;
}
/** Compact dark-object contrast also works on blue/yellow goal floors, not only green turf. */
export class DarkBallDetector {
  private constructor(
    private radius: number,
    private templates: Float32Array[],
  ) {}
  static fromReference(
    image: Pixels,
    x: number,
    y: number,
    radius: number,
  ): DarkBallDetector | null {
    const mask = maskImage(image);
    // Orange balls retain the generic colour-based path. Never shrink a poorly centred seed.
    if (disk(mask, mask.integral, x, y, radius).fraction < 0.2) return null;
    const range = radius * 1.2;
    const nearby = proposals(mask, radius, [], () => true, {
      x0: x - range,
      x1: x + range,
      y0: y - range,
      y1: y + range,
    });
    nearby.sort(
      (a, b) =>
        b.score -
        (0.02 * Math.hypot(b.x - x, b.y - y)) / radius -
        (a.score - (0.02 * Math.hypot(a.x - x, a.y - y)) / radius),
    );
    const p = nearby[0];
    if (!p) return null;
    return new DarkBallDetector(
      radius,
      [0.7, 1, 1.2].map((s) => describe(image, p.x, p.y, radius * s)),
    );
  }
  detect(
    image: Pixels,
    robots: Body[],
    inside: (x: number, y: number) => boolean,
  ): Proposal[] {
    return proposals(
      maskImage(image),
      this.radius,
      robots,
      inside,
      undefined,
      true,
    )
      .map((c) => {
        let appearance = 0;
        for (const scale of [0.7, 1, 1.2]) {
          const next = describe(image, c.x, c.y, this.radius * scale);
          for (const anchor of this.templates) {
            let value = 0;
            for (let i = 0; i < 128; i++) value += anchor[i] * next[i];
            appearance = Math.max(appearance, value / 2);
          }
        }
        return { ...c, appearance };
      })
      .filter(
        (c) =>
          c.appearance > 0.68 &&
          !(c.turf < 0.7 && c.appearance < 0.78 && c.core < 0.95),
      );
  }
}
