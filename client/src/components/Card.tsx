import type { ComponentChildren } from "preact";

export function Card({ children, title, sub }: { children: ComponentChildren; title?: string; sub?: string }) {
  return (
    <div class="surface">
      {title && <div class="card-title">{title}</div>}
      {sub && <p class="card-sub">{sub}</p>}
      {children}
    </div>
  );
}
