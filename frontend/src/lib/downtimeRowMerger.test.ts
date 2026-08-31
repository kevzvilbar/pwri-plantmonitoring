import { describe, it, expect } from 'vitest';
import { isOfflineReadingRow, groupLogItemsWithOfflineSpans } from './downtimeRowMerger';

describe('downtimeRowMerger', () => {
  describe('isOfflineReadingRow for RO train readings', () => {
    it('returns false for active operational RO reading with flow and pressure', () => {
      const activeRO = {
        id: 'ro-1',
        reading_datetime: '2026-08-31T22:00:00Z',
        feed_flow: 120,
        permeate_flow: 65,
        reject_flow: 55,
        feed_pressure_psi: 250,
        reject_pressure_psi: 220,
        feed_tds: 6600,
        permeate_tds: 120,
      };
      expect(isOfflineReadingRow(activeRO)).toBe(false);
    });

    it('returns true for an RO reading with explicit offline incomplete_reason', () => {
      const offlineRO = {
        id: 'ro-2',
        reading_datetime: '2026-08-31T19:25:00Z',
        incomplete_reason: 'Offline: Power Outage',
      };
      expect(isOfflineReadingRow(offlineRO)).toBe(true);
    });

    it('returns true for an RO reading with zero flow and missing sensors', () => {
      const emptyRO = {
        id: 'ro-3',
        reading_datetime: '2026-08-31T19:25:00Z',
        feed_flow: 0,
        permeate_flow: 0,
        reject_flow: 0,
        feed_pressure_psi: null,
        reject_pressure_psi: null,
        feed_tds: null,
        permeate_tds: null,
      };
      expect(isOfflineReadingRow(emptyRO)).toBe(true);
    });
  });

  describe('isOfflineReadingRow for Pre-Treatment readings', () => {
    it('returns false for active Pre-Treatment reading with HPP pressure target', () => {
      const activePretreat = {
        id: 'pre-1',
        reading_datetime: '2026-08-31T22:00:00Z',
        hpp_target_pressure_psi: 250,
        afm_units: [],
        booster_pumps: {},
      };
      expect(isOfflineReadingRow(activePretreat)).toBe(false);
    });

    it('returns false for active Pre-Treatment reading with AFM unit pressures or backwash', () => {
      const activePretreat = {
        id: 'pre-2',
        reading_datetime: '2026-08-31T21:00:00Z',
        hpp_target_pressure_psi: null,
        afm_units: [
          { unit: 1, in_psi: 45, out_psi: 38, dp_psi: 7 },
        ],
        booster_pumps: {},
      };
      expect(isOfflineReadingRow(activePretreat)).toBe(false);
    });

    it('returns false for active Pre-Treatment reading with booster pump data', () => {
      const activePretreat = {
        id: 'pre-3',
        reading_datetime: '2026-08-31T20:00:00Z',
        hpp_target_pressure_psi: null,
        afm_units: [],
        booster_pumps: {
          1: { hz: 50, amp: 22, target: 50 },
        },
      };
      expect(isOfflineReadingRow(activePretreat)).toBe(false);
    });

    it('returns false for active Pre-Treatment reading with cartridge housing delta P', () => {
      const activePretreat = {
        id: 'pre-4',
        reading_datetime: '2026-08-31T17:00:00Z',
        hpp_target_pressure_psi: null,
        afm_units: [],
        booster_pumps: {},
        filter_housings: {
          1: { inP: 40, outP: 35, deltaP: 5 },
        },
      };
      expect(isOfflineReadingRow(activePretreat)).toBe(false);
    });

    it('returns true for an empty Pre-Treatment check-in during offline outage', () => {
      const offlinePretreat = {
        id: 'pre-5',
        reading_datetime: '2026-08-31T19:25:00Z',
        hpp_target_pressure_psi: null,
        bag_filters_changed: null,
        afm_units: [],
        booster_pumps: {},
        filter_housings: {},
        incomplete_reason: 'Offline: Power Outage',
      };
      expect(isOfflineReadingRow(offlinePretreat)).toBe(true);
    });
  });

  describe('groupLogItemsWithOfflineSpans', () => {
    it('does not merge active operational readings into offline spans', () => {
      const items = [
        {
          kind: 'reading' as const,
          row: {
            id: 'pre-1',
            reading_datetime: '2026-08-31T22:00:00Z',
            hpp_target_pressure_psi: 250,
            afm_units: [{ unit: 1, in_psi: 45, out_psi: 38 }],
          },
        },
        {
          kind: 'reading' as const,
          row: {
            id: 'pre-2',
            reading_datetime: '2026-08-31T21:00:00Z',
            hpp_target_pressure_psi: 250,
            afm_units: [{ unit: 1, in_psi: 44, out_psi: 38 }],
          },
        },
      ];

      const grouped = groupLogItemsWithOfflineSpans(items as any, 2);
      expect(grouped).toHaveLength(2);
      expect(grouped[0].kind).toBe('reading');
      expect(grouped[1].kind).toBe('reading');
    });

    it('merges contiguous offline check-ins into an OfflineSpan', () => {
      const items = [
        {
          kind: 'reading' as const,
          row: {
            id: 'off-1',
            reading_datetime: '2026-08-31T19:20:00Z',
            incomplete_reason: 'Offline: Maintenance',
            hpp_target_pressure_psi: null,
            afm_units: [],
          },
        },
        {
          kind: 'reading' as const,
          row: {
            id: 'off-2',
            reading_datetime: '2026-08-31T19:25:00Z',
            incomplete_reason: 'Offline: Maintenance',
            hpp_target_pressure_psi: null,
            afm_units: [],
          },
        },
      ];

      const grouped = groupLogItemsWithOfflineSpans(items as any, 2);
      expect(grouped).toHaveLength(1);
      expect(grouped[0].kind).toBe('offline-span');
      if (grouped[0].kind === 'offline-span') {
        expect(grouped[0].span.rows).toHaveLength(2);
        expect(grouped[0].span.combinedReasonText).toContain('Maintenance');
      }
    });
  });
});

