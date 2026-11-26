import { defineConfig } from 'vitest/config';

const shared = {
  globals: true,
  root: './',
} as const;

// Unit tests stay parallel. PostgreSQL suites each start a disposable
// container, so they run one file at a time and cannot exhaust Docker.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'unit',
          ...shared,
          include: ['**/*.spec.ts'],
          exclude: ['**/*.postgres.spec.ts'],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'postgres',
          ...shared,
          include: ['**/*.postgres.spec.ts'],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          // docker rm in afterAll exceeds Vitest's 10s hook limit when the daemon is busy.
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
