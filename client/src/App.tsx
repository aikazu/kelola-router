import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'preact/hooks';
import { ConfirmHost } from './components/Confirm';
import { ToastProvider } from './components/ToastProvider';
import { AppShell } from './layout/AppShell';
import { apiFetch } from './lib/api';
import { queryClient } from './lib/query-client';

/** Prime the cache once at app start so Sidebar/Page see data without duplicate fetches. */
function PrimeCache() {
  const qc = useQueryClient();
  useEffect(() => {
    void qc.ensureQueryData({
      queryKey: ['me'],
      queryFn: () => apiFetch<{ authed: boolean; passwordSet: boolean }>('/api/me'),
      retry: false,
    });
    void qc.ensureQueryData({
      queryKey: ['settings'],
      queryFn: () => apiFetch<{ version: string | null }>('/api/admin/settings'),
      retry: false,
    });
  }, [qc]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrimeCache />
      <ToastProvider>
        <AppShell />
        <ConfirmHost />
      </ToastProvider>
    </QueryClientProvider>
  );
}
