// Title-screen scene: sky gradient, ocean, three low-poly islands and a placeholder plane flying circles.
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { GameMap } from '../data/types';
import { circlePose, type CirclePath } from '../game/testFlight';
import { createRng, range, type Rng } from '../game/rng';

const PATH: CirclePath = { center: [0, 130, 0], radiusM: 320, speedMs: 58 };

export interface TestScene {
  scene: Scene;
  update(timeS: number, frameDt: number, camera: PerspectiveCamera): void;
}

export function createTestScene(map: GameMap): TestScene {
  const scene = new Scene();
  const horizon = new Color(map.colors.skyHorizon);
  scene.background = horizon;
  scene.fog = new Fog(horizon, 1800, 9000);

  scene.add(createSky(map));
  scene.add(createOcean(map));

  const rng = createRng(map.seed);
  const islands: [number, number, number][] = [
    // x, z, radius: a ring around the flight circle so one is usually behind the plane
    [1350, 250, 420],
    [-900, 1350, 560],
    [-1150, -1500, 700],
  ];
  for (const [x, z, r] of islands) scene.add(createIsland(map, rng, x, z, r));

  scene.add(new HemisphereLight(0xdaf0ff, 0x335566, 1.4));
  const sun = new DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(-0.6, 1, 0.4).normalize();
  scene.add(sun);

  const plane = createPlaceholderPlane();
  scene.add(plane);

  const basisX = new Vector3();
  const basisY = new Vector3();
  const basisZ = new Vector3();
  const basis = new Matrix4();
  const camGoal = new Vector3();
  const lookGoal = new Vector3();
  const look = new Vector3();
  let first = true;

  return {
    scene,
    update(timeS, frameDt, camera) {
      const pose = circlePose(PATH, timeS);
      basisZ.fromArray(pose.forward);
      basisY.fromArray(pose.up);
      basisX.crossVectors(basisY, basisZ).normalize();
      basis.makeBasis(basisX, basisY, basisZ);
      plane.position.fromArray(pose.pos);
      plane.quaternion.setFromRotationMatrix(basis);

      // Ride inside the turn (local +X points outward) and look out across the plane's top at the islands.
      camGoal.copy(plane.position).addScaledVector(basisZ, -26).addScaledVector(basisX, -38);
      camGoal.y += 14;
      lookGoal.copy(plane.position).addScaledVector(basisZ, 10);
      lookGoal.y -= 6;
      const k = first ? 1 : 1 - Math.exp(-frameDt * 3);
      camera.position.lerp(camGoal, k);
      look.lerp(lookGoal, k);
      if (first) look.copy(lookGoal);
      camera.lookAt(look);
      first = false;
    },
  };
}

function createSky(map: GameMap): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      top: { value: new Color(map.colors.skyTop) },
      horizon: { value: new Color(map.colors.skyHorizon) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new Mesh(new SphereGeometry(12000, 24, 12), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.copy(camera.position);
  };
  return sky;
}

function createOcean(map: GameMap): Mesh {
  const geometry = new PlaneGeometry(map.sizeM * 1.6, map.sizeM * 1.6, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  return new Mesh(geometry, new MeshLambertMaterial({ color: map.colors.water }));
}

/** A flat-shaded hill: a squashed, jittered half-sphere coloured by height (sand, grass, rock). */
function createIsland(map: GameMap, rng: Rng, x: number, z: number, radius: number): Mesh {
  const source = new SphereGeometry(radius, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  const pos = source.getAttribute('position') as BufferAttribute;
  const height = radius * range(rng, 0.32, 0.45);
  // Jitter shared vertices identically so the surface stays closed.
  const offsets = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const key = `${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)}`;
    let o = offsets.get(key);
    if (!o) {
      const edge = py < 1e-3; // keep the shoreline below water
      o = [
        range(rng, -0.08, 0.08) * radius,
        edge ? -radius * 0.04 : range(rng, -0.1, 0.12) * height,
        range(rng, -0.08, 0.08) * radius,
      ];
      offsets.set(key, o);
    }
    pos.setXYZ(i, px + o[0], (py / radius) * height + o[1], pz + o[2]);
  }

  const sand = new Color(map.colors.sand);
  const grass = new Color(map.colors.grass);
  const rock = new Color(map.colors.rock);
  const colors = new Float32Array(pos.count * 3);
  const tmp = new Color();
  for (let f = 0; f < pos.count; f += 3) {
    const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3 / height;
    if (y < 0.12) tmp.copy(sand);
    else if (y < 0.72) tmp.copy(grass).offsetHSL(0, 0, (rng() - 0.5) * 0.06);
    else tmp.copy(rock);
    for (let k = 0; k < 3; k++) tmp.toArray(colors, (f + k) * 3);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', pos);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  source.dispose();

  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.position.set(x, -radius * 0.02, z);
  mesh.rotation.y = rng() * Math.PI * 2;
  return mesh;
}

/** Box-and-wings stand-in until Day 4's Blender models. Faces +Z, team band in blue. */
function createPlaceholderPlane(): Group {
  const body = new MeshLambertMaterial({ color: 0xd9dde2, flatShading: true });
  const team = new MeshLambertMaterial({ color: 0x2f7de1, flatShading: true });
  const dark = new MeshLambertMaterial({ color: 0x2b3440, flatShading: true });

  const parts: [BoxGeometry, MeshLambertMaterial, [number, number, number]][] = [
    [new BoxGeometry(1.1, 1.1, 7.5), body, [0, 0, 0]],
    [new BoxGeometry(1.15, 1.15, 0.9), team, [0, 0, -2.2]],
    [new BoxGeometry(0.8, 0.55, 1.6), dark, [0, 0.75, 0.8]],
    [new BoxGeometry(10, 0.18, 1.8), body, [0, -0.2, 0.6]],
    [new BoxGeometry(1.6, 0.2, 1.82), team, [4.2, -0.2, 0.6]],
    [new BoxGeometry(1.6, 0.2, 1.82), team, [-4.2, -0.2, 0.6]],
    [new BoxGeometry(3.6, 0.14, 1), body, [0, 0.1, -3.3]],
    [new BoxGeometry(0.14, 1.5, 1.1), team, [0, 0.85, -3.35]],
    [new BoxGeometry(0.3, 2.4, 0.08), dark, [0, 0, 3.8]],
  ];

  const group = new Group();
  for (const [geometry, material, [x, y, z]] of parts) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  group.scale.setScalar(1.2);
  return group;
}
