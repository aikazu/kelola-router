import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { confirmDialog } from '../components/Confirm';
import { ErrorState } from '../components/ErrorState';
import { Switch } from '../components/Switch';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';

// Mirrors the valibot picklists in src/db/repos/settings.types.ts so the
// client surfaces drift immediately: if the server schema widens beyond
// these unions, the dropdown cannot silently render a blank/disabled row.
type CavemanLevel = 'off' | 'terse' | 'ultra';
type UpstreamFormat = 'auto' | 'openai' | 'anthropic';

interface SettingsData {
  caveman: { level: CavemanLevel } | null;
  caching: { autoBreakpoints: boolean } | null;
  rtk: { enabled: boolean } | null;
  minimax: { upstreamFormat?: UpstreamFormat } | null;
  version: string | null;
}

// Server returns null for never-written keys (audit/debuggability — see
// A7 in the 2026-06-19 audit plan). Merge client-side so UI behaves identically
// regardless of whether the row is seeded or user-saved.
const SETTINGS_DEFAULTS = {
  caveman: { level: 'off' },
  caching: { autoBreakpoints: true },
  rtk: { enabled: true },
  minimax: {} as { upstreamFormat?: UpstreamFormat },
} as const;

function PasswordForm({ onSubmit }: { onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (pw.length < 4) {
          setErr('Password must be at least 4 characters.');
          return;
        }
        if (pw !== confirm) {
          setErr('Passwords do not match.');
          return;
        }
        onSubmit(pw);
      }}
    >
      <label htmlFor="pw-new" class="sr-only">
        New password
      </label>
      <input
        id="pw-new"
        type="password"
        value={pw}
        onInput={(e) => setPw((e.target as HTMLInputElement).value)}
        placeholder="New password (min 4)…"
        minLength={4}
        required
        aria-label="New password"
        autoComplete="new-password"
        spellcheck={false}
        class="input"
      />
      <label htmlFor="pw-confirm" class="sr-only">
        Confirm password
      </label>
      <input
        id="pw-confirm"
        type="password"
        value={confirm}
        onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        placeholder="Confirm password…"
        required
        aria-label="Confirm password"
        aria-invalid={!!err}
        aria-describedby={err ? 'pw-error' : undefined}
        autoComplete="new-password"
        spellcheck={false}
        class="input"
        style={{ marginTop: 8 }}
      />
      {err && (
        <p
          id="pw-error"
          role="alert"
          aria-live="assertive"
          style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}
        >
          {err}
        </p>
      )}
      <Button type="submit" style={{ marginTop: 8 }}>
        Set password
      </Button>
    </form>
  );
}

export function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<SettingsData>('/api/admin/settings'),
  });
  const cavemanMut = useMutation({
    mutationFn: (level: string) =>
      apiFetch('/api/admin/settings/caveman', { method: 'POST', json: { level } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rtkMut = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/admin/settings/rtk', { method: 'POST', json: { enabled } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cachingMut = useMutation({
    mutationFn: (autoBreakpoints: boolean) =>
      apiFetch('/api/admin/settings/caching', { method: 'POST', json: { autoBreakpoints } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const minimaxMut = useMutation({
    mutationFn: (b: object) => apiFetch('/api/admin/settings/minimax', { method: 'POST', json: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pwMut = useMutation({
    mutationFn: (b: { action: string; password?: string }) =>
      apiFetch('/api/admin/settings/password', { method: 'POST', json: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      // SecurityBanner (AppShell) reads this; invalidate so the banner
      // updates immediately when a password is set or removed.
      qc.invalidateQueries({ queryKey: ['security-status'] });
      toast.success('Updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isError)
    return (
      <>
        <TopBar title="Settings" />
        <ErrorState error={error as Error} onRetry={() => refetch()} />
      </>
    );

  if (isLoading || !data)
    return (
      <>
        <TopBar title="Settings" />
        <div class="surface module--active">
          <div class="card-head">
            <div class="card-head-text">
              <span class="card-eyebrow">SETTINGS</span>
              <h2 class="card-title">Loading</h2>
            </div>
          </div>
          <div class="specsheet" aria-hidden="true">
            <div class="specsheet-row">
              <span class="specsheet-label">reading config</span>
              <span class="specsheet-value skeleton-cell" style={{ width: 120 }} />
            </div>
          </div>
        </div>
      </>
    );

  // Server returns null for never-written keys; merge with client defaults.
  const merged = {
    caveman: data.caveman ?? SETTINGS_DEFAULTS.caveman,
    caching: data.caching ?? SETTINGS_DEFAULTS.caching,
    rtk: data.rtk ?? SETTINGS_DEFAULTS.rtk,
    minimax: data.minimax ?? SETTINGS_DEFAULTS.minimax,
  };

  const cavemanLevel = merged.caveman.level;
  const rtkOn = merged.rtk.enabled;
  const cacheOn = merged.caching.autoBreakpoints;
  const mmFormat = merged.minimax.upstreamFormat ?? 'auto';

  return (
    <>
      <TopBar
        title={
          <>
            Set<em>tings</em>
          </>
        }
        eyebrow="Router configuration"
      />
      <Card eyebrow="SETTINGS" title="Dashboard access" sub="Set or change the dashboard password.">
        <PasswordForm onSubmit={(p) => pwMut.mutate({ action: 'set', password: p })} />
        <button
          type="button"
          class="btn btn-danger btn-sm"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const ok = await confirmDialog({
              title: 'Remove password',
              message:
                'Remove dashboard password? The dashboard will be open to anyone with network access.',
              confirmLabel: 'Remove',
              danger: true,
            });
            if (ok) pwMut.mutate({ action: 'remove' });
          }}
        >
          Remove password
        </button>
      </Card>

      <Card eyebrow="ROUTER" title="Request shaping" sub="Toggles applied to every proxy request.">
        <div class="specsheet">
          <div class="specsheet-row">
            <span class="specsheet-label">CAVEMAN MODE</span>
            <span class="specsheet-value">
              <label htmlFor="caveman-mode" class="sr-only">
                Caveman mode level
              </label>
              <select
                id="caveman-mode"
                value={cavemanLevel}
                onChange={(e) => cavemanMut.mutate((e.target as HTMLSelectElement).value)}
                class="input"
                disabled={cavemanMut.isPending}
              >
                <option value="off">off</option>
                <option value="terse">terse</option>
                <option value="ultra">ultra</option>
              </select>
            </span>
          </div>
          <div class="specsheet-row">
            <span class="specsheet-label">RTK COMPRESSION</span>
            <span class="specsheet-value">
              <span
                class={`dot ${rtkOn ? 'dot--active' : 'dot--idle'}`}
                aria-hidden="true"
                style={{ marginRight: 6 }}
              />
              <Switch
                checked={rtkOn}
                onChange={(v) => rtkMut.mutate(v)}
                label={rtkOn ? 'enabled' : 'disabled'}
              />
            </span>
          </div>
          <div class="specsheet-row">
            <span class="specsheet-label">PROMPT CACHING</span>
            <span class="specsheet-value">
              <span
                class={`dot ${cacheOn ? 'dot--active' : 'dot--idle'}`}
                aria-hidden="true"
                style={{ marginRight: 6 }}
              />
              <Switch
                checked={cacheOn}
                onChange={(v) => cachingMut.mutate(v)}
                label={cacheOn ? 'enabled' : 'disabled'}
              />
            </span>
          </div>
        </div>
      </Card>

      <Card eyebrow="MINIMAX" title="Provider routing" sub="Cross-format routing + M3 defaults.">
        <label
          htmlFor="minimax-format"
          class="specsheet-row"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
        >
          <span class="specsheet-label">UPSTREAM FORMAT</span>
          <select
            id="minimax-format"
            value={mmFormat}
            onChange={(e) =>
              minimaxMut.mutate({ upstreamFormat: (e.target as HTMLSelectElement).value })
            }
            class="input"
          >
            <option value="auto">auto</option>
            <option value="openai">always openai</option>
            <option value="anthropic">always anthropic</option>
          </select>
        </label>
      </Card>
    </>
  );
}
