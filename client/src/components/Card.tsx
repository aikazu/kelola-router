import type { ComponentChildren } from 'preact';

export function Card({
  children,
  title,
  eyebrow,
  sub,
  actions,
}: {
  children: ComponentChildren;
  title?: string;
  eyebrow?: string;
  sub?: string;
  actions?: ComponentChildren;
}) {
  return (
    <div class="surface">
      {(title || actions) && (
        <div class="card-head" style={{ justifyContent: 'space-between' }}>
          <div class="card-head-text">
            {eyebrow && <span class="card-eyebrow">{eyebrow}</span>}
            {title && <h2 class="card-title">{title}</h2>}
            {sub && (
              <p class="card-sub" style={{ marginBottom: 0, marginTop: 4 }}>
                {sub}
              </p>
            )}
          </div>
          {actions}
        </div>
      )}
      {!title && !actions && sub && <p class="card-sub">{sub}</p>}
      {children}
    </div>
  );
}
