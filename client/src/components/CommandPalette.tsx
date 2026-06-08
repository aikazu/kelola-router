import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

const ITEMS = [
  { label: 'Overview', href: '/admin', keys: 'g o' },
  { label: 'Usage', href: '/admin/usage', keys: 'g u' },
  { label: 'Client keys', href: '/admin/client-keys', keys: 'g c' },
  { label: 'Upstream accounts', href: '/admin/accounts', keys: 'g a' },
  { label: 'Models', href: '/admin/models', keys: 'g m' },
  { label: 'Aliases', href: '/admin/aliases', keys: 'g l' },
  { label: 'Quota', href: '/admin/quota', keys: 'g q' },
  { label: 'Settings', href: '/admin/settings', keys: 'g s' },
];

function fuzzy(q: string, text: string): number {
  if (!q) return 1;
  q = q.toLowerCase();
  text = text.toLowerCase();
  let i = 0,
    score = 0;
  for (const ch of text) {
    if (ch === q[i]) {
      i++;
      score += 1;
      if (i === q.length) break;
    }
  }
  return i === q.length ? score : 0;
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const items = useMemo(() => {
    return ITEMS.map((i) => ({ ...i, score: fuzzy(q, i.label) }))
      .filter((i) => i.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [q]);

  if (!open) return null;
  return (
    <div
      class="cmdk"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="cmdk-modal">
        <input
          ref={inputRef}
          class="cmdk-input"
          placeholder="Search pages..."
          value={q}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-listbox"
          aria-activedescendant={items.length > 0 ? `cmdk-item-${active}` : undefined}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && items[active]) {
              onNavigate(items[active].href);
            } else if (e.key === 'Escape') onClose();
          }}
        />
        <div class="cmdk-list" role="listbox" id="cmdk-listbox" aria-label="Pages">
          {items.length === 0 ? (
            <div class="cmdk-item" style={{ color: 'var(--text-3)' }} role="option" aria-selected="false">
              No matches
            </div>
          ) : (
            items.map((it, i) => (
              <div
                key={it.href}
                id={`cmdk-item-${i}`}
                role="option"
                aria-selected={i === active}
                class={`cmdk-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onNavigate(it.href)}
              >
                <Icon name="search" size={14} />
                <span>{it.label}</span>
                <span class="cmdk-item-meta">{it.keys}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
