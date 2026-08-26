import { describe, it, expect } from 'vitest';
import { latestRaw } from './blendingRawCache';

describe('latestRaw', () => {
  // Regression test for the bug where the "prev meter" reading shown on the
  // dashboard was a months-old localStorage value cached on one device (e.g.
  // 60,582 from 2026-07-29), even though the DB — and the well's own Reading
  // History — already had entries as recent as 69,583 on 2026-08-26. The old
  // code always preferred localStorage whenever it was non-null; it must
  // instead prefer whichever source is actually more recent.
  it('prefers the DB reading when it is newer than the cached localStorage reading', () => {
    const cached = { reading: 60582, date: '2026-07-29' };
    const dbLatest = { reading: 69583, date: '2026-08-26' };
    expect(latestRaw(cached, dbLatest)).toEqual(dbLatest);
  });

  it('prefers the cached reading when it is newer than the DB reading', () => {
    const cached = { reading: 70000, date: '2026-08-27' };
    const dbLatest = { reading: 69583, date: '2026-08-26' };
    expect(latestRaw(cached, dbLatest)).toEqual(cached);
  });

  it('falls back to the DB reading when nothing is cached locally', () => {
    const dbLatest = { reading: 69583, date: '2026-08-26' };
    expect(latestRaw(null, dbLatest)).toEqual(dbLatest);
  });

  it('falls back to the cached reading when the DB has nothing', () => {
    const cached = { reading: 60582, date: '2026-07-29' };
    expect(latestRaw(cached, null)).toEqual(cached);
  });

  it('returns null when neither source has a reading', () => {
    expect(latestRaw(null, null)).toBeNull();
  });

  it('prefers either value when dates are equal (same-day resave)', () => {
    const cached = { reading: 100, date: '2026-08-26' };
    const dbLatest = { reading: 100, date: '2026-08-26' };
    expect(latestRaw(cached, dbLatest)).toEqual(cached);
  });
});
