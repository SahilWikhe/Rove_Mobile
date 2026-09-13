import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Each package retains its normal test working directory. LCOV paths use the repository root.
export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: [['lcov', { projectRoot: fileURLToPath(new URL('.', import.meta.url)) }], 'text-summary'],
    },
  },
});
