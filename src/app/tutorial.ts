// First-launch tutorial (about a minute): fly through four rings, shoot three balloons, fire a missile at a
// drone, then beat an enemy missile with flares. It's a solo Session with a script on top: the player flies
// the free tier-1 MiG-29A (guns, R-73s and flares), the drone and the launcher fly straight with no bot
// brain (ids z1/z2: missile targets starting with "d" are decoys), and the script places props and planes the way the debug hooks do. You can't lose it: the
// player's plane is repaired every step and a crash restarts the step.
import { launch } from '../game/missiles';
import type { ControlInput } from '../game/controls';
import type { PlaneState } from '../game/flight';
import { add, cross, dot, FORWARD, len, normalize, quatLookRotation, rotate, scale, type Vec3 } from '../game/math';
import { segmentSphere } from '../game/ballistics';
import { addPilot, applyDamage, createWorld, spawnPlane, stepWorld, type GameEvent, type WorldContext, type WorldState } from '../game/world';
import { lerp, nlerpQuat, type RenderPose, type Session } from './session';

export const TUTORIAL_PLANE = 'mig29a';
export const TUTORIAL_MAP = 'island_chain';
const PLAYER = 'p1';
const DRONE = 'z1';
const LAUNCHER = 'z2';
const RING_R = 55;
const BALLOON_R = 12;
const START_ALT = 1500;
const ENEMY_MISSILE = 'k13';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export type TutorialStep = 'rings' | 'balloons' | 'missile' | 'flares' | 'done';

export interface Ring {
  pos: Vec3;
  /** The way through (unit vector). */
  normal: Vec3;
  passed: boolean;
}

export interface Balloon {
  pos: Vec3;
  popped: boolean;
}

export interface TutorialState {
  step: TutorialStep;
  rings: Ring[];
  /** Index of the next ring to fly through. */
  ring: number;
  ringsHit: number;
  balloons: Balloon[];
  /** Flares step: missiles launched at the player so far, and how many the player beat. */
  shots: number;
  beaten: boolean;
  /** Seconds since the current step began (and since the last enemy launch). */
  stepTime: number;
  /** Seconds of the "done" card before the session ends. */
  doneFor: number;
  /** Crashed: seconds until the step restarts. */
  restartIn: number;
  /** A short message for the panel ("Missed one, keep going"), cleared after a few seconds. */
  note: string;
  noteFor: number;
}

/** Signed distance of a point in front of (positive) or behind a ring's plane. */
export const ringSide = (r: Ring, p: Vec3): number => dot(sub(p, r.pos), r.normal);

/**
 * Did the plane fly through the ring between p0 and p1? 'through', 'missed' (crossed the ring's plane outside
 * it) or null (hasn't crossed yet).
 */
export function ringPass(r: Ring, p0: Vec3, p1: Vec3, radius = RING_R): 'through' | 'missed' | null {
  const a = ringSide(r, p0);
  const b = ringSide(r, p1);
  if (a > 0 || b <= 0) return null;
  const t = a / (a - b);
  const x = add(p0, scale(sub(p1, p0), t));
  return len(sub(x, r.pos)) <= radius ? 'through' : 'missed';
}

/** Balloons hit by bullets this step (each bullet's segment over the step against each balloon). */
export function balloonsHit(balloons: Balloon[], bullets: readonly { pos: Vec3; vel: Vec3; owner: string }[], dt: number, owner: string): number {
  let n = 0;
  for (const b of bullets) {
    if (b.owner !== owner) continue;
    const p0 = sub(b.pos, scale(b.vel, dt));
    for (const bl of balloons) {
      if (bl.popped) continue;
      if (segmentSphere(p0, b.pos, bl.pos, BALLOON_R) >= 0) {
        bl.popped = true;
        n++;
      }
    }
  }
  return n;
}

/** Points ahead of a pose: `fwd` metres along the flat heading, `right` to the side, `up` above. */
function ahead(pos: Vec3, heading: Vec3, fwd: number, right: number, up: number): Vec3 {
  const h = normalize([heading[0], 0, heading[2]]);
  const r = normalize(cross(h, [0, 1, 0]));
  return add(add(add(pos, scale(h, fwd)), scale(r, right)), [0, up, 0]);
}

export function placeRings(from: Vec3, heading: Vec3): Ring[] {
  // A gentle S-curve that climbs a little: easy at 700 km/h, but you have to steer.
  const plan: [number, number, number][] = [
    [1100, 0, 0],
    [2200, 140, 80],
    [3300, -50, 140],
    [4400, 30, 60],
  ];
  const rings: Ring[] = [];
  let prev = from;
  for (const [f, r, u] of plan) {
    const pos = ahead(from, heading, f, r, u);
    rings.push({ pos, normal: normalize(sub(pos, prev)), passed: false });
    prev = pos;
  }
  return rings;
}

export function placeBalloons(from: Vec3, heading: Vec3): Balloon[] {
  return [
    { pos: ahead(from, heading, 1500, -40, 10), popped: false },
    { pos: ahead(from, heading, 1800, 50, 30), popped: false },
    { pos: ahead(from, heading, 2100, 0, -20), popped: false },
  ];
}

export interface TutorialSession extends Session {
  readonly tutorial: TutorialState;
  /** Skip to the next step (the "Next" shortcut in tests). */
  advance(): void;
}

export function createTutorialSession(ctx: WorldContext): TutorialSession {
  const w: WorldState = createWorld(ctx, 2026);
  w.match = { mode: 'free', timeLeftS: 0, killLimit: 1e9, score: { red: 0, blue: 0 }, state: 'playing', winner: null };
  addPilot(w, { id: PLAYER, name: 'You', team: 'blue', bot: false });
  const startPos: Vec3 = [0, START_ALT, -5200];
  const startDir: Vec3 = [0, 0, 1];
  const params = ctx.params.get(TUTORIAL_PLANE);
  if (!params) throw new Error(`tutorial plane ${TUTORIAL_PLANE} missing`);

  const place = (p: PlaneState, pos: Vec3, dir: Vec3, speedFrac: number, throttle: number): void => {
    p.pos = [...pos];
    p.quat = quatLookRotation(normalize(dir));
    p.vel = scale(normalize(dir), params.topSpeedMs * speedFrac);
    p.throttle = throttle;
    p.protectedFor = 0;
  };
  const spawnPlayer = (pos: Vec3, dir: Vec3): PlaneState => {
    const p = spawnPlane(w, ctx, { id: PLAYER, team: 'blue', planeId: TUTORIAL_PLANE });
    place(p, pos, dir, 0.45, 0.55);
    return p;
  };
  spawnPlayer(startPos, startDir);

  const t: TutorialState = {
    step: 'rings',
    rings: placeRings(startPos, startDir),
    ring: 0,
    ringsHit: 0,
    balloons: [],
    shots: 0,
    beaten: false,
    stepTime: 0,
    doneFor: 0,
    restartIn: 0,
    note: '',
    noteFor: 0,
  };
  const me = (): PlaneState => w.planes.find((p) => p.id === PLAYER)!;
  const heading = (p: PlaneState): Vec3 => rotate(p.quat, FORWARD);
  const note = (text: string): void => {
    t.note = text;
    t.noteFor = 3.5;
  };
  const removePlane = (id: string): void => {
    w.planes = w.planes.filter((p) => p.id !== id);
    delete w.pilots[id];
    delete w.stats[id];
  };

  const begin = (step: TutorialStep): void => {
    t.step = step;
    t.stepTime = 0;
    const p = me();
    removePlane(DRONE);
    removePlane(LAUNCHER);
    w.missiles = [];
    if (step === 'rings') {
      t.rings = placeRings(p.pos, heading(p));
      t.ring = 0;
      t.ringsHit = 0;
    } else if (step === 'balloons') {
      t.balloons = placeBalloons(p.pos, heading(p));
    } else if (step === 'missile') {
      // A drone 1.6 km ahead, flying the same way a little slower, so it slides into the missile's cone.
      addPilot(w, { id: DRONE, name: 'Drone', team: 'red', bot: true });
      const d = spawnPlane(w, ctx, { id: DRONE, team: 'red', planeId: TUTORIAL_PLANE });
      place(d, ahead(p.pos, heading(p), 1600, 0, 40), heading(p), 0.4, 0.5);
      d.missiles = d.missiles.map(() => 0);
      d.flares = 0;
      d.chaff = 0;
      p.missiles = p.missiles.map((n, i) => Math.max(n, i === 1 ? 2 : n));
    } else if (step === 'flares') {
      t.shots = 0;
      t.beaten = false;
      p.flares = Math.max(p.flares, 12);
      p.chaff = Math.max(p.chaff, 12);
    } else if (step === 'done') {
      t.doneFor = 2;
    }
  };

  /** Flares step: an enemy appears 1.8 km behind and fires a rear-aspect IR missile 2 s later. */
  const enemyLaunch = (): void => {
    const p = me();
    removePlane(LAUNCHER);
    addPilot(w, { id: LAUNCHER, name: 'Enemy', team: 'red', bot: true });
    const l = spawnPlane(w, ctx, { id: LAUNCHER, team: 'red', planeId: TUTORIAL_PLANE });
    place(l, ahead(p.pos, heading(p), -1800, 0, 0), heading(p), 0.45, 0.55);
    const m = ctx.missileDefs.get(ENEMY_MISSILE);
    if (m) launch(w, l, 0, m, p, w.events as never);
    t.shots++;
  };

  const prev = new Map<string, RenderPose>();
  let ended: Session['ended'] = null;

  const session: TutorialSession = {
    kind: 'solo',
    playerId: PLAYER,
    ctx,
    get world() {
      return w;
    },
    net: null,
    get ended() {
      return ended;
    },
    tutorial: t,
    advance() {
      const order: TutorialStep[] = ['rings', 'balloons', 'missile', 'flares', 'done'];
      const next = order[order.indexOf(t.step) + 1];
      if (next) begin(next);
      else ended = 'finished';
    },
    step(dt, input: ControlInput | null) {
      for (const p of w.planes) {
        const before = prev.get(p.id);
        if (before) {
          before.pos = [...p.pos];
          before.quat = [...p.quat];
        } else prev.set(p.id, { pos: [...p.pos], quat: [...p.quat] });
      }
      const p0 = [...me().pos] as Vec3;
      const inputs: Record<string, ControlInput> = input ? { [PLAYER]: input } : {};
      stepWorld(w, ctx, inputs, dt);
      const events: GameEvent[] = w.events;
      const p = me();
      t.stepTime += dt;
      t.noteFor = Math.max(0, t.noteFor - dt);
      if (t.noteFor === 0) t.note = '';

      // Crashed: the step starts again from a safe height, after the killcam has had a moment.
      if (!p.alive) {
        if (t.restartIn <= 0) {
          t.restartIn = 2;
          note('Crashed. Keep the nose up; the step starts again.');
        }
        t.restartIn -= dt;
        if (t.restartIn <= 0) {
          const dir = normalize([heading(p)[0], 0, heading(p)[2]]);
          spawnPlayer([p.pos[0], START_ALT, p.pos[2]], dir[0] === 0 && dir[2] === 0 ? startDir : dir);
          prev.delete(PLAYER);
          begin(t.step);
        }
        return events;
      }
      // Repaired every step: the tutorial can't shoot you down.
      p.hp = p.maxHp;
      p.fireFor = 0;
      p.damaged = { engine: false, wingL: false, wingR: false };
      p.partDamage = { fuselage: 0, wingL: 0, wingR: 0, engine: 0 };
      // And re-armed: the MiG-29's 150 rounds last five seconds.
      const def = ctx.planeDefs.get(TUTORIAL_PLANE);
      if (def) p.ammo = def.guns.map((g) => g.count * g.ammoPerGun);

      if (t.step === 'rings') {
        const r = t.rings[t.ring];
        if (r) {
          const pass = ringPass(r, p0, p.pos);
          if (pass) {
            r.passed = pass === 'through';
            if (r.passed) t.ringsHit++;
            else note('Missed that one. On to the next ring.');
            t.ring++;
          } else if (len(sub(r.pos, p.pos)) > 4500 || (ringSide(r, p.pos) > 0 && dot(heading(p), r.normal) < -0.2 && t.stepTime > 8)) {
            // Lost: put the remaining rings back in front of the plane.
            const fresh = placeRings(p.pos, heading(p));
            t.rings = [...t.rings.slice(0, t.ring), ...fresh.slice(0, t.rings.length - t.ring)];
            note('The rings moved in front of you.');
          }
        }
        if (t.ring >= t.rings.length) begin('balloons');
      } else if (t.step === 'balloons') {
        if (balloonsHit(t.balloons, w.bullets, dt, PLAYER) > 0) note('Pop!');
        const left = t.balloons.filter((b) => !b.popped);
        if (left.length === 0) begin('missile');
        else if (left.every((b) => dot(sub(b.pos, p.pos), heading(p)) < 0 || len(sub(b.pos, p.pos)) > 4000)) {
          // Flew past them: bring the rest round in front again.
          const fresh = placeBalloons(p.pos, heading(p));
          let k = 0;
          for (const b of t.balloons) if (!b.popped) b.pos = fresh[k++]!.pos;
          note('The balloons moved in front of you.');
        }
      } else if (t.step === 'missile') {
        const d = w.planes.find((x) => x.id === DRONE);
        // A missile that reaches the drone finishes it (it's a target drone, not a fighter).
        for (const e of events) if (e.t === 'detonate' && e.victim === DRONE && d?.alive) applyDamage(w, d, PLAYER, d.hp + 1, null, 'missile');
        if (!d || !d.alive) {
          if (t.stepTime > 0.5) begin('flares');
        } else if (len(sub(d.pos, p.pos)) > 5000 && t.stepTime > 5) {
          place(d, ahead(p.pos, heading(p), 1600, 0, 40), heading(p), 0.4, 0.5);
          note('The drone moved in front of you.');
        } else if (p.missiles.every((n) => n === 0) && w.missiles.length === 0) {
          p.missiles = p.missiles.map((_, i) => (i === 1 ? 2 : 0));
          note('Out of missiles: here are two more.');
        }
      } else if (t.step === 'flares') {
        // First launch 3 s into the step; if it hits, another one 4 s later (three tries, then move on).
        const inbound = w.missiles.some((m) => m.target === PLAYER);
        for (const e of events) {
          if (e.t === 'detonate' && e.victim === PLAYER) note('It hit you. Drop flares as soon as the warning shows.');
          else if (e.t === 'detonate' && e.victim === null && w.missiles.every((m) => m.target !== PLAYER)) t.beaten = true;
        }
        if (!inbound) {
          if (t.beaten && t.shots > 0) {
            note('Flares pulled it away.');
            begin('done');
          } else if (t.shots === 0 ? t.stepTime > 3 : t.stepTime > 3 + t.shots * 6) {
            if (t.shots >= 3) begin('done');
            else enemyLaunch();
          }
        }
      } else if (t.step === 'done') {
        t.doneFor -= dt;
        if (t.doneFor <= 0) ended = 'finished';
      }
      for (const e of events) if (e.t === 'spawn') prev.delete(e.id);
      return events;
    },
    pose(id, alpha, out) {
      const p = w.planes.find((x) => x.id === id);
      if (!p) return false;
      const before = prev.get(id);
      if (!before) {
        out.pos = [...p.pos];
        out.quat = [...p.quat];
        return true;
      }
      out.pos = [lerp(before.pos[0], p.pos[0], alpha), lerp(before.pos[1], p.pos[1], alpha), lerp(before.pos[2], p.pos[2], alpha)];
      out.quat = nlerpQuat(before.quat, p.quat, alpha);
      return true;
    },
    chooseRespawn() {},
    respawnChoice: null,
    dispose() {},
  };
  return session;
}
