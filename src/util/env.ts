/**
 * Centralized access to router-scoped environment variables.
 * Returns typed defaults; never throws on missing input.
 */

import type Database from 'better-sqlite3';
import { getSetting } from '../db/repos/settings.js';

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

export function getDbKey(): string | undefined {
  const v = process.env.ROUTER_DB_KEY?.trim();
  return v && v.length > 0 ? v : undefined;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export function getLogLevel(): LogLevel {
  const v = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  const allowed: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  return allowed.includes(v) ? v : 'info';
}

export type UpstreamFormat = 'auto' | 'openai' | 'anthropic';

/**
 * Reads upstream format from settings.minimax.upstreamFormat first,
 * then process.env.ROUTER_UPSTREAM_FORMAT, then 'auto'.
 * Treats settings value of 'auto' as "not set" (falls through to env check).
 */
export function getUpstreamFormat(db: Database.Database): UpstreamFormat {
  const settings = getSetting<{ upstreamFormat?: UpstreamFormat }>(db, 'minimax');
  if (settings?.upstreamFormat && settings.upstreamFormat !== 'auto') {
    return settings.upstreamFormat;
  }
  const env = process.env.ROUTER_UPSTREAM_FORMAT as UpstreamFormat | undefined;
  if (env === 'openai' || env === 'anthropic') return env;
  return 'auto';
}

export function getRequestLogRetentionDays(): number {
  return Number(process.env.REQUEST_LOG_RETENTION_DAYS ?? 30);
}

export function isConsoleFlowEnabled(): boolean {
  return process.env.CONSOLE_FLOW !== '0';
}
