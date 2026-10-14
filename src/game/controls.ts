// The single control format. Mouse, touch, gamepad, keyboard, bots and (Day 5) network clients all produce this.

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
}

export function neutralInput(throttle = 0.8): ControlInput {
  return { pitch: 0, roll: 0, yaw: 0, throttle, fire: false, missile: false, flare: false };
}
