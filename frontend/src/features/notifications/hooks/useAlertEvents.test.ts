import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isRetryableError,
  getOutboxKey,
  readOutbox,
  writeOutbox,
  persistEvent,
  flushAlertEventOutbox,
  alertEventOutboxSize,
  isSnoozeAllowed,
  canResolve,
  MAX_SNOOZE_MS,
  OUTBOX_KEY_PREFIX,
} from './useAlertEvents';
import { supabase } from '@/integrations/supabase/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('useAlertEvents unit tests (P3-2 shared tablet outbox)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('isSnoozeAllowed & canResolve helpers', () => {
    it('disallows snooze for critical alerts', () => {
      expect(isSnoozeAllowed('critical', 3600_000)).toBe(false);
    });

    it('allows snooze up to 24h for warning/info alerts', () => {
      expect(isSnoozeAllowed('warning', 3600_000)).toBe(true);
      expect(isSnoozeAllowed('warning', MAX_SNOOZE_MS)).toBe(true);
      expect(isSnoozeAllowed('warning', MAX_SNOOZE_MS + 1)).toBe(false);
      expect(isSnoozeAllowed('info', 0)).toBe(false);
    });

    it('canResolve requires non-empty note', () => {
      expect(canResolve('')).toBe(false);
      expect(canResolve('   ')).toBe(false);
      expect(canResolve('Fixed the pump')).toBe(true);
    });
  });

  describe('isRetryableError', () => {
    it('identifies network, timeout, and fetch errors as retryable', () => {
      expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
      expect(isRetryableError({ message: 'Network request failed' })).toBe(true);
      expect(isRetryableError({ message: 'Connection timeout' })).toBe(true);
      expect(isRetryableError({ message: 'The operation was aborted' })).toBe(true);
    });

    it('identifies HTTP 5xx and 429 as retryable', () => {
      expect(isRetryableError({ status: 500, message: 'Internal Server Error' })).toBe(true);
      expect(isRetryableError({ status: 502, message: 'Bad Gateway' })).toBe(true);
      expect(isRetryableError({ status: 503, message: 'Service Unavailable' })).toBe(true);
      expect(isRetryableError({ status: 429, message: 'Too Many Requests' })).toBe(true);
    });

    it('identifies Postgres connection errors (08xxx) as retryable', () => {
      expect(isRetryableError({ code: '08006', message: 'connection failure' })).toBe(true);
    });

    it('identifies HTTP 4xx, RLS policy violations, and schema errors as non-retryable', () => {
      expect(isRetryableError({ status: 400, message: 'Bad Request' })).toBe(false);
      expect(isRetryableError({ status: 401, message: 'Unauthorized' })).toBe(false);
      expect(isRetryableError({ status: 403, message: 'Forbidden' })).toBe(false);
      expect(isRetryableError({ status: 422, message: 'Unprocessable Entity' })).toBe(false);

      // Postgres RLS violation (42501)
      expect(isRetryableError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false);
      // Postgres FK constraint violation (23503)
      expect(isRetryableError({ code: '23503', message: 'foreign key violation' })).toBe(false);
      // Postgres unique constraint violation (23505)
      expect(isRetryableError({ code: '23505', message: 'unique constraint violation' })).toBe(false);
    });
  });

  describe('Outbox user partitioning', () => {
    it('scopes outbox keys per user', () => {
      expect(getOutboxKey('user-alice')).toBe(`${OUTBOX_KEY_PREFIX}user-alice`);
      expect(getOutboxKey('user-bob')).toBe(`${OUTBOX_KEY_PREFIX}user-bob`);
      expect(getOutboxKey(null)).toBe('pwri-alert-event-outbox');
    });

    it('stores and reads outbox partitioned by user', () => {
      const aliceRow = { alert_key: 'tds-1', action: 'acknowledged', user_id: 'user-alice' };
      const bobRow = { alert_key: 'dp-2', action: 'resolved', note: 'fixed', user_id: 'user-bob' };

      writeOutbox('user-alice', [aliceRow]);
      writeOutbox('user-bob', [bobRow]);

      expect(readOutbox('user-alice')).toEqual([aliceRow]);
      expect(readOutbox('user-bob')).toEqual([bobRow]);
      expect(alertEventOutboxSize('user-alice')).toBe(1);
      expect(alertEventOutboxSize('user-bob')).toBe(1);
    });
  });

  describe('persistEvent with error classification', () => {
    it('returns true on successful insert and does not queue in outbox', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      (supabase.from as any).mockReturnValue({ insert: mockInsert });

      const row = { alert_key: 'tds-1', action: 'acknowledged', user_id: 'user-alice' };
      const ok = await persistEvent(row, 'user-alice');

      expect(ok).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(row);
      expect(readOutbox('user-alice')).toHaveLength(0);
    });

    it('queues in user outbox when insert fails with retryable error (e.g. offline)', async () => {
      const mockInsert = vi.fn().mockResolvedValue({
        error: { message: 'Failed to fetch', status: 503 },
      });
      (supabase.from as any).mockReturnValue({ insert: mockInsert });

      const row = { alert_key: 'tds-1', action: 'acknowledged', user_id: 'user-alice' };
      const ok = await persistEvent(row, 'user-alice');

      expect(ok).toBe(false);
      expect(readOutbox('user-alice')).toEqual([row]);
    });

    it('drops non-retryable errors (e.g. 403 RLS violation) instead of queuing', async () => {
      const mockInsert = vi.fn().mockResolvedValue({
        error: { code: '42501', message: 'row-level security violation', status: 403 },
      });
      (supabase.from as any).mockReturnValue({ insert: mockInsert });

      const row = { alert_key: 'tds-1', action: 'acknowledged', user_id: 'user-alice' };
      const ok = await persistEvent(row, 'user-alice');

      expect(ok).toBe(false);
      expect(readOutbox('user-alice')).toHaveLength(0);
    });
  });

  describe('flushAlertEventOutbox shared tablet behavior', () => {
    it('flushes only current user events and does not replay other user events', async () => {
      const aliceRow = { alert_key: 'tds-1', action: 'acknowledged', user_id: 'user-alice' };
      const bobRow = { alert_key: 'dp-2', action: 'resolved', note: 'fixed', user_id: 'user-bob' };

      writeOutbox('user-alice', [aliceRow]);
      writeOutbox('user-bob', [bobRow]);

      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      (supabase.from as any).mockReturnValue({ insert: mockInsert });

      // Alice flushes her outbox
      const sent = await flushAlertEventOutbox('user-alice');

      expect(sent).toBe(1);
      expect(mockInsert).toHaveBeenCalledWith(aliceRow);
      expect(mockInsert).not.toHaveBeenCalledWith(bobRow);
      expect(readOutbox('user-alice')).toHaveLength(0);
      expect(readOutbox('user-bob')).toEqual([bobRow]); // Bob's outbox remains intact
    });

    it('drops non-retryable errors (e.g. 403) from the queue so subsequent items are not blocked', async () => {
      const badRow = { alert_key: 'bad-key', action: 'acknowledged', user_id: 'user-alice' };
      const goodRow = { alert_key: 'good-key', action: 'acknowledged', user_id: 'user-alice' };

      writeOutbox('user-alice', [badRow, goodRow]);

      const mockInsert = vi.fn()
        .mockResolvedValueOnce({
          error: { code: '42501', message: 'RLS violation', status: 403 },
        })
        .mockResolvedValueOnce({ error: null });

      (supabase.from as any).mockReturnValue({ insert: mockInsert });

      const sent = await flushAlertEventOutbox('user-alice');

      expect(sent).toBe(1); // goodRow succeeded
      expect(readOutbox('user-alice')).toHaveLength(0); // badRow was dropped, goodRow was sent
    });

    it('stops flushing and preserves remaining items on transient network error', async () => {
      const row1 = { alert_key: 'key-1', action: 'acknowledged', user_id: 'user-alice' };
      const row2 = { alert_key: 'key-2', action: 'acknowledged', user_id: 'user-alice' };

      writeOutbox('user-alice', [row1, row2]);

      const mockInsert = vi.fn().mockResolvedValueOnce({
        error: { message: 'Failed to fetch', status: 503 },
      });

      (supabase.from as any).mockReturnValue({ insert: mockInsert });

      const sent = await flushAlertEventOutbox('user-alice');

      expect(sent).toBe(0);
      expect(readOutbox('user-alice')).toEqual([row1, row2]); // preserved for next attempt
    });
  });
});
