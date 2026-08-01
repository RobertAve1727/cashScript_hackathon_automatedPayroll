import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The eSahod covenant tests build real CashTokens transactions and let
    // libauth's BCH VM evaluate every input — a single `send()` against a
    // 284-opcode covenant genuinely takes several seconds. This is a
    // characteristic of testing against the real VM rather than a stub, not
    // flakiness to paper over with more retries.
    testTimeout: 30_000,
    coverage: {
      include: ['src/**/*.ts'],
      // The composition root is wiring only; it is covered by the CLI tests.
      exclude: ['src/main/cli.ts'],
    },
  },
});
