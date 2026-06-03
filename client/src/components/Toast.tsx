export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

export function ToastView({ item }: { item: ToastItem }) {
  const icon = item.variant === 'success' ? '✓' : item.variant === 'error' ? '✕' : 'ℹ';
  return (
    <div class={`toast toast-${item.variant}`}>
      <span class="toast-icon">{icon}</span>
      <span>{item.message}</span>
    </div>
  );
}
