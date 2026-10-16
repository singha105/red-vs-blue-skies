// Bot tournament (npm run balance): not part of npm test, it takes minutes.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/balance/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setupTerrain.ts'],
    testTimeout: 3_600_000,
  },
});
