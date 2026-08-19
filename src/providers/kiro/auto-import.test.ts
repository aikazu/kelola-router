import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoImportFromSsoCache } from './auto-import.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: () => '/home/test',
}));

import { readdir, readFile } from 'node:fs/promises';

const mockReaddir = readdir as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;

describe('autoImportFromSsoCache', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  it('returns found when kiro-auth-token.json has valid token', async () => {
    mockReaddir.mockResolvedValue(['kiro-auth-token.json', 'other.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({ refreshToken: 'aorAAAAAGabc123' }));

    const result = await autoImportFromSsoCache();
    expect(result.found).toBe(true);
    expect(result.refreshToken).toBe('aorAAAAAGabc123');
    expect(result.source).toBe('kiro-auth-token.json');
  });

  it('scans other files when kiro-auth-token.json missing', async () => {
    mockReaddir.mockResolvedValue(['some-hash.json', 'another.json']);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({ accessToken: 'at' })) // no refreshToken
      .mockResolvedValueOnce(JSON.stringify({ refreshToken: 'aorAAAAAGxyz' }));

    const result = await autoImportFromSsoCache();
    expect(result.found).toBe(true);
    expect(result.refreshToken).toBe('aorAAAAAGxyz');
    expect(result.source).toBe('another.json');
  });

  it('returns not found when directory does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));

    const result = await autoImportFromSsoCache();
    expect(result.found).toBe(false);
    expect(result.error).toContain('AWS SSO cache not found');
  });

  it('returns not found when no token matches prefix', async () => {
    mockReaddir.mockResolvedValue(['file.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({ refreshToken: 'invalid-token' }));

    const result = await autoImportFromSsoCache();
    expect(result.found).toBe(false);
    expect(result.error).toContain('No Kiro token found');
  });

  it('skips non-json files', async () => {
    mockReaddir.mockResolvedValue(['readme.txt', 'data.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({ refreshToken: 'aorAAAAAGfoo' }));

    const result = await autoImportFromSsoCache();
    expect(result.found).toBe(true);
    expect(result.source).toBe('data.json');
  });

  it('skips files with invalid JSON', async () => {
    mockReaddir.mockResolvedValue(['bad.json', 'good.json']);
    mockReadFile
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify({ refreshToken: 'aorAAAAAGvalid' }));

    const result = await autoImportFromSsoCache();
    expect(result.found).toBe(true);
    expect(result.source).toBe('good.json');
  });
});
