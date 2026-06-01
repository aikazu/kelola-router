import { createContext } from "preact";
import { useCallback, useContext, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { ToastView, type ToastItem, type ToastVariant } from "./Toast";

interface ToastContext {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}
const Ctx = createContext<ToastContext | null>(null);

export function useToast(): ToastContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev.slice(-4), { id, message, variant }]);
    setTimeout(() => {
      setItems(prev => prev.filter(i => i.id !== id));
    }, 3000);
  }, []);
  const ctx: ToastContext = {
    success: (m) => add(m, "success"),
    error: (m) => add(m, "error"),
    info: (m) => add(m, "info"),
  };
  return (
    <Ctx.Provider value={ctx}>
      {children}
      <div class="toast-stack">
        {items.map(i => <ToastView key={i.id} item={i} />)}
      </div>
    </Ctx.Provider>
  );
}
