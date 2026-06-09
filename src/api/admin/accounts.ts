import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import {
  createAccount,
  deleteAccount,
  disableAccount,
  enableAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '../../db/repos/accounts.js';
import {
  buildKiroAccountFields,
  type KiroImportInput,
} from '../../providers/kiro/accountImport.js';
import { autoImportFromSsoCache } from '../../providers/kiro/autoImport.js';
import { pollDeviceToken, startDeviceCodeFlow } from '../../providers/kiro/deviceCode.js';
import { ApiError, handleApiError } from './middleware.js';

export const accountRoutes = new Hono();

accountRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const lockCounts = db
      .prepare(
        `SELECT account_id, COUNT(*) as cnt FROM account_model_locks WHERE locked_until > datetime('now') GROUP BY account_id`
      )
      .all() as Array<{ account_id: string; cnt: number }>;
    const lockMap = new Map(lockCounts.map((r) => [r.account_id, r.cnt]));
    return c.json(
      listAccounts(db).map((a) => {
        let authMethod: string | null = null;
        let persona: string | null = null;
        if (a.provider === 'kiro' && a.provider_data) {
          try {
            const pd = JSON.parse(a.provider_data) as { authMethod?: string; persona?: string };
            authMethod = pd.authMethod ?? null;
            persona = pd.persona === 'cli' ? 'cli' : 'ide';
          } catch {
            authMethod = null;
            persona = 'ide';
          }
        }
        return {
          id: a.id,
          label: a.label,
          provider: a.provider,
          authMethod,
          persona,
          creditType: a.credit_type,
          status: a.status,
          enabled: !!a.enabled,
          lastError: a.last_error,
          backoffLevel: a.backoff_level,
          rateLimitedUntil: a.rate_limited_until,
          relayId: a.relay_id,
          proxyId: a.proxy_id,
          proxyPool: a.proxy_pool ? (JSON.parse(a.proxy_pool) as string[]) : [],
          proxyRotateEvery: a.proxy_rotate_every,
          lockedModels: lockMap.get(a.id) ?? 0,
        };
      })
    );
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.post('/', (c) => {
  try {
    return c.req
      .json()
      .then(
        (body: { label?: string; credit_type?: string; api_key?: string; base_url?: string }) => {
          if (!body.label || !body.credit_type || !body.api_key) {
            throw new ApiError('invalid_input', 'label, credit_type, api_key required', 400);
          }
          const db = c.get('db') as Database.Database;
          const acc = createAccount(db, {
            id: ulid(),
            label: body.label,
            credit_type: body.credit_type as 'payg' | 'token-plan',
            api_key: body.api_key,
            base_url: body.base_url ?? null,
          });
          return c.json({ id: acc.id, label: acc.label, creditType: acc.credit_type }, 201);
        }
      )
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.post('/kiro', (c) => {
  try {
    return c.req
      .json()
      .then((body: KiroImportInput) => {
        const db = c.get('db') as Database.Database;
        let fields: ReturnType<typeof buildKiroAccountFields>;
        try {
          fields = buildKiroAccountFields(body);
        } catch (err) {
          throw new ApiError('invalid_input', (err as Error).message, 400);
        }
        const id = ulid();
        const acc = createAccount(db, {
          id,
          label: fields.label,
          credit_type: 'payg',
          api_key: fields.api_key,
          provider: 'kiro',
          provider_data: fields.provider_data,
        });
        // Cache any access token + expiry so the first request need not refresh.
        if (fields.access_token || fields.token_expires_at) {
          updateAccount(db, id, {
            access_token: fields.access_token,
            token_expires_at: fields.token_expires_at,
          });
        }
        return c.json({ id: acc.id, label: acc.label, provider: 'kiro' }, 201);
      })
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});

// --- Kiro Device Code Flow (AWS Builder ID / IAM IDC) ---

accountRoutes.post('/kiro/device-code', async (c) => {
  try {
    const body = (await c.req.json()) as {
      authMethod?: string;
      region?: string;
      startUrl?: string;
    };
    const authMethod = body.authMethod === 'idc' ? 'idc' : 'builder-id';
    const result = await startDeviceCodeFlow({
      authMethod,
      region: body.region,
      startUrl: body.startUrl,
    });
    return c.json(result);
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.post('/kiro/poll', async (c) => {
  try {
    const body = (await c.req.json()) as {
      deviceCode: string;
      clientId: string;
      clientSecret: string;
      region?: string;
      authMethod?: string;
      startUrl?: string;
      label?: string;
    };
    if (!body.deviceCode || !body.clientId || !body.clientSecret) {
      throw new ApiError('invalid_input', 'deviceCode, clientId, clientSecret required', 400);
    }
    const result = await pollDeviceToken({
      deviceCode: body.deviceCode,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      region: body.region,
    });
    if (result.status !== 'success') {
      return c.json(result);
    }
    // Token obtained — save account
    const db = c.get('db') as Database.Database;
    const region = body.region?.trim() || 'us-east-1';
    const authMethod = body.authMethod === 'idc' ? 'idc' : 'builder-id';
    const providerData = JSON.stringify({
      authMethod,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      region,
      ...(body.startUrl ? { startUrl: body.startUrl } : {}),
    });
    const expiresAt = result.expiresIn
      ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
      : null;
    const id = ulid();
    const acc = createAccount(db, {
      id,
      label: body.label || `kiro-${authMethod}`,
      credit_type: 'payg',
      api_key: result.refreshToken!,
      provider: 'kiro',
      provider_data: providerData,
    });
    updateAccount(db, id, { access_token: result.accessToken!, token_expires_at: expiresAt });
    return c.json({ status: 'success', id: acc.id, label: acc.label, provider: 'kiro' });
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.get('/kiro/auto-import', async (c) => {
  try {
    const result = await autoImportFromSsoCache();
    return c.json(result);
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.post('/:id/disable', (c) => {
  try {
    disableAccount(c.get('db') as Database.Database, c.req.param('id'));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.post('/:id/enable', (c) => {
  try {
    enableAccount(c.get('db') as Database.Database, c.req.param('id'));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.delete('/:id', (c) => {
  try {
    deleteAccount(c.get('db') as Database.Database, c.req.param('id'));
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.patch('/:id', (c) => {
  try {
    return c.req
      .json()
      .then(
        (body: {
          label?: string;
          api_key?: string;
          persona?: string;
          profileArn?: string;
          relayId?: string | null;
          proxyId?: string | null;
          proxyPool?: string[] | null;
          proxyRotateEvery?: number;
        }) => {
          const db = c.get('db') as Database.Database;
          const patch: Record<string, string | number | null> = {};
          if (body.label) patch.label = body.label;
          if (body.api_key) patch.api_key = body.api_key;
          // --- Transport assignment ---
          // Empty string clears the assignment (set NULL).
          if (body.relayId !== undefined) {
            patch.relay_id = body.relayId ? body.relayId : null;
          }
          if (body.proxyId !== undefined) {
            patch.proxy_id = body.proxyId ? body.proxyId : null;
          }
          if (body.proxyPool !== undefined) {
            if (body.proxyPool === null || body.proxyPool.length === 0) {
              patch.proxy_pool = null;
            } else {
              if (
                !Array.isArray(body.proxyPool) ||
                body.proxyPool.some((x) => typeof x !== 'string')
              ) {
                throw new ApiError('invalid_input', 'proxyPool must be an array of ids', 400);
              }
              patch.proxy_pool = JSON.stringify(body.proxyPool);
            }
          }
          if (body.proxyRotateEvery !== undefined) {
            const n = Math.floor(Number(body.proxyRotateEvery));
            if (!Number.isFinite(n) || n < 1) {
              throw new ApiError('invalid_input', 'proxyRotateEvery must be >= 1', 400);
            }
            patch.proxy_rotate_every = n;
          }
          // Relay and proxy are mutually exclusive at resolve time; reject configs
          // that try to set both a relay and a proxy/pool in the same request.
          const settingRelay = patch.relay_id != null && patch.relay_id !== '';
          const settingProxy =
            (patch.proxy_id != null && patch.proxy_id !== '') ||
            (patch.proxy_pool != null && patch.proxy_pool !== '');
          if (settingRelay && settingProxy) {
            throw new ApiError(
              'invalid_input',
              'relay and proxy are mutually exclusive; set only one',
              400
            );
          }
          // persona + profileArn live inside the Kiro provider_data JSON blob.
          if (body.persona !== undefined || body.profileArn !== undefined) {
            const acc = getAccount(db, c.req.param('id'));
            if (!acc) throw new ApiError('not_found', 'account not found', 404);
            let pd: Record<string, unknown> = {};
            if (acc.provider_data) {
              try {
                pd = JSON.parse(acc.provider_data) as Record<string, unknown>;
              } catch {
                pd = {};
              }
            }
            if (body.persona !== undefined) pd.persona = body.persona === 'cli' ? 'cli' : 'ide';
            if (body.profileArn !== undefined) pd.profileArn = body.profileArn;
            patch.provider_data = JSON.stringify(pd);
          }
          if (Object.keys(patch).length === 0) {
            throw new ApiError('invalid_input', 'Nothing to update', 400);
          }
          updateAccount(db, c.req.param('id'), patch);
          return new Response(null, { status: 204 });
        }
      )
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});

// --- Kiro Usage / Quota ---
accountRoutes.get('/:id/usage', async (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const acc = getAccount(db, c.req.param('id'));
    if (!acc) return c.json({ error: 'account not found' }, 404);
    if (acc.provider !== 'kiro') return c.json({ error: 'not a Kiro account' }, 400);

    const { ensureAccessToken } = await import('../../providers/kiro/auth.js');
    const { fetchKiroUsage } = await import('../../providers/kiro/usage.js');
    const auth = await ensureAccessToken(db, acc);
    const region = auth.providerData?.region || 'us-east-1';
    const profileArn = auth.providerData?.profileArn || null;
    const usage = await fetchKiroUsage(auth.accessToken, { region, profileArn });
    if (!usage) return c.json({ error: 'failed to fetch usage from Kiro' }, 502);
    return c.json(usage);
  } catch (e) {
    return handleApiError(e);
  }
});

// --- Model Locks ---
accountRoutes.get('/:id/locks', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    const locks = db
      .prepare(
        `SELECT model, locked_until FROM account_model_locks WHERE account_id = ? AND locked_until > datetime('now')`
      )
      .all(c.req.param('id')) as Array<{ model: string; locked_until: string }>;
    return c.json({ locks });
  } catch (e) {
    return handleApiError(e);
  }
});

accountRoutes.delete('/:id/locks/:model', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    db.prepare(`DELETE FROM account_model_locks WHERE account_id = ? AND model = ?`).run(
      c.req.param('id'),
      c.req.param('model')
    );
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
});
