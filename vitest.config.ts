import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    env: {
      MINIMAX_API_KEY: 'mm_test_key',
    },
    // Use a per-suite tmp DB so tests never touch the real ~/.local/share/kelola-router DB.
    // Each test file should still override ROUTER_DB_PATH in beforeEach for full isolation.
    setupFiles: ['./vitest.setup.ts'],
  },
});
