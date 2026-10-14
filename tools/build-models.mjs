// npm run models: rebuild every plane spec and weapon from scratch with headless Blender, compress with
// gltf-transform (meshopt), write public/models/<era>/<id>.glb, public/models/manifest.json and
// src/data/planeModels.json (dimensions, muzzles, pylons for the simulation), then print the sizes.
//
//   npm run models                 # everything
//   npm run models -- f4e camel    # only some planes (ids), plus "weapons"
//   BLENDER=/path/to/Blender npm run models
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const raw = join(root, 'tools/blender/build');
const previews = join(root, 'tools/blender/previews');
const publicModels = join(root, 'public/models');
const only = process.argv.slice(2);
const full = only.length === 0;

if (!existsSync(BLENDER)) {
  console.error(`Blender not found at ${BLENDER}. Set BLENDER=/path/to/Blender.`);
  process.exit(1);
}

// Clean state: a full build throws away every previous output first.
if (full) {
  for (const dir of [raw, previews]) rmSync(dir, { recursive: true, force: true });
  for (const entry of existsSync(publicModels) ? readdirSync(publicModels) : []) {
    if (entry !== '.gitkeep') rmSync(join(publicModels, entry), { recursive: true, force: true });
  }
}
mkdirSync(raw, { recursive: true });

console.log(`Blender: ${execFileSync(BLENDER, ['--version']).toString().split('\n')[0]}`);
const t0 = Date.now();
execFileSync(
  BLENDER,
  ['--background', '--factory-startup', '--python-exit-code', '1', '--python', join(root, 'tools/blender/build_all.py'), '--', raw, previews, ...only],
  { stdio: ['ignore', 'pipe', 'inherit'] },
)
  .toString()
  .split('\n')
  .filter((l) => l.startsWith('BUILT') || l.startsWith('BUDGET'))
  .forEach((l) => console.log(l));
console.log(`Blender finished in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const gltfTransform = join(root, 'node_modules/.bin/gltf-transform');
const compress = (src, dst) => {
  mkdirSync(join(dst, '..'), { recursive: true });
  execFileSync(gltfTransform, ['meshopt', src, dst], { stdio: ['ignore', 'ignore', 'inherit'] });
  return statSync(dst).size;
};

const manifestPath = join(publicModels, 'manifest.json');
const dataPath = join(root, 'src/data/planeModels.json');
const manifest = existsSync(manifestPath) && !full ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { planes: {}, weapons: {} };
const planeData = existsSync(dataPath) && !full ? JSON.parse(readFileSync(dataPath, 'utf8')) : {};

const rows = [];
for (const f of readdirSync(raw).filter((x) => x.endsWith('.glb')).sort()) {
  const id = f.replace(/\.glb$/, '');
  const info = JSON.parse(readFileSync(join(raw, `${id}.json`), 'utf8'));
  const file = `models/${info.era}/${id}.glb`;
  const bytes = compress(join(raw, f), join(root, 'public', file));
  manifest.planes[id] = { file, era: info.era, bytes, tris: info.tris };
  planeData[id] = {
    file,
    lengthM: info.lengthM,
    wingspanM: info.wingspanM,
    heightM: info.heightM,
    tris: info.tris,
    muzzles: info.muzzles,
    pylons: info.pylons,
    exhausts: info.exhausts,
    prop: info.prop,
  };
  rows.push([id, info.era, info.tris, bytes]);
}
const weaponDir = join(raw, 'weapons');
for (const f of existsSync(weaponDir) ? readdirSync(weaponDir).filter((x) => x.endsWith('.glb')).sort() : []) {
  const id = f.replace(/\.glb$/, '');
  const info = JSON.parse(readFileSync(join(weaponDir, `${id}.json`), 'utf8'));
  const file = `models/weapons/${id}.glb`;
  const bytes = compress(join(weaponDir, f), join(root, 'public', file));
  manifest.weapons[id] = { file, bytes, tris: info.tris };
  rows.push([id, 'weapon', info.tris, bytes]);
}

const total = [...Object.values(manifest.planes), ...Object.values(manifest.weapons)].reduce((n, m) => n + m.bytes, 0);
manifest.totalBytes = total;
const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
writeFileSync(manifestPath, JSON.stringify({ ...manifest, planes: sorted(manifest.planes), weapons: sorted(manifest.weapons) }, null, 2) + '\n');
writeFileSync(dataPath, JSON.stringify(sorted(planeData), null, 2) + '\n');

console.log('\nmodel                    era          tris    size');
for (const [id, era, tris, bytes] of rows) {
  console.log(`${id.padEnd(24)} ${era.padEnd(12)} ${String(tris).padStart(5)} ${(bytes / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`\nTotal model size: ${(total / 1024).toFixed(1)} KB (${Object.keys(manifest.planes).length} planes, ${Object.keys(manifest.weapons).length} weapons)`);
