import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { useToast } from '../ToastProvider';
import { apiFetch } from '../../lib/api';

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
}

/** Bulk-import proxies modal. Owns bulk text / protocol / prefix / progress + import loop. */
export function BulkImportModal({ open, onClose }: BulkImportModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [bulkText, setBulkText] = useState('');
  const [bulkKind, setBulkKind] = useState<'http' | 'socks5'>('http');
  const [bulkPrefix, setBulkPrefix] = useState('proxy');
  const [bulkProgress, setBulkProgress] = useState<{ total: number; done: number; errors: number } | null>(null);

  function parseBulkLines(): string[] {
    return bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((line) => {
        const parts = line.split(':');
        if (parts.length === 4) {
          const [ip, port, user, pass] = parts;
          return `${bulkKind}://${user}:${pass}@${ip}:${port}`;
        }
        if (parts.length === 2 && !line.includes('//')) {
          return `${bulkKind}://${line}`;
        }
        if (line.includes('@')) {
          return `${bulkKind}://${line}`;
        }
        return line;
      });
  }

  async function runBulkImport() {
    const urls = parseBulkLines();
    if (!urls.length) return;
    setBulkProgress({ total: urls.length, done: 0, errors: 0 });
    let done = 0;
    let errors = 0;
    for (let i = 0; i < urls.length; i++) {
      try {
        await apiFetch('/api/admin/transports', {
          method: 'POST',
          json: { label: `${bulkPrefix}-${i + 1}`, type: 'proxy', kind: bulkKind, url: urls[i] },
        });
      } catch {
        errors++;
      }
      done++;
      setBulkProgress({ total: urls.length, done, errors });
    }
    qc.invalidateQueries({ queryKey: ['transports'] });
    if (errors === 0) toast.success(`Imported ${done} proxies`);
    else toast.error(`Imported ${done - errors}/${done}, ${errors} failed`);
    onClose();
    setBulkText('');
    setBulkProgress(null);
  }

  function handleClose() {
    onClose();
    setBulkText('');
    setBulkProgress(null);
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Bulk import proxies"
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div aria-live="polite">
            {bulkProgress && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {bulkProgress.done}/{bulkProgress.total}{bulkProgress.errors > 0 ? ` (${bulkProgress.errors} err)` : ''}
              </span>
            )}
          </div>
          <Button
            onClick={runBulkImport}
            disabled={!!bulkProgress || parseBulkLines().length === 0}
          >
            {bulkProgress ? 'Importing…' : 'Import'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Protocol
          <select name="protocol" value={bulkKind} onChange={(e) => setBulkKind((e.target as HTMLSelectElement).value as 'http' | 'socks5')} class="input">
            <option value="http">http</option>
            <option value="socks5">socks5</option>
          </select>
        </label>
        <label>
          Label prefix
          <input
            name="prefix"
            value={bulkPrefix}
            onInput={(e) => setBulkPrefix((e.target as HTMLInputElement).value)}
            placeholder="proxy…"
            autocomplete="off"
            class="input"
          />
        </label>
        <label>
          Proxy list {parseBulkLines().length > 0 && <Badge variant="active">{parseBulkLines().length}</Badge>}
          <textarea
            name="proxy-list"
            value={bulkText}
            onInput={(e) => setBulkText((e.target as HTMLTextAreaElement).value)}
            placeholder={'ip:port:user:pass\nip:port\nuser:pass@ip:port\n# comments ignored'}
            class="input"
            rows={8}
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, resize: 'vertical' }}
          />
        </label>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
          Formats: <code>ip:port:user:pass</code>, <code>ip:port</code>, <code>user:pass@ip:port</code>, or full URL. Lines starting with # are ignored.
        </span>
      </div>
    </Modal>
  );
}
