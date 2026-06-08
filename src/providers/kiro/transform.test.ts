import { describe, expect, it } from 'vitest';
import { buildKiroPayload } from './transform.js';

const creds = { accessToken: 'x', providerData: null };

describe('buildKiroPayload', () => {
  it('builds a conversationState with the last user message as currentMessage', () => {
    const { payload, upstreamModel } = buildKiroPayload(
      'claude-sonnet-4-5',
      { messages: [{ role: 'user', content: 'hello' }] },
      creds
    );
    expect(upstreamModel).toBe('claude-sonnet-4-5');
    const cm = payload.conversationState.currentMessage.userInputMessage;
    expect(cm.modelId).toBe('claude-sonnet-4-5');
    expect(cm.origin).toBe('AI_EDITOR');
    expect(cm.content).toContain('hello');
    expect(payload.conversationState.chatTriggerType).toBe('MANUAL');
  });

  it('moves prior turns into history', () => {
    const { payload } = buildKiroPayload(
      'claude-sonnet-4-5',
      {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'second' },
        ],
      },
      creds
    );
    expect(payload.conversationState.history).toHaveLength(2);
    expect(payload.conversationState.currentMessage.userInputMessage.content).toContain('second');
  });

  it('folds the system message into the user turn', () => {
    const { payload } = buildKiroPayload(
      'claude-sonnet-4-5',
      {
        messages: [
          { role: 'system', content: 'be terse' },
          { role: 'user', content: 'hi' },
        ],
      },
      creds
    );
    const content = payload.conversationState.currentMessage.userInputMessage.content;
    expect(content).toContain('be terse');
    expect(content).toContain('hi');
  });

  it('maps client tools to toolSpecification on the current message', () => {
    const { payload } = buildKiroPayload(
      'claude-sonnet-4-5',
      {
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [
          {
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: { type: 'object', properties: { city: { type: 'string' } } },
            },
          },
        ],
      },
      creds
    );
    const ctx = payload.conversationState.currentMessage.userInputMessage.userInputMessageContext;
    expect(ctx?.tools?.[0]?.toolSpecification.name).toBe('get_weather');
    expect(ctx?.tools?.[0]?.toolSpecification.inputSchema.json).toMatchObject({ type: 'object' });
  });

  it('injects the thinking-mode prefix for a -thinking model', () => {
    const { payload, upstreamModel } = buildKiroPayload(
      'claude-sonnet-4-5-thinking',
      { messages: [{ role: 'user', content: 'hi' }] },
      creds
    );
    expect(upstreamModel).toBe('claude-sonnet-4-5');
    expect(payload.conversationState.currentMessage.userInputMessage.content).toContain(
      '<thinking_mode>enabled</thinking_mode>'
    );
  });

  it('sets profileArn when present in providerData', () => {
    const { payload } = buildKiroPayload(
      'claude-sonnet-4-5',
      { messages: [{ role: 'user', content: 'hi' }] },
      {
        accessToken: 'x',
        providerData: { profileArn: 'arn:aws:codewhisperer:us-east-1:1:profile/A' },
      }
    );
    expect(payload.profileArn).toBe('arn:aws:codewhisperer:us-east-1:1:profile/A');
  });

  describe('persona', () => {
    it('defaults to the IDE persona (AI_EDITOR origin, MANUAL trigger, no envState)', () => {
      const { payload } = buildKiroPayload(
        'claude-sonnet-4-5',
        { messages: [{ role: 'user', content: 'hi' }] },
        creds
      );
      const cm = payload.conversationState.currentMessage.userInputMessage;
      expect(cm.origin).toBe('AI_EDITOR');
      expect(payload.conversationState.chatTriggerType).toBe('MANUAL');
      expect(cm.userInputMessageContext?.envState).toBeUndefined();
    });

    it('CLI persona uses KIRO_CLI origin, keeps MANUAL trigger, adds agent fields + envState, no inferenceConfig', () => {
      const { payload } = buildKiroPayload(
        'claude-sonnet-4-5',
        { messages: [{ role: 'user', content: 'hi' }] },
        { ...creds, persona: 'cli' }
      );
      const cm = payload.conversationState.currentMessage.userInputMessage;
      expect(cm.origin).toBe('KIRO_CLI');
      expect(payload.conversationState.chatTriggerType).toBe('MANUAL');
      expect(payload.conversationState.agentContinuationId).toBeDefined();
      expect(payload.conversationState.agentTaskType).toBe('vibe');
      expect(payload.inferenceConfig).toBeUndefined();
      expect(cm.userInputMessageContext?.envState?.operatingSystem).toBeDefined();
      expect(cm.userInputMessageContext?.envState?.currentWorkingDirectory).toBeDefined();
    });

    it('CLI persona sets origin + envState on history user turns too', () => {
      const { payload } = buildKiroPayload(
        'claude-sonnet-4-5',
        {
          messages: [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'reply' },
            { role: 'user', content: 'second' },
          ],
        },
        { ...creds, persona: 'cli' }
      );
      const firstUser = payload.conversationState.history.find((h) => h.userInputMessage);
      expect(firstUser?.userInputMessage?.origin).toBe('KIRO_CLI');
      expect(firstUser?.userInputMessage?.userInputMessageContext?.envState).toBeDefined();
    });
  });
});
