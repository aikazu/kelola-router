import { QueryClientProvider } from '@tanstack/react-query';
import { ConfirmHost } from './components/Confirm';
import { ToastProvider } from './components/ToastProvider';
import { AppShell } from './layout/AppShell';
import { queryClient } from './lib/queryClient';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppShell />
        <ConfirmHost />
      </ToastProvider>
    </QueryClientProvider>
  );
}
