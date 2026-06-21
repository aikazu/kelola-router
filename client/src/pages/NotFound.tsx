import { TopBar } from '../layout/TopBar';

export function NotFound({ route }: { route: string }) {
  return (
    <>
      <TopBar title="404" />
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 36,
        }}
      >
        <div
          class="surface module--active"
          style={{
            maxWidth: 420,
            width: '100%',
            textAlign: 'center',
            padding: '40px 32px',
          }}
        >
          <div class="card-head" style={{ justifyContent: 'center' }}>
            <div class="card-head-text">
              <span class="card-eyebrow">NOT FOUND</span>
              <div
                class="mono"
                aria-hidden="true"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 72,
                  fontWeight: 500,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  color: 'var(--gold-dim)',
                  margin: '8px 0 16px',
                }}
              >
                404
              </div>
              <p class="card-sub" style={{ marginBottom: 24 }}>
                No route matches{' '}
                <span class="mono" style={{ color: 'var(--ink-dim)' }}>
                  {route}
                </span>
                . Return to the overview panel to resume operations.
              </p>
              <a href="#/admin/overview" class="btn btn-ghost">
                Back to overview
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
