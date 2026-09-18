import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  isPushNotificationSupported,
  isIOSDevice,
  isStandalonePWA,
  isValidVapidPublicKey,
  urlBase64ToUint8Array,
  getVapidPublicKey,
  playNotificationSound,
} from '@/lib/pushNotification';
import { toast } from 'sonner';

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface UsePushNotificationsResult {
  isSupported: boolean;
  /** False when this deployment has no valid VITE_VAPID_PUBLIC_KEY — subscribing is futile. */
  isConfigured: boolean;
  permission: PushPermissionState;
  isSubscribed: boolean;
  isPending: boolean;
  isIOSNonStandalone: boolean;
  subscription: PushSubscription | null;
  subscribeToPush: () => Promise<boolean>;
  unsubscribeFromPush: () => Promise<boolean>;
  sendLocalTestNotification: () => Promise<void>;
  checkSubscription: () => Promise<void>;
}

/** Base64-encodes a subscription key, or '' if the browser withheld it. */
function encodeKey(key: ArrayBuffer | null): string {
  if (!key) return '';
  const bytes = new Uint8Array(key);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function usePushNotifications(): UsePushNotificationsResult {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [permission, setPermission] = useState<PushPermissionState>('default');
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [isPending, setIsPending] = useState<boolean>(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);

  const isIOSNonStandalone = isIOSDevice() && !isStandalonePWA();
  // VAPID config is baked in at build time, so this is constant for the session.
  const isConfigured = isValidVapidPublicKey(getVapidPublicKey());

  /**
   * Persists a browser subscription so the server can reach this device.
   *
   * Uses the upsert_push_subscription RPC rather than a direct table upsert for
   * two reasons: it is atomic, and it is SECURITY DEFINER (it takes user_id from
   * auth.uid()). A direct upsert's ON CONFLICT DO UPDATE is gated by the UPDATE
   * RLS policy against the *existing* row, so when a shared device changes hands
   * the update is silently refused — the new operator never receives alerts, with
   * no error anywhere. The RPC reassigns ownership explicitly.
   */
  const persistSubscription = useCallback(async (sub: PushSubscription): Promise<void> => {
    const p256dh = encodeKey(sub.getKey('p256dh'));
    const auth = encodeKey(sub.getKey('auth'));
    if (!p256dh || !auth) {
      throw new Error('The browser did not expose the subscription encryption keys.');
    }

    const { error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)('upsert_push_subscription', {
      p_endpoint: sub.endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent,
    });

    if (error) throw new Error(error.message);
  }, []);

  // Check initial capability & subscription state
  const checkSubscription = useCallback(async () => {
    if (!isPushNotificationSupported()) {
      setIsSupported(false);
      setPermission('unsupported');
      return;
    }

    setIsSupported(true);
    setPermission(Notification.permission);

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        setSubscription(sub);
        setIsSubscribed(!!sub);

        // Self-healing registration. A subscription can exist in the browser
        // while having no (or a stale) server-side row — e.g. it was created
        // before sign-in, the row was pruned as expired, or the browser rotated
        // the endpoint. Re-registering on every load makes the device reachable
        // again without the operator having to notice and toggle anything.
        // Failures are logged, not toasted: this runs on mount, and a toast per
        // page load would be noise the operator cannot act on.
        if (sub && user && isConfigured) {
          try {
            await persistSubscription(sub);
          } catch (err) {
            console.warn('[PushNotifications] Could not register this device for server pushes:', err);
          }
        }
      }
    } catch (err) {
      console.warn('[PushNotifications] Failed to inspect subscription state:', err);
    }
  }, [user, isConfigured, persistSubscription]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  // The service worker has no VAPID key of its own, so on `pushsubscriptionchange`
  // it just pokes the app; re-running checkSubscription() picks up whatever the
  // browser replaced the subscription with and re-registers it.
  useEffect(() => {
    if (!isPushNotificationSupported() || !('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PWRI_PUSH_SUBSCRIPTION_CHANGED') {
        checkSubscription();
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [checkSubscription]);

  // Subscribe to browser push manager and persist to Supabase
  const subscribeToPush = useCallback(async (): Promise<boolean> => {
    if (!isPushNotificationSupported()) {
      toast.error('Push notifications are not supported in this browser.');
      return false;
    }

    // Without a matching VAPID keypair nothing can be delivered, so surface the
    // missing configuration instead of creating a subscription that will never
    // receive anything while the UI claims success.
    if (!isConfigured) {
      toast.error(
        'Push notifications are not configured for this deployment. ' +
          'An administrator must set VITE_VAPID_PUBLIC_KEY.',
      );
      return false;
    }

    if (isIOSNonStandalone) {
      toast.error('On iOS, push alerts require adding PWRI to your Home Screen first.');
      return false;
    }

    setIsPending(true);
    try {
      // 1. Request permission
      let perm: NotificationPermission = Notification.permission;
      if (perm !== 'granted') {
        perm = await Notification.requestPermission();
        setPermission(perm);
      }

      if (perm !== 'granted') {
        if (perm === 'denied') {
          toast.error('Push notifications were blocked. Please enable them in your browser settings.');
        } else {
          toast.warning('Push notification permission was not granted.');
        }
        setIsPending(false);
        return false;
      }

      // 2. Wait for Service Worker
      const registration = await navigator.serviceWorker.ready;

      // 3. Subscribe with VAPID applicationServerKey
      const vapidKey = getVapidPublicKey();
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);

      let sub = await registration.pushManager.getSubscription();
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      }

      // 4. Register the device with the server. A subscription that never lands
      // in push_subscriptions receives nothing, so a failure here must not be
      // reported as success.
      if (!user) {
        toast.warning(
          'This device is registered locally, but alerts will not arrive until you sign in.',
        );
      } else {
        try {
          await persistSubscription(sub);
        } catch (dbErr) {
          console.error('[PushNotifications] Failed to register device for pushes:', dbErr);
          toast.error(
            'Push notifications could not be registered on the server: ' +
              ((dbErr as Error)?.message || 'Unknown error'),
          );
          return false;
        }
      }

      setSubscription(sub);
      setIsSubscribed(true);
      setPermission('granted');
      toast.success('Push notifications successfully enabled on this device.');
      return true;
    } catch (err) {
      console.error('[PushNotifications] Subscription failed:', err);
      toast.error('Failed to enable push notifications: ' + ((err as Error)?.message || 'Unknown error'));
      return false;
    } finally {
      setIsPending(false);
    }
  }, [isConfigured, isIOSNonStandalone, user, persistSubscription]);

  // Unsubscribe from browser and delete from Supabase
  const unsubscribeFromPush = useCallback(async (): Promise<boolean> => {
    setIsPending(true);
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();

          if (user) {
            try {
              await (supabase.from as any)('push_subscriptions')
                .delete()
                .eq('endpoint', endpoint);
            } catch (dbErr) {
              // Not fatal: the endpoint is gone from the browser, and the server
              // prunes it automatically the first time it answers 404/410.
              console.warn('[PushNotifications] Database removal warning:', dbErr);
            }
          }
        }
      }

      setSubscription(null);
      setIsSubscribed(false);
      toast.info('Push notifications disabled for this device.');
      return true;
    } catch (err) {
      console.error('[PushNotifications] Unsubscription failed:', err);
      toast.error('Failed to disable push notifications.');
      return false;
    } finally {
      setIsPending(false);
    }
  }, [user]);

  /**
   * Displays an immediate notification on this device.
   *
   * This is a LOCAL notification via showNotification — it exercises the
   * permission, the service worker registration and the alarm chime, but it does
   * NOT exercise server delivery. A green result here does not mean the server
   * can reach this device; that path is verified by triggering a real alert (or
   * by inspecting the send-push-notification response).
   */
  const sendLocalTestNotification = useCallback(async () => {
    if (permission !== 'granted') {
      const ok = await subscribeToPush();
      if (!ok) return;
    }

    try {
      playNotificationSound('critical');

      const title = 'PWRI Plant Alert: Test Notification';
      const options: NotificationOptions = {
        body: 'Push notifications are active. You will receive real-time alerts for critical plant operations.',
        icon: './icon-192.png',
        badge: './favicon.png',
        tag: 'pwri-test-' + Date.now(),
        data: {
          url: './alerts',
          severity: 'critical',
        },
      };

      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, options);
      } else {
        new Notification(title, options);
      }

      toast.success('Test notification shown on this device (local preview).');
    } catch (err) {
      console.error('[PushNotifications] Test notification failed:', err);
      toast.error('Could not display test notification.');
    }
  }, [permission, subscribeToPush]);

  return {
    isSupported,
    isConfigured,
    permission,
    isSubscribed,
    isPending,
    isIOSNonStandalone,
    subscription,
    subscribeToPush,
    unsubscribeFromPush,
    sendLocalTestNotification,
    checkSubscription,
  };
}