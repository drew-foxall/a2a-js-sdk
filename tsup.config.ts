import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/server/index.ts',
    'src/server/core/index.ts',
    'src/server/express/index.ts',
    'src/server/hono/index.ts',
    'src/server/adapters/hono.ts',
    'src/server/adapters/elysia.ts',
    'src/server/adapters/itty-router.ts',
    'src/server/adapters/fresh.ts',
    'src/server/adapters/web-standard.ts',
    'src/server/adapters/express.ts',
    'src/client/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
});
