// ICE servers: Google's public STUN for everyone, plus Metered Open Relay TURN when configured, for phones
// behind mobile-carrier NAT. The Metered apiKey is credential-scoped and meant for browsers (it can only
// fetch TURN credentials), so it is fine for it to ship in the public bundle.
const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

export const turnConfigured = (): boolean => Boolean(import.meta.env.VITE_TURN_DOMAIN && import.meta.env.VITE_TURN_API_KEY);

export async function iceServers(): Promise<RTCIceServer[]> {
  const domain = import.meta.env.VITE_TURN_DOMAIN;
  const key = import.meta.env.VITE_TURN_API_KEY;
  if (!domain || !key) return STUN;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`TURN credentials: HTTP ${res.status}`);
    const list = (await res.json()) as RTCIceServer[];
    return Array.isArray(list) ? [...STUN, ...list] : STUN;
  } catch (err) {
    console.warn('Could not fetch TURN credentials; continuing with STUN only', err);
    return STUN;
  } finally {
    clearTimeout(timer);
  }
}
