import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Safe JSON parse wrapper. Returns null on parse failure.
 * Used throughout proxy modules to avoid circular imports with server.ts.
 */
export function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Extract error message from Error or unknown value.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Extract string value from unknown, default to empty string.
 */
export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Type-safe cast to ContentfulStatusCode.
 */
export function statusCode(value: number): ContentfulStatusCode {
  return value as ContentfulStatusCode;
}
