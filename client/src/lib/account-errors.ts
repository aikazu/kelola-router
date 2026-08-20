/**
 * Friendly error mapping for account-related admin API failures.
 *
 * The admin API leaks raw SQLite error strings (e.g. when an `accounts.api_key`
 * UNIQUE constraint is tripped by reusing an existing key) as the `message` of
 * an otherwise-unmapped 500 response. Map those DB-isms to human-friendly copy
 * on the client so end users never see an internal database error.
 */

/** Marker for the `accounts.api_key` UNIQUE-constraint violation. */
const DUPLICATE_KEY_MARKER = 'UNIQUE constraint failed: accounts.api_key';

/** Human-friendly copy shown instead of the raw SQLite error. */
export const DUPLICATE_KEY_MESSAGE =
  'An account with this API key already exists. Each API key can only be used once.';

/**
 * Return a friendly message for an account API error, passing through any
 * message that does not match a known raw-database marker.
 */
export function friendlyAccountError(message: string): string {
  return message.includes(DUPLICATE_KEY_MARKER) ? DUPLICATE_KEY_MESSAGE : message;
}