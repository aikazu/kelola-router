# 0002. Kiro uses AWS event-stream binary framing

Date: 2026-06-12

## Status

Accepted.

## Context

Kiro's wire protocol is the AWS event-stream binary framing format: 12-byte prelude + headers + JSON payload, sent as a stream of frames over HTTP. This is what every AWS SDK uses for streaming APIs (S3 Select, Kinesis, Transcribe, etc.).

Two approaches were considered:

1. **Use the binary framing as-is**: decode frames on the fly, re-emit as OpenAI or Anthropic SSE, and never materialize the full response in memory.
2. **Wrap/unwrap JSON at every step**: convert the binary to a JSON envelope on send, parse back to binary on receive, so the rest of the router only sees JSON.

The pressure: option 2 is conceptually simpler (everything is JSON) but adds latency + a serialization layer that doesn't help. Option 1 is the natural fit: the upstream speaks a streaming binary protocol, the router streams a transformed response downstream.

## Decision

Use option 1. The frame decoder is `src/providers/kiro/eventstream.ts:decodeFrames(rawStream)`. It reads bytes from a `ReadableStream<Uint8Array>` and yields `{headers, payload}` pairs. The assembler (`src/providers/kiro/assembler.ts`) re-emits each frame as one or more OpenAI SSE chunks. For Anthropic clients, `src/providers/kiro/anthropicSse.ts` re-emits the same frames as native Messages SSE.

The whole pipeline is byte-level: no buffering of the full response, no JSON-of-JSON wrapping. The cost is that the frame decoder must be careful about chunk boundaries (`Uint8Array` concatenation) and partial frames (a frame may span multiple TCP packets).

## Consequences

### Positive

- **Lowest possible latency.** The first event from upstream can be sent to the client without waiting for any frame to be fully buffered.
- **Smallest memory footprint.** The router never holds the full response. It just shuffles bytes through the frame decoder.
- **No lossy conversion.** Each event type is mapped 1:1 to an OpenAI/Anthropic event. The Anthropic SSE re-emission is wire-identical to what a real Anthropic client would receive.

### Negative

- **The frame decoder is subtle.** Chunk-boundary bugs are easy to introduce. Tests in `eventstream.test.ts` cover the boundary cases.
- **Two response-assembly paths** (OpenAI + Anthropic) must stay in sync. If AWS adds a new event type, both need to be updated.
- **Debugging is harder.** `console.log` of the raw stream is unreadable; the assembler logs structured events instead.

### Neutral

- The protocol byte format is well-documented by AWS. We don't need to reverse-engineer it; we reverse-engineered only the *higher-level* event types and persona headers. See `docs/notes/kiro-cli-reverse-engineering.md`.

## Alternatives considered

### JSON envelope wrap/unwrap

Convert the AWS event-stream to a JSON-of-frames on the way in, parse it back to bytes on the way out, and have the rest of the router operate on JSON.

Rejected because: adds 2 full-pipeline serializations per request, increases memory (the JSON envelope is larger than the binary), and makes the per-event latency worse (each frame must be fully received before it can be wrapped).

### Buffer the whole response, then re-emit

Read the entire upstream response into a buffer, parse the frames, then send the re-emitted SSE in one go.

Rejected because: defeats the purpose of streaming. The first token would arrive ~TTFB-of-upstream + (full-response-time), which is much slower than what users expect from a streaming API.

### Re-implement as a JSON HTTP API

Add a translation layer (a sidecar) that converts AWS event-stream to JSON-over-HTTP, and have the router talk to the sidecar.

Rejected because: same downsides as the JSON envelope approach, plus a deployment surface for a single feature.

## References

- `src/providers/kiro/eventstream.ts`: frame decoder
- `src/providers/kiro/assembler.ts`: OpenAI SSE re-emission
- `src/providers/kiro/anthropicSse.ts`: Anthropic Messages SSE re-emission
- `docs/notes/kiro-cli-reverse-engineering.md`: event type + persona capture
- `docs/guides/debug-a-failed-request.md`: debug ladder for Kiro failures
- `docs/architecture/.claude/docs/kiro-protocol.md`: wire-format digest (see Phase 5)
