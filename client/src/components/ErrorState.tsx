export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div class="empty" style={{ borderColor: 'var(--danger)', borderStyle: 'solid' }}>
      <h3 style={{ color: 'var(--danger)' }}>Something went wrong</h3>
      <p style={{ marginBottom: 12 }}>{error.message}</p>
      <button class="btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
