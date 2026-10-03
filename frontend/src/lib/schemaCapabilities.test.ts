import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isMissingColumnError,
  isColumnKnownMissing,
  noteMissingColumn,
  _resetSchemaCapabilities,
} from './schemaCapabilities';

describe('schemaCapabilities', () => {
  beforeEach(() => _resetSchemaCapabilities());
  afterEach(() => vi.useRealTimers());

  it('recognises Postgres 42703 and message-only errors', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
    expect(isMissingColumnError({ message: 'column x.y does not exist' })).toBe(true);
    expect(isMissingColumnError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });

  it('only remembers genuine missing-column errors', () => {
    expect(noteMissingColumn('t.c', { code: '42501' })).toBe(false);
    expect(isColumnKnownMissing('t.c')).toBe(false);
    expect(noteMissingColumn('t.c', { code: '42703' })).toBe(true);
    expect(isColumnKnownMissing('t.c')).toBe(true);
  });

  it('expires after the TTL so a newly applied migration is re-probed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    noteMissingColumn('t.c', { code: '42703' });
    vi.setSystemTime(new Date('2026-10-03T00:29:00Z'));
    expect(isColumnKnownMissing('t.c')).toBe(true);
    vi.setSystemTime(new Date('2026-10-03T00:31:00Z'));
    expect(isColumnKnownMissing('t.c')).toBe(false);
  });
});
