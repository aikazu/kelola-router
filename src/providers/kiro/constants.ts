/**
 * Kiro (AWS CodeWhisperer) constants, endpoints, and model-name resolution.
 *
 * Adapted from the 9router reference (MIT). Kiro upstream does not advertise
 * `-thinking` / `-agentic` model ids — those are router fictions: synthetic
 * suffixes that toggle behaviour (thinking-mode prompt injection, chunked-write
 * agentic prompt) but resolve to the same upstream model id, with the suffix
 * stripped before the request leaves this process.
 */

export const KIRO_DEFAULT_REGION = 'us-east-1';

/** Build the generateAssistantResponse endpoint for a region. */
export function kiroEndpoint(region: string = KIRO_DEFAULT_REGION): string {
  return `https://codewhisperer.${region}.amazonaws.com/generateAssistantResponse`;
}

/** Social-auth (Builder ID via Kiro desktop) refresh endpoint. */
export const KIRO_SOCIAL_TOKEN_URL = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken';

/** AWS SSO OIDC refresh endpoint for a region. */
export function kiroOidcTokenUrl(region: string = KIRO_DEFAULT_REGION): string {
  return `https://oidc.${region}.amazonaws.com/token`;
}

export const KIRO_AGENTIC_SUFFIX = '-agentic';
export const KIRO_THINKING_SUFFIX = '-thinking';
export const KIRO_THINKING_BUDGET_DEFAULT = 16000;

export const KIRO_AGENTIC_SYSTEM_PROMPT = `
# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- **NEVER** write entire files in one operation if >300 lines

## MANDATORY CHUNKED WRITE STRATEGY

### For NEW FILES (>300 lines total):
1. FIRST: Write initial chunk (first 250-300 lines)
2. THEN: Append remaining content in 250-300 line chunks
3. REPEAT: Continue appending until complete

### For EDITING EXISTING FILES:
1. Use surgical edits - change ONLY what's needed
2. NEVER rewrite entire files - use incremental modifications
3. Split large refactors into multiple small, focused edits

REMEMBER: When in doubt, write LESS per operation. Multiple small operations > one large operation.
`.trim();

export interface KiroModelResolution {
  upstream: string;
  agentic: boolean;
  thinking: boolean;
}

export function isAgenticModel(model: string): boolean {
  return typeof model === 'string' && model.endsWith(KIRO_AGENTIC_SUFFIX);
}

export function isThinkingModel(model: string): boolean {
  return typeof model === 'string' && model.endsWith(KIRO_THINKING_SUFFIX);
}

/**
 * Resolve a router model id to the real upstream Kiro id plus the behaviour
 * flags implied by its synthetic suffixes. Order is `-thinking` then
 * `-agentic` so `claude-sonnet-4.5-thinking-agentic` resolves correctly.
 */
export function resolveKiroModel(model: string): KiroModelResolution {
  let upstream = model;
  let agentic = false;
  let thinking = false;
  if (isAgenticModel(upstream)) {
    agentic = true;
    upstream = upstream.slice(0, -KIRO_AGENTIC_SUFFIX.length);
  }
  if (isThinkingModel(upstream)) {
    thinking = true;
    upstream = upstream.slice(0, -KIRO_THINKING_SUFFIX.length);
  }
  return { upstream, agentic, thinking };
}

/**
 * Magic system-prompt prefix that turns Kiro reasoning on. Kiro has no native
 * `thinking`/`reasoning_effort` knob; injecting this tag is the only lever.
 */
export function buildThinkingSystemPrefix(budget: number = KIRO_THINKING_BUDGET_DEFAULT): string {
  const safe = Math.max(1, Math.min(32000, Number(budget) || KIRO_THINKING_BUDGET_DEFAULT));
  return `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${safe}</max_thinking_length>`;
}

interface ThinkingDetectBody {
  thinking?: { type?: string; budget_tokens?: number } | null;
  reasoning_effort?: string;
  reasoning?: { effort?: string } | null;
  messages?: Array<{
    role?: string;
    content?: string | Array<{ text?: string }>;
  }>;
  system?: string;
}

/** Detect whether an inbound request is asking for reasoning / thinking output. */
export function isThinkingEnabled(body: ThinkingDetectBody, model?: string): boolean {
  if (body && typeof body === 'object') {
    const thinking = body.thinking;
    if (thinking && typeof thinking === 'object' && thinking.type === 'enabled') {
      const budget = Number(thinking.budget_tokens);
      if (!Number.isFinite(budget) || budget > 0) return true;
    }
    const effort =
      body.reasoning_effort ??
      (body.reasoning && typeof body.reasoning === 'object' ? body.reasoning.effort : null);
    if (typeof effort === 'string') {
      const v = effort.toLowerCase();
      if (v && (v === 'low' || v === 'medium' || v === 'high' || v === 'auto')) return true;
    }
    if (containsThinkingModeTag(body)) return true;
  }
  if (typeof model === 'string' && model) {
    const m = model.toLowerCase();
    if (m.includes('thinking') || m.includes('-reason')) return true;
  }
  return false;
}

function containsThinkingModeTag(body: ThinkingDetectBody): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role !== 'system' && msg.role !== 'user') continue;
    const content = msg.content;
    if (typeof content === 'string') {
      if (containsTagInText(content)) return true;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === 'string' && containsTagInText(part.text)) return true;
      }
    }
  }
  if (typeof body.system === 'string' && containsTagInText(body.system)) return true;
  return false;
}

function containsTagInText(text: string): boolean {
  if (!text || !text.includes('<thinking_mode>')) return false;
  return (
    text.includes('<thinking_mode>enabled</thinking_mode>') ||
    text.includes('<thinking_mode>interleaved</thinking_mode>')
  );
}
