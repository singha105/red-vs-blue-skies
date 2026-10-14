// Box-and-wings stand-in until Day 4's Blender models. Faces +Z; the team band takes red or blue.
import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import type { Team } from '../game/flight';

export const TEAM_COLOURS: Record<Team, number> = { red: 0xe0443a, blue: 0x2f7de1 };

const body = new MeshLambertMaterial({ color: 0xd9dde2, flatShading: true });
const dark = new MeshLambertMaterial({ color: 0x2b3440, flatShading: true });
const teamMaterials: Record<Team, MeshLambertMaterial> = {
  red: new MeshLambertMaterial({ color: TEAM_COLOURS.red, flatShading: true }),
  blue: new MeshLambertMaterial({ color: TEAM_COLOURS.blue, flatShading: true }),
};

type Part = [BoxGeometry, 'body' | 'team' | 'dark', [number, number, number]];
const PARTS: Part[] = [
  [new BoxGeometry(1.1, 1.1, 7.5), 'body', [0, 0, 0]],
  [new BoxGeometry(1.15, 1.15, 0.9), 'team', [0, 0, -2.2]],
  [new BoxGeometry(0.8, 0.55, 1.6), 'dark', [0, 0.75, 0.8]],
  [new BoxGeometry(10, 0.18, 1.8), 'body', [0, -0.2, 0.6]],
  [new BoxGeometry(1.6, 0.2, 1.82), 'team', [4.2, -0.2, 0.6]],
  [new BoxGeometry(1.6, 0.2, 1.82), 'team', [-4.2, -0.2, 0.6]],
  [new BoxGeometry(3.6, 0.14, 1), 'body', [0, 0.1, -3.3]],
  [new BoxGeometry(0.14, 1.5, 1.1), 'team', [0, 0.85, -3.35]],
  [new BoxGeometry(0.3, 2.4, 0.08), 'dark', [0, 0, 3.8]],
];

export function createPlaceholderPlane(team: Team): Group {
  const group = new Group();
  for (const [geometry, kind, [x, y, z]] of PARTS) {
    const material = kind === 'team' ? teamMaterials[team] : kind === 'dark' ? dark : body;
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
  }
  group.scale.setScalar(1.2);
  return group;
}
