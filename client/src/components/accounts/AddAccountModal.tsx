import type { useKiroAutoImport } from '../../hooks/useKiroAutoImport';
import type { useKiroDeviceFlow } from '../../hooks/useKiroDeviceFlow';
import { Button } from '../Button';
import { KiroAutoImportForm } from '../KiroAutoImportForm';
import { KiroDeviceFlowForm } from '../KiroDeviceFlowForm';
import { Modal } from '../Modal';
import { NotionAuthForm } from '../NotionAuthForm';

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

export interface ZaiForm {
  label: string;
  api_key: string;
  base_url: string;
}

export interface TabiForm {
  label: string;
  api_key: string;
  base_url: string;
}

export interface NotionForm {
  email: string;
  label: string;
}

export interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  provider: 'minimax' | 'kiro' | 'pioneer' | 'notion' | 'zai' | 'tabi';
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
  // Z.AI form state (owned by parent for resetForms closure).
  zaiForm: ZaiForm;
  onZaiFormChange: (next: ZaiForm) => void;
  // TabiToken form state (owned by parent for resetForms closure).
  tabiForm: TabiForm;
  onTabiFormChange: (next: TabiForm) => void;
  // Notion form state (owned by parent for resetForms closure).
  notionForm: NotionForm;
  onNotionFormChange: (next: NotionForm) => void;
  notionSuccess: () => void;
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
  zaiForm,
  onZaiFormChange,
  notionForm,
  onNotionFormChange,
  notionSuccess,
  autoImport,
  deviceFlow,
  tabiForm,
  onTabiFormChange,
  onCreate,
  isCreating,
}: AddAccountModalProps) {
  const showFooter =
    provider === 'minimax' ||
    provider === 'pioneer' ||
    provider === 'zai' ||
    provider === 'tabi' ||
    (provider === 'kiro' && kiroMethod === 'token');
  // Notion auth form carries its own action button — no footer needed.

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
                  : provider === 'zai'
                    ? !zaiForm.label || !zaiForm.api_key
                    : provider === 'tabi'
                      ? !tabiForm.label || !tabiForm.api_key
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
            <label htmlFor="add-mm-label">
              Label{' '}
              <input
                id="add-mm-label"
                name="mm-label"
                value={form.label}
                onInput={(e) =>
                  onFormChange({ ...form, label: (e.target as HTMLInputElement).value })
                }
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
            <label htmlFor="add-mm-credit-type">
              Credit type
              <select
                id="add-mm-credit-type"
                name="mm-credit-type"
                value={form.credit_type}
                onChange={(e) =>
                  onFormChange({ ...form, credit_type: (e.target as HTMLSelectElement).value })
                }
                class="input"
              >
                <option value="payg">PAYG</option>
                <option value="token-plan">Token Plan</option>
              </select>
            </label>
            <label htmlFor="add-mm-api-key">
              MiniMax API key{' '}
              <input
                id="add-mm-api-key"
                name="mm-api-key"
                value={form.api_key}
                onInput={(e) =>
                  onFormChange({ ...form, api_key: (e.target as HTMLInputElement).value })
                }
                placeholder="mm_…"
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
          </>
        ) : provider === 'pioneer' ? (
          <>
            <label htmlFor="add-pio-label">
              Label{' '}
              <input
                id="add-pio-label"
                name="pio-label"
                value={pioneerForm.label}
                onInput={(e) =>
                  onPioneerFormChange({
                    ...pioneerForm,
                    label: (e.target as HTMLInputElement).value,
                  })
                }
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
            <label htmlFor="add-pio-api-key">
              Pioneer API key{' '}
              <input
                id="add-pio-api-key"
                name="pio-api-key"
                value={pioneerForm.api_key}
                onInput={(e) =>
                  onPioneerFormChange({
                    ...pioneerForm,
                    api_key: (e.target as HTMLInputElement).value,
                  })
                }
                placeholder="pio_sk_…"
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
          </>
        ) : provider === 'notion' ? (
          <NotionAuthForm
            email={notionForm.email}
            onEmailChange={(email) => onNotionFormChange({ ...notionForm, email })}
            label={notionForm.label}
            onLabelChange={(label) => onNotionFormChange({ ...notionForm, label })}
            onSuccess={notionSuccess}
          />
        ) : provider === 'zai' ? (
          <>
            <label htmlFor="add-zai-label">
              Label{' '}
              <input
                id="add-zai-label"
                name="zai-label"
                value={zaiForm.label}
                onInput={(e) =>
                  onZaiFormChange({ ...zaiForm, label: (e.target as HTMLInputElement).value })
                }
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
            <label htmlFor="add-zai-api-key">
              Z.AI API key{' '}
              <input
                id="add-zai-api-key"
                name="zai-api-key"
                value={zaiForm.api_key}
                onInput={(e) =>
                  onZaiFormChange({ ...zaiForm, api_key: (e.target as HTMLInputElement).value })
                }
                placeholder="zai_sk_…"
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
            <label>
              Base URL (optional){' '}
              <input
                value={zaiForm.base_url}
                onInput={(e) =>
                  onZaiFormChange({ ...zaiForm, base_url: (e.target as HTMLInputElement).value })
                }
                placeholder="leave blank for api.z.ai"
                class="input"
              />
              <span
                style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}
              >
                Defaults to api.z.ai: Anthropic Messages at <code>/v1/messages</code>, OpenAI Chat
                at <code>/chat/completions</code>.
              </span>
            </label>
          </>
        ) : provider === 'tabi' ? (
          <>
            <label htmlFor="add-tabi-label">
              Label{' '}
              <input
                id="add-tabi-label"
                name="tabi-label"
                value={tabiForm.label}
                onInput={(e) =>
                  onTabiFormChange({ ...tabiForm, label: (e.target as HTMLInputElement).value })
                }
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
            <label htmlFor="add-tabi-api-key">
              TabiToken API key{' '}
              <input
                id="add-tabi-api-key"
                name="tabi-api-key"
                value={tabiForm.api_key}
                onInput={(e) =>
                  onTabiFormChange({ ...tabiForm, api_key: (e.target as HTMLInputElement).value })
                }
                placeholder="sk-…"
                class="input"
                autocomplete="off"
                aria-required="true"
              />
            </label>
            <label>
              Base URL (optional){' '}
              <input
                value={tabiForm.base_url}
                onInput={(e) =>
                  onTabiFormChange({ ...tabiForm, base_url: (e.target as HTMLInputElement).value })
                }
                placeholder="leave blank for tabitoken.com"
                class="input"
              />
              <span
                style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}
              >
                Defaults to tabitoken.com: OpenAI Chat Completions at{' '}
                <code>/v1/chat/completions</code> with Bearer auth.
              </span>
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
          onInput={(e) =>
            onKiroFormChange({ ...kiroForm, label: (e.target as HTMLInputElement).value })
          }
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
