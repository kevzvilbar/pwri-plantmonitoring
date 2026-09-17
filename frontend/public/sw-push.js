/**
 * PWRI Web Push Service Worker Extension
 * Handles push notifications and notification interactions for mobile and desktop.
 */

self.addEventListener('push', function (event) {
  if (!event.data) {
    return;
  }

  var payload = {};
  try {
    payload = event.data.json();
  } catch (err) {
    payload = {
      title: 'PWRI Plant Alert',
      body: event.data.text() || 'New operational update received.',
    };
  }

  var title = payload.title || 'PWRI Plant Alert';
  var isCritical = payload.severity === 'critical';

  var options = {
    body: payload.body || payload.message || 'New operational alert in PWRI Plant Monitoring.',
    icon: payload.icon || './icon-192.png',
    badge: payload.badge || './favicon.png',
    tag: payload.tag || ('pwri-alert-' + (payload.severity || 'info') + '-' + Date.now()),
    renotify: true,
    requireInteraction: isCritical,
    vibrate: isCritical ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: {
      url: payload.url || payload.linkPath || './alerts',
      timestamp: Date.now(),
      severity: payload.severity || 'info',
      ...payload.data,
    },
    actions: payload.actions || [
      { action: 'open', title: 'View Details' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  var notifData = event.notification.data || {};
  var rawUrl = notifData.url || './alerts';

  // Construct absolute URL
  var targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      // If a PWRI window is already open, focus it and optionally navigate
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if ('focus' in client) {
          if ('navigate' in client && client.url !== targetUrl) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('notificationclose', function (event) {
  // Notification dismissed by user
});

