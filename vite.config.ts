import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // Bound to all interfaces so the dev server is reachable when Vite runs
    // inside the sandbox VM rather than on the host.
    host: true,
    port: 12510,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 12511,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
