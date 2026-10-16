// Player settings, persisted to localStorage. Unknown or broken saved values fall back to defaults.
import { readStorage, writeStorage } from './storage';

export type GraphicsLevel = 'auto' | 'low' | 'medium' | 'high';

export interface Settings {
  graphics: GraphicsLevel;
  /** Aim sensitivity multiplier, 0.2–3. */
  sensitivity: number;
  /** Touch aim assist strength, 0 (off) to 1. */
  aimAssist: number;
  /** Master volume, 0–1. */
  volume: number;
  /** Per-bus volumes, 0–1: engines; guns, hits and explosions; cockpit tones and UI clicks. */
  engineVolume: number;
  effectsVolume: number;
  cockpitVolume: number;
  /** Draw at most 30 frames a second (saves battery on phones; the simulation still runs at 60 Hz). */
  cap30: boolean;
  /** Team colours: red/blue, or blue/orange for colour-blind players. */
  teamColours: 'classic' | 'colourblind';
  /** HUD size multiplier, 1–1.6 (never smaller: HUD text stays at least 14 px on a phone). */
  hudScale: number;
  /** Mouse, drag, stick and arrow keys move the nose the other way vertically (flight-sim style). */
  invertPitch: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  graphics: 'auto',
  sensitivity: 1,
  aimAssist: 0.6,
  volume: 0.8,
  engineVolume: 0.7,
  effectsVolume: 0.8,
  cockpitVolume: 0.8,
  cap30: false,
  teamColours: 'classic',
  hudScale: 1,
  invertPitch: false,
};

const KEY = 'rvbs.settings.v1';

type Listener = (settings: Readonly<Settings>) => void;

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function sanitizeSettings(raw: unknown): Settings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const graphics = o['graphics'];
  return {
    graphics: graphics === 'low' || graphics === 'medium' || graphics === 'high' || graphics === 'auto' ? graphics : DEFAULT_SETTINGS.graphics,
    sensitivity: clamp(o['sensitivity'], 0.2, 3, DEFAULT_SETTINGS.sensitivity),
    aimAssist: clamp(o['aimAssist'], 0, 1, DEFAULT_SETTINGS.aimAssist),
    volume: clamp(o['volume'], 0, 1, DEFAULT_SETTINGS.volume),
    engineVolume: clamp(o['engineVolume'], 0, 1, DEFAULT_SETTINGS.engineVolume),
    effectsVolume: clamp(o['effectsVolume'], 0, 1, DEFAULT_SETTINGS.effectsVolume),
    cockpitVolume: clamp(o['cockpitVolume'], 0, 1, DEFAULT_SETTINGS.cockpitVolume),
    cap30: o['cap30'] === true,
    teamColours: o['teamColours'] === 'colourblind' ? 'colourblind' : 'classic',
    hudScale: clamp(o['hudScale'], 1, 1.6, DEFAULT_SETTINGS.hudScale),
    invertPitch: o['invertPitch'] === true,
  };
}

function load(): Settings {
  const text = readStorage(KEY);
  if (!text) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = load();
const listeners = new Set<Listener>();

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Readonly<Settings> {
  current = sanitizeSettings({ ...current, ...patch });
  writeStorage(KEY, JSON.stringify(current));
  for (const fn of listeners) fn(current);
  return current;
}

export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
