import { defineConfig, mergeConfig } from 'vitest/config';
import sharedConfig from '../../packages/config/vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      root: '.',
      exclude: ['dist/**', 'node_modules/**'],
    },
  }),
);
