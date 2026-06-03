import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:20137',
      '/login': 'http://localhost:20137',
      '/logout': 'http://localhost:20137',
      '/v1': 'http://localhost:20137',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    server: {
      deps: {
        inline: [/@tanstack\/react-query/],
      },
    },
  },
});
