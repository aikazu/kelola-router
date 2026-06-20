import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { Button } from '../Button';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { useToast } from '../ToastProvider';
import type { Model } from './types';

interface EditModelModalProps {
  model: Model | null;
  onClose: () => void;
}

export function EditModelModal({ model, onClose }: EditModelModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(model?.displayName ?? '');
  const [contextWindow, setContextWindow] = useState(
    model?.contextWindow != null ? String(model.contextWindow) : ''
  );
  const [contextOutput, setContextOutput] = useState(
    model?.contextOutput != null ? String(model.contextOutput) : ''
  );
  const [pricingInput, setPricingInput] = useState(
    model?.pricingInput != null ? String(model.pricingInput) : ''
  );
  const [pricingOutput, setPricingOutput] = useState(
    model?.pricingOutput != null ? String(model.pricingOutput) : ''
  );

  // Reset form when the target model changes (defensive — the parent passes a fresh
  // object per open, but reset explicitly so the modal stays correct if the lifecycle
  // ever stops unmounting it).
  useEffect(() => {
    if (!model) return;
    setDisplayName(model.displayName ?? '');
    setContextWindow(model.contextWindow != null ? String(model.contextWindow) : '');
    setContextOutput(model.contextOutput != null ? String(model.contextOutput) : '');
    setPricingInput(model.pricingInput != null ? String(model.pricingInput) : '');
    setPricingOutput(model.pricingOutput != null ? String(model.pricingOutput) : '');
  }, [model]);

  const editMut = useMutation({
    mutationFn: () => {
      if (!model) throw new Error('no model');
      return apiFetch(`/api/admin/models/${encodeURIComponent(model.name)}`, {
        method: 'PATCH',
        json: {
          displayName: displayName.trim() || null,
          contextWindow: contextWindow ? Number(contextWindow) : null,
          contextOutput: contextOutput ? Number(contextOutput) : null,
          pricingInput: pricingInput ? Number(pricingInput) : null,
          pricingOutput: pricingOutput ? Number(pricingOutput) : null,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model updated');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!model) return null;

  return (
    <Modal
      open={model !== null}
      onClose={onClose}
      title={`Edit ${model.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => editMut.mutate()} disabled={editMut.isPending}>
            {editMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field
          id="edit-model-display-name"
          label="Display name"
          type="text"
          name="displayName"
          autocomplete="off"
          value={displayName}
          onInput={(v) => setDisplayName(v)}
        />
        <Field
          id="edit-model-context-window"
          label="Context window (in)"
          type="number"
          name="contextWindow"
          autocomplete="off"
          value={contextWindow}
          onInput={(v) => setContextWindow(v)}
        />
        <Field
          id="edit-model-context-output"
          label="Context output (out)"
          type="number"
          name="contextOutput"
          autocomplete="off"
          value={contextOutput}
          onInput={(v) => setContextOutput(v)}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <label htmlFor="edit-model-pricing-input" style={{ flex: 1 }}>
            Pricing in $/M
            <input
              id="edit-model-pricing-input"
              class="input"
              type="number"
              name="pricingInput"
              autoComplete="off"
              value={pricingInput}
              onInput={(e) => setPricingInput((e.target as HTMLInputElement).value)}
            />
          </label>
          <label htmlFor="edit-model-pricing-output" style={{ flex: 1 }}>
            Pricing out $/M
            <input
              id="edit-model-pricing-output"
              class="input"
              type="number"
              name="pricingOutput"
              autoComplete="off"
              value={pricingOutput}
              onInput={(e) => setPricingOutput((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
