import { TopBar } from '../layout/TopBar';

export function NotFound({ route }: { route: string }) {
  return (
    <>
      <TopBar title="404" />
      <div style={{ padding: 36, textAlign: 'center' }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            color: 'var(--text-1)',
            marginBottom: 8,
          }}
        >
          Page not found
        </h2>
        <p style={{ color: 'var(--text-2)', marginBottom: 24 }}>
          No page matches{' '}
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              background: 'var(--ink-2)',
              padding: '2px 6px',
              borderRadius: 3,
            }}
          >
            {route}
          </code>
          .
        </p>
        <a href="#/admin" class="btn btn-primary">
          Back to overview
        </a>
      </div>
    </>
  );
}
