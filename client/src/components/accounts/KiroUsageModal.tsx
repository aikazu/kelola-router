import { Modal } from '../Modal';

export interface KiroUsageModalProps {
  open: boolean;
  onClose: () => void;
  data: Record<string, unknown> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Read-only modal that pretty-prints the raw usage JSON fetched from AWS for a
 * Kiro account. Extracted verbatim from Accounts.tsx.
 */
export function KiroUsageModal({
  open,
  onClose,
  data,
  isLoading,
  isError,
  error,
}: KiroUsageModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Kiro Account Usage" width={480}>
      {isLoading ? (
        <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: 16 }}>
          Fetching usage from AWS…
        </p>
      ) : isError ? (
        <p style={{ color: 'var(--alert)', padding: 16 }}>
          {(error as Error)?.message ?? 'Failed to fetch usage'}
        </p>
      ) : data ? (
        <pre
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 400,
            overflow: 'auto',
            overflowX: 'auto',
            padding: 12,
            background: 'var(--surface-2, rgba(255,255,255,0.02))',
            borderRadius: 6,
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : null}
    </Modal>
  );
}
