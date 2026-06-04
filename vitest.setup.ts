import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Ensure no test accidentally opens the real user DB.
// Tests override this in beforeEach for per-test isolation.
if (!process.env.ROUTER_DB_PATH) {
  process.env.ROUTER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'vitest-')), 't.db');
}
