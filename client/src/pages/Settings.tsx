import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Switch } from '../components/Switch';
import { useToast } from '../components/ToastProvider';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';

interface SettingsData {
  caveman: { level: string };
  caching: { autoBreakpoints: boolean };
  rtk: { enabled: boolean };
  minimax: { upstreamFormat?: string };
}

const inputStyle: any = {
  width: '100%',
  marginTop: 6,
  padding: '8px 10px',
  background: 'var(--ink-1)',
  border: '1px solid var(--ink-3)',
  color: 'var(--text-1)',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 13,
};

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
          setErr('Password minimal 4 karakter.');
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
        style={inputStyle}
      />
      <input
        type="password"
        value={confirm}
        onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        placeholder="Confirm password"
        required
        aria-label="Confirm password"
        aria-invalid={!!err}
        style={{ ...inputStyle, marginTop: 8 }}
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
  const { data, isLoading } = useQuery({
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
  });
  const rtkMut = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/admin/settings/rtk', { method: 'POST', json: { enabled } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
  });
  const cachingMut = useMutation({
    mutationFn: (autoBreakpoints: boolean) =>
      apiFetch('/api/admin/settings/caching', { method: 'POST', json: { autoBreakpoints } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
  });
  const minimaxMut = useMutation({
    mutationFn: (b: object) => apiFetch('/api/admin/settings/minimax', { method: 'POST', json: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved');
    },
  });
  const pwMut = useMutation({
    mutationFn: (b: { action: string; password?: string }) =>
      apiFetch('/api/admin/settings/password', { method: 'POST', json: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Updated');
    },
  });

  if (isLoading || !data)
    return (
      <>
        <TopBar title="Settings" />
        <p style={{ color: 'var(--text-3)' }}>Loading…</p>
      </>
    );

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
      </Card>
      <Card title="Caveman mode" sub="Injects a terse system prompt to force concise output.">
        <select
          value={data.caveman.level}
          onChange={(e) => cavemanMut.mutate((e.target as HTMLSelectElement).value)}
          style={inputStyle}
        >
          <option value="off">Off</option>
          <option value="terse">Terse</option>
          <option value="ultra">Ultra</option>
        </select>
      </Card>
      <Card title="RTK compression" sub="Token-saving compression on messages before forwarding.">
        <Switch
          checked={data.rtk.enabled}
          onChange={(v) => rtkMut.mutate(v)}
          label={data.rtk.enabled ? 'Enabled' : 'Disabled'}
        />
      </Card>
      <Card
        title="Prompt caching"
        sub="Auto-inject dual cache_control breakpoints on Anthropic system prompts."
      >
        <Switch
          checked={data.caching.autoBreakpoints}
          onChange={(v) => cachingMut.mutate(v)}
          label={data.caching.autoBreakpoints ? 'Enabled' : 'Disabled'}
        />
      </Card>
      <Card title="MiniMax provider" sub="Cross-format routing + M3 defaults.">
        <label>
          Upstream format override
          <select
            value={data.minimax.upstreamFormat ?? 'auto'}
            onChange={(e) =>
              minimaxMut.mutate({ upstreamFormat: (e.target as HTMLSelectElement).value })
            }
            style={inputStyle}
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
