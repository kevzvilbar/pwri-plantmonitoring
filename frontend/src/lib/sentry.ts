import * as Sentry from '@sentry/react';

let sentryReady = false;

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENV as string | undefined)?.trim() || import.meta.env.MODE || 'development',
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      if (event.user) {
        delete event.user.ip_address;
      }
      if (event.request) {
        if (event.request.cookies) {
          delete event.request.cookies;
        }
        if (event.request.headers) {
          const sensitive = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
          for (const key of Object.keys(event.request.headers)) {
            if (sensitive.includes(key.toLowerCase())) {
              delete event.request.headers[key];
            }
          }
        }
      }
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (
            ['password', 'token', 'secret', 'api_key', 'apikey', 'authorization'].some((s) =>
              key.toLowerCase().includes(s)
            )
          ) {
            delete event.extra[key];
          }
        }
      }
      return event;
    },
    integrations: (() => {
      try {
        if (typeof Sentry.replayIntegration === 'function') {
          return [Sentry.replayIntegration()];
        }
      } catch {
        // ignore
      }
      return undefined;
    })(),
  });
  sentryReady = true;
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (typeof console !== 'undefined') {
    console.error('[monitoring]', error, context ?? '');
  }
  if (sentryReady) {
    Sentry.captureException(error, { extra: context });
  }
}
