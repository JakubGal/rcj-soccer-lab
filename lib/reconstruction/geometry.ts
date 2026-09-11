/** Ground-plane geometry only. A single view cannot recover hidden poses or height. */
export type Point = { x: number; y: number };
export type Matrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export const FIELD_CORNERS: Point[] = [
  { x: -0.79, y: -1.095 },
  { x: 0.79, y: -1.095 },
  { x: 0.79, y: 1.095 },
  { x: -0.79, y: 1.095 },
];

export function projectPoint(h: Matrix3, p: Point): Point {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(d) < 1e-10) throw new Error('Invalid camera calibration.');
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / d,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / d,
  };
}

export function homography(from: Point[], to: Point[]): Matrix3 {
  if (from.length !== 4 || to.length !== 4)
    throw new Error('Choose all four field corners.');
  const a: number[][] = [];
  from.forEach(({ x, y }, i) => {
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let r = i + 1; r < 8; r++)
      if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const d = a[i][i];
    if (Math.abs(d) < 1e-10)
      throw new Error('Corners must form a visible, non-flat field rectangle.');
    for (let c = i; c <= 8; c++) a[i][c] /= d;
    for (let r = 0; r < 8; r++)
      if (r !== i) {
        const factor = a[r][i];
        for (let c = i; c <= 8; c++) a[r][c] -= factor * a[i][c];
      }
  }
  return [...a.map((row) => row[8]), 1] as Matrix3;
}

export function validCorners(points: Point[]) {
  if (
    points.length !== 4 ||
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1,
    )
  )
    return false;
  const signs = points.map((p, i) => {
    const b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  return signs.every((s) => s > 0.0001) || signs.every((s) => s < -0.0001);
}

export const shortAngle = (from: number, to: number, alpha: number) =>
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * alpha;
