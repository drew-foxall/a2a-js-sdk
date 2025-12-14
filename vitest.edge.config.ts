import { mergeConfig } from 'vitest/config';
import defaultConfig from './vitest.config';

/**
 * Vitest configuration for Edge runtime testing.
 *
 * This config runs all tests EXCEPT the express subfolder, which contains
 * Node.js-specific code (Express framework) that is not compatible with
 * Edge runtime environments.
 *
 * Includes:
 * - Hono tests (test/server/a2a_hono_app.spec.ts) - Hono is designed for edge runtimes
 * - All other tests that are edge-compatible
 *
 * The Edge runtime is provided by @edge-runtime/vm, which emulates
 * Cloudflare Workers, Vercel Edge Functions, and similar environments.
 */
export default mergeConfig(defaultConfig, {
  test: {
    environment: 'edge-runtime',
    exclude: [
      // Express tests require Node.js-specific APIs (http, Express framework)
      'test/server/a2a_express_app.spec.ts',
      // Node modules should always be excluded
      '**/node_modules/**',
    ],
  },
});
