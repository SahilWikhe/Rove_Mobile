import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Each package retains its normal test working directory. LCOV paths use the repository root.
export default defineConfig({
  test: {
    // Integration files start disposable PostgreSQL; avoid competing instances on CI runners.
    maxWorkers: process.env.CI ? 1 : undefined,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: [['lcov', { projectRoot: fileURLToPath(new URL('.', import.meta.url)) }], 'text-summary'],
    },
  },
});
