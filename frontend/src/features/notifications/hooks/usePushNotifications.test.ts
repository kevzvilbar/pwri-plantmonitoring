import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePushNotifications } from './usePushNotifications';

// A genuine 65-byte uncompressed P-256 point (RFC 8291 Appendix A, as_public).
const VALID_VAPID_KEY =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';

// vi.hoisted so the vi.mock factory below can reference these safely.
const { mockRpc, mockDelete } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockDelete: vi.fn(),
}));

// Mock useAuth
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123', email: 'operator@pwri.com' },
  }),
}));

// Mock supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mockRpc,
    from: () => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      delete: () => ({
        eq: mockDelete.mockResolvedValue({ error: null }),
      }),
    }),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

describe('usePushNotifications hook', () => {
  let mockGetSubscription: any;
  let mockSubscribe: any;
  // The real PushManager returns the subscription from getSubscription() once
  // subscribe() has succeeded, so the double must too — otherwise the hook's
  // legitimate re-read of browser state resets isSubscribed to false.
  let currentSubscription: any;

  const makeSubscription = (endpoint: string) => ({
    endpoint,
    getKey: vi.fn((name: string) => {
      if (name === 'p256dh') return new Uint8Array(65).fill(4).buffer;
      if (name === 'auth') return new Uint8Array(16).fill(1).buffer;
      return null;
    }),
    unsubscribe: vi.fn().mockImplementation(() => {
      currentSubscription = null;
      return Promise.resolve(true);
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VALID_VAPID_KEY);
    mockRpc.mockResolvedValue({ error: null });

    currentSubscription = null;
    mockGetSubscription = vi.fn(() => Promise.resolve(currentSubscription));
    mockSubscribe = vi.fn(() => {
      // NB: the argument is { userVisibleOnly, applicationServerKey }, not an endpoint.
      currentSubscription = makeSubscription('https://push.example.com/sub/123');
      return Promise.resolve(currentSubscription);
    });

    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    });
    vi.stubGlobal('PushManager', {});

    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: mockGetSubscription,
            subscribe: mockSubscribe,
          },
          showNotification: vi.fn().mockResolvedValue(undefined),
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects when push notifications are supported', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.checkSubscription();
    });

    expect(result.current.isSupported).toBe(true);
    expect(result.current.isConfigured).toBe(true);
    expect(result.current.permission).toBe('granted');
  });

  it('subscribes successfully and registers the device on the server', async () => {
    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribeToPush();
    });

    expect(success).toBe(true);
    expect(mockSubscribe).toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(true);
    // The subscription must reach push_subscriptions, or the server can never
    // deliver to this device. Assert on a specific call rather than all calls:
    // the self-healing path legitimately registers it again on mount.
    const upsertCall = mockRpc.mock.calls.find(([fn]) => fn === 'upsert_push_subscription');
    expect(upsertCall).toBeDefined();
    expect(upsertCall![1]).toMatchObject({
      p_endpoint: 'https://push.example.com/sub/123',
      p_p256dh: expect.any(String),
      p_auth: expect.any(String),
    });
    // 65-byte p256dh and 16-byte auth, base64-encoded.
    expect((upsertCall![1] as { p_p256dh: string }).p_p256dh.length).toBe(88);
    expect((upsertCall![1] as { p_auth: string }).p_auth.length).toBe(24);
  });

  it('unsubscribes successfully and updates state', async () => {
    const mockSub = makeSubscription('https://push.example.com/sub/123');
    currentSubscription = mockSub;

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.checkSubscription();
    });

    expect(result.current.isSubscribed).toBe(true);

    let success = false;
    await act(async () => {
      success = await result.current.unsubscribeFromPush();
    });

    expect(success).toBe(true);
    expect(mockSub.unsubscribe).toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });

  // Regression guard: with no VAPID key the old code silently fell back to a
  // public tutorial key and reported success for a subscription that could never
  // be delivered to.
  it('refuses to subscribe when the deployment has no VAPID key', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isConfigured).toBe(false);

    let success = true;
    await act(async () => {
      success = await result.current.subscribeToPush();
    });

    expect(success).toBe(false);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  // Regression guard: the old code wrapped the DB write in `if (user)` and
  // ignored its error, so a device whose subscription never persisted still
  // reported "successfully enabled".
  it('reports failure when the server registration fails', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'permission denied' } });

    const { result } = renderHook(() => usePushNotifications());

    let success = true;
    await act(async () => {
      success = await result.current.subscribeToPush();
    });

    expect(success).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
  });
});