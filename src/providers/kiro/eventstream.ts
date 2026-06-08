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
    const headersLength = view.getUint32(4, false);

    const headers: Record<string, string> = {};
    let offset = 12; // after 8-byte prelude + 4-byte prelude CRC
    const headerEnd = 12 + headersLength;
    const decoder = new TextDecoder();

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset]!;
      offset++;
      if (offset + nameLen > data.length) break;
      const name = decoder.decode(data.slice(offset, offset + nameLen));
      offset += nameLen;
      const headerType = data[offset]!;
      offset++;
      if (headerType === 7) {
        const valueLen = (data[offset]! << 8) | data[offset + 1]!;
        offset += 2;
        if (offset + valueLen > data.length) break;
        headers[name] = decoder.decode(data.slice(offset, offset + valueLen));
        offset += valueLen;
      } else {
        break;
      }
    }

    const payloadStart = 12 + headersLength;
    const payloadEnd = data.length - 4; // exclude message CRC
    let payload: Record<string, unknown> | null = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = decoder.decode(data.slice(payloadStart, payloadEnd));
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
 */
export function decodeFrames(buffer: Uint8Array): DecodeResult {
  const events: KiroEvent[] = [];
  let buf = buffer;
  let guard = 0;
  const maxIterations = 100000;

  while (buf.length >= 16 && guard < maxIterations) {
    guard++;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const totalLength = view.getUint32(0, false);
    if (totalLength < 16 || totalLength > buf.length) break;

    const frame = buf.slice(0, totalLength);
    buf = buf.slice(totalLength);
    const event = parseFrame(frame);
    if (event) events.push(event);
  }

  return { events, rest: buf };
}
