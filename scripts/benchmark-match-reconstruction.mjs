/** Local-only sequence benchmark. Source footage and generated tracks are never uploaded. */
import './reconstruction-loader.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const { LocalTracker } = await import('../lib/reconstruction/tracking.ts');
const { makeClip } = await import('../lib/reconstruction/project.ts');
const [
  ffmpeg,
  recording,
  truthFile,
  output,
  fpsArg = '10',
  endArg = '1725.8',
  widthArg = '960',
  heldoutFile,
] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/benchmark-match-reconstruction.mjs <ffmpeg> <video> <truth.json> <output.json> [fps] [end-seconds] [width] [heldout.json]',
  );
const fps = Number(fpsArg),
  end = Number(endArg),
  width = Number(widthArg),
  height = Math.round((width * 9) / 16),
  bytes = width * height * 4;
if (
  ![640, 960].includes(width) ||
  !Number.isInteger(fps) ||
  fps < 2 ||
  fps > 20 ||
  !Number.isFinite(end) ||
  end <= 0 ||
  end > 3600
)
  throw new Error('Invalid benchmark dimensions/range.');
const truth = JSON.parse(await readFile(truthFile, 'utf8'));
const labels = truth.frames.map((f) => ({ ...f, evaluationSet: 'tuning' }));
if (heldoutFile)
  labels.push(
    ...JSON.parse(await readFile(heldoutFile, 'utf8')).frames.map((f) => ({
      ...f,
      evaluationSet: 'heldout',
    })),
  );
const seedFrame = spawnSync(
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
  { maxBuffer: bytes * 2 },
);
if (seedFrame.status !== 0 || seedFrame.stdout.length !== bytes)
  throw new Error('Could not decode reference frame.');
const seed = (x, y, radius) => ({
  x: x / 640,
  y: y / 360,
  radius,
  groundOffset: 0,
  yaw: 0,
});
const clip = {
  ...makeClip(0, end),
  fps,
  referenceTime: 400,
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
const tracker = new LocalTracker(
  clip,
  { width, height, data: seedFrame.stdout },
  400,
);
const processVideo = spawn(ffmpeg, [
  '-v',
  'error',
  '-i',
  recording,
  '-t',
  String(end),
  '-vf',
  `fps=${fps},scale=${width}:${height}`,
  '-f',
  'rawvideo',
  '-pix_fmt',
  'rgba',
  'pipe:1',
]);
let stderr = '',
  buffer = Buffer.alloc(0),
  index = 0;
processVideo.stderr.on('data', (chunk) => {
  stderr += chunk;
});
const closed = new Promise((resolve, reject) => {
  processVideo.on('error', reject);
  processVideo.on('close', resolve);
});
const frames = [],
  observations = [],
  began = performance.now();
for await (const chunk of processVideo.stdout) {
  buffer = Buffer.concat([buffer, chunk]);
  let offset = 0;
  while (buffer.length - offset >= bytes) {
    const image = {
        width,
        height,
        data: buffer.subarray(offset, offset + bytes),
      },
      time = index / fps;
    const result = tracker.step(image, time);
    frames.push(result.frame);
    const labelled = labels.find(
      (f) => Math.abs(f.timeSeconds - time) < 0.5 / fps,
    );
    if (labelled)
      observations.push({ ...labelled, predicted: result.frame.actors });
    index++;
    offset += bytes;
    if (index % (fps * 60) === 0)
      console.log(
        JSON.stringify({
          videoSeconds: time,
          elapsedSeconds: (performance.now() - began) / 1000,
        }),
      );
  }
  buffer = Buffer.from(buffer.subarray(offset));
}
if ((await closed) !== 0) throw new Error(stderr);
function metrics(kind, evaluationSet = 'tuning') {
  let visible = 0,
    detected = 0,
    correctIdentity = 0,
    falsePositives = 0,
    ignoredHeld = 0;
  const errors = [],
    details = [];
  for (const f of observations.filter(
    (f) =>
      f.evaluationSet === evaluationSet &&
      (f.phase === 'first_half' || f.phase === 'second_half'),
  )) {
    const expected = f.objects.filter(
      (o) => o.kind === kind && o.visiblyInPlay,
    );
    const predictions = Object.entries(f.predicted).filter(
      ([id]) => (id === 'ball') === (kind === 'ball'),
    );
    const pairs = [];
    expected.forEach((o, oi) =>
      predictions.forEach(([id, p], pi) => {
        const error = Math.hypot(
          p.imageX * 640 - o.x * 640,
          p.imageY * 360 - o.y * 360,
        );
        if (error <= 14)
          pairs.push({ oi, pi, error, correct: id === o.identity });
      }),
    );
    pairs.sort((a, b) => a.error - b.error);
    const usedO = new Set(),
      usedP = new Set();
    for (const p of pairs)
      if (!usedO.has(p.oi) && !usedP.has(p.pi)) {
        usedO.add(p.oi);
        usedP.add(p.pi);
        detected++;
        correctIdentity += Number(p.correct);
        errors.push(p.error);
      }
    visible += expected.length;
    predictions.forEach(([, p], pi) => {
      if (usedP.has(pi)) return;
      const held = f.objects.some(
        (o) =>
          o.kind === kind &&
          !o.visiblyInPlay &&
          Math.hypot((p.imageX - o.x) * 640, (p.imageY - o.y) * 360) <= 20,
      );
      if (held) ignoredHeld++;
      else if (kind === 'robot' || f.ballAssessment === 'visible')
        falsePositives++;
    });
    details.push({
      time: f.timeSeconds,
      expected: expected.length,
      matched: usedO.size,
      missed: expected.filter((_, i) => !usedO.has(i)).map((o) => o.identity),
    });
  }
  return {
    visible,
    detected,
    recall: detected / Math.max(1, visible),
    correctIdentity,
    identityRecall: correctIdentity / Math.max(1, visible),
    falsePositives,
    precision: detected / Math.max(1, detected + falsePositives),
    ignoredHeld,
    meanErrorPixels640:
      errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length),
    details,
  };
}
const result = {
  source: recording.split(/[\\/]/).at(-1),
  fps,
  width,
  height,
  reference: { time: 400, corners: clip.corners, seeds: clip.seeds },
  secondsProcessed: index / fps,
  framesProcessed: index,
  elapsedSeconds: (performance.now() - began) / 1000,
  evaluation:
    'Prespecified manual samples, 14px centre tolerance at640. Visible freestanding on-field actors during half samples only. Ball-abstention frames excluded from precision. Presence is not correctness.',
  robot: metrics('robot'),
  ball: metrics('ball'),
  ...(heldoutFile
    ? {
        heldout: {
          robot: metrics('robot', 'heldout'),
          ball: metrics('ball', 'heldout'),
        },
      }
    : {}),
  observations,
  frames,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result));
console.log(
  JSON.stringify(
    { ...result, frames: undefined, observations: undefined },
    null,
    2,
  ),
);
