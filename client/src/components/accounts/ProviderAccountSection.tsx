import { AccountsTable } from '../AccountsTable';
import { Button } from '../Button';
import { Card } from '../Card';
import { SelectionControls } from '../SelectionControls';
import type { Account, Transport } from '../../lib/types';

export interface ProviderAccountSectionProps {
  title: string;
  provider: 'minimax' | 'kiro';
  accounts: Account[];
  transports: Transport[];
  onAdd: () => void;
  onUsage: (accountId: string) => void;
  onEdit: (account: Account, editForm: { label: string; api_key: string; persona: string }) => void;
  onLoadTransportState: (account: Account) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string, label: string) => void;
}

/**
 * Per-provider account panel: title card with "+ Add" action, selection-mode
 * controls, and the accounts table. Extracted from Accounts.tsx to deduplicate
 * the identical MiniMax / Kiro card shells.
 */
export function ProviderAccountSection({
  title,
  provider,
  accounts,
  transports,
  onAdd,
  onUsage,
  onEdit,
  onLoadTransportState,
  onToggle,
  onDelete,
}: ProviderAccountSectionProps) {
  return (
    <Card
      title={title}
      actions={
        <Button size="sm" onClick={onAdd}>
          + Add
        </Button>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <SelectionControls provider={provider} />
      </div>
      <AccountsTable
        accounts={accounts}
        transports={transports}
        onUsage={onUsage}
        onEdit={onEdit}
        onLoadTransportState={onLoadTransportState}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    </Card>
  );
}
