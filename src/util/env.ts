/**
 * Centralized access to router-scoped environment variables.
 * Returns typed defaults; never throws on missing input.
 */

export function getHost(): string {
  return process.env.HOST ?? '127.0.0.1';
}

export function getPort(): number {
  return parseInt(process.env.PORT ?? '20137', 10);
}

export type Region = 'intl' | 'cn';

export function getRegion(): Region {
  return process.env.MINIMAX_REGION === 'cn' ? 'cn' : 'intl';
}

export function getDbPath(): string | null {
  return process.env.ROUTER_DB_PATH ?? null;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export function getLogLevel(): LogLevel {
  const v = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  const allowed: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  return allowed.includes(v) ? v : 'info';
}
