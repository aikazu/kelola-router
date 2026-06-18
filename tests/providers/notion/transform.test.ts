import { describe, expect, it } from 'vitest';
import { buildNotionPayload } from '../../../src/providers/notion/transform';

describe('buildNotionPayload', () => {
  it('produces JSON with required top-level keys', () => {
    const { body } = buildNotionPayload({
      openaiMessages: [{ role: 'user', content: 'hi' }],
      internalModelId: 'oatmeal-cookie',
      spaceId: 'ws-1',
    });
    const obj = JSON.parse(body);
    expect(obj.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(obj.spaceId).toBe('ws-1');
    expect(Array.isArray(obj.transcript)).toBe(true);
    expect(obj.patches).toEqual([]);
  });

  it('transcript contains config + agent-instruction-state + agent-turn-full-record-map + agent-inference', () => {
    const { body } = buildNotionPayload({
      openaiMessages: [{ role: 'user', content: 'hi' }],
      internalModelId: 'oatmeal-cookie',
      spaceId: 'ws-1',
    });
    const obj = JSON.parse(body);
    const types = obj.transcript.map((r: { type: string }) => r.type);
    expect(types).toEqual([
      'config',
      'agent-instruction-state',
      'agent-turn-full-record-map',
      'agent-inference',
    ]);
  });

  it('config record contains the requested model', () => {
    const { body } = buildNotionPayload({
      openaiMessages: [{ role: 'user', content: 'hi' }],
      internalModelId: 'opal-quince-medium',
      spaceId: 'ws-1',
    });
    const obj = JSON.parse(body);
    const config = obj.transcript.find((r: { type: string }) => r.type === 'config');
    expect(config.value.model).toBe('opal-quince-medium');
    expect(config.value.modelFromUser).toBe(true);
  });

  it('agent-inference record wraps user message text', () => {
    const { body } = buildNotionPayload({
      openaiMessages: [{ role: 'user', content: 'hello world' }],
      internalModelId: 'oatmeal-cookie',
      spaceId: 'ws-1',
    });
    const obj = JSON.parse(body);
    const inf = obj.transcript.find((r: { type: string }) => r.type === 'agent-inference');
    expect(inf.value).toEqual([{ type: 'text', content: 'hello world' }]);
    expect(inf.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof inf.startedAt).toBe('number');
  });

  it('multi-message: each message produces one agent-inference record', () => {
    const { body } = buildNotionPayload({
      openaiMessages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      internalModelId: 'oatmeal-cookie',
      spaceId: 'ws-1',
    });
    const obj = JSON.parse(body);
    const inferences = obj.transcript.filter((r: { type: string }) => r.type === 'agent-inference');
    expect(inferences).toHaveLength(2);
    expect(inferences[0].value[0].content).toBe('be terse');
    expect(inferences[1].value[0].content).toBe('hi');
  });

  it('attachment record created when attachment provided', () => {
    const { body } = buildNotionPayload({
      openaiMessages: [{ role: 'user', content: 'describe this image' }],
      internalModelId: 'oatmeal-cookie',
      spaceId: 'ws-1',
      attachments: [
        {
          fileUrl: 'attachment:owner-uuid:file-uuid.png',
          fileName: 'test.png',
          contentType: 'image/png',
          width: 100,
          height: 200,
          fileSizeBytes: 5000,
        },
      ],
    });
    const obj = JSON.parse(body);
    const types = obj.transcript.map((r: { type: string }) => r.type);
    expect(types).toContain('attachment');
    const attachment = obj.transcript.find((r: { type: string }) => r.type === 'attachment');
    expect(attachment.fileUrl).toBe('attachment:owner-uuid:file-uuid.png');
    expect(attachment.contentType).toBe('image/png');
    expect(attachment.metadata.width).toBe(100);
    expect(attachment.metadata.height).toBe(200);
  });
});
