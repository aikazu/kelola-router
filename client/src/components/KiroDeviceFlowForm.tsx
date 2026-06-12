import { Button } from './Button';
import type { DeviceCodeData } from '../lib/types';

interface KiroDeviceFlowFormProps {
  deviceStep: 'idle' | 'loading' | 'code' | 'polling' | 'success' | 'error';
  deviceData: DeviceCodeData | null;
  deviceError: string;
  kiroMethod: 'builder-id' | 'idc' | 'token' | 'auto-import';
  kiroLabel: string;
  kiroStartUrl: string;
  kiroRegion: string;
  onLabelChange: (label: string) => void;
  onStartUrlChange: (url: string) => void;
  onRegionChange: (region: string) => void;
  onStartDeviceCode: () => void;
  onStartPolling: () => void;
}

export function KiroDeviceFlowForm({
  deviceStep,
  deviceData,
  deviceError,
  kiroMethod,
  kiroLabel,
  kiroStartUrl,
  kiroRegion,
  onLabelChange,
  onStartUrlChange,
  onRegionChange,
  onStartDeviceCode,
  onStartPolling,
}: KiroDeviceFlowFormProps) {
  if (deviceStep === 'loading') {
    return <p style={{ color: 'var(--text-2)', textAlign: 'center', padding: 16 }}>Registering with AWS SSO…</p>;
  }

  if (deviceStep === 'code' || deviceStep === 'polling') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', padding: '8px 0' }}>
        <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
          Open the link below and enter this code:
        </p>
        <div style={{ background: 'var(--ink-2)', border: '2px solid var(--gold)', borderRadius: 8, padding: '12px 24px', fontSize: 24, fontFamily: 'var(--font-mono)', letterSpacing: 4, fontWeight: 700 }}>
          {deviceData?.userCode}
        </div>
        <a
          href={deviceData?.verificationUriComplete || deviceData?.verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--gold)', fontSize: 13 }}
        >
          {deviceData?.verificationUri} ↗
        </a>
        {deviceStep === 'code' && (
          <Button onClick={onStartPolling} style={{ marginTop: 8 }}>
            I've entered the code
          </Button>
        )}
        {deviceStep === 'polling' && (
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 8 }}>
            ⏳ Waiting for authorization… (polling every {deviceData?.interval || 5}s)
          </p>
        )}
      </div>
    );
  }

  if (deviceStep === 'success') {
    return <p style={{ color: 'var(--success)', textAlign: 'center', padding: 16, fontWeight: 600 }}>✓ Account connected successfully!</p>;
  }

  if (deviceStep === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>{deviceError}</p>
        <Button onClick={onStartDeviceCode} size="sm">Retry</Button>
      </div>
    );
  }

  // idle — show config + start button
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>
        Label{' '}
        <input
          value={kiroLabel}
          onInput={(e) => onLabelChange((e.target as HTMLInputElement).value)}
          placeholder="kiro1"
          class="input"
        />
      </label>
      {kiroMethod === 'idc' && (
        <>
          <label>
            IDC Start URL <span style={{ color: 'var(--danger)' }}>*</span>
            <input
              value={kiroStartUrl}
              onInput={(e) => onStartUrlChange((e.target as HTMLInputElement).value)}
              placeholder="https://your-org.awsapps.com/start"
              class="input" style={{ fontFamily: 'var(--font-mono)' }}
            />
          </label>
          <label>
            Region
            <input
              value={kiroRegion}
              onInput={(e) => onRegionChange((e.target as HTMLInputElement).value)}
              placeholder="us-east-1"
              class="input"
            />
          </label>
        </>
      )}
      <Button
        onClick={onStartDeviceCode}
        disabled={kiroMethod === 'idc' && !kiroStartUrl.trim()}
      >
        {kiroMethod === 'builder-id' ? 'Login with AWS Builder ID' : 'Login with IAM Identity Center'}
      </Button>
    </div>
  );
}
