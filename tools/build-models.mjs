// npm run models: rebuild every plane spec and weapon from scratch with headless Blender, compress with
// gltf-transform (meshopt), write public/models/<era>/<id>.glb (detailed, Medium/High), <id>_lod.glb (low-poly:
// Low and distance) and <id>_detail.ktx2 (baked AO + panel lines, team mask in alpha; ETC1S via ktx2-encoder,
// decoded with Python + Pillow), public/models/manifest.json and src/data/planeModels.json, then print sizes.
//
//   npm run models                 # everything
//   npm run models -- f4e camel    # only some planes (ids), plus "weapons"
//   BLENDER=/path/to/Blender npm run models
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';
import { eyeFromSpec } from './eye-from-spec.mjs';

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

/** PNG → KTX2 (ETC1S, mipmapped, RGBA: the alpha slice keeps the team mask clean). */
async function encodeDetail(src, dst) {
  const decode = async () => {
    const out = join(raw, '_detail.rgba');
    execFileSync('python3', ['-I', '-c', `from PIL import Image\nim=Image.open(${JSON.stringify(src)}).convert('RGBA')\nopen(${JSON.stringify(out)},'wb').write(im.tobytes())\nprint(im.size[0])`]);
    const size = 512;
    return { data: new Uint8Array(readFileSync(out)), width: size, height: size };
  };
  const ktx = await encodeToKTX2(new Uint8Array(readFileSync(src)), { isUASTC: false, generateMipmap: true, qualityLevel: 200, compressionLevel: 2, isSetKTX2SRGBTransferFunc: false, imageDecoder: decode });
  writeFileSync(dst, ktx);
  return ktx.length;
}

const rows = [];
for (const f of readdirSync(raw).filter((x) => x.endsWith('.glb') && !x.endsWith('_lod.glb')).sort()) {
  const id = f.replace(/\.glb$/, '');
  const info = JSON.parse(readFileSync(join(raw, `${id}.json`), 'utf8'));
  const file = `models/${info.era}/${id}.glb`;
  const lodFile = `models/${info.era}/${id}_lod.glb`;
  const detailFile = `models/${info.era}/${id}_detail.ktx2`;
  const bytes = compress(join(raw, f), join(root, 'public', file));
  const lodBytes = compress(join(raw, `${id}_lod.glb`), join(root, 'public', lodFile));
  const detailBytes = await encodeDetail(join(raw, `${id}_detail.png`), join(root, 'public', detailFile));
  manifest.planes[id] = { file, lodFile, detailFile, era: info.era, bytes: bytes + lodBytes + detailBytes, tris: info.tris, lodTris: info.lodTris };
  planeData[id] = {
    file,
    lodFile,
    detailFile,
    lodTris: info.lodTris,
    lengthM: info.lengthM,
    wingspanM: info.wingspanM,
    heightM: info.heightM,
    tris: info.tris,
    muzzles: info.muzzles,
    pylons: info.pylons,
    exhausts: info.exhausts,
    prop: info.prop,
    engine: info.engine,
    eye: info.eye ?? eyeFromSpec(JSON.parse(readFileSync(join(root, 'tools/blender/specs', `${id}.json`), 'utf8'))),
  };
  rows.push([id, info.era, `${info.tris}/${info.lodTris}`, bytes + lodBytes + detailBytes]);
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
  console.log(`${id.padEnd(24)} ${era.padEnd(12)} ${String(tris).padStart(9)} ${(bytes / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`\nTotal model size: ${(total / 1024).toFixed(1)} KB (${Object.keys(manifest.planes).length} planes, ${Object.keys(manifest.weapons).length} weapons)`);
