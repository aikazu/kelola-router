import { Button } from '../Button';
import { KiroAutoImportForm } from '../KiroAutoImportForm';
import { KiroDeviceFlowForm } from '../KiroDeviceFlowForm';
import { Modal } from '../Modal';
import { useKiroAutoImport } from '../../hooks/useKiroAutoImport';
import { useKiroDeviceFlow } from '../../hooks/useKiroDeviceFlow';

export type KiroMethod = 'builder-id' | 'idc' | 'token' | 'auto-import';

export interface MinimaxForm {
  label: string;
  credit_type: string;
  api_key: string;
}

export interface KiroForm {
  label: string;
  credentialJson: string;
  refreshToken: string;
  region: string;
  startUrl: string;
}

export interface PioneerForm {
  label: string;
  api_key: string;
}

export interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  provider: 'minimax' | 'kiro' | 'pioneer';
  // Minimax form state (owned by parent so resetForms can clear it).
  form: MinimaxForm;
  onFormChange: (next: MinimaxForm) => void;
  // Kiro method + form state (owned by parent for the same reason).
  kiroMethod: KiroMethod;
  onKiroMethodChange: (method: KiroMethod) => void;
  kiroForm: KiroForm;
  onKiroFormChange: (next: KiroForm) => void;
  // Pioneer form state (owned by parent for the same reason).
  pioneerForm: PioneerForm;
  onPioneerFormChange: (next: PioneerForm) => void;
  // Pre-resolved hook returns — the parent owns these so their onSuccess
  // callbacks can close the modal + reset forms from one place.
  autoImport: ReturnType<typeof useKiroAutoImport>;
  deviceFlow: ReturnType<typeof useKiroDeviceFlow>;
  // Manual token/JSON + minimax save.
  onCreate: () => void;
  isCreating: boolean;
}

/**
 * Add-account modal. Renders the minimax form OR the kiro method selector with
 * its four sub-flows (builder-id / idc device code, auto-import, manual token
 * paste). The footer save button is only shown for minimax and the manual-token
 * method; the device-code + auto-import flows carry their own action buttons.
 *
 * Extracted verbatim from Accounts.tsx — no behavior or className changes.
 */
export function AddAccountModal({
  open,
  onClose,
  provider,
  form,
  onFormChange,
  kiroMethod,
  onKiroMethodChange,
  kiroForm,
  onKiroFormChange,
  pioneerForm,
  onPioneerFormChange,
  autoImport,
  deviceFlow,
  onCreate,
  isCreating,
}: AddAccountModalProps) {
  const showFooter =
    provider === 'minimax' || provider === 'pioneer' || (provider === 'kiro' && kiroMethod === 'token');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add account"
      footer={
        showFooter ? (
          <Button
            onClick={onCreate}
            disabled={
              isCreating ||
              (provider === 'minimax'
                ? !form.label || !form.api_key
                : provider === 'pioneer'
                  ? !pioneerForm.label || !pioneerForm.api_key
                  : !kiroForm.credentialJson.trim() && !kiroForm.refreshToken.trim())
            }
          >
            {isCreating ? 'Adding…' : 'Add'}
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {provider === 'minimax' ? (
          <>
            <label>
              Label{' '}
              <input
                value={form.label}
                onInput={(e) => onFormChange({ ...form, label: (e.target as HTMLInputElement).value })}
                class="input"
                aria-required="true"
              />
            </label>
            <label>
              Credit type
              <select
                value={form.credit_type}
                onChange={(e) => onFormChange({ ...form, credit_type: (e.target as HTMLSelectElement).value })}
                class="input"
              >
                <option value="payg">PAYG</option>
                <option value="token-plan">Token Plan</option>
              </select>
            </label>
            <label>
              MiniMax API key{' '}
              <input
                value={form.api_key}
                onInput={(e) => onFormChange({ ...form, api_key: (e.target as HTMLInputElement).value })}
                placeholder="mm_xxxxxxxx"
                class="input"
                aria-required="true"
              />
            </label>
          </>
        ) : provider === 'pioneer' ? (
          <>
            <label>
              Label{' '}
              <input
                value={pioneerForm.label}
                onInput={(e) => onPioneerFormChange({ ...pioneerForm, label: (e.target as HTMLInputElement).value })}
                class="input"
                aria-required="true"
              />
            </label>
            <label>
              Pioneer API key{' '}
              <input
                value={pioneerForm.api_key}
                onInput={(e) => onPioneerFormChange({ ...pioneerForm, api_key: (e.target as HTMLInputElement).value })}
                placeholder="pio_sk_xxxxxxxx"
                class="input"
                aria-required="true"
              />
            </label>
          </>
        ) : (
          <>
            {/* Kiro method selector */}
            <label>
              Auth method
              <select
                value={kiroMethod}
                onChange={(e) => {
                  onKiroMethodChange((e.target as HTMLSelectElement).value as KiroMethod);
                  autoImport.reset();
                  deviceFlow.reset();
                }}
                class="input"
              >
                <option value="builder-id">AWS Builder ID (OAuth)</option>
                <option value="idc">AWS IAM Identity Center (OAuth)</option>
                <option value="auto-import">Auto-import from Kiro IDE</option>
                <option value="token">Paste token manually</option>
              </select>
            </label>

            {/* Render method-specific UI */}
            {(kiroMethod === 'builder-id' || kiroMethod === 'idc') && (
              <KiroDeviceFlowForm
                deviceStep={deviceFlow.deviceStep}
                deviceData={deviceFlow.deviceData}
                deviceError={deviceFlow.deviceError}
                kiroMethod={kiroMethod}
                kiroLabel={kiroForm.label}
                kiroStartUrl={kiroForm.startUrl}
                kiroRegion={kiroForm.region}
                onLabelChange={(label) => onKiroFormChange({ ...kiroForm, label })}
                onStartUrlChange={(startUrl) => onKiroFormChange({ ...kiroForm, startUrl })}
                onRegionChange={(region) => onKiroFormChange({ ...kiroForm, region })}
                onStartDeviceCode={deviceFlow.startDeviceCode}
                onStartPolling={deviceFlow.startPolling}
              />
            )}
            {kiroMethod === 'auto-import' && (
              <KiroAutoImportForm
                status={autoImport.status}
                token={autoImport.token}
                source={autoImport.source}
                error={autoImport.error}
                label={kiroForm.label}
                onLabelChange={(label) => onKiroFormChange({ ...kiroForm, label })}
                isPending={autoImport.isPending}
                onAutoImport={autoImport.doAutoImport}
                onSave={() => autoImport.saveAutoImport.mutate()}
              />
            )}
            {kiroMethod === 'token' && (
              <KiroTokenPaste kiroForm={kiroForm} onKiroFormChange={onKiroFormChange} />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Manual credential-JSON / refresh-token paste block (kiro method = "token"). */
function KiroTokenPaste({
  kiroForm,
  onKiroFormChange,
}: {
  kiroForm: KiroForm;
  onKiroFormChange: (next: KiroForm) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>
        Label{' '}
        <input
          value={kiroForm.label}
          onInput={(e) => onKiroFormChange({ ...kiroForm, label: (e.target as HTMLInputElement).value })}
          placeholder="kiro1"
          class="input"
        />
      </label>
      <label>
        Credential JSON or refresh token
        <textarea
          value={kiroForm.credentialJson || kiroForm.refreshToken}
          onInput={(e) => {
            const val = (e.target as HTMLTextAreaElement).value;
            if (val.trim().startsWith('{')) {
              onKiroFormChange({ ...kiroForm, credentialJson: val, refreshToken: '' });
            } else {
              onKiroFormChange({ ...kiroForm, refreshToken: val, credentialJson: '' });
            }
          }}
          placeholder="Paste token JSON or raw refresh token (aorAAAAAG…)"
          class="input"
          style={{ minHeight: 100, fontFamily: 'var(--font-mono, monospace)' }}
        />
        <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
          From ~/.aws/sso/cache/kiro-auth-token.json or paste the refresh token directly.
        </span>
      </label>
    </div>
  );
}
