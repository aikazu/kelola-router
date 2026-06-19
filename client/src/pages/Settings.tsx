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
      <input
        type="password"
        value={pw}
        onInput={(e) => setPw((e.target as HTMLInputElement).value)}
        placeholder="New password (min 4)"
        minLength={4}
        required
        aria-label="New password"
        class="input"
      />
      <input
        type="password"
        value={confirm}
        onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        placeholder="Confirm password"
        required
        aria-label="Confirm password"
        aria-invalid={!!err}
        class="input"
        style={{ marginTop: 8 }}
      />
      {err && (
        <p
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
        <p style={{ color: 'var(--text-3)' }}>Loading…</p>
      </>
    );

  // Server returns null for never-written keys; merge with client defaults.
  const merged = {
    caveman: data.caveman ?? SETTINGS_DEFAULTS.caveman,
    caching: data.caching ?? SETTINGS_DEFAULTS.caching,
    rtk: data.rtk ?? SETTINGS_DEFAULTS.rtk,
    minimax: data.minimax ?? SETTINGS_DEFAULTS.minimax,
  };

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
      <p class="card-sub">Toggles applied to every proxy request. Changes save immediately.</p>
      <Card title="Dashboard access" sub="Set or change the dashboard password.">
        <PasswordForm onSubmit={(p) => pwMut.mutate({ action: 'set', password: p })} />
        <button
          class="btn btn-danger btn-sm"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const ok = await confirmDialog({
              title: 'Remove password',
              message: 'Remove dashboard password? The dashboard will be open to anyone with network access.',
              confirmLabel: 'Remove',
              danger: true,
            });
            if (ok) pwMut.mutate({ action: 'remove' });
          }}
        >
          Remove password
        </button>
      </Card>
      <Card title="Caveman mode" sub="Injects a terse system prompt to force concise output.">
        <select
          value={merged.caveman.level}
          onChange={(e) => cavemanMut.mutate((e.target as HTMLSelectElement).value)}
          class="input"
          disabled={cavemanMut.isPending}
        >
          <option value="off">Off</option>
          <option value="terse">Terse</option>
          <option value="ultra">Ultra</option>
        </select>
      </Card>
      <Card title="RTK compression" sub="Token-saving compression on messages before forwarding.">
        <Switch
          checked={merged.rtk.enabled}
          onChange={(v) => rtkMut.mutate(v)}
          label={merged.rtk.enabled ? 'Enabled' : 'Disabled'}
        />
      </Card>
      <Card
        title="Prompt caching"
        sub="Auto-inject dual cache_control breakpoints on Anthropic system prompts."
      >
        <Switch
          checked={merged.caching.autoBreakpoints}
          onChange={(v) => cachingMut.mutate(v)}
          label={merged.caching.autoBreakpoints ? 'Enabled' : 'Disabled'}
        />
      </Card>
      <Card title="MiniMax provider" sub="Cross-format routing + M3 defaults.">
        <label>
          Upstream format override
          <select
            value={merged.minimax.upstreamFormat ?? 'auto'}
            onChange={(e) =>
              minimaxMut.mutate({ upstreamFormat: (e.target as HTMLSelectElement).value })
            }
            class="input"
          >
            <option value="auto">Auto</option>
            <option value="openai">Always OpenAI</option>
            <option value="anthropic">Always Anthropic</option>
          </select>
        </label>
      </Card>
    </>
  );
}
