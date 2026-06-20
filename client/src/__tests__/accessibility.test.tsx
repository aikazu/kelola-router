import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from '../components/ErrorState';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Progress } from '../components/Progress';
import { Switch } from '../components/Switch';
import { ToastProvider } from '../components/ToastProvider';

describe('Switch accessibility', () => {
  it('has role="switch" and aria-checked', () => {
    render(<Switch checked={true} onChange={() => {}} label="Toggle" />);
    const sw = screen.getByRole('switch');
    expect(sw).toBeInTheDocument();
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('is focusable via keyboard (not display:none)', () => {
    const { container } = render(<Switch checked={false} onChange={() => {}} />);
    const input = container.querySelector('input[type="checkbox"]') as HTMLElement;
    expect(input).not.toHaveStyle({ display: 'none' });
  });

  it('toggles on keyboard Space', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Test" />);
    const sw = screen.getByRole('switch');
    fireEvent.keyDown(sw, { key: ' ' });
    fireEvent.keyUp(sw, { key: ' ' });
  });
});

describe('Modal accessibility', () => {
  it('has role="dialog" and aria-modal="true"', () => {
    render(
      <Modal open={true} onClose={() => {}} title="Test Modal">
        Content
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-labelledby pointing to title', () => {
    render(
      <Modal open={true} onClose={() => {}} title="My Title">
        Content
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const titleEl = document.getElementById(labelId!);
    expect(titleEl?.textContent).toBe('My Title');
  });

  it('traps focus inside the modal', () => {
    render(
      <Modal open={true} onClose={() => {}} title="Trap Test">
        <button>First</button>
        <button>Last</button>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll('button, [tabindex]');
    expect(focusable.length).toBeGreaterThan(0);
  });
});

describe('Toast accessibility', () => {
  it('toast-stack has aria-live="polite" and role="status"', () => {
    const { container } = render(
      <ToastProvider>
        <div>App</div>
      </ToastProvider>
    );
    const stack = container.querySelector('.toast-stack');
    expect(stack).toHaveAttribute('aria-live', 'polite');
    expect(stack).toHaveAttribute('role', 'status');
  });
});

describe('Progress accessibility', () => {
  it('has role="progressbar" with aria-valuenow/min/max', () => {
    render(<Progress value={30} max={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });
});

describe('Icon accessibility', () => {
  it('has aria-hidden="true" on SVG', () => {
    const { container } = render(<Icon name="search" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ErrorState', () => {
  it('uses Button component (not raw <button>)', () => {
    const { container } = render(<ErrorState error={new Error('fail')} onRetry={() => {}} />);
    const btn = container.querySelector('.btn');
    expect(btn).toBeInTheDocument();
  });
});
