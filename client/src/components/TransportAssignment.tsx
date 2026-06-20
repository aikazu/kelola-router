import type { Transport, TransportState } from '../lib/types';

interface TransportAssignmentProps {
  tpState: TransportState;
  setTpState: (state: TransportState) => void;
  proxies: Transport[];
  relays: Transport[];
}

export function TransportAssignment({ tpState, setTpState, proxies, relays }: TransportAssignmentProps) {
  return (
    <div style={{ borderTop: '1px solid var(--ink-3)', paddingTop: 12, marginTop: 4 }}>
      <label>
        Network transport
        <select
          name="transport-mode"
          value={tpState.mode}
          onChange={(e) =>
            setTpState({ ...tpState, mode: (e.target as HTMLSelectElement).value as 'none' | 'proxy' | 'pool' | 'relay' })
          }
          class="input"
        >
          <option value="none">Direct / global default</option>
          <option value="proxy">Single proxy</option>
          <option value="relay">Relay</option>
          <option value="pool">Proxy pool (round-robin)</option>
        </select>
      </label>

      {tpState.mode === 'proxy' && (
        <label style={{ marginTop: 10, display: 'block' }}>
          Proxy
          <select
            name="proxy-id"
            value={tpState.proxyId}
            onChange={(e) => setTpState({ ...tpState, proxyId: (e.target as HTMLSelectElement).value })}
            class="input"
          >
            <option value="">— select proxy —</option>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.kind})
                {p.enabled ? '' : ' · disabled'}
              </option>
            ))}
          </select>
        </label>
      )}

      {tpState.mode === 'relay' && (
        <label style={{ marginTop: 10, display: 'block' }}>
          Relay
          <select
            name="relay-id"
            value={tpState.relayId}
            onChange={(e) => setTpState({ ...tpState, relayId: (e.target as HTMLSelectElement).value })}
            class="input"
          >
            <option value="">— select relay —</option>
            {relays.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.kind})
                {r.enabled ? '' : ' · disabled'}
              </option>
            ))}
          </select>
        </label>
      )}

      {tpState.mode === 'pool' && (
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Pool members (proxies)</span>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginTop: 6,
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            {proxies.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                No proxies yet — add some on the Proxies page.
              </span>
            ) : null}
            {proxies.map((p) => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  name="pool-member"
                  checked={tpState.pool.includes(p.id)}
                  onChange={(e) => {
                    const on = (e.target as HTMLInputElement).checked;
                    setTpState({
                      ...tpState,
                      pool: on ? [...tpState.pool, p.id] : tpState.pool.filter((x) => x !== p.id),
                    });
                  }}
                />
                {p.label}
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
                  ({p.kind})
                  {p.enabled ? '' : ' · disabled'}
                </span>
              </label>
            ))}
          </div>
          <label style={{ marginTop: 10, display: 'block' }}>
            Rotate every N requests
            <input
              type="number"
              name="rotate"
              min={1}
              value={tpState.rotate}
              onInput={(e) => setTpState({ ...tpState, rotate: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })}
              autocomplete="off"
              class="input"
            />
            <span style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4, display: 'block' }}>
              The router uses one proxy for N requests, then advances to the next pool member.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
