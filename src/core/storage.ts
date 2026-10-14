// localStorage that never throws. Safari private mode, blocked cookies and full quotas all fall back to memory.

const memory = new Map<string, string>();

export function readStorage(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // Storage blocked: fall through to the in-memory copy.
  }
  return memory.get(key) ?? null;
}

export function writeStorage(key: string, value: string): boolean {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
