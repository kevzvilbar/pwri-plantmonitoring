import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  isPushNotificationSupported,
  isIOSDevice,
  isStandalonePWA,
  urlBase64ToUint8Array,
  getVapidPublicKey,
  playNotificationSound,
} from '@/lib/pushNotification';
import { toast } from 'sonner';

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface UsePushNotificationsResult {
  isSupported: boolean;
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

export function usePushNotifications(): UsePushNotificationsResult {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [permission, setPermission] = useState<PushPermissionState>('default');
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [isPending, setIsPending] = useState<boolean>(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);

  const isIOSNonStandalone = isIOSDevice() && !isStandalonePWA();

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
      }
    } catch (err) {
      console.warn('[PushNotifications] Failed to inspect subscription state:', err);
    }
  }, []);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  // Subscribe to browser push manager and persist to Supabase
  const subscribeToPush = useCallback(async (): Promise<boolean> => {
    if (!isPushNotificationSupported()) {
      toast.error('Push notifications are not supported in this browser.');
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

      // 4. Extract encryption keys
      const p256dhKey = sub.getKey('p256dh');
      const authKey = sub.getKey('auth');

      const p256dh = p256dhKey
        ? btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(p256dhKey))))
        : '';
      const auth = authKey
        ? btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(authKey))))
        : '';

      // 5. Upsert to Supabase if authenticated
      if (user) {
        try {
          const { error } = await (supabase.from as any)('push_subscriptions').upsert(
            {
              endpoint: sub.endpoint,
              p256dh,
              auth,
              user_agent: navigator.userAgent,
              user_id: user.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'endpoint' }
          );

          if (error) {
            console.warn('[PushNotifications] Database subscription sync notice:', error.message);
          }
        } catch (dbErr) {
          console.warn('[PushNotifications] Database subscription error:', dbErr);
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
  }, [isIOSNonStandalone, user]);

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

  // Dispatch an immediate test alert to verify notification delivery & sound
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

      toast.success('Test notification dispatched!');
    } catch (err) {
      console.error('[PushNotifications] Test notification failed:', err);
      toast.error('Could not display test notification.');
    }
  }, [permission, subscribeToPush]);

  return {
    isSupported,
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

