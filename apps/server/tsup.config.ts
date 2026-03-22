import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  minify: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  noExternal: ['@identity-starter/core', '@identity-starter/db', '@identity-starter/redis'],
  external: ['@node-rs/argon2', 'postgres'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
