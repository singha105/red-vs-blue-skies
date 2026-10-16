// Tutorial props: four rings (the next one bright, flown ones gone) and three balloons on strings. Built once,
// shown only while the tutorial runs (at most 7 small meshes).
import { Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { TutorialState } from '../app/tutorial';

export interface TutorialProps {
  readonly root: Group;
  update(t: TutorialState | null, clock: number): void;
}

export function createTutorialProps(): TutorialProps {
  const root = new Group();
  root.visible = false;
  const ringGeo = new TorusGeometry(55, 3.2, 8, 40);
  const next = new MeshBasicMaterial({ color: new Color('#ffd166'), fog: false });
  const later = new MeshBasicMaterial({ color: new Color('#f4f7fb'), transparent: true, opacity: 0.55 });
  const rings = Array.from({ length: 4 }, () => {
    const m = new Mesh(ringGeo, later);
    root.add(m);
    return m;
  });
  const balloonGeo = new SphereGeometry(12, 14, 10);
  balloonGeo.scale(1, 1.2, 1);
  const stringGeo = new CylinderGeometry(0.2, 0.2, 16, 4);
  stringGeo.translate(0, -22, 0);
  const balloonMat = new MeshLambertMaterial({ color: new Color('#ff7a3d'), emissive: new Color('#40140a') });
  const stringMat = new MeshBasicMaterial({ color: new Color('#e9edf2') });
  const balloons = Array.from({ length: 3 }, () => {
    const g = new Group();
    g.add(new Mesh(balloonGeo, balloonMat), new Mesh(stringGeo, stringMat));
    root.add(g);
    return g;
  });
  const look = new Vector3();
  const dir = new Vector3();

  return {
    root,
    update(t, clock) {
      root.visible = t !== null;
      if (!t) return;
      rings.forEach((m, i) => {
        const r = t.step === 'rings' ? t.rings[i] : undefined;
        m.visible = Boolean(r) && i >= t.ring;
        if (!r || !m.visible) return;
        m.position.fromArray(r.pos);
        m.lookAt(look.fromArray(r.pos).add(dir.fromArray(r.normal)));
        m.material = i === t.ring ? next : later;
        // The next ring pulses gently so it reads at a distance.
        m.scale.setScalar(i === t.ring ? 1 + 0.06 * Math.sin(clock * 5) : 1);
      });
      balloons.forEach((g, i) => {
        const b = t.step === 'balloons' ? t.balloons[i] : undefined;
        g.visible = Boolean(b) && !b!.popped;
        if (!b || !g.visible) return;
        g.position.set(b.pos[0], b.pos[1] + Math.sin(clock * 1.3 + i) * 1.5, b.pos[2]);
      });
    },
  };
}
