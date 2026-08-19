import type {
  ContentBlock,
  AnthropicMessage as Message,
} from '../providers/format/message-types.js';
import type { CavemanLevel } from './prompts.js';
import { CAVEMAN_PROMPTS } from './prompts.js';

const SEP = '\n\n';

// Covers both Anthropic (system/messages) and OpenAI (instructions/input) shapes.
export type CavemanBody = {
  system?: string | ContentBlock[];
  messages?: Message[];
  instructions?: string;
  input?: Message[];
  [extra: string]: unknown;
};

export function injectCaveman(body: CavemanBody, level: CavemanLevel): void {
  const prompt = CAVEMAN_PROMPTS[level];
  if (!body || !prompt) return;

  if (body.system !== undefined) {
    injectClaudeSystem(body, prompt);
  } else {
    injectMessagesSystem(body, prompt);
  }
}

function injectMessagesSystem(body: CavemanBody, prompt: string): void {
  if (typeof body.instructions === 'string') {
    body.instructions = body.instructions ? `${body.instructions}${SEP}${prompt}` : prompt;
    return;
  }
  const arr: Message[] | null = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : null;
  if (!arr) return;

  const idx = arr.findIndex((m) => m && (m.role === 'system' || m.role === 'developer'));
  if (idx >= 0) {
    appendToOpenAIMessage(arr[idx], prompt);
  } else {
    arr.unshift({ role: 'system', content: prompt });
  }
}

function appendToOpenAIMessage(msg: Message, prompt: string): void {
  if (typeof msg.content === 'string') {
    msg.content = `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    msg.content.push({ type: 'text', text: prompt });
  } else {
    msg.content = prompt;
  }
}

function injectClaudeSystem(body: CavemanBody, prompt: string): void {
  if (typeof body.system === 'string') {
    body.system = body.system.length > 0 ? `${body.system}${SEP}${prompt}` : prompt;
    return;
  }
  if (Array.isArray(body.system)) {
    const block = { type: 'text', text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) {
        lastCacheIdx = i;
        break;
      }
    }
    if (lastCacheIdx >= 0) {
      body.system.splice(lastCacheIdx + 1, 0, block);
    } else {
      body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}
