import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      // The composition root is wiring only; it is covered by the CLI tests.
      exclude: ['src/main/cli.ts'],
    },
  },
});
