import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { useToast } from '../ToastProvider';
import type { AddModelForm, Provider } from './types';

const EMPTY_FORM: AddModelForm = {
  name: '',
  displayName: '',
  contextWindow: '',
  pricingInput: '',
  pricingOutput: '',
};

interface AddModelModalProps {
  open: boolean;
  onClose: () => void;
  provider: Provider;
}

/**
 * Add-model modal. Owns its form state + create mutation. On success it
 * closes the modal and clears the form; on cancel the form persists across
 * open/close cycles (mirrors the original single-state-atom behavior).
 *
 * Extracted verbatim from the Add modal JSX in Models.tsx — no behavior or
 * className changes.
 */
export function AddModelModal({ open, onClose, provider }: AddModelModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<AddModelForm>(EMPTY_FORM);

  const addMut = useMutation({
    mutationFn: (p: Provider) =>
      apiFetch('/api/admin/models', {
        method: 'POST',
        json: {
          name: form.name.trim(),
          provider: p,
          displayName: form.displayName.trim() || undefined,
          contextWindow: form.contextWindow ? Number(form.contextWindow) : undefined,
          pricingInput: form.pricingInput ? Number(form.pricingInput) : undefined,
          pricingOutput: form.pricingOutput ? Number(form.pricingOutput) : undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model added');
      onClose();
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${
        provider === 'kiro'
          ? 'Kiro'
          : provider === 'pioneer'
            ? 'Pioneer'
            : provider === 'codebuddy'
              ? 'CodeBuddy'
              : provider === 'zai'
                ? 'Z.AI'
                : 'MiniMax'
      } model`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => addMut.mutate(provider)}
            disabled={addMut.isPending || !form.name.trim()}
          >
            {addMut.isPending ? 'Adding…' : 'Add model'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>
          Model name
          <input
            class="input"
            value={form.name}
            onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
            placeholder="exact upstream model id"
          />
        </label>
        <label>
          Display name (optional)
          <input
            class="input"
            value={form.displayName}
            onInput={(e) => setForm({ ...form, displayName: (e.target as HTMLInputElement).value })}
          />
        </label>
        <label>
          Context window (optional)
          <input
            class="input"
            type="number"
            value={form.contextWindow}
            onInput={(e) =>
              setForm({ ...form, contextWindow: (e.target as HTMLInputElement).value })
            }
          />
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>
            Pricing in $/M (optional)
            <input
              class="input"
              type="number"
              value={form.pricingInput}
              onInput={(e) =>
                setForm({ ...form, pricingInput: (e.target as HTMLInputElement).value })
              }
            />
          </label>
          <label style={{ flex: 1 }}>
            Pricing out $/M (optional)
            <input
              class="input"
              type="number"
              value={form.pricingOutput}
              onInput={(e) =>
                setForm({ ...form, pricingOutput: (e.target as HTMLInputElement).value })
              }
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
