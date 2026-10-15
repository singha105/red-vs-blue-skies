// Procedural sound, all Web Audio and no sound files: engines per type pitched by throttle and speed, guns per
// calibre, hits, explosions, rockets, UI clicks, plus the cockpit tones (audio.ts) on the same context.
//
// One AudioContext with four buses under a master gain, each with its own volume slider: engines, weapons
// (guns, hits, explosions), cockpit (seeker and warning tones) and UI. Browsers only start audio from a user
// gesture; iPhone Safari also needs a sound started inside that gesture, so the first tap or key press resumes
// the context and plays a one-sample silent buffer. Safari's audio session is set to "playback" where
// supported, so the ring/silent switch doesn't mute the game.
import { getSettings, type Settings } from './settings';

export type EngineKind = 'rotary' | 'radial' | 'inline' | 'jet';
export type GunClass = 'mg' | 'hmg' | 'cannon' | 'heavy';
export type Bus = 'engine' | 'weapons' | 'cockpit' | 'ui';

/** One engine voice's input for a frame. */
export interface EngineInput {
  kind: EngineKind;
  throttle: number;
  /** Speed as a fraction of the plane's top speed. */
  speed: number;
  afterburner: boolean;
  /** 0–1 loudness from distance (1 = your own plane). */
  gain: number;
  /** −1 (left) … 1 (right). */
  pan: number;
}

export interface SoundEngine {
  readonly ctx: AudioContext | null;
  readonly unlocked: boolean;
  bus(name: Bus): GainNode | null;
  /** Up to four engine voices (yours first). Missing entries fade out. */
  engines(inputs: readonly EngineInput[]): void;
  gunshot(cls: GunClass, gain: number, pan: number): void;
  hit(kind: 'dealt' | 'taken', gain?: number): void;
  explosion(gain: number, pan: number, big?: boolean): void;
  whoosh(gain: number, pan: number): void;
  click(): void;
  /** Silence the engines (menus, death). */
  quiet(): void;
  /** Called once the context is running (after the first gesture). */
  onUnlock(fn: () => void): void;
  /** RMS level of everything playing right now, 0–1 (debug overlay and tests). */
  level(): number;
}

const MAX_ENGINES = 4;

/** Per gun class: noise decay, low-pass cutoff, and a thump for cannons. */
const SHOTS: Record<GunClass, { decay: number; cutoff: number; thumpHz: number; len: number; level: number }> = {
  mg: { decay: 0.018, cutoff: 0.55, thumpHz: 0, len: 0.06, level: 0.45 },
  hmg: { decay: 0.03, cutoff: 0.35, thumpHz: 90, len: 0.09, level: 0.55 },
  cannon: { decay: 0.05, cutoff: 0.22, thumpHz: 70, len: 0.14, level: 0.75 },
  heavy: { decay: 0.08, cutoff: 0.14, thumpHz: 48, len: 0.22, level: 0.9 },
};

/** Gun type id (guns.json) → sound class. */
export function gunClass(gunId: string): GunClass {
  if (gunId.startsWith('cannon_30') || gunId.startsWith('cannon_37') || gunId === 'cannon_27mm') return 'heavy';
  if (gunId.startsWith('cannon')) return 'cannon';
  if (gunId === 'mg_50' || gunId === 'mg_127' || gunId === 'mg_13') return 'hmg';
  return 'mg';
}

interface EngineVoice {
  kind: EngineKind | null;
  out: GainNode;
  pan: StereoPannerNode | null;
  /** Oscillators whose frequency follows the engine rate (with a multiplier each). */
  tones: { osc: OscillatorNode; mult: number }[];
  /** Amplitude-modulation LFO (prop firing pulses), frequency follows the rate too. */
  lfo: { osc: OscillatorNode; mult: number } | null;
  /** Filtered noise (jets), its band follows throttle. */
  noise: { filter: BiquadFilterNode; gain: GainNode } | null;
  burner: GainNode | null;
  nodes: AudioNode[];
}

export function createSound(settings: () => Readonly<Settings> = getSettings): SoundEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const buses = new Map<Bus, GainNode>();
  let noiseBuf: AudioBuffer | null = null;
  const shotBufs = new Map<GunClass, AudioBuffer>();
  let boomBuf: AudioBuffer | null = null;
  let whooshBuf: AudioBuffer | null = null;
  const voices: EngineVoice[] = [];
  const unlockFns: (() => void)[] = [];
  let unlocked = false;
  let analyser: AnalyserNode | null = null;
  let samples: Float32Array<ArrayBuffer> | null = null;

  const volumes = (): void => {
    if (!ctx || !master) return;
    const s = settings();
    const set = (g: GainNode, v: number): void => {
      g.gain.setTargetAtTime(v, ctx!.currentTime, 0.05);
    };
    set(master, s.volume);
    const b = (n: Bus): GainNode | undefined => buses.get(n);
    if (b('engine')) set(b('engine')!, 0.5 * s.engineVolume);
    if (b('weapons')) set(b('weapons')!, 0.7 * s.effectsVolume);
    if (b('cockpit')) set(b('cockpit')!, 0.18 * s.cockpitVolume);
    if (b('ui')) set(b('ui')!, 0.35 * s.cockpitVolume);
  };

  const makeBuffers = (c: AudioContext): void => {
    const sr = c.sampleRate;
    // Two seconds of white noise, looped by the jet voices.
    noiseBuf = c.createBuffer(1, sr * 2, sr);
    const n = noiseBuf.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    // Gunshots: decaying noise through a one-pole low-pass, plus a pitched thump for the bigger guns.
    for (const cls of Object.keys(SHOTS) as GunClass[]) {
      const d = SHOTS[cls];
      const buf = c.createBuffer(1, Math.ceil(sr * d.len), sr);
      const x = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        const env = Math.exp(-t / d.decay);
        lp += d.cutoff * ((Math.random() * 2 - 1) - lp);
        const thump = d.thumpHz ? Math.sin(2 * Math.PI * d.thumpHz * t * (1 - t * 2)) * Math.exp(-t / (d.decay * 1.6)) * 0.8 : 0;
        x[i] = (lp * 1.6 + thump) * env * d.level;
      }
      shotBufs.set(cls, buf);
    }
    // Explosion: 1.6 s of rumbling noise whose low-pass closes, plus a sub-bass drop.
    boomBuf = c.createBuffer(1, Math.ceil(sr * 1.6), sr);
    const bx = boomBuf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < bx.length; i++) {
      const t = i / sr;
      const cut = 0.25 * Math.exp(-t * 3) + 0.01;
      lp += cut * ((Math.random() * 2 - 1) - lp);
      const sub = Math.sin(2 * Math.PI * (55 - 25 * t) * t) * Math.exp(-t * 2.5);
      bx[i] = (lp * 3 + sub * 0.9) * Math.exp(-t * 2.2) * (t < 0.01 ? t / 0.01 : 1);
    }
    // Rocket whoosh: band-limited noise swelling then fading.
    whooshBuf = c.createBuffer(1, Math.ceil(sr * 0.9), sr);
    const wx = whooshBuf.getChannelData(0);
    let a = 0;
    let b = 0;
    for (let i = 0; i < wx.length; i++) {
      const t = i / sr;
      const r = Math.random() * 2 - 1;
      a += 0.3 * (r - a);
      b += 0.05 * (a - b);
      wx[i] = (a - b) * Math.sin(Math.PI * Math.min(1, t / 0.9)) * 1.4;
    }
  };

  const start = (): void => {
    if (ctx) {
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      // iOS 17+: play through the silent switch, like a game should once the player has tapped.
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
    } catch {
      // Older Safari has no audioSession.
    }
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const c = ctx;
    master = c.createGain();
    // A gentle limiter so twenty guns and an explosion don't clip.
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    master.connect(comp).connect(c.destination);
    analyser = c.createAnalyser();
    analyser.fftSize = 512;
    comp.connect(analyser);
    for (const name of ['engine', 'weapons', 'cockpit', 'ui'] as Bus[]) {
      const g = c.createGain();
      g.connect(master);
      buses.set(name, g);
    }
    makeBuffers(c);
    volumes();
    // iPhone Safari unlocks only if a source starts inside the gesture.
    const silent = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = silent;
    src.connect(c.destination);
    src.start(0);
    void c.resume().catch(() => undefined);
    const ready = (): void => {
      if (unlocked || c.state !== 'running') return;
      unlocked = true;
      for (const fn of unlockFns) fn();
    };
    c.onstatechange = ready;
    ready();
  };
  const onGesture = (): void => start();
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('touchend', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
  // Safari suspends ("interrupted") the context when the phone locks or another app takes audio.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  });

  let lastVolumes = '';
  const syncVolumes = (): void => {
    const s = settings();
    const key = `${s.volume}|${s.engineVolume}|${s.effectsVolume}|${s.cockpitVolume}`;
    if (key === lastVolumes) return;
    lastVolumes = key;
    volumes();
  };

  // ---------------------------------------------------------------- engines

  const freeVoice = (v: EngineVoice): void => {
    for (const n of v.nodes) {
      try {
        if ('stop' in n) (n as OscillatorNode).stop();
      } catch {
        // already stopped
      }
      n.disconnect();
    }
    v.nodes = [];
    v.tones = [];
    v.lfo = null;
    v.noise = null;
    v.burner = null;
    v.kind = null;
  };

  /** Builds the synthesis graph for one engine type into voice `v` (output → v.out). */
  const buildVoice = (c: AudioContext, v: EngineVoice, kind: EngineKind): void => {
    freeVoice(v);
    v.kind = kind;
    const nodes: AudioNode[] = [];
    const osc = (type: OscillatorType, mult: number, out: AudioNode, level: number): void => {
      const o = c.createOscillator();
      o.type = type;
      const g = c.createGain();
      g.gain.value = level;
      o.connect(g).connect(out);
      o.start();
      nodes.push(o, g);
      v.tones.push({ osc: o, mult });
    };
    if (kind === 'jet') {
      // Turbine: broadband roar (band-passed noise) plus a thin compressor whine.
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.7;
      const g = c.createGain();
      g.gain.value = 0.9;
      src.connect(filter).connect(g).connect(v.out);
      src.start();
      nodes.push(src, filter, g);
      v.noise = { filter, gain: g };
      osc('sine', 40, v.out, 0.05);
      // Afterburner: a deep, rough rumble (low-passed noise) faded in when lit.
      const bsrc = c.createBufferSource();
      bsrc.buffer = noiseBuf;
      bsrc.loop = true;
      bsrc.playbackRate.value = 0.6;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      const bg = c.createGain();
      bg.gain.value = 0;
      bsrc.connect(lp).connect(bg).connect(v.out);
      bsrc.start();
      nodes.push(bsrc, lp, bg);
      v.burner = bg;
    } else {
      // Pistons: harmonics of the firing rate through a low-pass, with the loudness pulsing at that rate.
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = kind === 'inline' ? 900 : kind === 'radial' ? 650 : 520;
      lp.Q.value = 1.2;
      const am = c.createGain();
      am.gain.value = 0.6;
      lp.connect(am).connect(v.out);
      nodes.push(lp, am);
      if (kind === 'rotary') {
        // WW1 rotary: a coarse buzzy pulse train that "blips".
        osc('square', 1, lp, 0.5);
        osc('sawtooth', 2.01, lp, 0.25);
      } else if (kind === 'radial') {
        // Radials: lower, lumpier, two slightly detuned saws.
        osc('sawtooth', 1, lp, 0.45);
        osc('sawtooth', 1.012, lp, 0.35);
        osc('square', 0.5, lp, 0.25);
      } else {
        // Inline V-12: smoother and higher, a strong second harmonic.
        osc('sawtooth', 1, lp, 0.4);
        osc('sawtooth', 2, lp, 0.3);
        osc('triangle', 3, lp, 0.15);
      }
      const lfo = c.createOscillator();
      lfo.type = kind === 'rotary' ? 'square' : 'sine';
      const depth = c.createGain();
      depth.gain.value = kind === 'rotary' ? 0.45 : kind === 'radial' ? 0.3 : 0.15;
      lfo.connect(depth).connect(am.gain);
      lfo.start();
      nodes.push(lfo, depth);
      v.lfo = { osc: lfo, mult: kind === 'rotary' ? 0.25 : 0.5 };
    }
    v.nodes = nodes;
  };

  const ensureVoices = (c: AudioContext): void => {
    while (voices.length < MAX_ENGINES) {
      const out = c.createGain();
      out.gain.value = 0;
      let pan: StereoPannerNode | null = null;
      if (typeof c.createStereoPanner === 'function') {
        pan = c.createStereoPanner();
        out.connect(pan).connect(buses.get('engine')!);
      } else out.connect(buses.get('engine')!);
      voices.push({ kind: null, out, pan, tones: [], lfo: null, noise: null, burner: null, nodes: [] });
    }
  };

  const api: SoundEngine = {
    get ctx() {
      return ctx;
    },
    get unlocked() {
      return unlocked;
    },
    bus(name) {
      return buses.get(name) ?? null;
    },
    onUnlock(fn) {
      unlockFns.push(fn);
      if (unlocked) fn();
    },
    engines(inputs) {
      if (!ctx || !unlocked) return;
      syncVolumes();
      const c = ctx;
      ensureVoices(c);
      const now = c.currentTime;
      for (let i = 0; i < MAX_ENGINES; i++) {
        const v = voices[i]!;
        const e = inputs[i];
        if (!e || e.gain < 0.01) {
          v.out.gain.setTargetAtTime(0, now, 0.15);
          continue;
        }
        if (v.kind !== e.kind) buildVoice(c, v, e.kind);
        // Firing rate: idle ~ 0.45, full throttle 1, a little more with speed (the prop windmills faster).
        const rate = 0.45 + 0.45 * e.throttle + 0.15 * Math.min(1.5, e.speed);
        if (e.kind === 'jet') {
          v.noise!.filter.frequency.setTargetAtTime(350 + 2100 * rate * rate, now, 0.12);
          v.noise!.gain.gain.setTargetAtTime(0.5 + 0.6 * e.throttle, now, 0.12);
          for (const t of v.tones) t.osc.frequency.setTargetAtTime(60 * t.mult * rate, now, 0.2);
          v.burner!.gain.setTargetAtTime(e.afterburner ? 1.6 : 0, now, 0.25);
        } else {
          const base = (e.kind === 'rotary' ? 38 : e.kind === 'radial' ? 34 : 46) * rate;
          for (const t of v.tones) t.osc.frequency.setTargetAtTime(base * t.mult, now, 0.08);
          if (v.lfo) v.lfo.osc.frequency.setTargetAtTime(base * v.lfo.mult, now, 0.08);
        }
        v.out.gain.setTargetAtTime(e.gain * (0.55 + 0.45 * e.throttle), now, 0.1);
        v.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, e.pan)), now, 0.1);
      }
    },
    gunshot(cls, gain, pan) {
      if (!ctx || !unlocked || gain < 0.02) return;
      const buf = shotBufs.get(cls);
      if (!buf) return;
      play(buf, 'weapons', gain * (0.9 + Math.random() * 0.2), pan, 0.94 + Math.random() * 0.12);
    },
    hit(kind, gain = 1) {
      if (!ctx || !unlocked) return;
      const c = ctx;
      // Dealt: a bright metallic tick. Taken: a dull thud and rattle.
      const o = c.createOscillator();
      o.type = kind === 'dealt' ? 'triangle' : 'square';
      o.frequency.setValueAtTime(kind === 'dealt' ? 2400 : 160, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(kind === 'dealt' ? 1500 : 70, c.currentTime + 0.08);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime((kind === 'dealt' ? 0.25 : 0.6) * gain, c.currentTime + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + (kind === 'dealt' ? 0.09 : 0.16));
      o.connect(g).connect(buses.get('weapons')!);
      o.start();
      o.stop(c.currentTime + 0.2);
      if (kind === 'taken') {
        const buf = shotBufs.get('hmg');
        if (buf) play(buf, 'weapons', 0.5 * gain, 0, 0.6);
      }
    },
    explosion(gain, pan, big = false) {
      if (!ctx || !unlocked || !boomBuf || gain < 0.02) return;
      play(boomBuf, 'weapons', Math.min(1.4, gain * (big ? 1.4 : 1)), pan, big ? 0.75 : 0.9 + Math.random() * 0.2);
    },
    whoosh(gain, pan) {
      if (!ctx || !unlocked || !whooshBuf || gain < 0.02) return;
      play(whooshBuf, 'weapons', gain * 0.8, pan, 0.9 + Math.random() * 0.2);
    },
    click() {
      if (!ctx || !unlocked) return;
      const c = ctx;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1300, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(700, c.currentTime + 0.04);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.8, c.currentTime + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.06);
      o.connect(g).connect(buses.get('ui')!);
      o.start();
      o.stop(c.currentTime + 0.08);
    },
    level() {
      if (!analyser) return 0;
      samples ??= new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      return Math.sqrt(sum / samples.length);
    },
    quiet() {
      if (!ctx) return;
      for (const v of voices) v.out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    },
  };

  function play(buf: AudioBuffer, bus: Bus, gain: number, pan: number, rate: number): void {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (typeof c.createStereoPanner === 'function' && Math.abs(pan) > 0.05) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(buses.get(bus)!);
    } else g.connect(buses.get(bus)!);
    src.start();
  }

  // UI clicks: every button press anywhere (menus and the HUD).
  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof Element && e.target.closest('button, [role="radio"], select')) api.click();
    },
    { capture: true },
  );

  return api;
}
