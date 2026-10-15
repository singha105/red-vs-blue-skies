// Cockpit tones, all synthesised with Web Audio (no sound files):
// * IR seeker: a low growl while it searches, a steady high tone once it has locked.
// * Radar: quick beeps while locking, a steady tone when locked.
// * Radar warning: slow beeps while someone's radar is locked on you, fast loud beeps when a missile is inbound.
// The context starts on the first tap or key press (browsers, iOS Safari especially, need a gesture).

export type SeekerTone = 'off' | 'ir_search' | 'ir_lock' | 'radar_search' | 'radar_lock';
export type WarningTone = 'off' | 'spike' | 'launch';

export interface CockpitAudio {
  update(seeker: SeekerTone, warning: WarningTone, time: number): void;
  /** Silence everything (menus, death). */
  mute(): void;
  dispose(): void;
}

type Ctx = AudioContext;

interface Voice {
  osc: OscillatorNode;
  gate: GainNode;
}

export function createCockpitAudio(volume: () => number): CockpitAudio {
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  let seekerV: Voice | null = null;
  let growl: { amp: GainNode; lfo: OscillatorNode } | null = null;
  let warnV: Voice | null = null;

  const voice = (c: Ctx, out: AudioNode, type: OscillatorType): Voice => {
    const osc = c.createOscillator();
    osc.type = type;
    const gate = c.createGain();
    gate.gain.value = 0;
    osc.connect(gate).connect(out);
    osc.start();
    return { osc, gate };
  };

  const start = (): void => {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0.18 * volume();
    master.connect(ctx.destination);
    // The growl: the seeker's tone with its loudness wobbling at ~22 Hz.
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    amp.connect(master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(amp.gain);
    lfo.start();
    growl = { amp, lfo };
    seekerV = voice(ctx, amp, 'sawtooth');
    warnV = voice(ctx, master, 'square');
  };
  const onGesture = (): void => start();
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);

  const set = (param: AudioParam, value: number): void => {
    if (!ctx) return;
    if (Math.abs(param.value - value) < 1e-4) return;
    param.setTargetAtTime(value, ctx.currentTime, 0.012);
  };

  let lastSeeker: SeekerTone = 'off';
  return {
    update(seeker, warning, time) {
      if (!ctx || !master || !seekerV || !warnV || !growl) return;
      set(master.gain, 0.18 * volume());
      // Seeker voice.
      let f = 0;
      let g = 0;
      let wobble = 0;
      if (seeker === 'ir_search') {
        f = 380;
        g = 0.55;
        wobble = 0.5;
      } else if (seeker === 'ir_lock') {
        f = 1250;
        g = 0.45;
      } else if (seeker === 'radar_search') {
        f = 1050;
        g = (time * 5) % 1 < 0.35 ? 0.35 : 0;
      } else if (seeker === 'radar_lock') {
        f = 1500;
        g = 0.3;
      }
      if (seeker !== lastSeeker) {
        seekerV.osc.type = seeker.startsWith('ir') ? 'sawtooth' : 'sine';
        lastSeeker = seeker;
      }
      if (f > 0) set(seekerV.osc.frequency, f);
      set(seekerV.gate.gain, g);
      set(growl.amp.gain, 1 - wobble);
      // Warning voice.
      let wf = 0;
      let wg = 0;
      if (warning === 'launch') {
        wf = 1750;
        wg = (time * 8) % 1 < 0.5 ? 0.7 : 0;
      } else if (warning === 'spike') {
        wf = 880;
        wg = (time * 2) % 1 < 0.25 ? 0.35 : 0;
      }
      if (wf > 0) set(warnV.osc.frequency, wf);
      set(warnV.gate.gain, wg);
    },
    mute() {
      if (seekerV) set(seekerV.gate.gain, 0);
      if (warnV) set(warnV.gate.gain, 0);
    },
    dispose() {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
