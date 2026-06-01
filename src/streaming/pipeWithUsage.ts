import { extractUsageFromSSE, type SSEUsage } from "./extractUsage.js";

export type UsageCallback = (usage: SSEUsage | null) => void;

/**
 * Tee an upstream SSE response: forward every byte to the client unchanged,
 * and after the stream completes invoke `onUsage` with the final usage block.
 */
export async function pipeWithUsage(
  upstream: Response,
  format: "openai" | "anthropic",
  onUsage: UsageCallback,
): Promise<Response> {
  if (!upstream.body) {
    onUsage(null);
    return upstream;
  }
  const decoder = new TextDecoder();
  let raw = "";
  const tee = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      raw += decoder.decode(chunk, { stream: true });
      ctrl.enqueue(chunk);
    },
    flush() {
      raw += decoder.decode();
      onUsage(extractUsageFromSSE(raw, format).usage);
    },
  });
  return new Response(upstream.body.pipeThrough(tee), {
    status: upstream.status,
    headers: upstream.headers,
  });
}
