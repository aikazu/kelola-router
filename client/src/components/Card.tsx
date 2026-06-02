import type { ComponentChildren } from "preact";

export function Card({ children, title, sub, actions }: { children: ComponentChildren; title?: string; sub?: string; actions?: ComponentChildren }) {
  return (
    <div class="surface">
      {(title || actions) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: title ? 4 : 0 }}>
          {title && <div class="card-title" style={{ marginBottom: 0 }}>{title}</div>}
          {actions}
        </div>
      )}
      {sub && <p class="card-sub">{sub}</p>}
      {children}
    </div>
  );
}
