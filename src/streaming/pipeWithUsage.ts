import { extractUsageFromSSE, type SSEUsage } from './extractUsage.js';

export type UsageCallback = (usage: SSEUsage | null, rawText: string) => void;

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
  const decoder = new TextDecoder();
  let raw = '';
  let aborted = false;
  if (signal) {
    if (signal.aborted) aborted = true;
    else
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
      if (aborted) {
        ctrl.terminate();
        return;
      }
      raw += decoder.decode(chunk, { stream: true });
      ctrl.enqueue(chunk);
    },
    flush() {
      if (aborted) return;
      raw += decoder.decode();
      const { usage } = extractUsageFromSSE(raw, format);
      onUsage(usage, raw);
    },
  });
  return new Response(upstream.body.pipeThrough(tee), {
    status: upstream.status,
    headers: upstream.headers,
  });
}
