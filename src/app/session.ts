// What the renderer and HUD need from a match, whether it runs locally (solo) or over the network (client).
import type { ControlInput } from '../game/controls';
import { createSoloMatch, PLAYER_ID, stepMatch, type Match, type SoloOptions } from '../game/match';
import type { Quat, Vec3 } from '../game/math';
import type { GameEvent, WorldContext, WorldState } from '../game/world';

export interface RenderPose {
  pos: Vec3;
  quat: Quat;
}

export interface NetStats {
  pingMs: number | null;
  /** Fraction of snapshots that never arrived over the last few seconds. */
  loss: number;
  snapshotsPerS: number;
  bytesInPerS: number;
  bytesOutPerS: number;
}

export interface Session {
  readonly kind: 'solo' | 'net';
  readonly playerId: string;
  readonly ctx: WorldContext;
  /** Planes (your own predicted, others interpolated), bullets to draw, pilots, stats, match clock and score. */
  readonly world: WorldState;
  /** One fixed 60 Hz step with your input (null while dead). Returns the events to show this step. */
  step(dt: number, input: ControlInput | null): GameEvent[];
  /** Where to draw a plane between steps (alpha 0–1). */
  pose(id: string, alpha: number, out: RenderPose): boolean;
  readonly ended: null | 'finished' | 'hostLeft';
  readonly net: NetStats | null;
  dispose(): void;
}

/** Everything local: the match runs right here, no network. */
export function createSoloSession(ctx: WorldContext, opts: SoloOptions): Session & { match: Match } {
  const match = createSoloMatch(ctx, opts);
  const prev = new Map<string, RenderPose>();
  return {
    kind: 'solo',
    playerId: PLAYER_ID,
    ctx,
    match,
    get world() {
      return match.world;
    },
    net: null,
    get ended() {
      return match.world.match.state === 'ended' ? 'finished' : null;
    },
    step(dt, input) {
      for (const p of match.world.planes) {
        const before = prev.get(p.id);
        if (before) {
          before.pos[0] = p.pos[0]; before.pos[1] = p.pos[1]; before.pos[2] = p.pos[2];
          before.quat[0] = p.quat[0]; before.quat[1] = p.quat[1]; before.quat[2] = p.quat[2]; before.quat[3] = p.quat[3];
        } else prev.set(p.id, { pos: [...p.pos], quat: [...p.quat] });
      }
      stepMatch(match, ctx, input ? { [PLAYER_ID]: input } : {}, dt);
      for (const e of match.world.events) if (e.t === 'spawn') prev.delete(e.id);
      return match.world.events;
    },
    pose(id, alpha, out) {
      const p = match.world.planes.find((x) => x.id === id);
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
    dispose() {},
  };
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Normalised lerp, taking the short way round (fine for the small steps between ticks and snapshots). */
export function nlerpQuat(a: Quat, b: Quat, t: number): Quat {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const q: Quat = [lerp(a[0], b[0] * s, t), lerp(a[1], b[1] * s, t), lerp(a[2], b[2] * s, t), lerp(a[3], b[3] * s, t)];
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
