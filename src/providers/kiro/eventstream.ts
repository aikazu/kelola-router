/**
 * AWS event-stream (vnd.amazon.eventstream) binary frame decoder.
 *
 * Adapted from the 9router reference (MIT). Each frame:
 *
 *   [ totalLen u32 BE ][ headersLen u32 BE ][ prelude CRC u32 ]
 *   [ headers (headersLen bytes) ][ payload (JSON) ][ message CRC u32 ]
 *
 * Header entry: [ nameLen u8 ][ name ][ type u8 ][ value... ]. We only decode
 * string headers (type 7: [ valueLen u16 BE ][ value ]); other types stop
 * header parsing (the headers we care about — `:event-type` — are strings).
 */

// One decoder for the whole module — no per-frame allocation.
const SHARED_DECODER = new TextDecoder('utf-8', { fatal: false });

export interface KiroEvent {
  eventType: string;
  headers: Record<string, string>;
  payload: Record<string, unknown> | null;
}

export interface DecodeResult {
  events: KiroEvent[];
  /** Bytes not yet forming a complete frame; feed back in on the next chunk. */
  rest: Uint8Array;
}

function parseFrame(data: Uint8Array): KiroEvent | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);

    const headers: Record<string, string> = {};
    let offset = 12; // after 8-byte prelude + 4-byte prelude CRC
    const headerEnd = 12 + headersLength;

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset]!;
      offset++;
      if (offset + nameLen > data.length) break;
      const name = SHARED_DECODER.decode(data.subarray(offset, offset + nameLen));
      offset += nameLen;
      const headerType = data[offset]!;
      offset++;
      if (headerType === 7) {
        const valueLen = (data[offset]! << 8) | data[offset + 1]!;
        offset += 2;
        if (offset + valueLen > data.length) break;
        headers[name] = SHARED_DECODER.decode(data.subarray(offset, offset + valueLen));
        offset += valueLen;
      } else {
        break;
      }
    }

    const payloadStart = 12 + headersLength;
    const payloadEnd = totalLength - 4; // exclude message CRC
    let payload: Record<string, unknown> | null = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = SHARED_DECODER.decode(data.subarray(payloadStart, payloadEnd));
      if (payloadStr && payloadStr.trim()) {
        try {
          payload = JSON.parse(payloadStr) as Record<string, unknown>;
        } catch {
          payload = { raw: payloadStr };
        }
      }
    }

    return { eventType: headers[':event-type'] || '', headers, payload };
  } catch {
    return null;
  }
}

/**
 * Decode as many complete frames as `buffer` contains. Returns the decoded
 * events and any trailing partial bytes (`rest`) to prepend to the next chunk.
 *
 * The same `DataView` is reused across all frames in a single call (cheap).
 * `rest` is a zero-copy subarray view — no per-frame copy chain.
 */
export function decodeFrames(buffer: Uint8Array): DecodeResult {
  const events: KiroEvent[] = [];
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  let guard = 0;
  const maxIterations = 100000;
  const len = buffer.length;

  while (offset + 16 <= len && guard < maxIterations) {
    guard++;
    const totalLength = view.getUint32(offset, false);
    if (totalLength < 16 || offset + totalLength > len) break;
    const frame = buffer.subarray(offset, offset + totalLength);
    const event = parseFrame(frame);
    if (event) events.push(event);
    offset += totalLength;
  }

  return { events, rest: buffer.subarray(offset) };
}
