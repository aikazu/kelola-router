import { useState } from 'react';
import { apiFetch } from '../lib/api';

/**
 * Notion 3-step login orchestrator.
 *
 * Step 1: requestOtp(email) → posts email to Notion, sends 6-char temp password
 * Step 2: user enters code from email
 * Step 3: verifyOtp(email, code, label) → exchanges code for cookies, creates account
 *
 * On success calls onSuccess() to close the modal. Errors are surfaced via
 * the `error` state.
 */
export type NotionAuthStep = 'idle' | 'otp_sent' | 'verifying' | 'done' | 'error';

export interface UseNotionAuthOpts {
  email: string;
  label: string;
  onSuccess: () => void;
}

export interface UseNotionAuthReturn {
  step: NotionAuthStep;
  error: string | null;
  requestOtp: () => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  reset: () => void;
}

export function useNotionAuth(opts: UseNotionAuthOpts): UseNotionAuthReturn {
  const [step, setStep] = useState<NotionAuthStep>('idle');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('idle');
    setError(null);
  };

  const requestOtp = async () => {
    setError(null);
    setStep('otp_sent');
    try {
      await apiFetch<{ status: string; hasAccount: boolean }>(
        '/api/admin/accounts/notion/request-otp',
        { method: 'POST', json: { email: opts.email } }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  const verifyOtp = async (code: string) => {
    setError(null);
    setStep('verifying');
    try {
      await apiFetch<{ status: string; id: string }>('/api/admin/accounts/notion/verify-otp', {
        method: 'POST',
        json: { email: opts.email, code, label: opts.label },
      });
      setStep('done');
      opts.onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  };

  return { step, error, requestOtp, verifyOtp, reset };
}
