// Pilot eye position (plane-local metres: +Z forward, +Y up, origin mid-fuselage) from a classic (Day 4–11) spec's
// canopy, for the cockpit view. Day 12 specs export their eye point directly.
//   node tools/eye-from-spec.mjs   → writes `eye` into src/data/planeModels.json for every plane that lacks one
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lerp = (a, b, k) => a + (b - a) * k;

function sectionAt(secs, t) {
  if (t <= secs[0][0]) return secs[0].slice(1);
  for (let i = 0; i + 1 < secs.length; i++) {
    const a = secs[i];
    const b = secs[i + 1];
    if (a[0] <= t && t <= b[0]) {
      const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3] ?? 0, b[3] ?? 0, k)];
    }
  }
  return secs[secs.length - 1].slice(1);
}

export function eyeFromSpec(spec) {
  const c = spec.canopy;
  const secs = spec.fuselage?.sections;
  if (!c || !secs) return null;
  const t = c.positionAlongLength;
  const ln = c.lengthM ?? 1.6;
  const ch = c.heightM ?? 0.55;
  const [, h, y] = sectionAt(secs, t);
  const top = (y ?? 0) + h / 2;
  const z = spec.lengthM * (0.5 - t) - ln * 0.1;
  const eyeY = c.type === 'open' ? top + 0.18 : top - 0.08 + ch * 0.62;
  return [0, Math.round(eyeY * 1000) / 1000, Math.round(z * 1000) / 1000];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('..', import.meta.url).pathname;
  const dataPath = join(root, 'src/data/planeModels.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const specDir = join(root, 'tools/blender/specs');
  let n = 0;
  for (const f of readdirSync(specDir).filter((x) => x.endsWith('.json'))) {
    const spec = JSON.parse(readFileSync(join(specDir, f), 'utf8'));
    if (!data[spec.id] || data[spec.id].eye || !existsSync(join(specDir, f))) continue;
    const eye = eyeFromSpec(spec);
    if (eye) {
      data[spec.id].eye = eye;
      n++;
    }
  }
  writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`eye points written for ${n} planes`);
}
