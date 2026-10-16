// Phone-proxy profile (Day 10): Chromium with the GPU, iPhone-size viewport (844×390 @3x capped by the game),
// 4× CPU throttling. Prints first load on a 4G connection, frame times, draw calls, JS heap growth and the top
// allocation sites during a fight. Needs `npx vite preview --port 4187` running (or BASE_URL).
//   node tools/perf/profile.mjs [era] [planeId] [map] [mode]
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4187/red-vs-blue-skies/';
const [era = 'modern', planeId = 'f15c', map = 'mountain_valley', mode = 'ground_strike'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: false, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

// 1. First load over 4G (Chrome DevTools' "Slow 4G": 150 ms RTT, 1.6 Mbps down, 750 kbps up), 4× CPU, cold cache.
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
let bytes = 0;
cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
const t0 = Date.now();
await page.goto(`${base}?debug=1&gfx=low`);
await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
const ready = Date.now() - t0;
await page.waitForFunction(() => document.querySelector('.title') !== null);
await page.waitForTimeout(1500);
console.log(`first load (Slow 4G, 4x CPU): title ready ${(ready / 1000).toFixed(2)} s, ${(bytes / 1024).toFixed(0)} KB over the wire by then+1.5 s`);
// Day 11: first match playable, still on Slow 4G: start the solo match (its map's heightmap and the era's plane
// models download now) and wait until the player's plane is in the air with its model.
const t1 = Date.now();
await page.evaluate((c) => window.__rvbs.startSolo(c), { era, planeId, map, mode });
await page.waitForFunction(() => window.__rvbs.mode() === 'match' && window.__rvbs.models().some((m) => !m.placeholder), null, { timeout: 60_000, polling: 100 });
const matchMs = Date.now() - t1;
console.log(`first match playable (Slow 4G, 4x CPU): ${((ready + 1500 + matchMs) / 1000).toFixed(2)} s from opening the page (match start took ${(matchMs / 1000).toFixed(2)} s), ${(bytes / 1024).toFixed(0)} KB in all`);
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// 2. A fight at low graphics with 4× CPU throttling (the match is already running).
await page.waitForTimeout(20_000);
// GC pauses over 8 s (trace events), then the allocation sample over the next 8 s.
const gc = { minor: 0, major: 0, ms: 0, worst: 0 };
const traceDone = new Promise((res) => cdp.on('Tracing.tracingComplete', res));
cdp.on('Tracing.dataCollected', ({ value }) => {
  for (const e of value) {
    if (e.ph !== 'X' || !e.dur) continue;
    const minor = e.name === 'MinorGC' || e.name === 'ScavengeTask' || e.name === 'V8.GCScavenger';
    const major = e.name === 'MajorGC' || e.name === 'V8.GCFinalizeMC' || e.name === 'V8.GCIncrementalMarking';
    if (!minor && !major) continue;
    if (minor) gc.minor++;
    else gc.major++;
    gc.ms += e.dur / 1000;
    gc.worst = Math.max(gc.worst, e.dur / 1000);
  }
});
await cdp.send('Tracing.start', { categories: 'v8,disabled-by-default-v8.gc,devtools.timeline', transferMode: 'ReportEvents' });
await page.waitForTimeout(8000);
await cdp.send('Tracing.end');
await traceDone;
console.log(`GC over 8 s: ${gc.minor} minor + ${gc.major} major events, ${gc.ms.toFixed(1)} ms total (${(gc.ms / 80).toFixed(2)}% of the time), worst ${gc.worst.toFixed(2)} ms`);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');
const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const frames = await page.evaluate(async () => {
  const t = [];
  const start = performance.now();
  await new Promise((res) => {
    const f = (now) => {
      t.push(now);
      if (now - start < 8000) requestAnimationFrame(f);
      else res();
    };
    requestAnimationFrame(f);
  });
  return t;
});
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
const dts = frames.slice(1).map((v, i) => v - frames[i]).sort((a, b) => a - b);
const pct = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(1);
const info = await page.evaluate(() => ({ calls: window.__rvbs.drawCalls(), tris: window.__rvbs.triangles(), fps: window.__rvbs.fps() }));
console.log(`${era} ${planeId} ${map} ${mode}: ${(dts.length / 8).toFixed(1)} fps, frame ms p50 ${pct(0.5)} p95 ${pct(0.95)} p99 ${pct(0.99)} max ${dts[dts.length - 1].toFixed(1)}; ${info.calls} draw calls, ${info.tris} triangles`);

// Allocation sites: self size per function over the 8 s (sampled, includes garbage).
const sites = new Map();
let total = 0;
const walk = (n) => {
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
  sites.set(key, (sites.get(key) ?? 0) + n.selfSize);
  total += n.selfSize;
  n.children.forEach(walk);
};
walk(profile.head);
console.log(`allocated ~${(total / 1024 / 1024 / 8).toFixed(2)} MB/s (sampled); heap after GC ${(heap0 / 1048576).toFixed(1)} MB → ${(heap1 / 1048576).toFixed(1)} MB`);
for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(v / 1024 / 8).toFixed(0).padStart(6)} KB/s  ${k}`);
await browser.close();
