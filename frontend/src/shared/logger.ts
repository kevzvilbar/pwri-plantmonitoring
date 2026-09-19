/**
 * lib/logger.ts — Structured logging with Sentry integration
 * 
 * Phase 5: Operational Maturity
 * Provides consistent structured logging across the application
 * with automatic Sentry error capture and contextual metadata.
 */

import * as Sentry from '@sentry/react';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  plantId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, any>;
  error?: Error;
}

interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LEVEL];
}

function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  if (!context) return base;
  
  const parts: string[] = [];
  if (context.userId) parts.push(`user=${context.userId}`);
  if (context.plantId) parts.push(`plant=${context.plantId}`);
  if (context.component) parts.push(`component=${context.component}`);
  if (context.action) parts.push(`action=${context.action}`);
  
  const meta = parts.length > 0 ? ` {${parts.join(', ')}}` : '';
  return `${base}${meta}`;
}

function sendToSentry(level: LogLevel, message: string, context?: LogContext) {
  if (!shouldLog(level)) return;
  if (level === 'debug' || level === 'info') return;
  
  const eventId = Sentry.captureException(context?.error ?? new Error(message), {
    level: level === 'warn' ? 'warning' : 'error',
    extra: {
      message,
      userId: context?.userId,
      plantId: context?.plantId,
      component: context?.component,
      action: context?.action,
      metadata: context?.metadata,
    },
    tags: {
      component: context?.component,
      plantId: context?.plantId,
    },
    user: context?.userId ? { id: context.userId } : undefined,
  });
  
  return eventId;
}

export const logger: Logger = {
  debug: (message, context) => {
    if (!shouldLog('debug')) return;
    console.debug(formatMessage('debug', message, context));
  },
  
  info: (message, context) => {
    if (!shouldLog('info')) return;
    console.info(formatMessage('info', message, context));
  },
  
  warn: (message, context) => {
    if (!shouldLog('warn')) return;
    console.warn(formatMessage('warn', message, context));
    sendToSentry('warn', message, context);
  },
  
  error: (message, context) => {
    if (!shouldLog('error')) return;
    console.error(formatMessage('error', message, context));
    sendToSentry('error', message, context);
  },
};

/** Create a child logger with default context */
export function createChildLogger(defaultContext: LogContext): Logger {
  return {
    debug: (message, context) => logger.debug(message, { ...defaultContext, ...context }),
    info: (message, context) => logger.info(message, { ...defaultContext, ...context }),
    warn: (message, context) => logger.warn(message, { ...defaultContext, ...context }),
    error: (message, context) => logger.error(message, { ...defaultContext, ...context }),
  };
}

/** Log API request/response */
export function logApiRequest(
  method: string,
  url: string,
  status: number,
  durationMs: number,
  context?: LogContext
) {
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  logger[level](`API ${method} ${url} → ${status} (${durationMs}ms)`, {
    ...context,
    action: 'api_request',
    metadata: { method, url, status, durationMs },
  });
}

/** Log user action for audit trail */
export function logUserAction(
  action: string,
  context: LogContext & { resourceType?: string; resourceId?: string; success: boolean }
) {
  logger.info(`User action: ${action}`, {
    ...context,
    action: `user_${action}`,
  });
  
  // Also send to dedicated audit log if needed
  if (import.meta.env.VITE_AUDIT_LOG_ENDPOINT) {
    fetch(import.meta.env.VITE_AUDIT_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        action,
        ...context,
      }),
    }).catch(() => {}); // Fire and forget
  }
}

/** Performance timing helper */
export function createTimer(label: string, context?: LogContext) {
  const start = performance.now();
  return {
    stop: (message?: string) => {
      const duration = performance.now() - start;
      logger.info(message || `Timer: ${label}`, {
        ...context,
        action: 'performance_timer',
        metadata: { label, durationMs: duration },
      });
      return duration;
    },
  };
}

/** React Query error handler for Sentry */
export function queryErrorHandler(error: unknown, context?: LogContext) {
  logger.error('React Query error', {
    ...context,
    action: 'query_error',
    error: error instanceof Error ? error : new Error(String(error)),
  });
}

/** React component error handler for Sentry */
export function componentErrorHandler(error: Error, errorInfo: React.ErrorInfo, context?: LogContext) {
  logger.error('React component error', {
    ...context,
    action: 'component_error',
    error,
    metadata: { componentStack: errorInfo.componentStack },
  });
}

export default logger;