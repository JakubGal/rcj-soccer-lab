import type { Point } from './geometry';
import type { Pixels } from './tracking';
/** Pure browser JavaScript. Input/output corners are pixel {x,y}, perimeter order. */
export function fitFieldBoundary(image: Pixels, corners: Point[]) {
  const { width, height, data } = image,
    scale = width / 640;
  const green = new Uint8Array(width * height),
    white = new Float32Array(width * height);
  const clamp = (x: number, a: number, b: number) =>
    Math.min(b, Math.max(a, x));
  for (let p = 0; p < green.length; p++) {
    const r = data[p * 4],
      g = data[p * 4 + 1],
      b = data[p * 4 + 2];
    green[p] = g > 1.23 * r && g > 1.23 * b && g > 60 ? 1 : 0;
    const lo = Math.min(r, g, b),
      hi = Math.max(r, g, b);
    white[p] = clamp((lo - 115) / 70, 0, 1) * Math.max(0, 1 - (hi - lo) / 110);
  }
  const pixel = (a: Uint8Array | Float32Array, x: number, y: number) =>
    a[
      clamp(Math.round(y), 0, height - 1) * width +
        clamp(Math.round(x), 0, width - 1)
    ];
  const range = Math.max(8, Math.round(28 * scale)),
    stride = 2 * range + 1;
  const edges = [];
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge],
      b = corners[(edge + 1) % 4],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy),
      ux = dx / length,
      uy = dy / length,
      nx = -uy,
      ny = ux;
    const count = Math.max(20, Math.floor(length / (5 * scale)));
    const votes = new Float32Array(count * stride),
      along = new Float32Array(count);
    for (let j = 0; j < count; j++) {
      const t = 0.055 + (0.89 * j) / (count - 1),
        cx = a.x + t * dx,
        cy = a.y + t * dy;
      along[j] = (t - 0.5) * length;
      for (let off = -range; off <= range; off++) {
        const x = cx + nx * off,
          y = cy + ny * off,
          wp = pixel(white, x, y);
        if (wp < 0.3) continue;
        const gp = pixel(green, x + nx * 5 * scale, y + ny * 5 * scale),
          gm = pixel(green, x - nx * 5 * scale, y - ny * 5 * scale);
        votes[j * stride + off + range] = wp * (0.15 + 0.425 * gp + 0.425 * gm);
      }
    }
    let bestScore = -1,
      bestSlope = 0,
      bestOffset = 0;
    for (let si = -12; si <= 12; si++) {
      const slope = si * 0.005;
      for (let off = -range; off <= range; off++) {
        let sum = 0;
        for (let j = 0; j < count; j++) {
          const q = Math.round(off + slope * along[j]) + range;
          if (q >= 0 && q < stride) sum += votes[j * stride + q];
        }
        if (sum / count > bestScore) {
          bestScore = sum / count;
          bestSlope = slope;
          bestOffset = off;
        }
      }
    }
    let supported = 0;
    const quarterCounts = [0, 0, 0, 0],
      quarterSupported = [0, 0, 0, 0];
    for (let j = 0; j < count; j++) {
      const q = Math.round(bestOffset + bestSlope * along[j]) + range,
        quarter = Math.min(3, Math.floor((j * 4) / count));
      quarterCounts[quarter]++;
      if (q >= 0 && q < stride && votes[j * stride + q] > 0.35) {
        supported++;
        quarterSupported[quarter]++;
      }
    }
    const vx = ux + nx * bestSlope,
      vy = uy + ny * bestSlope,
      lx = -vy,
      ly = vx;
    const px = (a.x + b.x) / 2 + nx * bestOffset,
      py = (a.y + b.y) / 2 + ny * bestOffset;
    const coverage = supported / count,
      quartiles = quarterSupported.map((n, i) => n / quarterCounts[i]);
    edges.push({
      line: [lx, ly, -lx * px - ly * py],
      score: bestScore,
      slope: bestSlope,
      offset: bestOffset,
      coverage,
      quartiles,
      valid:
        coverage >= 0.28 &&
        quartiles.filter((q) => q > 0.2).length >= 3 &&
        bestScore >= 0.21,
    });
  }
  const result = [];
  for (let i = 0; i < 4; i++) {
    const a = edges[(i + 3) % 4].line,
      b = edges[i].line,
      d = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(d) < 1e-8)
      return { valid: false, corners, edges, reason: 'parallel edges' };
    result.push({
      x: (a[1] * b[2] - a[2] * b[1]) / d,
      y: (a[2] * b[0] - a[0] * b[2]) / d,
    });
  }
  const area = (points: Point[]) =>
    Math.abs(
      points.reduce((s, p, i) => {
        const q = points[(i + 1) % 4];
        return s + p.x * q.y - p.y * q.x;
      }, 0),
    ) / 2;
  const cross = (points: Point[]) =>
    points.map((p, i) => {
      const q = points[(i + 1) % 4],
        r = points[(i + 2) % 4];
      return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    });
  const signs = cross(result),
    convex = signs.every((v) => v > 0) || signs.every((v) => v < 0);
  const areaRatio = area(result) / area(corners),
    maxmove = Math.max(
      ...result.map((p, i) =>
        Math.hypot(p.x - corners[i].x, p.y - corners[i].y),
      ),
    );
  const inFrame = result.every(
    (p) => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height,
  );
  const valid =
    edges.every((e) => e.valid) &&
    convex &&
    inFrame &&
    maxmove <= 40 * scale &&
    areaRatio > 0.82 &&
    areaRatio < 1.22;
  return { valid, corners: result, edges, areaRatio, maxmove };
}
