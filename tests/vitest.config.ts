import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@job-scheduler/shared': path.resolve(__dirname, '../packages/shared/src'),
      '@job-scheduler/backend-shared': path.resolve(__dirname, '../backend/shared/src'),
      '@job-scheduler/worker': path.resolve(__dirname, '../backend/worker/src'),
      '@job-scheduler/scheduler': path.resolve(__dirname, '../backend/scheduler/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/'],
    },
    testTimeout: 15000,
  },
});
