import { CODEBUDDY_DEFAULT_SYSTEM, CODEBUDDY_DEFAULT_TEMPERATURE } from './index.js';

/**
 * Ensure `system` and `temperature` are present in the Anthropic Messages body.
 *
 * CodeBuddy upstream requires both fields. The body is already Anthropic format
 * from the client — we only inject defaults when missing.
 */
export function ensureCodeBuddyDefaults(body: Record<string, unknown>): Record<string, unknown> {
  const result = { ...body };

  // CodeBuddy requires a top-level system field
  if (!result.system) {
    result.system = CODEBUDDY_DEFAULT_SYSTEM;
  }

  // CodeBuddy requires temperature to be present
  if (result.temperature === undefined || result.temperature === null) {
    result.temperature = CODEBUDDY_DEFAULT_TEMPERATURE;
  }

  return result;
}
