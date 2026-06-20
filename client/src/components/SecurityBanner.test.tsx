import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { SecurityBanner } from './SecurityBanner';

describe('SecurityBanner', () => {
  it('renders null when secure (password set + db encrypted)', () => {
    const { container } = render(<SecurityBanner open={false} dbEncrypted={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders open-mode warning with CTA + dismiss when open=true', () => {
    render(<SecurityBanner open={true} dbEncrypted={true} onDismiss={() => {}} />);
    expect(
      screen.getByText(/Router runs in open mode — set an admin password/i)
    ).toBeInTheDocument();
    // eyebrow
    expect(screen.getByText('Security · Open mode')).toBeInTheDocument();
    // CTA points at the settings page (hash route). The link text is split
    // across two text nodes ("Set password" + " →"), so match by accessible name.
    const cta = screen.getByRole('link', { name: /set password/i });
    expect(cta).toHaveAttribute('href', '#/admin/settings');
  });

  it('renders the dismiss button and fires onDismiss', () => {
    const onDismiss = vi.fn();
    render(<SecurityBanner open={true} dbEncrypted={true} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText(/dismiss security banner/i));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('omits the dismiss button when onDismiss is not supplied', () => {
    render(<SecurityBanner open={true} dbEncrypted={true} />);
    expect(screen.queryByLabelText(/dismiss security banner/i)).toBeNull();
  });

  it('renders the softer db-unencrypted notice when password set but db unencrypted', () => {
    render(<SecurityBanner open={false} dbEncrypted={false} />);
    expect(screen.getByText(/Database encryption is OFF/i)).toBeInTheDocument();
    expect(screen.getByText('ROUTER_DB_KEY')).toBeInTheDocument();
    expect(screen.getByText('Security · Database')).toBeInTheDocument();
    // softer variant gets the --soft modifier class
    expect(screen.getByRole('status')).toHaveClass('security-banner--soft');
  });

  it('prefers the open-mode banner over the db notice when both are true', () => {
    render(<SecurityBanner open={true} dbEncrypted={false} />);
    expect(screen.getByText(/Router runs in open mode/i)).toBeInTheDocument();
    expect(screen.queryByText(/Database encryption is OFF/i)).toBeNull();
  });
});
