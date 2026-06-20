import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { CommandPalette } from '../components/CommandPalette';
import { SecurityBanner } from '../components/SecurityBanner';
import { apiFetch } from '../lib/api';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const Accounts = lazy(() => import('../pages/Accounts').then((m) => ({ default: m.Accounts })));
const Aliases = lazy(() => import('../pages/Aliases').then((m) => ({ default: m.Aliases })));
const ClientKeys = lazy(() =>
  import('../pages/ClientKeys').then((m) => ({ default: m.ClientKeys }))
);
const Combos = lazy(() => import('../pages/Combos').then((m) => ({ default: m.Combos })));
const Login = lazy(() => import('../pages/Login').then((m) => ({ default: m.Login })));
const Models = lazy(() => import('../pages/Models').then((m) => ({ default: m.Models })));
const NotFound = lazy(() => import('../pages/NotFound').then((m) => ({ default: m.NotFound })));
const Overview = lazy(() => import('../pages/Overview').then((m) => ({ default: m.Overview })));
const Quota = lazy(() => import('../pages/Quota').then((m) => ({ default: m.Quota })));
const Settings = lazy(() => import('../pages/Settings').then((m) => ({ default: m.Settings })));
const Transports = lazy(() =>
  import('../pages/Transports').then((m) => ({ default: m.Transports }))
);
const Usage = lazy(() => import('../pages/Usage').then((m) => ({ default: m.Usage })));
const Console = lazy(() => import('../pages/Console').then((m) => ({ default: m.Console })));

const KNOWN_ROUTES = [
  'overview',
  'usage',
  'client-keys',
  'accounts',
  'models',
  'aliases',
  'combos',
  'quota',
  'transports',
  'console',
  'settings',
];

/** Mirrors `SecurityStatus` from `src/security/status.ts` (Task 19 endpoint). */
interface SecurityStatus {
  adminPasswordSet: boolean;
  dbEncrypted: boolean;
}

function Page({ current }: { current: string }) {
  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<{ authed: boolean; passwordSet: boolean }>('/api/me'),
    retry: false,
  });
  if (isLoading)
    return (
      <>
        <TopBar title="Loading…" />
        <div aria-live="polite" aria-busy="true">
          <p style={{ padding: 36, color: 'var(--text-3)' }}>Loading…</p>
        </div>
      </>
    );
  if (me?.passwordSet && !me.authed) return <Login />;
  if (!KNOWN_ROUTES.includes(current)) return <NotFound route={`/admin/${current}`} />;
  switch (current) {
    case 'usage':
      return <Usage />;
    case 'client-keys':
      return <ClientKeys />;
    case 'accounts':
      return <Accounts />;
    case 'models':
      return <Models />;
    case 'aliases':
      return <Aliases />;
    case 'combos':
      return <Combos />;
    case 'quota':
      return <Quota />;
    case 'transports':
      return <Transports />;
    case 'console':
      return <Console />;
    case 'settings':
      return <Settings />;
    case 'overview':
      return <Overview />;
    default:
      return <NotFound route={`/admin/${current}`} />;
  }
}

export function AppShell() {
  const [current, setCurrent] = useState<string>(() => {
    const h = location.hash.replace(/^#\/admin\/?/, '').split('?')[0];
    return h || 'overview';
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  // Security posture (Task 19 endpoint). Drives the SecurityBanner mount.
  // staleTime defaults to 30s (queryClient.ts); refetchOnWindowFocus is off
  // globally, but Settings.tsx invalidates this key after a password change
  // so the banner updates immediately on set/remove.
  const { data: securityStatus } = useQuery({
    queryKey: ['security-status'],
    queryFn: () => apiFetch<SecurityStatus>('/api/admin/security/status'),
  });

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace(/^#\/admin\/?/, '').split('?')[0];
      setCurrent(h || 'overview');
    };
    window.addEventListener('hashchange', onHash);

    const gMap: Record<string, string> = {
      o: '/admin',
      u: '/admin/usage',
      c: '/admin/client-keys',
      a: '/admin/accounts',
      m: '/admin/models',
      l: '/admin/aliases',
      q: '/admin/quota',
      t: '/admin/transports',
      n: '/admin/console',
      s: '/admin/settings',
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === '?' && !inField) {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === 'g' && !inField) {
        e.preventDefault();
        const handler = (ev: KeyboardEvent) => {
          if (gMap[ev.key]) location.hash = gMap[ev.key];
        };
        document.addEventListener('keydown', handler, { once: true });
        setTimeout(() => document.removeEventListener('keydown', handler), 1000);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div class="app-layout">
      {/* SecurityBanner mounts only after the status query resolves to avoid
          flashing the wrong state during load. Task 5's component returns null
          when both adminPasswordSet and dbEncrypted are true. */}
      {securityStatus && (
        <SecurityBanner
          open={!securityStatus.adminPasswordSet}
          dbEncrypted={securityStatus.dbEncrypted}
        />
      )}
      <div class="app-body">
        <a href="#main-content" class="skip-link">
          Skip to content
        </a>
        <Sidebar
          current={current}
          mobileOpen={mobileNav}
          onMobileClose={() => setMobileNav(false)}
        />
        <main class="main" id="main-content">
          <button
            type="button"
            class="hamburger"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <Suspense
            fallback={
              <div aria-live="polite" aria-busy="true">
                <p style={{ padding: 36, color: 'var(--text-3)' }}>Loading…</p>
              </div>
            }
          >
            <Page current={current} />
          </Suspense>
        </main>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNavigate={(href) => {
            location.hash = href;
            setPaletteOpen(false);
          }}
        />
        {helpOpen && (
          // biome-ignore lint/a11y/noStaticElementInteractions: help dialog backdrop overlay
          // biome-ignore lint/a11y/useKeyWithClickEvents: dialog owns Escape
          <div
            class="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setHelpOpen(false);
            }}
          >
            <div
              class="modal"
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
              style={{ maxWidth: 400 }}
            >
              <div class="modal-header">
                <div class="modal-title">Keyboard shortcuts</div>
                <button
                  type="button"
                  class="modal-close"
                  onClick={() => setHelpOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div class="modal-body" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div>
                  <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> — command palette
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>o</kbd> — overview
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>u</kbd> — usage
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>c</kbd> — client keys
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>a</kbd> — accounts
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>m</kbd> — models
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>l</kbd> — aliases
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>q</kbd> — quota
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>n</kbd> — console
                </div>
                <div>
                  <kbd>g</kbd> then <kbd>s</kbd> — settings
                </div>
                <div>
                  <kbd>?</kbd> — this help
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
