// The local player's control state. Every device (mouse, touch, gamepad, keys) writes here; once per
// simulation tick sample() turns it into a ControlInput: through the mouse-aim autopilot, or straight from the
// stick in mouse-joystick mode. Also holds the cockpit switches (WEP, airbrake, flaps, gear, radar, secondary
// weapon) and the camera state (chase / cockpit / HUD view, zoom, free look, look back).
import { aimControl, createAimPd } from '../game/autopilot';
import type { ControlInput } from '../game/controls';
import type { PlaneState } from '../game/flight';
import { clamp, dirFromYawPitch, FORWARD, normalize, rotate, yawPitchFromDir, type Vec3 } from '../game/math';
import { RADAR_RANGES_KM } from '../game/radar';

const MAX_AIM_PITCH = (88 * Math.PI) / 180;
/** The aim may lead the nose by at most this much, so it never runs off where the plane can't follow. */
const MAX_LEAD = (75 * Math.PI) / 180;
/** Rudder ramps in (and back to centre) over this long, so a tap is a nudge and a hold is full rudder. */
export const RUDDER_RAMP_S = 0.3;
/** Throttle values above 1 mean WEP / afterburner (the slider's top segment, or holding W at 100%). */
export const WEP_THROTTLE = 1.1;
/** Holding throttle-up at 100% this long lights WEP. */
const WEP_HOLD_S = 0.35;
/** Mouse-joystick stick drifts back toward centre at this rate (per second) so it doesn't stay stuck. */
const STICK_RETURN = 1.2;
/** A radar lock request that finds nothing within this long gives up (Search mode). */
const LOCK_GIVE_UP_S = 1.5;

export type ControlMode = 'mouseAim' | 'joystick';
/** B cycles chase → cockpit → HUD (jets only) → chase. */
export type ViewMode = 'chase' | 'cockpit' | 'hud';
/** Flap settings: Up, Combat, Takeoff, Landing (each plane maps them to its real deflections). */
export const FLAP_STEPS = 4;
export const FLAP_NAMES = ['UP', 'CBT', 'TKOF', 'LDG'] as const;
/** The look-back camera swings round in this long (and back on release). */
export const LOOK_BACK_S = 0.15;

export function nextView(view: ViewMode, isJet: boolean): ViewMode {
  if (view === 'chase') return 'cockpit';
  if (view === 'cockpit') return isJet ? 'hud' : 'chase';
  return 'chase';
}

export interface PlayerControls {
  /** World aim direction as yaw/pitch (radians). */
  readonly aim: { yaw: number; pitch: number };
  /** Free-look camera angles relative to the aim, used while freeLook is on. */
  readonly look: { yaw: number; pitch: number };
  freeLook: boolean;
  /** Settings → Invert pitch: vertical aim input moves the nose the other way (not the free-look camera). */
  invertPitch: boolean;
  mode: ControlMode;
  /** 0..1, or WEP_THROTTLE with WEP / afterburner. */
  throttle: number;
  fire: boolean;
  missile: boolean;
  flare: boolean;
  /** Missile and radar target picked by the player, or null for the weapons computer's choice. */
  target: string | null;
  /** Keyboard/arrow overrides for this tick (−1..1, 0 = autopilot). Yaw here is ignored: rudder is ramped. */
  override: { pitch: number; roll: number; yaw: number };
  /** Rudder input wanted by keys/buttons this frame (−1, 0, 1), and the ramped value actually sent. */
  rudderWanted: number;
  readonly rudder: number;
  /** Mouse-joystick stick position (−1..1). */
  readonly stick: { x: number; y: number };
  airbrake: boolean;
  /** Airbrake held through the throttle-down trigger (gamepad LT at idle). */
  airbrakeHeld: boolean;
  /** 0 Up … 3 Landing (F down a step, Shift+F up a step). */
  flapStep: number;
  /** Landing gear down (G). Planes spawn in the air with it up. */
  gear: boolean;
  radarOn: boolean;
  radarDogfight: boolean;
  radarRange: number;
  /** The pilot wants a radar lock (R toggles it). */
  radarLockWanted: boolean;
  /** Picked secondary weapon (mount index, or 0 rockets / 1 bombs), −1 = automatic. */
  secondary: number;
  view: ViewMode;
  zoom: boolean;
  /** Look back wanted this frame (V held, or toggled on), and how far round the camera has swung (0–1, eased). */
  lookBack: boolean;
  readonly lookBackT: number;
  /** Looking back or still swinging back: the aim holds the flight path, like free look. */
  readonly lookingBack: boolean;
  /** Advance the look-back swing (called every rendered frame). */
  stepLookBack(dt: number): void;
  /** Held on the touch screen (combined with keys and pad each frame): zoom, rudder buttons, the look eye. */
  readonly touch: { zoom: boolean; rudder: number; look: boolean };
  /** Move the aim (or the free-look camera, or the joystick) by angles in radians. Positive dx = right, dy = up. */
  moveAim(dx: number, dy: number): void;
  setThrottle(value: number): void;
  /** Throttle-up held for dt seconds (W, RT): rises to 100%, then lights WEP if held on. */
  throttleUp(dt: number, rate: number): void;
  throttleDown(dt: number, rate: number): void;
  /** Aim at the horizon straight ahead; the autopilot levels the wings. */
  autoLevel(plane: PlaneState): void;
  /** Snap the aim to the plane's nose (after spawning) and reset the cockpit switches for a new plane. */
  resetTo(plane: PlaneState, hasRadar?: boolean): void;
  toggleRadarLock(plane: PlaneState | null): void;
  cycleRadarMode(modes: readonly string[]): void;
  cycleRadarRange(): void;
  /** Next secondary weapon among `count` choices (−1 = automatic first). */
  cycleSecondary(count: number): void;
  aimDir(): Vec3;
  sample(plane: PlaneState, dt: number): ControlInput;
}

export function createPlayerControls(): PlayerControls {
  const pd = createAimPd();
  const aim = { yaw: 0, pitch: 0 };
  const look = { yaw: 0, pitch: 0 };
  const stick = { x: 0, y: 0 };
  let rudder = 0;
  let wepHold = 0;
  let stickMoved = false;
  let lockAskedFor = 0;
  let hadLock = false;
  let lookBackRaw = 0;

  const followNose = (plane: PlaneState): void => {
    const nose = yawPitchFromDir(rotate(plane.quat, FORWARD));
    aim.yaw = nose.yaw;
    aim.pitch = nose.pitch;
  };

  const c: PlayerControls = {
    aim,
    look,
    stick,
    freeLook: false,
    invertPitch: false,
    mode: 'mouseAim',
    throttle: 0.8,
    fire: false,
    missile: false,
    flare: false,
    target: null,
    override: { pitch: 0, roll: 0, yaw: 0 },
    rudderWanted: 0,
    get rudder() {
      return rudder;
    },
    airbrake: false,
    airbrakeHeld: false,
    flapStep: 0,
    gear: false,
    radarOn: true,
    radarDogfight: false,
    radarRange: 1,
    radarLockWanted: false,
    secondary: -1,
    view: 'chase',
    zoom: false,
    lookBack: false,
    get lookBackT() {
      // Ease in and out so the swing starts and stops softly.
      return lookBackRaw * lookBackRaw * (3 - 2 * lookBackRaw);
    },
    get lookingBack() {
      return c.lookBack || lookBackRaw > 0;
    },
    stepLookBack(dt) {
      const step = dt / LOOK_BACK_S;
      lookBackRaw = clamp(lookBackRaw + (c.lookBack ? step : -step), 0, 1);
    },
    touch: { zoom: false, rudder: 0, look: false },
    moveAim(dx, dy) {
      if (c.freeLook) {
        look.yaw += dx;
        look.pitch = clamp(look.pitch + dy, -1.2, 1.2);
        return;
      }
      if (c.mode === 'joystick') {
        // About 0.5 rad of mouse travel (a hand's width at normal sensitivity) is full stick.
        stick.x = clamp(stick.x + dx * 2, -1, 1);
        stick.y = clamp(stick.y + (c.invertPitch ? -dy : dy) * 2, -1, 1);
        stickMoved = true;
        return;
      }
      aim.yaw += dx;
      aim.pitch = clamp(aim.pitch + (c.invertPitch ? -dy : dy), -MAX_AIM_PITCH, MAX_AIM_PITCH);
    },
    setThrottle(value) {
      c.throttle = clamp(value, 0, WEP_THROTTLE);
      if (c.throttle > 1 && c.throttle < WEP_THROTTLE) c.throttle = c.throttle > 1.03 ? WEP_THROTTLE : 1;
    },
    throttleUp(dt, rate) {
      if (c.throttle < 1) {
        c.throttle = Math.min(1, c.throttle + rate * dt);
        wepHold = 0;
      } else if (c.throttle < WEP_THROTTLE) {
        wepHold += dt;
        if (wepHold >= WEP_HOLD_S) c.throttle = WEP_THROTTLE;
      }
    },
    throttleDown(dt, rate) {
      wepHold = 0;
      if (c.throttle > 1) c.throttle = 1;
      else c.throttle = Math.max(0, c.throttle - rate * dt);
    },
    autoLevel(plane) {
      const nose = rotate(plane.quat, FORWARD);
      aim.yaw = yawPitchFromDir(nose).yaw;
      aim.pitch = 0;
      stick.x = stick.y = 0;
    },
    resetTo(plane, hasRadar) {
      followNose(plane);
      look.yaw = 0;
      look.pitch = 0;
      stick.x = stick.y = 0;
      rudder = 0;
      c.throttle = plane.throttle;
      c.airbrake = false;
      c.flapStep = 0;
      c.gear = false;
      c.lookBack = false;
      lookBackRaw = 0;
      c.secondary = -1;
      c.radarLockWanted = c.radarDogfight;
      if (hasRadar !== undefined) c.radarOn = hasRadar || c.radarOn;
      hadLock = false;
    },
    toggleRadarLock(plane) {
      if (plane?.radarLock || c.radarLockWanted) {
        c.radarLockWanted = false;
        return;
      }
      c.radarLockWanted = true;
      c.radarOn = true;
      lockAskedFor = 0;
    },
    cycleRadarMode(modes) {
      c.radarDogfight = !c.radarDogfight && modes.includes('dogfight');
      // Dogfight locks by itself; Search waits for R.
      c.radarLockWanted = c.radarDogfight;
      lockAskedFor = 0;
    },
    cycleRadarRange() {
      c.radarRange = (c.radarRange + 1) % RADAR_RANGES_KM.length;
    },
    cycleSecondary(count) {
      c.secondary = count <= 1 ? -1 : c.secondary + 1 >= count ? -1 : c.secondary + 1;
    },
    aimDir() {
      return dirFromYawPitch(aim.yaw, aim.pitch);
    },
    sample(plane, dt) {
      const o = c.override;
      // Rudder: ramp toward what the keys want, recentre on release.
      const step = dt / RUDDER_RAMP_S;
      rudder += clamp(c.rudderWanted - rudder, -step, step);

      // Radar lock housekeeping: a lock that came and went (Search) or never came stops being wanted.
      if (plane.radarLock) {
        hadLock = true;
        lockAskedFor = 0;
        if (!c.target) c.target = plane.radarLock;
      } else if (c.radarLockWanted && !c.radarDogfight) {
        lockAskedFor += dt;
        if (hadLock || lockAskedFor > LOCK_GIVE_UP_S) c.radarLockWanted = false;
        hadLock = false;
      } else hadLock = false;

      let steer: Pick<ControlInput, 'pitch' | 'roll' | 'yaw'>;
      if (c.mode === 'joystick') {
        if (!stickMoved) {
          const back = STICK_RETURN * dt;
          stick.x -= clamp(stick.x, -back, back);
          stick.y -= clamp(stick.y, -back, back);
        }
        stickMoved = false;
        followNose(plane);
        steer = {
          pitch: o.pitch !== 0 ? o.pitch : stick.y,
          roll: o.roll !== 0 ? o.roll : stick.x,
          yaw: rudder,
        };
      } else {
        const nose = rotate(plane.quat, FORWARD);
        const aimNow = c.aimDir();
        const lead = Math.acos(clamp(aimNow[0] * nose[0] + aimNow[1] * nose[1] + aimNow[2] * nose[2], -1, 1));
        if (lead > MAX_LEAD) {
          // Slide the aim back along the arc toward the nose until it is MAX_LEAD away.
          const t = 1 - MAX_LEAD / lead;
          const mixed: Vec3 = [aimNow[0] + (nose[0] - aimNow[0]) * t, aimNow[1] + (nose[1] - aimNow[1]) * t, aimNow[2] + (nose[2] - aimNow[2]) * t];
          const back = yawPitchFromDir(normalize(mixed));
          aim.yaw = back.yaw;
          aim.pitch = clamp(back.pitch, -MAX_AIM_PITCH, MAX_AIM_PITCH);
        }
        const auto = aimControl(plane, c.aimDir(), pd, dt, { pitch: o.pitch, roll: o.roll });
        // Rudder adds fine yaw on top of the autopilot (precise gun aim, flat turns).
        steer = { ...auto, yaw: clamp(auto.yaw + rudder, -1, 1) };
        // While flying on direct pitch control (arrow keys), keep the aim glued to the nose so the
        // autopilot doesn't yank the plane back when the key is released.
        if (o.pitch !== 0) followNose(plane);
      }
      return {
        ...steer,
        throttle: Math.min(1, c.throttle),
        wep: c.throttle > 1,
        fire: c.fire,
        missile: c.missile,
        flare: c.flare,
        target: c.target,
        airbrake: c.airbrake || c.airbrakeHeld,
        flaps: c.flapStep > 0,
        flapStep: c.flapStep,
        gear: c.gear,
        radarOn: c.radarOn,
        radarDogfight: c.radarDogfight,
        radarRange: c.radarRange,
        radarLock: c.radarOn && c.radarLockWanted,
        secondary: c.secondary,
      };
    },
  };
  return c;
}
