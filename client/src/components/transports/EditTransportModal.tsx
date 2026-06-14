import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { useToast } from '../ToastProvider';
import { apiFetch } from '../../lib/api';
import type { Transport } from './types';

interface EditTransportModalProps {
  transport: Transport | null;
  onClose: () => void;
}

/**
 * Edit-transport modal. Receives the transport being edited (or null) via props.
 * The parent MUST key this component by `transport?.id` so it remounts with
 * fresh `editForm` state whenever a different row is being edited.
 */
export function EditTransportModal({ transport, onClose }: EditTransportModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editForm, setEditForm] = useState({
    label: transport?.label ?? '',
    url: transport?.url ?? '',
    kind: transport?.kind ?? '',
  });

  const editMut = useMutation({
    mutationFn: ({ id, ...fields }: { id: string; label?: string; url?: string; kind?: string }) =>
      apiFetch(`/api/admin/transports/${id}`, { method: 'PATCH', json: fields }),
    onSuccess: () => {
      onClose();
      qc.invalidateQueries({ queryKey: ['transports'] });
      toast.success('Transport updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal
      open={!!transport}
      onClose={onClose}
      title={`Edit "${transport?.label ?? ''}"`}
      footer={
        <Button
          onClick={() => {
            if (!transport) return;
            const payload: Record<string, string> = {};
            if (editForm.label !== transport.label) payload.label = editForm.label;
            if (editForm.url !== transport.url) payload.url = editForm.url;
            if (editForm.kind !== transport.kind) payload.kind = editForm.kind;
            editMut.mutate({ id: transport.id, ...payload });
          }}
          disabled={editMut.isPending}
        >
          {editMut.isPending ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Label
          <input value={editForm.label} onInput={(e) => setEditForm({ ...editForm, label: (e.target as HTMLInputElement).value })} class="input" />
        </label>
        <label>
          Kind
          <select value={editForm.kind} onChange={(e) => setEditForm({ ...editForm, kind: (e.target as HTMLSelectElement).value })} class="input">
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
            <option value="vercel">Vercel</option>
            <option value="cloudflare">Cloudflare</option>
          </select>
        </label>
        <label>
          URL
          <input value={editForm.url} onInput={(e) => setEditForm({ ...editForm, url: (e.target as HTMLInputElement).value })} class="input" placeholder="http://user:pass@ip:port" />
        </label>
      </div>
    </Modal>
  );
}
