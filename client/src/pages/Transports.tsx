import { useQuery } from '@tanstack/react-query';
import { useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { AddTransportModal } from '../components/transports/AddTransportModal';
import { BulkImportModal } from '../components/transports/BulkImportModal';
import { EditTransportModal } from '../components/transports/EditTransportModal';
import { FailureModeCard } from '../components/transports/FailureModeCard';
import { TransportsTable } from '../components/transports/TransportsTable';
import type { Transport } from '../components/transports/types';
import { TopBar } from '../layout/TopBar';
import { apiFetch } from '../lib/api';

export function Transports() {
  const {
    data: transports = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['transports'],
    queryFn: () => apiFetch<Transport[]>('/api/admin/transports'),
  });

  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<Transport | null>(null);

  return (
    <>
      <TopBar
        title={<>Pro<em>xies</em></>}
        eyebrow="Network transports"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setBulkOpen(true)}>Bulk import</Button>
            <Button onClick={() => setOpen(true)}>+ Add transport</Button>
          </div>
        }
      />
      <p class="card-sub">
        Define HTTP/SOCKS5 proxies and Vercel/Cloudflare relays here, then assign them per account on
        the Upstream page. Proxies can be pooled and rotated; relays are assigned one at a time.
      </p>
      <FailureModeCard />
      <TransportsTable
        transports={transports}
        isLoading={isLoading}
        isError={isError}
        error={error}
        refetch={refetch}
        onEdit={(t) => setEditing(t)}
      />

      <AddTransportModal open={open} onClose={() => setOpen(false)} />
      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
      {/* `key` by transport id so the modal remounts with fresh editForm state per row. */}
      <EditTransportModal
        key={editing?.id ?? 'none'}
        transport={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
