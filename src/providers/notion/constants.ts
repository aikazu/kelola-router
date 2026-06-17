/**
 * Notion provider constants — endpoints, internal model IDs, version pin.
 *
 * Reverse-engineered from Notion desktop client v23.13.20260617.1538 traffic
 * captured via mitmproxy. See docs/notion/wire-format.md for the full
 * protocol reference and docs/notion/capture-notes.md for raw findings.
 *
 * NOTE: `notion-client-version` is a fingerprint signal — pin exactly. If
 * Notion rotates the version, update this constant after re-capturing.
 */

export const NOTION_BASE = 'https://app.notion.com';
export const NOTION_FILE_BASE = 'https://file.notion.com';
export const NOTION_S3_UPLOAD = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/';

/** Pinned client version. Update only after re-capturing from real desktop. */
export const NOTION_CLIENT_VERSION = '23.13.20260617.1538';

/** Conversation routing: idempotent chat. Each request carries full transcript. */
export const NOTION_DEFAULT_MAX_COMPLETION_TOKENS = 8192;

/**
 * Reverse-engineered internal model IDs → router-facing aliases.
 * Sourced from POST /api/v3/getAvailableModels response (20 models observed in capture).
 *
 * The router-facing alias is what users put in `body.model` (e.g. "nt/notion-gpt-5.2").
 * The internal ID is what goes in `config.value.model` on the wire.
 *
 * Speed/intelligence/cost scores from Notion's modelCardAttributes (1-5 scale, 0 if absent).
 */
export interface NotionModelEntry {
  internalId: string;
  alias: string;
  displayName: string;
  family: 'openai' | 'anthropic' | 'gemini' | 'xai' | 'mystery';
  maxCompletionTokens: number;
}

export const NOTION_MODEL_TABLE: readonly NotionModelEntry[] = [
  // OpenAI GPT-5 family
  { internalId: 'oatmeal-cookie', alias: 'nt/notion-gpt-5.2', displayName: 'GPT-5.2', family: 'openai', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'oval-kumquat-medium', alias: 'nt/notion-gpt-5.4', displayName: 'GPT-5.4', family: 'openai', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'opal-quince-medium', alias: 'nt/notion-gpt-5.5', displayName: 'GPT-5.5', family: 'openai', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'oregon-grape-medium', alias: 'nt/notion-gpt-5.4-mini', displayName: 'GPT-5.4 Mini', family: 'openai', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'otaheite-apple-medium', alias: 'nt/notion-gpt-5.4-nano', displayName: 'GPT-5.4 Nano', family: 'openai', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  // Anthropic Claude family
  { internalId: 'almond-croissant-low', alias: 'nt/notion-sonnet-4.6', displayName: 'Sonnet 4.6', family: 'anthropic', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'avocado-froyo-medium', alias: 'nt/notion-opus-4.6', displayName: 'Opus 4.6', family: 'anthropic', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'apricot-sorbet-high', alias: 'nt/notion-opus-4.7', displayName: 'Opus 4.7', family: 'anthropic', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'ambrosia-tart-high', alias: 'nt/notion-opus-4.8', displayName: 'Opus 4.8', family: 'anthropic', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'anthropic-haiku-4.5', alias: 'nt/notion-haiku-4.5', displayName: 'Haiku 4.5', family: 'anthropic', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'acai-budino-high', alias: 'nt/notion-fable-5', displayName: 'Fable 5', family: 'anthropic', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  // Gemini family
  { internalId: 'vertex-gemini-2.5-flash', alias: 'nt/notion-gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', family: 'gemini', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'vertex-gemini-3.5-flash', alias: 'nt/notion-gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', family: 'gemini', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'gingerbread', alias: 'nt/notion-gemini-3-flash', displayName: 'Gemini 3 Flash', family: 'gemini', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'galette-medium-thinking', alias: 'nt/notion-gemini-3.1-pro', displayName: 'Gemini 3.1 Pro (thinking)', family: 'gemini', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  // xAI Grok family
  { internalId: 'xigua-mochi-medium', alias: 'nt/notion-grok-4.3', displayName: 'Grok 4.3', family: 'xai', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'xinomavro-cake', alias: 'nt/notion-grok-build-0.1', displayName: 'Grok Build 0.1', family: 'xai', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  // Mystery / partner models (Kimi, DeepSeek, GLM)
  { internalId: 'fireworks-kimi-k2.6', alias: 'nt/notion-kimi-k2.6', displayName: 'Kimi K2.6', family: 'mystery', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'baseten-deepseek-v4-pro', alias: 'nt/notion-deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', family: 'mystery', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
  { internalId: 'baseten-glm-5.2', alias: 'nt/notion-glm-5.2', displayName: 'GLM 5.2', family: 'mystery', maxCompletionTokens: NOTION_DEFAULT_MAX_COMPLETION_TOKENS },
] as const;

/** Lookup map: router alias → Notion internal model entry. */
export const NOTION_ALIAS_TO_MODEL: ReadonlyMap<string, NotionModelEntry> = new Map(
  NOTION_MODEL_TABLE.map((m) => [m.alias, m]),
);

/** Reverse lookup: internal ID → model entry. For `getAvailableModels` reconciliation. */
export const NOTION_INTERNAL_TO_MODEL: ReadonlyMap<string, NotionModelEntry> = new Map(
  NOTION_MODEL_TABLE.map((m) => [m.internalId, m]),
);

/** Cookies required for AI requests (see docs/notion/wire-format.md §1.2). */
export const NOTION_AI_COOKIE_NAMES = [
  'device_id',
  'notion_browser_id',
  'notion_check_cookie_consent',
  'notion_user_id',
  'notion_sync_user_id',
  'NEXT_LOCALE',
  'p_sync_session',
  '_cioid',
  'notion_locale',
  'notion_users',
  'token_v2',
] as const;

/** Cookies set by loginWithEmail response (subset of above). */
export const NOTION_LOGIN_COOKIE_NAMES = [
  'token_v2',
  'file_token',
  'notion_user_id',
  'notion_users',
  'notion_sync_user_id',
  'notion_locale',
  'NEXT_LOCALE',
  'p_sync_session',
] as const;

/** Error codes that should NOT trigger failover (account-level failures). */
export const NOTION_FATAL_STATUSES = new Set([401, 403, 404]);

/** Error codes that ARE retryable with failover. */
export const NOTION_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);