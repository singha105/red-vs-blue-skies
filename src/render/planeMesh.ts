// Box-and-wings stand-in until Day 4's Blender models. Faces +Z; the team band takes red or blue.
// All parts are merged into one vertex-coloured geometry per team, so each plane is a single draw call.
import { BoxGeometry, BufferAttribute, Color, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Team } from '../game/flight';

export const TEAM_COLOURS: Record<Team, number> = { red: 0xe0443a, blue: 0x2f7de1 };

type Part = [size: [number, number, number], kind: 'body' | 'team' | 'dark', at: [number, number, number]];
const PARTS: Part[] = [
  [[1.1, 1.1, 7.5], 'body', [0, 0, 0]],
  [[1.15, 1.15, 0.9], 'team', [0, 0, -2.2]],
  [[0.8, 0.55, 1.6], 'dark', [0, 0.75, 0.8]],
  [[10, 0.18, 1.8], 'body', [0, -0.2, 0.6]],
  [[1.6, 0.2, 1.82], 'team', [4.2, -0.2, 0.6]],
  [[1.6, 0.2, 1.82], 'team', [-4.2, -0.2, 0.6]],
  [[3.6, 0.14, 1], 'body', [0, 0.1, -3.3]],
  [[0.14, 1.5, 1.1], 'team', [0, 0.85, -3.35]],
  [[0.3, 2.4, 0.08], 'dark', [0, 0, 3.8]],
];

const SCALE = 1.2;
const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
const geometries = new Map<Team, BufferGeometry>();

function geometryFor(team: Team): BufferGeometry {
  const cached = geometries.get(team);
  if (cached) return cached;
  const colours = { body: new Color(0xd9dde2), team: new Color(TEAM_COLOURS[team]), dark: new Color(0x2b3440) };
  const parts = PARTS.map(([[w, h, d], kind, [x, y, z]]) => {
    const g = new BoxGeometry(w * SCALE, h * SCALE, d * SCALE).toNonIndexed();
    g.translate(x * SCALE, y * SCALE, z * SCALE);
    const c = colours[kind];
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    g.setAttribute('color', new BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('could not merge plane parts');
  merged.computeBoundingSphere();
  geometries.set(team, merged);
  return merged;
}

export function createPlaceholderPlane(team: Team): Mesh {
  const mesh = new Mesh(geometryFor(team), material);
  mesh.castShadow = true;
  return mesh;
}
