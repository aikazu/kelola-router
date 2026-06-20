import { extractUsageFromSSEStream, type SSEUsage } from './extractUsage.js';
import { TailBuffer } from './tailBuffer.js';

export type UsageCallback = (usage: SSEUsage | null, rawText: string) => void;

const TAIL_BYTES = 32 * 1024;

/**
 * Tee an upstream SSE response: forward every byte to the client unchanged,
 * and after the stream completes invoke `onUsage` with the final usage block.
 *
 * If `signal` is provided and aborts, the TransformStream terminates early so
 * no more bytes are enqueued to the client. The upstream's `upstream.body`
 * pipe is then closed, which lets the upstream fetch see backpressure.
 */
export async function pipeWithUsage(
  upstream: Response,
  format: 'openai' | 'anthropic',
  onUsage: UsageCallback,
  signal?: AbortSignal
): Promise<Response> {
  if (!upstream.body) {
    onUsage(null, '');
    return upstream;
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let usage: SSEUsage | null = null;
  const tail = new TailBuffer(TAIL_BYTES);
  let aborted = false;
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    onUsage(usage, tail.snapshot());
  };
  if (signal) {
    if (signal.aborted) {
      aborted = true;
    } else
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
        },
        { once: true }
      );
  }
  const tee = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      const text = decoder.decode(chunk, { stream: true });
      usage = extractUsageFromSSEStream(tail, text, format, usage);
      if (aborted) {
        // Client disconnected (or will disconnect) mid-stream: still record
        // the usage we just parsed so the handler can write the request log
        // row with partial token counts instead of dropping it. The readable
        // side is terminated so no more bytes are enqueued to the client;
        // `flush()` won't run on a terminated writable, so we fire here.
        fire();
        ctrl.terminate();
        return;
      }
      ctrl.enqueue(chunk);
    },
    flush() {
      const tailText = decoder.decode();
      if (!aborted) {
        usage = extractUsageFromSSEStream(tail, tailText, format, usage);
      }
      // On natural completion surface whatever usage was accumulated. On
      // abort this is best-effort: the transform above normally fires first
      // and sets `done`; the guard inside `fire` makes this a no-op.
      fire();
    },
  });
  return new Response(upstream.body.pipeThrough(tee), {
    status: upstream.status,
    headers: upstream.headers,
  });
}
