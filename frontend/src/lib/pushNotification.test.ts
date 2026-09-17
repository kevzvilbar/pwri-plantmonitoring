import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isPushNotificationSupported,
  isIOSDevice,
  isStandalonePWA,
  urlBase64ToUint8Array,
  getVapidPublicKey,
  playNotificationSound,
  DEFAULT_VAPID_PUBLIC_KEY,
} from './pushNotification';

describe('pushNotification utils', () => {
  const originalNavigator = window.navigator;

  afterEach(() => {
    vi.restoreAllMocks();
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
      const result = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getVapidPublicKey', () => {
    it('returns default fallback key if env var is empty', () => {
      const key = getVapidPublicKey();
      expect(key).toBe(DEFAULT_VAPID_PUBLIC_KEY);
    });
  });

  describe('playNotificationSound', () => {
    it('gracefully executes without error', () => {
      expect(() => playNotificationSound('critical')).not.toThrow();
      expect(() => playNotificationSound('info')).not.toThrow();
    });
  });
});

