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
  trackingSampleTimes,
  formatTime,
  fieldCornersAt,
} = await import('../lib/reconstruction/project.ts');
const { LocalTracker } = await import('../lib/reconstruction/tracking.ts');
const { fitFieldBoundary } =
  await import('../lib/reconstruction/field-alignment.ts');
const { DarkBallDetector } = await import('../lib/reconstruction/dark-ball.ts');
const { suggestEvents, mergeSuggestions } =
  await import('../lib/reconstruction/events.ts');
const { seekVideo } = await import('../lib/reconstruction/video.ts');

test('tracking samples every 100 or 500 milliseconds with one exact endpoint', () => {
  assert.equal(makeClip(400, 401).fps, 10);
  for (const fps of [2, 5, 10, 15, 20]) {
    const times = trackingSampleTimes(400.1, 401.1, fps);
    assert.equal(times.length, fps + 1);
    assert.equal(times[0], 400.1);
    assert.equal(times.at(-1), 401.1);
    for (let i = 1; i < times.length; i++)
      assert.ok(Math.abs(times[i] - times[i - 1] - 1 / fps) < 1e-9);
  }
  assert.deepEqual(trackingSampleTimes(0, 1, 2), [0, 0.5, 1]);
  assert.deepEqual(trackingSampleTimes(0, 0.3, 10), [0, 0.1, 0.2, 0.3]);
  assert.deepEqual(trackingSampleTimes(0.1, 0.45, 2), [0.1, 0.45]);
  const fractional = trackingSampleTimes(400.13, 401.18, 10);
  assert.equal(fractional.length, 12);
  assert.equal(fractional.at(-1), 401.18);
  assert.ok(fractional.every((time, i) => !i || time > fractional[i - 1]));
  assert.equal(trackingSampleTimes(0, 3600, 20).length, 72001);
  assert.deepEqual(trackingSampleTimes(1, 1, 10), [1]);
  for (const args of [
    [NaN, 1, 10],
    [2, 1, 10],
    [0, 1, 0],
    [0, 4000, 10],
  ])
    assert.throws(() => trackingSampleTimes(...args), /Invalid/);
});

test('precise replay clocks distinguish small steps and carry at minute boundaries', () => {
  assert.equal(formatTime(400.1, true), '6:40.100');
  assert.equal(formatTime(400.6, true), '6:40.600');
  assert.equal(formatTime(59.9999, true), '1:00.000');
  assert.equal(formatTime(0.05, true), '0:00.050');
  assert.equal(formatTime(NaN, true), '0:00.000');
  assert.equal(formatTime(-1, true), '0:00.000');
  assert.equal(formatTime(400.9), '6:40');
});

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

test('seeking ignores stale completion events and waits for decoded pixels at the requested time', async () => {
  const video = new EventTarget();
  Object.assign(video, {
    duration: 1000,
    currentTime: 2,
    readyState: 4,
    seeking: false,
  });
  let completed = false;
  const promise = seekVideo(video, 900).then(() => {
    completed = true;
  });
  video.currentTime = 2;
  video.dispatchEvent(new Event('seeked'));
  await Promise.resolve();
  assert.equal(
    completed,
    false,
    'an earlier playback seek must not resolve the new request',
  );
  video.currentTime = 900;
  video.seeking = true;
  video.dispatchEvent(new Event('seeked'));
  await Promise.resolve();
  assert.equal(completed, false);
  video.seeking = false;
  video.readyState = 1;
  video.dispatchEvent(new Event('seeked'));
  await Promise.resolve();
  assert.equal(completed, false, 'metadata alone is not a decoded image');
  video.readyState = 2;
  video.dispatchEvent(new Event('loadeddata'));
  await promise;
  assert.equal(completed, true);
});

test('superseded seeks cancel cleanly and a throwing media setter releases its listeners', async () => {
  const video = new EventTarget();
  Object.assign(video, {
    duration: 1000,
    currentTime: 2,
    readyState: 4,
    seeking: false,
  });
  const first = new AbortController();
  const waiting = seekVideo(video, 900, first.signal);
  const cancelled = assert.rejects(waiting, /Cancelled/);
  first.abort();
  await cancelled;
  const latest = seekVideo(video, 950);
  video.currentTime = 900;
  video.dispatchEvent(new Event('seeked'));
  video.currentTime = 950;
  video.dispatchEvent(new Event('seeked'));
  await latest;

  const listeners = new Map();
  const add = video.addEventListener.bind(video);
  const remove = video.removeEventListener.bind(video);
  video.addEventListener = (type, fn, options) => {
    listeners.set(type, fn);
    add(type, fn, options);
  };
  video.removeEventListener = (type, fn) => {
    listeners.delete(type);
    remove(type, fn);
  };
  Object.defineProperty(video, 'currentTime', {
    get: () => 2,
    set: () => {
      throw new Error('Media source unavailable');
    },
  });
  await assert.rejects(seekVideo(video, 900), /Media source unavailable/);
  assert.equal(listeners.size, 0);
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
  assert.equal(
    locate(p, 2, a.id).clip.id,
    a.id,
    'paused tracking retains the just-finished clip at its endpoint',
  );
  assert.equal(locate(p, 2, a.id).time, 12);
  assert.equal(locate(p, 2, b.id).time, 400);
  assert.equal(
    locate(p, 2.1, a.id).clip.id,
    b.id,
    'playing past the boundary still advances normally',
  );
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
  assert.equal(trimmed.clips[0].referenceTime, 10);
  assert.deepEqual(trimmed.clips[0].seeds, c.seeds);
  assert.doesNotThrow(() => parseProject(serializeProject(trimmed)));
  assert.throws(() => trimClip(p, c.id, 9, 12));
});

const squareCorners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
function robotScene(robots = []) {
  const frame = image(15, 15);
  for (const { x: cx, y: cy, color } of robots)
    for (let y = -12; y <= 12; y++)
      for (let x = -12; x <= 12; x++)
        if (x * x + y * y <= 144)
          frame.data.set([...color, 255], ((cy + y) * 200 + cx + x) * 4);
  return frame;
}
const robotSeed = (x, y) => ({
  x: x / 200,
  y: y / 200,
  radius: 0.06,
  groundOffset: 0,
  yaw: 0,
});
test('whole-field detection reacquires after long absence, large displacement and a title card', () => {
  const red = { x: 60, y: 70, color: [200, 30, 30] };
  const c = {
    ...clip(),
    corners: squareCorners,
    seeds: { 'blue-1': robotSeed(60, 70) },
  };
  const tracker = new LocalTracker(c, robotScene([red]), 400);
  for (let time = 0; time < 3; time += 0.1)
    assert.equal(
      tracker.step(robotScene(), time).frame.actors['blue-1'],
      undefined,
    );
  const recovered = tracker.step(robotScene([{ ...red, x: 145, y: 150 }]), 3.1);
  assert.ok(Math.abs(recovered.frame.actors['blue-1'].imageX - 0.725) < 0.02);
  assert.ok(recovered.reacquired.includes('blue-1'));
  const card = robotScene();
  card.data.fill(255);
  assert.deepEqual(tracker.step(card, 3.2).frame.actors, {});
  assert.ok(tracker.step(robotScene([red]), 3.3).frame.actors['blue-1']);
});
test('joint assignment never assigns the same visible body to two robot identities', () => {
  const color = [200, 30, 30],
    a = { x: 60, y: 70, color },
    b = { x: 145, y: 140, color };
  const c = {
    ...clip(),
    corners: squareCorners,
    seeds: { 'blue-1': robotSeed(a.x, a.y), 'blue-2': robotSeed(b.x, b.y) },
  };
  const tracker = new LocalTracker(c, robotScene([a, b]), 10);
  const result = tracker.step(robotScene([a]), 10.1);
  assert.equal(Object.keys(result.frame.actors).length, 1);
});
test('resume keeps hidden reference identities available for subsequent re-detection', () => {
  const a = { x: 60, y: 70, color: [200, 30, 30] },
    b = { x: 145, y: 140, color: [230, 220, 230] };
  const c = {
    ...clip(),
    corners: squareCorners,
    seeds: { 'blue-1': robotSeed(a.x, a.y), 'yellow-1': robotSeed(b.x, b.y) },
  };
  const tracker = new LocalTracker(c, robotScene([a, b]), 10);
  const resumed = tracker.resume(
    robotScene([a]),
    20,
    { 'blue-1': c.seeds['blue-1'] },
    squareCorners,
  );
  assert.equal(resumed.actors['yellow-1'], undefined);
  const result = tracker.step(robotScene([a, { ...b, x: 140, y: 60 }]), 20.1);
  assert.ok(result.frame.actors['yellow-1']);
  assert.ok(result.reacquired.includes('yellow-1'));
});
test('reference time and accepted alignment survive corrections, trimming and portable roundtrip', () => {
  const moved = corners.map((p) => ({ x: p.x + 0.02, y: p.y + 0.01 }));
  const c = {
    ...clip(),
    start: 0,
    end: 1800,
    referenceTime: 400,
    frames: [
      { time: 100, actors: { ball: sample() }, corners: moved },
      { time: 101, actors: { ball: sample() } },
      { time: 102, actors: { ball: sample() } },
    ],
  };
  assert.deepEqual(fieldCornersAt(c, 50), corners);
  assert.deepEqual(fieldCornersAt(c, 101), moved);
  const corrected = correctAt(
    c,
    101,
    'ball',
    manualSample(c, 'ball', moved[0], 0, 101),
  );
  assert.ok(
    Math.abs(corrected.frames[1].actors.ball.x - FIELD_CORNERS[0].x) < 1e-7,
  );
  assert.deepEqual(corrected.frames[1].corners, moved);
  const p = {
    ...makeProject({ ...source, duration: 1800 }),
    clips: [corrected],
  };
  const trimmed = trimClip(p, c.id, 101, 102);
  const loaded = parseProject(serializeProject(trimmed));
  assert.equal(loaded.clips[0].referenceTime, 400);
  assert.deepEqual(loaded.clips[0].seeds, c.seeds);
  fieldCornersAt(loaded.clips[0], 101).forEach((p, i) =>
    assert.ok(Math.hypot(p.x - moved[i].x, p.y - moved[i].y) < 1e-5),
  );
  assert.throws(() =>
    parseProject(
      JSON.stringify({ ...p, clips: [{ ...c, referenceTime: 2000 }] }),
    ),
  );
});
function linedField(dx = 0, dy = 0, lines = true) {
  const width = 640,
    height = 360,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const line =
        lines &&
        (((Math.abs(x - 100 - dx) <= 2 || Math.abs(x - 540 - dx) <= 2) &&
          y >= 60 + dy &&
          y <= 300 + dy) ||
          ((Math.abs(y - 60 - dy) <= 2 || Math.abs(y - 300 - dy) <= 2) &&
            x >= 100 + dx &&
            x <= 540 + dx));
      data.set(
        line ? [235, 235, 225, 255] : [30, 115, 60, 255],
        (y * width + x) * 4,
      );
    }
  return { width, height, data };
}
test('white-line alignment follows small camera translations and rejects absent boundaries', () => {
  const original = [
    { x: 100, y: 60 },
    { x: 540, y: 60 },
    { x: 540, y: 300 },
    { x: 100, y: 300 },
  ];
  for (const [dx, dy] of [
    [0, 0],
    [8, -5],
    [-12, 9],
  ]) {
    const fit = fitFieldBoundary(linedField(dx, dy), original);
    assert.equal(fit.valid, true);
    fit.corners.forEach((p, i) =>
      assert.ok(
        Math.hypot(p.x - original[i].x - dx, p.y - original[i].y - dy) < 4,
      ),
    );
  }
  assert.equal(
    fitFieldBoundary(linedField(0, 0, false), original).valid,
    false,
  );
});

test('dark ball detection uses contrast on a blue goal floor without adopting lines or robot hardware', () => {
  const reference = image(100, 100, [25, 25, 25]);
  const detector = DarkBallDetector.fromReference(reference, 102, 102, 7.68);
  assert.ok(
    detector,
    'An off-centre reference must retain the requested ball size',
  );
  function goalFrame(radius) {
    const frame = image(15, 15);
    for (let y = 60; y < 160; y++)
      for (let x = 120; x < 190; x++)
        frame.data.set([25, 85, 200, 255], (y * 200 + x) * 4);
    for (let y = -radius; y <= radius; y++)
      for (let x = -radius; x <= radius; x++)
        if (x * x + y * y <= radius * radius)
          frame.data.set([25, 25, 25, 255], ((110 + y) * 200 + 150 + x) * 4);
    return frame;
  }
  const visible = detector.detect(
    goalFrame(5),
    [],
    (x, y) => x > 125 && x < 185 && y > 70 && y < 150,
  );
  assert.ok(visible.some((p) => Math.hypot(p.x - 150, p.y - 110) < 3));
  for (const radius of [0, 2, 28])
    assert.equal(
      detector.detect(
        goalFrame(radius),
        [],
        (x, y) => x > 125 && x < 185 && y > 70 && y < 150,
      ).length,
      0,
    );
  assert.equal(
    DarkBallDetector.fromReference(image(100, 100), 100, 100, 7.68),
    null,
    'Orange references keep the generic detector',
  );
});
