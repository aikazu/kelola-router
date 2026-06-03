import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../components/Button';
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
        ? `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(err.retryAfterMs / 1000)} detik.`
        : 'Password salah.';
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
        background: 'var(--canvas)',
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErrMsg(null);
          loginMut.mutate(pw);
        }}
        style={{
          position: 'relative',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-strong)',
          borderRadius: 6,
          padding: 40,
          width: 372,
          boxShadow: '0 28px 70px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'var(--gold)',
          }}
        />
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 34,
            fontWeight: 400,
            textAlign: 'center',
            marginBottom: 6,
            letterSpacing: '-0.01em',
          }}
        >
          kelola
          <em style={{ fontStyle: 'italic', fontWeight: 300, color: 'var(--gold)' }}>router</em>
        </div>
        <div
          style={{
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginBottom: 28,
          }}
        >
          Restricted access
        </div>
        {errMsg && (
          <div
            role="alert"
            aria-live="assertive"
            id="login-error"
            style={{
              color: 'var(--alert)',
              fontSize: 12,
              marginBottom: 12,
              padding: 9,
              background: 'rgba(210,122,110,0.12)',
              border: '1px solid rgba(210,122,110,0.3)',
              borderRadius: 4,
            }}
          >
            {errMsg}
          </div>
        )}
        <label
          htmlFor="login-password"
          style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
            marginBottom: 6,
          }}
        >
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={pw}
          onInput={(e) => setPw((e.target as HTMLInputElement).value)}
          aria-label="Password"
          aria-invalid={!!errMsg}
          aria-describedby={errMsg ? 'login-error' : undefined}
          autoFocus
          required
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-1)',
            borderRadius: 3,
            marginBottom: 16,
            fontFamily: 'inherit',
            fontSize: 14,
          }}
        />
        <Button type="submit" disabled={!pw || loginMut.isPending} style={{ width: '100%' }}>
          {loginMut.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
