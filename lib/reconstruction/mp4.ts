/** Optional MP4 compatibility check. Only headers and a bounded moov box are read;
 * media payloads stay in the local File. This does not alter or repair a recording.
 */
type Box = { type: string; payload: number; end: number };
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_BOXES = 4096;

function boxAt(view: DataView, at: number, end: number): Box | null {
  if (at + 8 > end) return null;
  const type = String.fromCharCode(
    ...new Uint8Array(view.buffer, view.byteOffset + at + 4, 4),
  );
  let size = view.getUint32(at),
    header = 8;
  if (size === 1) {
    if (at + 16 > end) return null;
    size = Number(view.getBigUint64(at + 8));
    header = 16;
  } else if (size === 0) size = end - at;
  if (!Number.isSafeInteger(size) || size < header || at + size > end)
    return null;
  return { type, payload: at + header, end: at + size };
}

function children(view: DataView, parent: Box): Box[] {
  const result: Box[] = [];
  let at = parent.payload;
  while (at < parent.end && result.length < MAX_BOXES) {
    const box = boxAt(view, at, parent.end);
    if (!box) return [];
    result.push(box);
    at = box.end;
  }
  return at === parent.end ? result : [];
}

/** Returns a warning only for a concrete malformed timing-table signature.
 * Unsupported, fragmented or oversized containers are left to the browser.
 */
export async function inspectMp4Timing(
  file: Blob,
): Promise<{ invalidSamples: number } | null> {
  try {
    let at = 0;
    for (let index = 0; index < MAX_BOXES && at + 8 <= file.size; index++) {
      const header = new DataView(await file.slice(at, at + 16).arrayBuffer());
      const type = String.fromCharCode(...new Uint8Array(header.buffer, 4, 4));
      let size = header.getUint32(0);
      if (size === 1) {
        if (header.byteLength < 16) return null;
        size = Number(header.getBigUint64(8));
      } else if (!size) size = file.size - at;
      if (!Number.isSafeInteger(size) || size < 8 || at + size > file.size)
        return null;
      if (type !== 'moov') {
        at += size;
        continue;
      }
      if (size > MAX_METADATA_BYTES) return null;
      const view = new DataView(await file.slice(at, at + size).arrayBuffer());
      const moov = boxAt(view, 0, size);
      if (!moov) return null;
      const find = (parent: Box, type: string) =>
        children(view, parent).find((box) => box.type === type);
      let invalidSamples = 0;
      for (const track of children(view, moov).filter(
        (b) => b.type === 'trak',
      )) {
        const media = find(track, 'mdia');
        if (!media) continue;
        const handler = find(media, 'hdlr'),
          clock = find(media, 'mdhd');
        if (!handler || !clock || handler.end - handler.payload < 12) continue;
        if (view.getUint32(handler.payload + 8) !== 0x76696465) continue; // vide
        const version = view.getUint8(clock.payload);
        if (version > 1 || clock.end - clock.payload < (version ? 32 : 20))
          continue;
        const timescale = view.getUint32(clock.payload + (version ? 20 : 12));
        const declared = version
          ? Number(view.getBigUint64(clock.payload + 24))
          : view.getUint32(clock.payload + 16);
        if (!timescale || !declared || !Number.isSafeInteger(declared))
          continue;
        const info = find(media, 'minf'),
          table = info && find(info, 'stbl');
        const timing = table && find(table, 'stts');
        if (!timing || timing.end - timing.payload < 8) continue;
        const count = view.getUint32(timing.payload + 4);
        if (count > (timing.end - timing.payload - 8) / 8) continue;
        let sum = 0,
          bad = 0;
        for (let i = 0; i < count; i++) {
          const offset = timing.payload + 8 + i * 8;
          const samples = view.getUint32(offset),
            delta = view.getUint32(offset + 4);
          sum += samples * delta;
          if (delta >= 0x80000000 && delta > declared) bad += samples;
        }
        // stts deltas are unsigned. Some broken muxers put negative differences
        // here, yielding multi-year sample delays despite a minutes-long mdhd.
        if (bad && sum > declared + Math.max(timescale * 2, declared * 0.1))
          invalidSamples += bad;
      }
      return invalidSamples ? { invalidSamples } : null;
    }
  } catch {
    // A best-effort compatibility hint must never prevent opening local media.
  }
  return null;
}
