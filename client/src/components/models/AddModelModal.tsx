import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { Button } from '../Button';
import { Field } from '../Field';
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
                : provider === 'tabi'
                  ? 'TabiToken'
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
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Field
          id="add-model-name"
          label="Model name"
          type="text"
          name="modelName"
          autocomplete="off"
          value={form.name}
          onInput={(v) => setForm({ ...form, name: v })}
          placeholder="exact upstream model id"
        />
        <Field
          id="add-model-display-name"
          label="Display name (optional)"
          type="text"
          name="displayName"
          autocomplete="off"
          value={form.displayName}
          onInput={(v) => setForm({ ...form, displayName: v })}
        />
        <Field
          id="add-model-context-window"
          label="Context window (optional)"
          type="number"
          name="contextWindow"
          autocomplete="off"
          value={form.contextWindow}
          onInput={(v) => setForm({ ...form, contextWindow: v })}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <label htmlFor="add-model-pricing-input" style={{ flex: 1 }}>
            Pricing in $/M (optional)
            <input
              id="add-model-pricing-input"
              class="input"
              type="number"
              name="pricingInput"
              autoComplete="off"
              value={form.pricingInput}
              onInput={(e) =>
                setForm({ ...form, pricingInput: (e.target as HTMLInputElement).value })
              }
            />
          </label>
          <label htmlFor="add-model-pricing-output" style={{ flex: 1 }}>
            Pricing out $/M (optional)
            <input
              id="add-model-pricing-output"
              class="input"
              type="number"
              name="pricingOutput"
              autoComplete="off"
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
