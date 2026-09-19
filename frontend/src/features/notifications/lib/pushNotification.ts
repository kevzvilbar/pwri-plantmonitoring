/**
 * Web Push Notification Utilities
 * Provides helpers for push support detection, VAPID encoding, iOS PWA status, and audible alarm synthesis.
 */

/**
 * There is deliberately NO hardcoded fallback VAPID public key.
 *
 * This module previously fell back to `BEl62iUYgUivxIkv69yViEuiBIa-...` — the
 * example key printed in the `web-push` README. Its private half is public, so
 * subscriptions created against it can never be delivered to legitimately; the
 * failure was also invisible, because a plausible-looking key made the UI report
 * "Active". An unconfigured deployment now reports "Not configured" instead.
 *
 * A valid key is a 65-byte uncompressed P-256 point (87 base64url chars), and it
 * MUST match VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the Edge Function secrets —
 * generate a pair with `node scripts/generate-vapid-keys.mjs`.
 */
const P256_UNCOMPRESSED_BYTES = 65;
const UNCOMPRESSED_POINT_TAG = 0x04;

/** Returns the configured VAPID public key, or '' when this deployment has none. */
export function getVapidPublicKey(): string {
  const envKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof envKey === 'string' ? envKey.trim() : '';
}

/**
 * Validates that `key` is a decodable 65-byte uncompressed P-256 point.
 *
 * A length heuristic (`key.length > 20`) is not enough: a truncated or
 * mis-encoded key is accepted by `length` and then rejected by the browser with
 * an opaque `InvalidAccessError` at subscribe time, or worse, silently produces
 * a subscription the server cannot encrypt to.
 */
export function isValidVapidPublicKey(key: string | null | undefined): boolean {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed) return false;

  const padding = '='.repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, '+').replace(/_/g, '/');

  try {
    const decoded = window.atob(base64);
    return (
      decoded.length === P256_UNCOMPRESSED_BYTES &&
      decoded.charCodeAt(0) === UNCOMPRESSED_POINT_TAG
    );
  } catch {
    return false;
  }
}

/**
 * Checks if the current environment supports Web Push Notifications.
 */
export function isPushNotificationSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof window.Notification !== 'undefined' &&
    window.Notification !== null
  );
}

/**
 * Detects if the current client is running on an iOS device (iPhone, iPad, iPod).
 */
export function isIOSDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || navigator.vendor || '';
  const isApple = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isApple || isIPadOS;
}

/**
 * Detects whether the app is currently running in standalone PWA mode (e.g., added to Home Screen).
 */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  const isStandaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
  const isNavStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return isStandaloneMedia || isNavStandalone;
}

/**
 * Converts a Base64 / Base64URL string to a Uint8Array for applicationServerKey.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Synthesizes a high-end, subtle dual-tone industrial alert chime using Web Audio API.
 * Guaranteed zero-dependency: requires no external mp3 or network request.
 */
export function playNotificationSound(severity: 'critical' | 'warning' | 'info' = 'info'): void {
  if (typeof window === 'undefined') return;

  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    gainNode.connect(ctx.destination);
    gainNode.gain.setValueAtTime(0.0001, now);

    if (severity === 'critical') {
      // Urgent, crisp dual-pulse: 880Hz (A5) -> 1174Hz (D6)
      osc1.type = 'triangle';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(880, now);
      osc2.frequency.setValueAtTime(1174.66, now);

      gainNode.gain.exponentialRampToValueAtTime(0.25, now + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.05, now + 0.18);
      gainNode.gain.exponentialRampToValueAtTime(0.3, now + 0.22);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

      osc1.connect(gainNode);
      osc2.connect(gainNode);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.56);
      osc2.stop(now + 0.56);
    } else {
      // Smooth industrial chime: 587.33Hz (D5) -> 880Hz (A5)
      osc1.type = 'sine';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12);

      gainNode.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

      osc1.connect(gainNode);

      osc1.start(now);
      osc1.stop(now + 0.42);
    }

    // Auto-close audio context after sound playback
    setTimeout(() => {
      try {
        if (ctx.state !== 'closed') {
          ctx.close();
        }
      } catch {
        // ignore
      }
    }, 800);
  } catch {
    // AudioContext may be blocked before first user gesture
  }
}
