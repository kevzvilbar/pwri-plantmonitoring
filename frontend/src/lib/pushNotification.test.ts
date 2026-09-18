import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isPushNotificationSupported,
  isIOSDevice,
  isStandalonePWA,
  urlBase64ToUint8Array,
  getVapidPublicKey,
  isValidVapidPublicKey,
  playNotificationSound,
} from './pushNotification';

// A genuine 65-byte uncompressed P-256 point (RFC 8291 Appendix A, as_public).
const VALID_VAPID_KEY =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';

describe('pushNotification utils', () => {
  const originalNavigator = window.navigator;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('isPushNotificationSupported', () => {
    it('returns true when serviceWorker, PushManager, and Notification exist', () => {
      vi.stubGlobal('Notification', {});
      vi.stubGlobal('PushManager', {});
      Object.defineProperty(window.navigator, 'serviceWorker', {
        value: {},
        configurable: true,
      });

      expect(isPushNotificationSupported()).toBe(true);
    });

    it('returns false when Notification is missing', () => {
      vi.stubGlobal('Notification', undefined);
      expect(isPushNotificationSupported()).toBe(false);
    });
  });

  describe('isIOSDevice', () => {
    it('detects iPhone from userAgent', () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)',
        configurable: true,
      });
      expect(isIOSDevice()).toBe(true);
    });

    it('detects iPad from userAgent', () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X)',
        configurable: true,
      });
      expect(isIOSDevice()).toBe(true);
    });

    it('returns false for Android userAgent', () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)',
        configurable: true,
      });
      Object.defineProperty(window.navigator, 'platform', {
        value: 'Linux armv8l',
        configurable: true,
      });
      expect(isIOSDevice()).toBe(false);
    });
  });

  describe('isStandalonePWA', () => {
    it('returns true when display-mode: standalone matches', () => {
      vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
      })));

      expect(isStandalonePWA()).toBe(true);
    });

    it('returns false when not standalone', () => {
      vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
      })));
      Object.defineProperty(window.navigator, 'standalone', {
        value: false,
        configurable: true,
      });

      expect(isStandalonePWA()).toBe(false);
    });
  });

  describe('urlBase64ToUint8Array', () => {
    it('correctly converts base64url string to Uint8Array', () => {
      const result = urlBase64ToUint8Array(VALID_VAPID_KEY);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(65); // uncompressed P-256 point
      expect(result[0]).toBe(0x04);
    });
  });

  describe('getVapidPublicKey', () => {
    it('returns an empty string when the deployment has not set a key', () => {
      // Regression guard: this used to return a hardcoded tutorial key whose
      // private half is public, making a broken deployment look configured.
      vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
      expect(getVapidPublicKey()).toBe('');
      expect(isValidVapidPublicKey(getVapidPublicKey())).toBe(false);
    });

    it('returns the configured key, trimmed', () => {
      vi.stubEnv('VITE_VAPID_PUBLIC_KEY', `  ${VALID_VAPID_KEY}  `);
      expect(getVapidPublicKey()).toBe(VALID_VAPID_KEY);
      expect(isValidVapidPublicKey(getVapidPublicKey())).toBe(true);
    });
  });

  describe('isValidVapidPublicKey', () => {
    it('accepts a 65-byte uncompressed P-256 point', () => {
      expect(isValidVapidPublicKey(VALID_VAPID_KEY)).toBe(true);
    });

    it('rejects missing, empty, and whitespace-only values', () => {
      expect(isValidVapidPublicKey(undefined)).toBe(false);
      expect(isValidVapidPublicKey(null)).toBe(false);
      expect(isValidVapidPublicKey('')).toBe(false);
      expect(isValidVapidPublicKey('   ')).toBe(false);
    });

    it('rejects a truncated key that a length heuristic would accept', () => {
      const truncated = VALID_VAPID_KEY.slice(0, 80);
      expect(truncated.length).toBeGreaterThan(20);
      expect(isValidVapidPublicKey(truncated)).toBe(false);
    });

    it('rejects 65 bytes that are not an uncompressed point', () => {
      // Same length, but the leading 0x04 tag is gone.
      expect(isValidVapidPublicKey(`A${VALID_VAPID_KEY.slice(1)}`)).toBe(false);
    });

    it('rejects non-base64 input', () => {
      expect(isValidVapidPublicKey('not a key!!')).toBe(false);
    });
  });

  describe('playNotificationSound', () => {
    it('gracefully executes without error', () => {
      expect(() => playNotificationSound('critical')).not.toThrow();
      expect(() => playNotificationSound('info')).not.toThrow();
    });
  });
});

