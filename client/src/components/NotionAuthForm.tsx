import { useNotionAuth } from '../hooks/useNotionAuth';
import { Button } from './Button';

interface NotionAuthFormProps {
  email: string;
  onEmailChange: (email: string) => void;
  label: string;
  onLabelChange: (label: string) => void;
  onSuccess: () => void;
}

/**
 * 3-step Notion login form.
 *
 * Renders one field at a time:
 *   1. Email + label → "Send code" button → triggers requestOtp
 *   2. Code input → "Verify" button → triggers verifyOtp
 *   3. Success → onSuccess callback (closes modal, refreshes account list)
 *
 * Errors shown inline. No tokens/cookies ever rendered in DOM.
 */
export function NotionAuthForm({
  email,
  onEmailChange,
  label,
  onLabelChange,
  onSuccess,
}: NotionAuthFormProps) {
  const { step, error, requestOtp, verifyOtp } = useNotionAuth({
    email,
    label,
    onSuccess,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>
        Email
        <input
          type="email"
          name="email"
          autocomplete="email"
          value={email}
          onInput={(e) => onEmailChange((e.target as HTMLInputElement).value)}
          placeholder="you@example.com"
          disabled={step !== 'idle' && step !== 'error'}
          class="input"
        />
      </label>
      <label>
        Label
        <input
          value={label}
          onInput={(e) => onLabelChange((e.target as HTMLInputElement).value)}
          placeholder="personal"
          disabled={step !== 'idle' && step !== 'error'}
          class="input"
        />
      </label>

      {step === 'idle' || step === 'error' ? (
        <Button onClick={requestOtp} disabled={!email || !label}>
          Send code to email
        </Button>
      ) : null}

      {step === 'otp_sent' ? (
        <>
          <div
            style={{
              background: 'var(--ink-2)',
              border: '1px solid var(--success)',
              borderRadius: 6,
              padding: 12,
            }}
          >
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Code sent</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 8 }}>
              Check {email} inbox
            </span>
          </div>
          <label>
            6-character code from email
            <input
              name="otp"
              inputMode="numeric"
              pattern="[0-9]*"
              value=""
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v.length === 6) verifyOtp(v);
              }}
              placeholder="hdqiGs"
              maxLength={6}
              class="input"
            />
          </label>
        </>
      ) : null}

      {step === 'verifying' ? (
        <p style={{ color: 'var(--text-2)', textAlign: 'center', padding: 16 }}>Verifying…</p>
      ) : null}

      {error ? (
        <div
          style={{
            background: 'var(--ink-2)',
            border: '1px solid var(--error)',
            borderRadius: 6,
            padding: 12,
            color: 'var(--error)',
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
