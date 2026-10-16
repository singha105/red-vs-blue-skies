// Wingtip vapour ribbons (Day 11): above 6 G (5 for propeller planes) each wingtip trails a thin white ribbon
// that curves back with the turn and fades over about a second. Every ribbon lives in one dynamic buffer (one draw
// call); each is a strip of camera-facing quads through the tip's recent positions. Off on Low.
import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Sphere, UniformsLib, UniformsUtils, Vector3 } from 'three';

const MAX_RIBBONS = 48;
const SAMPLES = 26;
/** Seconds a ribbon point lasts, and the minimum spacing between points. */
const LIFE_S = 1.1;
const STEP_S = 1 / 30;
const VERTS_PER_RIBBON = (SAMPLES - 1) * 6;

interface Ribbon {
  key: string;
  /** Ring buffers: positions, ages, strength (0..1 from the G load). */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  age: Float32Array;
  k: Float32Array;
  head: number;
  count: number;
  sinceSample: number;
  touched: boolean;
}

export interface Ribbons {
  mesh: Mesh;
  /** Feed a wingtip this frame: its world position and strength (0 = not pulling enough G). */
  feed(key: string, pos: Vector3, strength: number, dt: number): void;
  /** Age everything and rebuild the strips (call once per frame, after feeding). */
  update(dt: number, camera: Vector3): void;
  clear(): void;
}

export function createRibbons(): Ribbons {
  const positions = new Float32Array(MAX_RIBBONS * VERTS_PER_RIBBON * 3);
  const alphas = new Float32Array(MAX_RIBBONS * VERTS_PER_RIBBON);
  const geometry = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3);
  const alphaAttr = new BufferAttribute(alphas, 1);
  posAttr.setUsage(35048);
  alphaAttr.setUsage(35048);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('alpha', alphaAttr);
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new Sphere(new Vector3(), 1e6);
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog]),
    vertexShader: /* glsl */ `
      attribute float alpha;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vAlpha = alpha;
        vec4 mvPosition = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(vec3(1.0), vAlpha * 0.75);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  const ribbons = new Map<string, Ribbon>();
  const a = new Vector3();
  const b = new Vector3();
  const seg = new Vector3();
  const toCam = new Vector3();
  const side = new Vector3();

  const ribbonFor = (key: string): Ribbon | null => {
    let r = ribbons.get(key);
    if (!r) {
      if (ribbons.size >= MAX_RIBBONS) return null;
      r = {
        key,
        x: new Float32Array(SAMPLES),
        y: new Float32Array(SAMPLES),
        z: new Float32Array(SAMPLES),
        age: new Float32Array(SAMPLES).fill(LIFE_S),
        k: new Float32Array(SAMPLES),
        head: 0,
        count: 0,
        sinceSample: STEP_S,
        touched: true,
      };
      ribbons.set(key, r);
    }
    return r;
  };

  return {
    mesh,
    feed(key, pos, strength, dt) {
      if (strength <= 0 && !ribbons.has(key)) return;
      const r = ribbonFor(key);
      if (!r) return;
      r.touched = true;
      r.sinceSample += dt;
      if (r.sinceSample < STEP_S) {
        // Keep the newest point glued to the wingtip between samples.
        const i = (r.head - 1 + SAMPLES) % SAMPLES;
        if (r.count > 0) {
          r.x[i] = pos.x;
          r.y[i] = pos.y;
          r.z[i] = pos.z;
        }
        return;
      }
      r.sinceSample = 0;
      r.x[r.head] = pos.x;
      r.y[r.head] = pos.y;
      r.z[r.head] = pos.z;
      r.age[r.head] = 0;
      r.k[r.head] = strength;
      r.head = (r.head + 1) % SAMPLES;
      r.count = Math.min(SAMPLES, r.count + 1);
    },
    update(dt, camera) {
      let v = 0;
      for (const [key, r] of ribbons) {
        let live = 0;
        for (let i = 0; i < SAMPLES; i++) {
          r.age[i]! += dt;
          if (r.age[i]! < LIFE_S && r.k[i]! > 0) live++;
        }
        // A ribbon whose plane is gone (or that has fully faded) is dropped.
        if (live === 0 && !r.touched) {
          ribbons.delete(key);
          continue;
        }
        r.touched = false;
        // Oldest to newest.
        for (let n = 0; n < r.count - 1; n++) {
          const i0 = (r.head - r.count + n + SAMPLES) % SAMPLES;
          const i1 = (i0 + 1) % SAMPLES;
          const f0 = Math.max(0, 1 - r.age[i0]! / LIFE_S) * r.k[i0]!;
          const f1 = Math.max(0, 1 - r.age[i1]! / LIFE_S) * r.k[i1]!;
          if (f0 <= 0 && f1 <= 0) continue;
          a.set(r.x[i0]!, r.y[i0]!, r.z[i0]!);
          b.set(r.x[i1]!, r.y[i1]!, r.z[i1]!);
          seg.subVectors(b, a);
          toCam.subVectors(camera, a);
          side.crossVectors(seg, toCam);
          const l = side.length();
          if (l < 1e-6) continue;
          // Thin at the tip, spreading as it ages.
          const w0 = 0.12 + 0.5 * (r.age[i0]! / LIFE_S);
          const w1 = 0.12 + 0.5 * (r.age[i1]! / LIFE_S);
          side.multiplyScalar(1 / l);
          const quad = [
            [a, -w0, f0],
            [a, w0, f0],
            [b, w1, f1],
            [a, -w0, f0],
            [b, w1, f1],
            [b, -w1, f1],
          ] as const;
          for (const [p, w, f] of quad) {
            positions[v * 3] = p.x + side.x * w;
            positions[v * 3 + 1] = p.y + side.y * w;
            positions[v * 3 + 2] = p.z + side.z * w;
            alphas[v] = f;
            v++;
          }
        }
      }
      geometry.setDrawRange(0, v);
      posAttr.clearUpdateRanges();
      posAttr.addUpdateRange(0, v * 3);
      posAttr.needsUpdate = true;
      alphaAttr.clearUpdateRanges();
      alphaAttr.addUpdateRange(0, v);
      alphaAttr.needsUpdate = true;
    },
    clear() {
      ribbons.clear();
      geometry.setDrawRange(0, 0);
    },
  };
}
