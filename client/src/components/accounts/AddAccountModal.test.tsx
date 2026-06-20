import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { useKiroAutoImport } from '../../hooks/useKiroAutoImport';
import type { useKiroDeviceFlow } from '../../hooks/useKiroDeviceFlow';
import { ToastProvider } from '../ToastProvider';
import { AddAccountModal, type AddAccountModalProps } from './AddAccountModal';

// Opaque hook return shapes — the parent owns the real hooks, the modal only
// reads/forwards these values, so the test passes plain mock objects.
type AutoImportReturn = ReturnType<typeof useKiroAutoImport>;
type DeviceFlowReturn = ReturnType<typeof useKiroDeviceFlow>;

function mockAutoImport(overrides: Partial<AutoImportReturn> = {}): AutoImportReturn {
  return {
    status: 'idle',
    token: '',
    source: '',
    error: '',
    doAutoImport: vi.fn(),
    saveAutoImport: { mutate: vi.fn() } as unknown as AutoImportReturn['saveAutoImport'],
    isPending: false,
    reset: vi.fn(),
    ...overrides,
  };
}

function mockDeviceFlow(overrides: Partial<DeviceFlowReturn> = {}): DeviceFlowReturn {
  return {
    deviceStep: 'idle',
    deviceData: null,
    deviceError: '',
    startDeviceCode: vi.fn(),
    startPolling: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

const baseProps: AddAccountModalProps = {
  open: true,
  onClose: vi.fn(),
  provider: 'minimax',
  form: { label: '', credit_type: 'payg', api_key: '' },
  onFormChange: vi.fn(),
  kiroMethod: 'builder-id',
  onKiroMethodChange: vi.fn(),
  kiroForm: { label: '', credentialJson: '', refreshToken: '', region: '', startUrl: '' },
  onKiroFormChange: vi.fn(),
  pioneerForm: { label: '', api_key: '' },
  onPioneerFormChange: vi.fn(),
  zaiForm: { label: '', api_key: '', base_url: '' },
  onZaiFormChange: vi.fn(),
  notionForm: { email: '', label: '' },
  onNotionFormChange: vi.fn(),
  notionSuccess: vi.fn(),
  autoImport: mockAutoImport(),
  deviceFlow: mockDeviceFlow(),
  onCreate: vi.fn(),
  isCreating: false,
};

function renderModal(overrides: Partial<AddAccountModalProps> = {}) {
  const props = { ...baseProps, ...overrides };
  return render(
    <ToastProvider>
      <AddAccountModal {...props} />
    </ToastProvider>
  );
}

describe('AddAccountModal', () => {
  it('renders nothing when open=false', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Credit type')).not.toBeInTheDocument();
  });

  describe('minimax provider', () => {
    it('shows label / credit-type / api-key fields and the footer Add button', () => {
      renderModal({ provider: 'minimax' });
      expect(screen.getByText('Label', { exact: true })).toBeInTheDocument();
      expect(screen.getByText('Credit type')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('mm_…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('disables the footer Add button until label + api_key are filled', () => {
      const { rerender } = renderModal({ provider: 'minimax' });
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

      rerender(
        <AddAccountModal
          {...baseProps}
          provider="minimax"
          form={{ label: 'main', credit_type: 'payg', api_key: 'mm_xxx' }}
        />
      );
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    });

    it('fires onCreate when the enabled Add button is clicked', () => {
      const onCreate = vi.fn();
      renderModal({
        provider: 'minimax',
        form: { label: 'main', credit_type: 'payg', api_key: 'mm_xxx' },
        onCreate,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('shows the Adding… label and stays disabled while isCreating', () => {
      renderModal({
        provider: 'minimax',
        form: { label: 'main', credit_type: 'payg', api_key: 'mm_xxx' },
        isCreating: true,
      });
      const btn = screen.getByRole('button', { name: 'Adding…' });
      expect(btn).toBeDisabled();
    });
  });

  describe('kiro provider', () => {
    it('renders the auth-method selector with all four options', () => {
      renderModal({ provider: 'kiro', kiroMethod: 'builder-id' });
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('builder-id');
      expect(screen.getByRole('option', { name: 'AWS Builder ID (OAuth)' })).toBeInTheDocument();
      expect(
        screen.getByRole('option', { name: 'AWS IAM Identity Center (OAuth)' })
      ).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Auto-import from Kiro IDE' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Paste token manually' })).toBeInTheDocument();
    });

    it('builder-id method renders the device-flow login button and NO footer Add button', () => {
      renderModal({ provider: 'kiro', kiroMethod: 'builder-id' });
      expect(screen.getByRole('button', { name: 'Login with AWS Builder ID' })).toBeInTheDocument();
      // footer button is suppressed for non-token kiro methods
      expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    });

    it('idc method renders the IDC login button and NO footer Add button', () => {
      renderModal({ provider: 'kiro', kiroMethod: 'idc' });
      expect(
        screen.getByRole('button', { name: 'Login with IAM Identity Center' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    });

    it('auto-import method renders the scan button and NO footer Add button', () => {
      renderModal({ provider: 'kiro', kiroMethod: 'auto-import' });
      expect(screen.getByRole('button', { name: 'Scan for Kiro token' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    });

    it('token method renders the credential textarea AND the footer Add button', () => {
      renderModal({ provider: 'kiro', kiroMethod: 'token' });
      expect(
        screen.getByPlaceholderText('Paste token JSON or raw refresh token (aorAAAAAG…)')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('token method disables Add until a credential is pasted', () => {
      const { rerender } = renderModal({ provider: 'kiro', kiroMethod: 'token' });
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

      rerender(
        <AddAccountModal
          {...baseProps}
          provider="kiro"
          kiroMethod="token"
          kiroForm={{
            label: '',
            credentialJson: '',
            refreshToken: 'aorAAAAAGrawtoken',
            region: '',
            startUrl: '',
          }}
        />
      );
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    });

    it('changing the method selector resets both sub-flows and notifies the parent', () => {
      const autoImport = mockAutoImport();
      const deviceFlow = mockDeviceFlow();
      const onKiroMethodChange = vi.fn();
      renderModal({
        provider: 'kiro',
        kiroMethod: 'builder-id',
        onKiroMethodChange,
        autoImport,
        deviceFlow,
      });
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      // fireEvent.change on a Preact-controlled <select> does not fire the
      // onChange handler under @testing-library/preact 3.2.4 + preact 10.29 +
      // happy-dom when the component tree also mounts an inactive (never-
      // rendered) <NotionAuthForm> branch — the synthetic change event is
      // swallowed by Preact's event-delegation diff for the surrounding
      // conditional subtree. Reproduce the user gesture instead: set the
      // selected option's value then dispatch a native `change` event, which
      // Preact's delegated listener picks up and forwards to onChange.
      select.value = 'token';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onKiroMethodChange).toHaveBeenCalledWith('token');
      expect(autoImport.reset).toHaveBeenCalled();
      expect(deviceFlow.reset).toHaveBeenCalled();
    });

    it('token method routes JSON-shaped paste into credentialJson and clears refreshToken', () => {
      const onKiroFormChange = vi.fn();
      renderModal({
        provider: 'kiro',
        kiroMethod: 'token',
        onKiroFormChange,
      });
      const textarea = screen.getByPlaceholderText(
        'Paste token JSON or raw refresh token (aorAAAAAG…)'
      );
      fireEvent.input(textarea, { target: { value: '{"clientId":"abc"}' } });
      expect(onKiroFormChange).toHaveBeenCalledWith(
        expect.objectContaining({ credentialJson: '{"clientId":"abc"}', refreshToken: '' })
      );
    });

    it('token method routes a raw token paste into refreshToken and clears credentialJson', () => {
      const onKiroFormChange = vi.fn();
      renderModal({
        provider: 'kiro',
        kiroMethod: 'token',
        onKiroFormChange,
      });
      const textarea = screen.getByPlaceholderText(
        'Paste token JSON or raw refresh token (aorAAAAAG…)'
      );
      fireEvent.input(textarea, { target: { value: 'aorAAAAAGxxxx' } });
      expect(onKiroFormChange).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: 'aorAAAAAGxxxx', credentialJson: '' })
      );
    });
  });

  describe('pioneer provider', () => {
    it('shows label + api-key fields and the footer Add button', () => {
      renderModal({ provider: 'pioneer' });
      expect(screen.getByText('Label', { exact: true })).toBeInTheDocument();
      expect(screen.getByPlaceholderText('pio_sk_…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('disables the footer Add button until label + api_key are filled', () => {
      const { rerender } = renderModal({ provider: 'pioneer' });
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

      rerender(
        <AddAccountModal
          {...baseProps}
          provider="pioneer"
          pioneerForm={{ label: 'main', api_key: 'pio_sk_xxx' }}
        />
      );
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    });

    it('fires onCreate when the enabled Add button is clicked', () => {
      const onCreate = vi.fn();
      renderModal({
        provider: 'pioneer',
        pioneerForm: { label: 'main', api_key: 'pio_sk_xxx' },
        onCreate,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('shows the Adding… label and stays disabled while isCreating', () => {
      renderModal({
        provider: 'pioneer',
        pioneerForm: { label: 'main', api_key: 'pio_sk_xxx' },
        isCreating: true,
      });
      const btn = screen.getByRole('button', { name: 'Adding…' });
      expect(btn).toBeDisabled();
    });
  });
});
