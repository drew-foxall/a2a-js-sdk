import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    exclude: [
      // Hono tests require Edge runtime environment
      'test/server/a2a_hono_app.spec.ts',
      // Node modules should always be excluded
      '**/node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
