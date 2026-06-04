import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon, type IconName } from '../components/Icon';
import { apiFetch } from '../lib/api';

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { key: 'overview', label: 'Overview', href: '/admin', icon: 'overview' },
  { key: 'usage', label: 'Usage', href: '/admin/usage', icon: 'usage' },
  { key: 'client-keys', label: 'Client keys', href: '/admin/client-keys', icon: 'client-keys' },
  { key: 'accounts', label: 'Upstream', href: '/admin/accounts', icon: 'accounts' },
  { key: 'models', label: 'Models', href: '/admin/models', icon: 'models' },
  { key: 'aliases', label: 'Aliases', href: '/admin/aliases', icon: 'aliases' },
  { key: 'quota', label: 'Quota', href: '/admin/quota', icon: 'quota' },
  { key: 'settings', label: 'Settings', href: '/admin/settings', icon: 'settings' },
];

export function Sidebar({ current }: { current: string }) {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<{ authed: boolean; passwordSet: boolean }>('/api/me'),
    retry: false,
  });
  return (
    <aside class="sidebar">
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
        {NAV.map((n) => (
          <a
            key={n.key}
            href={`#${n.href}`}
            class={`nav-item${n.key === current ? ' active' : ''}`}
          >
            <span class="nav-icon">
              <Icon name={n.icon} />
            </span>
            <span class="nav-label">{n.label}</span>
          </a>
        ))}
      </nav>
      <div class="user-card">
        <span>v0.15</span>
        {me?.passwordSet && (
          <button
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
  );
}
