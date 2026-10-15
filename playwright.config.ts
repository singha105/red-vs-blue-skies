import { defineConfig, devices } from '@playwright/test';

const PORT = 4187; // not 4173: other local tools use the Vite default
// BASE_URL=https://singha105.github.io/red-vs-blue-skies/ npx playwright test  → test the live site instead.
const REMOTE = process.env['BASE_URL'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1, // 8 GB Mac: one browser at a time
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}/red-vs-blue-skies/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', testIgnore: /perf\.spec/, use: { ...devices['Desktop Chrome'] } },
    // Landscape is how the game is played; the portrait rotate prompt is covered by its own test.
    { name: 'iphone-13', testIgnore: /perf\.spec/, use: { ...devices['iPhone 13 landscape'] } },
    // Frame-rate budget needs the real GPU: full Chromium (not the software-rendered headless shell).
    {
      name: 'perf',
      testMatch: /perf\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-features=Vulkan'] },
      },
    },
  ],
  webServer: [
    ...(REMOTE
      ? []
      : [
          {
            command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
            url: `http://localhost:${PORT}/red-vs-blue-skies/`,
            reuseExistingServer: !process.env['CI'],
            timeout: 120_000,
          },
        ]),
    // Local PeerJS signaling for multiplayer.spec (pages opt in with ?signal=localhost:9187).
    { command: 'node tests/e2e/peer-server.mjs', url: 'http://localhost:9187/peerjs/id', reuseExistingServer: !process.env['CI'], timeout: 30_000 },
  ],
});
