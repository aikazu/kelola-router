import { Button } from './Button';

interface KiroAutoImportFormProps {
  status: 'idle' | 'loading' | 'found' | 'error';
  token: string;
  source: string;
  error: string;
  label: string;
  onLabelChange: (label: string) => void;
  isPending: boolean;
  onAutoImport: () => void;
  onSave: () => void;
}

export function KiroAutoImportForm({
  status,
  token,
  source,
  error,
  label,
  onLabelChange,
  isPending,
  onAutoImport,
  onSave,
}: KiroAutoImportFormProps) {
  if (status === 'loading') {
    return (
      <p style={{ color: 'var(--text-2)', textAlign: 'center', padding: 16 }}>
        Scanning AWS SSO cache…
      </p>
    );
  }

  if (status === 'found') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            background: 'var(--ink-2)',
            border: '1px solid var(--success)',
            borderRadius: 6,
            padding: 12,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--success)', fontWeight: 600 }}>
            ✓ Token detected
          </span>
          <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 8 }}>from {source}</span>
        </div>
        <label>
          Label{' '}
          <input
            value={label}
            onInput={(e) => onLabelChange((e.target as HTMLInputElement).value)}
            placeholder="kiro-auto"
            class="input"
          />
        </label>
        <Button onClick={onSave} disabled={isPending}>
          {isPending ? 'Importing…' : 'Import this token'}
        </Button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>
        <Button onClick={onAutoImport} size="sm">
          Retry
        </Button>
      </div>
    );
  }

  // idle
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
        Auto-detect refresh token from Kiro IDE's AWS SSO cache (<code>~/.aws/sso/cache/</code>).
      </p>
      <Button onClick={onAutoImport}>Scan for Kiro token</Button>
    </div>
  );
}
