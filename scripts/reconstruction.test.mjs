import './reconstruction-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { homography, projectPoint, validCorners, FIELD_CORNERS } =
  await import('../lib/reconstruction/geometry.ts');
const {
  makeProject,
  makeClip,
  parseProject,
  serializeProject,
  MAX_PROJECT_BYTES,
  sampleClip,
  locate,
  timelineTime,
  scoreAt,
  correctAt,
  manualSample,
  renderPoses,
  trimClip,
} = await import('../lib/reconstruction/project.ts');
const { LocalTracker } = await import('../lib/reconstruction/tracking.ts');
const { suggestEvents, mergeSuggestions } =
  await import('../lib/reconstruction/events.ts');
const { seekVideo } = await import('../lib/reconstruction/video.ts');

test('seeking waits for decoded pixels even when currentTime already reports the destination', async () => {
  const video = new EventTarget();
  Object.assign(video, {
    duration: 20,
    currentTime: 5,
    readyState: 4,
    seeking: true,
  });
  let completed = false;
  const promise = seekVideo(video, 5).then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  video.seeking = false;
  video.dispatchEvent(new Event('seeked'));
  await promise;
  assert.equal(completed, true);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => seekVideo(video, 6, abort.signal), /Cancelled/);
  video.duration = NaN;
  await assert.rejects(() => seekVideo(video, 6), /metadata/);
});
const corners = [
  { x: 0.1, y: 0.15 },
  { x: 0.9, y: 0.12 },
  { x: 0.85, y: 0.9 },
  { x: 0.12, y: 0.85 },
];
const source = {
  name: 'match.mp4',
  size: 1000,
  lastModified: 0,
  duration: 1000,
  width: 1280,
  height: 720,
};
const clip = () => ({
  ...makeClip(10, 12),
  corners,
  fps: 10,
  seeds: { ball: { x: 0.5, y: 0.5, radius: 0.025, groundOffset: 0, yaw: 0 } },
});
const sample = (x = 0) => ({
  x,
  z: 0,
  yaw: 0,
  imageX: 0.5,
  imageY: 0.5,
  confidence: 0.8,
  origin: 'tracked',
  heading: 'estimated',
});
test('perspective calibration maps all four corners and roundtrips an oblique view', () => {
  const h = homography(corners, FIELD_CORNERS),
    inv = homography(FIELD_CORNERS, corners);
  for (let i = 0; i < 4; i++) {
    const p = projectPoint(h, corners[i]);
    assert.ok(Math.abs(p.x - FIELD_CORNERS[i].x) < 1e-7);
    assert.ok(Math.abs(p.y - FIELD_CORNERS[i].y) < 1e-7);
  }
  const p = { x: 0.4, y: 0.7 },
    q = projectPoint(inv, projectPoint(h, p));
  assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-7);
  assert.equal(validCorners(corners), true);
  assert.equal(
    validCorners([corners[0], corners[2], corners[1], corners[3]]),
    false,
  );
  assert.throws(() => homography(Array(4).fill({ x: 0, y: 0 }), FIELD_CORNERS));
});
test('portable replay is distinct from certification; malformed files cannot carry executable or oversized state', () => {
  const c = clip();
  c.frames = [{ time: 10, actors: { ball: sample() } }];
  const p = { ...makeProject(source), clips: [c] };
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  for (const bad of [
    { ...p, version: 9 },
    { ...p, certified: true },
    { ...p, clips: [c, c] },
    { ...p, clips: [{ ...c, end: 1 }] },
    {
      ...p,
      clips: [
        {
          ...c,
          frames: [
            { time: 11, actors: { ball: sample() } },
            { time: 10, actors: {} },
          ],
        },
      ],
    },
    {
      ...p,
      clips: [
        {
          ...c,
          frames: [{ time: 10, actors: { ball: { ...sample(), x: null } } }],
        },
      ],
    },
  ])
    assert.throws(() => parseProject(JSON.stringify(bad)));
});
test('clip timeline preserves source times, pauses, repeated source footage and boundary selection', () => {
  const a = clip(),
    b = { ...clip(), id: 'second', start: 400, end: 406 };
  const p = { ...makeProject(source), clips: [a, b] };
  assert.equal(locate(p, 0).time, 10);
  assert.equal(locate(p, 2).clip.id, 'second');
  assert.equal(locate(p, 4).time, 402);
  assert.equal(timelineTime(p, 'second', 405), 7);
  assert.equal(locate(p, 99).time, 406);
});
test('interpolation never fabricates actors across occlusion, untracked tails or long gaps', () => {
  const c = clip();
  c.frames = [
    { time: 10, actors: { ball: sample(0) } },
    { time: 10.1, actors: { ball: sample(0.1) } },
    { time: 10.2, actors: {} },
    { time: 11, actors: { ball: sample(0.3) } },
  ];
  assert.ok(Math.abs(sampleClip(c, 10.05).ball.x - 0.05) < 1e-8);
  assert.deepEqual(sampleClip(c, 10.15), {});
  assert.deepEqual(sampleClip(c, 10.5), {});
  assert.deepEqual(sampleClip(c, 11.1), {});
  assert.deepEqual(renderPoses(sampleClip(c, 10.15)), {});
});
test('heading interpolation follows shortest rotation across -pi/pi', () => {
  const c = clip();
  c.frames = [
    { time: 10, actors: { ball: { ...sample(), yaw: 3.1 } } },
    { time: 10.1, actors: { ball: { ...sample(), yaw: -3.1 } } },
  ];
  assert.ok(Math.abs(sampleClip(c, 10.05).ball.yaw - Math.PI) < 0.00001);
});
test('manual corrections carry provenance and preserve other actors; unseen removes only chosen actor', () => {
  const c = clip();
  c.frames = [{ time: 10, actors: { ball: sample(), 'blue-1': sample(0.3) } }];
  const point = manualSample(c, 'ball', { x: 0.5, y: 0.6 }, 1);
  const next = correctAt(c, 10, 'ball', point);
  assert.equal(next.frames[0].actors.ball.origin, 'manual');
  assert.equal(next.frames[0].actors['blue-1'].x, 0.3);
  assert.equal(c.frames[0].actors.ball.origin, 'tracked');
  assert.equal(
    correctAt(next, 10, 'ball', null).frames[0].actors.ball,
    undefined,
  );
});
test('only confirmed goals change score; set-score, reordering and dismissing stay reversible', () => {
  const c = clip();
  const p = {
    ...makeProject(source),
    clips: [c],
    initialScore: { blue: 2, yellow: 1 },
    events: [
      {
        id: 'a',
        clipId: c.id,
        time: 10,
        kind: 'goal',
        status: 'suggested',
        team: 'blue',
        note: '',
      },
      {
        id: 'b',
        clipId: c.id,
        time: 11,
        kind: 'goal',
        status: 'confirmed',
        team: 'yellow',
        note: '',
      },
    ],
  };
  assert.deepEqual(scoreAt(p, 0.5), { blue: 2, yellow: 1 });
  assert.deepEqual(scoreAt(p, 1.1), { blue: 2, yellow: 2 });
  p.events.push({
    id: 'c',
    clipId: c.id,
    time: 11.5,
    kind: 'score',
    status: 'confirmed',
    score: { blue: 5, yellow: 3 },
    note: '',
  });
  assert.deepEqual(scoreAt(p, 2), { blue: 5, yellow: 3 });
  p.events[2].status = 'dismissed';
  assert.deepEqual(scoreAt(p, 2), { blue: 2, yellow: 2 });
});
test('event proposals are not verdicts; crossing white line alone never proposes out of bounds', () => {
  const c = clip();
  c.frames = [
    { time: 10, actors: { 'blue-1': sample(0.74) } },
    { time: 10.1, actors: { 'blue-1': sample(0.78) } },
    { time: 10.2, actors: { 'blue-1': sample(0.83) } },
  ];
  const events = suggestEvents(c);
  assert.equal(events.length, 1);
  assert.equal(events[0].time, 10.2);
  assert.equal(events[0].status, 'suggested');
  assert.match(events[0].note, /opponent pushed/);
});
function image(x, y, color = [225, 100, 10]) {
  const width = 200,
    height = 200,
    data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set([30, 115, 60, 255], i * 4);
  }
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -5; dx <= 5; dx++)
      if (dx * dx + dy * dy <= 25)
        data.set(
          [...color.map((v) => Math.min(255, v + (dx + 5) * 2)), 255],
          ((y + dy) * width + x + dx) * 4,
        );
  return { width, height, data };
}
test('appearance tracker follows a seeded moving ball without a fixed orange-only detector', () => {
  for (const color of [
    [225, 100, 10],
    [25, 22, 30],
  ]) {
    const c = {
      ...clip(),
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      seeds: {
        ball: { x: 0.5, y: 0.5, radius: 0.025, groundOffset: 0, yaw: 0 },
      },
    };
    const tracker = new LocalTracker(c, image(100, 100, color), 10);
    const result = tracker.step(image(108, 103, color), 10.1);
    assert.equal(result.cut, false);
    assert.ok(result.frame.actors.ball);
    assert.ok(Math.abs(result.frame.actors.ball.imageX - 0.54) < 0.02);
    assert.ok(Math.abs(result.frame.actors.ball.imageY - 0.515) < 0.02);
  }
});
test('large camera cuts stop tracking instead of replaying old positions', () => {
  const c = {
    ...clip(),
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  };
  const tracker = new LocalTracker(c, image(100, 100), 10);
  const next = image(100, 100);
  next.data.fill(255);
  const result = tracker.step(next, 10.1);
  assert.equal(result.cut, true);
  assert.deepEqual(result.frame.actors, {});
});

test('a missing dark ball cannot silently become empty turf or a large dark robot body', () => {
  const c = {
    ...clip(),
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    seeds: { ball: { x: 0.5, y: 0.5, radius: 0.025, groundOffset: 0, yaw: 0 } },
  };
  const seed = image(100, 100, [20, 20, 20]);
  for (const largeBody of [false, true]) {
    const next = image(100, 100, [20, 20, 20]);
    for (let y = 60; y < 140; y++)
      for (let x = 60; x < 140; x++) {
        const body = largeBody && Math.hypot(x - 100, y - 100) < 28;
        next.data.set(
          body ? [20, 20, 20, 255] : [30, 115, 60, 255],
          (y * 200 + x) * 4,
        );
      }
    const tracker = new LocalTracker(c, seed, 10);
    assert.equal(tracker.step(next, 10.1).frame.actors.ball, undefined);
  }
});

test('a patterned robot remains tracked through a quarter-turn', () => {
  const width = 200,
    height = 200;
  function robot(turn) {
    const data = image(15, 15).data;
    for (let y = -12; y <= 12; y++)
      for (let x = -12; x <= 12; x++)
        if (x * x + y * y <= 144) {
          const pattern = turn ? y : x;
          data.set(
            pattern > 2
              ? [240, 225, 210, 255]
              : pattern < -3
                ? [190, 35, 30, 255]
                : [25, 25, 30, 255],
            ((100 + y) * width + 100 + x) * 4,
          );
        }
    return { width, height, data };
  }
  const c = {
    ...clip(),
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    seeds: {
      'blue-1': { x: 0.5, y: 0.5, radius: 0.06, groundOffset: 0, yaw: 0 },
    },
  };
  const tracker = new LocalTracker(c, robot(false), 10);
  const tracked = tracker.step(robot(true), 10.1).frame.actors['blue-1'];
  assert.ok(tracked);
  assert.ok(Math.hypot(tracked.imageX - 0.5, tracked.imageY - 0.5) < 0.02);
});

test('retracking preserves reviews without duplicate goals or resurrecting dismissals', () => {
  const c = clip(),
    base = {
      id: 'candidate',
      clipId: c.id,
      time: 10.5,
      kind: 'goal',
      status: 'suggested',
      team: 'blue',
      note: 'review',
    };
  for (const status of ['confirmed', 'dismissed']) {
    const reviewed = { ...base, status };
    const merged = mergeSuggestions([reviewed], c.id, [base]);
    assert.deepEqual(merged, [reviewed]);
    const p = { ...makeProject(source), clips: [c], events: merged };
    assert.doesNotThrow(() => parseProject(serializeProject(p)));
    assert.equal(scoreAt(p, 1).blue, status === 'confirmed' ? 1 : 0);
  }
});

test('partially calibrated drafts save and load; a full hour at 20fps fits portable limits', () => {
  const draft = {
    ...makeProject(source),
    clips: [{ ...clip(), corners: corners.slice(0, 2) }],
  };
  assert.equal(
    parseProject(serializeProject(draft)).clips[0].corners.length,
    2,
  );
  const c = { ...clip(), start: 0, end: 3600, fps: 20 };
  const actors = Object.fromEntries(
    ['blue-1', 'blue-2', 'yellow-1', 'yellow-2', 'ball'].map((id) => [
      id,
      {
        ...sample(0.123456789),
        yaw: 1.123456789,
        imageX: 0.234567891,
        imageY: 0.789123456,
      },
    ]),
  );
  c.frames = Array.from({ length: 72001 }, (_, i) => ({
    time: i / 20,
    actors,
  }));
  const p = { ...makeProject({ ...source, duration: 3600 }), clips: [c] };
  const text = serializeProject(p);
  assert.ok(Buffer.byteLength(text) < MAX_PROJECT_BYTES);
  assert.equal(parseProject(text).clips[0].frames.length, 72001);
});

test('trimming retains ordered valid samples and only events inside the kept range', () => {
  const c = clip();
  c.frames = Array.from({ length: 21 }, (_, i) => ({
    time: 10 + i / 10,
    actors: { ball: sample(i / 100) },
  }));
  const p = {
    ...makeProject(source),
    clips: [c],
    events: [
      {
        id: 'discard',
        clipId: c.id,
        time: 10,
        kind: 'note',
        status: 'confirmed',
        note: 'old',
      },
      {
        id: 'keep',
        clipId: c.id,
        time: 11,
        kind: 'note',
        status: 'confirmed',
        note: 'keep',
      },
    ],
  };
  const trimmed = trimClip(p, c.id, 10.5, 11.5);
  assert.equal(trimmed.clips[0].frames.length, 11);
  assert.equal(trimmed.events.length, 1);
  assert.equal(trimmed.events[0].id, 'keep');
  assert.equal(p.clips[0].frames.length, 21);
  assert.doesNotThrow(() => parseProject(serializeProject(trimmed)));
  assert.throws(() => trimClip(p, c.id, 9, 12));
});
