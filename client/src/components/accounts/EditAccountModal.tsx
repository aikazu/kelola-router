import { relativeTime } from '../../lib/relativeTime';
import type { Account, ModelLock, Transport, TransportState } from '../../lib/types';
import { Button } from '../Button';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { TransportAssignment } from './TransportAssignment';

/** Shape of a partial account update sent to PATCH /api/admin/accounts/:id. */
export interface EditPayload {
  id: string;
  label?: string;
  api_key?: string;
  persona?: string;
  relayId?: string | null;
  proxyId?: string | null;
  proxyPool?: string[] | null;
  proxyRotateEvery?: number;
}

export interface EditForm {
  label: string;
  api_key: string;
  persona: string;
}

export interface EditAccountModalProps {
  open: boolean;
  onClose: () => void;
  editing: Account | null;
  editForm: EditForm;
  onEditFormChange: (next: EditForm) => void;
  // Transport pool (proxies + relays derived by the parent from the transports list).
  proxies: Transport[];
  relays: Transport[];
  tpState: TransportState;
  onTpStateChange: (next: TransportState) => void;
  // Model locks for the editing account (parent gates the fetch on !!editing).
  locks: ModelLock[];
  // Submission.
  onSave: (payload: EditPayload) => void;
  onUnlock: (model: string) => void;
  isSaving: boolean;
  isUnlocking: boolean;
}

/**
 * Edit-account modal. Builds the PATCH payload from edit-form + transport state
 * (see {@link buildEditPayload}) and renders the persona selector for Kiro
 * accounts plus the locked-model list.
 *
 * Extracted verbatim from Accounts.tsx — no behavior or className changes.
 */
export function EditAccountModal({
  open,
  onClose,
  editing,
  editForm,
  onEditFormChange,
  proxies,
  relays,
  tpState,
  onTpStateChange,
  locks,
  onSave,
  onUnlock,
  isSaving,
  isUnlocking,
}: EditAccountModalProps) {
  const saveDisabled =
    isSaving ||
    (tpState.mode === 'relay' && !tpState.relayId) ||
    (tpState.mode === 'proxy' && !tpState.proxyId) ||
    (tpState.mode === 'pool' && tpState.pool.length === 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit "${editing?.label ?? ''}"`}
      footer={
        <Button
          onClick={() => {
            if (!editing) return;
            onSave(buildEditPayload(editing, editForm, tpState));
          }}
          disabled={saveDisabled}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field
          id="edit-label"
          label="Label"
          name="label"
          value={editForm.label}
          onInput={(v) => onEditFormChange({ ...editForm, label: v })}
          autocomplete="off"
        />
        <Field
          id="edit-api-key"
          label="New API key (leave empty to keep current)"
          name="api-key"
          value={editForm.api_key}
          onInput={(v) => onEditFormChange({ ...editForm, api_key: v })}
          placeholder="mm_…"
          autocomplete="off"
        />
        {editing?.provider === 'kiro' && (
          <label>
            Persona (upstream identity)
            <select
              value={editForm.persona}
              onChange={(e) =>
                onEditFormChange({ ...editForm, persona: (e.target as HTMLSelectElement).value })
              }
              class="input"
            >
              <option value="ide">IDE (legacy · stable · codewhisperer.amazonaws.com)</option>
              <option value="cli">CLI (experimental · runtime.kiro.dev)</option>
            </select>
            <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
              IDE mimics the Kiro IDE wire format (default, battle-tested). CLI mimics the real
              kiro-cli (aws-sdk-rust / AmazonQ-For-CLI). Switch only this account; others stay on
              IDE.
            </span>
          </label>
        )}

        {/* --- Transport (proxy / relay) assignment --- */}
        <TransportAssignment
          tpState={tpState}
          setTpState={onTpStateChange}
          proxies={proxies}
          relays={relays}
        />

        {/* --- Model Locks --- */}
        {locks.length > 0 && (
          <div style={{ borderTop: '1px solid var(--ink-3)', paddingTop: 12, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
              🔒 Locked models
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {locks.map((l) => (
                <div
                  key={l.model}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--ink-2)',
                    borderRadius: 6,
                    padding: '6px 10px',
                  }}
                >
                  <div>
                    <span class="mono" style={{ fontSize: 12 }}>
                      {l.model}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 8 }}>
                      until {relativeTime(l.locked_until)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onUnlock(l.model)}
                    disabled={isUnlocking}
                  >
                    Unlock
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Build the PATCH payload for an account edit. Encodes the same field-omission
 * + transport-mode clearing rules the inline closure used in Accounts.tsx:
 * - label / api_key only sent when non-empty.
 * - persona only sent for kiro accounts and only when it changed.
 * - transport: send the active mode's fields, clear the others.
 */
export function buildEditPayload(
  editing: Account,
  editForm: EditForm,
  tpState: TransportState
): EditPayload {
  const payload: EditPayload = { id: editing.id };
  if (editForm.label) payload.label = editForm.label;
  if (editForm.api_key) payload.api_key = editForm.api_key;
  if (editing.provider === 'kiro' && editForm.persona !== editing.persona) {
    payload.persona = editForm.persona;
  }
  // Transport assignment — send the active mode's fields, clearing others.
  if (tpState.mode === 'none') {
    payload.relayId = '';
    payload.proxyId = '';
    payload.proxyPool = [];
  } else if (tpState.mode === 'relay') {
    payload.relayId = tpState.relayId;
    payload.proxyId = '';
    payload.proxyPool = [];
  } else if (tpState.mode === 'proxy') {
    payload.relayId = '';
    payload.proxyId = tpState.proxyId;
    payload.proxyPool = [];
  } else if (tpState.mode === 'pool') {
    payload.relayId = '';
    payload.proxyId = '';
    payload.proxyPool = tpState.pool;
    payload.proxyRotateEvery = tpState.rotate;
  }
  return payload;
}
