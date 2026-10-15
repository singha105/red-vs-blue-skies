// 4-letter room codes without look-alikes (no I or O, and no digits so 0/1 can't be confused either).
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PEER_PREFIX = 'rvbs-';

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return code;
}

/** Normalises what a person typed (lower case, spaces, dashes) into a code, or null if it can't be one. */
export function parseRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) return null;
  return [...code].every((ch) => ROOM_ALPHABET.includes(ch)) ? code : null;
}

export const peerIdFor = (code: string): string => `${PEER_PREFIX}${code}`;

export function shareLink(code: string, origin = window.location.origin, base = import.meta.env.BASE_URL): string {
  return `${origin}${base}?room=${code}`;
}
