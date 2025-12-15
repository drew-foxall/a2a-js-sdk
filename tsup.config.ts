import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/server/index.ts',
    'src/server/core/index.ts',
    'src/server/express/index.ts',
    'src/server/express-adapter/index.ts',
    'src/server/hono/index.ts',
    'src/server/elysia/index.ts',
    'src/server/itty-router/index.ts',
    'src/server/fresh/index.ts',
    'src/server/web-standard/index.ts',
    'src/client/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
});
