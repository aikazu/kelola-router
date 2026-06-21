import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { useToast } from '../components/ToastProvider';
import { type ApiError, apiFetch } from '../lib/api';

export function Login() {
  const [pw, setPw] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const loginMut = useMutation({
    mutationFn: (password: string) =>
      apiFetch<{ authed: boolean }>('/api/login', { method: 'POST', json: { password } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      location.hash = '/admin';
    },
    onError: (e: unknown) => {
      const err = e as ApiError;
      const msg = err.retryAfterMs
        ? `Too many attempts. Try again in ${Math.ceil(err.retryAfterMs / 1000)} seconds.`
        : 'Incorrect password.';
      setErrMsg(msg);
      toast.error(msg);
    },
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--obsidian)',
        padding: 24,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErrMsg(null);
          loginMut.mutate(pw);
        }}
        class="surface module--active"
        style={{
          maxWidth: 360,
          width: '100%',
          padding: '28px 28px 32px',
        }}
      >
        <div class="card-head" style={{ marginBottom: 20 }}>
          <div class="card-head-text">
            <span class="card-eyebrow">KELOLA-ROUTER</span>
            <div class="card-title">Sign in</div>
          </div>
        </div>

        {errMsg && (
          <div
            role="alert"
            aria-live="assertive"
            id="login-error"
            class="card-sub"
            style={{
              color: 'var(--crit)',
              marginBottom: 16,
              paddingLeft: 10,
              borderLeft: '2px solid var(--crit)',
            }}
          >
            {errMsg}
          </div>
        )}

        <label
          htmlFor="login-password"
          class="card-eyebrow"
          style={{ marginBottom: 8, color: 'var(--ink-dim)' }}
        >
          PASSWORD
        </label>
        <input
          id="login-password"
          type="password"
          value={pw}
          onInput={(e) => setPw((e.target as HTMLInputElement).value)}
          aria-label="Password"
          aria-invalid={!!errMsg}
          aria-describedby={errMsg ? 'login-error' : undefined}
          autoComplete="current-password"
          spellcheck={false}
          required
          class="input"
          style={{ width: '100%', marginBottom: 16, fontFamily: 'var(--font-mono)' }}
        />
        <button
          type="submit"
          class="btn"
          disabled={!pw || loginMut.isPending}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loginMut.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
