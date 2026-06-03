import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
  width?: number;
}

export function Modal({ open, onClose, title, children, footer, width }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal" style={width ? { maxWidth: `${width}px` } : undefined}>
        <div class="modal-header">
          <div class="modal-title">{title}</div>
          <button class="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div class="modal-body">{children}</div>
        {footer && <div class="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
