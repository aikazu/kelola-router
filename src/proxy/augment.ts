import type { CavemanLevel } from '../caveman/prompts.js';
import type { AnthropicBody, ContentBlock } from '../providers/format/message-types.js';

export type { AnthropicBody, ContentBlock };

export function addDualCacheBreakpoints(body: AnthropicBody, respectCallerMarkers = true): void {
  if (body.system === undefined) return;

  if (Array.isArray(body.system) && body.system.length > 0) {
    const last = body.system[body.system.length - 1];
    if (!last.cache_control && (!respectCallerMarkers || !hasAnyCacheControl(body.system))) {
      last.cache_control = { type: 'ephemeral' };
    }
  } else if (typeof body.system === 'string' && body.system.length > 0) {
    body.system = [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }];
  }

  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (let j = msg.content.length - 1; j >= 0; j--) {
          const block = msg.content[j];
          if (block.type === 'tool_use' || block.type === 'text') {
            if (!block.cache_control) block.cache_control = { type: 'ephemeral' };
            return;
          }
        }
      }
    }
  }
}

function hasAnyCacheControl(arr: ContentBlock[]): boolean {
  for (const block of arr) {
    if (block?.cache_control) return true;
    if (Array.isArray(block?.content)) {
      for (const part of block.content) {
        if (part?.cache_control) return true;
      }
    }
  }
  return false;
}

export async function augmentRequest(
  body: AnthropicBody,
  settings: {
    caveman?: { level: string };
    caching?: { autoBreakpoints: boolean; respectCallerMarkers: boolean };
  }
): Promise<void> {
  if (settings.caveman?.level && settings.caveman.level !== 'off') {
    const { injectCaveman } = await import('../caveman/index.js');
    injectCaveman(body, settings.caveman.level as CavemanLevel);
  }
  if (settings.caching?.autoBreakpoints && body.system !== undefined) {
    addDualCacheBreakpoints(body, settings.caching.respectCallerMarkers);
  }
}
