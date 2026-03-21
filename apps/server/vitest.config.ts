import path from 'node:path';
import { defineConfig } from 'vitest/config';

const monorepoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  test: {
    root: '.',
    exclude: ['dist/**', 'node_modules/**'],
    passWithNoTests: true,
    projects: [
      {
        envDir: monorepoRoot,
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts', 'dist/**', 'node_modules/**'],
          testTimeout: 10_000,
          hookTimeout: 10_000,
          passWithNoTests: true,
        },
      },
      {
        envDir: monorepoRoot,
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          exclude: ['dist/**', 'node_modules/**'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          passWithNoTests: true,
          globalSetup: ['src/test/setup-integration.ts'],
          pool: 'forks',
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
