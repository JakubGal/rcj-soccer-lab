'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  Film,
  FolderOpen,
  Save,
  Play,
  Pause,
  Download,
  Plus,
  X,
  ScanLine,
  Crosshair,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  PlayCanvasViewport,
  type CameraPreset,
} from '@/components/simulator/PlayCanvasViewport';
import { MATCH_ACTORS } from '@/lib/simulator/match';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import {
  ACTOR_IDS,
  TRACK_LABELS,
  EVENT_KINDS,
  EVENT_LABELS,
  MAX_PROJECT_BYTES,
  MAX_SAMPLES,
  makeProject,
  makeClip,
  newId,
  parseProject,
  serializeProject,
  duration,
  locate,
  timelineTime,
  sampleClip,
  renderPoses,
  scoreAt,
  manualSample,
  correctAt,
  trimClip,
  formatTime,
  trackingSampleTimes,
  fieldCornersAt,
  type Clip,
  type ReconstructionProject,
  type ReconstructionEvent,
  type TrackId,
  type TrackFrame,
  type Seed,
} from '@/lib/reconstruction/project';
import { validCorners } from '@/lib/reconstruction/geometry';
import { suggestEvents, mergeSuggestions } from '@/lib/reconstruction/events';
import {
  downloadBlob,
  exportMime,
  readVideoFrame,
  seekVideo,
} from '@/lib/reconstruction/video';
import { inspectMp4Timing } from '@/lib/reconstruction/mp4';
import './reconstruction.css';

type WorkerReply = {
  frame: TrackFrame;
  cut: boolean;
  lost: TrackId[];
  reacquired?: TrackId[];
  error?: string;
};
type TransportMode =
  | 'idle'
  | 'source'
  | 'linked-replay'
  | 'synthetic-replay'
  | 'export';
const COLORS: Record<TrackId, string> = {
  'blue-1': '#35baff',
  'blue-2': '#35baff',
  'yellow-1': '#ffe34a',
  'yellow-2': '#ffe34a',
  ball: '#ff8b3d',
};
const CORNERS = [
  'Blue-goal end: left',
  'Blue-goal end: right',
  'Opposite end: right',
  'Opposite end: left',
];
const safeName = (s: string) =>
  s.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'match';
const EMPTY: never[] = [];

export default function ReconstructionWorkspace({
  active,
  robotVisual,
}: {
  active: boolean;
  robotVisual: RobotVisualId;
}) {
  const [project, setProject] = useState<ReconstructionProject | null>(null);
  const [url, setUrl] = useState('');
  const [ready, setReady] = useState(false);
  const [sourceAt, setSourceAt] = useState(0);
  const [seekDraft, setSeekDraft] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(60);
  const [clipId, setClipId] = useState('');
  const [at, setAt] = useState(0);
  const [transport, setTransport] = useState<TransportMode>('idle');
  const playing =
    transport === 'linked-replay' ||
    transport === 'synthetic-replay' ||
    transport === 'export';
  const originalPlaying =
    transport === 'source' || transport === 'linked-replay';
  const [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState<CameraPreset>('broadcast');
  const [editMode, setEditMode] = useState<
    'none' | 'corners' | 'seed' | 'correct'
  >('none');
  const [selected, setSelected] = useState<TrackId>('ball');
  const [cursor, setCursor] = useState({ x: 0.5, y: 0.5 });
  const [tracking, setTracking] = useState(false);
  const [trackingPreview, setTrackingPreview] = useState<{
    clipId: string;
    frame: TrackFrame;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [trackingStats, setTrackingStats] = useState({
    frames: 0,
    visible: 0,
    recovered: 0,
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sourceWarning, setSourceWarning] = useState('');
  const [eventKind, setEventKind] =
    useState<ReconstructionEvent['kind']>('goal');
  const [eventTeam, setEventTeam] = useState<'blue' | 'yellow'>('blue');
  const [note, setNote] = useState('');
  const [eventScore, setEventScore] = useState({ blue: 0, yellow: 0 });
  const [eventFilter, setEventFilter] = useState('all');
  const [recording, setRecording] = useState(false);
  const [exportHeight, setExportHeight] = useState(720);
  const [exportUrl, setExportUrl] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackingCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replayFileRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<{ file: File; relink: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourceSeekRef = useRef<AbortController | null>(null);
  const seekEditedRef = useRef(false);
  const transportRef = useRef<TransportMode>('idle');
  const sourceInspectionRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const latestCanvas = useRef<HTMLCanvasElement | null>(null);
  const compositionRef = useRef<HTMLCanvasElement | null>(null);
  const projectRef = useRef(project);
  const atRef = useRef(at);
  const speedRef = useRef(speed);
  const clipIdRef = useRef(clipId);
  useLayoutEffect(() => {
    projectRef.current = project;
    atRef.current = at;
    speedRef.current = speed;
    clipIdRef.current = clipId;
  }, [project, at, clipId, speed]);
  const exportInterrupted = useRef(false);
  const selectedClip = project?.clips.find((c) => c.id === clipId) ?? null;
  const liveFrame =
    tracking && trackingPreview?.clipId === selectedClip?.id
      ? trackingPreview?.frame
      : null;
  const displayCorners = selectedClip
    ? editMode === 'corners'
      ? selectedClip.corners
      : (liveFrame?.corners ?? fieldCornersAt(selectedClip, sourceAt))
    : [];
  const total = project ? duration(project) : 0;
  const location = useMemo(
    () =>
      project
        ? liveFrame && selectedClip
          ? {
              clip: selectedClip,
              time: liveFrame.time,
              offset: timelineTime(
                project,
                selectedClip.id,
                selectedClip.start,
              ),
            }
          : locate(project, at, playing ? undefined : selectedClip?.id)
        : null,
    [project, at, liveFrame, selectedClip, playing],
  );
  const samples = useMemo(
    () =>
      liveFrame
        ? liveFrame.actors
        : location
          ? sampleClip(location.clip, location.time)
          : {},
    [location, liveFrame],
  );
  const poses = useMemo(() => renderPoses(samples), [samples]);
  const score = project ? scoreAt(project, at) : { blue: 0, yellow: 0 };
  const missing = ACTOR_IDS.filter((id) => !samples[id]);
  const currentEvents =
    project?.events.filter(
      (e) =>
        e.status === 'confirmed' &&
        e.clipId === location?.clip.id &&
        location.time >= e.time &&
        location.time - e.time < 3,
    ) ?? [];
  const visibleEvents = useMemo(
    () =>
      project
        ? project.events
            .filter((e) =>
              eventFilter === 'all'
                ? e.status !== 'dismissed'
                : e.status === eventFilter,
            )
            .sort(
              (a, b) =>
                timelineTime(project, a.clipId, a.time) -
                timelineTime(project, b.clipId, b.time),
            )
        : [],
    [project, eventFilter],
  );
  const updateClip = (change: (c: Clip) => Clip) =>
    setProject((p) =>
      p
        ? { ...p, clips: p.clips.map((c) => (c.id === clipId ? change(c) : c)) }
        : p,
    );
  const setTransportMode = useCallback((mode: TransportMode) => {
    transportRef.current = mode;
    setTransport(mode);
  }, []);
  const pauseTransport = useCallback(() => {
    sourceSeekRef.current?.abort();
    sourceSeekRef.current = null;
    setTransportMode('idle');
    videoRef.current?.pause();
  }, [setTransportMode]);
  const showReplayClip = useCallback((clip: Clip) => {
    clipIdRef.current = clip.id;
    setClipId(clip.id);
    setRangeStart(clip.start);
    setRangeEnd(clip.end);
  }, []);
  const stopWork = useCallback(() => {
    pauseTransport();
    abortRef.current?.abort();
    workerRef.current?.terminate();
    workerRef.current = null;
  }, [pauseTransport]);
  const stopExport = useCallback(
    (interrupted = false) => {
      exportInterrupted.current ||= interrupted;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      pauseTransport();
    },
    [pauseTransport],
  );
  const startNativePlayback = useCallback(
    async (
      mode: 'source' | 'linked-replay',
      sourceTime?: number,
      clip?: Clip,
    ) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.readyState < 1)
        return;
      pauseTransport();
      const controller = new AbortController();
      sourceSeekRef.current = controller;
      if (clip) showReplayClip(clip);
      setTransportMode(mode);
      setError('');
      try {
        // Starts and clip transitions are explicit seeks. Once playing, the
        // decoded video owns time; the replay never seeks to correct drift.
        if (sourceTime !== undefined)
          await seekVideo(video, sourceTime, controller.signal);
        if (controller.signal.aborted) return;
        setSourceAt(video.currentTime);
        video.playbackRate = speedRef.current;
        await video.play();
        if (
          controller.signal.aborted &&
          (videoRef.current !== video ||
            !['source', 'linked-replay'].includes(transportRef.current))
        )
          video.pause();
      } catch (e) {
        if (controller.signal.aborted) return;
        pauseTransport();
        setError(
          'The original recording could not play.' +
            (e instanceof Error ? ` — ${e.message}` : ''),
        );
      } finally {
        if (sourceSeekRef.current === controller) sourceSeekRef.current = null;
      }
    },
    [pauseTransport, setTransportMode, showReplayClip],
  );

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(
    () => () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl.url);
    },
    [exportUrl],
  );
  useEffect(() => {
    if (!active) {
      videoRef.current?.pause();
      // eslint-disable-next-line react/react-compiler -- Deactivation cancels external media work and clears the transport that owns it.
      stopWork();
      // eslint-disable-next-line react/react-compiler -- Deactivating this workspace must stop external browser recording and its playback state together.
      stopExport(true);
    }
  }, [active, stopExport, stopWork]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden && recorderRef.current) {
        stopExport(true);
        setMessage(
          'Export paused because the tab became hidden. Download the partial video or restart with this tab visible.',
        );
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [stopExport]);
  useEffect(
    () => () => {
      sourceInspectionRef.current++;
      stopWork();
      const r = recorderRef.current;
      if (r && r.state !== 'inactive') r.stop();
    },
    [stopWork],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (projectRef.current?.clips.length) {
        event.preventDefault();
        // eslint-disable-next-line typescript/no-deprecated -- Legacy browsers still require this to warn before losing an unsaved local replay.
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    if (
      !active ||
      !total ||
      (transport !== 'synthetic-replay' && transport !== 'export')
    )
      return;
    let raf = 0,
      last = performance.now();
    const tick = (now: number) => {
      if (transportRef.current !== transport) return;
      const next = Math.min(
        total,
        atRef.current + Math.min((now - last) / 1000, 0.2) * speed,
      );
      last = now;
      atRef.current = next;
      setAt(next);
      const p = projectRef.current;
      const loc = p && locate(p, next);
      if (loc && loc.clip.id !== clipIdRef.current) {
        showReplayClip(loc.clip);
      }
      if (next >= total) {
        pauseTransport();
        if (recorderRef.current) setTimeout(() => stopExport(), 150);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    transport,
    active,
    total,
    speed,
    stopExport,
    pauseTransport,
    showReplayClip,
  ]);
  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      !active ||
      !ready ||
      (transport !== 'source' && transport !== 'linked-replay')
    )
      return;
    let raf = 0;
    let frameCallback: number | null = null;
    let disposed = false;
    let presentedAt = performance.now();
    let presentedSourceTime = video.currentTime;
    const canWatchFrames =
      typeof video.requestVideoFrameCallback === 'function';
    const resetFrameWatch = () => {
      presentedAt = performance.now();
      presentedSourceTime = video.currentTime;
    };
    const failPresentation = () => {
      pauseTransport();
      setError(
        'The browser stopped presenting video frames. Try a remuxed MP4 copy.',
      );
    };
    const presented: VideoFrameRequestCallback = (_now, metadata) => {
      frameCallback = null;
      if (disposed || transportRef.current !== transport) return;
      if (
        !Number.isFinite(metadata.mediaTime) ||
        metadata.mediaTime < -1 ||
        metadata.mediaTime > video.duration + 1
      ) {
        failPresentation();
        return;
      }
      resetFrameWatch();
      frameCallback = video.requestVideoFrameCallback(presented);
    };
    if (canWatchFrames)
      frameCallback = video.requestVideoFrameCallback(presented);
    document.addEventListener('visibilitychange', resetFrameWatch);
    const tick = () => {
      if (transportRef.current !== transport) return;
      if (
        video.paused ||
        video.seeking ||
        sourceSeekRef.current ||
        document.hidden
      ) {
        resetFrameWatch();
      } else if (
        canWatchFrames &&
        sourceWarning &&
        performance.now() - presentedAt > 3000
      ) {
        // Valid variable-frame-rate footage may intentionally hold a frame.
        // A timeout is actionable only for a source with verified bad timing.
        const rect = video.getBoundingClientRect();
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth;
        if (!visible) resetFrameWatch();
        else if (video.currentTime > presentedSourceTime + 0.5) {
          failPresentation();
          return;
        }
      }
      if (!sourceSeekRef.current && !video.seeking) {
        const sourceTime = video.currentTime;
        setSourceAt(sourceTime);
        if (transport === 'linked-replay') {
          const p = projectRef.current;
          const index =
            p?.clips.findIndex((c) => c.id === clipIdRef.current) ?? -1;
          const clip = p?.clips[index];
          if (!p || !clip) {
            pauseTransport();
            return;
          }
          const next = timelineTime(
            p,
            clip.id,
            Math.max(clip.start, Math.min(clip.end, sourceTime)),
          );
          atRef.current = next;
          setAt(next);
          if (sourceTime >= clip.end - 0.002 || video.ended) {
            const following = p.clips[index + 1];
            if (following) {
              void startNativePlayback(
                'linked-replay',
                following.start,
                following,
              );
            } else {
              pauseTransport();
              return;
            }
          }
        } else if (video.ended) {
          pauseTransport();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback);
      document.removeEventListener('visibilitychange', resetFrameWatch);
    };
  }, [
    transport,
    active,
    ready,
    sourceWarning,
    pauseTransport,
    startNativePlayback,
  ]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, ready]);

  const chooseSource = (file: File, relink: boolean) => {
    if (
      !relink &&
      project?.clips.length &&
      !window.confirm(
        'Open a different recording? Save your replay file first to keep this project.',
      )
    )
      return;
    stopWork();
    stopExport(true);
    setReady(false);
    setError('');
    setMessage('');
    setSourceWarning('');
    const inspection = ++sourceInspectionRef.current;
    void inspectMp4Timing(file)
      .then((result) => {
        if (
          sourceInspectionRef.current === inspection &&
          result &&
          result.invalidSamples > 0
        )
          setSourceWarning(
            'This recording has damaged video timestamps. If playback freezes, open a remuxed MP4 copy; your original file is unchanged.',
          );
      })
      .catch(() => {
        // Optional metadata inspection must not prevent native video playback.
      });
    setEditMode('none');
    pendingFile.current = { file, relink };
    setSeekDraft(null);
    setUrl(URL.createObjectURL(file));
    if (!relink) {
      setProject(null);
      setClipId('');
      setAt(0);
    }
  };
  const metadataLoaded = () => {
    const video = videoRef.current,
      pending = pendingFile.current;
    if (!video) return;
    if (!pending) {
      // Reopening this workspace restores the inspected source frame, which
      // may be outside every replay clip during calibration or source playback.
      video.currentTime = Math.max(
        0,
        Math.min(sourceAt, video.duration - 0.005),
      );
      setReady(true);
      return;
    }
    if (
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !video.videoWidth
    ) {
      setError(
        'The browser cannot read this recording’s duration. Try an H.264 MP4 copy.',
      );
      return;
    }
    const metadata = {
      name: pending.file.name,
      size: pending.file.size,
      lastModified: pending.file.lastModified,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    const existing = projectRef.current;
    if (
      pending.relink &&
      existing &&
      (metadata.size !== existing.source.size ||
        Math.abs(metadata.duration - existing.source.duration) > 0.25 ||
        metadata.width !== existing.source.width ||
        metadata.height !== existing.source.height)
    ) {
      sourceInspectionRef.current++;
      setSourceWarning('');
      setUrl('');
      setError(
        'This is not the recording used by the replay. Choose the original file with matching size, duration and resolution.',
      );
      return;
    }
    if (!pending.relink) {
      setProject(makeProject(metadata));
      setRangeStart(0);
      setRangeEnd(Math.min(3600, video.duration));
    }
    setReady(true);
    const loc =
      pending.relink && existing ? locate(existing, atRef.current) : null;
    video.currentTime = loc?.time ?? 0;
    setSourceAt(loc?.time ?? 0);
    pendingFile.current = null;
    setMessage('Recording opened locally. Nothing has been uploaded.');
  };
  const seekSource = async (
    value: number,
    targetClip: Clip | null = selectedClip,
    mapTimeline = true,
  ) => {
    const video = videoRef.current;
    if (!video || !ready || tracking || recording) return;
    pauseTransport();
    const controller = new AbortController();
    sourceSeekRef.current = controller;
    try {
      await seekVideo(video, value, controller.signal);
      if (controller.signal.aborted) return;
      setSourceAt(video.currentTime);
      if (
        project &&
        targetClip &&
        mapTimeline &&
        video.currentTime >= targetClip.start &&
        video.currentTime <= targetClip.end
      ) {
        const next = timelineTime(project, targetClip.id, video.currentTime);
        atRef.current = next;
        setAt(next);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Could not seek recording.');
    } finally {
      if (sourceSeekRef.current === controller) sourceSeekRef.current = null;
    }
  };
  const seekReplay = (
    value: number,
    preferredClipId?: string,
    nextProject = projectRef.current,
  ) => {
    if (tracking || recording) return;
    pauseTransport();
    setEditMode('none');
    const next = Math.max(
      0,
      Math.min(value, nextProject ? duration(nextProject) : 0),
    );
    atRef.current = next;
    setAt(next);
    const loc = nextProject && locate(nextProject, next, preferredClipId);
    if (loc) {
      showReplayClip(loc.clip);
      if (ready) void seekSource(loc.time, loc.clip, false);
    } else {
      clipIdRef.current = '';
      setClipId('');
    }
  };
  const selectClip = (c: Clip) => {
    if (project) seekReplay(timelineTime(project, c.id, c.start), c.id);
  };
  const toggleReplay = () => {
    if (tracking || recording || !project || !total) return;
    if (playing) {
      pauseTransport();
      return;
    }
    if (url && !ready) return;
    pauseTransport();
    setEditMode('none');
    const next = atRef.current >= total - 0.001 ? 0 : atRef.current;
    const loc = locate(project, next);
    if (!loc) return;
    atRef.current = next;
    setAt(next);
    showReplayClip(loc.clip);
    if (url) void startNativePlayback('linked-replay', loc.time, loc.clip);
    else setTransportMode('synthetic-replay');
  };
  const toggleOriginal = () => {
    if (!ready || tracking || recording) return;
    if (originalPlaying) {
      pauseTransport();
      return;
    }
    setEditMode('none');
    const video = videoRef.current;
    if (video) void startNativePlayback('source', video.ended ? 0 : undefined);
  };
  const addClip = () => {
    if (
      !project ||
      !ready ||
      !Number.isFinite(rangeStart) ||
      !Number.isFinite(rangeEnd) ||
      rangeStart < 0 ||
      rangeEnd > project.source.duration + 0.01 ||
      rangeEnd <= rangeStart ||
      rangeEnd - rangeStart > 3600 ||
      project.clips.length >= 200
    ) {
      setError(
        'Choose a valid clip range, up to 60 minutes per clip and 200 clips per project.',
      );
      return;
    }
    const c = makeClip(rangeStart, Math.min(rangeEnd, project.source.duration));
    c.label = `Clip ${project.clips.length + 1}`;
    setProject({ ...project, clips: [...project.clips, c] });
    setClipId(c.id);
    setAt(duration(project));
    setEditMode('corners');
    setError('');
    void seekSource(c.start, c, false);
  };
  const resetCalibration = async () => {
    if (!selectedClip || !ready) return;
    if (
      selectedClip.frames.length &&
      !window.confirm(
        'Changing calibration clears this clip’s tracking and suggested events. Confirmed notes remain. Continue?',
      )
    )
      return;
    setProject((p) =>
      p
        ? {
            ...p,
            clips: p.clips.map((c) =>
              c.id === clipId
                ? { ...c, corners: [], frames: [], seeds: {} }
                : c,
            ),
            events: p.events.filter(
              (e) => e.clipId !== clipId || e.status === 'confirmed',
            ),
          }
        : p,
    );
    setEditMode('corners');
    await seekSource(selectedClip.referenceTime ?? selectedClip.start);
  };
  const useReferenceFrame = () => {
    if (!selectedClip || !ready || tracking || recording) return;
    if (
      (selectedClip.frames.length || Object.keys(selectedClip.seeds).length) &&
      !window.confirm(
        'Use this frame as the appearance reference? Existing identities and tracking will be cleared. Confirmed events remain.',
      )
    )
      return;
    const referenceTime = sourceAt;
    setProject((p) =>
      p
        ? {
            ...p,
            clips: p.clips.map((c) =>
              c.id === clipId
                ? {
                    ...c,
                    referenceTime,
                    corners: fieldCornersAt(c, referenceTime),
                    seeds: {},
                    frames: [],
                  }
                : c,
            ),
            events: p.events.filter(
              (e) => e.clipId !== clipId || e.status === 'confirmed',
            ),
          }
        : p,
    );
    pauseTransport();
    setEditMode(selectedClip.corners.length === 4 ? 'seed' : 'corners');
    setSelected('ball');
  };
  const trimSelected = () => {
    if (!project || !selectedClip) return;
    try {
      const trimmed = trimClip(project, clipId, rangeStart, rangeEnd);
      if (
        !window.confirm(
          'Trim to this range? Tracking and events outside the new range will be removed from this replay. The original recording is unchanged.',
        )
      )
        return;
      setProject(trimmed);
      seekReplay(timelineTime(trimmed, clipId, rangeStart), clipId, trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not trim clip.');
    }
  };
  const frameClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    setCursor(point);
    placePoint(point);
  };
  const placePoint = (point: { x: number; y: number }) => {
    if (
      !selectedClip ||
      !ready ||
      videoRef.current?.seeking ||
      tracking ||
      recording ||
      editMode === 'none'
    )
      return;
    setError('');
    if (editMode === 'corners') {
      const points = [...selectedClip.corners, point];
      if (points.length === 4 && !validCorners(points)) {
        setError(
          'These points cross or form a flat shape. Click the four corners again in order.',
        );
        updateClip((c) => ({ ...c, corners: [] }));
        return;
      }
      updateClip((c) => ({ ...c, corners: points }));
      if (points.length === 4) {
        setEditMode('seed');
        setSelected('ball');
      }
    } else if (editMode === 'seed') {
      if (
        Math.abs(
          sourceAt - (selectedClip.referenceTime ?? selectedClip.start),
        ) > 0.05
      ) {
        setError(
          'Identify the objects on the reference frame. Select Use this frame as reference to choose a different clear frame.',
        );
        return;
      }
      const defaults: Seed = {
        ...point,
        radius:
          selected === 'ball'
            ? selectedClip.ballDiameter === '74'
              ? 0.013
              : 0.008
            : 0.035,
        groundOffset: 0,
        yaw: selected.startsWith('yellow') ? Math.PI : 0,
      };
      updateClip((c) => ({
        ...c,
        seeds: {
          ...c.seeds,
          [selected]: { ...defaults, ...c.seeds[selected], ...point },
        },
      }));
      const next = ACTOR_IDS.find(
        (id) => id !== selected && !selectedClip.seeds[id],
      );
      if (next) setSelected(next);
      else setEditMode('none');
    } else {
      if (sourceAt < selectedClip.start || sourceAt > selectedClip.end) {
        setError('Choose a frame inside the selected clip.');
        return;
      }
      try {
        updateClip((c) =>
          correctAt(
            c,
            sourceAt,
            selected,
            manualSample(
              c,
              selected,
              point,
              sampleClip(c, sourceAt)[selected]?.yaw ??
                c.seeds[selected]?.yaw ??
                0,
              sourceAt,
            ),
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Check field calibration.');
      }
    }
  };
  const track = async (continueHere: boolean) => {
    if (
      !selectedClip ||
      !videoRef.current ||
      !project ||
      !ready ||
      !validCorners(selectedClip.corners)
    )
      return;
    const c = selectedClip;
    const start = continueHere ? sourceAt : c.start;
    if (start < c.start || start >= c.end) {
      setError('Choose a tracking start inside the clip.');
      return;
    }
    const previousSamples = sampleClip(c, start);
    const startingSeeds: Clip['seeds'] = continueHere
      ? Object.fromEntries(
          ACTOR_IDS.flatMap((id) => {
            const p = previousSamples[id];
            if (!p) return [];
            return [
              [
                id,
                {
                  ...c.seeds[id],
                  x: p.imageX,
                  y: p.imageY,
                  yaw: p.yaw,
                  radius:
                    c.seeds[id]?.radius ?? (id === 'ball' ? 0.008 : 0.035),
                  groundOffset: c.seeds[id]?.groundOffset ?? 0,
                },
              ],
            ];
          }),
        )
      : c.seeds;
    if (!Object.keys(startingSeeds).length && !Object.keys(c.seeds).length) {
      setError('Identify at least one visible robot or ball first.');
      return;
    }
    if (
      c.frames.some((f) => f.time >= start) &&
      !window.confirm(
        'Tracking from here replaces later samples in this clip, including later corrections. Continue?',
      )
    )
      return;
    const sampleTimes = trackingSampleTimes(start, c.end, c.fps);
    const otherCount = project.clips
      .filter((clip) => clip.id !== c.id)
      .reduce((n, clip) => n + clip.frames.length, 0);
    if (
      otherCount +
        c.frames.filter((f) => f.time < start).length +
        sampleTimes.length >
      MAX_SAMPLES
    ) {
      setError(
        'This project would exceed 100,000 samples. Use fewer samples per second or split it into replay files.',
      );
      return;
    }
    pauseTransport();
    setTracking(true);
    setTrackingPreview(null);
    setProgress(0);
    setTrackingStats({ frames: 0, visible: 0, recovered: 0 });
    setError('');
    setEditMode('none');
    const controller = new AbortController();
    abortRef.current = controller;
    let worker: Worker | null = null;
    const canvas = document.createElement('canvas');
    const video = videoRef.current;
    const frames = c.frames.filter((f) => f.time < start - 0.001);
    let newSamples = 0;
    const cutTimes: number[] = [];
    let recovered = 0;
    let lastPreview = -Infinity;
    let previewCorners = fieldCornersAt(c, start);
    const send = (
      type: 'init' | 'step' | 'resume',
      time: number,
      image: ImageData,
    ) =>
      new Promise<WorkerReply>((resolve, reject) => {
        if (!worker || controller.signal.aborted) {
          reject(new DOMException('Cancelled', 'AbortError'));
          return;
        }
        const cleanup = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', aborted);
        };
        const aborted = () => {
          cleanup();
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              'Tracking worker timed out. Reduce the clip resolution or length.',
            ),
          );
        }, 30000);
        controller.signal.addEventListener('abort', aborted, { once: true });
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          cleanup();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data);
        };
        worker.onerror = () => {
          cleanup();
          reject(new Error('Local tracking could not start in this browser.'));
        };
        worker.postMessage(
          {
            type,
            time,
            clip: type === 'init' ? { ...c, frames: [] } : undefined,
            seeds: type === 'resume' ? startingSeeds : undefined,
            corners: type === 'resume' ? fieldCornersAt(c, start) : undefined,
            image: {
              width: image.width,
              height: image.height,
              data: image.data,
            },
          },
          [image.data.buffer],
        );
      });
    try {
      worker = new Worker(
        new URL('../../lib/reconstruction/tracking.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;
      const referenceTime = c.referenceTime ?? c.start;
      await seekVideo(video, referenceTime, controller.signal);
      let initial = await send(
        'init',
        referenceTime,
        readVideoFrame(video, canvas),
      );
      if (continueHere) {
        await seekVideo(video, start, controller.signal);
        initial = await send('resume', start, readVideoFrame(video, canvas));
      }
      for (const [index, time] of sampleTimes.entries()) {
        if (controller.signal.aborted)
          throw new DOMException('Cancelled', 'AbortError');
        await seekVideo(video, time, controller.signal);
        const result =
          index === 0 &&
          (continueHere || Math.abs(time - referenceTime) < 0.001)
            ? initial
            : await send('step', time, readVideoFrame(video, canvas));
        frames.push(result.frame);
        newSamples++;
        previewCorners = result.frame.corners ?? previewCorners;
        recovered += result.reacquired?.length ?? 0;
        if (result.cut && time - (cutTimes.at(-1) ?? -Infinity) > 2)
          cutTimes.push(time);
        if (
          performance.now() - lastPreview >= 150 ||
          index === sampleTimes.length - 1
        ) {
          lastPreview = performance.now();
          // Paint the actual decoded frame used by the detector. Repeated
          // paused-video seeks need not be presented by the video compositor.
          const previewCanvas = trackingCanvasRef.current;
          if (previewCanvas) {
            if (
              previewCanvas.width !== canvas.width ||
              previewCanvas.height !== canvas.height
            ) {
              previewCanvas.width = canvas.width;
              previewCanvas.height = canvas.height;
            }
            previewCanvas.getContext('2d')?.drawImage(canvas, 0, 0);
          }
          setTrackingPreview({
            clipId: c.id,
            frame: { ...result.frame, corners: previewCorners },
          });
          setAt(timelineTime(project, c.id, time));
          setProgress((time - start) / (c.end - start));
          setSourceAt(time);
          setTrackingStats({
            frames: newSamples,
            visible: Object.keys(result.frame.actors).length,
            recovered,
          });
        }
      }
      setMessage(
        cutTimes.length
          ? 'Full range processed. Camera changes were marked for review; add separately calibrated clips for different views.'
          : 'Tracking finished. Review gaps and identity changes before trusting the reconstruction.',
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError')
        setMessage('Tracking cancelled. Completed samples have been kept.');
      else
        setError(
          e instanceof Error
            ? e.message
            : 'Tracking failed. Completed samples have been kept.',
        );
    } finally {
      worker?.terminate();
      workerRef.current = null;
      abortRef.current = null;
      const completed = newSamples ? { ...c, frames } : c;
      const suggestions = suggestEvents(completed);
      for (const cutAt of cutTimes)
        suggestions.push({
          id: `${c.id}:camera-cut:${cutAt.toFixed(3)}`,
          clipId: c.id,
          time: cutAt,
          kind: 'camera-cut',
          status: 'suggested',
          note: 'Large image change. Detection resumes when the calibrated view returns; use a separate calibration for a different view.',
        });
      setProject((p) =>
        p
          ? {
              ...p,
              clips: p.clips.map((clip) =>
                clip.id === c.id ? completed : clip,
              ),
              events: newSamples
                ? mergeSuggestions(p.events, c.id, suggestions)
                : p.events,
            }
          : p,
      );
      const finishedAt = newSamples ? frames[frames.length - 1].time : start;
      setTracking(false);
      setTrackingPreview(null);
      setProgress(0);
      setAt(timelineTime(project, c.id, finishedAt));
      setSourceAt(finishedAt);
      if (active && video.isConnected) {
        const restore = new AbortController();
        sourceSeekRef.current?.abort();
        sourceSeekRef.current = restore;
        void seekVideo(video, finishedAt, restore.signal)
          .catch((e: unknown) => {
            if (!restore.signal.aborted)
              setError(
                e instanceof Error ? e.message : 'Could not seek recording.',
              );
          })
          .finally(() => {
            if (sourceSeekRef.current === restore) sourceSeekRef.current = null;
          });
      }
    }
  };

  const addEvent = () => {
    if (!project || !location) return;
    const value: ReconstructionEvent = {
      id: newId(),
      clipId: location.clip.id,
      time: location.time,
      kind: eventKind,
      status: 'confirmed',
      note: note.trim().slice(0, 500),
      ...(eventKind === 'goal' ? { team: eventTeam } : {}),
      ...(['out', 'damaged', 'pushed-out'].includes(eventKind)
        ? { actor: selected }
        : {}),
      ...(eventKind === 'score' ? { score: eventScore } : {}),
    };
    setProject({ ...project, events: [...project.events, value] });
    setNote('');
  };
  const importReplay = async (file: File) => {
    if (file.size > MAX_PROJECT_BYTES) {
      setError('Replay file is too large (128 MB limit).');
      return;
    }
    try {
      const value = parseProject(await file.text());
      if (
        project?.clips.length &&
        !window.confirm(
          'Replace the current project? Save its replay file first if needed.',
        )
      )
        return;
      stopWork();
      stopExport(true);
      sourceInspectionRef.current++;
      setSourceWarning('');
      setUrl('');
      setReady(false);
      setProject(value);
      setClipId(value.clips[0]?.id ?? '');
      setRangeStart(value.clips[0]?.start ?? 0);
      setRangeEnd(value.clips[0]?.end ?? Math.min(3600, value.source.duration));
      setSourceAt(value.clips[0]?.start ?? 0);
      setSeekDraft(null);
      setAt(0);
      setEditMode('none');
      setError('');
      setMessage(
        'Replay loaded. 3D playback works without the recording. Relink the original video to review or track more.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid replay file.');
    }
  };
  const save = () => {
    if (!project) return;
    try {
      const text = serializeProject(project);
      downloadBlob(
        new Blob([text], { type: 'application/json' }),
        `${safeName(project.title)}.rcj-replay.json`,
      );
      setMessage(
        'Replay saved to your downloads. Keep this file: the app does not upload or automatically store your project.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save replay.');
    }
  };
  const captureFrame = useCallback(
    (canvas: HTMLCanvasElement, renderedTime?: number) => {
      latestCanvas.current = canvas;
      const output = compositionRef.current,
        p = projectRef.current;
      if (!output || !p || renderedTime === undefined) return;
      const ctx = output.getContext('2d');
      if (!ctx) return;
      const time = renderedTime,
        score = scoreAt(p, time),
        loc = locate(p, time);
      ctx.fillStyle = '#071016';
      ctx.fillRect(0, 0, output.width, output.height);
      const availableHeight = output.height - 126;
      const scale = Math.min(
        output.width / canvas.width,
        availableHeight / canvas.height,
      );
      const w = canvas.width * scale,
        h = canvas.height * scale;
      ctx.drawImage(
        canvas,
        (output.width - w) / 2,
        72 + (availableHeight - h) / 2,
        w,
        h,
      );
      ctx.fillStyle = '#dbeef4';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('RCJ · VIDEO RECONSTRUCTION', 24, 34);
      ctx.font = '18px sans-serif';
      ctx.fillText(
        `Replay ${formatTime(time)} / ${formatTime(duration(p))}   ·   Source ${formatTime(loc?.time ?? 0)}`,
        24,
        60,
      );
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        `BLUE ${score.blue}   :   ${score.yellow} YELLOW`,
        output.width - 24,
        43,
      );
      ctx.textAlign = 'left';
      const visible = loc
        ? p.events
            .filter(
              (e) =>
                e.status === 'confirmed' &&
                e.clipId === loc.clip.id &&
                loc.time >= e.time &&
                loc.time - e.time < 3,
            )
            .map(
              (e) =>
                `${EVENT_LABELS[e.kind]}${e.team ? ` · ${e.team}` : ''}${e.actor ? ` · ${TRACK_LABELS[e.actor]}` : ''}${e.note ? ` · ${e.note}` : ''}`,
            )
            .join(' | ')
        : '';
      ctx.fillStyle = '#fbbf24';
      ctx.font = '17px sans-serif';
      ctx.fillText(
        visible.slice(0, 130) ||
          'Estimated reconstruction · hidden objects are not invented · score uses confirmed events',
        24,
        output.height - 27,
        output.width - 48,
      );
    },
    [],
  );
  const startExport = () => {
    const mime = exportMime();
    if (
      !project ||
      !total ||
      !latestCanvas.current ||
      !mime ||
      !HTMLCanvasElement.prototype.captureStream
    ) {
      setError(
        'Video export is unavailable in this browser. You can still save the replay file.',
      );
      return;
    }
    const output = document.createElement('canvas');
    output.width = exportHeight === 1080 ? 1920 : 1280;
    output.height = exportHeight;
    compositionRef.current = output;
    exportInterrupted.current = false;
    let stream: MediaStream | null = null;
    const chunks: Blob[] = [];
    let bytes = 0;
    try {
      stream = output.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: exportHeight === 1080 ? 5000000 : 2200000,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          bytes += event.data.size;
          if (bytes > 512 * 1024 * 1024 && recorder.state !== 'inactive') {
            exportInterrupted.current = true;
            setError(
              'Export reached the 512 MB safety limit. This video is partial; use shorter clips or 720p.',
            );
            recorder.stop();
            pauseTransport();
          }
        }
      };
      recorder.onerror = () => {
        setError(
          'Video recording failed. Save the replay file and try another browser.',
        );
        stopExport(true);
      };
      recorder.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        compositionRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (chunks.length) {
          const blob = new Blob(chunks, { type: mime });
          const partial = exportInterrupted.current;
          setExportUrl({
            url: URL.createObjectURL(blob),
            name: `${safeName(project.title)}${partial ? '-partial' : ''}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`,
          });
          setMessage(
            partial
              ? 'Partial video ready to download.'
              : '3D video ready to download, with score and confirmed events. The export is silent.',
          );
        }
      };
      setError('');
      pauseTransport();
      setAt(0);
      atRef.current = 0;
      setSpeed(1);
      setEditMode('none');
      setRecording(true);
      recorder.start(1000);
      setTransportMode('export');
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      compositionRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      pauseTransport();
      setError(
        e instanceof Error ? e.message : 'Video export could not start.',
      );
    }
  };
  if (!active) return null;

  return (
    <section
      className="reconstruction-workspace"
      aria-label="Video match reconstruction"
    >
      <header className="reconstruction-heading">
        <div>
          <p className="reconstruction-eyebrow">LOCAL VIDEO → EDITABLE 3D</p>
          <h1>Match reconstruction</h1>
          <p>
            Track a recording, review the uncertain moments, then replay it from
            any angle.
          </p>
        </div>
        <div className="reconstruction-actions">
          <Button
            disabled={tracking || recording}
            onClick={() => fileRef.current?.click()}
          >
            <FolderOpen />
            {project && !url ? 'Relink recording' : 'Open recording'}
          </Button>
          <Button
            variant="outline"
            disabled={tracking || recording}
            onClick={() => replayFileRef.current?.click()}
          >
            <Film />
            Load replay
          </Button>
          <Button
            variant="outline"
            disabled={!project || tracking || recording}
            onClick={save}
          >
            <Save />
            Save replay
          </Button>
        </div>
        <input
          hidden
          ref={fileRef}
          type="file"
          accept="video/*,.mkv,.mp4,.mov,.webm"
          aria-label="Choose local match recording"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) chooseSource(file, Boolean(project && !url));
            e.target.value = '';
          }}
        />
        <input
          hidden
          ref={replayFileRef}
          type="file"
          accept=".json,.rcj-replay"
          aria-label="Load RCJ replay file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importReplay(file);
            e.target.value = '';
          }}
        />
      </header>
      <p className="reconstruction-notice">
        Assisted reconstruction, not an exact automatic referee. Hidden objects,
        robot headings and side-view perspective can be uncertain. Sound is not
        required. Nothing is uploaded; save your replay before leaving.
      </p>
      {error && (
        <div className="reconstruction-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {message && <output className="reconstruction-message">{message}</output>}
      {sourceWarning && (
        <output className="reconstruction-message">{sourceWarning}</output>
      )}
      <div className="reconstruction-views">
        <section className="reconstruction-panel">
          <div className="reconstruction-panel-title">
            <h2>Original recording</h2>
            <span data-i18n-skip>{project?.source.name ?? 'Local file'}</span>
          </div>
          {/* eslint-disable jsx-a11y/prefer-tag-over-role -- A composite video/SVG drawing surface contains block content; keyboard placement provides its button behaviour. */}
          <div
            className={`reconstruction-source ${url ? 'has-video' : ''} ${editMode !== 'none' ? 'is-editing' : ''}`}
            onClick={frameClick}
            role="button"
            tabIndex={ready && editMode !== 'none' ? 0 : -1}
            aria-label="Video calibration. Arrow keys move the cursor; Enter places the selected point. Shift moves more precisely."
            onKeyDown={(event) => {
              if (editMode === 'none' || !ready || tracking || recording)
                return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                placePoint(cursor);
                return;
              }
              const step = event.shiftKey ? 0.001 : 0.01;
              const delta: { [key: string]: [number, number] } = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const direction = delta[event.key];
              if (!direction) return;
              event.preventDefault();
              event.stopPropagation();
              setCursor((p) => ({
                x: Math.max(0, Math.min(1, p.x + direction[0])),
                y: Math.max(0, Math.min(1, p.y + direction[1])),
              }));
            }}
          >
            {url ? (
              <video
                ref={videoRef}
                src={url}
                preload="auto"
                playsInline
                muted
                onLoadedMetadata={metadataLoaded}
                onTimeUpdate={(e) => {
                  if (!tracking) setSourceAt(e.currentTarget.currentTime);
                }}
                onSeeked={(e) => {
                  if (!tracking) setSourceAt(e.currentTarget.currentTime);
                }}
                onPause={(e) => {
                  if (
                    e.currentTarget.paused &&
                    !e.currentTarget.ended &&
                    !sourceSeekRef.current &&
                    (transportRef.current === 'source' ||
                      transportRef.current === 'linked-replay')
                  )
                    pauseTransport();
                }}
                onEnded={() => {
                  if (transportRef.current === 'source') pauseTransport();
                }}
                onError={() => {
                  if (
                    transportRef.current === 'source' ||
                    transportRef.current === 'linked-replay'
                  )
                    pauseTransport();
                  setReady(false);
                  setError(
                    'The browser could not open this codec/container. MKV support varies: remux or convert a local copy to H.264 MP4, then open it here.',
                  );
                }}
              />
            ) : (
              <div className="reconstruction-empty">
                <Film size={36} />
                <h3>
                  {project
                    ? 'Recording not linked'
                    : 'Bring a real match into the lab'}
                </h3>
                <p>
                  {project
                    ? 'The saved 3D replay still works. Relink the original recording to inspect or change tracking.'
                    : 'Open a video from your computer. Recordings remain local, including very large files.'}
                </p>
              </div>
            )}
            {tracking && (
              <canvas
                ref={trackingCanvasRef}
                className="reconstruction-tracking-frame"
                aria-label="Latest processed video frame"
                style={{ visibility: liveFrame ? 'visible' : 'hidden' }}
              />
            )}
            {ready && selectedClip && (
              <svg
                className="reconstruction-overlay"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {editMode !== 'none' && (
                  <g stroke="white" strokeWidth="3">
                    <path
                      d={`M ${cursor.x * 1000 - 12} ${cursor.y * 1000} h24 M ${cursor.x * 1000} ${cursor.y * 1000 - 16} v32`}
                    />
                  </g>
                )}
                {displayCorners.length > 1 && (
                  <polyline
                    points={
                      displayCorners
                        .map((p) => `${p.x * 1000},${p.y * 1000}`)
                        .join(' ') +
                      (displayCorners.length === 4
                        ? ` ${displayCorners[0].x * 1000},${displayCorners[0].y * 1000}`
                        : '')
                    }
                    fill="none"
                    stroke="#67e8f9"
                    strokeWidth="3"
                  />
                )}
                {displayCorners.map((p, i) => (
                  <g key={i}>
                    <circle
                      cx={p.x * 1000}
                      cy={p.y * 1000}
                      r="10"
                      fill="#083344"
                      stroke="#67e8f9"
                      strokeWidth="3"
                    />
                    <text
                      x={p.x * 1000 + 14}
                      y={p.y * 1000 - 10}
                      fill="white"
                      fontSize="28"
                    >
                      {i + 1}
                    </text>
                  </g>
                ))}
                {ACTOR_IDS.map((id) => {
                  const s =
                    editMode === 'seed'
                      ? selectedClip.seeds[id]
                      : liveFrame
                        ? liveFrame.actors[id]
                        : sampleClip(selectedClip, sourceAt)[id];
                  if (!s) return null;
                  const p = 'imageX' in s ? { x: s.imageX, y: s.imageY } : s;
                  const radius =
                    (selectedClip.seeds[id]?.radius ?? 0.015) * 1000;
                  return (
                    <g key={id}>
                      <ellipse
                        cx={p.x * 1000}
                        cy={p.y * 1000}
                        rx={radius}
                        ry={
                          (radius * project!.source.width) /
                          project!.source.height
                        }
                        fill="none"
                        stroke={COLORS[id]}
                        strokeWidth="3"
                      />
                      <text
                        x={p.x * 1000 + radius + 5}
                        y={p.y * 1000}
                        fill={COLORS[id]}
                        stroke="#071016"
                        strokeWidth="1"
                        fontSize="25"
                      >
                        {TRACK_LABELS[id]}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          {/* eslint-enable jsx-a11y/prefer-tag-over-role */}
          {project && (
            <div className="reconstruction-source-controls">
              <label>
                Recording time{' '}
                <output>
                  {formatTime(sourceAt, true)} /{' '}
                  {formatTime(project.source.duration)}
                </output>
                <input
                  type="range"
                  aria-label="Recording time"
                  min="0"
                  max={project.source.duration}
                  step="0.1"
                  value={sourceAt}
                  disabled={!ready || tracking || recording}
                  onChange={(e) => void seekSource(Number(e.target.value))}
                />
              </label>
              <div className="reconstruction-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ready || tracking || recording}
                  onClick={toggleOriginal}
                >
                  {originalPlaying ? <Pause /> : <Play />}
                  {originalPlaying ? 'Pause original' : 'Play original'}
                </Button>
                {[-500, -100, 100, 500].map((milliseconds) => (
                  <Button
                    key={milliseconds}
                    size="sm"
                    variant="outline"
                    disabled={!ready || tracking || recording}
                    onClick={() =>
                      void seekSource(
                        (videoRef.current?.currentTime ?? sourceAt) +
                          milliseconds / 1000,
                      )
                    }
                    data-i18n-skip
                  >
                    {milliseconds < 0 ? '−' : '+'}
                    {Math.abs(milliseconds)} ms
                  </Button>
                ))}
                <label>
                  Go to second{' '}
                  <input
                    className="reconstruction-number"
                    type="number"
                    min="0"
                    step="0.1"
                    max={project.source.duration}
                    value={seekDraft ?? sourceAt.toFixed(3)}
                    onFocus={(e) => {
                      // Freeze the text while it is selected/edited. Otherwise
                      // advancing playback can replace it between Ctrl+A and typing.
                      seekEditedRef.current = false;
                      setSeekDraft(e.currentTarget.value);
                    }}
                    onChange={(e) => {
                      seekEditedRef.current = true;
                      setSeekDraft(e.currentTarget.value);
                    }}
                    disabled={!ready || tracking || recording}
                    onBlur={(e) => {
                      if (
                        seekEditedRef.current &&
                        Number.isFinite(e.currentTarget.valueAsNumber)
                      )
                        void seekSource(e.currentTarget.valueAsNumber);
                      seekEditedRef.current = false;
                      setSeekDraft(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </section>
        <section className="reconstruction-panel">
          <div className="reconstruction-panel-title">
            <h2>Reconstructed match</h2>
            <NativeSelect
              aria-label="Reconstruction camera"
              value={camera}
              onChange={(e) => setCamera(e.target.value as CameraPreset)}
            >
              <NativeSelectOption value="broadcast">
                Broadcast
              </NativeSelectOption>
              <NativeSelectOption value="overhead">Overhead</NativeSelectOption>
              <NativeSelectOption value="free">Free orbit</NativeSelectOption>
              <NativeSelectOption value="ball">Follow ball</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="reconstruction-3d">
            <PlayCanvasViewport
              actors={MATCH_ACTORS}
              poses={poses}
              cameraPreset={camera}
              showRuleGeometry={false}
              showBallTrail={false}
              showContactEvidence={false}
              ballTrail={EMPTY}
              phaseLabel="Video reconstruction · estimated positions"
              robotVisual={robotVisual}
              onCaptureFrame={captureFrame}
              captureTime={at}
              captureHeight={recording ? exportHeight : undefined}
              ballDiameter={Number(location?.clip.ballDiameter ?? '42') / 1000}
            />
            <div
              className="reconstruction-score"
              aria-label="Reconstruction score"
            >
              <span>
                BLUE <b>{score.blue}</b>
              </span>
              <span>{formatTime(at, true)}</span>
              <span>
                <b>{score.yellow}</b> YELLOW
              </span>
            </div>
          </div>
          <div className="reconstruction-quality">
            {tracking && <span>Live tracking preview</span>}
            <span>{Object.keys(samples).length} / 5 tracked</span>
            <span>Heading follows motion unless corrected</span>
            {Object.entries(samples).some(([, p]) => p.confidence < 0.7) && (
              <span>Uncertain tracks — check identities against the video</span>
            )}
            {missing.length > 0 && (
              <span>
                Unknown:{' '}
                <span data-i18n-skip>
                  {missing.map((id) => TRACK_LABELS[id]).join(', ')}
                </span>
              </span>
            )}
          </div>
          {currentEvents.length > 0 && (
            <div className="reconstruction-live-event">
              {currentEvents.map((e) => (
                <span key={e.id}>
                  {EVENT_LABELS[e.kind]} <span data-i18n-skip>{e.note}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
      <section
        className="reconstruction-transport"
        aria-label="Reconstruction timeline"
      >
        {tracking && (
          <div className="reconstruction-live-progress">
            <progress max="1" value={progress} />
            <span>{`Processing: ${formatTime(sourceAt, true)} · ${trackingStats.frames} frames`}</span>
            <Button variant="outline" size="sm" onClick={stopWork}>
              Stop and review
            </Button>
          </div>
        )}
        <div className="reconstruction-actions">
          <Button
            disabled={!total || tracking || recording || (!!url && !ready)}
            onClick={toggleReplay}
          >
            {playing ? <Pause /> : <Play />}
            {playing ? 'Pause replay' : 'Play replay'}
          </Button>
          <Button
            variant="outline"
            disabled={!total || tracking || recording}
            onClick={() => seekReplay(0)}
          >
            Start
          </Button>
          <NativeSelect
            aria-label="Replay speed"
            value={String(speed)}
            disabled={recording || tracking}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.25, 0.5, 1, 2, 4].map((n) => (
              <NativeSelectOption key={n} value={n}>
                {n}×
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <output>
            {formatTime(at, true)} / {formatTime(total)}
          </output>
        </div>
        <input
          type="range"
          aria-label="3D match timeline"
          min="0"
          max={Math.max(0.01, total)}
          step="0.02"
          value={at}
          disabled={!total || tracking || recording}
          onChange={(e) => seekReplay(Number(e.target.value))}
        />
        <div className="reconstruction-clip-strip">
          {project?.clips.map((c) => (
            <button
              key={c.id}
              className={clipId === c.id ? 'selected' : ''}
              disabled={tracking || recording}
              style={{ flex: Math.max(1, c.end - c.start) }}
              onClick={() => selectClip(c)}
            >
              <span data-i18n-skip>{c.label}</span>
              <small>
                {formatTime(c.end - c.start)} ·{' '}
                {c.frames.length ? 'Tracked' : 'Not tracked'}
              </small>
            </button>
          ))}
        </div>
      </section>
      <div className="reconstruction-tools">
        <section className="reconstruction-panel reconstruction-tool">
          <h2>1 · Choose clips</h2>
          <p>
            One fixed camera per clip. Add halves of any length; omit long
            pauses or keep them. Clips play in the order added. Original
            recording time is preserved.
          </p>
          <div className="reconstruction-form-row">
            <label>
              From second
              <input
                type="number"
                min="0"
                step="0.1"
                value={rangeStart}
                disabled={tracking || recording}
                onChange={(e) => setRangeStart(Number(e.target.value))}
              />
            </label>
            <label>
              To second
              <input
                type="number"
                min="0"
                step="0.1"
                value={rangeEnd}
                disabled={tracking || recording}
                onChange={(e) => setRangeEnd(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="reconstruction-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || tracking || recording}
              onClick={() => {
                setRangeStart(0);
                setRangeEnd(Math.min(3600, project?.source.duration ?? 0));
              }}
            >
              Use whole recording
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || tracking || recording}
              onClick={() => setRangeStart(Number(sourceAt.toFixed(2)))}
            >
              Use current time as start
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ready || tracking || recording}
              onClick={() => setRangeEnd(Number(sourceAt.toFixed(2)))}
            >
              Use current time as end
            </Button>
            <Button
              disabled={!ready || tracking || recording}
              onClick={addClip}
            >
              <Plus />
              Add clip
            </Button>
          </div>
          {selectedClip && (
            <>
              <label>
                Clip label
                <input
                  data-i18n-skip
                  maxLength={100}
                  value={selectedClip.label}
                  disabled={tracking || recording}
                  onChange={(e) =>
                    updateClip((c) => ({ ...c, label: e.target.value }))
                  }
                />
              </label>
              <div className="reconstruction-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    tracking ||
                    recording ||
                    (rangeStart === selectedClip.start &&
                      rangeEnd === selectedClip.end)
                  }
                  onClick={trimSelected}
                >
                  Trim selected clip to range
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    tracking || recording || project!.clips[0].id === clipId
                  }
                  onClick={() => {
                    if (!project) return;
                    const clips = [...project.clips],
                      i = clips.findIndex((c) => c.id === clipId);
                    if (i > 0)
                      [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]];
                    const reordered = { ...project, clips };
                    setProject(reordered);
                    seekReplay(0, undefined, reordered);
                  }}
                >
                  Move clip earlier
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={tracking || recording}
                  onClick={() => {
                    if (
                      project &&
                      window.confirm(
                        'Remove this clip, its tracking and its events?',
                      )
                    ) {
                      const remaining = {
                        ...project,
                        clips: project.clips.filter((c) => c.id !== clipId),
                        events: project.events.filter(
                          (e) => e.clipId !== clipId,
                        ),
                      };
                      setProject(remaining);
                      seekReplay(0, undefined, remaining);
                    }
                  }}
                >
                  Remove clip
                </Button>
              </div>
            </>
          )}
          <details>
            <summary>Recording compatibility & privacy</summary>
            <p>
              MP4, WebM and browser-decodable MKV/MOV are supported. Container
              support depends on the codecs and your browser. Multi-gigabyte
              videos are read in small frames, not loaded entirely into memory.
            </p>
            <p>
              For an unsupported MKV, make a local H.264 MP4 copy. Your original
              file is never changed. No cloud processing, microphone access or
              external AI service is used.
            </p>
          </details>
        </section>
        <section className="reconstruction-panel reconstruction-tool">
          <h2>2 · Calibrate & track</h2>
          <p>
            Choose a clear frame where the field and objects are visible, then
            use it as the reference. Detection searches the whole selected
            range, including footage before this frame.
          </p>
          {selectedClip && (
            <p>
              Reference frame:{' '}
              <span data-i18n-skip>
                {formatTime(
                  selectedClip.referenceTime ?? selectedClip.start,
                  true,
                )}
              </span>
            </p>
          )}
          <p>
            Click the four corners of the white playing rectangle, not the outer
            walls. Order is from the blue-goal end, looking towards the opposite
            goal: left, right, far right, far left.
          </p>
          <div
            className="reconstruction-calibration-key"
            aria-label="Corner order"
          >
            <span>4 ── opposite end ── 3</span>
            <span>1 ── blue-goal end ── 2</span>
            <small>White rectangle: 1.58 × 2.19 m · 2026 field</small>
          </div>
          <div className="reconstruction-actions">
            <Button
              variant="outline"
              disabled={!selectedClip || !ready || tracking || recording}
              onClick={useReferenceFrame}
            >
              Use this frame as reference
            </Button>
            <Button
              variant="outline"
              disabled={!selectedClip || !ready || tracking || recording}
              onClick={() => void resetCalibration()}
            >
              <ScanLine />
              Set field corners
            </Button>
            <Button
              variant="outline"
              disabled={
                !selectedClip ||
                !ready ||
                selectedClip.corners.length !== 4 ||
                tracking ||
                recording
              }
              onClick={() => {
                setEditMode('seed');
                void seekSource(
                  selectedClip!.referenceTime ?? selectedClip!.start,
                );
              }}
            >
              <Crosshair />
              Identify reference objects
            </Button>
          </div>
          {editMode === 'corners' && (
            <p className="reconstruction-instruction">
              Click corner{' '}
              {Math.min(4, (selectedClip?.corners.length ?? 0) + 1)}:{' '}
              {CORNERS[selectedClip?.corners.length ?? 0]}
            </p>
          )}
          {editMode === 'seed' && (
            <p className="reconstruction-instruction">
              Click the centre of {TRACK_LABELS[selected]} in the original
              reference frame. Choose the same visible point throughout.
              Identify only actors you can see.
            </p>
          )}
          <div className="reconstruction-actor-buttons">
            {ACTOR_IDS.map((id) => (
              <button
                key={id}
                className={selected === id ? 'selected' : ''}
                style={{ borderColor: COLORS[id] }}
                disabled={tracking || recording}
                onClick={() => setSelected(id)}
              >
                {TRACK_LABELS[id]} {selectedClip?.seeds[id] ? '✓' : ''}
              </button>
            ))}
          </div>
          {selectedClip && (
            <>
              <div className="reconstruction-form-row">
                <label>
                  Tracking interval
                  <NativeSelect
                    data-i18n-skip
                    value={selectedClip.fps}
                    disabled={tracking || recording}
                    onChange={(e) =>
                      updateClip((c) => ({ ...c, fps: Number(e.target.value) }))
                    }
                  >
                    {Array.from(new Set([2, 5, 10, 15, 20, selectedClip.fps]))
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <NativeSelectOption value={n} key={n}>
                          {Number.isInteger(1000 / n) ? '' : '≈'}
                          {Math.round(1000 / n)} ms · {n}/s
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </label>
                <label htmlFor="reconstruction-ball-diameter">
                  Source ball diameter
                  <NativeSelect
                    id="reconstruction-ball-diameter"
                    value={selectedClip.ballDiameter}
                    disabled={tracking || recording}
                    onChange={(e) =>
                      updateClip((c) => ({
                        ...c,
                        ballDiameter: e.target.value as '42' | '74',
                      }))
                    }
                  >
                    <NativeSelectOption value="42">
                      42 mm · new ball
                    </NativeSelectOption>
                    <NativeSelectOption value="74">
                      74 mm · old IR ball
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
              </div>
              <p>
                100 ms is recommended for fast robots. 500 ms is coarser; 50 ms
                captures more detail but takes longer. Changing the interval
                applies when you track the clip again.
              </p>
              <label htmlFor="reconstruction-attack-direction">
                Blue team attacks
                <NativeSelect
                  id="reconstruction-attack-direction"
                  value={
                    selectedClip.blueAttacksPositive ? 'positive' : 'negative'
                  }
                  disabled={tracking || recording}
                  onChange={(e) =>
                    updateClip((c) => ({
                      ...c,
                      blueAttacksPositive: e.target.value === 'positive',
                    }))
                  }
                >
                  <NativeSelectOption value="positive">
                    Towards the yellow goal
                  </NativeSelectOption>
                  <NativeSelectOption value="negative">
                    Towards the blue goal
                  </NativeSelectOption>
                </NativeSelect>
              </label>
              {selectedClip.seeds[selected] && (
                <details>
                  <summary>Tracking patch & side-view adjustment</summary>
                  <label>
                    Patch radius (% of picture width)
                    <input
                      type="number"
                      min="0.2"
                      max="15"
                      step="0.1"
                      disabled={tracking || recording}
                      value={Number(
                        (selectedClip.seeds[selected]!.radius * 100).toFixed(2),
                      )}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v >= 0.2 && v <= 15)
                          updateClip((c) => ({
                            ...c,
                            seeds: {
                              ...c.seeds,
                              [selected]: {
                                ...c.seeds[selected]!,
                                radius: v / 100,
                              },
                            },
                          }));
                      }}
                    />
                  </label>
                  <label>
                    Ground offset (% of picture height)
                    <input
                      type="number"
                      min="-15"
                      max="15"
                      step="0.1"
                      disabled={tracking || recording}
                      value={Number(
                        (
                          selectedClip.seeds[selected]!.groundOffset * 100
                        ).toFixed(2),
                      )}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v >= -15 && v <= 15)
                          updateClip((c) => ({
                            ...c,
                            seeds: {
                              ...c.seeds,
                              [selected]: {
                                ...c.seeds[selected]!,
                                groundOffset: v / 100,
                              },
                            },
                          }));
                      }}
                    />
                  </label>
                  <p>
                    Fit the ring to the robot body or ball, not its shadow or
                    protruding parts. A patch that is too large can drift onto
                    another robot. Changes apply when you track again.
                  </p>
                  <p>
                    For side views, a visible robot top sits above its floor
                    position. A positive offset moves the projected point
                    downward in the picture. This is approximate; strong
                    parallax, flying balls and moving cameras need correction.
                  </p>
                </details>
              )}
            </>
          )}
          <div className="reconstruction-actions">
            <Button
              disabled={
                !ready ||
                !selectedClip ||
                selectedClip.corners.length !== 4 ||
                !Object.keys(selectedClip.seeds).length ||
                tracking ||
                recording
              }
              onClick={() => void track(false)}
            >
              Track clip locally
            </Button>
            {tracking && (
              <Button variant="outline" onClick={stopWork}>
                Cancel tracking
              </Button>
            )}
          </div>
          {tracking && (
            <>
              <progress max="1" value={progress} />
              <output>
                Tracking frames… {Math.round(progress * 100)}% · Keep this tab
                open.
              </output>
              <p>
                {`Frames processed: ${trackingStats.frames} · Detected now: ${trackingStats.visible}/5 · Re-detections: ${trackingStats.recovered}`}
              </p>
              <p>
                Visibility counts are not an accuracy score. Review identities
                and hidden objects against the recording.
              </p>
            </>
          )}
          <p>
            Field-aware object detection searches every frame and re-detects
            missing objects automatically. You assign the team and robot number
            when identifying each reference object. Up to four robots and one
            ball are assigned without duplicating identities. Hidden or
            ambiguous objects remain gaps, not invented motion.
          </p>
        </section>
        <section className="reconstruction-panel reconstruction-tool">
          <h2>3 · Review & correct</h2>
          <p>
            Seek a difficult moment, choose an actor, and click its real
            position in the original video. Then continue tracking from that
            corrected frame.
          </p>
          <div className="reconstruction-actions">
            <Button
              variant={editMode === 'correct' ? 'default' : 'outline'}
              disabled={
                !ready ||
                !selectedClip ||
                selectedClip.corners.length !== 4 ||
                tracking ||
                recording
              }
              onClick={() => {
                pauseTransport();
                setEditMode(editMode === 'correct' ? 'none' : 'correct');
              }}
            >
              Correct position
            </Button>
            <Button
              variant="outline"
              disabled={!selectedClip || !location || tracking || recording}
              onClick={() => {
                if (
                  selectedClip &&
                  location &&
                  location.clip.id === selectedClip.id
                )
                  updateClip((c) =>
                    correctAt(c, location.time, selected, null),
                  );
              }}
            >
              Mark actor unseen
            </Button>
            <Button
              disabled={!ready || !selectedClip || tracking || recording}
              onClick={() => void track(true)}
            >
              Continue tracking here
            </Button>
          </div>
          {editMode === 'correct' && (
            <p className="reconstruction-instruction">
              Click {TRACK_LABELS[selected]} in the original frame to add a
              correction at {formatTime(sourceAt)}.
            </p>
          )}
          {selectedClip &&
            location?.clip.id === selectedClip.id &&
            samples[selected] && (
              <label>
                Robot heading (degrees)
                <input
                  type="number"
                  min="-360"
                  max="360"
                  step="5"
                  disabled={tracking || recording}
                  value={
                    Math.round((samples[selected]!.yaw * 180) / Math.PI) % 360
                  }
                  onChange={(e) => {
                    const yaw = (Number(e.target.value) * Math.PI) / 180;
                    if (Number.isFinite(yaw))
                      updateClip((c) =>
                        correctAt(c, location.time, selected, {
                          ...samples[selected]!,
                          yaw,
                          heading: 'manual',
                          origin: 'manual',
                        }),
                      );
                  }}
                />
              </label>
            )}
          <p>
            Headings are estimated from travel direction, not measured robot
            orientation. Unknown positions stay hidden. These recordings use the
            current simulator field and selected robot model, not a
            reconstruction of every physical detail.
          </p>
          <h3>Save or export</h3>
          <div className="reconstruction-actions">
            <Button
              variant="outline"
              disabled={!project || tracking || recording}
              onClick={save}
            >
              <Save />
              Save editable replay
            </Button>
            <NativeSelect
              aria-label="Export video resolution"
              value={exportHeight}
              disabled={recording}
              onChange={(e) => setExportHeight(Number(e.target.value))}
            >
              <NativeSelectOption value="720">1280 × 720</NativeSelectOption>
              <NativeSelectOption value="1080">1920 × 1080</NativeSelectOption>
            </NativeSelect>
            <Button
              disabled={
                !total ||
                !project?.clips.some((c) => c.frames.length) ||
                tracking ||
                recording
              }
              onClick={startExport}
            >
              <Download />
              Export 3D video
            </Button>
            {recording && (
              <Button variant="outline" onClick={() => stopExport(true)}>
                Stop export
              </Button>
            )}
          </div>
          {recording && (
            <output>
              Recording the whole replay at real-time speed. Keep this tab
              visible. {formatTime(at)} / {formatTime(total)}
            </output>
          )}
          {exportUrl && (
            <a
              className="reconstruction-download"
              href={exportUrl.url}
              download={exportUrl.name}
            >
              Download rendered video
            </a>
          )}
          <p>
            The replay file includes paths, calibration, clips and events, not
            the original video. It reopens here without an account. Video export
            includes the score and confirmed events, uses your chosen camera,
            and is silent.
          </p>
        </section>
      </div>
      <section className="reconstruction-panel reconstruction-events">
        <div className="reconstruction-panel-title">
          <h2>Score & event timeline</h2>
          <NativeSelect
            aria-label="Filter reconstruction events"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
          >
            <NativeSelectOption value="all">
              All active events
            </NativeSelectOption>
            <NativeSelectOption value="suggested">
              Needs review
            </NativeSelectOption>
            <NativeSelectOption value="confirmed">Confirmed</NativeSelectOption>
            <NativeSelectOption value="dismissed">Dismissed</NativeSelectOption>
          </NativeSelect>
        </div>
        <p>
          Automatic suggestions are approximate, not referee verdicts. They do
          not affect the score. Out of bounds requires wall contact or full
          penalty-area entry—not merely crossing the white line. Confirm goals
          only after checking earlier infringements. Damage, pushed out, pauses
          and official decisions need your review.
        </p>
        {project && (
          <div className="reconstruction-form-row">
            <label>
              Project title
              <input
                value={project.title}
                data-i18n-skip
                maxLength={150}
                disabled={recording || tracking}
                onChange={(e) =>
                  setProject({ ...project, title: e.target.value })
                }
              />
            </label>
            <label>
              Initial blue score
              <input
                type="number"
                min="0"
                max="999"
                value={project.initialScore.blue}
                disabled={recording || tracking}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (Number.isInteger(n) && n >= 0 && n <= 999)
                    setProject({
                      ...project,
                      initialScore: { ...project.initialScore, blue: n },
                    });
                }}
              />
            </label>
            <label>
              Initial yellow score
              <input
                type="number"
                min="0"
                max="999"
                value={project.initialScore.yellow}
                disabled={recording || tracking}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (Number.isInteger(n) && n >= 0 && n <= 999)
                    setProject({
                      ...project,
                      initialScore: { ...project.initialScore, yellow: n },
                    });
                }}
              />
            </label>
          </div>
        )}
        <div className="reconstruction-event-form">
          <label>
            Event
            <NativeSelect
              value={eventKind}
              disabled={recording || tracking}
              onChange={(e) =>
                setEventKind(e.target.value as ReconstructionEvent['kind'])
              }
            >
              {EVENT_KINDS.filter(
                (k) => !['tracking-gap', 'camera-cut'].includes(k),
              ).map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {EVENT_LABELS[k]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {eventKind === 'goal' && (
            <label htmlFor="reconstruction-scoring-team">
              Scoring team
              <NativeSelect
                id="reconstruction-scoring-team"
                value={eventTeam}
                onChange={(e) =>
                  setEventTeam(e.target.value as 'blue' | 'yellow')
                }
              >
                <NativeSelectOption value="blue">Blue</NativeSelectOption>
                <NativeSelectOption value="yellow">Yellow</NativeSelectOption>
              </NativeSelect>
            </label>
          )}
          {eventKind === 'score' &&
            (['blue', 'yellow'] as const).map((team) => (
              <label key={team}>
                {team === 'blue' ? 'Blue score' : 'Yellow score'}
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={eventScore[team]}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    if (Number.isInteger(n) && n >= 0 && n <= 999)
                      setEventScore({ ...eventScore, [team]: n });
                  }}
                />
              </label>
            ))}
          <label>
            Note
            <input
              data-i18n-skip
              maxLength={500}
              value={note}
              disabled={recording || tracking}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened in the recording?"
            />
          </label>
          <Button
            disabled={
              !location ||
              recording ||
              tracking ||
              (['out', 'damaged', 'pushed-out'].includes(eventKind) &&
                selected === 'ball')
            }
            onClick={addEvent}
          >
            Add at {formatTime(at)}
          </Button>
        </div>
        <div className="reconstruction-event-list">
          {visibleEvents.length === 0 ? (
            <p>
              No events yet. Add confirmed calls, or review suggestions after
              tracking.
            </p>
          ) : (
            visibleEvents.slice(0, 400).map((e) => (
              <article key={e.id}>
                <button
                  className="reconstruction-event-time"
                  disabled={tracking || recording}
                  onClick={() => {
                    seekReplay(
                      timelineTime(project!, e.clipId, e.time),
                      e.clipId,
                    );
                  }}
                >
                  {formatTime(timelineTime(project!, e.clipId, e.time))}
                  <small>Source {formatTime(e.time)}</small>
                </button>
                <div>
                  <strong>
                    {EVENT_LABELS[e.kind]}
                    {e.actor ? ` · ${TRACK_LABELS[e.actor]}` : ''}
                    {e.team
                      ? ` · ${e.team === 'blue' ? 'Blue' : 'Yellow'}`
                      : ''}
                  </strong>
                  <span className={`reconstruction-event-status ${e.status}`}>
                    {e.status === 'suggested'
                      ? 'Needs review'
                      : e.status === 'confirmed'
                        ? 'Confirmed'
                        : 'Dismissed'}
                  </span>
                  <p data-i18n-skip>{e.note}</p>
                </div>
                <div className="reconstruction-actions">
                  {e.status !== 'confirmed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={recording || tracking}
                      onClick={() =>
                        setProject((p) =>
                          p
                            ? {
                                ...p,
                                events: p.events.map((x) =>
                                  x.id === e.id
                                    ? { ...x, status: 'confirmed' }
                                    : x,
                                ),
                              }
                            : p,
                        )
                      }
                    >
                      Confirm
                    </Button>
                  )}
                  {e.status !== 'dismissed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={recording || tracking}
                      onClick={() =>
                        setProject((p) =>
                          p
                            ? {
                                ...p,
                                events: p.events.map((x) =>
                                  x.id === e.id
                                    ? { ...x, status: 'dismissed' }
                                    : x,
                                ),
                              }
                            : p,
                        )
                      }
                    >
                      Dismiss
                    </Button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
        {visibleEvents.length > 400 && (
          <p>
            Showing the first 400 events. Use the filter to narrow the list;
            every event is preserved in the replay file.
          </p>
        )}
      </section>
    </section>
  );
}
