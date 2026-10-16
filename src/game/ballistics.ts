// Guns, bullets and hit detection. Pure data: bullets live in WorldState and are plain objects.
//
// Real guns fire up to 100 rounds a second (M61), far too many to simulate one by one for 20 planes.
// Each simulated projectile therefore carries one or more real rounds: at most PROJECTILES_PER_S per gun
// mount, with damage and ammo use scaled to match. Tracers are drawn one per projectile.
import type { Gun, GunMount, Plane } from '../data/types';
import type { PlaneState, Team } from './flight';
import { G } from './flight';
import { add, clamp, cross, dot, FORWARD, len, normalize, quatFromAxisAngle, rotate, scale, UP, type Vec3 } from './math';
import { isProp, muzzlesFor, planeSize } from './planeModels';

export const CONVERGENCE_M = 300;
export const BULLET_RANGE_M = 1300;
const PROJECTILES_PER_S = 20;
const ASSIST_CONE_RAD = (2 * Math.PI) / 180;

export type Part = 'fuselage' | 'wingL' | 'wingR' | 'engine';
export const PARTS: readonly Part[] = ['fuselage', 'wingL', 'wingR', 'engine'];

export interface Bullet {
  id: number;
  owner: string;
  team: Team;
  gun: string;
  pos: Vec3;
  vel: Vec3;
  /** Damage this projectile does on a hit (all the real rounds it stands for). */
  damage: number;
  life: number;
}

export type HitSpheres = Record<Part, { c: Vec3; r: number }> & { bound: number };

const sphereCache = new Map<string, HitSpheres>();
const clampR = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Four hit spheres per plane in local metres (+Z forward, +X left wing), scaled to the plane's real
 * length and span. Slightly generous (arcade). Jets carry the engine at the tail, props at the nose.
 */
export function hitSpheres(plane: Plane): HitSpheres {
  const cached = sphereCache.get(plane.id);
  if (cached) return cached;
  const { lengthM: L, wingspanM: S } = planeSize(plane);
  const wingR = clampR(S * 0.26, 2.2, 3.4);
  const wingX = S * 0.37;
  const spheres: HitSpheres = {
    fuselage: { c: [0, 0, -0.05 * L], r: clampR(L * 0.3, 2.2, 4.2) },
    wingL: { c: [wingX, -0.2, 0.05 * L], r: wingR },
    wingR: { c: [-wingX, -0.2, 0.05 * L], r: wingR },
    engine: isProp(plane.era) ? { c: [0, 0, 0.42 * L], r: clampR(L * 0.2, 1.5, 2.2) } : { c: [0, 0.2, -0.4 * L], r: clampR(L * 0.14, 1.6, 2.4) },
    bound: Math.max(L * 0.5 + 4.5, wingX + wingR) + 0.5,
  };
  sphereCache.set(plane.id, spheres);
  return spheres;
}

/** Largest bound of any plane, for the bullet broad-phase. */
export const BOUNDING_RADIUS = 15;

/**
 * First time t in [0, 1] at which the segment p0→p1 enters the sphere (c, r), or −1.
 * Swept so a bullet moving 15 m a tick can't skip through a 2 m sphere.
 */
export function segmentSphere(p0: Vec3, p1: Vec3, c: Vec3, r: number): number {
  // Scalars, not vectors: this runs for every bullet near every plane, every tick.
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const mx = p0[0] - c[0], my = p0[1] - c[1], mz = p0[2] - c[2];
  const a = dx * dx + dy * dy + dz * dz;
  const b = mx * dx + my * dy + mz * dz;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc <= 0) return 0; // starts inside
  if (a < 1e-12) return -1;
  const disc = b * b - a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

/** Where to point so a bullet at speed `muzzle` (plus the shooter's own velocity) meets the target. Includes drop. */
export function leadPoint(shooterPos: Vec3, shooterVel: Vec3, targetPos: Vec3, targetVel: Vec3, muzzle: number): Vec3 {
  const rel: Vec3 = [targetVel[0] - shooterVel[0], targetVel[1] - shooterVel[1], targetVel[2] - shooterVel[2]];
  let t = len([targetPos[0] - shooterPos[0], targetPos[1] - shooterPos[1], targetPos[2] - shooterPos[2]]) / muzzle;
  let aim = targetPos;
  for (let i = 0; i < 3; i++) {
    aim = [targetPos[0] + rel[0] * t, targetPos[1] + rel[1] * t + 0.5 * G * t * t, targetPos[2] + rel[2] * t];
    t = len([aim[0] - shooterPos[0], aim[1] - shooterPos[1], aim[2] - shooterPos[2]]) / muzzle;
  }
  return aim;
}

/** Muzzle position for mount `index`, alternating sides shot by shot. Jets keep their guns near the nose. */
function muzzleOffset(plane: Plane, mount: GunMount, index: number, shot: number): Vec3 {
  const fromModel = muzzlesFor(plane.id, index);
  if (fromModel) return fromModel[shot % fromModel.length]!;
  const jet = !(plane.era === 'ww1' || plane.era === 'early_ww2' || plane.era === 'late_ww2');
  if (jet || mount.count === 1) return [shot % 2 ? 0.5 : -0.5, -0.3, 3];
  const side = shot % 2 ? 1 : -1;
  return [side * (index === 0 ? 1.8 : 2.8), -0.25, 1.4];
}

export interface FireContext {
  guns: Map<string, Gun>;
  nextBulletId(): number;
  random(): number;
  /** Enemy planes (alive), for touch aim-assist magnetism. */
  enemies: PlaneState[];
}

/** Fires this tick's projectiles for one plane holding the trigger. Mutates ammo and heat; pushes bullets. */
export function fireGuns(s: PlaneState, def: Plane, fc: FireContext, dt: number, out: Bullet[]): number {
  let fired = 0;
  const forward = rotate(s.quat, FORWARD);
  const up = rotate(s.quat, UP);
  def.guns.forEach((mount, i) => {
    const gun = fc.guns.get(mount.type);
    const ammo = s.ammo[i] ?? 0;
    if (!gun || ammo <= 0) return;
    const roundsPerS = (gun.rpm / 60) * mount.count;
    const roundsPerProjectile = Math.max(1, Math.ceil(roundsPerS / PROJECTILES_PER_S));
    s.gunHeat[i] = (s.gunHeat[i] ?? 0) + roundsPerS * dt;
    while ((s.gunHeat[i] ?? 0) >= roundsPerProjectile && (s.ammo[i] ?? 0) > 0) {
      const rounds = Math.min(roundsPerProjectile, s.ammo[i] ?? 0);
      s.gunHeat[i] = (s.gunHeat[i] ?? 0) - roundsPerProjectile;
      s.ammo[i] = (s.ammo[i] ?? 0) - rounds;
      const shot = Math.floor((s.ammo[i] ?? 0) / roundsPerProjectile);
      const muzzle = add(s.pos, rotate(s.quat, muzzleOffset(def, mount, i, shot)));
      // Converge on a point 300 m ahead of the nose.
      const converge = add(s.pos, scale(forward, CONVERGENCE_M));
      let dir = normalize([converge[0] - muzzle[0], converge[1] - muzzle[1], converge[2] - muzzle[2]]);
      if (s.assist > 0) dir = magnetize(dir, s, fc.enemies, gun.muzzleVelocityMs);
      dir = spread(dir, up, (gun.spreadDeg * Math.PI) / 180, fc.random);
      out.push({
        id: fc.nextBulletId(),
        owner: s.id,
        team: s.team,
        gun: gun.id,
        pos: muzzle,
        vel: add(s.vel, scale(dir, gun.muzzleVelocityMs)),
        damage: gun.damage * rounds,
        life: BULLET_RANGE_M / gun.muzzleVelocityMs,
      });
      fired++;
    }
  });
  return fired;
}

/** Touch aim assist: bend the shot toward the lead point of an enemy within 2° of it. */
function magnetize(dir: Vec3, s: PlaneState, enemies: PlaneState[], muzzle: number): Vec3 {
  let best: Vec3 | null = null;
  let bestAngle = ASSIST_CONE_RAD;
  for (const e of enemies) {
    const lead = leadPoint(s.pos, s.vel, e.pos, e.vel, muzzle);
    const to: Vec3 = [lead[0] - s.pos[0], lead[1] - s.pos[1], lead[2] - s.pos[2]];
    const dist = len(to);
    if (dist > BULLET_RANGE_M) continue;
    const angle = Math.acos(clamp(dot(scale(to, 1 / dist), dir), -1, 1));
    if (angle < bestAngle) {
      bestAngle = angle;
      best = scale(to, 1 / dist);
    }
  }
  if (!best) return dir;
  const k = clamp(s.assist, 0, 1);
  return normalize([dir[0] + (best[0] - dir[0]) * k, dir[1] + (best[1] - dir[1]) * k, dir[2] + (best[2] - dir[2]) * k]);
}

/** Random cone spread around dir. */
function spread(dir: Vec3, up: Vec3, maxRad: number, random: () => number): Vec3 {
  if (maxRad <= 0) return dir;
  const side = normalize(cross(up, dir));
  const angle = maxRad * Math.sqrt(random());
  const around = random() * Math.PI * 2;
  const axis = normalize(add(scale(side, Math.cos(around)), scale(up, Math.sin(around))));
  return rotate(quatFromAxisAngle(axis, angle), dir);
}

export interface BulletHit {
  bullet: Bullet;
  victim: PlaneState;
  part: Part;
  point: Vec3;
}

const SEG0: Vec3 = [0, 0, 0];
const SEG1: Vec3 = [0, 0, 0];

/**
 * Moves every bullet one tick (with gravity), removes spent ones, and reports hits.
 * `spheresFor` gives each plane's hit spheres; friendly fire is off.
 */
export function stepBullets(
  bullets: Bullet[],
  planes: PlaneState[],
  spheresFor: (p: PlaneState) => Record<Part, { c: Vec3; r: number }> & { bound?: number },
  surfaceAt: (x: number, z: number) => number,
  dt: number,
  /** Ground targets: called for each segment before the ground test; true means the bullet hit one.
   *  p0 and p1 are scratch vectors: copy them to keep them. */
  hitsGround?: (b: Bullet, p0: Vec3, p1: Vec3) => boolean,
  /** The map's highest point: bullets above it skip the terrain lookup. */
  ceilingM = Infinity,
): BulletHit[] {
  const hits: BulletHit[] = [];
  let write = 0;
  // Two scratch vectors for the whole step (bullets are moved in place), so a busy fight doesn't churn garbage.
  const p0 = SEG0;
  const p1 = SEG1;
  for (let read = 0; read < bullets.length; read++) {
    const b = bullets[read]!;
    p0[0] = b.pos[0];
    p0[1] = b.pos[1];
    p0[2] = b.pos[2];
    b.vel[1] -= G * dt;
    p1[0] = p0[0] + b.vel[0] * dt;
    p1[1] = p0[1] + b.vel[1] * dt;
    p1[2] = p0[2] + b.vel[2] * dt;
    b.life -= dt;
    let consumed = b.life <= 0;
    if (!consumed && hitsGround && hitsGround(b, p0, p1)) consumed = true;
    if (!consumed && p1[1] <= ceilingM && p1[1] <= surfaceAt(p1[0], p1[2])) consumed = true;

    if (!consumed) {
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, mz = (p0[2] + p1[2]) / 2;
      const half = Math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2 + (p1[2] - p0[2]) ** 2) / 2;
      let bestT = 2;
      let best: BulletHit | null = null;
      for (const plane of planes) {
        if (!plane.alive || plane.team === b.team || plane.id === b.owner) continue;
        const dx = plane.pos[0] - mx, dy = plane.pos[1] - my, dz = plane.pos[2] - mz;
        const spheres = spheresFor(plane);
        const reach = half + (spheres.bound ?? BOUNDING_RADIUS);
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        for (const part of PARTS) {
          const sph = spheres[part];
          const c = add(plane.pos, rotate(plane.quat, sph.c));
          const t = segmentSphere(p0, p1, c, sph.r);
          if (t >= 0 && t < bestT) {
            bestT = t;
            best = { bullet: b, victim: plane, part, point: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t] };
          }
        }
      }
      if (best) {
        hits.push(best);
        consumed = true;
      }
    }

    if (!consumed) {
      b.pos[0] = p1[0];
      b.pos[1] = p1[1];
      b.pos[2] = p1[2];
      bullets[write++] = b;
    }
  }
  bullets.length = write;
  return hits;
}
