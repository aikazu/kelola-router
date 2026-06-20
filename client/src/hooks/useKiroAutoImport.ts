import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'preact/hooks';
import { useToast } from '../components/ToastProvider';
import { apiFetch } from '../lib/api';

interface UseKiroAutoImportParams {
  label: string;
  onLabelChange: (label: string) => void;
  onSuccess: () => void;
}

export function useKiroAutoImport({ label, onLabelChange, onSuccess }: UseKiroAutoImportParams) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<'idle' | 'loading' | 'found' | 'error'>('idle');
  const [token, setToken] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');

  const doAutoImport = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await apiFetch<{
        found: boolean;
        refreshToken?: string;
        source?: string;
        error?: string;
      }>('/api/admin/accounts/kiro/auto-import');
      if (res.found && res.refreshToken) {
        setToken(res.refreshToken);
        setSource(res.source || '');
        setStatus('found');
      } else {
        setError(res.error || 'No token found');
        setStatus('error');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-import failed');
      setStatus('error');
    }
  }, [apiFetch]);

  const saveAutoImport = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/accounts/kiro', {
        method: 'POST',
        json: { label: label || 'kiro-auto', method: 'token', refreshToken: token },
      }),
    onSuccess: () => {
      setStatus('idle');
      setToken('');
      setSource('');
      setError('');
      onLabelChange('');
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account imported from Kiro IDE');
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reset = useCallback(() => {
    setStatus('idle');
    setToken('');
    setSource('');
    setError('');
  }, []);

  return {
    status,
    token,
    source,
    error,
    doAutoImport,
    saveAutoImport,
    isPending: saveAutoImport.isPending,
    reset,
  };
}
