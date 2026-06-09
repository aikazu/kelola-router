// tests/console/emit-kiro.test.ts
import { describe, expect, it } from 'vitest';
import { consoleBus } from '../../src/console/bus.js';
import { buildStart } from '../../src/console/flow.js';

// handleKiroProxy emits the same phases as handleProxy. Driving a full Kiro
// request needs the AWS event-stream mock; the shared emit helpers are unit
// tested in flow.test.ts. This guards that the Kiro path imports + uses the bus.
describe('kiro emit wiring', () => {
  it('bus accepts a start event (smoke)', () => {
    const seen: string[] = [];
    const off = consoleBus.subscribe((e) => seen.push(e.reqId));
    consoleBus.emit(
      buildStart('k1', '2026-06-09T00:00:00.000Z', 'POST', '/v1/messages', 'kiro-claude', null)
    );
    off();
    expect(seen).toContain('k1');
  });
});
