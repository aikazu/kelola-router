import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import {
  createAccount,
  deleteAccount,
  disableAccount,
  enableAccount,
  listAccounts,
  updateAccount,
} from '../../db/repos/accounts.js';
import {
  buildKiroAccountFields,
  type KiroImportInput,
} from '../../providers/kiro/accountImport.js';
import { ApiError, handleApiError } from './middleware.js';

export const accountRoutes = new Hono();

accountRoutes.get('/', (c) => {
  try {
    const db = c.get('db') as Database.Database;
    return c.json(
      listAccounts(db).map((a) => {
        let authMethod: string | null = null;
        if (a.provider === 'kiro' && a.provider_data) {
          try {
            authMethod =
              (JSON.parse(a.provider_data) as { authMethod?: string }).authMethod ?? null;
          } catch {
            authMethod = null;
          }
        }
        return {
          id: a.id,
          label: a.label,
          provider: a.provider,
          authMethod,
          creditType: a.credit_type,
          status: a.status,
          enabled: !!a.enabled,
          lastError: a.last_error,
          backoffLevel: a.backoff_level,
          rateLimitedUntil: a.rate_limited_until,
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
      .then((body: { label?: string; api_key?: string }) => {
        const db = c.get('db') as Database.Database;
        const patch: Record<string, string> = {};
        if (body.label) patch.label = body.label;
        if (body.api_key) patch.api_key = body.api_key;
        if (Object.keys(patch).length === 0) {
          throw new ApiError('invalid_input', 'Nothing to update', 400);
        }
        updateAccount(db, c.req.param('id'), patch);
        return new Response(null, { status: 204 });
      })
      .catch((e: unknown) => handleApiError(e));
  } catch (e) {
    return handleApiError(e);
  }
});
