import { useState } from 'preact/hooks';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

let pending: ((ok: boolean) => void) | null = null;
let opts: ConfirmOpts | null = null;
const listeners = new Set<() => void>();

export function confirmDialog(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    pending = resolve;
    opts = o;
    listeners.forEach((l) => l());
  });
}

export function ConfirmHost() {
  const [, force] = useState(0);
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  subscribe(() => force((x) => x + 1));

  const open = pending !== null && opts !== null;
  const close = (ok: boolean) => {
    if (pending) pending(ok);
    pending = null;
    opts = null;
    force((x) => x + 1);
  };

  if (!open || !opts) return null;
  return (
    <Modal
      open
      onClose={() => close(false)}
      title={opts.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={opts.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {opts.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)' }}>{opts.message}</p>
    </Modal>
  );
}
