/**
 * OpenAI Chat Completions -> Kiro / AWS CodeWhisperer request transform.
 *
 * Adapted from the 9router reference (MIT). Produces the `conversationState`
 * payload that `generateAssistantResponse` expects:
 *
 *   - system/tool messages collapse into user turns
 *   - consecutive same-role turns merge
 *   - client tools map to `toolSpecification` entries on the current message
 *   - when the client sent NO tools, any tool calls/results in history are
 *     flattened to plain text (avoids Kiro's "tools required" 400)
 *   - `-thinking` injects a `<thinking_mode>enabled</thinking_mode>` prefix
 *   - `-agentic` injects the chunked-write system prompt
 */
import { randomUUID } from 'node:crypto';
import {
  buildThinkingSystemPrefix,
  isThinkingEnabled,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  resolveKiroModel,
} from './constants.js';

// --- Loose OpenAI input shapes (clients vary; keep tolerant) ---
type ContentPart = {
  type?: string;
  text?: string;
  image_url?: { url?: string };
  source?: { type?: string; media_type?: string; data?: string };
  content?: unknown;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
};
export interface OpenAIMessage {
  role: string;
  content?: string | ContentPart[];
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
}
export interface OpenAITool {
  function?: { name?: string; description?: string; parameters?: Record<string, unknown> };
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
}
export interface OpenAIChatBody {
  model?: string;
  messages?: OpenAIMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  top_p?: number;
}

// --- Kiro payload shapes ---
interface KiroImage {
  format: string;
  source: { bytes: string };
}
interface KiroToolResult {
  toolUseId?: string;
  status: string;
  content: Array<{ text: string }>;
}
interface KiroToolSpec {
  toolSpecification: {
    name?: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}
interface KiroUserInputContext {
  tools?: KiroToolSpec[];
  toolResults?: KiroToolResult[];
}
interface KiroUserInputMessage {
  content: string;
  modelId: string;
  origin?: string;
  images?: KiroImage[];
  userInputMessageContext?: KiroUserInputContext;
}
interface KiroToolUse {
  toolUseId: string;
  name?: string;
  input: unknown;
}
interface KiroHistoryItem {
  userInputMessage?: KiroUserInputMessage;
  assistantResponseMessage?: { content: string; toolUses?: KiroToolUse[] };
}
export interface KiroPayload {
  conversationState: {
    chatTriggerType: string;
    conversationId: string;
    currentMessage: { userInputMessage: KiroUserInputMessage };
    history: KiroHistoryItem[];
  };
  profileArn?: string;
  inferenceConfig?: { maxTokens?: number; temperature?: number; topP?: number };
}

export interface KiroCredentials {
  accessToken?: string;
  providerData?: { profileArn?: string } | null;
}

function safeJSONParse(str: unknown, fallback: unknown): unknown {
  if (typeof str !== 'string') return str ?? fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function toolCallToText(name: string | undefined, input: unknown): string {
  let argStr: string;
  try {
    argStr = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  } catch {
    argStr = '{}';
  }
  return `[Tool call: ${name || 'unknown'}(${argStr})]`;
}

function toolResultToText(content: unknown): string {
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c === 'string' ? c : (c as ContentPart)?.text || '')).join('\n')
    : typeof content === 'string'
      ? content
      : '';
  return `[Tool result: ${text}]`;
}

/** Collapse all tool calls/results into plain text (when client sent no tools). */
function flattenToolInteractions(messages: OpenAIMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      out.push({ role: 'user', content: toolResultToText(msg.content) });
      continue;
    }
    if (msg.role === 'assistant') {
      const parts: string[] = [];
      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === 'tool_use') parts.push(toolCallToText(c.name, c.input));
          else if (c.type === 'text' || c.text) parts.push(c.text || '');
        }
      } else if (typeof msg.content === 'string') {
        parts.push(msg.content);
      }
      for (const tc of msg.tool_calls || []) {
        parts.push(toolCallToText(tc.function?.name, tc.function?.arguments));
      }
      out.push({ role: 'assistant', content: parts.filter(Boolean).join('\n') });
      continue;
    }
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const newContent = msg.content.map((c) =>
        c.type === 'tool_result' ? { type: 'text', text: toolResultToText(c.content) } : c
      );
      out.push({ ...msg, content: newContent });
      continue;
    }
    out.push(msg);
  }
  return out;
}

interface ConvertResult {
  history: KiroHistoryItem[];
  currentMessage: KiroHistoryItem;
}

function convertMessages(
  messagesIn: OpenAIMessage[],
  tools: OpenAITool[],
  model: string
): ConvertResult {
  let messages = messagesIn;
  const history: KiroHistoryItem[] = [];
  let currentMessage: KiroHistoryItem | null = null;
  const clientProvidedTools = tools && tools.length > 0;

  if (!clientProvidedTools) messages = flattenToolInteractions(messages);

  let pendingUserContent: string[] = [];
  let pendingAssistantContent: string[] = [];
  let pendingToolResults: KiroToolResult[] = [];
  let pendingImages: KiroImage[] = [];
  let currentRole: string | null = null;
  let toolsInjected = false;

  const flushPending = (): void => {
    if (currentRole === 'user') {
      const content = pendingUserContent.join('\n\n').trim() || 'continue';
      const userMsg: KiroHistoryItem = { userInputMessage: { content, modelId: '' } };
      const uim = userMsg.userInputMessage!;
      if (pendingImages.length > 0) uim.images = pendingImages;
      if (pendingToolResults.length > 0) {
        uim.userInputMessageContext = { toolResults: pendingToolResults };
      }
      if (clientProvidedTools && !toolsInjected) {
        if (!uim.userInputMessageContext) uim.userInputMessageContext = {};
        uim.userInputMessageContext.tools = tools.map((t) => {
          const name = t.function?.name || t.name;
          let description = t.function?.description || t.description || '';
          if (!description.trim()) description = `Tool: ${name}`;
          const schema = t.function?.parameters || t.parameters || t.input_schema || {};
          const normalizedSchema =
            Object.keys(schema).length === 0
              ? { type: 'object', properties: {}, required: [] }
              : { ...schema, required: (schema as { required?: unknown }).required ?? [] };
          return {
            toolSpecification: { name, description, inputSchema: { json: normalizedSchema } },
          };
        });
        toolsInjected = true;
      }
      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
    } else if (currentRole === 'assistant') {
      const content = pendingAssistantContent.join('\n\n').trim() || '...';
      history.push({ assistantResponseMessage: { content } });
      pendingAssistantContent = [];
    }
  };

  for (const msg of messages) {
    let role = msg.role;
    if (role === 'system' || role === 'tool') role = 'user';
    if (role !== currentRole && currentRole !== null) flushPending();
    currentRole = role;

    if (role === 'user') {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const c of msg.content) {
          if (c.type === 'text' || c.text) {
            textParts.push(c.text || '');
          } else if (c.type === 'image_url') {
            const url = c.image_url?.url || '';
            const m = url.match(/^data:([^;]+);base64,(.+)$/);
            if (m) {
              const format = m[1]!.split('/')[1] || m[1]!;
              pendingImages.push({ format, source: { bytes: m[2]! } });
            } else if (url.startsWith('http')) {
              textParts.push(`[Image: ${url}]`);
            }
          } else if (c.type === 'image' && c.source?.type === 'base64' && c.source.data) {
            const mediaType = c.source.media_type || 'image/png';
            const format = mediaType.split('/')[1] || mediaType;
            pendingImages.push({ format, source: { bytes: c.source.data } });
          }
        }
        content = textParts.join('\n');
        const toolResultBlocks = msg.content.filter((c) => c.type === 'tool_result');
        for (const block of toolResultBlocks) {
          const text = Array.isArray(block.content)
            ? (block.content as ContentPart[]).map((c) => c.text || '').join('\n')
            : typeof block.content === 'string'
              ? block.content
              : '';
          pendingToolResults.push({
            toolUseId: block.tool_use_id,
            status: 'success',
            content: [{ text }],
          });
        }
      }
      if (msg.role === 'tool') {
        const toolContent = typeof msg.content === 'string' ? msg.content : '';
        pendingToolResults.push({
          toolUseId: msg.tool_call_id,
          status: 'success',
          content: [{ text: toolContent }],
        });
      } else if (content) {
        pendingUserContent.push(content);
      }
    } else if (role === 'assistant') {
      let textContent = '';
      let toolUses: Array<{
        id?: string;
        name?: string;
        input?: unknown;
        function?: { name?: string; arguments?: string };
      }> = [];
      if (Array.isArray(msg.content)) {
        textContent = msg.content
          .filter((c) => c.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        toolUses = msg.content.filter((c) => c.type === 'tool_use') as typeof toolUses;
      } else if (typeof msg.content === 'string') {
        textContent = msg.content.trim();
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) toolUses = msg.tool_calls;
      if (textContent) pendingAssistantContent.push(textContent);
      if (toolUses.length > 0) {
        flushPending();
        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map((tc) =>
            tc.function
              ? {
                  toolUseId: tc.id || randomUUID(),
                  name: tc.function.name,
                  input: safeJSONParse(tc.function.arguments, {}),
                }
              : { toolUseId: tc.id || randomUUID(), name: tc.name, input: tc.input || {} }
          );
        }
        currentRole = null;
      }
    }
  }

  if (currentRole !== null) flushPending();

  // Pop the last user message as currentMessage.
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.userInputMessage) {
      currentMessage = history.splice(i, 1)[0]!;
      break;
    }
  }

  const firstHistoryTools = history[0]?.userInputMessage?.userInputMessageContext?.tools;

  for (const item of history) {
    const ctx = item.userInputMessage?.userInputMessageContext;
    if (ctx?.tools) delete ctx.tools;
    if (ctx && Object.keys(ctx).length === 0) delete item.userInputMessage!.userInputMessageContext;
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  }

  // Merge consecutive user messages (Kiro requires alternating roles).
  const mergedHistory: KiroHistoryItem[] = [];
  for (const current of history) {
    const prev = mergedHistory[mergedHistory.length - 1];
    if (current.userInputMessage && prev?.userInputMessage) {
      prev.userInputMessage.content += `\n\n${current.userInputMessage.content}`;
      const prevCtx = prev.userInputMessage.userInputMessageContext;
      const curCtx = current.userInputMessage.userInputMessageContext;
      if (curCtx) {
        if (!prevCtx) prev.userInputMessage.userInputMessageContext = curCtx;
        else if (curCtx.toolResults?.length) {
          prevCtx.toolResults = [...(prevCtx.toolResults || []), ...curCtx.toolResults];
        }
      }
    } else {
      mergedHistory.push(current);
    }
  }

  if (!currentMessage) {
    currentMessage = { userInputMessage: { content: '', modelId: model } };
  }

  const resolvedTools = firstHistoryTools;
  if (resolvedTools?.length && !currentMessage.userInputMessage!.userInputMessageContext?.tools) {
    if (!currentMessage.userInputMessage!.userInputMessageContext) {
      currentMessage.userInputMessage!.userInputMessageContext = {};
    }
    currentMessage.userInputMessage!.userInputMessageContext!.tools = resolvedTools;
  }

  return { history: mergedHistory, currentMessage };
}

/** Build the Kiro `generateAssistantResponse` payload from an OpenAI body. */
export function buildKiroPayload(
  model: string,
  body: OpenAIChatBody,
  credentials: KiroCredentials
): { payload: KiroPayload; upstreamModel: string } {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const { upstream: upstreamModel, agentic, thinking: modelThinking } = resolveKiroModel(model);
  const thinkingEnabled = modelThinking || isThinkingEnabled(body, model);

  const { history, currentMessage } = convertMessages(messages, tools, upstreamModel);
  const profileArn = credentials?.providerData?.profileArn || '';

  let finalContent = currentMessage?.userInputMessage?.content || '';
  const prefixParts: string[] = [];
  if (thinkingEnabled) prefixParts.push(buildThinkingSystemPrefix());
  prefixParts.push(`[Context: Current time is ${new Date().toISOString()}]`);
  if (agentic) prefixParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  finalContent = `${prefixParts.join('\n\n')}\n\n${finalContent}`;

  const cur = currentMessage.userInputMessage!;
  const payload: KiroPayload = {
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: randomUUID(),
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: upstreamModel,
          origin: 'AI_EDITOR',
          ...(cur.images?.length ? { images: cur.images } : {}),
          ...(cur.userInputMessageContext
            ? { userInputMessageContext: cur.userInputMessageContext }
            : {}),
        },
      },
      history,
    },
  };

  if (profileArn) payload.profileArn = profileArn;
  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (maxTokens) payload.inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }

  return { payload, upstreamModel };
}
