import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../Button';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { useToast } from '../ToastProvider';
import { apiFetch } from '../../lib/api';
import { PROXY_KINDS, RELAY_KINDS } from './types';

interface AddTransportModalProps {
  open: boolean;
  onClose: () => void;
}

/** "Add transport" modal. Owns its form state + create mutation. */
export function AddTransportModal({ open, onClose }: AddTransportModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<{ label: string; type: 'proxy' | 'relay'; kind: string; url: string }>({
    label: '',
    type: 'proxy',
    kind: 'http',
    url: '',
  });

  function resetForm() {
    setForm({ label: '', type: 'proxy', kind: 'http', url: '' });
  }

  const createMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/transports', { method: 'POST', json: form }),
    onSuccess: () => {
      onClose();
      resetForm();
      qc.invalidateQueries({ queryKey: ['transports'] });
      toast.success('Transport added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onTypeChange(type: 'proxy' | 'relay') {
    setForm({ ...form, type, kind: type === 'proxy' ? 'http' : 'vercel' });
  }

  const kindOptions = form.type === 'proxy' ? PROXY_KINDS : RELAY_KINDS;

  function handleClose() {
    onClose();
    resetForm();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add transport"
      footer={
        <Button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending || !form.label.trim() || !form.url.trim()}
        >
          {createMut.isPending ? 'Adding…' : 'Add'}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Type
          <select
            name="type"
            value={form.type}
            onChange={(e) => onTypeChange((e.target as HTMLSelectElement).value as 'proxy' | 'relay')}
            class="input"
          >
            <option value="proxy">Proxy (HTTP / SOCKS5)</option>
            <option value="relay">Relay (Vercel / Cloudflare)</option>
          </select>
        </label>
        <label>
          Kind
          <select
            name="kind"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: (e.target as HTMLSelectElement).value })}
            class="input"
          >
            {kindOptions.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <Field
          id="add-transport-label"
          label="Label"
          name="label"
          value={form.label}
          onInput={(v) => setForm({ ...form, label: v })}
          placeholder={form.type === 'proxy' ? 'home socks…' : 'vercel edge…'}
          autocomplete="off"
        />
        <label>
          URL
          <input
            name="url"
            value={form.url}
            onInput={(e) => setForm({ ...form, url: (e.target as HTMLInputElement).value })}
            placeholder={form.type === 'proxy' ? (form.kind === 'socks5' ? 'socks5://127.0.0.1:1080…' : 'http://user:pass@host:8080…') : 'https://your-relay.vercel.app/api…'}
            autocomplete="off"
            class="input" style={{ fontFamily: 'var(--font-mono, monospace)' }}
          />
          <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
            {form.type === 'relay'
              ? 'Relay endpoint that forwards using x-relay-target / x-relay-path headers.'
              : 'Proxy URL. Credentials may be embedded as user:pass@host.'}
          </span>
        </label>
      </div>
    </Modal>
  );
}
