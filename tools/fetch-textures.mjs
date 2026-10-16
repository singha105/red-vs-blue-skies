// Downloads the CC0 Poly Haven textures and sky HDRI the terrain and lighting use, and encodes the textures
// to KTX2 (Basis Universal ETC1S, mipmapped) with the ktx2-encoder WebAssembly build. Python + Pillow decodes
// the JPGs and resizes them (the encoder needs raw RGBA in Node). Raw downloads stay in tools/build/polyhaven/
// (gitignored); public/textures/ gets the .ktx2 files, the .hdr and CREDITS.txt.
//
//   npm run textures            (needs python3 with Pillow)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = new URL('../', import.meta.url);
const raw = new URL('tools/build/polyhaven/', root);
const out = new URL('public/textures/', root);
mkdirSync(raw, { recursive: true });
mkdirSync(out, { recursive: true });

/** name in the game → Poly Haven asset, maps wanted, size in the game. */
const TEXTURES = [
  { name: 'grass', asset: 'leafy_grass', maps: ['Diffuse', 'nor_gl'], size: 1024 },
  { name: 'forest', asset: 'forest_ground_04', maps: ['Diffuse'], size: 512 },
  { name: 'rock', asset: 'lichen_rock', maps: ['Diffuse', 'nor_gl'], size: 1024 },
  { name: 'snow', asset: 'snow_field_aerial', maps: ['Diffuse'], size: 512 },
  { name: 'sand', asset: 'coast_sand_01', maps: ['Diffuse'], size: 512 },
];
const HDRI = { name: 'sky', asset: 'kloofendal_48d_partly_cloudy_puresky', res: '1k' };

async function get(url, file) {
  if (existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const decodeWith = (size) => async (buf) => {
  // Hand the image to Pillow through files: resize, RGBA bytes back.
  const tmpIn = new URL('tools/build/polyhaven/_in', root).pathname;
  const tmpOut = new URL('tools/build/polyhaven/_out.rgba', root).pathname;
  writeFileSync(tmpIn, buf);
  execFileSync('python3', ['-I', '-c', `from PIL import Image\nim=Image.open(${JSON.stringify(tmpIn)}).convert('RGBA').resize((${size},${size}), Image.LANCZOS)\nopen(${JSON.stringify(tmpOut)},'wb').write(im.tobytes())`]);
  return { data: new Uint8Array(readFileSync(tmpOut)), width: size, height: size };
};

const credits = [];
/** Average linear colour of each colour texture (the shader divides by it: the palette sets the colour). */
const averages = {};
for (const t of TEXTURES) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${t.asset}`)).json();
  for (const map of t.maps) {
    const url = files[map]['1k'].jpg.url;
    const src = new URL(`${t.asset}_${map}.jpg`, raw).pathname;
    await get(url, src);
    const normal = map !== 'Diffuse';
    const ktx = await encodeToKTX2(new Uint8Array(readFileSync(src)), {
      // Normal maps keep more precision in UASTC; colour maps are fine (and 4× smaller) in ETC1S.
      isUASTC: normal,
      needSupercompression: normal,
      generateMipmap: true,
      isNormalMap: normal,
      isSetKTX2SRGBTransferFunc: !normal,
      qualityLevel: 160,
      compressionLevel: 2,
      // Detail normals only matter near the camera; 512² keeps the UASTC files small.
      imageDecoder: decodeWith(normal ? Math.min(512, t.size) : t.size),
    });
    if (!normal) {
      const avg = execFileSync('python3', ['-I', '-c', `from PIL import Image\nim=Image.open(${JSON.stringify(src)}).convert('RGB').resize((64,64))\nlin=lambda c:((c/255+0.055)/1.055)**2.4 if c>10 else c/255/12.92\npx=list(im.getdata())\nprint(','.join(str(round(sum(lin(p[k]) for p in px)/len(px),5)) for k in range(3)))`]).toString().trim();
      averages[t.name] = avg.split(',').map(Number);
    }
    const file = `${t.name}${normal ? '_normal' : ''}.ktx2`;
    writeFileSync(new URL(file, out), ktx);
    console.log(`${file}: ${(ktx.length / 1024).toFixed(0)} KB (${t.asset}, ${t.size}²)`);
  }
  credits.push(`${t.name}: "${t.asset}" by Poly Haven, CC0, https://polyhaven.com/a/${t.asset}`);
}
const hdrFiles = await (await fetch(`https://api.polyhaven.com/files/${HDRI.asset}`)).json();
await get(hdrFiles.hdri[HDRI.res].hdr.url, new URL(`${HDRI.name}.hdr`, out).pathname);
credits.push(`${HDRI.name}.hdr: "${HDRI.asset}" by Poly Haven, CC0, https://polyhaven.com/a/${HDRI.asset}`);
writeFileSync(new URL('src/data/textureAverages.json', root), `${JSON.stringify(averages, null, 2)}\n`);
writeFileSync(new URL('CREDITS.txt', out), `Textures and HDRI from Poly Haven (https://polyhaven.com), public domain (CC0).\n\n${credits.join('\n')}\n`);
console.log('done');
