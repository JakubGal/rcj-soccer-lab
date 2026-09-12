/** Optional native-media regression. Node >=22; installed Firefox; no dependencies.
 * node scripts/check-firefox-playback.mjs <firefox-executable> <video-file> [0,173] [8]
 * Exit 0: presented frames advance; 1: failure; 2: inconclusive (e.g. no rVFC).
 * The video is streamed only over loopback. No existing browser/profile is used.
 */
import { spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const usage =
  'Usage: node scripts/check-firefox-playback.mjs <firefox-executable> <video-file> [comma-starts: 0,173] [duration-seconds: 8]';
const args = process.argv.slice(2);
const report = { status: 'error', cases: [], cleanup: {} };
let server, child, socket, profile, profileRoot, browserPid;
let browserLog = '';
let nextId = 1;
const pending = new Map();

async function cleanupProfile(createdProfile, tempRoot) {
  const exact = realpathSync(createdProfile);
  if (
    exact !== resolve(createdProfile) ||
    dirname(exact) !== tempRoot ||
    !basename(exact).startsWith('rcj-firefox-playback-')
  ) {
    throw new Error(
      'Refusing cleanup outside the exact freshly created temporary profile.',
    );
  }
  // Keep the event loop free while Firefox releases profile locks during shutdown.
  await sleep(500);
  await rm(exact, {
    recursive: true,
    force: false,
    maxRetries: 10,
    retryDelay: 300,
  });
}

function request(method, params, timeout = 30000) {
  return new Promise((resolveReply, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Firefox command timed out: ${method}`));
    }, timeout);
    pending.set(id, { resolve: resolveReply, reject, timer });
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

// Accept one byte range only, including suffix ranges. Never serve outside file bounds.
function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start
    )
      return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

function classify(row) {
  if (!row.requestVideoFrameCallback)
    return {
      status: 'inconclusive',
      reason:
        'requestVideoFrameCallback is unavailable; a moving clock or pixel hash alone is not a pass.',
    };
  const first = row.samples[0],
    last = row.samples.at(-1);
  const elapsed = (last.wall - first.wall) / 1000;
  const clockAdvance = last.time - first.time;
  const presented = row.samples.flatMap((sample) =>
    sample.presented ? [sample.presented] : [],
  );
  if (row.samples.some((sample) => sample.error))
    return {
      status: 'fail',
      reason: 'The media element reported a decoding error.',
    };
  if (
    presented.some(
      (frame) =>
        !Number.isFinite(frame.mediaTime) ||
        Math.abs(frame.mediaTime - frame.clockTime) > 2,
    )
  )
    return {
      status: 'fail',
      reason:
        'A presented-frame timestamp is invalid or more than two seconds away from the native clock.',
    };
  if (clockAdvance < Math.min(1, elapsed * 0.5))
    return {
      status: 'fail',
      reason: 'The native playback clock did not advance sufficiently.',
    };
  const latest = presented.at(-1);
  if (!latest || last.callbacks < 2)
    return {
      status: 'fail',
      reason: 'The clock advanced without successive presented frames.',
    };
  if ((last.wall - latest.wall) / 1000 > Math.max(2.5, elapsed * 0.5))
    return {
      status: 'fail',
      reason: 'The clock advanced but presented frames stopped progressing.',
    };
  const firstPresented = presented[0];
  if (latest.mediaTime <= firstPresented.mediaTime + 0.05)
    return {
      status: 'fail',
      reason:
        'Presented-frame media time stayed frozen while the clock advanced.',
    };
  return {
    status: 'pass',
    reason:
      'Native clock and presented frames advanced. Pixel hashes are corroborating evidence only.',
  };
}

try {
  if (args.length < 2 || args.length > 4) throw new Error(usage);
  const firefox = realpathSync(resolve(args[0]));
  const videoFile = realpathSync(resolve(args[1]));
  if (!statSync(firefox).isFile() || !statSync(videoFile).isFile())
    throw new Error('Firefox and video arguments must both be files.');
  const starts = (args[2] ?? '0,173')
    .split(',')
    .map((value) => (value.trim() === '' ? NaN : Number(value)));
  const seconds = Number(args[3] ?? 8);
  if (
    !starts.length ||
    starts.length > 16 ||
    starts.some((n) => !Number.isFinite(n) || n < 0)
  )
    throw new Error('Provide 1–16 finite, nonnegative start times.');
  if (!Number.isFinite(seconds) || seconds < 3 || seconds > 120)
    throw new Error('Measurement duration must be between 3 and 120 seconds.');
  const size = statSync(videoFile).size;
  const mime =
    {
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.webm': 'video/webm',
      '.ogv': 'video/ogg',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
    }[extname(videoFile).toLowerCase()] ?? 'application/octet-stream';
  if (!size) throw new Error('The video is empty.');
  report.video = { path: videoFile, bytes: size };
  report.requestedSeconds = seconds;
  server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        req.method === 'HEAD'
          ? undefined
          : '<!doctype html><title>Isolated native video check</title><video muted playsinline controls width="960" height="540"></video>',
      );
      return;
    }
    if (path !== '/video') {
      res.writeHead(404);
      res.end();
      return;
    }
    const range = byteRange(req.headers.range, size);
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    const { start, end, partial } = range;
    res.writeHead(partial ? 206 : 200, {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(videoFile, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
  server.requestTimeout = 30000;
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Check the range guard as part of every invocation.
  const checks = await Promise.all([
    fetch(`${origin}/video`, {
      method: 'HEAD',
      headers: { Range: `bytes=${size}-` },
    }),
    fetch(`${origin}/video`, {
      method: 'HEAD',
      headers: { Range: 'bytes=2-1' },
    }),
    fetch(`${origin}/video`, {
      method: 'HEAD',
      headers: { Range: 'bytes=0-0,2-3' },
    }),
    fetch(`${origin}/video`, {
      method: 'HEAD',
      headers: { Range: 'bytes=0-0' },
    }),
  ]);
  if (checks.some((r, i) => r.status !== (i === 3 ? 206 : 416)))
    throw new Error('Loopback byte-range self-test failed.');
  report.rangeSelfTest = 'pass';
  profileRoot = realpathSync(tmpdir());
  profile = mkdtempSync(join(profileRoot, 'rcj-firefox-playback-'));
  // Port 0 lets Firefox choose a free loopback debugging port.
  child = spawn(
    firefox,
    [
      '--headless',
      '--no-remote',
      '--profile',
      profile,
      '--remote-debugging-port',
      '0',
      'about:blank',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const log = (chunk) => {
    browserLog = (browserLog + chunk).slice(-16000);
  };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  let port;
  for (let i = 0; i < 100; i++) {
    port = /WebDriver BiDi listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(
      browserLog,
    )?.[1];
    if (port || launchError || child.exitCode !== null) break;
    await sleep(200);
  }
  if (launchError) throw launchError;
  if (!port)
    throw new Error(
      'Firefox did not expose its built-in WebDriver BiDi endpoint within 20 seconds.',
    );
  socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Firefox WebSocket connection timed out.')),
      10000,
    );
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('Firefox WebSocket connection failed.'));
      },
      { once: true },
    );
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data),
      waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.type === 'error')
      waiting.reject(new Error(`${message.error}: ${message.message}`));
    else waiting.resolve(message.result);
  });
  const session = await request('session.new', { capabilities: {} });
  // Only retain a fallback process target if Firefox confirms our exact fresh profile.
  if (
    session.capabilities['moz:profile'] &&
    realpathSync(session.capabilities['moz:profile']) === realpathSync(profile)
  )
    browserPid = session.capabilities['moz:processID'];
  report.browser = {
    name: session.capabilities.browserName,
    version: session.capabilities.browserVersion,
    headless: session.capabilities['moz:headless'],
    userAgent: session.capabilities.userAgent,
  };
  const context = (await request('browsingContext.getTree', {})).contexts[0]
    .context;
  await request('browsingContext.navigate', {
    context,
    url: origin,
    wait: 'complete',
  });
  const evaluate = async (expression) => {
    const response = await request('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      userActivation: true,
    });
    if (response.type === 'exception')
      throw new Error(response.exceptionDetails.text);
    return JSON.parse(response.result.value);
  };
  const metadata = await evaluate(`(async () => {
    const v = document.querySelector('video'); v.muted = true;
    window.qa = { callbacks: 0, last: null, events: [] };
    window.waitMedia = name => new Promise((resolve, reject) => {
      const finish = () => {clearTimeout(timer); v.removeEventListener(name, finish); resolve();};
      const timer = setTimeout(() => {v.removeEventListener(name, finish); reject(Error(name + ' timed out'));}, 20000);
      v.addEventListener(name, finish);
    });
    for (const name of ['play','playing','pause','waiting','stalled','seeked','ended','error']) v.addEventListener(name, () => qa.events.push({name, time:v.currentTime}));
    if (v.requestVideoFrameCallback) {
      const frame = (wall, meta) => {qa.callbacks++; qa.last={wall, mediaTime:meta.mediaTime, presentedFrames:meta.presentedFrames, clockTime:v.currentTime}; v.requestVideoFrameCallback(frame);};
      v.requestVideoFrameCallback(frame);
    }
    window.captureSample = () => {
      const c=document.createElement('canvas'); c.width=160; c.height=90; const ctx=c.getContext('2d');
      ctx.drawImage(v,0,0,c.width,c.height); const b=ctx.getImageData(0,0,c.width,c.height).data;
      let hash=2166136261; for(let i=0;i<b.length;i++) hash=Math.imul(hash^b[i],16777619);
      const q=v.getVideoPlaybackQuality?.();
      return {wall:performance.now(), time:v.currentTime, paused:v.paused, seeking:v.seeking, ended:v.ended, readyState:v.readyState,
        error:v.error?{code:v.error.code,message:v.error.message}:null, callbacks:qa.callbacks, presented:qa.last,
        pixelHash:(hash>>>0).toString(16), quality:q?{totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames}:null};
    };
    const loaded=waitMedia('loadeddata'); v.src='/video'; v.load(); await loaded;
    return JSON.stringify({duration:v.duration,width:v.videoWidth,height:v.videoHeight,requestVideoFrameCallback:!!v.requestVideoFrameCallback});
  })()`);
  Object.assign(report.video, metadata);
  for (const start of starts) {
    if (start >= metadata.duration || metadata.duration - start < 3)
      throw new Error(
        `Start ${start} leaves fewer than three seconds of video; choose an earlier start.`,
      );
    const measureSeconds = Math.min(seconds, metadata.duration - start - 0.1);
    const setup = await evaluate(`(async () => {
      const v=document.querySelector('video'); v.pause();
      qa.callbacks=0; qa.last=null; qa.events=[];
      if(Math.abs(v.currentTime-${start})>.001){const seeked=waitMedia('seeked');v.currentTime=${start};await seeked;}
      await v.play(); return JSON.stringify(captureSample());
    })()`);
    const row = {
      start,
      measurementSeconds: measureSeconds,
      requestVideoFrameCallback: metadata.requestVideoFrameCallback,
      samples: [setup],
    };
    const count = Math.ceil(measureSeconds / 0.5);
    for (let i = 0; i < count; i++) {
      await sleep((measureSeconds * 1000) / count);
      row.samples.push(await evaluate('JSON.stringify(captureSample())'));
    }
    row.events = await evaluate('JSON.stringify(qa.events)');
    row.distinctPixelHashes = new Set(
      row.samples.map((sample) => sample.pixelHash),
    ).size;
    Object.assign(row, classify(row));
    report.cases.push(row);
    await evaluate(
      'JSON.stringify((document.querySelector("video").pause(), true))',
    );
  }
  report.status = report.cases.some((row) => row.status === 'fail')
    ? 'fail'
    : report.cases.some((row) => row.status === 'inconclusive')
      ? 'inconclusive'
      : 'pass';
  process.exitCode =
    report.status === 'pass' ? 0 : report.status === 'inconclusive' ? 2 : 1;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.browserLog = browserLog;
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await request('browser.close', {}, 5000);
      report.cleanup.browserCloseRequested = true;
    } catch {
      /* Fallback only targets our owned process below. */
    }
    socket.close();
  }
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  if (browserPid && Number.isSafeInteger(browserPid)) {
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(browserPid, 0);
      } catch {
        browserPid = null;
        break;
      }
      await sleep(100);
    }
    if (browserPid) {
      try {
        process.kill(browserPid);
      } catch {
        /* Already exited. */
      }
    }
  }
  if (child && child.exitCode === null) child.kill();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((done) => server.close(done));
  if (profile && existsSync(profile)) {
    try {
      await cleanupProfile(profile, profileRoot);
      report.cleanup.profileRemoved = true;
    } catch (error) {
      report.cleanup.profileRemoved = false;
      report.cleanup.remainingProfile = profile;
      report.cleanup.error = String(error);
    }
  }
  console.log(JSON.stringify(report, null, 2));
}
