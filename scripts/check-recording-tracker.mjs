/** Optional local benchmark; does not upload or publish video frames. */
import './reconstruction-loader.mjs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const { LocalTracker } = await import('../lib/reconstruction/tracking.ts');
const { makeClip } = await import('../lib/reconstruction/project.ts');
const [ffmpeg, recording] = process.argv.slice(2);
if (!ffmpeg || !recording)
  throw new Error(
    'Usage: node scripts/check-recording-tracker.mjs <ffmpeg-path> <Finale_lightweight.mp4>',
  );
const width = 960,
  height = 540,
  stride = width * height * 4;
const result = spawnSync(
  ffmpeg,
  [
    '-v',
    'error',
    '-ss',
    '400',
    '-i',
    recording,
    '-t',
    '8',
    '-vf',
    `fps=10,scale=${width}:${height}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ],
  { maxBuffer: 180 * 1024 * 1024 },
);
if (result.status !== 0) throw new Error(result.stderr.toString());
const seed = (x, y, radius) => ({
  x: x / 640,
  y: y / 360,
  radius,
  groundOffset: 0,
  yaw: 0,
});
const clip = {
  ...makeClip(400, 408),
  corners: [
    { x: 1030 / 1280, y: 120 / 720 },
    { x: 1030 / 1280, y: 605 / 720 },
    { x: 310 / 1280, y: 643 / 720 },
    { x: 320 / 1280, y: 86 / 720 },
  ],
  ballDiameter: '74',
  seeds: {
    'blue-1': seed(232, 60, 0.033),
    'blue-2': seed(260, 120, 0.031),
    'yellow-1': seed(306, 49, 0.032),
    'yellow-2': seed(183, 265, 0.034),
    ball: seed(275, 56, 0.012),
  },
};
const count = Math.floor(result.stdout.length / stride);
const frame = (i) => ({
  width,
  height,
  data: new Uint8ClampedArray(
    result.stdout.subarray(i * stride, (i + 1) * stride),
  ),
});
// The browser seeks the exact reference timestamp; fps filtering chooses a later frame.
// Use a separate raw seek for the appearance reference, consistently with the full benchmark.
const reference = spawnSync(
  ffmpeg,
  [
    '-v',
    'error',
    '-ss',
    '400',
    '-i',
    recording,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:${height}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ],
  { maxBuffer: stride * 2 },
);
if (reference.status !== 0 || reference.stdout.length !== stride)
  throw new Error('Could not decode reference frame.');
const tracker = new LocalTracker(
    clip,
    { width, height, data: reference.stdout },
    400,
  ),
  seen = {};
const start = performance.now();
const expected = {
  10: {
    'blue-1': [252, 81],
    'blue-2': [216, 117],
    'yellow-1': [256, 138],
    'yellow-2': [241, 219],
    ball: [225, 149],
  },
  19: {
    'blue-1': [227, 146],
    'blue-2': [195, 180],
    'yellow-1': [222, 231],
    'yellow-2': [237, 193],
    ball: [156, 264],
  },
  79: {
    'blue-1': [466, 209],
    'blue-2': [224, 227],
    'yellow-1': [143, 317],
    'yellow-2': [195, 311],
  },
};
assert.equal(
  count,
  80,
  'The benchmark requires the complete local 8-second fixture.',
);
for (let i = 1; i < count; i++) {
  const result = tracker.step(frame(i), 400 + i / 10);
  if (expected[i])
    for (const [id, [x, y]] of Object.entries(expected[i])) {
      const p = result.frame.actors[id];
      assert.ok(p, `${id} visible at frame ${i}`);
      assert.ok(
        Math.hypot(p.imageX * 640 - x, p.imageY * 360 - y) < 14,
        `${id} stays on the same body at frame ${i}`,
      );
    }
  // Only these individually inspected frames have no confidently separable ball.
  // 404.2 and 405.0 show the ball near the lower-left boundary; blanket absence was wrong.
  if ([60, 65, 79].includes(i))
    assert.equal(
      result.frame.actors.ball,
      undefined,
      'Occluded black ball must not become robot hardware.',
    );
  for (const id of Object.keys(result.frame.actors))
    seen[id] = (seen[id] ?? 0) + 1;
  if ([1, 5, 10, 19, 39, 59, 79].includes(i))
    console.log(
      JSON.stringify({
        time: 400 + i / 10,
        cut: result.cut,
        positions: Object.fromEntries(
          Object.entries(result.frame.actors).map(([id, p]) => [
            id,
            [
              Math.round(p.imageX * 640),
              Math.round(p.imageY * 360),
              Number(p.confidence.toFixed(2)),
            ],
          ]),
        ),
      }),
    );
}
console.log(
  JSON.stringify({
    frames: count,
    visibleSamples: seen,
    elapsedSeconds: (performance.now() - start) / 1000,
  }),
);
