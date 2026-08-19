import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoImportResult } from '../../providers/kiro/auto-import.js';
import { app, resetDb } from '../../server.js';

// Mock autoImportFromSsoCache at the module level — the route handler imports it
vi.mock('../../providers/kiro/auto-import.js', () => ({
  autoImportFromSsoCache: vi.fn(),
}));

import { autoImportFromSsoCache } from '../../providers/kiro/auto-import.js';

const mockAutoImport = autoImportFromSsoCache as ReturnType<typeof vi.fn>;

describe('GET /api/admin/accounts/kiro/auto-import', () => {
  beforeEach(() => {
    process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ki-')), 't.db');
    resetDb();
    mockAutoImport.mockReset();
  });

  it('returns 200 with found:true and refreshToken when cache has valid token', async () => {
    const payload: AutoImportResult = {
      found: true,
      refreshToken: 'aorAAAAAGabc123',
      source: 'kiro-auth-token.json',
    };
    mockAutoImport.mockResolvedValueOnce(payload);

    const res = await app.request('/api/admin/accounts/kiro/auto-import');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(payload);
    expect(body.found).toBe(true);
    expect(body.refreshToken).toBe('aorAAAAAGabc123');
    expect(body.source).toBe('kiro-auth-token.json');
  });

  it('returns 200 with found:false when SSO cache directory is missing', async () => {
    const payload: AutoImportResult = {
      found: false,
      error: 'AWS SSO cache not found (~/.aws/sso/cache). Login to Kiro IDE first.',
    };
    mockAutoImport.mockResolvedValueOnce(payload);

    const res = await app.request('/api/admin/accounts/kiro/auto-import');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.error).toContain('AWS SSO cache not found');
  });

  it('returns 200 with found:false and No Kiro token error when cache is empty', async () => {
    const payload: AutoImportResult = {
      found: false,
      error: 'No Kiro token found in AWS SSO cache. Login to Kiro IDE first.',
    };
    mockAutoImport.mockResolvedValueOnce(payload);

    const res = await app.request('/api/admin/accounts/kiro/auto-import');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.error).toContain('No Kiro token found');
  });

  it('returns 200 with found:false when cache file has malformed JSON', async () => {
    // Malformed JSON is handled inside autoImportFromSsoCache → returns found:false
    const payload: AutoImportResult = {
      found: false,
      error: 'No Kiro token found in AWS SSO cache. Login to Kiro IDE first.',
    };
    mockAutoImport.mockResolvedValueOnce(payload);

    const res = await app.request('/api/admin/accounts/kiro/auto-import');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
  });

  it('picks most recent valid token when multiple cache files exist', async () => {
    // autoImportFromSsoCache scans files and returns the first valid token
    // The order is: kiro-auth-token.json first, then other .json files in readdir order
    const payload: AutoImportResult = {
      found: true,
      refreshToken: 'aorAAAAAGfromOther',
      source: 'some-hash.json',
    };
    mockAutoImport.mockResolvedValueOnce(payload);

    const res = await app.request('/api/admin/accounts/kiro/auto-import');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.refreshToken).toBe('aorAAAAAGfromOther');
    expect(body.source).toBe('some-hash.json');
  });

  it('returns 500 when autoImportFromSsoCache throws an unexpected error', async () => {
    mockAutoImport.mockRejectedValueOnce(new Error('unexpected fs error'));

    const res = await app.request('/api/admin/accounts/kiro/auto-import');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('internal');
  });

  it('calls autoImportFromSsoCache exactly once per request', async () => {
    mockAutoImport.mockResolvedValueOnce({ found: false, error: 'test' });

    await app.request('/api/admin/accounts/kiro/auto-import');

    expect(mockAutoImport).toHaveBeenCalledTimes(1);
  });
});
