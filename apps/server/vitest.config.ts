import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    exclude: ['dist/**', 'node_modules/**'],
    passWithNoTests: true,
    projects: [
      {
        envDir: '.',
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts', 'dist/**', 'node_modules/**'],
          testTimeout: 10_000,
          hookTimeout: 10_000,
        },
      },
      {
        envDir: '.',
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          exclude: ['dist/**', 'node_modules/**'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          globalSetup: ['src/test/setup-integration.ts'],
          pool: 'forks',
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
