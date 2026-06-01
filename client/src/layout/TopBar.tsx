import type { ComponentChildren } from "preact";
export function TopBar({ title, actions }: { title: string; actions?: ComponentChildren }) {
  return (
    <div class="topbar">
      <h1 class="topbar-title">{title}</h1>
      {actions && <div class="topbar-actions">{actions}</div>}
    </div>
  );
}
