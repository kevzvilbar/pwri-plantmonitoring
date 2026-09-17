import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePushNotifications } from './usePushNotifications';

// Mock useAuth
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123', email: 'operator@pwri.com' },
  }),
}));

// Mock supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      delete: () => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
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

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSubscription = vi.fn().mockResolvedValue(null);
    mockSubscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.com/sub/123',
      getKey: vi.fn((name: string) => {
        if (name === 'p256dh') return new Uint8Array([1, 2, 3]).buffer;
        if (name === 'auth') return new Uint8Array([4, 5, 6]).buffer;
        return null;
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
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
      },
      configurable: true,
    });
  });

  it('detects when push notifications are supported', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.checkSubscription();
    });

    expect(result.current.isSupported).toBe(true);
    expect(result.current.permission).toBe('granted');
  });

  it('subscribes successfully and updates state', async () => {
    const { result } = renderHook(() => usePushNotifications());

    let success = false;
    await act(async () => {
      success = await result.current.subscribeToPush();
    });

    expect(success).toBe(true);
    expect(mockSubscribe).toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(true);
  });

  it('unsubscribes successfully and updates state', async () => {
    const mockSub = {
      endpoint: 'https://push.example.com/sub/123',
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    mockGetSubscription.mockResolvedValue(mockSub);

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
});

