/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Metered Open Relay app domain, e.g. "myapp.metered.live" (optional; STUN only without it). */
  readonly VITE_TURN_DOMAIN?: string;
  /** Metered credential apiKey (browser-safe; only fetches TURN credentials). */
  readonly VITE_TURN_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
