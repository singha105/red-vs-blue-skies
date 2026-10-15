// Title screen backdrop: a placeholder plane circling the tallest island, filmed from inside the turn.
import { Matrix4, PerspectiveCamera, Scene, Vector3, type Object3D } from 'three';
import { circlePose, type CirclePath } from '../game/testFlight';
import type { Terrain } from '../game/terrain';
import { createPlaceholderPlane } from './planeMesh';

export interface TitleShot {
  update(timeS: number, frameDt: number, camera: PerspectiveCamera): void;
  setVisible(visible: boolean): void;
  /** Replace the placeholder with a real model. */
  setModel(model: Object3D): void;
}

/** A spot over open water close to the tallest island, so the island fills the background as the plane circles. */
function findCircleSpot(terrain: Terrain): [number, number, number] {
  let peak = { x: 0, z: 0, h: -Infinity };
  for (let x = -terrain.half; x <= terrain.half; x += 250) {
    for (let z = -terrain.half; z <= terrain.half; z += 250) {
      const h = terrain.heightAt(x, z);
      if (h > peak.h) peak = { x, z, h };
    }
  }
  const clearOfLand = (cx: number, cz: number): boolean => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      if (terrain.heightAt(cx + Math.cos(a) * 420, cz + Math.sin(a) * 420) > 60) return false;
    }
    return terrain.heightAt(cx, cz) < 60;
  };
  for (let d = 900; d <= 4000; d += 150) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const cx = peak.x + Math.cos(a) * d;
      const cz = peak.z + Math.sin(a) * d;
      if (Math.abs(cx) < terrain.half - 800 && Math.abs(cz) < terrain.half - 800 && clearOfLand(cx, cz)) return [cx, 220, cz];
    }
  }
  return [0, 600, 0];
}

export function createTitleShot(scene: Scene, terrain: Terrain): TitleShot {
  const path: CirclePath = { center: findCircleSpot(terrain), radiusM: 340, speedMs: 58 };
  let plane: Object3D = createPlaceholderPlane('blue');
  scene.add(plane);

  const bx = new Vector3();
  const by = new Vector3();
  const bz = new Vector3();
  const basis = new Matrix4();
  const camGoal = new Vector3();
  const lookGoal = new Vector3();
  const look = new Vector3();
  let first = true;

  return {
    setVisible(visible) {
      plane.visible = visible;
      first = true;
    },
    setModel(model) {
      model.visible = plane.visible;
      scene.remove(plane);
      plane = model;
      scene.add(plane);
    },
    update(timeS, frameDt, camera) {
      const pose = circlePose(path, timeS);
      bz.fromArray(pose.forward);
      by.fromArray(pose.up);
      bx.crossVectors(by, bz).normalize();
      basis.makeBasis(bx, by, bz);
      plane.position.fromArray(pose.pos);
      plane.quaternion.setFromRotationMatrix(basis);

      // Local +X points outward from the turn; sit inside it and look out across the plane.
      camGoal.copy(plane.position).addScaledVector(bz, -26).addScaledVector(bx, -38);
      camGoal.y += 14;
      lookGoal.copy(plane.position).addScaledVector(bz, 10);
      lookGoal.y -= 6;
      const k = first ? 1 : 1 - Math.exp(-frameDt * 3);
      camera.position.lerp(camGoal, k);
      if (first) look.copy(lookGoal);
      else look.lerp(lookGoal, k);
      camera.lookAt(look);
      if (camera.fov !== 60) {
        camera.fov = 60;
        camera.updateProjectionMatrix();
      }
      first = false;
    },
  };
}
