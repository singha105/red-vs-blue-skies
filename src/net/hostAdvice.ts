// Who should host? The host's browser runs the whole match, so it wants a laptop on a solid connection.
// Phones are the worst choice: iOS Safari suspends WebRTC the moment the screen locks or Safari goes to
// the background, which ends the match for everyone.
import type { LobbyPlayer } from './protocol';

export function hostScore(p: LobbyPlayer): number {
  let s = 0;
  s += p.device.touch ? -3 : 3;
  const c = p.device.connection;
  if (c === 'ethernet') s += 2;
  else if (c === 'wifi') s += 1;
  else if (c === 'cellular') s -= 3;
  // Lower ping to the current host suggests a better link (the host itself counts as 0).
  if (p.pingMs !== null) s -= Math.min(3, p.pingMs / 80);
  return s;
}

export interface HostAdvice {
  best: LobbyPlayer | null;
  /** A short sentence for the lobby, or '' if the current host is already the best choice. */
  message: string;
  /** The current host is on a touch device. */
  hostOnPhone: boolean;
}

export function adviseHost(players: readonly LobbyPlayer[]): HostAdvice {
  const host = players.find((p) => p.host) ?? null;
  const ranked = [...players].sort((a, b) => hostScore(b) - hostScore(a));
  const best = ranked[0] ?? null;
  const hostOnPhone = Boolean(host?.device.touch);
  let message = '';
  if (best && host && best.id !== host.id && hostScore(best) - hostScore(host) >= 2) {
    const why = best.device.touch ? 'better connection' : best.device.connection === 'wifi' || best.device.connection === 'ethernet' ? 'laptop on a wired or Wi-Fi connection' : 'laptop';
    message = `${best.name} would make a better host (${why}${best.pingMs !== null ? `, ${Math.round(best.pingMs)} ms` : ''}).`;
  }
  return { best, message, hostOnPhone };
}

export function deviceInfo(): { touch: boolean; connection: string | null } {
  const nav = navigator as Navigator & { connection?: { type?: string } };
  return {
    touch: window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
    connection: nav.connection?.type ?? null,
  };
}
