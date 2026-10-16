// The single control format. Mouse, touch, gamepad, keyboard, bots and (Day 5) network clients all produce this.
// The Day 11 fields are optional so older callers (tests, scripted planes) keep working: missing = off.

export interface ControlInput {
  /** −1..1, positive = nose up. */
  pitch: number;
  /** −1..1, positive = roll right (right wing down). */
  roll: number;
  /** −1..1, positive = nose right. */
  yaw: number;
  /** 0..1 commanded throttle; the engine spools toward it. */
  throttle: number;
  fire: boolean;
  missile: boolean;
  flare: boolean;
  /** Plane id picked as the missile target (R / tap / RB), or null to let the weapons computer choose. */
  target: string | null;
  /** WEP (props) or afterburner (jets): only works at full throttle, heats the engine. */
  wep?: boolean;
  airbrake?: boolean;
  flaps?: boolean;
  /** Radar power, Dogfight mode (else Search), display range index (0–2: 5/10/20 km), and whether the pilot
   *  wants a lock (on `target` if the radar sees it, else the contact nearest the nose). */
  radarOn?: boolean;
  radarDogfight?: boolean;
  radarRange?: number;
  radarLock?: boolean;
  /** Secondary weapon picked with Left Shift: a missile mount index (or 0 rockets / 1 bombs); −1 or missing = auto. */
  secondary?: number;
}

export function neutralInput(throttle = 0.8): ControlInput {
  return { pitch: 0, roll: 0, yaw: 0, throttle, fire: false, missile: false, flare: false, target: null };
}
