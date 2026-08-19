import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'preact/hooks';
import { Icon, type IconName } from '../components/Icon';
import { apiFetch } from '../lib/api';

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
}

interface NavSection {
  caption: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    caption: 'View',
    items: [
      { key: 'overview', label: 'Overview', href: '/admin', icon: 'overview' },
      { key: 'usage', label: 'Usage', href: '/admin/usage', icon: 'usage' },
    ],
  },
  {
    caption: 'Operate',
    items: [
      { key: 'client-keys', label: 'Client keys', href: '/admin/client-keys', icon: 'client-keys' },
      { key: 'accounts', label: 'Upstream', href: '/admin/accounts', icon: 'accounts' },
      { key: 'models', label: 'Models', href: '/admin/models', icon: 'models' },
      { key: 'aliases', label: 'Aliases', href: '/admin/aliases', icon: 'aliases' },
      { key: 'combos', label: 'Combos', href: '/admin/combos', icon: 'combos' },
      { key: 'quota', label: 'Quota', href: '/admin/quota', icon: 'quota' },
    ],
  },
  {
    caption: 'System',
    items: [
      { key: 'transports', label: 'Proxies', href: '/admin/transports', icon: 'transports' },
      { key: 'console', label: 'Console', href: '/admin/console', icon: 'console' },
      { key: 'settings', label: 'Settings', href: '/admin/settings', icon: 'settings' },
    ],
  },
];

export function Sidebar({
  current,
  mobileOpen,
  onMobileClose,
}: {
  current: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const qc = useQueryClient();
  // Desktop rail ⇄ expanded sidebar. Persisted so the choice survives reloads;
  // mobile ignores it (always a full overlaid drawer).
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kr-nav-expanded') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('kr-nav-expanded', expanded ? '1' : '0');
    } catch {
      /* private mode — non-fatal */
    }
  }, [expanded]);

  // Read from cache only — App.PrimeCache() populates this on mount. Reading
  // via getQueryData (synchronous) avoids re-running the query on every
  // Sidebar re-render.
  const me = qc.getQueryData<{ authed: boolean; passwordSet: boolean }>(['me']);
  const settings = qc.getQueryData<{ version: string | null }>(['settings']);
  return (
    <>
      {mobileOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: tap-target scrim, sidebar owns focus
        // biome-ignore lint/a11y/useKeyWithClickEvents: sidebar handles Escape
        <div class="sidebar-overlay" onClick={onMobileClose} />
      )}
      <aside
        class={`sidebar${mobileOpen ? ' sidebar-open' : ''}${expanded ? ' sidebar-expanded' : ''}`}
      >
        <div class="brand">
          <span class="brand-mark">
            <span class="brand-mark-full">
              kelola<em>router</em>
            </span>
            <span class="brand-mark-mini">
              k<em>r</em>
            </span>
          </span>
          <span class="brand-tag">{me?.passwordSet ? 'PROTECTED' : 'OPEN MODE'}</span>
        </div>
        <nav class="nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.caption} class="nav-section">
              {expanded && <span class="nav-caption">{section.caption}</span>}
              {section.items.map((n) => (
                <a
                  key={n.key}
                  href={`#${n.href}`}
                  class={`nav-item${n.key === current ? ' active' : ''}`}
                  onClick={onMobileClose}
                >
                  <span class="nav-icon">
                    <Icon name={n.icon} />
                  </span>
                  <span class="nav-label">{n.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <button
          type="button"
          class="rail-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-pressed={expanded}
          title={expanded ? 'Collapse to rail' : 'Expand sidebar'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
            class={`rail-toggle-chevron${expanded ? '' : ' is-collapsed'}`}
          >
            <path d="M11 17l-5-5 5-5" />
            <path d="M18 17l-5-5 5-5" />
          </svg>
          <span class="rail-toggle-label">{expanded ? 'Collapse' : 'Expand'}</span>
        </button>
        <div class="user-card">
          <span>{settings?.version ? `v${settings.version}` : ''}</span>
          {me?.passwordSet && (
            <button
              type="button"
              onClick={async () => {
                await apiFetch('/api/logout', { method: 'POST' });
                qc.clear();
                location.hash = '/';
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
