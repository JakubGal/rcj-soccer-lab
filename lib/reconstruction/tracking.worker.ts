import { LocalTracker, type Pixels } from './tracking';
import type { Clip } from './project';
let tracker: LocalTracker | null = null;
self.onmessage = (
  event: MessageEvent<{
    type: 'init' | 'step' | 'resume';
    clip?: Clip;
    seeds?: Clip['seeds'];
    corners?: Clip['corners'];
    image: Pixels;
    time: number;
  }>,
) => {
  try {
    const { type, clip, image, time } = event.data;
    if (type === 'init' && clip) {
      tracker = new LocalTracker(clip, image, time);
      self.postMessage({
        frame: tracker.initial(image, time),
        cut: false,
        lost: [],
      });
    } else if (
      type === 'resume' &&
      tracker &&
      event.data.seeds &&
      event.data.corners
    ) {
      self.postMessage({
        frame: tracker.resume(
          image,
          time,
          event.data.seeds,
          event.data.corners,
        ),
        cut: false,
        lost: [],
      });
    } else if (tracker) self.postMessage(tracker.step(image, time));
    else throw new Error('Tracker has not been initialized.');
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Tracking failed.',
    });
  }
};
