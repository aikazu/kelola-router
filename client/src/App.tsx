import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AppShell } from "./layout/AppShell";
import { ToastProvider } from "./components/ToastProvider";
import { ConfirmHost } from "./components/Confirm";

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
