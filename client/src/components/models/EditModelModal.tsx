import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/api';
import { Button } from '../Button';
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
  }, [model?.name]);

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
        <label>
          Display name
          <input
            class="input"
            value={displayName}
            onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Context window (in)
          <input
            class="input"
            type="number"
            value={contextWindow}
            onInput={(e) => setContextWindow((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Context output (out)
          <input
            class="input"
            type="number"
            value={contextOutput}
            onInput={(e) => setContextOutput((e.target as HTMLInputElement).value)}
          />
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>
            Pricing in $/M
            <input
              class="input"
              type="number"
              value={pricingInput}
              onInput={(e) => setPricingInput((e.target as HTMLInputElement).value)}
            />
          </label>
          <label style={{ flex: 1 }}>
            Pricing out $/M
            <input
              class="input"
              type="number"
              value={pricingOutput}
              onInput={(e) => setPricingOutput((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
