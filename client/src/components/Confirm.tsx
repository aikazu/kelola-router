import { useSyncExternalStore } from 'preact/compat';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  pending: ((ok: boolean) => void) | null;
  opts: ConfirmOpts | null;
}

let state: ConfirmState = { pending: null, opts: null };
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function confirmDialog(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    state = { pending: resolve, opts: o };
    emit();
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): ConfirmState {
  return state;
}

export function ConfirmHost() {
  // useSyncExternalStore scopes re-renders to ConfirmHost only — no more
  // global re-render of the entire App tree on every confirmDialog() call.
  const s = useSyncExternalStore(subscribe, getSnapshot);

  const open = s.pending !== null && s.opts !== null;
  const close = (ok: boolean) => {
    if (s.pending) s.pending(ok);
    state = { pending: null, opts: null };
    emit();
  };

  if (!open || !s.opts) return null;
  return (
    <Modal
      open
      onClose={() => close(false)}
      title={s.opts.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={s.opts.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {s.opts.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)' }}>{s.opts.message}</p>
    </Modal>
  );
}
