// Pooled particle puffs (one draw call): damage smoke, fire, explosions with debris, hit sparks, muzzle flashes,
// contrails and wingtip vapour. No allocation per particle. On low graphics `heavy` is off: no contrails,
// vapour or explosion debris, and `density` halves the smoke.
// Day 11: camera-facing sprites with soft canvas-drawn textures (a lumpy smoke puff and a hot fire core) instead
// of flat icosahedra. One premultiplied blend does both kinds: smoke covers what's behind it (alpha), fire,
// flashes, sparks and muzzle flashes add light (alpha 0) at intensities above white, so bloom picks them out.
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';

const MAX = 2400;

export type PuffKind = 'smoke' | 'darkSmoke' | 'fire' | 'flash' | 'spark' | 'muzzle' | 'trail' | 'chaff' | 'contrail' | 'vapour' | 'debris';

/** glow: adds light (fire core texture, intensity can exceed 1 for bloom); else smoke that covers. */
const KINDS: Record<PuffKind, { colour: Color; life: number; size: number; grow: number; rise: number; glow: number; alpha: number }> = {
  smoke: { colour: new Color('#9aa1a8'), life: 2.4, size: 2.2, grow: 3.4, rise: 2, glow: 0, alpha: 0.75 },
  darkSmoke: { colour: new Color('#3b3f45'), life: 3, size: 3.2, grow: 4.2, rise: 3, glow: 0, alpha: 0.85 },
  fire: { colour: new Color('#ff8a2a'), life: 0.6, size: 2.2, grow: 1.6, rise: 1, glow: 5, alpha: 0 },
  flash: { colour: new Color('#ffd27a'), life: 0.7, size: 7, grow: 24, rise: 0, glow: 7, alpha: 0 },
  spark: { colour: new Color('#ffe9a8'), life: 0.25, size: 1.1, grow: 2, rise: 0, glow: 8, alpha: 0 },
  muzzle: { colour: new Color('#fff0b0'), life: 0.06, size: 0.7, grow: 10, rise: 0, glow: 8, alpha: 0 },
  trail: { colour: new Color('#e8ecef'), life: 2.2, size: 0.8, grow: 1.7, rise: 0.3, glow: 0, alpha: 0.6 },
  chaff: { colour: new Color('#b9c2cc'), life: 2.5, size: 1.4, grow: 3, rise: -0.5, glow: 0, alpha: 0.55 },
  contrail: { colour: new Color('#f6f8fa'), life: 7, size: 1.3, grow: 1.2, rise: 0, glow: 0, alpha: 0.55 },
  vapour: { colour: new Color('#ffffff'), life: 0.35, size: 0.6, grow: 4, rise: 0, glow: 0, alpha: 0.5 },
  debris: { colour: new Color('#2e2a26'), life: 1.4, size: 0.6, grow: 0, rise: 0, glow: 0, alpha: 1 },
};

/** Particles closer than this to the camera shrink away, so your own smoke and fire never fill the screen. */
const NEAR_FADE_M = 14;

export interface Effects {
  mesh: Mesh;
  emit(kind: PuffKind, x: number, y: number, z: number, vx?: number, vy?: number, vz?: number): void;
  /** `big`: a ground target or wreck (more fire, a taller smoke column). */
  explosion(x: number, y: number, z: number, big?: boolean): void;
  /** `camera`: particles right next to it shrink away. */
  update(dt: number, camera?: Vector3): void;
  /** 0.5 on low graphics: half the smoke. */
  density: number;
  /** False on low graphics: contrails, wingtip vapour and explosion debris are skipped. */
  heavy: boolean;
}

/** Two 64² sprites side by side: a lumpy smoke puff (left) and a soft hot core (right). */
function puffAtlas(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  const blob = (x: number, y: number, r: number, a: number): void => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${a * 0.6})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 64);
  };
  // Smoke: overlapping lumps with a little seeded jitter.
  let s = 7;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) blob(32 + (rnd() - 0.5) * 22, 32 + (rnd() - 0.5) * 22, 12 + rnd() * 12, 0.45);
  g.clearRect(64, 0, 64, 64);
  // Fire: a bright centre falling off smoothly.
  const grad = g.createRadialGradient(96, 32, 0, 96, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(64, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export function createEffects(): Effects {
  const quad = new BufferGeometry();
  quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  const posSize = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  const colour = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  posSize.setUsage(35048);
  colour.setUsage(35048);
  geometry.setAttribute('iPos', posSize);
  geometry.setAttribute('iCol', colour);
  geometry.instanceCount = 0;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e6);
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { map: { value: null } }]),
    vertexShader: /* glsl */ `
      attribute vec4 iPos;
      attribute vec4 iCol;
      varying vec2 vUv;
      varying vec4 vCol;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
        mvPosition.xy += position.xy * iPos.w;
        // Glowing kinds (alpha 0) use the hot-core half of the atlas.
        vUv = vec2((position.x * 0.5 + 0.5) * 0.5 + (iCol.a < 0.001 ? 0.5 : 0.0), position.y * 0.5 + 0.5);
        vCol = iCol;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec4 vCol;
      #include <fog_pars_fragment>
      void main() {
        float m = texture2D(map, vUv).a;
        if (m < 0.01) discard;
        // Premultiplied: smoke = colour × coverage with that much alpha; glow = light added, no alpha.
        gl_FragColor = vec4(vCol.rgb * m, vCol.a * m);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    premultipliedAlpha: true,
  });
  material.uniforms['map']!.value = puffAtlas();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  // Struct-of-arrays pool; live particles are packed at the front.
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const age = new Float32Array(MAX), life = new Float32Array(MAX), size = new Float32Array(MAX), grow = new Float32Array(MAX);
  const kind = new Uint8Array(MAX);
  const kindList = Object.keys(KINDS) as PuffKind[];
  const defs = kindList.map((k) => KINDS[k]);
  let live = 0;
  const ps = posSize.array as Float32Array;
  const cs = colour.array as Float32Array;

  const api: Effects = {
    mesh,
    density: 1,
    heavy: true,
    emit(k, x, y, z, ivx = 0, ivy = 0, ivz = 0) {
      if (live >= MAX) return;
      if (!api.heavy && (k === 'contrail' || k === 'vapour' || k === 'debris')) return;
      const def = KINDS[k];
      const i = live++;
      px[i] = x; py[i] = y; pz[i] = z;
      vx[i] = ivx; vy[i] = ivy + def.rise; vz[i] = ivz;
      age[i] = 0;
      life[i] = def.life * (0.8 + Math.random() * 0.4);
      size[i] = def.size * (0.8 + Math.random() * 0.4);
      grow[i] = def.grow;
      kind[i] = kindList.indexOf(k);
    },
    explosion(x, y, z, big = false) {
      api.emit('flash', x, y, z);
      const n = Math.round((big ? 22 : 12) * (api.heavy ? 1 : 0.6));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = (Math.random() - 0.3) * Math.PI;
        const sp = (big ? 12 : 8) + Math.random() * 18;
        api.emit(i < n * 0.45 ? 'fire' : 'darkSmoke', x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp);
      }
      // Debris: dark chunks thrown out that fall (heavy only).
      for (let i = 0; i < (big ? 10 : 6); i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 20 + Math.random() * 30;
        api.emit('debris', x, y, z, Math.cos(a) * sp, 15 + Math.random() * 25, Math.sin(a) * sp);
      }
    },
    update(dt, camera) {
      const cx = camera?.x ?? 1e9;
      const cy = camera?.y ?? 1e9;
      const cz = camera?.z ?? 1e9;
      const debrisKind = kindList.indexOf('debris');
      let i = 0;
      while (i < live) {
        age[i]! += dt;
        if (age[i]! >= life[i]!) {
          // Swap-remove with the last live particle.
          const last = --live;
          px[i] = px[last]!; py[i] = py[last]!; pz[i] = pz[last]!;
          vx[i] = vx[last]!; vy[i] = vy[last]!; vz[i] = vz[last]!;
          age[i] = age[last]!; life[i] = life[last]!; size[i] = size[last]!; grow[i] = grow[last]!; kind[i] = kind[last]!;
          continue;
        }
        const drag = 1 - 1.5 * dt;
        vx[i]! *= drag; vy[i]! *= drag; vz[i]! *= drag;
        // Debris falls.
        if (kind[i] === debrisKind) vy[i]! -= 25 * dt;
        px[i]! += vx[i]! * dt; py[i]! += vy[i]! * dt; pz[i]! += vz[i]! * dt;
        const t = age[i]! / life[i]!;
        let r = (size[i]! + grow[i]! * age[i]!) * (1 - t * t * 0.6);
        const dx = px[i]! - cx, dy = py[i]! - cy, dz = pz[i]! - cz;
        const near = dx * dx + dy * dy + dz * dz;
        if (near < NEAR_FADE_M * NEAR_FADE_M) r *= Math.sqrt(near) / NEAR_FADE_M;
        const def = defs[kind[i]!]!;
        ps[i * 4] = px[i]!;
        ps[i * 4 + 1] = py[i]!;
        ps[i * 4 + 2] = pz[i]!;
        ps[i * 4 + 3] = r;
        // Smoke thins out as it ages; glow fades from hot to nothing.
        const fade = 1 - t;
        if (def.glow > 0) {
          const k = def.glow * fade * fade;
          cs[i * 4] = def.colour.r * k;
          cs[i * 4 + 1] = def.colour.g * k;
          cs[i * 4 + 2] = def.colour.b * k;
          cs[i * 4 + 3] = 0;
        } else {
          const a = def.alpha * fade;
          cs[i * 4] = def.colour.r * a;
          cs[i * 4 + 1] = def.colour.g * a;
          cs[i * 4 + 2] = def.colour.b * a;
          cs[i * 4 + 3] = a;
        }
        i++;
      }
      geometry.instanceCount = live;
      posSize.clearUpdateRanges();
      posSize.addUpdateRange(0, live * 4);
      posSize.needsUpdate = true;
      colour.clearUpdateRanges();
      colour.addUpdateRange(0, live * 4);
      colour.needsUpdate = true;
    },
  };
  return api;
}
