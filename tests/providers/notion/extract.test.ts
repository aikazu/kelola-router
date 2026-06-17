import { describe, expect, it } from 'vitest';
import { extractNotionStream } from '../../../src/providers/notion/extract';

function makeStream(lines: string[]): Response {
  const body = lines.join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

describe('extractNotionStream', () => {
  it('emits done delta after done line', async () => {
    const res = makeStream([
      JSON.stringify({ type: 'patch-start', data: { s: [] }, version: 1 }),
      JSON.stringify({ type: 'done' }),
    ]);
    const deltas: Array<{ delta: string; done: boolean }> = [];
    for await (const d of extractNotionStream(res)) {
      deltas.push(d);
    }
    expect(deltas.some((d) => d.done)).toBe(true);
  });

  it('emits text delta when content is patched', async () => {
    const res = makeStream([
      JSON.stringify({ type: 'patch-start', data: { s: [] }, version: 1 }),
      JSON.stringify({
        type: 'patch',
        v: [
          {
            o: 'a',
            p: '/s/-',
            v: {
              id: 'inf-1',
              type: 'agent-inference',
              value: [{ type: 'text', content: '' }],
              traceId: 't1',
            },
          },
        ],
      }),
      JSON.stringify({
        type: 'patch',
        v: [{ o: 'x', p: '/s/0/value/0/content', v: 'Hello' }],
      }),
      JSON.stringify({
        type: 'patch',
        v: [{ o: 'x', p: '/s/0/value/0/content', v: 'Hello world' }],
      }),
      JSON.stringify({ type: 'done' }),
    ]);
    const deltas: Array<{ delta: string; done: boolean }> = [];
    for await (const d of extractNotionStream(res)) {
      deltas.push(d);
    }
    // First text delta: 'Hello' (full new content)
    const textDeltas = deltas.filter((d) => !d.done).map((d) => d.delta);
    expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    expect(textDeltas.join('')).toBe('Hello world');
  });

  it('emits toolCall delta for agent-tool-result', async () => {
    const res = makeStream([
      JSON.stringify({ type: 'patch-start', data: { s: [] }, version: 1 }),
      JSON.stringify({
        type: 'patch',
        v: [
          {
            o: 'a',
            p: '/s/-',
            v: {
              id: 'tool-1',
              type: 'agent-tool-result',
              toolName: 'callFunction',
              toolType: 'callFunction',
              traceId: 't1',
              startedAt: 1,
              input: { function: 'connections.fs.readFiles', args: { files: ['a.md'] } },
              state: 'applied',
              result: { output: 'ok' },
            },
          },
        ],
      }),
      JSON.stringify({ type: 'done' }),
    ]);
    const deltas: Array<{ toolCall?: unknown; done: boolean }> = [];
    for await (const d of extractNotionStream(res)) {
      deltas.push(d);
    }
    const toolDelta = deltas.find((d) => d.toolCall);
    expect(toolDelta).toBeDefined();
    expect(toolDelta?.toolCall).toMatchObject({
      name: 'connections.fs.readFiles',
    });
  });

  it('handles empty stream gracefully', async () => {
    const res = makeStream([]);
    const deltas: Array<{ done: boolean }> = [];
    for await (const d of extractNotionStream(res)) {
      deltas.push(d);
    }
    expect(deltas).toEqual([]);
  });

  it('skips malformed JSON lines without throwing', async () => {
    const res = makeStream([
      'not json',
      JSON.stringify({ type: 'patch-start', data: { s: [] }, version: 1 }),
      JSON.stringify({ type: 'done' }),
    ]);
    const deltas: Array<{ done: boolean }> = [];
    for await (const d of extractNotionStream(res)) {
      deltas.push(d);
    }
    expect(deltas.some((d) => d.done)).toBe(true);
  });
});
