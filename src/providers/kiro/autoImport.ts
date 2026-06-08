/**
 * Auto-import Kiro credentials from local AWS SSO cache.
 *
 * Reads `~/.aws/sso/cache/` looking for a file with a Kiro refresh token
 * (starts with "aorAAAAAG"). Tries `kiro-auth-token.json` first, then scans
 * all JSON files in the directory.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AutoImportResult {
  found: boolean;
  refreshToken?: string;
  source?: string;
  error?: string;
}

const TOKEN_PREFIX = 'aorAAAAAG';

export async function autoImportFromSsoCache(): Promise<AutoImportResult> {
  const cachePath = join(homedir(), '.aws', 'sso', 'cache');

  let files: string[];
  try {
    files = await readdir(cachePath);
  } catch {
    return {
      found: false,
      error: 'AWS SSO cache not found (~/.aws/sso/cache). Login to Kiro IDE first.',
    };
  }

  // Try kiro-auth-token.json first
  const primary = 'kiro-auth-token.json';
  if (files.includes(primary)) {
    const token = await tryExtractToken(join(cachePath, primary));
    if (token) return { found: true, refreshToken: token, source: primary };
  }

  // Fallback: scan all JSON files
  for (const file of files) {
    if (!file.endsWith('.json') || file === primary) continue;
    const token = await tryExtractToken(join(cachePath, file));
    if (token) return { found: true, refreshToken: token, source: file };
  }

  return { found: false, error: 'No Kiro token found in AWS SSO cache. Login to Kiro IDE first.' };
}

async function tryExtractToken(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as { refreshToken?: string };
    if (data.refreshToken && data.refreshToken.startsWith(TOKEN_PREFIX)) {
      return data.refreshToken;
    }
  } catch {
    // skip
  }
  return null;
}
