/** Local browser media utilities. Never reads a complete multi-gigabyte recording into memory. */
export async function seekVideo(
  video: HTMLVideoElement,
  at: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    !Number.isFinite(at)
  )
    throw new Error('Wait for the recording metadata before seeking.');
  const target = Math.max(0, Math.min(at, Math.max(0, video.duration - 0.002)));
  if (
    !video.seeking &&
    Math.abs(video.currentTime - target) < 0.001 &&
    video.readyState >= 2
  )
    return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('canplay', done);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const done = () => {
      // A superseded seek can still dispatch its completion event. Only return
      // decoded pixels for this request, never an old frame at another time.
      if (
        video.seeking ||
        video.readyState < 2 ||
        Math.abs(video.currentTime - target) > 0.01
      )
        return;
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(
        new Error(
          'The browser could not decode this recording. Try an H.264 MP4 copy.',
        ),
      );
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Video seeking timed out. Try a shorter MP4 clip.'));
    }, 15000);
    video.addEventListener('seeked', done);
    video.addEventListener('loadeddata', done);
    video.addEventListener('canplay', done);
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      video.currentTime = target;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function readVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
) {
  const width = Math.min(960, video.videoWidth);
  const height = Math.round((video.videoHeight * width) / video.videoWidth);
  if (!width || !height) throw new Error('Wait for the video to load.');
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas processing is unavailable.');
  context.drawImage(video, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function exportMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return (
    ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'].find(
      (mime) => MediaRecorder.isTypeSupported(mime),
    ) ?? null
  );
}
