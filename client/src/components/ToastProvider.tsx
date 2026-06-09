import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type ToastItem, type ToastVariant, ToastView } from './Toast';

interface ToastContext {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}
const Ctx = createContext<ToastContext | null>(null);

export function useToast(): ToastContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const TOAST_TTL_MS = 3000;

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-4), { id, message, variant }]);
    const handle = setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
      timers.current.delete(id);
    }, TOAST_TTL_MS);
    timers.current.set(id, handle);
  }, []);

  // Memoize the ctx object so consumers don't re-render on every toast add/remove.
  const ctx = useMemo<ToastContext>(
    () => ({
      success: (m: string) => add(m, 'success'),
      error: (m: string) => add(m, 'error'),
      info: (m: string) => add(m, 'info'),
    }),
    [add]
  );
  return (
    <Ctx.Provider value={ctx}>
      {children}
      <div class="toast-stack" role="status" aria-live="polite">
        {items.map((i) => (
          <ToastView key={i.id} item={i} />
        ))}
      </div>
    </Ctx.Provider>
  );
}
