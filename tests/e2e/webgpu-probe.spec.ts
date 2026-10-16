import { expect, test } from '@playwright/test';

// Day 11: does three's WebGPURenderer start (WebGPU, or its WebGL 2 fallback) in the iPhone (WebKit) profile?
// Frame rates here are software-rendered and meaningless; perf.spec measures them on the GPU.
test('WebGPURenderer starts or falls back cleanly', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the desktop numbers come from the perf project');
  test.setTimeout(90_000);
  await page.goto('./?debug=1&webgpuprobe=1');
  const r = (await page.waitForFunction(() => (window as unknown as { __webgpuProbe?: unknown }).__webgpuProbe, null, { timeout: 70_000 }).then((h) => h.jsonValue())) as { webgpuBackend: string; error: string | null };
  console.log(`webgpu probe (iPhone profile): ${JSON.stringify(r)}`);
  expect(['webgpu', 'webgl2-fallback', 'failed']).toContain(r.webgpuBackend);
});
