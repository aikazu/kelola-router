import type { ComponentChildren, JSX } from 'preact';

/**
 * Route to the Settings page where the dashboard password ("Dashboard access"
 * card) is set. Task 20 may swap this for a deep-link anchor if the Settings
 * page grows an id on the password card.
 */
const SETTINGS_HREF = '#/admin/settings';

export type SecurityBannerProps = {
  /** true = router has no admin password set (open mode). */
  open: boolean;
  /** true = SQLCipher at-rest encryption is active. */
  dbEncrypted: boolean;
  /** Optional dismissal — banner reappears on next reload (no persistence yet). */
  onDismiss?: () => void;
};

/**
 * Persistent security advisory banner. Pure presentational — no data fetching.
 *
 * Three render states:
 *   1. `open === true`                  → open-mode warning (gold left stripe) + "Set password" CTA
 *   2. `open === false && !dbEncrypted` → softer db-unencrypted notice (muted-gold stripe)
 *   3. `open === false && dbEncrypted`  → returns `null` (all clear)
 *
 * Wiring (status fetch + AppShell mount) lands in Tasks 19 + 20.
 */
export function SecurityBanner({
  open,
  dbEncrypted,
  onDismiss,
}: SecurityBannerProps): JSX.Element | null {
  // All-clear: password set AND DB encrypted → render nothing.
  if (!open && dbEncrypted) return null;

  if (open) {
    return (
      <Banner
        eyebrow="Security · Open mode"
        ctaHref={SETTINGS_HREF}
        ctaLabel="Set password"
        onDismiss={onDismiss}
      >
        Router runs in open mode — set an admin password to protect your accounts.
      </Banner>
    );
  }

  // open === false && dbEncrypted === false → softer encryption notice.
  return (
    <Banner soft eyebrow="Security · Database">
      Database encryption is OFF. Set <code>ROUTER_DB_KEY</code> in your environment to enable
      SQLCipher.
    </Banner>
  );
}

type BannerProps = {
  eyebrow: string;
  children: ComponentChildren;
  ctaHref?: string;
  ctaLabel?: string;
  soft?: boolean;
  onDismiss?: () => void;
};

function Banner({
  eyebrow,
  children,
  ctaHref,
  ctaLabel,
  soft,
  onDismiss,
}: BannerProps): JSX.Element {
  return (
    <div
      class={`security-banner${soft ? ' security-banner--soft' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span class="security-banner-eyebrow">{eyebrow}</span>
      <div class="security-banner-body">{children}</div>
      {ctaHref && ctaLabel && (
        <a class="security-banner-cta" href={ctaHref}>
          {ctaLabel} →
        </a>
      )}
      {onDismiss && (
        <button
          class="security-banner-dismiss"
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss security banner"
        >
          ×
        </button>
      )}
    </div>
  );
}
