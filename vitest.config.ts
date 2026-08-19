import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // forks pool: threads pool segfaults at teardown with better-sqlite3 (native) on Windows/Node 24.
    // Each test file overrides ROUTER_DB_PATH in beforeEach, so parallel forks are safe.
    pool: 'forks',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    env: {
      MINIMAX_API_KEY: 'mm_test_key',
    },
    // Use a per-suite tmp DB so tests never touch the real ~/.local/share/kelola-router DB.
    // Each test file should still override ROUTER_DB_PATH in beforeEach for full isolation.
    setupFiles: ['./vitest.setup.ts'],
  },
});
