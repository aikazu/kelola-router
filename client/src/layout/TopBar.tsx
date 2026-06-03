import type { ComponentChildren } from 'preact';

export function TopBar({
  title,
  eyebrow,
  actions,
}: {
  title: ComponentChildren;
  eyebrow?: string;
  actions?: ComponentChildren;
}) {
  return (
    <div class="topbar">
      <div class="topbar-head">
        <span class="topbar-eyebrow">{eyebrow ?? 'kelola-router'}</span>
        <h1 class="topbar-title">{title}</h1>
      </div>
      {actions && <div class="topbar-actions">{actions}</div>}
    </div>
  );
}
