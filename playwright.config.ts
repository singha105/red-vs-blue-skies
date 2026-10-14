import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1, // 8 GB Mac: one browser at a time
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/red-vs-blue-skies/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // Landscape is how the game is played; the portrait rotate prompt is covered by its own test.
    { name: 'iphone-13', use: { ...devices['iPhone 13 landscape'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/red-vs-blue-skies/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
